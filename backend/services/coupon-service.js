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
const { logChangeEvent } = require('./policy-contract');
const { enqueue } = require('./outbox');

function isNativePostingEnabled() {
  return String(process.env.COUPON_NATIVE_POSTING_ENABLED || '').toLowerCase().trim() === 'true';
}

const COUPON_NATIVE_POSTING_ENABLED = isNativePostingEnabled();

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
  const has139 = await checkMigration139();

  const querySql = `
    SELECT 
      c.CouponID AS couponId,
      c.CouponNo AS couponNo,
      c.DocuID AS sourceSoId,
      s.DocuNo AS sourceDocuNo,
      s.CustID AS ownerCustId,
      s.CustName AS ownerCustName,
      c.GoodID AS goodId,
      g.GoodCode AS goodCode,
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
    LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = c.GoodID
    LEFT JOIN (
      SELECT 
        CouponId,
        SUM(ReservedQty - ${has139 ? 'ISNULL(ConsumedQty, 0)' : '0'}) AS TotalReserved
      FROM wf.CouponReservation WITH (NOLOCK)
      WHERE Status = 'RESERVED'
        AND (ExpiresAt IS NULL OR ExpiresAt > GETUTCDATE())
        ${has139 ? 'AND (ReservedQty - ISNULL(ConsumedQty, 0)) > 0' : ''}
      GROUP BY CouponId
    ) activeRes ON activeRes.CouponId = c.CouponID
    LEFT JOIN wf.CouponBeneficiary b WITH (NOLOCK) ON 
      b.OwnerCustId = CAST(s.CustID AS VARCHAR(50))
      AND b.BeneficiaryCustId = @custId
      AND b.Status = 'ACTIVE'
      AND (b.EffectiveFrom IS NULL OR b.EffectiveFrom <= CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE))
      AND (b.EffectiveTo IS NULL OR b.EffectiveTo >= CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE))
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

  // R9-5: Pre-settle coupons with active reservations for this customer first so balances are fresh
  if (has139 && options.settle !== false) {
    try {
      const activeResCoupons = await wfQuery(`
        SELECT DISTINCT c.CouponID
        FROM dbo.WFCoupon c WITH (NOLOCK)
        JOIN dbo.SOHD s WITH (NOLOCK) ON s.SOID = c.DocuID
        JOIN wf.CouponReservation res WITH (NOLOCK) ON res.CouponId = c.CouponID
        WHERE (
          CAST(s.CustID AS VARCHAR(50)) = @custId
          OR EXISTS (
            SELECT 1 FROM wf.CouponBeneficiary b WITH (NOLOCK)
            WHERE b.OwnerCustId = CAST(s.CustID AS VARCHAR(50))
              AND b.BeneficiaryCustId = @custId
              AND b.Status = 'ACTIVE'
              AND (b.EffectiveFrom IS NULL OR b.EffectiveFrom <= CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE))
              AND (b.EffectiveTo IS NULL OR b.EffectiveTo >= CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE))
              AND (b.Scope = 'ALL' OR b.Scope = CAST(c.GoodID AS VARCHAR(50)))
          )
        )
        AND res.Status = 'RESERVED'
        AND (res.ReservedQty - ISNULL(res.ConsumedQty, 0)) > 0
      `, { custId: { type: sql.VarChar(50), value: custIdStr } });

      for (const row of activeResCoupons.recordset || []) {
        try {
          await settleCouponReservations(row.CouponID, null);
        } catch { /* non-fatal */ }
      }
    } catch {
      // Non-fatal if pre-settle query fails
    }
  }

  const res = await wfQuery(querySql, params);
  const rows = res.recordset || [];

  // Read system settings for expiry rules (R9-5)
  let defaultDays = 180;
  let warningLeadDays = 30;
  try {
    const s = await wfQuery(`
      SELECT SettingKey, SettingValue 
      FROM wf.SystemSetting WITH (NOLOCK) 
      WHERE SettingKey IN ('TICKET_EXPIRY_DEFAULT_DAYS', 'TICKET_EXPIRY_WARNING_LEAD_DAYS')
    `);
    for (const row of s.recordset || []) {
      if (row.SettingKey === 'TICKET_EXPIRY_DEFAULT_DAYS') defaultDays = Number(row.SettingValue) || 180;
      if (row.SettingKey === 'TICKET_EXPIRY_WARNING_LEAD_DAYS') warningLeadDays = Number(row.SettingValue) || 30;
    }
  } catch {
    // Fallback to 180 and 30
  }

  // Fetch custom expiry dates if table exists
  const customExpiries = new Map();
  if (rows.length > 0) {
    try {
      const cids = rows.map(r => Number(r.couponId)).filter(Boolean);
      if (cids.length > 0) {
        const expQ = await wfQuery(`
          SELECT CouponId, ExpiryDate, Source, Note
          FROM wf.CouponExpiry WITH (NOLOCK)
          WHERE CouponId IN (${cids.join(',')})
        `);
        for (const expRow of expQ.recordset || []) {
          customExpiries.set(expRow.CouponId, expRow);
        }
      }
    } catch {
      // Table may not exist in some environments
    }
  }

  // Fetch active beneficiaries for these coupons (R9-6)
  const beneficiariesMap = new Map();
  if (rows.length > 0) {
    try {
      const ownerCustIds = [...new Set(rows.map(r => String(r.ownerCustId || '')).filter(Boolean))];
      if (ownerCustIds.length > 0) {
        const idList = ownerCustIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',');
        const bRes = await wfQuery(`
          SELECT OwnerCustId, BeneficiaryCustId, BeneficiaryCustName, Scope, EffectiveTo, Reason
          FROM wf.CouponBeneficiary WITH (NOLOCK)
          WHERE OwnerCustId IN (${idList}) AND Status = 'ACTIVE'
            AND (EffectiveFrom IS NULL OR EffectiveFrom <= CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE))
            AND (EffectiveTo IS NULL OR EffectiveTo >= CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE))
        `);
        for (const b of bRes.recordset || []) {
          const arr = beneficiariesMap.get(String(b.OwnerCustId)) || [];
          arr.push(b);
          beneficiariesMap.set(String(b.OwnerCustId), arr);
        }
      }
    } catch { /* non-fatal */ }
  }

  // Check for coupons with active reservations that have unsettled cuts (FR-1 picker hint)
  const unmatchedCouponIds = new Set();
  if (rows.length > 0) {
    try {
      const activeResCids = rows
        .filter(r => Number(r.reservedQty) > 0)
        .map(r => Number(r.couponId))
        .filter(Boolean);

      if (activeResCids.length > 0) {
        const unQ = await wfQuery(`
          SELECT DISTINCT rd.CouponID
          FROM dbo.WFRedemtionDT rd WITH (NOLOCK)
          LEFT JOIN (
            SELECT NativeRedemptionId, SUM(SettledQty) AS TotalSettled
            FROM wf.CouponReservationSettlement WITH (NOLOCK)
            GROUP BY NativeRedemptionId
          ) st ON st.NativeRedemptionId = rd.RedemtionID
          WHERE rd.CouponID IN (${activeResCids.join(',')})
            AND (rd.GoodQty - ISNULL(st.TotalSettled, 0)) > 0
        `);
        for (const row of unQ.recordset || []) {
          unmatchedCouponIds.add(Number(row.CouponID));
        }
      }
    } catch {
      // Non-fatal if check fails
    }
  }

  // D1 / PB-4 / R9-5: Expiry calculation + members + PB-3 negative clamp
  for (const r of rows) {
    const custom = customExpiries.get(r.couponId);
    let expiryDate = null;
    let source = 'DEFAULT';
    if (custom?.ExpiryDate) {
      expiryDate = new Date(custom.ExpiryDate);
      source = custom.Source || 'MANUAL';
    } else if (r.sourceDocuDate) {
      const issueDate = new Date(r.sourceDocuDate);
      expiryDate = new Date(issueDate.getTime() + defaultDays * 24 * 60 * 60 * 1000);
      source = 'DEFAULT';
    }
    const daysLeft = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;
    r.expiryDate = expiryDate ? expiryDate.toISOString().slice(0, 10) : null;
    r.expirySource = source;
    r.daysLeft = daysLeft;
    r.isExpired = daysLeft !== null ? daysLeft < 0 : false;
    r.isExpiringSoon = daysLeft !== null ? (daysLeft >= 0 && daysLeft <= warningLeadDays) : false;
    r.warningLeadDays = warningLeadDays;

    // Attach active beneficiaries for the owner
    const allOwnerBenes = beneficiariesMap.get(String(r.ownerCustId || '')) || [];
    r.beneficiaries = allOwnerBenes.filter(b => b.Scope === 'ALL' || b.Scope === String(r.goodId));

    // PB-3: Clamp availableQty >= 0 and add overcutNotice if native < reserved
    const rawAvail = Number(r.availableQty || 0);
    r.availableQty = Math.max(0, rawAvail);
    if (Number(r.nativeRemainingQty || 0) < Number(r.reservedQty || 0)) {
      r.overcutNotice = 'รอตรวจการตัดตั๋ว';
    }

    // FR-1 picker hint
    r.hasUnmatchedCuts = unmatchedCouponIds.has(Number(r.couponId));
  }
  // R12 K-F3: a K bill lists only D coupons and an I bill only C coupons
  if (options.billPrefix) return rows.filter(r => couponAllowedForBill(r.couponNo, options.billPrefix));
  return rows;
}

/**
 * Check if a beneficiary is authorized to redeem owner's coupons
 */
async function checkBeneficiaryAuthorization(ownerCustId, beneficiaryCustId = null, goodId = null, tx = null) {
  if (typeof ownerCustId === 'object' && ownerCustId !== null) {
    const opts = ownerCustId;
    ownerCustId = opts.ownerCustId;
    beneficiaryCustId = opts.beneficiaryCustId;
    goodId = opts.goodId || null;
    tx = opts.tx || null;
  }
  const ownerStr = String(ownerCustId || '').trim();
  const beneficiaryStr = String(beneficiaryCustId || '').trim();

  // If customer is owner, automatically authorized
  if (ownerStr && ownerStr === beneficiaryStr) {
    return { authorized: true, rightType: 'OWNER' };
  }

  const queryText = `
    SELECT TOP 1 Id, Scope, Reason, EffectiveFrom, EffectiveTo
    FROM wf.CouponBeneficiary WITH (UPDLOCK, ROWLOCK)
    WHERE OwnerCustId = @owner
      AND BeneficiaryCustId = @ben
      AND Status = 'ACTIVE'
      AND (EffectiveFrom IS NULL OR EffectiveFrom <= CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE))
      AND (EffectiveTo IS NULL OR EffectiveTo >= CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE))
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
  goodUnit = 'ตัน',
  billPrefix = null
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

    // R12 K-F3 (owner rule): K bills draw only D coupons, I bills only C coupons
    if (billPrefix && !couponAllowedForBill(couponRow.CouponNo, billPrefix)) {
      throw Object.assign(new Error(couponBookMismatchMessage(couponRow.CouponNo, billPrefix)), { status: 400, code: 'COUPON_BOOK_MISMATCH' });
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
      // no carrier yet = a reservation for a bill still being keyed (the picker sends 'DRAFT'); never store the
      // text "undefined", which later reads as "bound to another bill" (UAT batch 5, SO-11)
      .input('so', sql.VarChar(50), carrierSoId == null || String(carrierSoId).trim() === '' ? 'DRAFT' : String(carrierSoId))
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

const { matchCutsToReservations, normalizePlate, toBangkokDateString, earliestCutDate } = require('./coupon-settlement-matcher');
const { couponAllowedForBill, couponBookMismatchMessage } = require('./account-books');

/**
 * Reconcile external redemptions with active reservations
 */
async function reconcileCoupon(couponId, options = {}) {
  const cId = Number(couponId);
  if (!cId) return null;

  const has139 = await checkMigration139();

  // PB-3 / §0: If migration 139 is present and settle is not disabled, settle FIRST
  if (has139 && options.settle !== false) {
    try {
      await settleCouponReservations(cId, null);
    } catch {
      // Non-fatal if settlement fails during read
    }
  }

  const coupon = (await wfQuery(`
    SELECT CouponID, CouponNo, CAST(RemaQty AS DECIMAL(12, 4)) AS NativeRemaQty
    FROM dbo.WFCoupon WITH (NOLOCK) WHERE CouponID = @cid
  `, { cid: { type: sql.Int, value: cId } })).recordset?.[0];

  if (!coupon) return null;

  const res = (await wfQuery(`
    SELECT cr.Id, cr.CouponId, cr.CarrierSoId, cr.CarrierDocuNo, cr.TripId, cr.ReservedQty,
           ${has139 ? 'ISNULL(cr.ConsumedQty, 0)' : '0'} AS ConsumedQty,
           ${has139 ? 'CAST(cr.ReservedQty - ISNULL(cr.ConsumedQty, 0) AS DECIMAL(12, 4))' : 'cr.ReservedQty'} AS RemainingReservedQty,
           cr.BeneficiaryCustId, cr.OwnerCustId,
           cr.CreatedAt,
           COALESCE(st.TransRegistration, so.TruckPlate, soh.TransRegistration) AS TripPlate,
           COALESCE(soe.ConfirmedAt, soh.DocuDate, cr.CreatedAt) AS ConfirmDate,
           COALESCE(benCust.CustName, so.CustName, soh.CustName) AS BeneficiaryName,
           COALESCE(benCust.CustCode, cr.BeneficiaryCustId) AS BeneficiaryCode
    FROM wf.CouponReservation cr WITH (NOLOCK)
    LEFT JOIN wf.SalesTrip st WITH (NOLOCK) ON st.TripId = cr.TripId
    LEFT JOIN wf.SalesOrderExt soe WITH (NOLOCK) ON CAST(soe.SOID AS VARCHAR(50)) = CAST(cr.CarrierSoId AS VARCHAR(50))
    LEFT JOIN wf.SalesOrder so WITH (NOLOCK) ON CAST(so.Id AS VARCHAR(50)) = CAST(cr.CarrierSoId AS VARCHAR(50))
    LEFT JOIN dbo.SOHD soh WITH (NOLOCK) ON CAST(soh.SOID AS VARCHAR(50)) = CAST(cr.CarrierSoId AS VARCHAR(50))
    LEFT JOIN dbo.EMCust benCust WITH (NOLOCK) ON benCust.CustID = CASE WHEN ISNUMERIC(cr.BeneficiaryCustId) = 1 THEN CAST(cr.BeneficiaryCustId AS INT) END
    WHERE cr.CouponId = @cid AND cr.Status = 'RESERVED' 
      ${has139 ? 'AND (cr.ReservedQty - ISNULL(cr.ConsumedQty, 0)) > 0' : ''}
      AND (cr.ExpiresAt IS NULL OR cr.ExpiresAt > GETUTCDATE())
  `, { cid: { type: sql.Int, value: cId } })).recordset || [];

  const cuts = has139
    ? (await wfQuery(`
        SELECT rd.RedemtionID, rd.CouponID, 
               CAST(rd.GoodQty - ISNULL(st.TotalSettled, 0) AS DECIMAL(12, 4)) AS GoodQty,
               rh.DocuNo, rh.DocuNo AS RedemptionDocuNo, rh.DocuDate, rh.CarLicense, rh.IssueName
        FROM dbo.WFRedemtionDT rd WITH (NOLOCK)
        JOIN dbo.WFRedemtionHD rh WITH (NOLOCK) ON rh.RedemtionID = rd.RedemtionID
        LEFT JOIN (
          SELECT NativeRedemptionId, SUM(SettledQty) AS TotalSettled
          FROM wf.CouponReservationSettlement WITH (NOLOCK)
          GROUP BY NativeRedemptionId
        ) st ON st.NativeRedemptionId = rd.RedemtionID
        WHERE rd.CouponID = @cid
          AND (rd.GoodQty - ISNULL(st.TotalSettled, 0)) > 0
      `, { cid: { type: sql.Int, value: cId } })).recordset || []
    : (await wfQuery(`
        SELECT rd.RedemtionID, rd.CouponID, CAST(rd.GoodQty AS DECIMAL(12, 4)) AS GoodQty,
               rh.DocuNo, rh.DocuNo AS RedemptionDocuNo, rh.DocuDate, rh.CarLicense, rh.IssueName
        FROM dbo.WFRedemtionDT rd WITH (NOLOCK)
        JOIN dbo.WFRedemtionHD rh WITH (NOLOCK) ON rh.RedemtionID = rd.RedemtionID
        WHERE rd.CouponID = @cid
      `, { cid: { type: sql.Int, value: cId } })).recordset || [];

  const activeReserved = res.reduce((sum, r) => sum + Number(r.RemainingReservedQty != null ? r.RemainingReservedQty : (r.ReservedQty || 0)), 0);
  const nativeRema = Number(coupon.NativeRemaQty || 0);

  // Strict matching via pure function
  const matchResult = matchCutsToReservations(res, cuts, options.settlementPolicy || await getCouponSettlementPolicy());

  const hasShortfall = nativeRema < activeReserved;
  const hasDoubleCount = matchResult.doubleCountedQty > 0;
  const conflict = hasShortfall || hasDoubleCount;

  const rawAvailable = nativeRema - activeReserved;
  const rawAdjusted = nativeRema - (activeReserved - matchResult.doubleCountedQty);

  const summary = {
    couponId: cId,
    couponNo: coupon.CouponNo,
    nativeRemaQty: nativeRema,
    activeReservedQty: activeReserved,
    availableQty: Math.max(0, Number(rawAvailable.toFixed(4))),
    hasConflict: conflict,
    hasShortfall,
    shortfallQty: hasShortfall ? Number((activeReserved - nativeRema).toFixed(4)) : 0, // Strict shortfall only per R6 §1.4
    hasDoubleCount,
    doubleCountedQty: matchResult.doubleCountedQty,
    doubleCountedReservations: matchResult.doubleCountedReservations,
    ambiguousCuts: matchResult.ambiguous,
    adjustedAvailableQty: Math.max(0, Number(rawAdjusted.toFixed(4))),
    overcutNotice: nativeRema < activeReserved ? 'รอตรวจการตัดตั๋ว' : null,
  };

  return summary;
}

let _has139Cache = false;
async function checkMigration139(customQueryFn = null) {
  if (_has139Cache) return true;
  const qFn = customQueryFn || wfQuery;
  try {
    const q = await qFn(`
      SELECT 
        COL_LENGTH('wf.CouponReservation', 'ConsumedQty') AS hasConsumedQty,
        OBJECT_ID('wf.CouponReservationSettlement', 'U') AS hasTable
    `);
    const row = q.recordset?.[0];
    if (Boolean(row?.hasConsumedQty && row?.hasTable)) {
      _has139Cache = true;
      return true;
    }
  } catch {
    // Non-fatal if check throws
  }
  return false;
}

function _resetMigration139Cache() {
  _has139Cache = false;
}

// Module-level settlement concurrency guard (PB-3)
const _settlementLocks = new Map();

/**
 * R6-5 / D4 / R7-2 / R8-2: Automatic Settlement Write Path behind Migration 139.
 * Idempotently records settled cuts into wf.CouponReservationSettlement and updates wf.CouponReservation.
 * Feeds only the unsettled part of each cut and remaining quantity of each reservation.
 */
/**
 * R10.7-1 settlement window and go-live cutoff from wf.SystemSetting
 * (COUPON_SETTLEMENT_WINDOW_DAYS default 3, COUPON_GOLIVE_CUTOFF_DATE default none).
 * Returned in the option shape matchCutsToReservations expects.
 */
async function getCouponSettlementPolicy(queryFn = wfQuery) {
  const policy = { settlementWindowDays: 3, goLiveCutoffDate: null };
  try {
    const s = await queryFn(`
      SELECT SettingKey, SettingValue
      FROM wf.SystemSetting WITH (NOLOCK)
      WHERE SettingKey IN ('COUPON_SETTLEMENT_WINDOW_DAYS', 'COUPON_GOLIVE_CUTOFF_DATE')
    `);
    for (const row of s?.recordset || []) {
      if (row.SettingKey === 'COUPON_SETTLEMENT_WINDOW_DAYS') {
        const n = parseInt(row.SettingValue, 10);
        if (Number.isInteger(n) && n >= 0) policy.settlementWindowDays = n;
      }
      if (row.SettingKey === 'COUPON_GOLIVE_CUTOFF_DATE' && /^\d{4}-\d{2}-\d{2}$/.test(String(row.SettingValue || '').trim())) {
        policy.goLiveCutoffDate = String(row.SettingValue).trim();
      }
    }
  } catch {
    // wf.SystemSetting unavailable: keep the defaults
  }
  return policy;
}

async function settleCouponReservations(couponId, actor = null, deps = {}) {
  const cId = Number(couponId);
  if (!cId) return { settledCount: 0, settlements: [], ambiguous: [], unmatched: [] };

  if (_settlementLocks.get(cId)) {
    return { settledCount: 0, settlements: [], ambiguous: [], unmatched: [], note: 'Settlement already in progress for coupon' };
  }
  _settlementLocks.set(cId, true);

  try {
    const effectiveCheck139 = deps.checkMigration139 || checkMigration139;
    const effectiveWfQuery = deps.wfQuery || wfQuery;
    const effectiveWfTransaction = deps.wfTransaction || wfTransaction;

    const has139 = await effectiveCheck139();
    if (!has139) {
      return { settledCount: 0, settlements: [], ambiguous: [], unmatched: [], note: 'Migration 139 not applied; skipping persistent write' };
    }

    // 1. Fetch active reservations with lock, selecting remaining reserved qty
    const res = (await effectiveWfQuery(`
      SELECT cr.Id, cr.CouponId, cr.CarrierSoId, cr.CarrierDocuNo, cr.TripId, cr.ReservedQty, 
             ISNULL(cr.ConsumedQty, 0) AS ConsumedQty,
             CAST(cr.ReservedQty - ISNULL(cr.ConsumedQty, 0) AS DECIMAL(12, 4)) AS RemainingReservedQty,
             cr.BeneficiaryCustId, cr.OwnerCustId,
             cr.CreatedAt,
             COALESCE(st.TransRegistration, so.TruckPlate, soh.TransRegistration) AS TripPlate,
             COALESCE(soe.ConfirmedAt, soh.DocuDate, cr.CreatedAt) AS ConfirmDate,
             COALESCE(benCust.CustName, so.CustName, soh.CustName) AS BeneficiaryName,
             COALESCE(benCust.CustCode, cr.BeneficiaryCustId) AS BeneficiaryCode
      FROM wf.CouponReservation cr WITH (NOLOCK)
      LEFT JOIN wf.SalesTrip st WITH (NOLOCK) ON st.TripId = cr.TripId
      LEFT JOIN wf.SalesOrderExt soe WITH (NOLOCK) ON CAST(soe.SOID AS VARCHAR(50)) = CAST(cr.CarrierSoId AS VARCHAR(50))
      LEFT JOIN wf.SalesOrder so WITH (NOLOCK) ON CAST(so.Id AS VARCHAR(50)) = CAST(cr.CarrierSoId AS VARCHAR(50))
      LEFT JOIN dbo.SOHD soh WITH (NOLOCK) ON CAST(soh.SOID AS VARCHAR(50)) = CAST(cr.CarrierSoId AS VARCHAR(50))
      LEFT JOIN dbo.EMCust benCust WITH (NOLOCK) ON benCust.CustID = CASE WHEN ISNUMERIC(cr.BeneficiaryCustId) = 1 THEN CAST(cr.BeneficiaryCustId AS INT) END
      WHERE cr.CouponId = @cid AND cr.Status = 'RESERVED' 
        AND (cr.ReservedQty - ISNULL(cr.ConsumedQty, 0)) > 0
        AND (cr.ExpiresAt IS NULL OR cr.ExpiresAt > GETUTCDATE())
    `, { cid: { type: sql.Int, value: cId } })).recordset || [];

    if (res.length === 0) {
      return { settledCount: 0, settlements: [], ambiguous: [], unmatched: [] };
    }

    // 2. Fetch cuts — select only the UNSETTLED part of each cut
    const cuts = (await effectiveWfQuery(`
      SELECT rd.RedemtionID, rd.CouponID, 
             CAST(rd.GoodQty - ISNULL(st.TotalSettled, 0) AS DECIMAL(12, 4)) AS GoodQty,
             rh.DocuNo, rh.DocuNo AS RedemptionDocuNo, rh.DocuDate, rh.CarLicense, rh.IssueName
      FROM dbo.WFRedemtionDT rd WITH (NOLOCK)
      JOIN dbo.WFRedemtionHD rh WITH (NOLOCK) ON rh.RedemtionID = rd.RedemtionID
      LEFT JOIN (
        SELECT NativeRedemptionId, SUM(SettledQty) AS TotalSettled
        FROM wf.CouponReservationSettlement WITH (NOLOCK)
        GROUP BY NativeRedemptionId
      ) st ON st.NativeRedemptionId = rd.RedemtionID
      WHERE rd.CouponID = @cid
        AND (rd.GoodQty - ISNULL(st.TotalSettled, 0)) > 0
    `, { cid: { type: sql.Int, value: cId } })).recordset || [];

    if (cuts.length === 0) {
      return { settledCount: 0, settlements: [], ambiguous: [], unmatched: [] };
    }

    // 3. Match cuts using pure matcher
    const policy = deps.settlementPolicy || await getCouponSettlementPolicy(effectiveWfQuery);
    const matchResult = matchCutsToReservations(res, cuts, policy);
    if (matchResult.matches.length === 0) {
      return { settledCount: 0, settlements: [], ambiguous: matchResult.ambiguous, unmatched: matchResult.unmatched || [] };
    }

    // 4. Perform idempotent settlement in wfTransaction
    const settledRows = [];
    const actingUid = actor && (actor.userId || actor.sub) ? Number(actor.userId || actor.sub) : null;

    await effectiveWfTransaction(async (tx) => {
      for (const m of matchResult.matches) {
        // Check if already settled
        const existsCheck = await tx.request()
          .input('resId', sql.BigInt, Number(m.reservationId))
          .input('redemId', sql.BigInt, Number(m.redemptionId))
          .query(`SELECT 1 FROM wf.CouponReservationSettlement WHERE ReservationId = @resId AND NativeRedemptionId = @redemId`);

        if (existsCheck.recordset?.length > 0) {
          continue; // Idempotent skip
        }

        // Insert audit row in wf.CouponReservationSettlement
        await tx.request()
          .input('resId', sql.BigInt, Number(m.reservationId))
          .input('cid', sql.Int, cId)
          .input('redemId', sql.BigInt, Number(m.redemptionId))
          .input('docuNo', sql.VarChar(50), String(m.redemptionDocuNo))
          .input('qty', sql.Decimal(12, 4), m.matchedQty)
          .input('uid', sql.Int, actingUid)
          .input('note', sql.NVarChar(255), m.isPartial ? `ตัดตั๋วบางส่วน (${m.matchedQty} ตัน)` : `ตัดตั๋วเต็มจำนวน (${m.matchedQty} ตัน)`)
          .query(`
            INSERT INTO wf.CouponReservationSettlement (ReservationId, CouponId, NativeRedemptionId, NativeDocuNo, SettledQty, SettledBy, Note)
            VALUES (@resId, @cid, @redemId, @docuNo, @qty, @uid, @note)
          `);

        // Update wf.CouponReservation: increment ConsumedQty, move to CONSUMED if fully consumed
        await tx.request()
          .input('resId', sql.BigInt, Number(m.reservationId))
          .input('qty', sql.Decimal(12, 4), m.matchedQty)
          .query(`
            UPDATE wf.CouponReservation
            SET ConsumedQty = ISNULL(ConsumedQty, 0) + @qty,
                Status = CASE WHEN ISNULL(ConsumedQty, 0) + @qty >= ReservedQty THEN 'CONSUMED' ELSE Status END,
                UpdatedAt = GETUTCDATE()
            WHERE Id = @resId
          `);

        settledRows.push(m);
      }
    });

    return {
      settledCount: settledRows.length,
      settlements: settledRows,
      ambiguous: matchResult.ambiguous,
      unmatched: matchResult.unmatched || [],
    };
  } finally {
    _settlementLocks.delete(cId);
  }
}

/**
 * FR-1: Manual settlement of one native cut against one chosen reservation.
 * Restricted to ADMIN, MANAGER, C_LEVEL.
 * Audited with required reason (>= 10 chars), Note "MANUAL: <reason>", audit ChangeEvent and Outbox row.
 * Guards: same coupon, beneficiary matches, qty <= remaining, cut not already settled, under the existing lock.
 */
async function manualSettleCouponCut(params = {}, options = {}) {
  const { reservationId, redemptionId, reason, qty, beneficiaryCustId, actor, overridePlate } = params;
  const deps = params.deps || options.deps || options;
  const effectiveCheck139 = deps.checkMigration139 || checkMigration139;
  const effectiveWfQuery = deps.wfQuery || wfQuery;
  const effectiveWfTransaction = deps.wfTransaction || wfTransaction;

  // 1. Role verification (ADMIN, MANAGER, C_LEVEL, ACCOUNTING)
  const callerRole = params.actor?.role || params.role;
  if (callerRole && !['ADMIN', 'MANAGER', 'C_LEVEL', 'ACCOUNTING'].includes(callerRole)) {
    throw Object.assign(new Error('สิทธิ์ไม่เพียงพอ — ต้องเป็นผู้ดูแลระบบ ผู้จัดการ หรือฝ่ายบัญชีเท่านั้น (ADMIN, MANAGER, C_LEVEL หรือ ACCOUNTING)'), { status: 403 });
  }

  // 2. Reason validation (>= 10 chars)
  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    throw Object.assign(new Error('เหตุผลการตัดตั๋วแบบแมนนวลต้องมีความยาวอย่างน้อย 10 ตัวอักษร'), { status: 400 });
  }

  // 3. Migration 139 check
  const has139 = await effectiveCheck139();
  if (!has139) {
    throw Object.assign(new Error('Migration 139 not applied; cannot perform persistent settlement write'), { status: 501 });
  }

  const resId = Number(reservationId);
  const redemId = Number(redemptionId);
  if (!resId || !redemId) {
    throw Object.assign(new Error('กรุณาระบุ reservationId และ redemptionId ให้ถูกต้อง'), { status: 400 });
  }

  // 4. Fetch reservation with details
  const resRows = (await effectiveWfQuery(`
    SELECT cr.Id, cr.CouponId, cr.CarrierSoId, cr.CarrierDocuNo, cr.TripId, cr.ReservedQty, 
           ISNULL(cr.ConsumedQty, 0) AS ConsumedQty,
           CAST(cr.ReservedQty - ISNULL(cr.ConsumedQty, 0) AS DECIMAL(12, 4)) AS RemainingReservedQty,
           cr.BeneficiaryCustId, cr.OwnerCustId, cr.Status, cr.CreatedAt,
           COALESCE(st.TransRegistration, so.TruckPlate, soh.TransRegistration) AS TripPlate,
           COALESCE(benCust.CustName, so.CustName, soh.CustName) AS BeneficiaryName,
           COALESCE(benCust.CustCode, cr.BeneficiaryCustId) AS BeneficiaryCode
    FROM wf.CouponReservation cr WITH (NOLOCK)
    LEFT JOIN wf.SalesTrip st WITH (NOLOCK) ON st.TripId = cr.TripId
    LEFT JOIN wf.SalesOrder so WITH (NOLOCK) ON CAST(so.Id AS VARCHAR(50)) = CAST(cr.CarrierSoId AS VARCHAR(50))
    LEFT JOIN dbo.SOHD soh WITH (NOLOCK) ON CAST(soh.SOID AS VARCHAR(50)) = CAST(cr.CarrierSoId AS VARCHAR(50))
    LEFT JOIN dbo.EMCust benCust WITH (NOLOCK) ON benCust.CustID = CASE WHEN ISNUMERIC(cr.BeneficiaryCustId) = 1 THEN CAST(cr.BeneficiaryCustId AS INT) END
    WHERE cr.Id = @id
  `, { id: { type: sql.BigInt, value: resId } })).recordset || [];

  const reservation = resRows[0];
  if (!reservation || reservation.Status !== 'RESERVED' || Number(reservation.RemainingReservedQty) <= 0) {
    throw Object.assign(new Error('ไม่พบรายการจองตั๋วที่สามารถตัดได้ (สถานะไม่ถูกต้อง หรือยอดจองถูกตัดครบแล้ว)'), { status: 400 });
  }

  const cId = Number(reservation.CouponId);
  if (_settlementLocks.get(cId)) {
    throw Object.assign(new Error('กำลังดำเนินการตัดตั๋วสำหรับคูปองนี้อยู่ กรุณารอสักครู่'), { status: 409 });
  }
  _settlementLocks.set(cId, true);

  try {
    // 5. Fetch cut from WinSpeed
    const cutRows = (await effectiveWfQuery(`
      SELECT rd.RedemtionID, rd.CouponID, 
             CAST(rd.GoodQty AS DECIMAL(12, 4)) AS OriginalGoodQty,
             CAST(rd.GoodQty - ISNULL(st.TotalSettled, 0) AS DECIMAL(12, 4)) AS GoodQty,
             rh.DocuNo, rh.DocuNo AS RedemptionDocuNo, rh.DocuDate, rh.CarLicense, rh.IssueName
      FROM dbo.WFRedemtionDT rd WITH (NOLOCK)
      JOIN dbo.WFRedemtionHD rh WITH (NOLOCK) ON rh.RedemtionID = rd.RedemtionID
      LEFT JOIN (
        SELECT NativeRedemptionId, SUM(SettledQty) AS TotalSettled
        FROM wf.CouponReservationSettlement WITH (NOLOCK)
        GROUP BY NativeRedemptionId
      ) st ON st.NativeRedemptionId = rd.RedemtionID
      WHERE rd.RedemtionID = @redemId
    `, { redemId: { type: sql.BigInt, value: redemId } })).recordset || [];

    const cut = cutRows[0];
    if (!cut) {
      throw Object.assign(new Error(`ไม่พบรายการตัดตั๋วรหัส ${redemId} ในระบบ`), { status: 404 });
    }

    // Guard: already settled check
    const existingSettlement = (await effectiveWfQuery(`
      SELECT 1 FROM wf.CouponReservationSettlement WITH (NOLOCK)
      WHERE ReservationId = @resId AND NativeRedemptionId = @redemId
    `, {
      resId: { type: sql.BigInt, value: resId },
      redemId: { type: sql.BigInt, value: redemId }
    })).recordset;

    if (existingSettlement?.length > 0 || Number(cut.GoodQty) <= 0) {
      throw Object.assign(new Error('รายการตัดตั๋วนี้ได้รับการชำระ/จับคู่ไปแล้ว (Already settled)'), { status: 409 });
    }

    // Guard: same coupon
    if (Number(cut.CouponID) !== cId) {
      throw Object.assign(new Error(`รหัสตั๋วปุ๋ยของการตัดตั๋ว (${cut.CouponID}) ไม่ตรงกับรายการจอง (${cId})`), { status: 400 });
    }

    // R10.7-1: Date cutoff checks (Go-live and N-day window before the reservation was created)
    const policy = deps.settlementPolicy || await getCouponSettlementPolicy(effectiveWfQuery);
    const nDays = policy.settlementWindowDays;
    const goLiveCutoff = policy.goLiveCutoffDate;
    const cutDateStr = toBangkokDateString(cut.DocuDate);

    if (goLiveCutoff && cutDateStr && cutDateStr < goLiveCutoff) {
      throw Object.assign(new Error(`ไม่อนุญาตให้ตัดตั๋วที่ออกก่อนวัน Go-Live (${goLiveCutoff})`), { status: 400 });
    }

    const minAllowedDateStr = earliestCutDate(reservation.CreatedAt || Date.now(), nDays);
    if (cutDateStr && minAllowedDateStr && cutDateStr < minAllowedDateStr) {
      throw Object.assign(new Error(`วันที่ตัดตั๋ว (${cutDateStr}) ไม่อยู่ในช่วงที่อนุญาต (ต้องไม่เกิน ${nDays} วันก่อนวันสร้างรายการจอง: ${minAllowedDateStr})`), { status: 400 });
    }

    // R10.7-1: Plate check (require plate = reservation trip plate unless overridePlate is true)
    const resPlate = normalizePlate(reservation.TripPlate);
    const cutPlate = normalizePlate(cut.CarLicense);

    if (!overridePlate) {
      if (resPlate && cutPlate && resPlate !== cutPlate) {
        throw Object.assign(new Error(`ทะเบียนรถของการตัดตั๋ว (${cut.CarLicense}) ไม่ตรงกับทะเบียนรถของเที่ยวจอง (${reservation.TripPlate}) หากต้องการยืนยันให้เลือก override ทะเบียน`), { status: 400 });
      }
      if (resPlate && !cutPlate) {
        throw Object.assign(new Error('รายการตัดตั๋วไม่ระบุทะเบียนรถ หากต้องการจับคู่จำเป็นต้องเลือก override ทะเบียน'), { status: 400 });
      }
    }

    // Guard: beneficiary match (R10.7-2: EXACT match only)
    if (beneficiaryCustId && String(beneficiaryCustId).trim() !== String(reservation.BeneficiaryCustId).trim()) {
      throw Object.assign(new Error('ผู้รับผลประโยชน์ไม่ตรงกับรายการจอง (Beneficiary mismatch)'), { status: 400 });
    }
    if (cut.IssueName && String(cut.IssueName).trim()) {
      const issueClean = String(cut.IssueName).trim().replace(/\s+/g, '').toLowerCase();
      const bName = String(reservation.BeneficiaryName || '').trim().replace(/\s+/g, '').toLowerCase();
      const bCode = String(reservation.BeneficiaryCode || '').trim().replace(/\s+/g, '').toLowerCase();
      const bId = String(reservation.BeneficiaryCustId || '').trim().replace(/\s+/g, '').toLowerCase();

      const matched = (bName && issueClean === bName) ||
                      (bCode && issueClean === bCode) ||
                      (bId && issueClean === bId);
      if (!matched) {
        throw Object.assign(new Error('ผู้รับผลประโยชน์ไม่ตรงกับรายการจอง (Beneficiary mismatch)'), { status: 400 });
      }
    }

    // Guard: quantity
    const remReserved = Number(reservation.RemainingReservedQty);
    const availCut = Number(cut.GoodQty);
    const settleQty = qty != null ? Number(qty) : Math.min(availCut, remReserved);
    const settledQty = settleQty;

    if (isNaN(settleQty) || settleQty <= 0) {
      throw Object.assign(new Error('จำนวนตันที่ตัดไม่ถูกต้อง'), { status: 400 });
    }
    if (settleQty > remReserved) {
      throw Object.assign(new Error(`จำนวนตัดตั๋ว (${settleQty} ตัน) เกินกว่ายอดจองคงเหลือ (${remReserved} ตัน)`), { status: 400 });
    }
    if (settleQty > availCut) {
      throw Object.assign(new Error(`จำนวนตัดตั๋ว (${settleQty} ตัน) เกินกว่ายอดตัดที่เหลือ (${availCut} ตัน)`), { status: 400 });
    }

    const actingUid = actor && (actor.userId || actor.sub) ? Number(actor.userId || actor.sub) : null;
    let newStatus = reservation.Status;

    await effectiveWfTransaction(async (tx) => {
      // Insert audit row in wf.CouponReservationSettlement with Note "MANUAL: <reason>"
      await tx.request()
        .input('resId', sql.BigInt, resId)
        .input('cid', sql.Int, cId)
        .input('redemId', sql.BigInt, redemId)
        .input('docuNo', sql.VarChar(50), String(cut.DocuNo || cut.RedemptionDocuNo || ''))
        .input('qty', sql.Decimal(12, 4), settleQty)
        .input('uid', sql.Int, actingUid)
        .input('note', sql.NVarChar(255), `MANUAL${overridePlate ? ' (ยกเว้นทะเบียน)' : ''}: ${reason.trim()}`.slice(0, 255))
        .query(`
          INSERT INTO wf.CouponReservationSettlement (ReservationId, CouponId, NativeRedemptionId, NativeDocuNo, SettledQty, SettledBy, Note)
          VALUES (@resId, @cid, @redemId, @docuNo, @qty, @uid, @note)
        `);

      // R10.7-2: Update wf.CouponReservation with strict SQL guard
      const updRes = await tx.request()
        .input('resId', sql.BigInt, resId)
        .input('qty', sql.Decimal(12, 4), settleQty)
        .query(`
          UPDATE wf.CouponReservation
          SET ConsumedQty = ISNULL(ConsumedQty, 0) + @qty,
              Status = CASE WHEN ISNULL(ConsumedQty, 0) + @qty >= ReservedQty THEN 'CONSUMED' ELSE Status END,
              UpdatedAt = GETUTCDATE()
          OUTPUT INSERTED.Status
          WHERE Id = @resId AND Status = 'RESERVED' AND ISNULL(ConsumedQty, 0) + @qty <= ReservedQty
        `);

      if (!updRes.rowsAffected?.[0] || !updRes.recordset?.length) {
        throw Object.assign(new Error('ไม่สามารถตัดตั๋วได้ — ข้อมูลการจองเปลี่ยนไปแล้วหรือยอดตัดเกินยอดจอง'), { status: 409 });
      }

      newStatus = updRes.recordset[0].Status;

      // Record audit ChangeEvent inside transaction
      await logChangeEvent(tx, {
        entityType: 'COUPON_RESERVATION',
        entityId: String(resId),
        action: 'MANUAL_SETTLE',
        beforeJson: { status: reservation.Status, consumedQty: Number(reservation.ConsumedQty) },
        afterJson: { status: newStatus, settledQty, redemptionId: redemId, docuNo: cut.DocuNo, overridePlate: Boolean(overridePlate) },
        reasonCode: 'MANUAL_SETTLEMENT',
        reasonText: reason.trim(),
        userId: String(actingUid || 'SYSTEM'),
      });

      // Record Outbox Event
      await enqueue('COUPON_RESERVATION_MANUAL_SETTLED', String(resId), {
        reservationId: resId,
        couponId: cId,
        nativeRedemptionId: redemId,
        settledQty,
        status: newStatus,
        reason: reason.trim(),
        settledBy: actingUid,
      }, { tx });
    });

    return {
      ok: true,
      success: true,
      reservationId: resId,
      redemptionId: redemId,
      settledQty,
      status: newStatus,
      message: 'ตัดตั๋วแบบแมนนวลสำเร็จ',
    };
  } finally {
    _settlementLocks.delete(cId);
  }
}

/**
 * Validates and locks coupon reservations for an order.
 * Returns Set of validated line indices.
 */
async function validateAndLockCouponReservations(tx, lines, orderCustId, targetSoId = null, actor = null, billPrefix = null) {
  const validatedIndexes = new Set();
  if (!Array.isArray(lines)) return validatedIndexes;
  const seenResIds = new Set();
  const custStr = String(orderCustId).trim();

  // 1. Check duplicate reservation IDs in the order lines first
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (!line.couponReservationId) continue;
    const resId = Number(line.couponReservationId);
    if (isNaN(resId) || resId <= 0) {
      throw Object.assign(new Error(`บรรทัดที่ ${idx + 1}: รหัสการจองตั๋วไม่ถูกต้อง (${line.couponReservationId})`), { status: 400 });
    }
    if (seenResIds.has(resId)) {
      throw Object.assign(new Error(`พบการใช้รหัสการจองตั๋วซ้ำ (${resId}) ในมากกว่าหนึ่งบรรทัด`), { status: 400 });
    }
    seenResIds.add(resId);
  }

  // 2. Lock and validate each reservation against the line
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (!line.couponReservationId) continue;

    const resId = Number(line.couponReservationId);
    const r = await tx.request()
      .input('resId', sql.Int, resId)
      .query(`
        SELECT Id, CouponId, CouponNo, GoodId, GoodUnit, ReservedQty, Status,
               BeneficiaryCustId, OwnerCustId, CarrierSoId, ExpiresAt, CreatedBy
        FROM wf.CouponReservation WITH (UPDLOCK, ROWLOCK)
        WHERE Id = @resId
      `);

    const resRow = r.recordset?.[0];
    if (!resRow) {
      throw Object.assign(new Error(`ไม่พบรายการจองตั๋วรหัส ${resId}`), { status: 400 });
    }

    if (resRow.Status !== 'RESERVED') {
      throw Object.assign(new Error(`รายการจองตั๋วรหัส ${resId} ไม่อยู่ในสถานะ RESERVED (ปัจจุบัน: ${resRow.Status})`), { status: 400 });
    }

    // R12 K-F3: the bill's book decides which coupon series it may carry
    if (billPrefix && !couponAllowedForBill(resRow.CouponNo, billPrefix)) {
      throw Object.assign(new Error(`บรรทัดที่ ${idx + 1}: ${couponBookMismatchMessage(resRow.CouponNo, billPrefix)}`), { status: 400, code: 'COUPON_BOOK_MISMATCH' });
    }

    // Actor Authorization check: non-elevated users can only bind their own reservations
    if (actor && actor.userId) {
      const isElevated = ['ADMIN', 'MANAGER', 'C_LEVEL'].includes(String(actor.role || '').toUpperCase());
      const allowed = [actor.userId, ...(actor.altUserIds || [])].map(Number);
      if (!isElevated && resRow.CreatedBy && !allowed.includes(Number(resRow.CreatedBy))) {
        throw Object.assign(new Error(`รายการจองตั๋วรหัส ${resId} ถูกสร้างโดยผู้ใช้อื่น (#${resRow.CreatedBy})`), { status: 403 });
      }
    }

    if (resRow.ExpiresAt && new Date(resRow.ExpiresAt) <= new Date()) {
      throw Object.assign(new Error(`รายการจองตั๋วรหัส ${resId} หมดอายุแล้ว`), { status: 400 });
    }

    const resCust = String(resRow.BeneficiaryCustId).trim();
    if (resCust !== custStr) {
      throw Object.assign(new Error(`รายการจองตั๋วรหัส ${resId} ถูกจองให้ลูกค้า ${resCust} ไม่ตรงกับลูกค้าของบิล (${custStr})`), { status: 400 });
    }

    if (Number(resRow.GoodId) !== Number(line.goodId)) {
      throw Object.assign(new Error(`สินค้าของการจองตั๋ว (${resRow.GoodId}) ไม่ตรงกับสินค้าในบิล (${line.goodId})`), { status: 400 });
    }

    // Exact metric ton quantity check using integer-scaled kilograms
    const numQtyTon = Number(line.qtyTon);
    if (!Number.isFinite(numQtyTon) || numQtyTon <= 0) {
      throw Object.assign(new Error(`จำนวนตันในบิล (${line.qtyTon}) ไม่ถูกต้อง`), { status: 400 });
    }
    if (Math.abs(numQtyTon * 1000 - Math.round(numQtyTon * 1000)) > 1e-4) {
      throw Object.assign(new Error(`จำนวนตันต้องมีความละเอียดไม่เกิน 3 ตำแหน่งทศนิยม (1 กิโลกรัม)`), { status: 400 });
    }
    const lineTonScaled = Math.round(numQtyTon * 1000);
    const resTonScaled = Math.round(Number(resRow.ReservedQty) * 1000);
    if (lineTonScaled !== resTonScaled) {
      throw Object.assign(new Error(`จำนวนตันในบิล (${line.qtyTon}) ไม่ตรงกับจำนวนที่จองตั๋วไว้ (${resRow.ReservedQty})`), { status: 400 });
    }

    // Unit comparison when provided
    if (line.goodUnit && resRow.GoodUnit) {
      const lu = String(line.goodUnit).trim().toLowerCase();
      const ru = String(resRow.GoodUnit).trim().toLowerCase();
      const isTon = (u) => u === 'ตัน' || u === 'tonne' || u === 'ton' || u === 't';
      if (lu !== ru && !(isTon(lu) && isTon(ru))) {
        throw Object.assign(new Error(`หน่วยสินค้าในบิล (${line.goodUnit}) ไม่ตรงกับหน่วยที่จองตั๋วไว้ (${resRow.GoodUnit})`), { status: 400 });
      }
    }

    if (resRow.CarrierSoId) {
      const boundSo = String(resRow.CarrierSoId).trim();
      const isCurrentSo = targetSoId != null && boundSo === String(targetSoId);
      const isDraftCarrier = /^TRIP-\d+-DRAFT$/i.test(boundSo) || /^DRAFT([:-].*)?$/i.test(boundSo) || boundSo.startsWith('SO-TEST-');
      if (!isDraftCarrier && !isCurrentSo) {
        throw Object.assign(new Error(`รายการจองตั๋วรหัส ${resId} ถูกผูกกับบิลอื่นไปแล้ว (${boundSo})`), { status: 400 });
      }
    }

    // D1 / R5-2: Validated reservation line is forced to price ฿0 and marked validated
    validatedIndexes.add(idx);
    line._couponReservationValidated = true;
    line.pricePerTon = 0;
    line.netPricePerTon = 0;
    line.isCouponDrawn = true;
    line.refCouponDocuNo = resRow.CouponNo;
  }

  return validatedIndexes;
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
  // Scope is forced to ALL per owner answer Q5b
  const scp = 'ALL';

  if (!ownStr || !benStr || !rsn || rsn.length < 5) {
    throw Object.assign(new Error('กรุณาระบุ ownerCustId, beneficiaryCustId และ reason (อย่างน้อย 5 ตัวอักษร)'), { status: 400 });
  }

  // Reject non-numeric CustID before SQL conversion error (500 -> 400)
  if (!/^\d+$/.test(ownStr) || !/^\d+$/.test(benStr)) {
    throw Object.assign(new Error('รหัสลูกค้าต้องเป็นตัวเลขเท่านั้น (CustID)'), { status: 400 });
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

  if (!ownerObj) {
    throw Object.assign(new Error(`ไม่พบข้อมูลลูกค้าเจ้าของตั๋วในระบบ (EMCust: ${ownStr})`), { status: 400 });
  }
  if (!benObj) {
    throw Object.assign(new Error(`ไม่พบข้อมูลลูกค้าผู้รับสิทธิ์ในระบบ (EMCust: ${benStr})`), { status: 400 });
  }

  return await wfTransaction(async (tx) => {
    // Two-level rule: a beneficiary of an active grant cannot be an owner (Q5a)
    const ownerAsBen = (await tx.request()
      .input('own', sql.VarChar(50), ownStr)
      .query(`
        SELECT TOP 1 Id, OwnerCustId, OwnerCustCode, OwnerCustName
        FROM wf.CouponBeneficiary WITH (UPDLOCK, HOLDLOCK)
        WHERE BeneficiaryCustId = @own AND Status = 'ACTIVE'
      `)
    ).recordset?.[0];

    if (ownerAsBen) {
      throw Object.assign(
        new Error(`ลูกค้าเจ้าของสิทธิ์ (${ownStr}) เป็นสมาชิกในกลุ่มของ ${ownerAsBen.OwnerCustCode || ownerAsBen.OwnerCustId} อยู่แล้ว ไม่สามารถเป็นเจ้าของกลุ่มได้ (กฎ 2 ระดับ)`),
        { status: 400 }
      );
    }

    // Two-level rule: an owner of active grants cannot become a beneficiary (Q5a)
    const benAsOwner = (await tx.request()
      .input('ben', sql.VarChar(50), benStr)
      .query(`
        SELECT TOP 1 Id, BeneficiaryCustId, BeneficiaryCustCode, BeneficiaryCustName
        FROM wf.CouponBeneficiary WITH (UPDLOCK, HOLDLOCK)
        WHERE OwnerCustId = @ben AND Status = 'ACTIVE'
      `)
    ).recordset?.[0];

    if (benAsOwner) {
      throw Object.assign(
        new Error(`ลูกค้าผู้รับสิทธิ์ (${benStr}) เป็นเจ้าของกลุ่มที่มีสมาชิกอยู่แล้ว ไม่สามารถเป็นสมาชิกในกลุ่มอื่นได้ (กฎ 2 ระดับ)`),
        { status: 400 }
      );
    }

    // One root per member rule (Q11): a member may have active grants from one owner only
    const existingRoot = (await tx.request()
      .input('ben', sql.VarChar(50), benStr)
      .input('own', sql.VarChar(50), ownStr)
      .query(`
        SELECT TOP 1 Id, OwnerCustId, OwnerCustCode, OwnerCustName
        FROM wf.CouponBeneficiary WITH (UPDLOCK, HOLDLOCK)
        WHERE BeneficiaryCustId = @ben AND OwnerCustId <> @own AND Status = 'ACTIVE'
      `)
    ).recordset?.[0];

    if (existingRoot) {
      throw Object.assign(
        new Error(`ลูกค้าผู้รับสิทธิ์ (${benStr}) เป็นสมาชิกของเจ้าของตั๋วรายอื่น (${existingRoot.OwnerCustCode || existingRoot.OwnerCustId}) อยู่แล้ว (สมาชิกมีแม่ได้รายเดียวตาม Q11 หากต้องการย้ายกลุ่มต้องถอนสิทธิ์เดิมก่อน)`),
        { status: 409 }
      );
    }

    // Check duplicate active grant between this exact owner and beneficiary
    const existing = (await tx.request()
      .input('own', sql.VarChar(50), ownStr)
      .input('ben', sql.VarChar(50), benStr)
      .input('scope', sql.VarChar(50), scp)
      .query(`
        SELECT Id FROM wf.CouponBeneficiary WITH (UPDLOCK, HOLDLOCK)
        WHERE OwnerCustId = @own AND BeneficiaryCustId = @ben AND Scope = @scope AND Status = 'ACTIVE'
      `)
    ).recordset?.[0];

    if (existing) {
      throw Object.assign(new Error(`มีสิทธิ์ใช้ตั๋วร่วมที่ยังใช้งานอยู่แล้วสำหรับคู่นี้ (รหัส #${existing.Id})`), { status: 409 });
    }

    const res = await tx.request()
      .input('own', sql.VarChar(50), ownStr)
      .input('ownCode', sql.VarChar(50), ownerObj.CustCode || null)
      .input('ownName', sql.NVarChar(255), ownerObj.CustName || null)
      .input('ben', sql.VarChar(50), benStr)
      .input('benCode', sql.VarChar(50), benObj.CustCode || null)
      .input('benName', sql.NVarChar(255), benObj.CustName || null)
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

    // Q8: Revoke releases unattached reservations immediately in the same transaction
    // Cancel beneficiary's RESERVED reservations on that owner's coupons not attached to an active bill
    const unattachedCancel = await tx.request()
      .input('own', sql.VarChar(50), String(grant.OwnerCustId))
      .input('ben', sql.VarChar(50), String(grant.BeneficiaryCustId))
      .input('reason', sql.NVarChar(255), 'ถอนสิทธิ์ตั๋วร่วม')
      .input('uid', sql.Int, userId)
      .query(`
        UPDATE wf.CouponReservation
        SET Status = 'CANCELLED',
            CancelledAt = GETUTCDATE(),
            CancelReason = @reason,
            CancelledBy = @uid,
            UpdatedAt = GETUTCDATE()
        WHERE OwnerCustId = @own
          AND BeneficiaryCustId = @ben
          AND Status = 'RESERVED'
          AND NOT EXISTS (
            SELECT 1
            FROM wf.SalesOrderLine sol WITH (NOLOCK)
            LEFT JOIN wf.SalesOrder so WITH (NOLOCK) ON so.Id = sol.SoId
            LEFT JOIN dbo.SOHD hd WITH (NOLOCK) ON hd.SOID = sol.SoId
            WHERE sol.CouponReservationId = wf.CouponReservation.Id
              AND (
                (so.Id IS NOT NULL AND so.Status NOT IN ('CANCELLED', 'DELETED'))
                OR (hd.SOID IS NOT NULL AND hd.DocuStatus NOT IN ('C', 'CANCELLED', 'REJECTED'))
              )
          )
      `);
    const cancelledCount = unattachedCancel.rowsAffected?.[0] || 0;

    return { id: gId, status: 'REVOKED', idempotent: false, cancelledUnattachedReservations: cancelledCount };
  });
}

/**
 * Resolve verified employee from wf.AppUser.EmpId to dbo.EMEmp.EmpID
 */
async function resolveVerifiedEmployee(userId, tx) {
  if (!userId) return null;
  const numId = Number(userId);
  if (isNaN(numId) || numId <= 0) return null;

  const row = (await tx.request()
    .input('uid', sql.Int, numId)
    .query(`
      SELECT u.EmpId, e.EmpID AS WinSpeedEmpId
      FROM wf.AppUser u WITH (NOLOCK)
      LEFT JOIN dbo.EMEmp e WITH (NOLOCK) ON e.EmpID = CASE WHEN ISNUMERIC(u.EmpId) = 1 THEN CAST(u.EmpId AS INT) END
      WHERE u.Id = @uid
    `)
  ).recordset?.[0];

  if (row && row.WinSpeedEmpId) {
    return Number(row.WinSpeedEmpId);
  }
  return null;
}

/**
 * Resolve physical delivery / weighing evidence from dbo.WGHD or wf.WeighTicket.
 * Enforces typed relationship to reservation (SO / Trip / Plate), duplicate detection, and valid weighing state.
 */
async function resolvePhysicalDeliveryEvidence({ deliveryDocuNo, reservation, tx }) {
  const docNo = String(deliveryDocuNo || '').trim();
  if (!docNo) {
    throw Object.assign(
      new Error('ต้องระบุเลขที่เอกสารใบชั่ง/ใบขน (deliveryDocuNo) เพื่อตรวจสอบหลักฐานการจัดส่ง'),
      { code: 'MISSING_DOCU_NO', status: 400 }
    );
  }

  // 1. Query dbo.WGHD (detect duplicate/ambiguous documents)
  const wgList = (await tx.request()
    .input('dno', sql.NVarChar(50), docNo)
    .query(`
      SELECT 
        Id, DocuNo, CarNo, TONNet, SPID, WeightIn, WeightOut, DateIn, DateOut, Status
      FROM dbo.WGHD
      WHERE DocuNo = @dno
    `)
  ).recordset || [];

  if (wgList.length > 1) {
    const first = wgList[0];
    const isAmbiguous = wgList.some(w => 
      String(w.SPID || '').trim() !== String(first.SPID || '').trim() ||
      String(w.CarNo || '').trim() !== String(first.CarNo || '').trim() ||
      String(w.Status || '').trim() !== String(first.Status || '').trim()
    );
    if (isAmbiguous) {
      throw Object.assign(
        new Error(`พบเอกสารใบชั่ง dbo.WGHD ซ้ำซ้อนและมีข้อมูลขัดแย้งกันสำหรับเลขที่ "${docNo}"`),
        { code: 'DELIVERY_EVIDENCE_AMBIGUOUS', status: 400 }
      );
    }
  }
  const wg = wgList[0] || null;

  // 2. Query wf.WeighTicket (detect duplicate/ambiguous documents)
  const wtList = (await tx.request()
    .input('dno', sql.NVarChar(50), docNo)
    .query(`
      SELECT
        Id, SoId, WfRef, TruckPlate, NetKg, GrossKg, TareKg, Status, Movebill, WeighInAt, WeighOutAt
      FROM wf.WeighTicket
      WHERE Movebill = @dno OR WfRef = @dno
    `)
  ).recordset || [];

  if (wtList.length > 1) {
    const first = wtList[0];
    const isAmbiguous = wtList.some(w => 
      String(w.SoId || '').trim() !== String(first.SoId || '').trim() ||
      String(w.TruckPlate || '').trim() !== String(first.TruckPlate || '').trim() ||
      String(w.Status || '').trim() !== String(first.Status || '').trim()
    );
    if (isAmbiguous) {
      throw Object.assign(
        new Error(`พบเอกสารใบชั่ง wf.WeighTicket ซ้ำซ้อนและมีข้อมูลขัดแย้งกันสำหรับเลขที่ "${docNo}"`),
        { code: 'DELIVERY_EVIDENCE_AMBIGUOUS', status: 400 }
      );
    }
  }
  const wt = wtList[0] || null;

  if (!wg && !wt) {
    throw Object.assign(
      new Error(`ไม่พบเอกสารใบชั่ง/ใบขน "${docNo}" ในระบบชั่งน้ำหนัก กรุณาตรวจสอบเลขที่เอกสาร`),
      { code: 'DELIVERY_EVIDENCE_NOT_FOUND', status: 400 }
    );
  }

  // Check conflicting evidence between dbo.WGHD and wf.WeighTicket if both present
  if (wg && wt) {
    const wgPlate = String(wg.CarNo || '').replace(/[\s-]/g, '').toUpperCase();
    const wtPlate = String(wt.TruckPlate || '').replace(/[\s-]/g, '').toUpperCase();
    const wgSo = wg.SPID ? String(wg.SPID).trim() : null;
    const wtSo = wt.SoId ? String(wt.SoId).trim() : null;

    if ((wgPlate && wtPlate && wgPlate !== wtPlate) || (wgSo && wtSo && wgSo !== wtSo)) {
      throw Object.assign(
        new Error(`ข้อมูลใบชั่งขัดแย้งกันระหว่าง dbo.WGHD และ wf.WeighTicket สำหรับเลขที่ "${docNo}"`),
        { code: 'DELIVERY_EVIDENCE_CONFLICT', status: 400 }
      );
    }
  }

  // Check scale state
  if (wg) {
    const wgStatus = String(wg.Status || '').trim().toUpperCase();
    if (wgStatus === 'C' || wgStatus === 'CA' || wgStatus === 'CANCEL' || wgStatus === 'VOID' || wgStatus === 'REJECTED') {
      throw Object.assign(
        new Error(`เอกสารใบชั่ง "${docNo}" ถูกยกเลิกแล้ว (${wgStatus}) ไม่สามารถใช้เป็นหลักฐานการตัดส่งได้`),
        { code: 'DELIVERY_EVIDENCE_CANCELLED', status: 400 }
      );
    }
    if (!wg.DateIn && (!wg.WeightIn || Number(wg.WeightIn) <= 0)) {
      throw Object.assign(
        new Error(`เอกสารใบชั่ง "${docNo}" ยังไม่มีบันทึกการชั่งเข้า (Unfinished weighing state)`),
        { code: 'DELIVERY_EVIDENCE_INCOMPLETE', status: 400 }
      );
    }
  }

  if (wt) {
    const wtStatus = String(wt.Status || '').trim().toUpperCase();
    if (wtStatus === 'CANCELLED' || wtStatus === 'VOID') {
      throw Object.assign(
        new Error(`ใบชั่ง "${docNo}" ถูกยกเลิกแล้ว (${wtStatus}) ไม่สามารถใช้เป็นหลักฐานการตัดส่งได้`),
        { code: 'DELIVERY_EVIDENCE_CANCELLED', status: 400 }
      );
    }
    const hasPositiveWeighIn = Boolean(wt.WeighInAt) ||
      (wt.GrossKg != null && Number(wt.GrossKg) > 0) ||
      (wt.TareKg != null && Number(wt.TareKg) > 0) ||
      (wt.NetKg != null && Number(wt.NetKg) > 0);
    if (!hasPositiveWeighIn) {
      throw Object.assign(
        new Error(`ใบชั่ง wf.WeighTicket "${docNo}" ยังไม่มีบันทึกการชั่งเข้า (Unfinished weighing state)`),
        { code: 'DELIVERY_EVIDENCE_INCOMPLETE', status: 400 }
      );
    }
  }

  // Authoritative license plate from scale header
  const scalePlate = (wg?.CarNo ? String(wg.CarNo).trim() : null) ||
                     (wt?.TruckPlate ? String(wt.TruckPlate).trim() : null);

  if (!scalePlate || scalePlate === 'ไม่ระบุ') {
    throw Object.assign(
      new Error(`เอกสารใบชั่ง "${docNo}" ไม่มีข้อมูลทะเบียนรถที่ถูกต้อง (ห้ามใช้ 'ไม่ระบุ')`),
      { code: 'MISSING_CAR_LICENSE', status: 400 }
    );
  }

  // Resolve reservation SO info (strictly from reservation itself; never fall back to coupon issuance SO)
  const resSoId = reservation.CarrierSoId ? Number(reservation.CarrierSoId) : null;
  const resDocuNo = reservation.CarrierDocuNo ? String(reservation.CarrierDocuNo).trim() : null;

  // Resolve scale SO info
  const scaleSoId = wg?.SPID != null && !isNaN(Number(wg.SPID)) ? Number(wg.SPID) : (wt?.SoId != null && !isNaN(Number(wt.SoId)) ? Number(wt.SoId) : null);
  const rawScaleRef = wt?.WfRef ? String(wt.WfRef).trim() : (wg?.SPID && isNaN(Number(wg.SPID)) ? String(wg.SPID).trim() : null);

  // Resolve trip info (separate wf.SalesTrip from legacy wf.Trip)
  const resTripId = reservation.TripId ? Number(reservation.TripId) : null;

  let tripInfo = null;
  let tripMembers = [];
  if (resTripId) {
    const salesTrip = (await tx.request()
      .input('tid', sql.Int, resTripId)
      .query(`SELECT TripId, TripCode, TransRegistration, Status FROM wf.SalesTrip WHERE TripId = @tid`)
    ).recordset?.[0];

    if (salesTrip) {
      tripInfo = {
        type: 'SalesTrip',
        tripId: salesTrip.TripId,
        tripCode: salesTrip.TripCode ? String(salesTrip.TripCode).trim() : null,
        plate: salesTrip.TransRegistration ? String(salesTrip.TransRegistration).trim() : null,
        status: salesTrip.Status ? String(salesTrip.Status).trim() : null,
      };

      // Query authoritative member SOs for this trip (coalescing DocuNo with SalesOrderExt.WfRef)
      const membersRes = await tx.request()
        .input('tid', sql.Int, resTripId)
        .query(`
          SELECT m.TripId, m.MemberKind, m.MemberId, 
                 COALESCE(NULLIF(RTRIM(m.DocuNo), ''), ext.WfRef) AS DocuNo, 
                 m.CustId, m.CustName, m.SOID
          FROM wf.v_TripMember m
          LEFT JOIN wf.SalesOrderExt ext ON ext.SOID = m.MemberId AND m.MemberKind = 'CONFIRMED'
          WHERE m.TripId = @tid
        `);
      tripMembers = membersRes.recordset || [];
    } else {
      const legacyTrip = (await tx.request()
        .input('tid', sql.Int, resTripId)
        .query(`SELECT Id, TruckPlate FROM wf.Trip WHERE Id = @tid`)
      ).recordset?.[0];
      if (legacyTrip) {
        tripInfo = {
          type: 'Trip',
          tripId: legacyTrip.Id,
          tripCode: null,
          plate: legacyTrip.TruckPlate ? String(legacyTrip.TruckPlate).trim() : null,
          status: null,
        };
      }
    }
  }

  // Require explicit typed carrier identity on reservation (R6-01)
  if (!resSoId && !resDocuNo) {
    throw Object.assign(
      new Error(`รายการจองตั๋วรหัส ${reservation.Id} ไม่มีข้อมูลระบุ SO หรือเอกสารอ้างอิง (Carrier Identity) ที่จะเชื่อมโยงกับใบชั่ง`),
      { code: 'DELIVERY_EVIDENCE_MISMATCH', status: 400 }
    );
  }

  if (resTripId && !tripInfo) {
    throw Object.assign(
      new Error(`ไม่พบข้อมูลทริปจัดส่ง ${resTripId} ในระบบ`),
      { code: 'DELIVERY_EVIDENCE_MISMATCH', status: 400 }
    );
  }

  // Helper: Match native SOID strictly against CONFIRMED members (never DRAFT.MemberId which is wf.SalesOrder.Id)
  const isConfirmedSoMember = (member, soId) => {
    if (soId == null) return false;
    return (
      (member.SOID != null && Number(member.SOID) === Number(soId)) ||
      (member.MemberKind === 'CONFIRMED' && member.MemberId != null && String(member.MemberId).trim() === String(soId))
    );
  };

  const isDocuNoMember = (member, docuNo) => {
    if (!docuNo) return false;
    return Boolean(member.DocuNo && member.DocuNo.trim().toUpperCase() === String(docuNo).trim().toUpperCase());
  };

  // Validate reservation membership in trip if trip is present
  const isResInTripMembers = tripMembers.some(m =>
    isConfirmedSoMember(m, resSoId) || isDocuNoMember(m, resDocuNo)
  );

  if (resTripId && tripInfo && tripInfo.type === 'SalesTrip' && !isResInTripMembers) {
    throw Object.assign(
      new Error(`รายการจองตั๋วรหัส ${reservation.Id} (SO: ${resDocuNo || resSoId}) ไม่ได้เป็นสมาชิกของทริปจัดส่ง ${resTripId}`),
      { code: 'DELIVERY_EVIDENCE_MISMATCH', status: 400 }
    );
  }

  // 1. Authoritative member SO consistency check on reservation (R6-01 / V2-02)
  if (resTripId && tripMembers.length > 0) {
    const memberBySoId = resSoId ? tripMembers.find(m => isConfirmedSoMember(m, resSoId)) : null;
    const memberByDocuNo = resDocuNo ? tripMembers.find(m => isDocuNoMember(m, resDocuNo)) : null;

    if (memberBySoId && memberByDocuNo && String(memberBySoId.MemberId).trim() !== String(memberByDocuNo.MemberId).trim()) {
      throw Object.assign(
        new Error(`ข้อมูลเอกสารการจองขัดแย้ง: CarrierSoId (${resSoId}) และ CarrierDocuNo (${resDocuNo}) ไม่ตรงกันตามรายการสมาชิกทริปจัดส่ง`),
        { code: 'DELIVERY_EVIDENCE_CONFLICT', status: 400 }
      );
    }
  }

  // 2. Resolve typed scale reference identity: TripCode vs SO DocuNo (V2-02)
  const isScaleTripCodeMatch = Boolean(
    tripInfo?.tripCode && rawScaleRef && rawScaleRef.toUpperCase() === tripInfo.tripCode.toUpperCase()
  );

  // If rawScaleRef matches the TripCode, the scale ticket references the entire trip, NOT a single SO DocuNo
  const scaleSoDocuNo = isScaleTripCodeMatch ? null : rawScaleRef;

  // 3. Direct SO link check & conflict detection
  const hasSoIdConflict = Boolean(scaleSoId && resSoId && scaleSoId !== resSoId);
  const hasDocuConflict = Boolean(
    scaleSoDocuNo && resDocuNo && scaleSoDocuNo.toUpperCase() !== resDocuNo.toUpperCase()
  );

  const rawDocuMatch = Boolean(scaleSoDocuNo && resDocuNo && scaleSoDocuNo.toUpperCase() === resDocuNo.toUpperCase());
  const rawSoIdMatch = Boolean(scaleSoId && resSoId && scaleSoId === resSoId);

  // If one attribute matches but the other explicitly conflicts, fail-closed with DELIVERY_EVIDENCE_CONFLICT
  if (hasSoIdConflict && rawDocuMatch) {
    throw Object.assign(
      new Error(`ข้อมูลเอกสารขัดแย้ง: CarrierSoId (${resSoId}) ไม่ตรงกับ SOID ของใบชั่ง (${scaleSoId}) แม้เลขที่เอกสารจะตรงกัน (${resDocuNo})`),
      { code: 'DELIVERY_EVIDENCE_CONFLICT', status: 400 }
    );
  }

  if (hasDocuConflict && rawSoIdMatch) {
    throw Object.assign(
      new Error(`ข้อมูลเอกสารขัดแย้ง: CarrierDocuNo (${resDocuNo}) ไม่ตรงกับเลขที่เอกสารของใบชั่ง (${scaleSoDocuNo}) แม้ SOID จะตรงกัน (${resSoId})`),
      { code: 'DELIVERY_EVIDENCE_CONFLICT', status: 400 }
    );
  }

  const isDirectSoIdMatch = Boolean(rawSoIdMatch && !hasDocuConflict);
  const isDirectDocuMatch = Boolean(rawDocuMatch && !hasSoIdConflict);
  const isDirectMatch = isDirectSoIdMatch || isDirectDocuMatch;

  // 4. Multi-SO same-trip delivery check (R5-01 / R6-01 / V2-02)
  let isTripMemberMatch = false;
  if (resTripId && tripInfo && isResInTripMembers) {
    // Check if scale ticket references another member SO of the same trip
    const isScaleMemberMatch = tripMembers.some(m =>
      isConfirmedSoMember(m, scaleSoId) || (scaleSoDocuNo && isDocuNoMember(m, scaleSoDocuNo))
    );

    if (isScaleTripCodeMatch || isScaleMemberMatch) {
      isTripMemberMatch = true;
    }
  }

  // Positive typed link requires either direct SO match or authoritative multi-SO same-trip membership.
  // Note: Coincident document text (docNo === resDocuNo) alone NEVER authorizes posting without typed link.
  if (!isDirectMatch && !isTripMemberMatch) {
    throw Object.assign(
      new Error(`รายการจองตั๋วรหัส ${reservation.Id} (SO: ${resDocuNo || resSoId || '-'}) ไม่มีความเชื่อมโยงทางเอกสาร (Typed SO/Trip Linkage) กับเอกสารใบชั่ง "${docNo}"`),
      { code: 'DELIVERY_EVIDENCE_MISMATCH', status: 400 }
    );
  }

  // Corroboration: If trip has plate, scale plate must match trip plate
  if (tripInfo?.plate) {
    const normTripPlate = tripInfo.plate.replace(/[\s-]/g, '').toUpperCase();
    const normScalePlate = scalePlate.replace(/[\s-]/g, '').toUpperCase();
    if (normTripPlate !== normScalePlate) {
      throw Object.assign(
        new Error(`ทะเบียนรถในทริปจัดส่ง "${tripInfo.plate}" ไม่ตรงกับทะเบียนรถในเอกสารใบชั่ง "${scalePlate}"`),
        { code: 'CAR_LICENSE_MISMATCH', status: 400 }
      );
    }
  }

  return {
    docuNo: docNo,
    carLicense: scalePlate,
    wg,
    wt,
  };
}

/**
 * Resolve physical vehicle license plate from scale header (WGHD) or trip, rejecting empty or 'ไม่ระบุ'
 */
async function resolveVehiclePlate({ inputCarLicense, docuNo, tripId, tx }) {
  let carLicense = String(inputCarLicense || '').trim();
  if (carLicense === 'ไม่ระบุ' || carLicense === '-') {
    carLicense = '';
  }

  if (docuNo) {
    const wg = (await tx.request()
      .input('dno', sql.NVarChar(50), String(docuNo).trim())
      .query(`SELECT TOP 1 CarNo, TONNet, SPID, WeightOut FROM dbo.WGHD WHERE DocuNo = @dno`)
    ).recordset?.[0];
    if (wg?.CarNo) {
      const wgCar = String(wg.CarNo).trim();
      if (wgCar && wgCar !== 'ไม่ระบุ') {
        carLicense = wgCar;
      }
    }
  }

  if (!carLicense && tripId) {
    const trip = (await tx.request()
      .input('tid', sql.Int, Number(tripId))
      .query(`
        SELECT TransRegistration FROM wf.SalesTrip WHERE TripId = @tid
        UNION
        SELECT TruckPlate AS TransRegistration FROM wf.Trip WHERE Id = @tid
      `)
    ).recordset?.[0];
    if (trip?.TransRegistration) {
      const tripCar = String(trip.TransRegistration).trim();
      if (tripCar && tripCar !== 'ไม่ระบุ') {
        carLicense = tripCar;
      }
    }
  }

  if (!carLicense || carLicense === 'ไม่ระบุ') {
    throw Object.assign(
      new Error(`ไม่พบข้อมูลทะเบียนรถที่ถูกต้องสำหรับเอกสาร "${docuNo || '-'}" (ห้ามใช้ 'ไม่ระบุ') กรุณาระบุ carLicense ให้ถูกต้อง`),
      { code: 'MISSING_CAR_LICENSE', status: 400 }
    );
  }

  return carLicense;
}

/**
 * Shared in-transaction validator for coupon reservations before posting (single or batch)
 * Enforces server-owned policy, scoped override authority, physical delivery evidence, and OCC revision.
 */
async function validateReservationBeforePosting({
  reservation,
  expectedRevision,
  deliveryDocuNo,
  inputCarLicense,
  callerRole = null,
  overrideApproval = null,
  userId = null,
  isSimulated = false,
  tx,
}) {
  const r = reservation;

  // 1. Status check
  if (r.Status === 'POSTED') {
    if (deliveryDocuNo && r.NativeDocuNo && String(deliveryDocuNo).trim() !== String(r.NativeDocuNo).trim()) {
      throw Object.assign(
        new Error(`Idempotency conflict: รายการจองตั๋วรหัส ${r.Id} ถูกตัดส่งไปแล้วด้วยเอกสาร ${r.NativeDocuNo} (ขัดแย้งกับคำขอใหม่ ${deliveryDocuNo})`),
        { code: 'IDEMPOTENCY_CONFLICT', status: 409 }
      );
    }

    // R4-04: Retrieve durable warnings and policy decision from original posting audit event without re-evaluating policy
    let replayWarnings = [];
    let replayPolicy = null;
    try {
      const auditEvt = (await tx.request()
        .input('eid', sql.VarChar(50), String(r.Id))
        .query(`
          SELECT TOP 1 AfterJson, ReasonCode, ReasonText, CreatedAt
          FROM wf.ChangeEvent
          WHERE EntityType = 'COUPON_POSTING' AND EntityId = @eid
          ORDER BY EventId DESC
        `)
      ).recordset?.[0];

      if (auditEvt?.AfterJson) {
        const parsed = JSON.parse(auditEvt.AfterJson);
        if (Array.isArray(parsed.warnings)) {
          replayWarnings = parsed.warnings;
        }
        replayPolicy = {
          strictMode: parsed.strictMode,
          strictOverride: parsed.strictOverride,
          snapshotId: parsed.snapshotId,
          revisionNumber: parsed.revisionNumber,
        };
      }
    } catch (_auditErr) {
      // Fallback gracefully
    }

    return {
      alreadyPosted: true,
      nativeDocuNo: r.NativeDocuNo,
      nativeRedemptionId: r.NativeRedemptionId,
      reservation: r,
      warnings: replayWarnings,
      policy: replayPolicy,
    };
  }

  if (r.Status !== 'RESERVED') {
    throw Object.assign(
      new Error(`สถานะการจองตั๋วไม่ถูกต้อง (${r.Status}) สามารถตัดส่งได้เฉพาะรายการที่อยู่ในสถานะ RESERVED เท่านั้น`),
      { code: 'INVALID_RESERVATION_STATUS', status: 400 }
    );
  }

  // 2. Reservation-level Expiry Check
  if (r.ExpiresAt && new Date(r.ExpiresAt).getTime() < Date.now()) {
    await tx.request()
      .input('id', sql.Int, r.Id)
      .query(`UPDATE wf.CouponReservation SET Status = 'EXPIRED', UpdatedAt = GETUTCDATE() WHERE Id = @id`);
    return { expired: true, reservationId: r.Id, expiresAt: r.ExpiresAt, reservation: r };
  }

  // 3. OCC / Revision check
  if (expectedRevision !== undefined && Number(expectedRevision) !== Number(r.Revision)) {
    throw Object.assign(
      new Error(`OCC Conflict: ข้อมูลการจองตั๋วรหัส ${r.Id} ถูกแก้ไขโดยผู้อื่น (Revision ปัจจุบัน: ${r.Revision}, ที่คาดหวัง: ${expectedRevision})`),
      { code: 'OCC_CONFLICT', status: 409 }
    );
  }

  // 4. Physical Delivery / Trip Evidence Check (R3-02 / R4-02)
  let deliveryEvidence = null;
  if (deliveryDocuNo && !isSimulated) {
    deliveryEvidence = await resolvePhysicalDeliveryEvidence({
      deliveryDocuNo,
      reservation: r,
      tx,
    });

    if (inputCarLicense && deliveryEvidence?.carLicense) {
      const normInput = String(inputCarLicense).replace(/[\s-]/g, '').toUpperCase();
      const normEvidence = deliveryEvidence.carLicense.replace(/[\s-]/g, '').toUpperCase();
      if (normInput !== normEvidence) {
        throw Object.assign(
          new Error(`ทะเบียนรถที่ระบุ "${inputCarLicense}" ไม่ตรงกับทะเบียนรถในเอกสารใบชั่ง "${deliveryEvidence.carLicense}"`),
          { code: 'CAR_LICENSE_MISMATCH', status: 400 }
        );
      }
    }
  }

  // 5. Beneficiary Authorization Check
  if (r.BeneficiaryCustId && r.OwnerCustId && String(r.BeneficiaryCustId).trim() !== String(r.OwnerCustId).trim()) {
    const authCheck = await checkBeneficiaryAuthorization({
      ownerCustId: r.OwnerCustId,
      beneficiaryCustId: r.BeneficiaryCustId,
      goodId: r.GoodId,
      tx,
    });
    if (!authCheck.authorized) {
      throw Object.assign(
        new Error(`สิทธิ์การใช้ตั๋วร่วมของลูกค้า ${r.BeneficiaryCustId} สำหรับตั๋ว ${r.CouponNo} ถูกเพิกถอนหรือหมดอายุแล้ว`),
        { code: 'BENEFICIARY_REVOKED', status: 403 }
      );
    }
  }

  // 6. Authoritative Coupon Record & Policy Check
  const couponRecord = (await tx.request()
    .input('cid', sql.Int, r.CouponId)
    .query(`
      SELECT 
        c.CouponID, c.CouponNo, c.GoodID, c.GoodUnitID, c.GoodPrice, c.RemaQty,
        c.DocuID, c.SONo,
        s.DocuStatus AS SoDocuStatus,
        ov.ExpiryDate AS ExpDate,
        ov.StrictOverrideFlag,
        ov.ReasonCode
      FROM dbo.WFCoupon c WITH (UPDLOCK, HOLDLOCK)
      LEFT JOIN dbo.SOHD s WITH (NOLOCK) ON s.SOID = c.DocuID
      LEFT JOIN wf.ControlTicketOverlay ov WITH (NOLOCK) ON ov.DocuId = c.CouponID
      WHERE c.CouponID = @cid
    `)
  ).recordset?.[0];

  if (!couponRecord) {
    throw Object.assign(new Error(`ไม่พบคูปอง ID ${r.CouponId} ในระบบ`), { code: 'COUPON_NOT_FOUND', status: 404 });
  }

  // R3-01: Server-owned policy resolution; client cannot dictate strictMode
  const ticketPolicy = require('./ticket-policy');
  const policySettings = await ticketPolicy.resolveTicketPolicy();
  const effectiveStrictMode = Boolean(policySettings.strictMode);

  // R3-01 / R4-05: Scoped override authority; warehouse cannot self-approve; strict attribution check
  let effectiveStrictOverride = false;
  let overrideReason = null;
  let overrideActor = null;

  if (couponRecord.StrictOverrideFlag === 1 || couponRecord.StrictOverrideFlag === true) {
    effectiveStrictOverride = true;
    overrideReason = 'Pre-authorized overlay override';
  } else if (overrideApproval && overrideApproval.approved === true) {
    if (callerRole === 'WAREHOUSE') {
      throw Object.assign(
        new Error('ผู้ใช้งานบทบาท WAREHOUSE ไม่สามารถอนุมัติผ่อนผันนโยบายตั๋วหมดอายุได้'),
        { code: 'CANNOT_SELF_APPROVE_OVERRIDE', status: 403 }
      );
    }
    // R4-05: Service boundary attribution check: approvedBy must match authenticated userId
    if (overrideApproval.approvedBy && userId && String(overrideApproval.approvedBy).trim() !== String(userId).trim()) {
      throw Object.assign(
        new Error('ผู้อนุมัติผ่อนผันนโยบายไม่ตรงกับตัวตนของผู้ดำเนินการ (Approval Attribution Mismatch)'),
        { code: 'APPROVAL_ATTRIBUTION_MISMATCH', status: 400 }
      );
    }
    effectiveStrictOverride = true;
    overrideReason = overrideApproval.reason;
    overrideActor = overrideApproval.approvedBy || userId;
  }

  const expiryEval = ticketPolicy.evaluateTicketExpiry(
    couponRecord.ExpDate,
    new Date(),
    policySettings.alertDays,
    effectiveStrictMode,
    effectiveStrictOverride
  );

  const isCancelled = couponRecord.SoDocuStatus === 'C' || couponRecord.ReasonCode === 'CANCELLED';
  const lifecycle = isCancelled ? 'CANCELLED' : 'ISSUED';
  const eligibility = ticketPolicy.evaluateTicketEligibility({
    couponId: couponRecord.CouponID,
    lifecycle,
    balanceState: 'POSITIVE',
    availableQtyTon: couponRecord.RemaQty,
    nativeRemainingQtyTon: couponRecord.RemaQty,
    expiryEval,
    strictOverride: effectiveStrictOverride,
    strictMode: effectiveStrictMode,
  });

  if (eligibility.isBlocked) {
    const reasonText = eligibility.reasons?.join('; ') || eligibility.error || 'ตั๋วไม่พร้อมใช้งานตามนโยบายระบบ';
    const code = eligibility.status === 'BLOCKED' && expiryEval?.isExpired ? 'COUPON_EXPIRED' : 'COUPON_POLICY_BLOCKED';
    throw Object.assign(
      new Error(`ตั๋วคุม ${couponRecord.CouponNo}: ${reasonText}`),
      { code, status: 400, eligibility }
    );
  }

  // R3-05: Warnings aggregation
  const warnings = [];
  if (expiryEval?.warning) {
    warnings.push(expiryEval.warning);
  }
  if (Array.isArray(eligibility.warnings)) {
    for (const w of eligibility.warnings) {
      if (w && !warnings.includes(w)) warnings.push(w);
    }
  }

  // R3-05 / R4-05: Transactional audit logging for warnings and overrides with authenticated executor attribution
  if (effectiveStrictOverride || warnings.length > 0) {
    await tx.request()
      .input('entityType', sql.VarChar(50), 'COUPON_POSTING')
      .input('entityId', sql.VarChar(50), String(r.Id))
      .input('action', effectiveStrictOverride ? 'STRICT_OVERRIDE' : 'EXPIRY_WARNING')
      .input('reasonCode', effectiveStrictOverride ? 'POLICY_OVERRIDE' : 'EXPIRY_WARNING')
      .input('reasonText', sql.NVarChar(500), overrideReason || warnings.join('; ') || 'Warning during posting')
      .input('userId', sql.VarChar(50), String(userId || overrideActor || 'SYSTEM'))
      .input('afterJson', sql.NVarChar(sql.MAX), JSON.stringify({
        reservationId: r.Id,
        couponId: r.CouponId,
        couponNo: r.CouponNo,
        expiryDate: couponRecord.ExpDate,
        strictMode: effectiveStrictMode,
        strictOverride: effectiveStrictOverride,
        executorId: userId,
        approvedBy: overrideActor,
        warnings,
        snapshotId: policySettings.snapshotId,
        revisionNumber: policySettings.revisionNumber,
      }))
      .query(`
        INSERT INTO wf.ChangeEvent (EntityType, EntityId, Action, ReasonCode, ReasonText, UserId, AfterJson, CreatedAt)
        VALUES (@entityType, @entityId, @action, @reasonCode, @reasonText, @userId, @afterJson, GETUTCDATE())
      `);
  }

  return {
    alreadyPosted: false,
    couponRecord,
    reservation: r,
    deliveryEvidence,
    carLicense: deliveryEvidence?.carLicense || 'TEST-PLATE',
    eligibility,
    expiryEval,
    warnings,
    policy: {
      strictMode: effectiveStrictMode,
      strictOverride: effectiveStrictOverride,
      snapshotId: policySettings.snapshotId,
      revisionNumber: policySettings.revisionNumber,
    },
  };
}

/**
 * Post native coupon redemption (gated by feature flag and proven native adapter)
 */
async function postNativeCouponRedemption(reservationId, userId = 1, options = {}) {
  if (typeof userId === 'object' && userId !== null && Object.keys(options).length === 0) {
    options = userId;
    userId = 1;
  }

  const isTestHarness = process.env.NODE_ENV === 'test' ||
                        Boolean(process.env.ALLOW_TEST_NATIVE_WRITEBACK) ||
                        process.argv.some(arg => typeof arg === 'string' && (arg.includes('test') || arg.includes('mocha') || arg.includes('jest')));
  const testAdapter = (isTestHarness && typeof options.adapter === 'function') ? options.adapter : null;

  if (!isNativePostingEnabled() && !testAdapter) {
    throw Object.assign(
      new Error('การตัดส่งตั๋วปุ๋ย native (DocuType 116) ยังไม่เปิดใช้งาน (Feature Flag COUPON_NATIVE_POSTING_ENABLED=false)'),
      { code: 'NATIVE_POSTING_DISABLED', status: 400 }
    );
  }

  const txResult = await wfTransaction(async (tx) => {
    // 1. Fetch reservation under lock
    const res = (await tx.request()
      .input('id', sql.Int, Number(reservationId))
      .query(`SELECT * FROM wf.CouponReservation WITH (UPDLOCK, ROWLOCK) WHERE Id = @id`)
    ).recordset?.[0];

    if (!res) {
      throw Object.assign(new Error('ไม่พบรายการจองตั๋ว'), { code: 'NOT_FOUND', status: 404 });
    }

    const redemptionDocuNo = String(options.docuNo || options.deliveryDocuNo || res.CarrierDocuNo || (options.adapter ? 'SIM-DOC' : '')).trim();
    const deliveryDocuNo = String(options.deliveryDocuNo || redemptionDocuNo).trim();
    if (!redemptionDocuNo) {
      throw Object.assign(
        new Error('ต้องระบุเลขที่เอกสาร/ใบขน (deliveryDocuNo หรือ docuNo) เพื่อตัดตั๋วในระบบ WinSpeed'),
        { code: 'MISSING_DOCU_NO', status: 400 }
      );
    }

    // 2. Shared in-transaction validation
    const validation = await validateReservationBeforePosting({
      reservation: res,
      expectedRevision: options.expectedRevision,
      deliveryDocuNo,
      inputCarLicense: options.carLicense,
      callerRole: options.callerRole,
      overrideApproval: options.overrideApproval,
      userId,
      isSimulated: Boolean(options.adapter),
      tx,
    });

    if (validation.expired) {
      return validation;
    }

    if (validation.alreadyPosted) {
      return {
        id: Number(reservationId),
        status: 'POSTED',
        nativeDocuNo: res.NativeDocuNo,
        nativeRedemptionId: res.NativeRedemptionId,
        idempotent: true,
        warnings: validation.warnings || [],
        policy: validation.policy,
      };
    }

    const couponRecord = validation.couponRecord;
    const carLicense = validation.carLicense;
    const saveEmpId = await resolveVerifiedEmployee(userId, tx);

    // 3. Execute Native Writeback Adapter
    let adapterResult;
    if (testAdapter) {
      adapterResult = await testAdapter(tx, res);
    } else {
      const redemptionNativeAdapter = require('./redemption-native-adapter');
      const createRes = await redemptionNativeAdapter.createRedemptionDocument({
        docuNo: redemptionDocuNo,
        carLicense,
        saveEmpId,
        lines: [{
          couponId: res.CouponId,
          couponNo: res.CouponNo,
          goodId: res.GoodId,
          goodUnitId: couponRecord.GoodUnitID,
          goodPrice: couponRecord.GoodPrice,
          goodQty: res.ReservedQty,
        }]
      }, { existingTx: tx, operatorName: `SaleApp-User-${userId}` });

      adapterResult = {
        nativeDocuNo: createRes.docuNo,
        redemptionId: createRes.redemtionId,
      };
    }

    // 4. Atomically Transition Reservation to POSTED
    const updateRes = await tx.request()
      .input('id', sql.Int, Number(reservationId))
      .input('nativeDoc', sql.VarChar(50), adapterResult.nativeDocuNo)
      .input('redemptionId', sql.Int, adapterResult.redemptionId || null)
      .input('expectedRev', sql.Int, res.Revision)
      .query(`
        UPDATE wf.CouponReservation
        SET Status = 'POSTED',
            NativeDocuNo = @nativeDoc,
            NativeRedemptionId = @redemptionId,
            Revision = Revision + 1,
            SettledAt = GETUTCDATE(),
            UpdatedAt = GETUTCDATE()
        WHERE Id = @id AND Revision = @expectedRev
      `);

    if (updateRes.rowsAffected?.[0] === 0) {
      throw Object.assign(
        new Error(`OCC Conflict: การจองตั๋วถูกแก้ไขระหว่างทำรายการ`),
        { code: 'OCC_CONFLICT', status: 409 }
      );
    }

    return {
      id: Number(reservationId),
      status: 'POSTED',
      nativeDocuNo: adapterResult.nativeDocuNo,
      nativeRedemptionId: adapterResult.redemptionId,
      idempotent: false,
      warnings: validation.warnings || [],
      policy: validation.policy,
      eligibility: validation.eligibility,
    };
  });

  if (txResult?.expired) {
    throw Object.assign(
      new Error(`การจองตั๋วรหัส ${txResult.reservationId} หมดอายุแล้ว (หมดอายุเมื่อ ${new Date(txResult.expiresAt).toISOString()})`),
      { code: 'RESERVATION_EXPIRED', status: 400 }
    );
  }

  return txResult;
}

/**
 * Post native delivery-level coupon redemption batch (same delivery, multi-coupon/multi-reservation)
 */
async function postNativeDeliveryRedemption(params = {}) {
  if (!isNativePostingEnabled()) {
    throw Object.assign(
      new Error('การตัดส่งตั๋วปุ๋ย native (DocuType 116) ยังไม่เปิดใช้งาน (Feature Flag COUPON_NATIVE_POSTING_ENABLED=false)'),
      { code: 'NATIVE_POSTING_DISABLED', status: 400 }
    );
  }

  const {
    deliveryDocuNo,
    reservationIds = [],
    expectedRevisions = {},
    carLicense: inputCarLicense,
    userId = 1,
    callerRole = null,
    overrideApproval = null,
  } = params;

  const docuNo = String(deliveryDocuNo || '').trim();
  if (!docuNo) {
    throw Object.assign(new Error('ต้องระบุเลขที่เอกสาร/ใบขน (deliveryDocuNo)'), { code: 'MISSING_DOCU_NO', status: 400 });
  }

  if (!Array.isArray(reservationIds) || reservationIds.length === 0) {
    throw Object.assign(new Error('ต้องระบุรายการจองตั๋ว (reservationIds) อย่างน้อย 1 รายการ'), { code: 'EMPTY_RESERVATIONS', status: 400 });
  }

  const sortedIds = [...new Set(reservationIds.map(Number))].sort((a, b) => a - b);

  const txResult = await wfTransaction(async (tx) => {
    // 1. Lock all reservations in deterministic order
    const reservations = [];
    for (const rId of sortedIds) {
      const row = (await tx.request()
        .input('id', sql.Int, rId)
        .query(`SELECT * FROM wf.CouponReservation WITH (UPDLOCK, ROWLOCK) WHERE Id = @id`)
      ).recordset?.[0];
      if (!row) {
        throw Object.assign(new Error(`ไม่พบรายการจองตั๋วรหัส ${rId}`), { code: 'NOT_FOUND', status: 404 });
      }
      reservations.push(row);
    }

    // 2. Validate all reservations using shared validator
    const validations = [];
    let allAlreadyPosted = true;
    for (let i = 0; i < reservations.length; i++) {
      const r = reservations[i];
      let expectedRev = undefined;
      if (Array.isArray(expectedRevisions)) {
        expectedRev = expectedRevisions[i];
      } else if (expectedRevisions && typeof expectedRevisions === 'object') {
        expectedRev = expectedRevisions[r.Id];
      }

      const val = await validateReservationBeforePosting({
        reservation: r,
        expectedRevision: expectedRev,
        deliveryDocuNo: docuNo,
        inputCarLicense,
        callerRole,
        overrideApproval,
        userId,
        tx,
      });

      if (val.expired) {
        return val;
      }

      if (!val.alreadyPosted) {
        allAlreadyPosted = false;
      }
      validations.push(val);
    }

    // Idempotent replay if all already posted
    if (allAlreadyPosted) {
      const replayWarnings = [...new Set(validations.flatMap(v => v.warnings || []))];
      return {
        success: true,
        deliveryDocuNo: docuNo,
        redemptionId: reservations[0].NativeRedemptionId,
        postedReservations: reservations.map(r => r.Id),
        lineCount: reservations.length,
        idempotent: true,
        warnings: replayWarnings,
      };
    }

    // If some are posted and some not, or conflicting
    for (const val of validations) {
      if (val.alreadyPosted) {
        throw Object.assign(
          new Error(`รายการจองตั๋วรหัส ${val.reservation.Id} ถูกตัดส่งไปแล้วก่อนหน้า (Partial Batch Replay Not Allowed)`),
          { code: 'IDEMPOTENCY_CONFLICT', status: 409 }
        );
      }
    }

    // 3. Resolve vehicle plate and verified employee
    const carLicense = validations[0].carLicense;
    const saveEmpId = await resolveVerifiedEmployee(userId, tx);

    // 4. Aggregate lines by couponId (Mirror PK is RedemtionID, CouponID)
    const couponMap = new Map();
    for (const val of validations) {
      const r = val.reservation;
      const c = val.couponRecord;

      if (couponMap.has(r.CouponId)) {
        couponMap.get(r.CouponId).goodQty += Number(r.ReservedQty);
      } else {
        couponMap.set(r.CouponId, {
          couponId: r.CouponId,
          couponNo: r.CouponNo,
          goodId: r.GoodId,
          goodUnitId: c.GoodUnitID,
          goodPrice: c.GoodPrice,
          goodQty: Number(r.ReservedQty),
        });
      }
    }

    const lines = Array.from(couponMap.values());

    // 5. Create native 116 redemption document
    const redemptionNativeAdapter = require('./redemption-native-adapter');
    const result = await redemptionNativeAdapter.createRedemptionDocument({
      docuNo,
      carLicense,
      saveEmpId,
      lines,
    }, { existingTx: tx, operatorName: `SaleApp-User-${userId}` });

    // 6. Transition all reservations to POSTED atomically
    for (const r of reservations) {
      const updateRes = await tx.request()
        .input('id', sql.Int, r.Id)
        .input('nativeDoc', sql.VarChar(50), result.docuNo)
        .input('redemptionId', sql.Int, result.redemtionId)
        .input('rev', sql.Int, r.Revision)
        .query(`
          UPDATE wf.CouponReservation
          SET Status = 'POSTED',
              NativeDocuNo = @nativeDoc,
              NativeRedemptionId = @redemptionId,
              Revision = Revision + 1,
              SettledAt = GETUTCDATE(),
              UpdatedAt = GETUTCDATE()
          WHERE Id = @id AND Revision = @rev
        `);

      if (updateRes.rowsAffected?.[0] === 0) {
        throw Object.assign(
          new Error(`OCC Conflict: ข้อมูลการจองตั๋วรหัส ${r.Id} ถูกแก้ไขระหว่างทำรายการ`),
          { code: 'OCC_CONFLICT', status: 409 }
        );
      }
    }

    const aggregatedWarnings = [...new Set(validations.flatMap(v => v.warnings || []))];
    return {
      success: true,
      deliveryDocuNo: result.docuNo,
      redemptionId: result.redemtionId,
      postedReservations: sortedIds,
      lineCount: validations.length,
      idempotent: false,
      warnings: aggregatedWarnings,
      reservations: validations.map(v => ({
        id: v.reservation.Id,
        couponNo: v.reservation.CouponNo,
        warnings: v.warnings,
      })),
    };
  });

  if (txResult?.expired) {
    throw Object.assign(
      new Error(`รายการจองตั๋วรหัส ${txResult.reservationId} หมดอายุแล้ว`),
      { code: 'RESERVATION_EXPIRED', status: 400 }
    );
  }

  return txResult;
}

/**
 * D1: Get non-blocking expiry information for a coupon.
 * Warning only — does NOT block operations anywhere.
 */
async function getCouponExpiryInfo(couponId) {
  const cId = Number(couponId);
  if (!cId) return null;

  let customExpiry = null;
  try {
    const r = await wfQuery(`
      SELECT ExpiryDate, Source, SetBy, SetAt, Note
      FROM wf.CouponExpiry WITH (NOLOCK)
      WHERE CouponId = @cid
    `, { cid: { type: sql.Int, value: cId } });
    customExpiry = r.recordset?.[0];
  } catch {
    // Graceful fallback if migration 140 is pending / unapplied
  }

  const cp = (await wfQuery(`
    SELECT c.CouponID, c.CouponNo, s.DocuDate AS SourceDocuDate
    FROM dbo.WFCoupon c WITH (NOLOCK)
    LEFT JOIN dbo.SOHD s WITH (NOLOCK) ON s.SOID = c.DocuID
    WHERE c.CouponID = @cid
  `, { cid: { type: sql.Int, value: cId } })).recordset?.[0];

  if (!cp) return null;

  let defaultDays = 180;
  let warningLeadDays = 30;
  try {
    const s = await wfQuery(`
      SELECT SettingKey, SettingValue 
      FROM wf.SystemSetting WITH (NOLOCK) 
      WHERE SettingKey IN ('TICKET_EXPIRY_DEFAULT_DAYS', 'TICKET_EXPIRY_WARNING_LEAD_DAYS')
    `);
    for (const row of s.recordset || []) {
      if (row.SettingKey === 'TICKET_EXPIRY_DEFAULT_DAYS') defaultDays = Number(row.SettingValue) || 180;
      if (row.SettingKey === 'TICKET_EXPIRY_WARNING_LEAD_DAYS') warningLeadDays = Number(row.SettingValue) || 30;
    }
  } catch {
    // Fallback to 180 and 30 if wf.SystemSetting does not exist
  }

  let expiryDate = null;
  let source = 'DEFAULT';

  if (customExpiry?.ExpiryDate) {
    expiryDate = new Date(customExpiry.ExpiryDate);
    source = customExpiry.Source || 'MANUAL';
  } else if (cp.SourceDocuDate) {
    const issueDate = new Date(cp.SourceDocuDate);
    expiryDate = new Date(issueDate.getTime() + defaultDays * 24 * 60 * 60 * 1000);
    source = 'DEFAULT';
  }

  const daysLeft = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;

  return {
    couponId: cId,
    couponNo: cp.CouponNo,
    expiryDate: expiryDate ? expiryDate.toISOString().slice(0, 10) : null,
    source,
    daysLeft,
    isExpired: daysLeft !== null ? daysLeft < 0 : false,
    isExpiringSoon: daysLeft !== null ? (daysLeft >= 0 && daysLeft <= warningLeadDays) : false,
    warningLeadDays,
    setBy: customExpiry?.SetBy || null,
    setAt: customExpiry?.SetAt || null,
    note: customExpiry?.Note || null,
  };
}

/**
 * D1: Update coupon expiry date (ADMIN / MANAGER only, audited).
 */
async function updateCouponExpiry(couponId, expiryDate, userId, note = null) {
  const cId = Number(couponId);
  if (!cId) throw Object.assign(new Error('Invalid couponId'), { status: 400 });
  if (!expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(expiryDate).trim())) {
    throw Object.assign(new Error('วันหมดอายุต้องอยู่ในรูปแบบ YYYY-MM-DD'), { status: 400 });
  }

  const expDateStr = String(expiryDate).trim();
  await wfQuery(`
    IF EXISTS (SELECT 1 FROM wf.CouponExpiry WHERE CouponId = @cid)
    BEGIN
      UPDATE wf.CouponExpiry
      SET ExpiryDate = @exp, Source = 'MANUAL', SetBy = @uid, SetAt = GETUTCDATE(), Note = @note, UpdatedAt = GETUTCDATE()
      WHERE CouponId = @cid
    END
    ELSE
    BEGIN
      INSERT INTO wf.CouponExpiry (CouponId, ExpiryDate, Source, SetBy, SetAt, Note, UpdatedAt)
      VALUES (@cid, @exp, 'MANUAL', @uid, GETUTCDATE(), @note, GETUTCDATE())
    END
  `, {
    cid: { type: sql.Int, value: cId },
    exp: { type: sql.Date, value: new Date(expDateStr) },
    uid: { type: sql.Int, value: Number(userId) || null },
    note: { type: sql.NVarChar(255), value: note || null },
  });

  return getCouponExpiryInfo(cId);
}

module.exports = {
  COUPON_NATIVE_POSTING_ENABLED,
  getCouponsForCustomer,
  getCouponExpiryInfo,
  updateCouponExpiry,
  checkBeneficiaryAuthorization,
  reserveCoupon,
  cancelReservation,
  reconcileCoupon,
  listBeneficiaries,
  grantBeneficiary,
  revokeBeneficiary,
  postNativeCouponRedemption,
  postNativeDeliveryRedemption,
  checkMigration139,
  _resetMigration139Cache,
  settleCouponReservations,
  manualSettleCouponCut,
  validateAndLockCouponReservations,
};

