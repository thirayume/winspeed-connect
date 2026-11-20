'use strict';
// Owner, 20 Nov 2026 (accounting answer 01-2): a 107 posted to the wrong book or date is deleted in WinSpeed and
// posted again. WinSpeed stays the source: Sale-App never blocks or reverses that. This job keeps the 107 that
// Sale-App remembers for a ticket cut (wf.CouponRedemptionMirror, mirror of dbo.WFRedemtionDT.SOInvID) equal to
// WinSpeed's, and records each change as an INVOICE_107_REPLACED rule incident so it can be traced afterwards.
// Bill stages read WinSpeed live (services/document-stage.js) and need nothing here.
const { sql, wfQuery } = require('../db');

const FOLLOW_SQL = `
  SELECT m.RedemtionID, m.CouponID, m.AppliedSOInvID AS OldId, m.AppliedInvoiceNo AS OldNo,
         rd.SOInvID AS NewId, inv.DocuNo AS NewNo,
         CASE WHEN m.AppliedSOInvID IS NULL THEN 0
              WHEN EXISTS (SELECT 1 FROM dbo.SOInvHD o WITH (NOLOCK) WHERE o.SOInvID = m.AppliedSOInvID) THEN 0 ELSE 1 END AS OldGone
  FROM wf.CouponRedemptionMirror m
  JOIN dbo.WFRedemtionDT rd WITH (NOLOCK) ON rd.RedemtionID = m.RedemtionID AND rd.CouponID = m.CouponID
  LEFT JOIN dbo.SOInvHD inv WITH (NOLOCK) ON inv.SOInvID = NULLIF(rd.SOInvID, 0)
  WHERE ISNULL(m.AppliedSOInvID, 0) <> ISNULL(NULLIF(rd.SOInvID, 0), 0)`;

/** Follows WinSpeed's 107 for every remembered ticket cut; returns what changed. */
async function followInvoices({ query = wfQuery, recordIncident = require('./rule-incidents').recordIncident } = {}) {
  const rows = (await query(FOLLOW_SQL)).recordset || [];
  const changed = [];
  for (const r of rows) {
    const newId = Number(r.NewId) > 0 ? Number(r.NewId) : null;
    await query(`UPDATE wf.CouponRedemptionMirror SET AppliedSOInvID = @newId, AppliedInvoiceNo = @newNo
      WHERE RedemtionID = @rid AND CouponID = @cid AND ISNULL(AppliedSOInvID, 0) = ISNULL(@oldId, 0)`, {
      newId: { type: sql.Int, value: newId }, newNo: { type: sql.NVarChar(25), value: newId ? r.NewNo : null },
      rid: { type: sql.Int, value: r.RedemtionID }, cid: { type: sql.Int, value: r.CouponID },
      oldId: { type: sql.Int, value: r.OldId == null ? null : Number(r.OldId) },
    });
    if (r.OldId != null && Number(r.OldGone) === 1) {
      await recordIncident({
        key: `INVOICE_107_REPLACED:${r.OldId}:${r.RedemtionID}:${r.CouponID}`, type: 'INVOICE_107_REPLACED',
        docuNo: r.OldNo || null,
        detail: newId
          ? `ใบส่งของ ${r.OldNo || r.OldId} ถูกลบใน WinSpeed และออกใหม่เป็น ${r.NewNo || newId} (ตัดตั๋ว ${r.RedemtionID})`
          : `ใบส่งของ ${r.OldNo || r.OldId} ถูกลบใน WinSpeed ยังไม่ออกใหม่ (ตัดตั๋ว ${r.RedemtionID})`,
      });
    }
    changed.push({ redemtionId: r.RedemtionID, couponId: r.CouponID, from: r.OldNo || r.OldId || null, to: newId ? (r.NewNo || newId) : null });
  }
  return { checked: rows.length, changed };
}

module.exports = { followInvoices, FOLLOW_SQL };
