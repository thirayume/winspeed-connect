'use strict';
/**
 * Accounting view of WinSpeed bookings (103): the trip, the scale and the documents that followed each booking.
 *
 * Review of 18 Nov 2026: the first version of this page joined the documents the wrong way (a 104 by SODT.RefSOID,
 * a 116 and a 107 straight to the booking), read columns and a table that do not exist (WGHD.ScaleNo, SODT.NetAmnt,
 * wf.AuditTrail), had no role check on the detail and scanned WFCoupon once per row. The links here are the ones
 * services/document-stage.js and accounting's answers of 12 Nov 2026 use:
 *   103 booking  → 104 sales order:  104.RefNo = the booking's AI number (or its own number), same customer and branch
 *   104          → tickets:          WFCoupon.DocuID = 104 SOID (Docutype 104)
 *   tickets      → 116 ticket cut:   WFRedemtionDT.CouponID, header DocuType 116
 *   104          → 107 delivery note: SOInvDT.RefID = 104 SOID (the one index WinSpeed has here)
 * Each step is one short query over the page's ids, never one per row. Read-only.
 */

const CHUNK = 200;
const MAX_RANGE_DAYS = 93;
const MAX_ROWS = 1000;

const chunks = (list, size = CHUNK) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const intList = (sql, prefix, ids) => ({
  names: ids.map((_, i) => `@${prefix}${i}`).join(','),
  inputs: Object.fromEntries(ids.map((id, i) => [`${prefix}${i}`, { type: sql.Int, value: id }])),
});
const ids = list => [...new Set((list || []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0))];
const later = (a, b) => (!a ? b : !b ? a : (String(b.date || '') > String(a.date || '') || (String(b.date || '') === String(a.date || '') && b.id > a.id)) ? b : a);
const day = v => (v ? new Date(v).toISOString().slice(0, 10) : null);

/** Map booking SOID → the documents that followed it. */
async function loadDocumentChain(query, sql, bookingIds) {
  const result = new Map();
  const bookings = ids(bookingIds);
  if (!bookings.length) return result;
  const orderOwner = new Map();      // 104 SOID → booking SOID
  const chain = id => {
    if (!result.has(id)) result.set(id, { delivery: null, deliveryCount: 0, cut: null, invoice: null });
    return result.get(id);
  };

  for (const part of chunks(bookings)) {
    const b = intList(sql, 'acB', part);
    const rows = (await query(`
      SELECT b.SOID AS BookingId, d.SOID, RTRIM(d.DocuNo) AS DocuNo, d.DocuDate
      FROM dbo.SOHD b WITH (NOLOCK)
      JOIN dbo.SOHD d WITH (NOLOCK) ON d.DocuType = 104 AND ISNULL(d.DocuStatus, '') <> 'C'
        AND d.RefNo = COALESCE(NULLIF(RTRIM(b.AppvDocuNo), ''), b.DocuNo)
        AND d.CustID = b.CustID AND d.BrchID = b.BrchID
      WHERE b.SOID IN (${b.names}) AND b.DocuType = 103`, b.inputs)).recordset || [];
    for (const r of rows) {
      const c = chain(Number(r.BookingId));
      c.deliveryCount += 1;
      c.delivery = later(c.delivery, { id: Number(r.SOID), no: r.DocuNo, date: day(r.DocuDate) });
      orderOwner.set(Number(r.SOID), Number(r.BookingId));
    }
  }
  const orders = [...orderOwner.keys()];
  if (!orders.length) return result;

  for (const part of chunks(orders)) {
    const o = intList(sql, 'acO', part);
    const invoices = (await query(`
      SELECT i.RefID, ih.SOInvID, RTRIM(ih.DocuNo) AS DocuNo, ih.DocuDate, RTRIM(ISNULL(ih.PostGL, '')) AS PostGL, ih.NetAmnt
      FROM dbo.SOInvDT i WITH (NOLOCK)
      JOIN dbo.SOInvHD ih WITH (NOLOCK) ON ih.SOInvID = i.SOInvID
      WHERE i.RefID IN (${o.names}) AND i.DocuType = 107 AND ih.DocuType = 107 AND ISNULL(ih.DocuStatus, '') <> 'C'`, o.inputs)).recordset || [];
    for (const r of invoices) {
      const c = chain(orderOwner.get(Number(r.RefID)));
      c.invoice = later(c.invoice, { id: Number(r.SOInvID), no: r.DocuNo, date: day(r.DocuDate), postGL: r.PostGL || null, net: r.NetAmnt == null ? null : Number(r.NetAmnt) });
    }
    const coupons = (await query(`
      SELECT c.CouponID, c.DocuID FROM dbo.WFCoupon c WITH (NOLOCK)
      WHERE c.Docutype = 104 AND c.DocuID IN (${o.names})`, o.inputs)).recordset || [];
    const couponOwner = new Map(coupons.map(r => [Number(r.CouponID), orderOwner.get(Number(r.DocuID))]));
    for (const cpart of chunks(ids([...couponOwner.keys()]), 500)) {
      const c = intList(sql, 'acC', cpart);
      const cuts = (await query(`
        SELECT rd.CouponID, rh.RedemtionID, RTRIM(rh.DocuNo) AS DocuNo, rh.DocuDate
        FROM dbo.WFRedemtionDT rd WITH (NOLOCK)
        JOIN dbo.WFRedemtionHD rh WITH (NOLOCK) ON rh.RedemtionID = rd.RedemtionID
        WHERE rd.CouponID BETWEEN @acLow AND @acHigh AND rd.CouponID IN (${c.names})
          AND rh.DocuType = 116 AND ISNULL(rh.DocuStatus, '') <> 'C'`, {
        ...c.inputs,
        acLow: { type: sql.Int, value: Math.min(...cpart) },
        acHigh: { type: sql.Int, value: Math.max(...cpart) },
      })).recordset || [];
      for (const r of cuts) {
        const owner = couponOwner.get(Number(r.CouponID));
        if (!owner) continue;
        const ch = chain(owner);
        ch.cut = later(ch.cut, { id: Number(r.RedemtionID), no: r.DocuNo, date: day(r.DocuDate) });
      }
    }
  }
  return result;
}

/** Latest scale ticket per booking (dbo.WGHD, WGType SO, SPID = booking SOID). */
async function loadScale(query, sql, bookingIds) {
  const out = new Map();
  for (const part of chunks(ids(bookingIds))) {
    const b = intList(sql, 'acS', part);
    const rows = (await query(`
      SELECT w.SPID, w.Id, RTRIM(w.MoveBill) AS MoveBill, RTRIM(w.CarNo) AS CarNo, w.WeightIn, w.WeightOut, w.WeightNet,
             RTRIM(w.Status) AS Status, w.DateIn, w.DateOut
      FROM dbo.WGHD w WITH (NOLOCK)
      WHERE w.WGType = 'SO' AND w.SPID IN (${b.names})`, b.inputs)).recordset || [];
    for (const r of rows) {
      const cur = out.get(Number(r.SPID));
      if (!cur || Number(r.Id) > Number(cur.Id)) out.set(Number(r.SPID), r);
    }
  }
  return out;
}

const stamp = v => {
  if (!v) return { date: null, time: null };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { date: null, time: null };
  // WinSpeed stores Bangkok wall time in DATETIME; node-mssql reads it as UTC, so print it back as UTC.
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 19) };
};

/** Validated date range for the list, or an error with status 400. */
function readRange(q, today, businessDate) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const start = String(q.startDate || q.date || today);
  const end = String(q.endDate || q.date || start);
  const bad = message => Object.assign(new Error(message), { status: 400 });
  if (!iso.test(start) || !iso.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) throw bad('วันที่ไม่ถูกต้อง');
  if (start > end) throw bad('วันเริ่มต้องไม่หลังวันสิ้นสุด');
  if ((Date.parse(end) - Date.parse(start)) / 86400000 > MAX_RANGE_DAYS) throw bad(`เลือกช่วงวันที่ได้ไม่เกิน ${MAX_RANGE_DAYS} วัน`);
  return { start: start < businessDate ? businessDate : start, end };
}

/** Bookings dated in the range, with trip, scale and the documents that followed. */
async function listBills(query, sql, { start, end, businessDate }) {
  const rows = (await query(`
    SELECT TOP ${MAX_ROWS}
           hd.SOID AS Id, hd.SOID, RTRIM(hd.DocuNo) AS WfRef, RTRIM(cu.CustCode) AS CustCode, RTRIM(hd.CustName) AS CustName,
           CONVERT(VARCHAR(10), hd.DocuDate, 120) AS DocuDate, RTRIM(ISNULL(hd.DocuStatus, '')) AS DocuStatus,
           CAST(ISNULL(l.TotalTon, 0) AS DECIMAL(12,2)) AS TotalTon, ISNULL(l.LineCount, 0) AS LineCount,
           RTRIM(hd.TransRegistration) AS TruckPlate,
           t.TripId, RTRIM(t.TripCode) AS TripCode, RTRIM(t.DriverName) AS DriverName, RTRIM(t.TransRegistration) AS TripPlate,
           CONVERT(VARCHAR(10), t.PickupDueDate, 120) AS TripDate, t.Status AS TripStatus,
           RTRIM(emp.EmpCode) AS SalesEmpCode, RTRIM(emp.EmpName) AS SalesEmpName
    FROM dbo.SOHD hd WITH (NOLOCK)
    LEFT JOIN dbo.EMCust cu WITH (NOLOCK) ON cu.CustID = hd.CustID
    LEFT JOIN dbo.EMEmp emp WITH (NOLOCK) ON emp.EmpID = hd.EmpID
    LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON ext.SOID = CONVERT(VARCHAR(50), hd.SOID)
    LEFT JOIN wf.SalesTrip t WITH (NOLOCK) ON t.TripId = ext.TripId
    OUTER APPLY (SELECT SUM(dt.GoodQty2) AS TotalTon, COUNT(*) AS LineCount FROM dbo.SODT dt WITH (NOLOCK) WHERE dt.SOID = hd.SOID) l
    WHERE hd.DocuType = 103 AND hd.DocuDate >= @acStart AND hd.DocuDate < DATEADD(DAY, 1, @acEnd)
      AND hd.DocuDate >= @acWindow
    ORDER BY hd.DocuDate DESC, hd.SOID DESC`, {
    acStart: { type: sql.Date, value: start },
    acEnd: { type: sql.Date, value: end },
    acWindow: { type: sql.Date, value: businessDate },
  })).recordset || [];
  const bookingIds = rows.map(r => r.SOID);
  const [chain, scale] = await Promise.all([loadDocumentChain(query, sql, bookingIds), loadScale(query, sql, bookingIds)]);
  for (const r of rows) {
    const c = chain.get(Number(r.SOID)) || {};
    const s = scale.get(Number(r.SOID));
    Object.assign(r, {
      MoveBill: s?.MoveBill || null, WeightIn: s?.WeightIn ?? null, WeightOut: s?.WeightOut ?? null, WeightNet: s?.WeightNet ?? null,
      ScaleStatus: s?.Status || null, ScaleDateOut: s?.DateOut ? `${stamp(s.DateOut).date} ${stamp(s.DateOut).time.slice(0, 5)}` : null,
      Delivery104No: c.delivery?.no || null, Delivery104Date: c.delivery?.date || null, Delivery104Count: c.deliveryCount || 0,
      Slip116No: c.cut?.no || null, Slip116Date: c.cut?.date || null,
      Invoice107No: c.invoice?.no || null, Invoice107Date: c.invoice?.date || null,
      PostGL: c.invoice?.postGL || null, InvoiceNetAmnt: c.invoice?.net ?? null,
    });
  }
  return { rows, truncated: rows.length >= MAX_ROWS };
}

/** One booking in full for the accounting detail window, or null when it is not a booking in the data window. */
async function billDetail(query, sql, soid, businessDate) {
  const head = ((await query(`
    SELECT hd.SOID, RTRIM(hd.DocuNo) AS BookingNo, CONVERT(VARCHAR(10), hd.DocuDate, 120) AS BookingDate,
           RTRIM(ISNULL(hd.DocuStatus, '')) AS DocuStatus, hd.CustID, RTRIM(cu.CustCode) AS CustCode, RTRIM(hd.CustName) AS CustName,
           RTRIM(hd.TransRegistration) AS TruckPlate, RTRIM(hd.ContactName) AS ContactName, RTRIM(hd.Remark) AS Remark,
           RTRIM(emp.EmpCode) AS SalesEmpCode, RTRIM(emp.EmpName) AS SalesEmpName, su.DisplayName AS SalesUserName,
           t.TripId, RTRIM(t.TripCode) AS TripCode, RTRIM(t.TransRegistration) AS TripPlate, RTRIM(t.DriverName) AS DriverName,
           RTRIM(t.TripRemark) AS TripRemark, CONVERT(VARCHAR(10), t.PickupDueDate, 120) AS TripDate, t.Status AS TripStatus,
           ext.SourceDraftId
    FROM dbo.SOHD hd WITH (NOLOCK)
    LEFT JOIN dbo.EMCust cu WITH (NOLOCK) ON cu.CustID = hd.CustID
    LEFT JOIN dbo.EMEmp emp WITH (NOLOCK) ON emp.EmpID = hd.EmpID
    LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON ext.SOID = CONVERT(VARCHAR(50), hd.SOID)
    LEFT JOIN wf.AppUser su WITH (NOLOCK) ON su.Id = ext.SalesUserId
    LEFT JOIN wf.SalesTrip t WITH (NOLOCK) ON t.TripId = ext.TripId
    WHERE hd.SOID = @acId AND hd.DocuType = 103 AND hd.DocuDate >= @acWindow`, {
    acId: { type: sql.Int, value: soid },
    acWindow: { type: sql.Date, value: businessDate },
  })).recordset || [])[0];
  if (!head) return null;

  const items = ((await query(`
    SELECT dt.ListNo, dt.GoodID, RTRIM(g.GoodCode) AS GoodCode, RTRIM(COALESCE(g.GoodName1, dt.GoodName)) AS GoodName,
           dt.GoodQty1 AS BagQty, dt.GoodQty2 AS TonQty, dt.GoodPrice2 AS PricePerTon, dt.GoodAmnt AS Amount,
           dt.GoodAmnt - ISNULL(dt.GoodDiscAmnt, 0) AS NetAmnt, RTRIM(ISNULL(dt.FreeFlag, 'N')) AS FreeFlag
    FROM dbo.SODT dt WITH (NOLOCK)
    LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.GoodID
    WHERE dt.SOID = @acId
    ORDER BY dt.ListNo`, { acId: { type: sql.Int, value: soid } })).recordset || []);

  const soKeys = [String(soid), head.SourceDraftId != null ? String(head.SourceDraftId) : null].filter(Boolean);
  const giveaways = ((await query(`
    SELECT w.Id, w.GoodId, COALESCE(RTRIM(g.GoodCode), w.GoodCode) AS GoodCode, COALESCE(RTRIM(g.GoodName1), w.GoodName, w.ItemName) AS GoodName,
           w.Brand, w.Qty, ISNULL(RTRIM(u.GoodUnitName), N'ชิ้น') AS Unit
    FROM wf.GiveawayWithdrawal w WITH (NOLOCK)
    LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON CAST(g.GoodID AS VARCHAR(50)) = w.GoodId
    LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = g.MainGoodUnitID
    WHERE w.SoId IN (${soKeys.map((_, i) => `@acSo${i}`).join(',')})
    ORDER BY w.Id`, Object.fromEntries(soKeys.map((k, i) => [`acSo${i}`, { type: sql.VarChar(50), value: k }])))).recordset || []);

  const scaleRow = (await loadScale(query, sql, [soid])).get(soid);
  const inAt = stamp(scaleRow?.DateIn), outAt = stamp(scaleRow?.DateOut);
  const scale = scaleRow ? {
    Id: scaleRow.Id, MoveBill: scaleRow.MoveBill, ScaleNo: null, TruckPlate: scaleRow.CarNo,
    WeightIn: scaleRow.WeightIn, WeightOut: scaleRow.WeightOut, WeightNet: scaleRow.WeightNet, Status: scaleRow.Status,
    DateIn: inAt.date, TimeIn: inAt.time, DateOut: outAt.date, TimeOut: outAt.time,
  } : null;

  const c = (await loadDocumentChain(query, sql, [soid])).get(soid) || {};
  const show = (d, extra = '') => (d ? `${d.no} (${d.date || '-'}${extra})` : undefined);
  const trace = {
    Doc104: c.delivery ? show(c.delivery, c.deliveryCount > 1 ? ` · ทั้งหมด ${c.deliveryCount} ใบ` : '') : undefined,
    Doc116: show(c.cut),
    Doc107: c.invoice ? show(c.invoice, ` · เล่ม ${String(c.invoice.no || '').charAt(0)} · GL ${c.invoice.postGL || '-'}`) : undefined,
  };

  const audit = head.SourceDraftId == null ? [] : ((await query(`
    SELECT a.Id, a.Action,
           -- SQL Server 2008: no CONCAT
           ISNULL(CONVERT(NVARCHAR(30), a.FromStatus), N'-') + N' → ' + ISNULL(CONVERT(NVARCHAR(30), a.ToStatus), N'-')
             + CASE WHEN a.Note IS NULL THEN N'' ELSE N' · ' + CONVERT(NVARCHAR(500), a.Note) END AS Detail,
           u.DisplayName AS ActorName, CONVERT(VARCHAR(19), DATEADD(HOUR, 7, a.CreatedAt), 120) AS CreatedAt
    FROM wf.SalesOrderAudit a WITH (NOLOCK)
    LEFT JOIN wf.AppUser u WITH (NOLOCK) ON u.Id = COALESCE(a.ActorUserId, a.UserId)
    WHERE a.SoId = @acDraft
    ORDER BY a.Id DESC`, { acDraft: { type: sql.Int, value: Number(head.SourceDraftId) } })).recordset || []);

  delete head.SourceDraftId;
  return { header: head, items, giveaways, scale, trace, audit };
}

module.exports = { loadDocumentChain, loadScale, listBills, billDetail, readRange, MAX_RANGE_DAYS, MAX_ROWS };
