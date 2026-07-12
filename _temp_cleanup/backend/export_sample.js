/**
 * export_sample.js — ดึง sample จริงจาก dbwins_worldfert9 (≤100 ชุด) + synthesize ข้อมูล wf
 * → เขียน WSSale-App/src/mock/sample-data.json (สำหรับ mock mode บน Vercel)
 * รัน: node export_sample.js   (ใช้ DB_MODE ปัจจุบันใน .env)
 * ⚠ READ-ONLY ทั้งหมด — ไม่เขียน DB
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, sql } = require('./db');

const N = 100;
const out = {};

async function main() {
  // ── master data จริง ───────────────────────────────────────
  out.customers = await query(`SELECT TOP ${N} CustID, CustName, ContTel AS Tel, ContTel1 AS Mobile FROM dbo.EMCust WITH (NOLOCK) ORDER BY CustName`);
  out.goods = await query(`
    SELECT TOP ${N} g.GoodID, g.GoodCode, g.GoodName1 AS GoodName, 20 AS BagPerTon, 50.0 AS WeightKgPerBag
    FROM dbo.EMGood g WITH (NOLOCK) WHERE g.StockFlag='Y' AND g.MainGoodUnitID=1002 ORDER BY g.GoodCode`);
  out.employees = await query(`
    SELECT TOP ${N} EmpID, EmpCode, EmpName, EmpNameEng, CASE WHEN EmpResignDate IS NULL THEN 1 ELSE 0 END AS IsActive
    FROM dbo.EMEmp WITH (NOLOCK) ORDER BY EmpCode`);
  // ราคา NET ล่าสุดต่อสินค้า (flat)
  out.prices = await query(`
    WITH r AS (SELECT dt.ListID AS GoodID, dt.GoodPriceNet,
      ROW_NUMBER() OVER (PARTITION BY dt.ListID ORDER BY hd.BeginDate DESC) rn
      FROM dbo.EMSetPriceHD hd JOIN dbo.EMSetPriceDT dt ON dt.SetPriceID=hd.SetPriceID WHERE dt.GoodPriceNet>0)
    SELECT GoodID, GoodPriceNet FROM r WHERE rn=1`);
  const netOf = (gid) => out.prices.find(p => String(p.GoodID) === String(gid))?.GoodPriceNet || 16000;

  // ── giveaway จริง (จาก wf) ──────────────────────────────────
  out.giveaway = { regions: [], budgetLines: {}, withdrawals: {}, items: [] };
  out.giveaway.items = await query(`SELECT Id, Brand, ItemName, ItemType FROM wf.GiveawayItem ORDER BY Brand, ItemName`);
  out.giveaway.regions = await query(`
    SELECT v.Region, v.EmpCode, v.EmpId, e.EmpName,
      SUM(v.BudgetQty) TotalBudget, SUM(v.WithdrawnQty) TotalWithdrawn, SUM(v.RemainingQty) TotalRemaining,
      COUNT(*) ItemCount, SUM(CASE WHEN v.RemainingQty<0 THEN 1 ELSE 0 END) OverCount
    FROM wf.v_GiveawayBudgetStatus v LEFT JOIN dbo.EMEmp e ON e.EmpID=v.EmpId
    GROUP BY v.Region, v.EmpCode, v.EmpId, e.EmpName ORDER BY v.Region`);
  for (const r of out.giveaway.regions) {
    out.giveaway.budgetLines[r.Region] = await query(`SELECT * FROM wf.v_GiveawayBudgetStatus WHERE Region=@rg ORDER BY Brand, ItemName`,
      { rg: { type: sql.NVarChar(60), value: r.Region } });
    out.giveaway.withdrawals[r.Region] = await query(`SELECT TOP 50 * FROM wf.GiveawayWithdrawal WHERE Region=@rg ORDER BY IssueMonth DESC, Id DESC`,
      { rg: { type: sql.NVarChar(60), value: r.Region } });
  }

  // ── users จริง ──────────────────────────────────────────────
  out.users = await query(`
    SELECT u.Id, u.Username, u.DisplayName, u.Role, u.EmpId, u.IsActive, e.EmpCode, e.EmpName
    FROM wf.AppUser u LEFT JOIN dbo.EMEmp e ON e.EmpID=u.EmpId ORDER BY u.DisplayName`);

  // ── synthesize SalesOrders (40) จากลูกค้า+สินค้าจริง ────────
  const STATUSES = ['DRAFT', 'CONFIRMED', 'PICKING', 'SHIPPED', 'IMPORTED', 'CANCELLED'];
  const STATUS_WEIGHT = ['DRAFT','DRAFT','CONFIRMED','CONFIRMED','CONFIRMED','PICKING','PICKING','SHIPPED','IMPORTED','IMPORTED','CANCELLED'];
  const sales = out.employees.slice(0, 6);
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (arr) => arr[rnd(0, arr.length - 1)];
  const sos = [];
  for (let i = 1; i <= 40; i++) {
    const cust = pick(out.customers);
    const status = pick(STATUS_WEIGHT);
    const nLines = rnd(1, 3);
    const lines = [];
    for (let j = 1; j <= nLines; j++) {
      const g = pick(out.goods);
      const net = netOf(g.GoodID);
      const qtyTon = rnd(1, 30);
      const pricePerTon = net + pick([0, 0, 100, 300, 500, -200]);
      lines.push({ lineNum: j, goodId: String(g.GoodID), goodCode: g.GoodCode, goodName: g.GoodName,
        qtyTon, qtyBag: qtyTon * 20, pricePerTon, netPricePerTon: net, isGiveaway: false,
        rebatePerTon: Math.max(0, pricePerTon - net), rebateAmount: Math.max(0, pricePerTon - net) * qtyTon,
        lineAmount: qtyTon * pricePerTon });
    }
    const daysAgo = rnd(0, 60);
    const emp = pick(sales);
    sos.push({
      id: i, wfRef: `WF69I-${String(i).padStart(6, '0')}`, soPrefix: 'I',
      custId: cust.CustID, custName: cust.CustName, status,
      truckPlate: rnd(0,1) ? `${rnd(60,82)}-${rnd(1000,9999)}/${rnd(60,99)}` : null,
      controlTicketNo: status !== 'DRAFT' ? `AI68-${String(rnd(1,9999)).padStart(5,'0')}` : null,
      salesUserId: emp.EmpID, salesName: emp.EmpName,
      importedDocuNo: status === 'IMPORTED' ? `N69${String(rnd(1,99999)).padStart(6,'0')}` : null,
      createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
      lines,
    });
  }
  out.salesOrders = sos;

  // soStats
  const byStatus = {};
  for (const s of sos) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  out.soStats = { byStatus, total: sos.length };

  // aging (เฉพาะที่ยัง active)
  out.aging = sos.filter(s => !['IMPORTED','CANCELLED'].includes(s.status)).map(s => ({
    CustName: s.custName, GoodCode: s.lines[0]?.goodCode || '', QtyTon: s.lines.reduce((a,l)=>a+l.qtyTon,0),
    DaysOpen: Math.floor((Date.now() - new Date(s.createdAt).getTime())/86400000),
    Status: s.status, WfRef: s.wfRef, SoId: s.id,
  })).sort((a,b)=>b.DaysOpen-a.DaysOpen);

  // paper board
  const board = {}; const stages = ['DRAFT','CONFIRMED','PICKING','SHIPPED','IMPORTED'];
  for (const st of stages) board[st] = [];
  for (const s of sos) { if (board[s.status]) board[s.status].push({
    id: s.id, wfRef: s.wfRef, custName: s.custName, status: s.status, truckPlate: s.truckPlate,
    controlTicketNo: s.controlTicketNo, importedDocuNo: s.importedDocuNo, createdAt: s.createdAt,
    salesName: s.salesName, qtyTon: s.lines.reduce((a,l)=>a+l.qtyTon,0), lineCnt: s.lines.length,
    daysOpen: Math.floor((Date.now()-new Date(s.createdAt).getTime())/86400000),
  }); }
  out.paperBoard = { stages, board };

  // rebate pools/ledger/summary จาก accrual ของ SO (group ตาม salesperson)
  const poolMap = {};
  const ledger = [];
  let ledgerId = 1, poolId = 1;
  for (const s of sos) {
    if (s.status === 'DRAFT' || s.status === 'CANCELLED') continue;
    const key = s.salesUserId;
    if (!poolMap[key]) poolMap[key] = { Id: poolId++, SalesUserId: key, SalesName: s.salesName, PeriodYear: 2569, PeriodMonth: 6, AccruedAmt: 0, ClaimedAmt: 0, AllocatedAmt: 0 };
    for (const l of s.lines) {
      if (l.rebateAmount > 0) {
        poolMap[key].AccruedAmt += l.rebateAmount;
        ledger.push({ Id: ledgerId++, PoolId: poolMap[key].Id, SoId: s.id, CustId: s.custId, GoodCode: l.goodCode,
          QtyTon: l.qtyTon, PricePerTon: l.pricePerTon, NetPricePerTon: l.netPricePerTon,
          RebatePerTon: l.rebatePerTon, RebateAmount: l.rebateAmount, RemainingAmt: l.rebateAmount,
          Status: 'PENDING', CreatedAt: s.createdAt });
      }
    }
  }
  out.rebate = { pools: Object.values(poolMap), ledger,
    claims: [], summary: Object.values(poolMap).map(p => ({ SalesName: p.SalesName, TotalAccrued: p.AccruedAmt, TotalClaimed: 0, TotalAvailable: p.AccruedAmt, TotalAllocated: 0 })) };

  // quotations (8)
  out.quotations = [];
  for (let i = 1; i <= 8; i++) {
    const cust = pick(out.customers); const g = pick(out.goods); const net = netOf(g.GoodID); const qty = rnd(2, 20);
    out.quotations.push({ Id: i, QuoteNo: `QT69-${String(i).padStart(6,'0')}`, CustId: cust.CustID, CustName: cust.CustName,
      Status: pick(['DRAFT','SENT','ACCEPTED','CONVERTED']), SalesName: pick(sales).EmpName, CreatedAt: new Date(Date.now()-rnd(0,30)*86400000).toISOString(),
      lines: [{ Id: i, LineNum: 1, GoodId: String(g.GoodID), GoodCode: g.GoodCode, GoodName: g.GoodName, QtyTon: qty, PricePerTon: net + pick([0,200,500]), NetPricePerTon: net }] });
  }

  // ── เขียนไฟล์ ───────────────────────────────────────────────
  const dir = path.join(__dirname, '..', 'WSSale-App', 'src', 'mock');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'sample-data.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1), 'utf8');
  console.log(`✓ wrote ${file}`);
  console.log(`  customers=${out.customers.length} goods=${out.goods.length} employees=${out.employees.length} prices=${out.prices.length}`);
  console.log(`  giveaway regions=${out.giveaway.regions.length} items=${out.giveaway.items.length}`);
  console.log(`  salesOrders=${out.salesOrders.length} rebatePools=${out.rebate.pools.length} ledger=${out.rebate.ledger.length} quotations=${out.quotations.length}`);
  process.exit(0);
}
main().catch(e => { console.error('✗ export failed:', e); process.exit(1); });
