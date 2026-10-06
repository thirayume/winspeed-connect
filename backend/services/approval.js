/**
 * approval.js — FR-028 Configurable approval policy engine
 * อ่าน wf.ApprovalPolicy แทน hardcode role · คืน role ที่มีอำนาจอนุมัติตาม case + จำนวนเงิน + วันที่
 */
const { sql, wfQuery } = require('../db');
const { toBangkokDateString } = require('./coupon-settlement-matcher');

async function resolveApprovalPolicy(caseType, amount = null, atDate = null) {
  const r = await wfQuery(`
    SELECT TOP 1 Id, RequiredRole, MinAmount, MaxAmount, Note
    FROM wf.ApprovalPolicy
    WHERE CaseType = @c AND IsActive = 1
      AND EffectiveFrom <= @d AND (EffectiveTo IS NULL OR EffectiveTo >= @d)
      AND (@a IS NULL OR ((MinAmount IS NULL OR @a >= MinAmount) AND (MaxAmount IS NULL OR @a < MaxAmount)))
    ORDER BY ISNULL(MinAmount, 0) DESC`,   // เลือก band ที่เจาะจงสุด (threshold สูงสุดที่เข้าเงื่อนไข)
    {
      c: { type: sql.NVarChar(40),  value: caseType },
      a: { type: sql.Decimal(18, 2), value: amount },
      // policies take effect on Bangkok business dates; a JS Date would be sent as its UTC date, which is the
      // previous day before 07:00 and made a policy effective "today" invisible until then (UAT APV-06)
      d: { type: sql.Date,          value: new Date(toBangkokDateString(atDate || new Date()) + 'T00:00:00Z') },
    });
  return r.recordset[0] || null;
}

module.exports = { resolveApprovalPolicy };
