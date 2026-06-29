/**
 * approval.js — FR-028 Configurable approval policy engine
 * อ่าน wf.ApprovalPolicy แทน hardcode role · คืน role ที่มีอำนาจอนุมัติตาม case + จำนวนเงิน + วันที่
 */
const { sql, wfQuery } = require('../db');

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
      d: { type: sql.Date,          value: atDate || new Date() },
    });
  return r.recordset[0] || null;
}

module.exports = { resolveApprovalPolicy };
