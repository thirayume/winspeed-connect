/**
 * so.js — wf.SalesOrder state machine
 * DRAFT → CONFIRMED → PICKING → SHIPPED → IMPORTED | CANCELLED
 *
 * ⚠ ไม่มีการเขียน dbo ใดๆ — writes ไปที่ wf schema เท่านั้น
 */
const router = require('express').Router();
const { sql, wfQuery, wfTransaction } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { generateImportFiles } = require('../services/winspeed-import.service');

router.use(requireAuth);

// PascalCase → camelCase (DB คอลัมน์เป็น PascalCase, frontend type เป็น camelCase)
const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const camelizeRow = (row) => {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out;
};
const camelizeRows = (rows) => (rows || []).map(camelizeRow);

// ── helpers ──────────────────────────────────────────────────
async function getSoOrThrow(id, expectedStatus = null) {
  const isString = typeof id === 'string' && isNaN(Number(id));
  const idValue = isString ? id : Number(id);
  const idCol = isString ? 'Id' : 'CAST(Id AS INT)';
  const idType = isString ? sql.VarChar(50) : sql.Int;

  const r = await wfQuery(
    `SELECT * FROM wf.v_AllSalesOrders WHERE ${idCol} = @id`,
    { id: { type: idType, value: idValue } }
  );
  const so = r.recordset?.[0];
  if (!so) throw Object.assign(new Error(`SO id ${id} ไม่พบ`), { status: 404 });
  if (expectedStatus && so.Status !== expectedStatus)
    throw Object.assign(new Error(`SO ต้องอยู่ใน ${expectedStatus} (ปัจจุบัน: ${so.Status})`), { status: 400 });
  return so;
}

async function getLines(soId) {
  const isString = typeof soId === 'string' && isNaN(Number(soId));
  const idValue = isString ? soId : Number(soId);
  const idCol = isString ? 'SoId' : 'CAST(SoId AS INT)';
  const idType = isString ? sql.VarChar(50) : sql.Int;

  const r = await wfQuery(
    `SELECT * FROM wf.v_AllSalesOrderLines WHERE ${idCol} = @soId ORDER BY LineNum`,
    { soId: { type: idType, value: idValue } }
  );
  return r.recordset || [];
}

// audit — เขียน log การเปลี่ยนสถานะ (immutable). ไม่ผูก transaction เพื่อความเรียบง่าย
async function audit(_tx, soId, userId, action, fromStatus, toStatus, note, ipAddress) {
  await wfQuery(
    `INSERT INTO wf.SalesOrderAudit (SoId, UserId, Action, FromStatus, ToStatus, Note, IpAddress)
     VALUES (@soId, @userId, @action, @fromStatus, @toStatus, @note, @ip)`,
    {
      soId:       { type: sql.VarChar(50),  value: String(soId) },
      userId:     { type: sql.Int,          value: userId },
      action:     { type: sql.NVarChar(50), value: action },
      fromStatus: { type: sql.NVarChar(20), value: fromStatus || null },
      toStatus:   { type: sql.NVarChar(20), value: toStatus || null },
      note:       { type: sql.NVarChar(500),value: note || null },
      ip:         { type: sql.NVarChar(45), value: ipAddress || null },
    }
  );
}

// ── GET /api/so/stats — สรุปจำนวนตามสถานะ (Dashboard) ────────
// Cache 5 นาที เพื่อลด load จาก 107k rows scan บน dbo.SOHD
let _statsCache = null;
let _statsCacheAt = 0;
const STATS_TTL = 5 * 60 * 1000;

router.delete('/stats/cache', requireRole('ADMIN'), (req, res) => {
  _statsCache = null; _statsCacheAt = 0;
  res.json({ ok: true, message: 'Stats cache cleared' });
});

router.get('/stats', async (req, res) => {
  try {
    const now = Date.now();
    const bust = req.query.bust === '1';
    if (!bust && _statsCache && now - _statsCacheAt < STATS_TTL) return res.json(_statsCache);

    const r = await wfQuery(`
      SELECT Status, COUNT(*) AS Cnt
      FROM wf.v_AllSalesOrders
      GROUP BY Status
    `);
    const byStatus = {};
    for (const row of r.recordset || []) byStatus[row.Status] = row.Cnt;
    const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
    _statsCache = { byStatus, total, cachedAt: new Date().toISOString() };
    _statsCacheAt = now;
    res.json(_statsCache);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// ── GET /api/so ───────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, custId, search, page = 1, limit = 50 } = req.query;
    const conditions = [];
    const inputs = {};
    if (status)  { conditions.push(`so.Status = @status`);  inputs.status  = { type: sql.NVarChar(20), value: status }; }
    if (custId)  { conditions.push(`so.CustId = @custId`);  inputs.custId  = { type: sql.NVarChar(20), value: custId }; }
    if (search)  { 
      conditions.push(`(so.WfRef LIKE '%' + @search + '%' OR so.CustName LIKE '%' + @search + '%')`);
      inputs.search = { type: sql.NVarChar(100), value: search }; 
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (Number(page) - 1) * Number(limit);

    const r = await wfQuery(`
      SELECT so.*, u.DisplayName AS SalesName,
             COUNT(*) OVER() AS TotalCount
      FROM wf.v_AllSalesOrders so
      LEFT JOIN wf.AppUser u ON u.Id = so.SalesUserId
      ${where}
      ORDER BY so.CreatedAt DESC, so.Id DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
    `, inputs);
    const rows = r.recordset || [];
    const total = rows[0]?.TotalCount || 0;

    // attach lines for each order on this page
    const orders = camelizeRows(rows);
    if (orders.length) {
      const ids = rows.map(x => x.Id);
      const lr = await wfQuery(
        `SELECT * FROM wf.v_AllSalesOrderLines WHERE SoId IN (${ids.map((_, i) => `@id${i}`).join(',')}) ORDER BY SoId, LineNum`,
        Object.fromEntries(ids.map((id, i) => [`id${i}`, { type: sql.VarChar(50), value: String(id) }]))
      );
      const linesByso = {};
      for (const line of camelizeRows(lr.recordset)) {
        (linesByso[line.soId] ??= []).push(line);
      }
      for (const o of orders) o.lines = linesByso[o.id] || [];
    }
    res.json({ data: orders, total, page: Number(page), limit: Number(limit) });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// ── GET /api/so/rebate-balance/:custId ─────────────────────────
router.get('/rebate-balance/:custId', async (req, res) => {
  try {
    const r = await wfQuery(
      `SELECT ISNULL(SUM(RemainingAmt), 0) AS AvailableRebate 
       FROM wf.RebateLedger 
       WHERE CustId = @custId AND Status = 'PENDING' AND RemainingAmt > 0 AND ReversedFlag = 0`,
      { custId: { type: sql.VarChar(20), value: req.params.custId } }
    );
    res.json({ availableRebate: Number(r.recordset[0]?.AvailableRebate || 0) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/so/debug-sohd ──────────────────────────────────
router.get('/debug-sohd', async (req, res) => {
  try {
    const r = await wfQuery(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='SOHD'`);
    res.json(r.recordset);
  } catch(e) { res.status(500).json({msg: e.message}); }
});

// ── GET /api/so/:id ──────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id);
    const lines = await getLines(so.Id);
    const auditR = await wfQuery(
      `SELECT a.*, u.DisplayName FROM wf.SalesOrderAudit a JOIN wf.AppUser u ON u.Id = a.UserId WHERE a.SoId = @id ORDER BY a.CreatedAt DESC`,
      { id: { type: sql.VarChar(50), value: String(so.Id) } }
    );
    res.json({
      ...camelizeRow(so),
      lines: camelizeRows(lines),
      auditLogs: camelizeRows(auditR.recordset),
    });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── POST /api/so — Create DRAFT (Supports Single or Grouped Multi-Bill) ──
router.post('/', requireRole('SALES', 'COUNTER_SALES', 'ADMIN'), async (req, res) => {
  try {
    const orders = Array.isArray(req.body) ? req.body : [req.body];
    if (orders.length === 0) return res.status(400).json({ message: 'ไม่มีข้อมูลคำสั่งซื้อ' });

    for (const order of orders) {
      if (!order.custId || !order.lines?.length) return res.status(400).json({ message: 'custId และ lines จำเป็น' });
      if (!['I', 'K', 'AI'].includes(order.soPrefix)) return res.status(400).json({ message: 'soPrefix ต้องเป็น I / K / AI' });
    }

    const createdIds = [];
    const createdRefs = [];
    let anyNeedsApproval = false;

    await wfTransaction(async tx => {
      for (const order of orders) {
        const { soPrefix, custId, custName, truckPlate, controlTicketNo, deliveryDate, remark, lines, salesUserId: impersonatedId, rebateDiscountAmt } = order;

        // price deviation check
        const devLine = lines.find(l => !l.isGiveaway && (Number(l.pricePerTon) < Number(l.netPricePerTon) - 500));
        const needsApproval = !!devLine;
        if (needsApproval) anyNeedsApproval = true;

        // generate WfRef
        const seqR = await tx.request().query(`SELECT NEXT VALUE FOR wf.WfRefSeq AS Seq`);
        const seq = String(seqR.recordset[0].Seq).padStart(6, '0');
        const yy = (new Date().getFullYear() + 543 - 2500).toString().slice(-2);
        const wfRef = `WF${yy}${soPrefix}-${seq}`;

        const soReq = tx.request();
        soReq.input('wfRef',            sql.NVarChar(30),  wfRef);
        soReq.input('soPrefix',         sql.NVarChar(5),   soPrefix);
        soReq.input('custId',           sql.NVarChar(20),  custId);
        soReq.input('custName',         sql.NVarChar(200), custName || '');
        soReq.input('truckPlate',       sql.NVarChar(30),  truckPlate || null);
        soReq.input('controlTicketNo',  sql.NVarChar(20),  controlTicketNo || null);
        soReq.input('deliveryDate',     sql.Date,          deliveryDate ? new Date(deliveryDate) : null);
        soReq.input('remark',           sql.NVarChar(500), remark || null);
        soReq.input('rebateDiscountAmt', sql.Decimal(12,2), Number(rebateDiscountAmt) || 0);
        const actualSalesUserId = (req.user.role === 'ADMIN' && impersonatedId) ? Number(impersonatedId) : req.user.sub;
        soReq.input('salesUserId',      sql.Int,           actualSalesUserId);

        const soR = await soReq.query(`
          INSERT INTO wf.SalesOrder
            (WfRef, SoPrefix, CustId, CustName, TruckPlate, ControlTicketNo, DeliveryDate, Remark, SalesUserId, RebateDiscountAmt, Status)
            OUTPUT inserted.Id
          VALUES (@wfRef, @soPrefix, @custId, @custName, @truckPlate, @controlTicketNo, @deliveryDate, @remark, @salesUserId, @rebateDiscountAmt, 'DRAFT')
        `);
        const soId = soR.recordset[0].Id;
        createdIds.push(soId);
        createdRefs.push(wfRef);

        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          const lr = tx.request();
          lr.input('soId',                 sql.Int,           soId);
          lr.input('lineNum',              sql.Int,           i + 1);
          lr.input('goodId',               sql.NVarChar(20),  l.goodId);
          lr.input('goodName',             sql.NVarChar(200), l.goodName || '');
          lr.input('goodCode',             sql.NVarChar(50),  l.goodCode || '');
          lr.input('qtyTon',               sql.Decimal(12,3), Number(l.qtyTon));
          lr.input('qtyBag',               sql.Int,           Number(l.qtyBag) || Math.round(l.qtyTon * 20));
          lr.input('pricePerTon',          sql.Decimal(12,2), Number(l.pricePerTon));
          lr.input('netPricePerTon',       sql.Decimal(12,2), Number(l.netPricePerTon) || 0);
          lr.input('isGiveaway',           sql.Bit,           l.isGiveaway ? 1 : 0);
          lr.input('refControlTicketNo',   sql.NVarChar(30),  l.refControlTicketNo || null);
          lr.input('isControlTicketDrawn', sql.Bit,           l.isControlTicketDrawn ? 1 : 0);
          
          await lr.query(`
            INSERT INTO wf.SalesOrderLine
              (SoId, LineNum, GoodId, GoodName, GoodCode, QtyTon, QtyBag, PricePerTon, NetPricePerTon, IsGiveaway, RefControlTicketNo, IsControlTicketDrawn)
            VALUES (@soId, @lineNum, @goodId, @goodName, @goodCode, @qtyTon, @qtyBag, @pricePerTon, @netPricePerTon, @isGiveaway, @refControlTicketNo, @isControlTicketDrawn)
          `);
        }
      }
    });

    for (const soId of createdIds) {
      await audit(null, soId, req.user.sub, 'CREATED', null, 'DRAFT', null, req.ip);
    }

    // For backwards compatibility, if they sent an array, return array format. Otherwise return single object format.
    if (Array.isArray(req.body)) {
      res.json({ ids: createdIds, wfRefs: createdRefs, needsApproval: anyNeedsApproval });
    } else {
      res.json({ id: createdIds[0], wfRef: createdRefs[0], needsApproval: anyNeedsApproval });
    }
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/confirm ────────────────────────────────
router.patch('/:id/confirm', requireRole('SALES', 'COUNTER_SALES', 'ADMIN'), async (req, res) => {
  try {
    const so = await getSoOrThrow(Number(req.params.id), 'DRAFT');
    const lines = await getLines(so.Id);

    // Get the RebateDiscountAmt from draft table
    const rAmt = await wfQuery(`SELECT ISNULL(RebateDiscountAmt, 0) AS RebateDiscountAmt FROM wf.SalesOrder WHERE Id = @id`, { id: { type: sql.Int, value: so.Id } });
    const rebateDiscountAmt = rAmt.recordset[0]?.RebateDiscountAmt || 0;

    // ตรวจ price deviation: ราคาขาย < NET - 500 → block
    const devLine = lines.find(l => !l.IsGiveaway && (Number(l.PricePerTon) < Number(l.NetPricePerTon) - 500));
    if (devLine) {
      return res.status(400).json({
        message: `ราคาต่ำกว่า NET เกิน 500 บาท/ตัน (${devLine.GoodCode}: ฿${devLine.PricePerTon} vs NET ฿${devLine.NetPricePerTon}) — ต้องอนุมัติจาก ผจก. 3 ท่านก่อน`,
        requiresApproval: true
      });
    }

    // 1. เรียก Stored Procedure เพื่อย้ายข้อมูลจาก wf.SalesOrder ไป SOHD (Winspeed)
    const spReq = new sql.Request();
    spReq.input('SoId', sql.Int, so.Id);
    spReq.output('NewSoid', sql.VarChar(50));
    const spRes = await spReq.execute('wf.sp_ConfirmSalesOrder');
    
    const newSoid = spRes.output.NewSoid;
    if (!newSoid) throw new Error('ย้ายข้อมูลไปยัง Winspeed ไม่สำเร็จ (ไม่ได้ SOID กลับมา)');

    // 2. ตั้ง Rebate accrual — เรียก rebate service (ใช้ newSoid ที่เป็น string)
    await bookRebateAccrual({ ...so, Id: newSoid }, lines, req.user.sub);

    // 2.5 Consume Rebate (FIFO)
    if (rebateDiscountAmt > 0) {
      await consumeRebateAccrual(so.CustId, newSoid, rebateDiscountAmt);
    }

    // 3. Audit log (บันทึกโดยใช้ newSoid)
    await audit(null, newSoid, req.user.sub, 'CONFIRMED', 'DRAFT', 'CONFIRMED', null, req.ip);
    res.json({ id: newSoid, status: 'CONFIRMED' });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/picking ────────────────────────────────
router.patch('/:id/picking', requireRole('WAREHOUSE', 'ADMIN'), async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id, 'CONFIRMED');
    await wfQuery(`UPDATE dbo.SOHD SET PkgStatus='Y' WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: so.Id } });
    await wfQuery(`UPDATE wf.SalesOrderExt SET UpdatedAt=GETUTCDATE() WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: so.Id } });
    await audit(null, so.Id, req.user.sub, 'PICKING', 'CONFIRMED', 'PICKING', null, req.ip);
    res.json({ id: so.Id, status: 'PICKING' });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/unlock — APPROVER เท่านั้น (สุรชัย) ─────
router.patch('/:id/unlock', requireRole('APPROVER', 'ADMIN'), async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id, 'PICKING');
    const { note } = req.body;

    // Reverse rebate accrual entries (ไม่ลบ, ใช้ reversedFlag)
    await wfQuery(
      `UPDATE wf.RebateLedger SET ReversedFlag=1, ReversedAt=GETUTCDATE(), ReversedNote=@note, Status='REVERSED'
       WHERE SoId=@soId AND ReversedFlag=0`,
      { soId: { type: sql.VarChar(50), value: so.Id }, note: { type: sql.NVarChar(300), value: note || 'Unlocked' } }
    );
    await wfQuery(`UPDATE wf.SalesOrderLineExt SET RebateBooked=0 WHERE SOID=@soId`, { soId: { type: sql.VarChar(50), value: so.Id } });
    await wfQuery(`UPDATE dbo.SOHD SET PkgStatus='N' WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: so.Id } });
    await wfQuery(`UPDATE wf.SalesOrderExt SET UpdatedAt=GETUTCDATE() WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: so.Id } });
    await audit(null, so.Id, req.user.sub, 'UNLOCKED', 'PICKING', 'CONFIRMED', note, req.ip);
    res.json({ id: so.Id, status: 'CONFIRMED' });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/load — ยืนยันการโหลดสินค้า (Warehouse) ─────
router.patch('/:id/load', requireRole('WAREHOUSE', 'ADMIN'), async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id, 'PICKING');
    const { sequences } = req.body; // [{ lineNum: 1, seq: 1 }, ...]
    
    if (sequences && Array.isArray(sequences)) {
      for (const item of sequences) {
        await wfQuery(
          `UPDATE wf.SalesOrderLineExt SET LoadSequence=@seq WHERE SOID=@id AND ListNo=@lineNum`,
          { seq: { type: sql.Int, value: item.seq }, id: { type: sql.VarChar(50), value: so.Id }, lineNum: { type: sql.Int, value: item.lineNum } }
        );
      }
    }

    await wfQuery(
      `UPDATE wf.SalesOrderExt SET IsLoaded=1, UpdatedAt=GETUTCDATE() WHERE SOID=@id`,
      { id: { type: sql.VarChar(50), value: so.Id } }
    );
    await audit(null, so.Id, req.user.sub, 'LOADED', 'PICKING', 'LOADED', null, req.ip);
    res.json({ id: so.Id, status: 'LOADED' });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/ship — โอนข้อมูลสมบูรณ์ (Scale) ──────
router.patch('/:id/ship', requireRole('WAREHOUSE', 'ADMIN'), async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id, 'LOADED');
    const { weighOutWeight } = req.body;
    
    // ตั้งสถานะว่า SHIPPED ใน Winspeed
    await wfQuery(
      `UPDATE dbo.SOHD SET clearflag='Y', ClearDate=GETDATE() WHERE SOID=@id`,
      { id: { type: sql.VarChar(50), value: so.Id } }
    );
    await wfQuery(
      `UPDATE wf.SalesOrderExt SET WeighOutWeight=@weight, UpdatedAt=GETUTCDATE() WHERE SOID=@id`, 
      { id: { type: sql.VarChar(50), value: so.Id }, weight: { type: sql.Decimal(10,2), value: weighOutWeight || null } }
    );
    await audit(null, so.Id, req.user.sub, 'SHIPPED', 'LOADED', 'SHIPPED', null, req.ip);
    res.json({ id: so.Id, status: 'SHIPPED' });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/sync-imported — เลิกใช้ เพราะเข้า Winspeed อัตโนมัติตั้งแต่ CONFIRM แล้ว ─
router.patch('/:id/sync-imported', requireRole('ADMIN', 'ACCOUNTING'), async (req, res) => {
  res.status(400).json({ message: 'ฟังก์ชันนี้ถูกยกเลิก (ข้อมูลซิงค์ตรงเข้า Winspeed แล้ว)' });
});

// ── PATCH /api/so/:id/cancel ─────────────────────────────────
router.patch('/:id/cancel', requireRole('SALES', 'ADMIN'), async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id);
    if (['SHIPPED', 'IMPORTED', 'CANCELLED'].includes(so.Status))
      return res.status(400).json({ message: 'ยกเลิกไม่ได้ในสถานะนี้' });
    const { note } = req.body;

    if (so.Status === 'DRAFT') {
      await wfQuery(`UPDATE wf.SalesOrder SET Status='CANCELLED', UpdatedAt=GETUTCDATE() WHERE Id=@id`, { id: { type: sql.Int, value: so.Id } });
    } else {
      await wfQuery(`UPDATE wf.RebateLedger SET ReversedFlag=1, ReversedAt=GETUTCDATE(), ReversedNote=@note, Status='REVERSED' WHERE SoId=@soId AND ReversedFlag=0`,
        { soId: { type: sql.VarChar(50), value: so.Id }, note: { type: sql.NVarChar(300), value: note || 'Cancelled' } });
      await wfQuery(`UPDATE dbo.SOHD SET DocuStatus='C' WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: so.Id } });
      await wfQuery(`UPDATE wf.SalesOrderExt SET UpdatedAt=GETUTCDATE() WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: so.Id } });
    }
    await audit(null, so.Id, req.user.sub, 'CANCELLED', so.Status, 'CANCELLED', note, req.ip);
    res.json({ id: so.Id, status: 'CANCELLED' });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── Internal: Book Rebate Accrual ────────────────────────────
async function bookRebateAccrual(so, lines, userId) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // หา/สร้าง RebatePool
  let pool = (await wfQuery(
    `SELECT * FROM wf.RebatePool WHERE SalesUserId=@u AND PeriodYear=@y AND PeriodMonth=@m`,
    { u: { type: sql.Int, value: userId }, y: { type: sql.Int, value: year }, m: { type: sql.Int, value: month } }
  )).recordset?.[0];

  if (!pool) {
    const pr = await wfQuery(
      `INSERT INTO wf.RebatePool (SalesUserId, PeriodYear, PeriodMonth, AllocatedAmt) OUTPUT inserted.* VALUES (@u,@y,@m,0)`,
      { u: { type: sql.Int, value: userId }, y: { type: sql.Int, value: year }, m: { type: sql.Int, value: month } }
    );
    pool = pr.recordset[0];
  }

  for (const l of lines) {
    if (l.IsGiveaway) continue;
    const rebatePer = Number(l.PricePerTon) - Number(l.NetPricePerTon);
    if (rebatePer <= 0) continue;
    const rebateAmt = rebatePer * Number(l.QtyTon);

    await wfQuery(
      `INSERT INTO wf.RebateLedger
         (PoolId, SoId, SoLineId, CustId, GoodId, GoodCode, QtyTon, PricePerTon, NetPricePerTon, RebatePerTon, RebateAmount, RemainingAmt, Status)
       VALUES (@poolId, @soId, @lineId, @custId, @goodId, @goodCode, @qty, @price, @net, @rebPer, @rebAmt, @rebAmt, 'PENDING')`,
      {
        poolId:   { type: sql.Int,          value: pool.Id },
        soId:     { type: sql.Int,          value: so.Id },
        lineId:   { type: sql.Int,          value: l.Id },
        custId:   { type: sql.NVarChar(20), value: so.CustId },
        goodId:   { type: sql.NVarChar(20), value: l.GoodId },
        goodCode: { type: sql.NVarChar(50), value: l.GoodCode },
        qty:      { type: sql.Decimal(12,3),value: Number(l.QtyTon) },
        price:    { type: sql.Decimal(12,2),value: Number(l.PricePerTon) },
        net:      { type: sql.Decimal(12,2),value: Number(l.NetPricePerTon) },
        rebPer:   { type: sql.Decimal(10,2),value: rebatePer },
        rebAmt:   { type: sql.Decimal(12,2),value: rebateAmt },
      }
    );
    // ⚠ Update RebateBooked in Ext table because the line is now in Winspeed + Ext
    await wfQuery(`UPDATE wf.SalesOrderLineExt SET RebateBooked=1 WHERE SOID=@soId AND ListNo=@listNo`, 
      { soId: { type: sql.VarChar(50), value: so.Id }, listNo: { type: sql.Int, value: l.LineNum || l.ListNo } });
    await wfQuery(
      `UPDATE wf.RebatePool SET AccruedAmt = AccruedAmt + @amt, UpdatedAt=GETUTCDATE() WHERE Id=@id`,
      { amt: { type: sql.Decimal(12,2), value: rebateAmt }, id: { type: sql.Int, value: pool.Id } }
    );
  }
}

// ── Internal: Consume Rebate (FIFO) ──────────────────────────
async function consumeRebateAccrual(custId, newSoid, rebateDiscountAmt) {
  if (!rebateDiscountAmt || rebateDiscountAmt <= 0) return;
  let remainingToDeduct = Number(rebateDiscountAmt);

  const ledgersR = await wfQuery(
    `SELECT Id, RemainingAmt FROM wf.RebateLedger 
     WHERE CustId = @custId AND Status = 'PENDING' AND RemainingAmt > 0 AND ReversedFlag = 0 
     ORDER BY CreatedAt ASC`,
    { custId: { type: sql.VarChar(20), value: custId } }
  );

  for (const ledger of ledgersR.recordset) {
    if (remainingToDeduct <= 0) break;
    
    const deduct = Math.min(remainingToDeduct, Number(ledger.RemainingAmt));
    remainingToDeduct -= deduct;
    
    await wfQuery(
      `UPDATE wf.RebateLedger SET RemainingAmt = RemainingAmt - @deduct WHERE Id = @id`,
      { deduct: { type: sql.Decimal(12,2), value: deduct }, id: { type: sql.Int, value: ledger.Id } }
    );
    
    await wfQuery(
      `INSERT INTO wf.RebateUsage (LedgerId, AppliedSOID, DeductedAmt) VALUES (@ledgerId, @soid, @deduct)`,
      { ledgerId: { type: sql.Int, value: ledger.Id }, soid: { type: sql.VarChar(50), value: newSoid }, deduct: { type: sql.Decimal(12,2), value: deduct } }
    );
  }
}

module.exports = router;
