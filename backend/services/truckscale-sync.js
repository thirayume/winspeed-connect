/**
 * truckscale-sync.js — ดึงข้อมูลชั่งกลับจาก TruckScale (MySQL) เข้า wf.WeighInbox
 *   - pull: s_id > watermark (รายการใหม่) + refresh รายการที่ยัง OPEN (รอชั่งออก)
 *   - upsert wf.WeighInbox (idempotent by sequence) + จับคู่ SO ที่ยัง active ด้วยทะเบียน
 *   - update watermark + broadcast realtime
 * TruckScale = READ-ONLY · เขียนเฉพาะ wf · fail-safe (ไม่ทำให้ระบบล้ม)
 */
const { sql, wfQuery } = require('../db');
const { tsQuery, getPool } = require('./truckscale-db');

const COLS = `sequence AS Sequence, s_id AS Sid, movebill AS Movebill, one_car_regis AS Plate,
  one_cus_name AS CustName, weight_in AS WeightIn, weight_out AS WeightOut, weight_net AS WeightNet,
  Date_In AS DateIn, Date_Out AS DateOut, Computer_w AS ScaleNo, one_num AS OneNum`;

// ── Plate helpers ────────────────────────────────────────────
// SO.TransRegistration มักเก็บ "หลายคันในช่องเดียว" เช่น "นว 84-1291,2" ·
// "นว84-0863/81-9513" · "ลย70-2999/3000" แต่ TruckScale เก็บคันละใบ
// → ต้องแตกเป็นทะเบียนรายคันก่อนเทียบ ไม่งั้นคันที่ 2 จะไม่มีวัน match
const normPlate = (s) => String(s || '').replace(/[\s\-\/\.]/g, '');
const plateDigits = (s) => String(s || '').replace(/\D/g, '');

function expandPlates(raw) {
  const s = String(raw || '').trim().replace(/\.+$/, '');
  if (!s) return [];
  const parts = s.split(/[,\/]+/).map(x => x.trim()).filter(Boolean);
  if (!parts.length) return [];
  const out = new Set([normPlate(parts[0])]);
  // จับ prefix จังหวัด + กลุ่มเลขของคันแรก เพื่อขยายทะเบียนแบบย่อ
  const m = parts[0].match(/^([^\d]*)(\d{1,3})\s*-?\s*(\d{1,5})/);
  const prov = m ? m[1].replace(/\s/g, '') : '';
  const g1 = m ? m[2] : '', g2 = m ? m[3] : '';
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i].replace(/\s/g, '');
    if (/[^\d\-]/.test(p)) { out.add(normPlate(p)); continue; }        // มีตัวอักษร = ทะเบียนเต็ม
    if (/^\d{1,3}-\d{1,5}$/.test(p)) { out.add(normPlate(prov + p)); continue; } // 82-0256 → เติมจังหวัด
    if (/^\d{1,5}$/.test(p) && g2) {                                   // ย่อ: 2 → 1292, 3000 → 3000
      out.add(normPlate(prov + g1 + (p.length >= g2.length ? p : g2.slice(0, g2.length - p.length) + p)));
    }
  }
  return [...out].filter(Boolean);
}

async function matchSo(r) {
  const plate = r?.Plate || r; // fallback if passed string
  const np = normPlate(plate);
  if (!np) return { id: null, status: 'UNMATCHED' };
  // prefilter กว้างพอให้ดึง SO ที่เป็นทะเบียนรวม/ย่อมาด้วย แล้วค่อยกรองแม่นใน JS
  const dg = plateDigits(np);
  const pre = dg.length >= 5 ? dg.slice(0, 5) : (dg || np);

  const raw = [];

  // 1. WebApp (wf.SalesOrder)
  const draftCand = (await wfQuery(
    `SELECT TOP 50 so.Id, ISNULL(so.DeliveryDate, so.CreatedAt) AS RefDate, so.CustName, so.TruckPlate AS RawPlate,
       (SELECT SUM(QtyTon) FROM wf.SalesOrderLine l WHERE l.SoId = so.Id) AS TotalQtyTon
     FROM wf.SalesOrder so
     WHERE so.Status IN ('DRAFT', 'CONFIRMED', 'PICKING', 'LOADED')
       AND REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(so.TruckPlate,''),' ',''),'-',''),'/',''),'.','') LIKE @p`,
    { p: { type: sql.NVarChar(80), value: `%${pre}%` } })).recordset || [];
  draftCand.forEach(c => raw.push({ id: String(c.Id), ...c, source: 'DRAFT' }));

  // 2. WINSpeed (dbo.SOHD)
  const hdCand = (await wfQuery(
    `SELECT TOP 50 hd.SOID AS Id, hd.CustName, hd.DocuDate AS RefDate, hd.TransRegistration AS RawPlate,
       (SELECT SUM(GoodQty2) FROM dbo.SODT dt WHERE dt.SOID = hd.SOID) AS TotalQtyTon
     FROM dbo.SOHD hd
     LEFT JOIN wf.SalesOrderExt ext ON ext.SOID = hd.SOID
     WHERE hd.DocuStatus NOT IN ('Y', 'C') AND ISNULL(hd.clearflag, 'N') <> 'Y'
       AND REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(hd.TransRegistration,''),' ',''),'-',''),'/',''),'.','') LIKE @p`,
    { p: { type: sql.NVarChar(80), value: `%${pre}%` } })).recordset || [];
  hdCand.forEach(c => raw.push({ id: String(c.Id), ...c, source: 'SOHD' }));

  // กรองแม่น: ทะเบียนใบชั่งต้องตรงกับ "คันใดคันหนึ่ง" ที่แตกออกมาจาก SO
  // (คง substring เดิมไว้ด้วย เพื่อความเข้ากันได้กับทะเบียนรวมที่มี prefix)
  const candidates = raw.filter(c => {
    const soNorm = normPlate(c.RawPlate);
    if (!soNorm) return false;
    if (soNorm === np) return true;
    if (expandPlates(c.RawPlate).includes(np)) return true;
    return soNorm.includes(np);
  });

  if (candidates.length === 0) return { id: null, status: 'UNMATCHED' };
  if (candidates.length === 1) return { id: candidates[0].id, status: 'MATCHED' };
  
  // We have MULTI. Apply Scoring.
  let truckDate = String(r.DateOut || r.DateIn || '');
  const truckWeight = Number(r.WeightNet) / 1000;
  
  // Fetch truck products if needed
  let truckProducts = [];
  if (r.OneNum) {
     const p = await tsQuery(`SELECT pd_pro_name AS GoodName FROM tblproduct_detail WHERE one_num = ?`, [r.OneNum]);
     truckProducts = p.map(x => String(x.GoodName || '').trim().toLowerCase());
  }

  candidates.forEach(c => {
    let score = 50; // base plate match
    
    // Date Match
    let cDate = '';
    if (c.RefDate) {
      if (c.RefDate instanceof Date) cDate = c.RefDate.toISOString().substring(0, 10);
      else cDate = String(c.RefDate).substring(0, 10);
    }
    
    if (cDate && truckDate) {
      const tParts = truckDate.match(/\d{2,4}/g) || [];
      const cParts = cDate.match(/\d{2,4}/g) || [];
      const overlap = tParts.filter(p => cParts.includes(p));
      if (overlap.length >= 2) score += 30; // matched day and month
      else if (overlap.length === 1) score += 10;
    }
    
    // Weight Match
    if (c.TotalQtyTon > 0 && truckWeight > 0) {
      const diff = Math.abs(Number(c.TotalQtyTon) - truckWeight);
      if (diff <= 0.5) score += 40;
      else if (diff <= 1.5) score += 20;
    }
    
    // Customer Match
    if (r.CustName && c.CustName) {
      const tName = String(r.CustName).trim().split(/\s+/)[0];
      const cName = String(c.CustName).trim();
      if (cName.includes(tName)) score += 10;
    }
    
    c.score = score;
  });
  
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  const sec = candidates[1];
  
  // If top candidate is significantly better
  if (top.score >= 80 && (top.score - sec.score) >= 20) {
    return { id: top.id, status: 'MATCHED' };
  }
  
  return { id: null, status: 'MULTI' };
}

async function upsertRow(r) {
  const completed = Number(r.WeightOut) > 0;
  let matchedSoId = null, matchStatus = null;
  if (completed) {
    const m = await matchSo(r);
    matchedSoId = m.id; matchStatus = m.status;
  }
  await wfQuery(`
    MERGE wf.WeighInbox AS t USING (SELECT @seq AS Sequence) AS s ON t.Sequence = s.Sequence
    WHEN MATCHED THEN UPDATE SET Sid=@sid, Movebill=@mb, Plate=@pl, CustName=@cn,
      WeightIn=@wi, WeightOut=@wo, WeightNet=@wn, DateIn=@di, DateOut=@dout, ScaleNo=@sc,
      Status=@st, MatchedSoId=COALESCE(@mso, MatchedSoId), MatchStatus=COALESCE(@ms, MatchStatus), UpdatedAt=GETUTCDATE()
    WHEN NOT MATCHED THEN INSERT (Sequence, Sid, Movebill, Plate, CustName, WeightIn, WeightOut, WeightNet, DateIn, DateOut, ScaleNo, Status, MatchedSoId, MatchStatus)
      VALUES (@seq, @sid, @mb, @pl, @cn, @wi, @wo, @wn, @di, @dout, @sc, @st, @mso, @ms);`,
    {
      seq: { type: sql.NVarChar(50), value: String(r.Sequence) },
      sid: { type: sql.BigInt, value: Number(r.Sid) || 0 },
      mb:  { type: sql.NVarChar(50), value: r.Movebill != null ? String(r.Movebill) : null },
      pl:  { type: sql.NVarChar(50), value: r.Plate || null },
      cn:  { type: sql.NVarChar(200), value: r.CustName || null },
      wi:  { type: sql.Decimal(18, 2), value: r.WeightIn != null ? Number(r.WeightIn) : null },
      wo:  { type: sql.Decimal(18, 2), value: r.WeightOut != null ? Number(r.WeightOut) : null },
      wn:  { type: sql.Decimal(18, 2), value: r.WeightNet != null ? Number(r.WeightNet) : null },
      di:  { type: sql.NVarChar(30), value: r.DateIn != null ? String(r.DateIn) : null },
      dout:{ type: sql.NVarChar(30), value: r.DateOut != null ? String(r.DateOut) : null },
      sc:  { type: sql.NVarChar(20), value: r.ScaleNo != null ? String(r.ScaleNo) : null },
      st:  { type: sql.NVarChar(20), value: completed ? 'COMPLETED' : 'OPEN' },
      mso: { type: sql.NVarChar(50), value: matchedSoId },
      ms:  { type: sql.NVarChar(20), value: matchStatus },
    });
}

async function syncOnce() {
  if (!getPool()) return { skipped: 'mysql-not-configured' };
  try {
    const wm = (await wfQuery(`SELECT LastSid FROM wf.TruckScaleSync WHERE Id=1`)).recordset[0] || { LastSid: 0 };
    const lastSid = Number(wm.LastSid) || 0;

    const newRows = await tsQuery(`SELECT ${COLS} FROM tblscale WHERE s_id > ? ORDER BY s_id ASC LIMIT 500`, [lastSid]);

    // refresh รายการที่ยัง OPEN (รอชั่งออก) — จับการอัปเดต weight_out
    const openSeqs = (await wfQuery(`SELECT TOP 500 Sequence FROM wf.WeighInbox WHERE Status='OPEN'`)).recordset.map(r => r.Sequence);
    let refreshRows = [];
    if (openSeqs.length) {
      const ph = openSeqs.map(() => '?').join(',');
      refreshRows = await tsQuery(`SELECT ${COLS} FROM tblscale WHERE sequence IN (${ph})`, openSeqs);
    }

    let maxSid = lastSid;
    for (const r of newRows) if (Number(r.Sid) > maxSid) maxSid = Number(r.Sid);

    const seen = new Set();
    for (const r of [...newRows, ...refreshRows]) {
      if (seen.has(String(r.Sequence))) continue;
      seen.add(String(r.Sequence));
      await upsertRow(r);
    }

    await wfQuery(`UPDATE wf.TruckScaleSync SET LastSid=@m, LastSyncAt=GETUTCDATE(), TotalIngested=TotalIngested+@n, LastError=NULL WHERE Id=1`,
      { m: { type: sql.BigInt, value: maxSid }, n: { type: sql.Int, value: newRows.length } });

    if (newRows.length || refreshRows.length) {
      try { require('./socket').broadcast('weigh_inbox', { ingested: newRows.length, refreshed: refreshRows.length }); } catch { /* socket optional */ }
    }
    return { ingested: newRows.length, refreshed: refreshRows.length, lastSid: maxSid };
  } catch (e) {
    console.error('[ts-sync]', e.message);
    try { await wfQuery(`UPDATE wf.TruckScaleSync SET LastError=@e, LastSyncAt=GETUTCDATE() WHERE Id=1`, { e: { type: sql.NVarChar(1000), value: (e.message || '').slice(0, 1000) } }); } catch { /* ignore */ }
    return { error: e.message };
  }
}

function startSync() {
  if (!getPool()) { console.log('[ts-sync] MySQL not configured — sync disabled'); return; }
  const everyMs = Number(process.env.TS_SYNC_INTERVAL_MS) || 60000;   // default 60s
  const t = setInterval(() => { syncOnce().catch(() => {}); }, everyMs);
  t.unref();
  console.log(`[ts-sync] worker started (poll ${everyMs}ms)`);
}

module.exports = { syncOnce, startSync, matchSo, upsertRow, expandPlates, normPlate };
