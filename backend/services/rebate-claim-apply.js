/**
 * backend/services/rebate-claim-apply.js
 *
 * Core service for applying approved rebate claims to draft sales orders (R9-1, R10-2, R10.1-1, R10.1-2)
 * and advancing claim status to CN_ISSUED at confirmation time.
 *
 * Rules:
 * - Scope: wf tables only (wf.SalesOrder, wf.SalesOrderLine, wf.RebateClaim).
 * - wf.RebateClaim does NOT have an UpdatedAt column (schema-contract requirement).
 * - Accepts queryFn: async (sqlText, params) => { recordset, rowsAffected } or a mssql Transaction/Request.
 */

const { sql } = require('../db');

/**
 * Normalizes tx or queryFn into a standard query executor:
 * queryExecutor(sqlText, params) => Promise<{ recordset: any[], rowsAffected: number[] }>
 */
function toQueryExecutor(queryFnOrTx) {
  if (typeof queryFnOrTx === 'function') {
    return queryFnOrTx;
  }
  if (queryFnOrTx && typeof queryFnOrTx.request === 'function') {
    return async (queryText, params = {}) => {
      const req = queryFnOrTx.request();
      for (const [k, v] of Object.entries(params)) {
        if (v && typeof v === 'object' && v.type) {
          req.input(k, v.type, v.value);
        } else {
          req.input(k, v);
        }
      }
      return req.query(queryText);
    };
  }
  throw new Error('Invalid queryFn or Transaction provided to rebate-claim-apply service');
}

/**
 * Apply approved rebate claim as a discount to a draft Sales Order
 * @param {Function|object} queryFnOrTx - Database query function or mssql transaction
 * @param {object} params
 * @param {number} params.claimId - ID of wf.RebateClaim
 * @param {number|string} [params.soId] - ID or document number of wf.SalesOrder (draft)
 * @param {number|string} [params.targetSoId] - Target SO ID or doc number from UI
 * @param {object} [params.user] - Requesting user
 */
async function applyClaimToDraft(queryFnOrTx, { claimId, soId, targetSoId, user = {} }) {
  const query = toQueryExecutor(queryFnOrTx);

  const cleanClaimId = Number(claimId);
  if (!cleanClaimId || !Number.isInteger(cleanClaimId) || cleanClaimId <= 0) {
    throw Object.assign(new Error('รหัสเคลมไม่ถูกต้อง'), { status: 400 });
  }

  const rawKey = String(soId ?? targetSoId ?? '').trim();
  if (!rawKey) {
    throw Object.assign(new Error('กรุณาระบุรหัสใบสั่งขายร่างหรือเลขที่เอกสาร'), { status: 400 });
  }

  // 1. Fetch claim with lock
  const claimR = await query(
    `SELECT * FROM wf.RebateClaim WITH (UPDLOCK, ROWLOCK) WHERE Id = @claimId`,
    { claimId: { type: sql.Int, value: cleanClaimId } }
  );

  const claim = claimR.recordset?.[0];
  if (!claim) {
    throw Object.assign(new Error(`ไม่พบใบขอเคลียร์รีเบท ID ${cleanClaimId}`), { status: 404 });
  }

  // R9-1: Must be APPROVED before applying
  if (claim.Status !== 'APPROVED') {
    throw Object.assign(new Error(`ใบขอเคลียร์รีเบทต้องได้รับการอนุมัติ (APPROVED) ก่อนนำไปหักลดในบิล (สถานะปัจจุบัน: ${claim.Status})`), { status: 400 });
  }

  if (claim.AppliedDraftSoId) {
    throw Object.assign(new Error(`ใบขอเคลียร์นี้ถูกนำไปผูกกับบิลร่าง #${claim.AppliedDraftSoId} อยู่แล้ว`), { status: 400 });
  }

  // R10-3: Apply customer's share CustomerAmount (fallback to ClaimAmt only if CustomerAmount is null and no split)
  const discountAmt = Number(claim.CustomerAmount != null ? claim.CustomerAmount : (claim.ClaimAmt || 0));
  if (discountAmt <= 0) {
    throw Object.assign(new Error(`ยอดเงินรีเบทในเคลมไม่ถูกต้อง (${discountAmt})`), { status: 400 });
  }

  // 2. Fetch target draft SO only (R10-4: Draft bills only) - resolve by Id or document number
  let targetDraft = null;
  if (/^\d+$/.test(rawKey)) {
    const dR = await query(
      `SELECT * FROM wf.SalesOrder WITH (UPDLOCK, ROWLOCK) WHERE Id = @id`,
      { id: { type: sql.Int, value: Number(rawKey) } }
    );
    targetDraft = dR.recordset?.[0];
  }

  if (!targetDraft) {
    const dR = await query(
      `SELECT * FROM wf.SalesOrder WITH (UPDLOCK, ROWLOCK)
       WHERE WfRef = @ref OR ImportedDocuNo = @ref OR WfRef LIKE '%' + @ref`,
      { ref: { type: sql.NVarChar(50), value: rawKey } }
    );
    targetDraft = dR.recordset?.[0];
  }

  if (!targetDraft) {
    throw Object.assign(new Error(`ไม่พบใบสั่งขายร่าง SO '${rawKey}'`), { status: 404 });
  }

  const cleanSoId = targetDraft.Id;

  if (targetDraft.Status !== 'DRAFT') {
    throw Object.assign(new Error(`สามารถผูกรีเบทเข้าใบสั่งขายสถานะ DRAFT เท่านั้น (สถานะปัจจุบัน: ${targetDraft.Status})`), { status: 400 });
  }

  // Customer match check
  const orderCustId = String(targetDraft.CustId || '').trim();
  const claimCustId = String(claim.CustId || '').trim();
  if (orderCustId && claimCustId && orderCustId !== claimCustId) {
    throw Object.assign(new Error(`ลูกค้าในใบสั่งขาย (${orderCustId}) ไม่ตรงกับลูกค้าในใบขอเคลม (${claimCustId})`), { status: 400 });
  }

  // R9-1: Check if total discount exceeds bill subtotal
  const linesR = await query(
    `SELECT QtyTon, PricePerTon, IsGiveaway FROM wf.SalesOrderLine WHERE SoId = @soId`,
    { soId: { type: sql.Int, value: targetDraft.Id } }
  );
  const subtotal = (linesR.recordset || []).reduce(
    (sum, l) => sum + (l.IsGiveaway ? 0 : Number(l.QtyTon || 0) * Number(l.PricePerTon || 0)),
    0
  );
  const currentDiscount = Number(targetDraft.RebateDiscountAmt || 0);
  if (currentDiscount + discountAmt > subtotal) {
    throw Object.assign(new Error(`ยอดส่วนลดรวม (฿${(currentDiscount + discountAmt).toLocaleString()}) เกินมูลค่าสินค้าในบิล (฿${subtotal.toLocaleString()})`), {
      status: 400,
      code: 'TOTAL_DISCOUNT_EXCEEDS_SUBTOTAL'
    });
  }

  // R10-2: Verify Migration 141 columns exist; fail closed with 409 if missing
  const has141SoCol = (await query(`
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.SalesOrder') AND name = 'AppliedRebateClaimId'
  `)).recordset?.length > 0;
  const has141ClaimCol = (await query(`
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.RebateClaim') AND name = 'AppliedDraftSoId'
  `)).recordset?.length > 0;

  if (!has141SoCol || !has141ClaimCol) {
    throw Object.assign(new Error('ระบบยังไม่ได้ติดตั้ง Migration 141 (AppliedRebateClaimId / AppliedDraftSoId) สำหรับผูกเคลมรีเบทเข้าบิล'), {
      status: 409,
      code: 'MIGRATION_141_REQUIRED'
    });
  }

  const claimNo = claim.ClaimNo || claim.CnDocuNo || `RC-${claim.Id}`;
  const remarkAnnotation = `[หักลด Rebate Claim #${claim.Id} ฿${discountAmt.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}]`;

  // Update wf.SalesOrder (SalesOrder has UpdatedAt)
  await query(`
    UPDATE wf.SalesOrder
    SET RebateDiscountAmt = ISNULL(RebateDiscountAmt, 0) + @discount,
        ClaimDiscountAmt = ISNULL(ClaimDiscountAmt, 0) + @discount,
        AppliedRebateClaimId = @claimId,
        BillRemark = RTRIM(ISNULL(BillRemark + ' ', '') + @annotation),
        UpdatedAt = GETUTCDATE()
    WHERE Id = @id
  `, {
    id: { type: sql.Int, value: targetDraft.Id },
    discount: { type: sql.Decimal(12, 2), value: discountAmt },
    claimId: { type: sql.Int, value: cleanClaimId },
    annotation: { type: sql.NVarChar(500), value: remarkAnnotation }
  });

  // Update wf.RebateClaim (NOTE: wf.RebateClaim has NO UpdatedAt column!)
  const appliedNote = `ผูกเข้าบิล SO #${cleanSoId} จำนวน ฿${discountAmt.toFixed(2)}`;
  await query(`
    UPDATE wf.RebateClaim
    SET AppliedDraftSoId = @soId,
        Note = RTRIM(ISNULL(Note + ' ', '') + @note)
    WHERE Id = @claimId
  `, {
    claimId: { type: sql.Int, value: cleanClaimId },
    soId: { type: sql.Int, value: targetDraft.Id },
    note: { type: sql.NVarChar(255), value: appliedNote }
  });

  return {
    claimId: cleanClaimId,
    claimNo,
    soId: cleanSoId,
    discountApplied: discountAmt,
    status: 'APPROVED',
    appliedDraftSoId: cleanSoId
  };
}

/**
 * Advances applied rebate claim to CN_ISSUED status upon SO confirmation (R10-2, R10.1-1, R10.1-2)
 * Fails closed with 409 if 0 rows matched (claim mismatch or not APPROVED).
 * @param {Function|object} queryFnOrTx - Database query function or mssql transaction
 * @param {object} params
 * @param {number} params.claimId - ID of wf.RebateClaim
 * @param {number} params.draftId - ID of wf.SalesOrder (draft being confirmed)
 * @param {string} params.custId - Customer ID
 * @param {string} params.docuNo - Confirmed WinSpeed DocuNo (e.g. I69-04233)
 * @param {number|string} [params.soid] - Native WinSpeed SOID (recorded in Note)
 */
async function advanceAppliedClaimAtConfirm(queryFnOrTx, { claimId, draftId, custId, docuNo, soid }) {
  const query = toQueryExecutor(queryFnOrTx);
  const cleanClaimId = Number(claimId);
  const cleanDraftId = Number(draftId);
  const cleanCustId = String(custId || '').trim();
  const cleanDocuNo = String(docuNo || '').trim();
  const soidNote = soid ? `[SOID: ${soid}]` : null;

  if (!cleanClaimId) return;

  const hasDocuNoCol = (await query(`
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.RebateClaim') AND name = 'AppliedSoDocuNo'
  `)).recordset?.length > 0;

  // L-3: On CN_ISSUED set RemainingAmt = 0, store docuNo in AppliedSoDocuNo, and append SOID to Note
  // NOTE: wf.RebateClaim has NO UpdatedAt column!
  const claimUpdateSql = hasDocuNoCol
    ? `UPDATE wf.RebateClaim
       SET Status = 'CN_ISSUED',
           RemainingAmt = 0,
           AppliedSoDocuNo = @docuNo,
           Note = CASE 
                    WHEN @soidNote IS NOT NULL AND CHARINDEX(@soidNote, ISNULL(Note, '')) = 0
                    THEN LTRIM(RTRIM(ISNULL(Note, '') + ' ' + @soidNote))
                    ELSE Note 
                  END
       WHERE Id = @claimId AND AppliedDraftSoId = @draftId AND CustId = @custId AND Status = 'APPROVED'`
    : `UPDATE wf.RebateClaim
       SET Status = 'CN_ISSUED',
           RemainingAmt = 0,
           Note = CASE 
                    WHEN @soidNote IS NOT NULL AND CHARINDEX(@soidNote, ISNULL(Note, '')) = 0
                    THEN LTRIM(RTRIM(ISNULL(Note, '') + ' ' + @soidNote))
                    ELSE Note 
                  END
       WHERE Id = @claimId AND AppliedDraftSoId = @draftId AND CustId = @custId AND Status = 'APPROVED'`;

  const updClaimRes = await query(claimUpdateSql, {
    claimId: { type: sql.Int, value: cleanClaimId },
    draftId: { type: sql.Int, value: cleanDraftId },
    custId: { type: sql.NVarChar(20), value: cleanCustId },
    docuNo: { type: sql.VarChar(50), value: cleanDocuNo },
    soidNote: { type: sql.NVarChar(100), value: soidNote }
  });

  const affected = updClaimRes.rowsAffected ? updClaimRes.rowsAffected[0] : 0;
  if (affected === 0) {
    const err = new Error(`ไม่สามารถเปลี่ยนสถานะเคลม #${cleanClaimId} เป็น CN_ISSUED ได้ (เคลมไม่ได้ผูกกับแบบร่างนี้ หรือสถานะไม่ใช่ APPROVED)`);
    err.status = 409;
    err.code = 'CLAIM_ADVANCE_FAILED';
    throw err;
  }

  return { success: true, claimId: cleanClaimId, status: 'CN_ISSUED' };
}

module.exports = {
  applyClaimToDraft,
  advanceAppliedClaimAtConfirm
};
