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
  Date_In AS DateIn, Date_Out AS DateOut, Computer_w AS ScaleNo`;

async function matchSo(plate) {
  if (!plate) return { id: null, status: 'UNMATCHED' };
  const np = String(plate).replace(/\s/g, '');
  if (!np) return { id: null, status: 'UNMATCHED' };
  
  // OPTIMIZED: Query active draft orders directly
  const draftCand = (await wfQuery(
    `SELECT TOP 3 Id FROM wf.SalesOrder
     WHERE Status IN ('DRAFT', 'CONFIRMED', 'PICKING', 'LOADED')
       AND REPLACE(ISNULL(TruckPlate,''),' ','') LIKE @p`,
    { p: { type: sql.NVarChar(80), value: `%${np}%` } })).recordset || [];
    
  if (draftCand.length === 1) return { id: String(draftCand[0].Id), status: 'MATCHED' };
  if (draftCand.length > 1) return { id: null, status: 'MULTI' };
  
  // OPTIMIZED: Query active WINSpeed orders directly (avoid v_AllSalesOrders full scan)
  const hdCand = (await wfQuery(
    `SELECT TOP 3 hd.SOID AS Id FROM dbo.SOHD hd
     LEFT JOIN wf.SalesOrderExt ext ON ext.SOID = hd.SOID
     WHERE hd.DocuStatus NOT IN ('Y', 'C') AND ISNULL(hd.clearflag, 'N') <> 'Y'
       AND REPLACE(ISNULL(hd.TransRegistration,''),' ','') LIKE @p`,
    { p: { type: sql.NVarChar(80), value: `%${np}%` } })).recordset || [];
    
  if (hdCand.length === 1) return { id: String(hdCand[0].Id), status: 'MATCHED' };
  if (hdCand.length > 1) return { id: null, status: 'MULTI' };

  return { id: null, status: 'UNMATCHED' };
}

async function upsertRow(r) {
  const completed = Number(r.WeightOut) > 0;
  let matchedSoId = null, matchStatus = null;
  if (completed) {
    const m = await matchSo(r.Plate);
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

module.exports = { syncOnce, startSync, matchSo, upsertRow };
