'use strict';

const crypto = require('crypto');
const { sql, query, wfQuery, wfTransaction } = require('../db');
const {
  getBangkokDateString,
  addBangkokCalendarDays,
  diffBangkokCalendarDays,
  isValidDateString,
  normalizeDateString,
} = require('./so-pickup-policy');
const {
  getEffectivePolicySnapshot,
  validateReasonCode,
  logChangeEvent,
} = require('./policy-contract');

/**
 * Resolve ticket expiry policy settings (SO-04).
 * Reads alert lead days (including 0) and expiry strict mode (default false).
 */
async function resolveTicketPolicy(asOfDate = null) {
  let snapshot = null;
  try {
    snapshot = await getEffectivePolicySnapshot('SYSTEM_POLICY', asOfDate);
  } catch (err) {
    if (asOfDate) {
      try {
        snapshot = await getEffectivePolicySnapshot('SYSTEM_POLICY', null);
      } catch (innerErr) {
        // Fall back to default
      }
    }
  }

  const snapJson = snapshot && typeof snapshot.SnapshotJson === 'string'
    ? JSON.parse(snapshot.SnapshotJson)
    : (snapshot?.SnapshotJson || {});

  // Admin alert lead days (can be 0)
  let alertDays = snapJson.CONTROL_TICKET_ALERT_DAYS !== undefined && !isNaN(Number(snapJson.CONTROL_TICKET_ALERT_DAYS))
    ? Math.max(0, parseInt(snapJson.CONTROL_TICKET_ALERT_DAYS, 10))
    : 7;

  // Expiry Strict Mode is independent from Pickup Strict Mode; defaults to false (OFF)
  let strictMode = String(snapJson.CONTROL_TICKET_BLOCK_EXPIRED) === 'true';

  // If resolving for current live operations (asOfDate is null), incorporate authoritative live SystemSetting
  if (!asOfDate) {
    try {
      const rows = await wfQuery(`
        SELECT SettingKey, SettingValue 
        FROM wf.SystemSetting 
        WHERE SettingKey IN ('CONTROL_TICKET_BLOCK_EXPIRED', 'CONTROL_TICKET_ALERT_DAYS')
      `);
      const list = rows.recordset || rows || [];
      for (const r of list) {
        if (r.SettingKey === 'CONTROL_TICKET_BLOCK_EXPIRED') {
          strictMode = String(r.SettingValue).toLowerCase() === 'true';
        } else if (r.SettingKey === 'CONTROL_TICKET_ALERT_DAYS' && !isNaN(Number(r.SettingValue))) {
          alertDays = Math.max(0, parseInt(r.SettingValue, 10));
        }
      }
    } catch (_) {}
  }

  return {
    alertDays,
    strictMode,
    snapshotId: snapshot ? snapshot.SnapshotId : null,
    revisionNumber: snapshot ? snapshot.RevisionNumber : null,
    status: snapshot ? 'ACTIVE' : 'UNAVAILABLE',
  };
}

/**
 * Evaluate ticket expiry status (SO-04).
 * Rules:
 * - If expiryDate is null/empty/invalid -> UNKNOWN (never guess or use ValidDays)
 * - If expiryDate < today -> EXPIRED (blocked only if strictMode=true, warning if false)
 * - If today <= expiryDate <= today + alertDays -> NEAR_EXPIRY (warning, not blocked)
 * - If expiryDate > today + alertDays -> VALID
 */
function evaluateTicketExpiry(expiryDate, asOfDate = null, alertDays = 7, strictMode = false, strictOverride = false) {
  const normExpiry = normalizeDateString(expiryDate, { isWallClock: true });
  if (!normExpiry || !isValidDateString(normExpiry)) {
    return {
      status: 'UNKNOWN',
      expiryDate: null,
      daysRemaining: null,
      isExpired: false,
      isNearExpiry: false,
      blocked: false,
      strictOverride: Boolean(strictOverride),
      label: 'ไม่ระบุวันหมดอายุ',
      provenance: 'EXPLICIT_UNKNOWN',
    };
  }

  const todayStr = getBangkokDateString(asOfDate || new Date());
  const daysRemaining = diffBangkokCalendarDays(normExpiry, todayStr);

  if (daysRemaining < 0) {
    const isBlocked = Boolean(strictMode && !strictOverride);
    let warning = null;
    let error = null;
    if (isBlocked) {
      error = `บล็อกการใช้ตั๋วคุม: ตั๋วหมดอายุแล้วเมื่อ ${normExpiry} (Strict Mode เปิดใช้งาน)`;
    } else if (strictOverride) {
      warning = `ตั๋วคุมหมดอายุแล้วเมื่อ ${normExpiry} แต่ได้รับอนุมัติใช้งานพิเศษ (Strict Override)`;
    } else {
      warning = `ตั๋วคุมหมดอายุแล้วเมื่อ ${normExpiry} (ผ่านไป ${Math.abs(daysRemaining)} วัน)`;
    }

    return {
      status: 'EXPIRED',
      expiryDate: normExpiry,
      daysRemaining,
      isExpired: true,
      isNearExpiry: false,
      blocked: isBlocked,
      strictOverride: Boolean(strictOverride),
      label: 'หมดอายุแล้ว',
      warning,
      error,
      provenance: 'EXPLICIT_EXPIRED',
    };
  }

  if (daysRemaining <= alertDays) {
    const isToday = daysRemaining === 0;
    return {
      status: 'NEAR_EXPIRY',
      expiryDate: normExpiry,
      daysRemaining,
      isExpired: false,
      isNearExpiry: true,
      blocked: false,
      label: isToday ? 'หมดอายุวันนี้' : `ใกล้หมดอายุ (อีก ${daysRemaining} วัน)`,
      warning: isToday
        ? `ตั๋วคุมจะหมดอายุวันนี้ (${normExpiry})`
        : `ตั๋วคุมกำลังจะหมดอายุในอีก ${daysRemaining} วัน (${normExpiry})`,
      provenance: 'EXPLICIT_NEAR_EXPIRY',
    };
  }

  return {
    status: 'VALID',
    expiryDate: normExpiry,
    daysRemaining,
    isExpired: false,
    isNearExpiry: false,
    blocked: false,
    label: `ยังไม่หมดอายุ (อีก ${daysRemaining} วัน)`,
    provenance: 'EXPLICIT_VALID',
  };
}

/**
 * Shared server-owned ticket eligibility evaluator (S1-01 / SO-04 / SO-08).
 * Used by list, picker, reservation, and UI.
 */
function evaluateTicketEligibility({
  couponId = null,
  lifecycle = 'ISSUED',
  balanceState = 'POSITIVE',
  availableQtyTon = null,
  nativeRemainingQtyTon = null,
  expiryEval = null,
  strictOverride = false,
  strictMode = false,
}) {
  const reasons = [];
  const warnings = [];

  // 1. Unissued lifecycle checks
  if (lifecycle === 'DRAFT') {
    return {
      eligibility: 'DRAFT',
      status: 'DRAFT',
      isBlocked: true,
      isSpendable: false,
      reasons: ['เอกสารฉบับร่าง ยังไม่มีผลบังคับใช้ (DRAFT)'],
      warnings: [],
      error: 'เอกสารยังไม่ได้รับการยืนยันหรืออนุมัติ'
    };
  }

  if (lifecycle === 'APPROVED_NOT_ISSUED') {
    return {
      eligibility: 'PENDING_ISSUE',
      status: 'PENDING_ISSUE',
      isBlocked: true,
      isSpendable: false,
      reasons: ['ใบจองได้รับอนุมัติแล้ว แต่ยังไม่ได้ออกเอกสารส่งของ 104 และตั๋วคุม'],
      warnings: [],
      error: 'ยังไม่ได้ออกตั๋วคุมแท้จริง'
    };
  }

  if (lifecycle === 'CANCELLED') {
    return {
      eligibility: 'BLOCKED',
      status: 'BLOCKED',
      isBlocked: true,
      isSpendable: false,
      reasons: ['เอกสารถูกยกเลิก (CANCELLED)'],
      warnings: [],
      error: 'เอกสารถูกยกเลิก'
    };
  }

  // Must have an actual CouponID for issued coupons
  if (couponId == null && lifecycle === 'ISSUED') {
    return {
      eligibility: 'REVIEW',
      status: 'REVIEW',
      isBlocked: true,
      isSpendable: false,
      reasons: ['ไม่พบรหัสตั๋วคุมแท้ (CouponID is null)'],
      warnings: [],
      error: 'ไม่พบรหัสตั๋วคุมแท้'
    };
  }

  // 2. Balance checks
  const avail = availableQtyTon != null ? Number(availableQtyTon) : null;
  const rema = nativeRemainingQtyTon != null ? Number(nativeRemainingQtyTon) : null;

  if (avail === null || isNaN(avail)) {
    return {
      eligibility: 'REVIEW',
      status: 'REVIEW',
      isBlocked: true,
      isSpendable: false,
      reasons: ['ไม่สามารถคำนวณยอดคงเหลือได้ (UNKNOWN_BALANCE)'],
      warnings: [],
      error: 'ยอดคงเหลือไม่สามารถระบุได้'
    };
  }

  if (avail < 0 || (rema !== null && rema < 0)) {
    return {
      eligibility: 'BLOCKED',
      status: 'BLOCKED',
      isBlocked: true,
      isSpendable: false,
      reasons: [`ยอดคงเหลือติดลบ เกิดข้อขัดแย้งทางบัญชีคลัง (BALANCE_CONFLICT: ${avail})`],
      warnings: [],
      error: 'ยอดคงเหลือติดลบ'
    };
  }

  if (avail === 0) {
    if (rema !== null && rema > 0) {
      return {
        eligibility: 'RESERVED_FULL',
        status: 'RESERVED_FULL',
        isBlocked: true,
        isSpendable: false,
        reasons: ['ยอดคงเหลือถูกจองเต็มจำนวนแล้ว (RESERVED_FULL)'],
        warnings: [],
        error: 'ยอดถูกจองเต็ม'
      };
    }
    return {
      eligibility: 'EXHAUSTED',
      status: 'EXHAUSTED',
      isBlocked: true,
      isSpendable: false,
      reasons: ['ตั๋วคุมถูกตัดเบิกใช้หมดแล้ว (ZERO_BALANCE)'],
      warnings: [],
      error: 'ใช้หมดแล้ว'
    };
  }

  // 3. Expiry checks (avail > 0)
  const isExpired = expiryEval?.status === 'EXPIRED';
  const isBlockedByStrict = Boolean(strictMode && !strictOverride);

  if (isExpired) {
    if (isBlockedByStrict) {
      return {
        eligibility: 'BLOCKED',
        status: 'BLOCKED',
        isBlocked: true,
        isSpendable: false,
        reasons: [`ตั๋วคุมหมดอายุแล้วเมื่อ ${expiryEval.expiryDate} (บล็อกตามนโยบาย Strict Mode)`],
        warnings: [],
        error: `ตั๋วหมดอายุแล้วเมื่อ ${expiryEval.expiryDate} (Strict Mode)`
      };
    } else {
      if (strictOverride) {
        warnings.push(`ตั๋วคุมหมดอายุแล้วเมื่อ ${expiryEval.expiryDate} (ได้รับอนุมัติยกเว้นนโยบาย Strict Override)`);
      } else {
        warnings.push(`ตั๋วคุมหมดอายุแล้วเมื่อ ${expiryEval.expiryDate} (แจ้งเตือนเพื่อทราบ Soft Expiry)`);
      }
    }
  } else if (expiryEval?.status === 'NEAR_EXPIRY') {
    warnings.push(`ตั๋วคุมใกล้หมดอายุในอีก ${expiryEval.daysRemaining} วัน (${expiryEval.expiryDate})`);
  }

  return {
    eligibility: 'ELIGIBLE',
    status: 'ELIGIBLE',
    isBlocked: false,
    isSpendable: true,
    reasons: [],
    warnings,
    error: null
  };
}

/**
 * Traces native document chain (SO-04 / DOCUMENT-TRACE-FLOW):
 * I/K (SOHD 103) -> AI (AppvDocuNo) -> Delivery (SOHD 104) -> Coupon (WFCoupon) -> Redemptions (116) -> Invoices (J/N 107)
 */
async function traceNativeTicketChain(ticketRef, options = {}) {
  if (!ticketRef && !options.exactId) return null;
  const cleanRef = String(ticketRef || options.exactId || '').trim();

  const { resolveNativeDocumentChain } = require('./native-document-resolver');
  const resolveRes = await resolveNativeDocumentChain({
    reference: cleanRef,
    entityType: options.entityType,
    exactId: options.exactId,
    budgets: options.budgets,
  });

  if (!resolveRes.resolved) {
    if (resolveRes.isAmbiguous) {
      return {
        ticketRef: cleanRef,
        displayDocuNo: cleanRef,
        isAmbiguous: true,
        error: resolveRes.error,
        candidates: resolveRes.candidates,
        chain: { bookings: [], deliveries: [], coupons: [], redemptions: [], invoices: [] },
        truncated: false,
        reasons: [],
      };
    }
    // Return structured empty response if not found
    return {
      ticketRef: cleanRef,
      displayDocuNo: cleanRef,
      isAmbiguous: false,
      error: resolveRes.error,
      chain: { bookings: [], deliveries: [], coupons: [], redemptions: [], invoices: [] },
      truncated: false,
      reasons: [],
    };
  }

  const { bookings, deliveries, coupons, redemptions, invoices } = resolveRes.chain;

  // Selected Entity Policy (R2-04): Resolve specific entity rather than always picking first
  let selectedEntity = null;
  const reqEntityType = options.entityType ? String(options.entityType).toUpperCase() : null;
  const reqExactId = options.exactId != null ? Number(options.exactId) : null;

  if (reqEntityType === 'COUPON' && reqExactId) {
    const matchedCoupon = coupons.find(c => Number(c.couponId) === reqExactId);
    if (matchedCoupon) {
      selectedEntity = { entityType: 'COUPON', exactId: matchedCoupon.couponId, docuNo: matchedCoupon.couponNo, data: matchedCoupon };
    }
  } else if (reqEntityType === 'BOOKING' && reqExactId) {
    const matchedBooking = bookings.find(b => Number(b.soId) === reqExactId);
    if (matchedBooking) {
      selectedEntity = { entityType: 'BOOKING', exactId: matchedBooking.soId, docuNo: matchedBooking.docuNo, data: matchedBooking };
    }
  } else if (reqEntityType === 'DELIVERY' && reqExactId) {
    const matchedDelivery = deliveries.find(d => Number(d.soId) === reqExactId);
    if (matchedDelivery) {
      selectedEntity = { entityType: 'DELIVERY', exactId: matchedDelivery.soId, docuNo: matchedDelivery.docuNo, data: matchedDelivery };
    }
  }

  const primaryBooking = bookings[0] || null;
  const primaryCoupon = coupons[0] || null;
  if (!selectedEntity) {
    selectedEntity = resolveRes.primaryEntity || (primaryCoupon ? { entityType: 'COUPON', exactId: primaryCoupon.couponId, docuNo: primaryCoupon.couponNo } : (primaryBooking ? { entityType: 'BOOKING', exactId: primaryBooking.soId, docuNo: primaryBooking.docuNo } : null));
  }

  // 2. Fetch overlay metadata with defined precedence (S1-05 / R2-02):
  // Rank 1: Exact CouponID (DocuId)
  // Rank 2: CouponNo (DocuNo)
  // Rank 3: Booking DocuNo
  // Rank 4: AppvDocuNo
  const exactCouponId = (selectedEntity?.entityType === 'COUPON' ? selectedEntity.exactId : null) || primaryCoupon?.couponId || (reqEntityType === 'COUPON' && reqExactId ? reqExactId : null);
  const couponNo = (selectedEntity?.entityType === 'COUPON' ? selectedEntity.docuNo : null) || primaryCoupon?.couponNo || (/^[CD]\d+/i.test(cleanRef) ? cleanRef : null);
  const bookingNo = primaryBooking?.docuNo || null;
  const appvNo = primaryBooking?.appvDocuNo || null;

  let overlay = null;
  const overlayRows = await query(`
    SELECT TOP 1 *
    FROM wf.ControlTicketOverlay ov WITH (NOLOCK)
    WHERE (@cid IS NOT NULL AND ov.DocuId = @cid)
       OR (@cno IS NOT NULL AND ov.DocuNo = @cno AND (ov.DocuId IS NULL OR ov.DocuId = 0))
       OR (@bno IS NOT NULL AND ov.DocuNo = @bno)
       OR (@ano IS NOT NULL AND ov.DocuNo = @ano)
    ORDER BY
      CASE
        WHEN @cid IS NOT NULL AND ov.DocuId = @cid THEN 1
        WHEN @cno IS NOT NULL AND ov.DocuNo = @cno AND (ov.DocuId IS NULL OR ov.DocuId = 0) THEN 2
        WHEN @bno IS NOT NULL AND ov.DocuNo = @bno THEN 3
        WHEN @ano IS NOT NULL AND ov.DocuNo = @ano THEN 4
        ELSE 5
      END ASC,
      ov.UpdatedAt DESC
  `, {
    cid: { type: sql.Int, value: exactCouponId },
    cno: { type: sql.NVarChar(50), value: couponNo },
    bno: { type: sql.NVarChar(50), value: bookingNo },
    ano: { type: sql.NVarChar(50), value: appvNo },
  });
  overlay = overlayRows[0] || null;

  // 3. Resolve ticket policy
  const policy = await resolveTicketPolicy();

  // 4. Build structured trace response with strictOverride passed (R3-04)
  const expiryEval = evaluateTicketExpiry(
    overlay?.ExpiryDate,
    null,
    policy.alertDays,
    policy.strictMode,
    Boolean(overlay?.StrictOverrideFlag)
  );

  // 4b. Per-node policy map for all coupons in the resolved chain (R3-04)
  const couponPolicies = {};
  for (const c of coupons) {
    if (c.couponId) {
      const cOvRows = await query(`
        SELECT TOP 1 *
        FROM wf.ControlTicketOverlay ov WITH (NOLOCK)
        WHERE (ov.DocuId = @cid)
           OR (ov.DocuNo = @cno AND (ov.DocuId IS NULL OR ov.DocuId = 0))
        ORDER BY
          CASE WHEN ov.DocuId = @cid THEN 1 ELSE 2 END ASC,
          ov.UpdatedAt DESC
      `, {
        cid: { type: sql.Int, value: c.couponId },
        cno: { type: sql.NVarChar(50), value: c.couponNo }
      });
      const cOv = cOvRows[0] || null;
      const cExpiry = evaluateTicketExpiry(
        cOv?.ExpiryDate,
        null,
        policy.alertDays,
        policy.strictMode,
        Boolean(cOv?.StrictOverrideFlag)
      );
      couponPolicies[c.couponId] = {
        couponId: c.couponId,
        couponNo: c.couponNo,
        overlay: cOv ? {
          expiryDate: cOv.ExpiryDate,
          expiryType: cOv.ExpiryType,
          reasonCode: cOv.ReasonCode,
          reasonText: cOv.ReasonText,
          strictOverrideFlag: Boolean(cOv.StrictOverrideFlag),
          updatedAt: cOv.UpdatedAt,
          createdBy: cOv.CreatedBy,
        } : null,
        expiry: cExpiry
      };
    }
  }

  // Flatten redemption items for UI backwards-compatibility
  const flatRedemptions = [];
  for (const r of redemptions) {
    for (const l of r.lines) {
      // Find matching invoice if any
      const matchingInv = invoices.find(inv => inv.soInvId === l.soInvId);
      flatRedemptions.push({
        redemptionId: r.redemtionId,
        redemptionDocuNo: r.docuNo,
        redemptionDate: r.docuDate,
        redemptionType: r.docuType,
        redemptionStatus: r.docuStatus,
        couponId: l.couponId,
        couponNo: l.couponNo,
        redeemedQtyTon: Number(l.redeemedQtyTon || 0),
        unitName: l.unitName || 'ไม่ระบุ',
        invoiceDocuNo: matchingInv?.docuNo || null,
        invoiceDocuDate: matchingInv?.docuDate || null,
        invoiceDocuType: matchingInv?.docuType || null,
      });
    }
  }

  return {
    ticketRef: cleanRef,
    displayDocuNo: selectedEntity?.docuNo || primaryBooking?.docuNo || primaryCoupon?.couponNo || cleanRef,
    isAmbiguous: false,
    primaryEntity: resolveRes.primaryEntity || selectedEntity,
    selectedEntity,
    couponPolicies,
    truncated: Boolean(resolveRes.truncated),
    reasons: resolveRes.reasons || [],
    budget: resolveRes.budget || null,
    coverage: resolveRes.coverage || null,
    edges: resolveRes.edges || [],
    policy: {
      alertDays: policy.alertDays,
      strictMode: policy.strictMode,
      strictOverride: Boolean(overlay?.StrictOverrideFlag),
    },
    expiry: expiryEval,
    overlay: overlay ? {
      expiryDate: overlay.ExpiryDate,
      expiryType: overlay.ExpiryType,
      reasonCode: overlay.ReasonCode,
      reasonText: overlay.ReasonText,
      strictOverrideFlag: Boolean(overlay.StrictOverrideFlag),
      updatedAt: overlay.UpdatedAt,
      createdBy: overlay.CreatedBy,
    } : null,
    chain: {
      booking: primaryBooking ? {
        soId: primaryBooking.soId,
        docuNo: primaryBooking.docuNo,
        appvDocuNo: primaryBooking.appvDocuNo,
        appvFlag: primaryBooking.appvFlag,
        appvDate: primaryBooking.appvDate,
        docuDate: primaryBooking.docuDate,
        custId: primaryBooking.custId,
        custName: primaryBooking.custName,
      } : null,
      bookings,
      deliveries,
      coupons: coupons.map(c => ({
        couponId: c.couponId,
        couponNo: c.couponNo,
        goodId: c.goodId,
        goodCode: c.goodCode,
        goodName: c.goodName,
        unitName: c.unitName || 'ไม่ระบุ',
        initialQtyTon: Number(c.initialQtyTon || 0),
        remainingQtyTon: Number(c.remainingQtyTon || 0),
        deliveryDocuNo: c.deliveryDocuNo,
        deliveryDocuDate: c.deliveryDocuDate,
        custId: c.ownerCustId,
        custName: c.ownerCustName,
      })),
      redemptions: flatRedemptions,
      invoices,
    },
    customerCandidate: {
      candidateCustId: primaryCoupon?.ownerCustId || primaryBooking?.custId || null,
      candidateCustName: primaryCoupon?.ownerCustName || primaryBooking?.custName || null,
      isPrefixCandidateOnly: true,
      sharedRedemptionAllowed: false,
      note: 'Prefix ลูกค้าเป็น candidate เท่านั้น ไม่ใช่สิทธิ์เบิกข้ามลูกค้าอัตโนมัติ',
    },
  };
}

/**
 * Update ticket expiry overlay with reason master and audit logging (SO-04 / R2-02)
 */
async function updateTicketExpiryOverlay({
  docuNo,
  exactId = null,
  entityType = null,
  docuType = 104,
  docuId = 0,
  goodCode = null,
  expiryDate = null,
  strictOverride = false,
  reasonCode: rawReasonCode,
  reasonText: rawReasonText,
  userId = 'SYSTEM',
  userRole = null,
  ipAddress = null,
}) {
  if (!docuNo && !exactId) throw new Error('กรุณาระบุเลขที่ตั๋วคุม (docuNo) หรือ exactId');

  // 0. Strict override permission check (Admin/C-Level/Manager only)
  if (strictOverride && userRole && !['ADMIN', 'C_LEVEL', 'MANAGER'].includes(userRole)) {
    throw new Error('ผู้ใช้ไม่มีสิทธิ์ยกเว้นนโยบายวันหมดอายุตั๋วคุม (Strict Override) — สงวนสิทธิ์สำหรับ Admin เท่านั้น');
  }

  // 1. Strict Typed ID Validation (R2-02)
  let cleanExactId = null;
  if (exactId !== undefined && exactId !== null) {
    const rawStr = String(exactId).trim();
    if (!/^\d+$/.test(rawStr)) {
      throw new Error(`INVALID_EXACT_ID: exactId "${exactId}" ต้องเป็นเลขจำนวนเต็มบวก 32-bit เท่านั้น`);
    }
    const parsed = Number(rawStr);
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
      throw new Error(`INVALID_EXACT_ID: exactId "${exactId}" อยู่นอกช่วงจำนวนเต็มบวก 32-bit (1..2147483647)`);
    }
    cleanExactId = parsed;
  }

  let cleanDocuId = null;
  if (docuId !== undefined && docuId !== null && docuId !== 0) {
    const rawStr = String(docuId).trim();
    if (!/^\d+$/.test(rawStr)) {
      throw new Error(`INVALID_DOCU_ID: docuId "${docuId}" ต้องเป็นเลขจำนวนเต็มบวก 32-bit เท่านั้น`);
    }
    const parsed = Number(rawStr);
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
      throw new Error(`INVALID_DOCU_ID: docuId "${docuId}" อยู่นอกช่วงจำนวนเต็มบวก 32-bit (1..2147483647)`);
    }
    cleanDocuId = parsed;
  }

  const explicitExactId = cleanExactId || cleanDocuId;

  // 2. Validate master reason code (context: POLICY)
  const reasonCheck = await validateReasonCode(null, rawReasonCode, rawReasonText, 'POLICY');
  if (!reasonCheck.valid) {
    throw new Error(reasonCheck.error);
  }
  const cleanReasonCode = reasonCheck.reasonCode;
  const cleanReasonText = reasonCheck.reasonText;

  // 3. Validate expiry date if provided
  let cleanExpiry = null;
  let expiryType = 'UNKNOWN';
  if (expiryDate) {
    cleanExpiry = normalizeDateString(expiryDate, { isWallClock: true });
    if (!cleanExpiry || !isValidDateString(cleanExpiry)) {
      throw new Error(`รูปแบบวันหมดอายุ "${expiryDate}" ไม่ถูกต้องหรือเป็นวันที่ไม่มีอยู่จริง`);
    }
    expiryType = 'EXPLICIT';
  }

  // 4. Resolve native coupon in WINSpeed (dbo.WFCoupon) to verify existence & scope (R2-02 / R3-01)
  // ZERO TEST BACKDOORS: No exceptions for TEST- in production code!
  const cleanDocuNo = String(docuNo || '').trim();

  let nativeRows = [];
  if (explicitExactId) {
    nativeRows = await query(`
      SELECT c.CouponID, c.CouponNo, c.DocuID, c.Docutype, c.GoodID, g.GoodCode, hd104.CustID
      FROM dbo.WFCoupon c WITH (NOLOCK)
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = c.GoodID
      LEFT JOIN dbo.SOHD hd104 WITH (NOLOCK) ON hd104.SOID = c.DocuID
      WHERE c.CouponID = @cid
    `, { cid: { type: sql.Int, value: explicitExactId } });

    // Reject nonexistent exactId immediately
    if (!nativeRows || nativeRows.length === 0) {
      throw new Error(`NOT_FOUND: ไม่พบรหัสตั๋วคุม CouponID ${explicitExactId} ในระบบ WINSpeed (dbo.WFCoupon)`);
    }

    // Mismatched reference validation: ensure docuNo matches exact coupon
    if (cleanDocuNo) {
      const actualDocNo = String(nativeRows[0].CouponNo || '').trim();
      if (actualDocNo && cleanDocuNo !== actualDocNo) {
        throw new Error(`MISMATCHED_REFERENCE: เลขที่ตั๋วคุม "${cleanDocuNo}" ไม่ตรงกับ CouponID ${explicitExactId} (เลขที่จริงในระบบคือ "${actualDocNo}")`);
      }
    }
  } else if (cleanDocuNo) {
    nativeRows = await query(`
      SELECT c.CouponID, c.CouponNo, c.DocuID, c.Docutype, c.GoodID, g.GoodCode, hd104.CustID
      FROM dbo.WFCoupon c WITH (NOLOCK)
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = c.GoodID
      LEFT JOIN dbo.SOHD hd104 WITH (NOLOCK) ON hd104.SOID = c.DocuID
      WHERE c.CouponNo = @dno OR c.SONo = @dno OR hd104.DocuNo = @dno
    `, { dno: { type: sql.NVarChar(50), value: cleanDocuNo } });

    if (!nativeRows || nativeRows.length === 0) {
      throw new Error(`NOT_FOUND: ไม่พบตั๋วคุมเลขที่ "${cleanDocuNo}" ในระบบ WINSpeed (dbo.WFCoupon)`);
    }
  }

  let resolvedDocuId = explicitExactId;
  let resolvedDocuType = docuType;
  let resolvedGoodCode = goodCode;
  let targetDocuNo = cleanDocuNo;

  if (nativeRows && nativeRows.length > 0) {
    // If ambiguous and no explicit exactId was provided, reject to prevent mutating multiple coupons!
    const distinctCouponIds = new Set(nativeRows.map(r => r.CouponID));
    if (distinctCouponIds.size > 1 && !explicitExactId) {
      throw new Error(`AMBIGUOUS_TICKET: พบตั๋วคุมเลขที่ "${cleanDocuNo}" ซ้ำกัน ${distinctCouponIds.size} รายการ กรุณาระบุ exactId (CouponID) เพื่อแก้ไขเฉพาะใบที่เลือก`);
    }

    const distinctGoods = new Set(nativeRows.map(r => r.GoodCode).filter(Boolean));
    if (distinctGoods.size > 1 && !goodCode && !explicitExactId) {
      throw new Error(`พบสินค้าหลายรายการสำหรับตั๋วคุม "${cleanDocuNo}" กรุณาระบุ goodCode เพื่อความถูกต้อง`);
    }
    resolvedDocuId = explicitExactId || nativeRows[0].CouponID;
    resolvedDocuType = nativeRows[0].Docutype || 104;
    resolvedGoodCode = goodCode || nativeRows[0].GoodCode;
    targetDocuNo = targetDocuNo || nativeRows[0].CouponNo;
  }

  // Must have a valid positive CouponID to persist an isolated overlay
  if (!resolvedDocuId || resolvedDocuId <= 0) {
    throw new Error('MISSING_EXACT_ID: การแก้ไขวันหมดอายุของตั๋วคุมต้องระบุ exactId (CouponID)');
  }

  // 5. Resolve active snapshot
  const policy = await resolveTicketPolicy();

  // 6. Upsert into wf.ControlTicketOverlay and audit (STRICT ISOLATION by exact DocuId with locking hints, R3-02)
  let overlayId = null;
  let beforeSnapshot = null;

  await wfTransaction(async (tx) => {
    // STRICT ISOLATION & CONCURRENCY LOCKING:
    // Query with UPDLOCK, HOLDLOCK on exact DocuId. Never match or mutate a legacy shared row!
    const existingRes = await tx.request()
      .input('did', sql.Int, resolvedDocuId)
      .query(`SELECT * FROM wf.ControlTicketOverlay WITH (UPDLOCK, HOLDLOCK) WHERE DocuId = @did`);
    const existing = existingRes.recordset?.[0] || null;

    beforeSnapshot = existing ? { ...existing } : null;

    if (existing) {
      overlayId = existing.Id;
      await tx.request()
        .input('id', sql.Int, overlayId)
        .input('did', sql.Int, resolvedDocuId)
        .input('exp', sql.Date, cleanExpiry)
        .input('type', sql.VarChar(20), expiryType)
        .input('snapId', sql.Int, policy.snapshotId)
        .input('override', sql.Bit, strictOverride ? 1 : 0)
        .input('rcode', sql.VarChar(50), cleanReasonCode)
        .input('rtext', sql.NVarChar(500), cleanReasonText)
        .input('by', sql.VarChar(50), String(userId))
        .query(`
          UPDATE wf.ControlTicketOverlay
          SET DocuId = @did,
              ExpiryDate = @exp,
              ExpiryType = @type,
              PolicySnapshotId = @snapId,
              StrictOverrideFlag = @override,
              ReasonCode = @rcode,
              ReasonText = @rtext,
              CreatedBy = ISNULL(CreatedBy, @by),
              UpdatedAt = SYSUTCDATETIME()
          WHERE Id = @id
        `);
    } else {
      // INSERT new isolated row for this exact DocuId
      const insRes = await tx.request()
        .input('dno', sql.NVarChar(50), targetDocuNo)
        .input('dtype', sql.Int, resolvedDocuType || 104)
        .input('did', sql.Int, resolvedDocuId)
        .input('gcode', sql.NVarChar(50), resolvedGoodCode)
        .input('exp', sql.Date, cleanExpiry)
        .input('type', sql.VarChar(20), expiryType)
        .input('snapId', sql.Int, policy.snapshotId)
        .input('override', sql.Bit, strictOverride ? 1 : 0)
        .input('rcode', sql.VarChar(50), cleanReasonCode)
        .input('rtext', sql.NVarChar(500), cleanReasonText)
        .input('by', sql.VarChar(50), String(userId))
        .query(`
          INSERT INTO wf.ControlTicketOverlay (
            DocuNo, DocuType, DocuId, GoodCode, ExpiryDate, ExpiryType,
            PolicySnapshotId, StrictOverrideFlag, ReasonCode, ReasonText, CreatedBy
          )
          OUTPUT INSERTED.Id
          VALUES (
            @dno, @dtype, @did, @gcode, @exp, @type,
            @snapId, @override, @rcode, @rtext, @by
          );
        `);
      overlayId = insRes.recordset?.[0]?.Id;
    }

    // Mandatory Audit ChangeEvent inside same transaction
    await logChangeEvent(tx, {
      entityType: 'CONTROL_TICKET',
      entityId: cleanDocuNo || String(resolvedDocuId),
      action: existing ? 'UPDATE_EXPIRY' : 'CREATE_EXPIRY',
      beforeJson: beforeSnapshot,
      afterJson: {
        docuNo: targetDocuNo,
        exactId: resolvedDocuId,
        expiryDate: cleanExpiry,
        expiryType,
        strictOverrideFlag: strictOverride,
        policySnapshotId: policy.snapshotId,
      },
      reasonCode: cleanReasonCode,
      reasonText: cleanReasonText,
      userId: String(userId),
      ipAddress,
    });
  });

  // 7. Reconcile alerts for this ticket
  await reconcileTicketAlerts(targetDocuNo);

  return {
    success: true,
    overlayId,
    docuNo: targetDocuNo,
    exactId: resolvedDocuId,
    expiryDate: cleanExpiry,
    expiryType,
    strictOverride,
    policySnapshotId: policy.snapshotId,
  };
}


/**
 * Reconcile alerts for near-expiry and expired tickets with deduplication.
 * When expiry is updated, dismissed, or resolved, old alerts are closed.
 */
async function reconcileTicketAlerts(targetDocuNo = null) {
  const policy = await resolveTicketPolicy();
  const filterDocu = targetDocuNo ? `WHERE DocuNo = @dno` : '';
  const inputs = targetDocuNo ? { dno: { type: sql.NVarChar(50), value: targetDocuNo } } : {};

  const overlays = await query(`
    SELECT DocuNo, ExpiryDate, ExpiryType, StrictOverrideFlag
    FROM wf.ControlTicketOverlay
    ${filterDocu}
  `, inputs);

  const todayStr = getBangkokDateString();

  for (const o of overlays) {
    const evalRes = evaluateTicketExpiry(o.ExpiryDate, null, policy.alertDays, policy.strictMode, Boolean(o.StrictOverrideFlag));

    if (evalRes.status === 'NEAR_EXPIRY' || evalRes.status === 'EXPIRED') {
      const alertType = evalRes.status;
      const hashContent = `${o.DocuNo}:${alertType}:${evalRes.expiryDate}`;
      const dedupHash = crypto.createHash('sha256').update(hashContent).digest('hex');

      await wfTransaction(async (tx) => {
        // Applock per ticket to prevent concurrent duplicate alerts
        const lockKey = `CTAlert_${o.DocuNo}`;
        await tx.request()
          .input('resource', sql.NVarChar(255), lockKey)
          .query(`EXEC sp_getapplock @Resource = @resource, @LockMode = 'Exclusive', @LockOwner = 'Transaction'`);

        // Resolve any stale active alerts for this ticket that have a different hash
        await tx.request()
          .input('dno', sql.NVarChar(50), o.DocuNo)
          .input('currHash', sql.VarChar(64), dedupHash)
          .query(`
            UPDATE wf.ControlTicketAlert
            SET Status = 'RESOLVED', ResolvedAt = SYSUTCDATETIME()
            WHERE DocuNo = @dno AND Status = 'ACTIVE' AND DedupHash <> @currHash
          `);

        // Check if an active alert with the exact current hash already exists
        const exRes = await tx.request()
          .input('hash', sql.VarChar(64), dedupHash)
          .query(`SELECT AlertId FROM wf.ControlTicketAlert WHERE DedupHash = @hash AND Status = 'ACTIVE'`);

        if (!exRes.recordset || exRes.recordset.length === 0) {
          await tx.request()
            .input('dno', sql.NVarChar(50), o.DocuNo)
            .input('atype', sql.VarChar(30), alertType)
            .input('lead', sql.Int, policy.alertDays)
            .input('adate', sql.Date, todayStr)
            .input('edate', sql.Date, evalRes.expiryDate)
            .input('hash', sql.VarChar(64), dedupHash)
            .input('cno', sql.VarChar(50), o.DocuNo)
            .input('akind', sql.VarChar(20), alertType)
            .query(`
              INSERT INTO wf.ControlTicketAlert (
                DocuNo, AlertType, LeadDays, AlertDate, ExpiryDate, Status, DedupHash, CouponNo, AlertKind
              ) VALUES (
                @dno, @atype, @lead, @adate, @edate, 'ACTIVE', @hash, @cno, @akind
              )
            `);
        }
      });
    } else {
      // If now VALID or UNKNOWN, resolve any existing active alerts for this ticket
      await wfQuery(`
        UPDATE wf.ControlTicketAlert
        SET Status = 'RESOLVED', ResolvedAt = SYSUTCDATETIME()
        WHERE DocuNo = @dno AND Status = 'ACTIVE'
      `, { dno: { type: sql.NVarChar(50), value: o.DocuNo } });
    }
  }
}

/**
 * Lists active control ticket alerts for notification banner (SO-04)
 */
async function listTicketAlerts() {
  const rows = await query(`
    SELECT 
      AlertId, DocuNo, AlertType, LeadDays, AlertDate, ExpiryDate, Status, CreatedAt
    FROM wf.ControlTicketAlert
    WHERE Status = 'ACTIVE'
    ORDER BY AlertDate DESC, AlertId DESC
  `);
  return rows;
}

module.exports = {
  resolveTicketPolicy,
  evaluateTicketExpiry,
  evaluateTicketEligibility,
  traceNativeTicketChain,
  updateTicketExpiryOverlay,
  reconcileTicketAlerts,
  listTicketAlerts,
};
