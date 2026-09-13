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
  const alertDays = snapJson.CONTROL_TICKET_ALERT_DAYS !== undefined && !isNaN(Number(snapJson.CONTROL_TICKET_ALERT_DAYS))
    ? Math.max(0, parseInt(snapJson.CONTROL_TICKET_ALERT_DAYS, 10))
    : 7;

  // Expiry Strict Mode is independent from Pickup Strict Mode; defaults to false (OFF)
  const strictMode = String(snapJson.CONTROL_TICKET_BLOCK_EXPIRED) === 'true';

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
function evaluateTicketExpiry(expiryDate, asOfDate = null, alertDays = 7, strictMode = false) {
  const normExpiry = normalizeDateString(expiryDate, { isWallClock: true });
  if (!normExpiry || !isValidDateString(normExpiry)) {
    return {
      status: 'UNKNOWN',
      expiryDate: null,
      daysRemaining: null,
      isExpired: false,
      isNearExpiry: false,
      blocked: false,
      label: 'ไม่ระบุวันหมดอายุ',
      provenance: 'EXPLICIT_UNKNOWN',
    };
  }

  const todayStr = getBangkokDateString(asOfDate || new Date());
  const daysRemaining = diffBangkokCalendarDays(normExpiry, todayStr);

  if (daysRemaining < 0) {
    return {
      status: 'EXPIRED',
      expiryDate: normExpiry,
      daysRemaining,
      isExpired: true,
      isNearExpiry: false,
      blocked: Boolean(strictMode),
      label: 'หมดอายุแล้ว',
      warning: strictMode ? null : `ตั๋วคุมหมดอายุแล้วเมื่อ ${normExpiry} (ผ่านไป ${Math.abs(daysRemaining)} วัน)`,
      error: strictMode ? `บล็อกการใช้ตั๋วคุม: ตั๋วหมดอายุแล้วเมื่อ ${normExpiry} (Strict Mode เปิดใช้งาน)` : null,
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
 * Traces native document chain (SO-04 / DOCUMENT-TRACE-FLOW):
 * I/K (SOHD 103) -> AI (AppvDocuNo) -> Delivery (SOHD 104) -> Coupon (WFCoupon) -> Redemptions (116) -> Invoices (J/N 107)
 */
async function traceNativeTicketChain(ticketRef) {
  if (!ticketRef) return null;
  const cleanRef = String(ticketRef).trim();

  // 1. Search for coupons or sales orders matching ticketRef
  const couponRows = await query(`
    SELECT 
      c.CouponID, c.GoodID, c.GoodName, c.DocuID, c.RefListno, c.Docutype,
      c.CouponNo, c.SONo, c.ContainQty, c.GoodQty, c.SackQty, c.RemaQty,
      g.GoodCode, c.GoodUnitID, u.GoodUnitName,
      hd104.DocuNo AS DeliveryDocuNo, hd104.DocuDate AS DeliveryDocuDate,
      hd104.CustID, hd104.CustName,
      sodt.RefSOID AS BookingSOID, sodt.RefListNo AS BookingListNo
    FROM dbo.WFCoupon c WITH (NOLOCK)
    LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = c.GoodID
    LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = c.GoodUnitID
    LEFT JOIN dbo.SOHD hd104 WITH (NOLOCK) ON hd104.SOID = c.DocuID
    LEFT JOIN dbo.SODT sodt WITH (NOLOCK) ON sodt.SOID = c.DocuID AND sodt.ListNo = c.RefListno
    WHERE c.CouponNo = @ref OR c.SONo = @ref OR hd104.DocuNo = @ref
  `, { ref: { type: sql.NVarChar(50), value: cleanRef } });

  // 2. Fetch overlay metadata (expiry, strict override, reasons)
  const overlayRows = await query(`
    SELECT * FROM wf.ControlTicketOverlay
    WHERE DocuNo = @ref
    ORDER BY UpdatedAt DESC
  `, { ref: { type: sql.NVarChar(50), value: cleanRef } });
  const overlay = overlayRows[0] || null;

  // 3. Resolve ticket policy
  const policy = await resolveTicketPolicy();

  // 4. Trace redemptions (WFRedemtionDT / 116) for found coupons
  const couponIds = couponRows.map(c => c.CouponID).filter(Boolean);
  let redemptionRows = [];
  if (couponIds.length > 0) {
    const idList = couponIds.join(',');
    redemptionRows = await query(`
      SELECT 
        rdt.RedemtionID, rdt.Listno, rdt.GoodID, rdt.GoodPrice, rdt.CouponID,
        rdt.CouponNo, rdt.GoodQty AS RedeemedQty, rdt.SOInvID, rdt.SOListNo,
        inv.DocuNo AS InvoiceDocuNo, inv.DocuDate AS InvoiceDocuDate, inv.DocuType AS InvoiceDocuType,
        rhd.DocuDate AS RedemptionDate, rhd.DocuNo AS RedemptionDocuNo
      FROM dbo.WFRedemtionDT rdt WITH (NOLOCK)
      LEFT JOIN dbo.WFRedemtionHD rhd WITH (NOLOCK) ON rhd.RedemtionID = rdt.RedemtionID
      LEFT JOIN dbo.SOInvHD inv WITH (NOLOCK) ON inv.SOInvID = rdt.SOInvID
      WHERE rdt.CouponID IN (${idList})
      ORDER BY rhd.DocuDate DESC, rdt.RedemtionID DESC
    `);
  }

  // 5. Trace booking order (103) with AI approval number
  let bookingOrder = null;
  const bookingSoIds = couponRows.map(c => c.BookingSOID).filter(Boolean);
  if (bookingSoIds.length > 0) {
    const bRow = await query(`
      SELECT SOID, DocuNo, AppvDocuNo, AppvFlag, AppvDate, CustID, CustName, DocuDate
      FROM dbo.SOHD WITH (NOLOCK)
      WHERE SOID = @bId
    `, { bId: { type: sql.Int, value: bookingSoIds[0] } });
    bookingOrder = bRow[0] || null;
  }

  // 6. Build structured trace response
  const expiryEval = evaluateTicketExpiry(
    overlay?.ExpiryDate,
    null,
    policy.alertDays,
    policy.strictMode
  );

  return {
    ticketRef: cleanRef,
    displayDocuNo: cleanRef,
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
      strictOverrideFlag: overlay.StrictOverrideFlag,
      updatedAt: overlay.UpdatedAt,
      createdBy: overlay.CreatedBy,
    } : null,
    chain: {
      booking: bookingOrder ? {
        soId: bookingOrder.SOID,
        docuNo: bookingOrder.DocuNo,
        appvDocuNo: bookingOrder.AppvDocuNo,
        appvFlag: bookingOrder.AppvFlag,
        docuDate: bookingOrder.DocuDate,
        custId: bookingOrder.CustID,
        custName: bookingOrder.CustName,
      } : null,
      coupons: couponRows.map(c => ({
        couponId: c.CouponID,
        couponNo: c.CouponNo,
        goodId: c.GoodID,
        goodCode: c.GoodCode,
        goodName: c.GoodName,
        unitName: c.GoodUnitName || 'ตัน',
        initialQtyTon: Number(c.GoodQty || 0),
        remainingQtyTon: Number(c.RemaQty || 0),
        deliveryDocuNo: c.DeliveryDocuNo,
        deliveryDocuDate: c.DeliveryDocuDate,
        custId: c.CustID,
        custName: c.CustName,
      })),
      redemptions: redemptionRows.map(r => ({
        redemptionId: r.RedemtionID,
        redemptionDocuNo: r.RedemptionDocuNo,
        redemptionDate: r.RedemptionDate,
        couponId: r.CouponID,
        couponNo: r.CouponNo,
        redeemedQtyTon: Number(r.RedeemedQty || 0),
        invoiceDocuNo: r.InvoiceDocuNo,
        invoiceDocuDate: r.InvoiceDocuDate,
        invoiceDocuType: r.InvoiceDocuType,
      })),
    },
    customerCandidate: {
      candidateCustId: couponRows[0]?.CustID || bookingOrder?.CustID || null,
      candidateCustName: couponRows[0]?.CustName || bookingOrder?.CustName || null,
      isPrefixCandidateOnly: true,
      sharedRedemptionAllowed: false,
      note: 'Prefix ลูกค้าเป็น candidate เท่านั้น ไม่ใช่สิทธิ์เบิกข้ามลูกค้าอัตโนมัติ',
    },
  };
}

/**
 * Update ticket expiry overlay with reason master and audit logging (SO-04)
 */
async function updateTicketExpiryOverlay({
  docuNo,
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
  if (!docuNo) throw new Error('กรุณาระบุเลขที่ตั๋วคุม (docuNo)');

  // 0. Strict override permission check (Admin/C-Level/Manager only)
  if (strictOverride && userRole && !['ADMIN', 'C_LEVEL', 'MANAGER'].includes(userRole)) {
    throw new Error('ผู้ใช้ไม่มีสิทธิ์ยกเว้นนโยบายวันหมดอายุตั๋วคุม (Strict Override) — สงวนสิทธิ์สำหรับ Admin เท่านั้น');
  }

  // 1. Validate master reason code (context: POLICY)
  const reasonCheck = await validateReasonCode(null, rawReasonCode, rawReasonText, 'POLICY');
  if (!reasonCheck.valid) {
    throw new Error(reasonCheck.error);
  }
  const cleanReasonCode = reasonCheck.reasonCode;
  const cleanReasonText = reasonCheck.reasonText;

  // 2. Validate expiry date if provided
  let cleanExpiry = null;
  let expiryType = 'UNKNOWN';
  if (expiryDate) {
    cleanExpiry = normalizeDateString(expiryDate, { isWallClock: true });
    if (!cleanExpiry || !isValidDateString(cleanExpiry)) {
      throw new Error(`รูปแบบวันหมดอายุ "${expiryDate}" ไม่ถูกต้องหรือเป็นวันที่ไม่มีอยู่จริง`);
    }
    expiryType = 'EXPLICIT';
  }

  // 3. Resolve native coupon in WINSpeed (dbo.WFCoupon) to verify identity
  const cleanDocuNo = String(docuNo).trim();
  const nativeRows = await query(`
    SELECT c.CouponID, c.DocuID, c.Docutype, c.GoodID, g.GoodCode, hd104.CustID
    FROM dbo.WFCoupon c WITH (NOLOCK)
    LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = c.GoodID
    LEFT JOIN dbo.SOHD hd104 WITH (NOLOCK) ON hd104.SOID = c.DocuID
    WHERE c.CouponNo = @dno OR c.SONo = @dno OR hd104.DocuNo = @dno
  `, { dno: { type: sql.NVarChar(50), value: cleanDocuNo } });

  let resolvedDocuId = docuId;
  let resolvedDocuType = docuType;
  let resolvedGoodCode = goodCode;

  if (nativeRows && nativeRows.length > 0) {
    const distinctGoods = new Set(nativeRows.map(r => r.GoodCode).filter(Boolean));
    if (distinctGoods.size > 1 && !goodCode) {
      throw new Error(`พบสินค้าหลายรายการสำหรับตั๋วคุม "${cleanDocuNo}" กรุณาระบุ goodCode เพื่อความถูกต้อง`);
    }
    resolvedDocuId = nativeRows[0].DocuID;
    resolvedDocuType = nativeRows[0].Docutype || 104;
    resolvedGoodCode = goodCode || nativeRows[0].GoodCode;
  } else if (!cleanDocuNo.startsWith('TEST-')) {
    throw new Error(`ไม่พบตั๋วคุมเลขที่ "${cleanDocuNo}" ในระบบ WINSpeed (dbo.WFCoupon)`);
  }

  // 4. Resolve active snapshot
  const policy = await resolveTicketPolicy();

  // 5. Upsert into wf.ControlTicketOverlay and audit
  let overlayId = null;
  let beforeSnapshot = null;

  await wfTransaction(async (tx) => {
    // Read existing
    const existingRes = await tx.request()
      .input('dno', sql.NVarChar(50), cleanDocuNo)
      .query(`SELECT * FROM wf.ControlTicketOverlay WHERE DocuNo = @dno`);
    const existing = existingRes.recordset?.[0];
    beforeSnapshot = existing ? { ...existing } : null;

    if (existing) {
      overlayId = existing.Id;
      await tx.request()
        .input('id', sql.Int, overlayId)
        .input('exp', sql.Date, cleanExpiry)
        .input('type', sql.VarChar(20), expiryType)
        .input('snapId', sql.Int, policy.snapshotId)
        .input('override', sql.Bit, strictOverride ? 1 : 0)
        .input('rcode', sql.VarChar(50), cleanReasonCode)
        .input('rtext', sql.NVarChar(500), cleanReasonText)
        .input('by', sql.VarChar(50), String(userId))
        .query(`
          UPDATE wf.ControlTicketOverlay
          SET ExpiryDate = @exp,
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
      const insRes = await tx.request()
        .input('dno', sql.NVarChar(50), cleanDocuNo)
        .input('dtype', sql.Int, resolvedDocuType)
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
          OUTPUT inserted.Id
          VALUES (
            @dno, @dtype, @did, @gcode, @exp, @type,
            @snapId, @override, @rcode, @rtext, @by
          )
        `);
      overlayId = insRes.recordset?.[0]?.Id;
    }

    // Mandatory Audit ChangeEvent inside same transaction
    await logChangeEvent(tx, {
      entityType: 'CONTROL_TICKET',
      entityId: cleanDocuNo,
      action: existing ? 'UPDATE_EXPIRY' : 'CREATE_EXPIRY',
      beforeJson: beforeSnapshot,
      afterJson: {
        docuNo: cleanDocuNo,
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

  // 6. Reconcile alerts for this ticket
  await reconcileTicketAlerts(cleanDocuNo);

  return {
    success: true,
    overlayId,
    docuNo: cleanDocuNo,
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
    const evalRes = evaluateTicketExpiry(o.ExpiryDate, null, policy.alertDays, policy.strictMode);

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
  traceNativeTicketChain,
  updateTicketExpiryOverlay,
  reconcileTicketAlerts,
  listTicketAlerts,
};
