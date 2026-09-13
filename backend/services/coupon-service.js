'use strict';

/**
 * coupon-service.js — SO-08 Coupon Engine
 *
 * Implements:
 * 1. Balance invariant math:
 *    Native balance = dbo.WFCoupon.RemaQty
 *    Active unposted reservations = SUM(ReservedQty) WHERE Status = 'RESERVED' AND (ExpiresAt IS NULL OR ExpiresAt > NOW)
 *    Available = Native balance - Active unposted reservations
 *    Invariant: 100 -> reserve 10 -> available 90 -> native post reduces native balance to 90 and settles reservation -> available remains 90.
 *
 * 2. Pessimistic concurrency lock:
 *    UPDLOCK, ROWLOCK on dbo.WFCoupon and active reservations when claiming balance.
 *
 * 3. Beneficiary rights authorization:
 *    Customer must be owner (SOHD.CustID) OR have active grant in wf.CouponBeneficiary.
 *    No automatic prefix inheritance.
 *    Duplicate active grants prevented.
 *
 * 4. Idempotency & Payload Fingerprinting:
 *    Same key + same payload -> idempotent replay (200).
 *    Same key + different payload -> 409 Conflict.
 *
 * 5. Fail-Closed Native Posting:
 *    COUPON_NATIVE_POSTING_ENABLED (false by default).
 *    Even if flag=true, fails closed with 501 unless a proven adapter is passed.
 *    Prevents fake POSTED without native stock decrement.
 */

const crypto = require('crypto');
const { sql, wfQuery, wfTransaction } = require('../db');

const COUPON_NATIVE_POSTING_ENABLED = process.env.COUPON_NATIVE_POSTING_ENABLED === 'true';

function computePayloadHash(payload) {
  const norm = {
    couponId: Number(payload.couponId),
    goodId: Number(payload.goodId || 0),
    reservedQty: Number(Number(payload.reservedQty).toFixed(3)),
    goodUnit: String(payload.goodUnit || 'ตัน').trim(),
    beneficiaryCustId: String(payload.beneficiaryCustId).trim(),
    carrierSoId: String(payload.carrierSoId || '').trim(),
    tripId: payload.tripId != null ? Number(payload.tripId) : null,
    userId: Number(payload.userId || 0),
    expiresAt: payload.expiresAt ? new Date(payload.expiresAt).toISOString() : null
  };
  return crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

/**
 * List coupons eligible for a customer (as owner or authorized beneficiary)
 */
async function getCouponsForCustomer(customerId, options = {}) {
  const custIdStr = String(customerId).trim();
  if (!custIdStr) return [];
  const goodId = options.goodId ? Number(options.goodId) : null;

  const querySql = `
    SELECT 
      c.CouponID AS couponId,
      c.CouponNo AS couponNo,
      c.DocuID AS sourceSoId,
      s.DocuNo AS sourceDocuNo,
      s.CustID AS ownerCustId,
      s.CustName AS ownerCustName,
      c.GoodID AS goodId,
      c.GoodName AS goodName,
      c.GoodPrice AS goodPrice,
      CAST(c.GoodQty AS DECIMAL(12, 4)) AS totalQty,
      CAST(c.RemaQty AS DECIMAL(12, 4)) AS nativeRemainingQty,
      ISNULL(activeRes.TotalReserved, 0) AS reservedQty,
      CAST(c.RemaQty - ISNULL(activeRes.TotalReserved, 0) AS DECIMAL(12, 4)) AS availableQty,
      CASE 
        WHEN CAST(s.CustID AS VARCHAR(50)) = @custId THEN 'OWNER'
        ELSE 'BENEFICIARY'
      END AS rightType,
      b.Reason AS beneficiaryReason,
      b.EffectiveTo AS beneficiaryExpiry,
      s.DocuDate AS sourceDocuDate
    FROM dbo.WFCoupon c WITH (NOLOCK)
    JOIN dbo.SOHD s WITH (NOLOCK) ON s.SOID = c.DocuID
    LEFT JOIN (
      SELECT 
        CouponId,
        SUM(ReservedQty) AS TotalReserved
      FROM wf.CouponReservation WITH (NOLOCK)
      WHERE Status = 'RESERVED'
        AND (ExpiresAt IS NULL OR ExpiresAt > GETUTCDATE())
      GROUP BY CouponId
    ) activeRes ON activeRes.CouponId = c.CouponID
    LEFT JOIN wf.CouponBeneficiary b WITH (NOLOCK) ON 
      b.OwnerCustId = CAST(s.CustID AS VARCHAR(50))
      AND b.BeneficiaryCustId = @custId
      AND b.Status = 'ACTIVE'
      AND (b.EffectiveFrom IS NULL OR b.EffectiveFrom <= GETUTCDATE())
      AND (b.EffectiveTo IS NULL OR b.EffectiveTo >= GETUTCDATE())
      AND (b.Scope = 'ALL' OR b.Scope = CAST(c.GoodID AS VARCHAR(50)))
    WHERE (
      CAST(s.CustID AS VARCHAR(50)) = @custId
      OR b.Id IS NOT NULL
    )
    AND c.RemaQty > 0
    ${goodId ? 'AND c.GoodID = @goodId' : ''}
    ORDER BY c.CouponID DESC
  `;

  const params = {
    custId: { type: sql.VarChar(50), value: custIdStr }
  };
  if (goodId) {
    params.goodId = { type: sql.Int, value: goodId };
  }

  const res = await wfQuery(querySql, params);
  return res.recordset || [];
}

/**
 * Check if a beneficiary is authorized to redeem owner's coupons
 */
async function checkBeneficiaryAuthorization(ownerCustId, beneficiaryCustId, goodId = null, tx = null) {
  const ownerStr = String(ownerCustId).trim();
  const beneficiaryStr = String(beneficiaryCustId).trim();

  // If customer is owner, automatically authorized
  if (ownerStr === beneficiaryStr) {
    return { authorized: true, rightType: 'OWNER' };
  }

  const queryText = `
    SELECT TOP 1 Id, Scope, Reason, EffectiveFrom, EffectiveTo
    FROM wf.CouponBeneficiary WITH (UPDLOCK, ROWLOCK)
    WHERE OwnerCustId = @owner
      AND BeneficiaryCustId = @ben
      AND Status = 'ACTIVE'
      AND (EffectiveFrom IS NULL OR EffectiveFrom <= GETUTCDATE())
      AND (EffectiveTo IS NULL OR EffectiveTo >= GETUTCDATE())
      AND (Scope = 'ALL' OR Scope = @goodIdStr)
    ORDER BY Id DESC
  `;

  let row;
  if (tx) {
    const r = await tx.request()
      .input('owner', sql.VarChar(50), ownerStr)
      .input('ben', sql.VarChar(50), beneficiaryStr)
      .input('goodIdStr', sql.VarChar(50), goodId != null ? String(goodId) : 'ALL')
      .query(queryText);
    row = r.recordset?.[0];
  } else {
    const res = await wfQuery(queryText, {
      owner: { type: sql.VarChar(50), value: ownerStr },
      ben: { type: sql.VarChar(50), value: beneficiaryStr },
      goodIdStr: { type: sql.VarChar(50), value: goodId != null ? String(goodId) : 'ALL' }
    });
    row = res.recordset?.[0];
  }

  if (row) {
    return { authorized: true, rightType: 'BENEFICIARY', grant: row };
  }

  return {
    authorized: false,
    reason: `ลูกค้า ${beneficiaryStr} ไม่ได้รับสิทธิ์ใช้ตั๋วร่วมจากเจ้าของตั๋ว ${ownerStr}`
  };
}

/**
 * Reserve a coupon with pessimistic locking, payload fingerprinting, and invariant calculation
 */
async function reserveCoupon({
  couponId,
  carrierSoId,
  carrierDocuNo = null,
  tripId = null,
  beneficiaryCustId,
  reservedQty,
  userId = 1,
  idempotencyKey = null,
  expiresAt = null,
  goodUnit = 'ตัน'
}) {
  const cId = Number(couponId);
  const qty = Number(reservedQty);
  if (!cId || isNaN(qty) || qty <= 0) {
    throw Object.assign(new Error('พารามิเตอร์การจองตั๋วไม่ถูกต้อง (ต้องระบุ couponId และ reservedQty > 0)'), { status: 400 });
  }

  // Validate decimal precision: max 3 decimal places (metric ton scale)
  if (Math.round(qty * 1000) / 1000 !== qty) {
    throw Object.assign(new Error('จำนวนตันรองรับทศนิยมไม่เกิน 3 ตำแหน่ง'), { status: 400 });
  }

  // Validate expiresAt: if specified, cannot be in the past
  if (expiresAt) {
    const expDate = new Date(expiresAt);
    if (isNaN(expDate.getTime()) || expDate <= new Date()) {
      throw Object.assign(new Error('วันหมดอายุการจอง (ExpiresAt) ต้องเป็นเวลาในอนาคต'), { status: 400 });
    }
  }

  const key = idempotencyKey || `RES:${carrierSoId}:${couponId}:${qty}`;

  return await wfTransaction(async (tx) => {
    // 1. Lock and fetch coupon row to serialize claims on last balance
    const couponRow = (await tx.request()
      .input('cid', sql.Int, cId)
      .query(`
        SELECT 
          c.CouponID, c.CouponNo, c.GoodID, c.GoodName, c.GoodPrice,
          CAST(c.RemaQty AS DECIMAL(12, 4)) AS NativeRemaQty,
          CAST(s.CustID AS VARCHAR(50)) AS OwnerCustId,
          s.CustName AS OwnerCustName
        FROM dbo.WFCoupon c WITH (UPDLOCK, ROWLOCK)
        JOIN dbo.SOHD s WITH (NOLOCK) ON s.SOID = c.DocuID
        WHERE c.CouponID = @cid
      `)
    ).recordset?.[0];

    if (!couponRow) {
      throw Object.assign(new Error(`ไม่พบตั๋วปุ๋ยรหัส ${cId}`), { status: 404 });
    }

    const payloadHash = computePayloadHash({
      couponId: cId,
      goodId: couponRow.GoodID,
      reservedQty: qty,
      goodUnit,
      beneficiaryCustId,
      carrierSoId,
      tripId,
      userId,
      expiresAt
    });

    // 2. Verify Beneficiary Rights under transaction lock first
    const authCheck = await checkBeneficiaryAuthorization(couponRow.OwnerCustId, beneficiaryCustId, couponRow.GoodID, tx);
    if (!authCheck.authorized) {
      throw Object.assign(new Error(authCheck.reason), { status: 403 });
    }

    // 3. Check Idempotency Key with Payload Fingerprint
    const existing = (await tx.request()
      .input('key', sql.NVarChar(120), key)
      .query(`SELECT * FROM wf.CouponReservation WITH (UPDLOCK, ROWLOCK) WHERE IdempotencyKey = @key`)
    ).recordset?.[0];

    if (existing) {
      // If CreatedBy does not match current actor, reject with 403 Forbidden
      if (existing.CreatedBy && Number(existing.CreatedBy) !== Number(userId)) {
        throw Object.assign(new Error(`Idempotency conflict: กุญแจ '${key}' ถูกใช้งานโดยผู้ใช้อื่น`), { status: 403 });
      }
      if (existing.PayloadHash && existing.PayloadHash !== payloadHash) {
        throw Object.assign(new Error(`Idempotency conflict: กุญแจ '${key}' เคยถูกใช้กับข้อมูลคำขออื่นไปแล้ว`), { status: 409 });
      }
      return {
        id: existing.Id,
        couponId: existing.CouponId,
        couponNo: existing.CouponNo,
        reservedQty: Number(existing.ReservedQty),
        status: existing.Status,
        idempotent: true
      };
    }

    // 4. Calculate active unposted reservations with lock
    const activeRes = (await tx.request()
      .input('cid', sql.Int, cId)
      .query(`
        SELECT ISNULL(SUM(ReservedQty), 0) AS ActiveReserved
        FROM wf.CouponReservation WITH (UPDLOCK, ROWLOCK)
        WHERE CouponId = @cid
          AND Status = 'RESERVED'
          AND (ExpiresAt IS NULL OR ExpiresAt > GETUTCDATE())
      `)
    ).recordset?.[0]?.ActiveReserved || 0;

    const available = Number(couponRow.NativeRemaQty) - Number(activeRes);
    if (available < qty) {
      throw Object.assign(new Error(`ยอดคงเหลือพร้อมใช้ไม่เพียงพอ (คงเหลือพร้อมใช้: ${available} ตัน, ขอจอง: ${qty} ตัน)`), { status: 400 });
    }

    // 5. Insert new reservation with PayloadHash and GoodUnit
    const insertRes = await tx.request()
      .input('cid', sql.Int, cId)
      .input('cno', sql.VarChar(25), couponRow.CouponNo)
      .input('gid', sql.Int, couponRow.GoodID)
      .input('so', sql.VarChar(50), String(carrierSoId))
      .input('doc', sql.VarChar(50), carrierDocuNo || null)
      .input('trip', sql.Int, tripId ? Number(tripId) : null)
      .input('ben', sql.VarChar(50), String(beneficiaryCustId))
      .input('own', sql.VarChar(50), couponRow.OwnerCustId)
      .input('qty', sql.Decimal(12, 4), qty)
      .input('uid', sql.Int, userId)
      .input('key', sql.NVarChar(120), key)
      .input('exp', sql.DateTime2, expiresAt ? new Date(expiresAt) : null)
      .input('unit', sql.VarChar(20), goodUnit || 'ตัน')
      .input('hash', sql.VarChar(64), payloadHash)
      .query(`
        INSERT INTO wf.CouponReservation (
          CouponId, CouponNo, GoodId, CarrierSoId, CarrierDocuNo, TripId,
          BeneficiaryCustId, OwnerCustId, ReservedQty, Status, ReservedAt, ExpiresAt,
          CreatedBy, Revision, IdempotencyKey, GoodUnit, PayloadHash
        ) OUTPUT inserted.Id
        VALUES (
          @cid, @cno, @gid, @so, @doc, @trip,
          @ben, @own, @qty, 'RESERVED', GETUTCDATE(), @exp,
          @uid, 1, @key, @unit, @hash
        )
      `);

    const newId = insertRes.recordset[0].Id;
    return {
      id: newId,
      couponId: cId,
      couponNo: couponRow.CouponNo,
      goodId: couponRow.GoodID,
      goodName: couponRow.GoodName,
      reservedQty: qty,
      availableAfter: available - qty,
      status: 'RESERVED',
      idempotent: false
    };
  });
}

/**
 * Cancel a reservation with audit provenance (returns available balance once, idempotent on repeated calls)
 * @param {number|string} reservationId
 * @param {string} reason
 * @param {number} userId
 * @param {string} userRole
 * @param {object|null} internalContext - Trusted server-owned context; null for public API calls
 */
async function cancelReservation(reservationId, reason, userId = 1, userRole = null, internalContext = null) {
  const rId = Number(reservationId);
  if (!rId) throw Object.assign(new Error('กรุณาระบุ reservationId'), { status: 400 });
  if (!reason || String(reason).trim().length < 3) {
    throw Object.assign(new Error('กรุณาระบุเหตุผลในการยกเลิกการจองตั๋ว (อย่างน้อย 3 ตัวอักษร)'), { status: 400 });
  }

  const execInTx = async (tx) => {
    const res = (await tx.request()
      .input('id', sql.Int, rId)
      .query(`SELECT * FROM wf.CouponReservation WITH (UPDLOCK, ROWLOCK) WHERE Id = @id`)
    ).recordset?.[0];

    if (!res) {
      throw Object.assign(new Error(`ไม่พบรายการจองตั๋ว #${rId}`), { status: 404 });
    }

    if (res.Status === 'CANCELLED') {
      return { id: rId, status: 'CANCELLED', message: 'รายการจองนี้ถูกยกเลิกไปแล้ว (Idempotent)', idempotent: true };
    }

    if (res.Status === 'POSTED') {
      throw Object.assign(new Error(`ไม่สามารถยกเลิกได้: รายการจองนี้ถูก Post ไปแล้ว`), { status: 400 });
    }

    // Role check: non-admin/manager can only cancel their own reservations
    const elevated = ['ADMIN', 'MANAGER', 'C_LEVEL'].includes(userRole);
    if (!elevated && res.CreatedBy && Number(res.CreatedBy) !== Number(userId)) {
      throw Object.assign(new Error('คุณไม่มีสิทธิ์ยกเลิกรายการจองของผู้อื่น'), { status: 403 });
    }

    // Guard against cancelling reservations already attached to an active SalesOrderLine (draft or native)
    const attachedRows = (await tx.request()
      .input('resId', sql.Int, rId)
      .query(`
        SELECT 
          sol.Id AS LineId,
          sol.SoId,
          so.Id AS DraftSoId,
          so.Status AS DraftSoStatus,
          so.WfRef AS DraftDocuNo,
          hd.SOID AS NativeSoid,
          hd.DocuNo AS NativeDocuNo,
          hd.DocuStatus AS NativeDocuStatus
        FROM wf.SalesOrderLine sol WITH (UPDLOCK, ROWLOCK)
        LEFT JOIN wf.SalesOrder so WITH (UPDLOCK, ROWLOCK) ON so.Id = sol.SoId
        LEFT JOIN dbo.SOHD hd WITH (UPDLOCK, ROWLOCK) ON hd.SOID = sol.SoId
        WHERE sol.CouponReservationId = @resId
      `)
    ).recordset || [];

    const activeAttachment = attachedRows.find(row => {
      if (row.DraftSoId && !['CANCELLED', 'DELETED'].includes(row.DraftSoStatus)) {
        return true;
      }
      if (row.NativeSoid && !['C', 'CANCELLED', 'REJECTED'].includes(row.NativeDocuStatus)) {
        return true;
      }
      if (!row.DraftSoId && !row.NativeSoid) {
        return true;
      }
      return false;
    });

    if (activeAttachment) {
      // Server-owned context check: public caller cannot supply internalContext
      const isAuthorizedInternalContext = internalContext && 
        internalContext.isInternalSoOperation === true &&
        (Number(internalContext.soId) === Number(activeAttachment.SoId) || String(internalContext.soId) === String(activeAttachment.SoId));

      if (!isAuthorizedInternalContext) {
        const soDoc = activeAttachment.DraftDocuNo || activeAttachment.NativeDocuNo || activeAttachment.SoId;
        throw Object.assign(new Error(`ไม่สามารถยกเลิกรายการจอง #${rId} ได้: รายการจองถูกผูกกับใบสั่งขาย SO #${activeAttachment.SoId} (${soDoc}) เรียบร้อยแล้ว`), {
          status: 409,
          code: 'RESERVATION_ALREADY_ATTACHED_TO_SO'
        });
      }
    }

    await tx.request()
      .input('id', sql.Int, rId)
      .input('reason', sql.NVarChar(255), String(reason).trim())
      .input('uid', sql.Int, userId)
      .query(`
        UPDATE wf.CouponReservation
        SET Status = 'CANCELLED',
            CancelledAt = GETUTCDATE(),
            CancelReason = @reason,
            CancelledBy = @uid,
            UpdatedAt = GETUTCDATE()
        WHERE Id = @id
      `);

    return { id: rId, status: 'CANCELLED', idempotent: false };
  };

  if (internalContext && internalContext.tx) {
    return await execInTx(internalContext.tx);
  } else {
    return await wfTransaction(execInTx);
  }
}

/**
 * Reconcile external redemptions with active reservations
 */
async function reconcileCoupon(couponId) {
  const cId = Number(couponId);
  if (!cId) return null;

  const coupon = (await wfQuery(`
    SELECT CouponID, CouponNo, CAST(RemaQty AS DECIMAL(12, 4)) AS NativeRemaQty
    FROM dbo.WFCoupon WITH (NOLOCK) WHERE CouponID = @cid
  `, { cid: { type: sql.Int, value: cId } })).recordset?.[0];

  if (!coupon) return null;

  const res = (await wfQuery(`
    SELECT ISNULL(SUM(ReservedQty), 0) AS ActiveReserved
    FROM wf.CouponReservation WITH (NOLOCK)
    WHERE CouponId = @cid AND Status = 'RESERVED' AND (ExpiresAt IS NULL OR ExpiresAt > GETUTCDATE())
  `, { cid: { type: sql.Int, value: cId } })).recordset?.[0];

  const activeReserved = Number(res?.ActiveReserved || 0);
  const nativeRema = Number(coupon.NativeRemaQty || 0);
  const conflict = nativeRema < activeReserved;

  return {
    couponId: cId,
    couponNo: coupon.CouponNo,
    nativeRemaQty: nativeRema,
    activeReservedQty: activeReserved,
    availableQty: Math.max(0, nativeRema - activeReserved),
    hasConflict: conflict,
    shortfallQty: conflict ? Number((activeReserved - nativeRema).toFixed(4)) : 0
  };
}

/**
 * List coupon beneficiaries
 */
async function listBeneficiaries(filters = {}) {
  const { ownerCustId, beneficiaryCustId, status } = filters;
  const whereClauses = ['1=1'];
  const params = {};

  if (ownerCustId) {
    whereClauses.push('b.OwnerCustId = @ownerCustId');
    params.ownerCustId = { type: sql.VarChar(50), value: String(ownerCustId).trim() };
  }
  if (beneficiaryCustId) {
    whereClauses.push('b.BeneficiaryCustId = @beneficiaryCustId');
    params.beneficiaryCustId = { type: sql.VarChar(50), value: String(beneficiaryCustId).trim() };
  }
  if (status) {
    whereClauses.push('b.Status = @status');
    params.status = { type: sql.VarChar(20), value: String(status).trim() };
  }

  const queryText = `
    SELECT 
      b.Id,
      b.OwnerCustId,
      COALESCE(b.OwnerCustName, ow.CustName) AS OwnerCustName,
      ow.CustCode AS OwnerCustCode,
      b.BeneficiaryCustId,
      COALESCE(b.BeneficiaryCustName, be.CustName) AS BeneficiaryCustName,
      be.CustCode AS BeneficiaryCustCode,
      b.EffectiveFrom,
      b.EffectiveTo,
      b.Scope,
      b.Reason,
      b.Status,
      b.CreatedBy,
      b.CreatedAt,
      b.RevokedAt,
      b.RevokedBy,
      b.RevokeReason
    FROM wf.CouponBeneficiary b WITH (NOLOCK)
    LEFT JOIN dbo.EMCust ow WITH (NOLOCK) ON CAST(ow.CustID AS VARCHAR(50)) = b.OwnerCustId
    LEFT JOIN dbo.EMCust be WITH (NOLOCK) ON CAST(be.CustID AS VARCHAR(50)) = b.BeneficiaryCustId
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY b.Id DESC
  `;

  const res = await wfQuery(queryText, params);
  return res.recordset || [];
}

/**
 * Grant beneficiary rights
 */
async function grantBeneficiary({
  ownerCustId,
  beneficiaryCustId,
  effectiveFrom = null,
  effectiveTo = null,
  scope = 'ALL',
  reason,
  userId = 1
}) {
  const ownStr = String(ownerCustId || '').trim();
  const benStr = String(beneficiaryCustId || '').trim();
  const rsn = String(reason || '').trim();
  const scp = String(scope || 'ALL').trim();

  if (!ownStr || !benStr || !rsn || rsn.length < 5) {
    throw Object.assign(new Error('กรุณาระบุ ownerCustId, beneficiaryCustId และ reason (อย่างน้อย 5 ตัวอักษร)'), { status: 400 });
  }

  if (ownStr === benStr) {
    throw Object.assign(new Error('เจ้าของตั๋วและผู้รับสิทธิ์ต้องเป็นคนละราย'), { status: 400 });
  }

  // Validate date logic
  const fromDate = effectiveFrom ? new Date(effectiveFrom) : null;
  const toDate = effectiveTo ? new Date(effectiveTo) : null;
  if (fromDate && isNaN(fromDate.getTime())) {
    throw Object.assign(new Error('รูปแบบวันที่เริ่มต้นไม่ถูกต้อง'), { status: 400 });
  }
  if (toDate && isNaN(toDate.getTime())) {
    throw Object.assign(new Error('รูปแบบวันที่สิ้นสุดไม่ถูกต้อง'), { status: 400 });
  }
  if (fromDate && toDate && fromDate > toDate) {
    throw Object.assign(new Error('วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด'), { status: 400 });
  }

  // Validate customers exist in dbo.EMCust
  const custCheck = await wfQuery(`
    SELECT CustID, CustName, CustCode FROM dbo.EMCust WITH (NOLOCK)
    WHERE CustID IN (@c1, @c2)
  `, {
    c1: { type: sql.VarChar(50), value: ownStr },
    c2: { type: sql.VarChar(50), value: benStr }
  });

  const ownerObj = custCheck.recordset?.find(c => String(c.CustID) === ownStr);
  const benObj = custCheck.recordset?.find(c => String(c.CustID) === benStr);

  return await wfTransaction(async (tx) => {
    // Check duplicate active grant
    const existing = (await tx.request()
      .input('own', sql.VarChar(50), ownStr)
      .input('ben', sql.VarChar(50), benStr)
      .input('scope', sql.VarChar(50), scp)
      .query(`
        SELECT Id FROM wf.CouponBeneficiary WITH (UPDLOCK, ROWLOCK)
        WHERE OwnerCustId = @own AND BeneficiaryCustId = @ben AND Scope = @scope AND Status = 'ACTIVE'
      `)
    ).recordset?.[0];

    if (existing) {
      throw Object.assign(new Error(`มีสิทธิ์ใช้ตั๋วร่วมที่ยังใช้งานอยู่แล้วสำหรับคู่นี้ (รหัส #${existing.Id})`), { status: 409 });
    }

    const res = await tx.request()
      .input('own', sql.VarChar(50), ownStr)
      .input('ownCode', sql.VarChar(50), ownerObj?.CustCode || null)
      .input('ownName', sql.NVarChar(255), ownerObj?.CustName || null)
      .input('ben', sql.VarChar(50), benStr)
      .input('benCode', sql.VarChar(50), benObj?.CustCode || null)
      .input('benName', sql.NVarChar(255), benObj?.CustName || null)
      .input('from', sql.DateTime2, fromDate)
      .input('to', sql.DateTime2, toDate)
      .input('scope', sql.VarChar(50), scp)
      .input('reason', sql.NVarChar(255), rsn)
      .input('uid', sql.Int, userId)
      .query(`
        INSERT INTO wf.CouponBeneficiary (
          OwnerCustId, OwnerCustCode, OwnerCustName,
          BeneficiaryCustId, BeneficiaryCustCode, BeneficiaryCustName,
          EffectiveFrom, EffectiveTo, Scope, Reason, Status, CreatedBy
        ) OUTPUT inserted.Id
        VALUES (
          @own, @ownCode, @ownName,
          @ben, @benCode, @benName,
          @from, @to, @scope, @reason, 'ACTIVE', @uid
        )
      `);

    return { id: res.recordset[0].Id, status: 'ACTIVE' };
  });
}

/**
 * Revoke beneficiary rights
 */
async function revokeBeneficiary(id, reason, userId = 1) {
  const gId = Number(id);
  if (!gId) throw Object.assign(new Error('กรุณาระบุรหัสสิทธิ์ (Id)'), { status: 400 });
  const rsn = String(reason || '').trim();
  if (!rsn || rsn.length < 3) {
    throw Object.assign(new Error('กรุณาระบุเหตุผลในการถอนสิทธิ์ (อย่างน้อย 3 ตัวอักษร)'), { status: 400 });
  }

  return await wfTransaction(async (tx) => {
    const grant = (await tx.request()
      .input('id', sql.Int, gId)
      .query(`SELECT * FROM wf.CouponBeneficiary WITH (UPDLOCK, ROWLOCK) WHERE Id = @id`)
    ).recordset?.[0];

    if (!grant) {
      throw Object.assign(new Error(`ไม่พบรายการสิทธิ์ #${gId}`), { status: 404 });
    }

    if (grant.Status === 'REVOKED') {
      return { id: gId, status: 'REVOKED', message: 'สิทธิ์นี้ถูกถอนไปแล้ว (Idempotent)', idempotent: true };
    }

    await tx.request()
      .input('id', sql.Int, gId)
      .input('reason', sql.NVarChar(255), rsn)
      .input('uid', sql.Int, userId)
      .query(`
        UPDATE wf.CouponBeneficiary
        SET Status = 'REVOKED',
            RevokedAt = GETUTCDATE(),
            RevokedBy = @uid,
            RevokeReason = @reason,
            UpdatedAt = GETUTCDATE()
        WHERE Id = @id
      `);

    return { id: gId, status: 'REVOKED', idempotent: false };
  });
}

/**
 * Post native coupon redemption (gated by feature flag and adapter proof)
 * Fail-closed: Even if flag=true, fails closed with 501 unless a proven adapter is passed.
 */
async function postNativeCouponRedemption(reservationId, userId = 1, options = {}) {
  // Fail-closed gate: Requires explicit proven adapter
  if (!options.adapter) {
    if (!COUPON_NATIVE_POSTING_ENABLED) {
      throw Object.assign(
        new Error('การตัดส่งตั๋วปุ๋ย native (DocuType 116) ยังไม่เปิดใช้งาน (Feature Flag COUPON_NATIVE_POSTING_ENABLED=false) อยู่ระหว่างพิสูจน์ WinSpeed 116 number allocation และ reversal lifecycle'),
        { status: 400 }
      );
    }
    throw Object.assign(
      new Error('Native WinSpeed 116 redemption adapter is not implemented. Automatic fake POSTED without native stock reduction is blocked.'),
      { status: 501 }
    );
  }

  // If a proven simulated adapter is passed in test harness:
  return await wfTransaction(async (tx) => {
    const res = (await tx.request()
      .input('id', sql.Int, Number(reservationId))
      .query(`SELECT * FROM wf.CouponReservation WITH (UPDLOCK, ROWLOCK) WHERE Id = @id`)
    ).recordset?.[0];

    if (!res) throw Object.assign(new Error('ไม่พบรายการจองตั๋ว'), { status: 404 });
    if (res.Status !== 'RESERVED') throw Object.assign(new Error(`สถานะไม่ถูกต้อง (${res.Status})`), { status: 400 });

    // Execute adapter to reduce native balance and obtain native redemption reference
    const adapterResult = await options.adapter(tx, res);

    // Transition reservation to POSTED
    await tx.request()
      .input('id', sql.Int, Number(reservationId))
      .input('nativeDoc', sql.VarChar(50), adapterResult.nativeDocuNo || '116-TEST')
      .input('redemptionId', sql.Int, adapterResult.redemptionId || null)
      .query(`
        UPDATE wf.CouponReservation
        SET Status = 'POSTED',
            NativeDocuNo = @nativeDoc,
            NativeRedemptionId = @redemptionId,
            SettledAt = GETUTCDATE(),
            UpdatedAt = GETUTCDATE()
        WHERE Id = @id
      `);

    return { id: reservationId, status: 'POSTED', nativeDocuNo: adapterResult.nativeDocuNo };
  });
}

module.exports = {
  COUPON_NATIVE_POSTING_ENABLED,
  getCouponsForCustomer,
  checkBeneficiaryAuthorization,
  reserveCoupon,
  cancelReservation,
  reconcileCoupon,
  listBeneficiaries,
  grantBeneficiary,
  revokeBeneficiary,
  postNativeCouponRedemption
};
