'use strict';

const router = require('express').Router();
const { requireAuth, requireRole, requireCapability } = require('../middleware/auth');
const couponService = require('../services/coupon-service');

router.use(requireAuth);

/**
 * GET /api/coupons
 * List eligible coupons for a customer (as owner or beneficiary)
 */
router.get('/', async (req, res) => {
  try {
    const { customerId, goodId, billPrefix } = req.query;
    if (!customerId) {
      return res.status(400).json({ message: 'กรุณาระบุ customerId' });
    }
    const coupons = await couponService.getCouponsForCustomer(customerId, { goodId, billPrefix });
    res.json({ data: coupons, count: coupons.length });
  } catch (err) {
    console.error('[coupons]', err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

/**
 * POST /api/coupons/reserve
 * Reserve coupon balance for an SO/bill/trip
 */
router.post('/reserve', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const {
      couponId,
      carrierSoId,
      carrierDocuNo,
      tripId,
      beneficiaryCustId,
      reservedQty,
      idempotencyKey,
      expiresAt,
      goodUnit,
      billPrefix
    } = req.body || {};

    const result = await couponService.reserveCoupon({
      couponId,
      carrierSoId,
      carrierDocuNo,
      tripId,
      beneficiaryCustId,
      reservedQty,
      userId: req.user.sub,
      idempotencyKey,
      expiresAt,
      goodUnit,
      billPrefix
    });

    res.json(result);
  } catch (err) {
    console.error('[coupons/reserve]', err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

/**
 * POST /api/coupons/cancel
 * Cancel coupon reservation and release available balance
 */
router.post('/cancel', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const { reservationId, reason } = req.body || {};
    if (!reservationId) {
      return res.status(400).json({ message: 'กรุณาระบุ reservationId' });
    }
    const result = await couponService.cancelReservation(
      reservationId,
      reason,
      req.user.sub,
      req.user.role
    );
    res.json(result);
  } catch (err) {
    console.error('[coupons/cancel]', err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

/**
 * GET /api/coupons/reconcile/:couponId
 * Read-only reconciliation of coupon balance against active reservations
 */
router.get('/reconcile/:couponId', async (req, res) => {
  try {
    const result = await couponService.reconcileCoupon(req.params.couponId);
    if (!result) return res.status(404).json({ message: 'ไม่พบตั๋วปุ๋ย' });
    res.json(result);
  } catch (err) {
    console.error('[coupons/reconcile]', err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

/**
 * GET /api/coupons/:id/expiry
 * D1: Non-blocking coupon expiry information and warning status
 */
router.get('/:id/expiry', async (req, res) => {
  try {
    const info = await couponService.getCouponExpiryInfo(req.params.id);
    if (!info) return res.status(404).json({ message: 'ไม่พบตั๋วปุ๋ย' });
    res.json(info);
  } catch (err) {
    console.error('[coupons/expiry/get]', err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

/**
 * PUT /api/coupons/:id/expiry
 * D1: Update coupon expiry date (ADMIN / MANAGER only, audited)
 */
router.put('/:id/expiry', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { expiryDate, note } = req.body || {};
    const updated = await couponService.updateCouponExpiry(req.params.id, expiryDate, req.user.sub, note);
    res.json(updated);
  } catch (err) {
    console.error('[coupons/expiry/put]', err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

/**
 * GET /api/coupons/beneficiaries
 * List coupon beneficiaries (Admin/Manager/C-Level/Accounting)
 */
router.get('/beneficiaries', requireRole('ADMIN', 'MANAGER', 'C_LEVEL', 'ACCOUNTING'), async (req, res) => {
  try {
    const { ownerCustId, beneficiaryCustId, status } = req.query;
    const list = await couponService.listBeneficiaries({ ownerCustId, beneficiaryCustId, status });
    res.json(list);
  } catch (err) {
    console.error('[coupons/beneficiaries/list]', err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

/**
 * POST /api/coupons/beneficiaries
 * Grant coupon redemption rights between customers (Admin/Manager/C-Level/Accounting)
 */
router.post('/beneficiaries', requireRole('ADMIN', 'MANAGER', 'C_LEVEL', 'ACCOUNTING'), async (req, res) => {
  try {
    const { ownerCustId, beneficiaryCustId, effectiveFrom, effectiveTo, scope, reason } = req.body || {};
    const result = await couponService.grantBeneficiary({
      ownerCustId,
      beneficiaryCustId,
      effectiveFrom,
      effectiveTo,
      scope,
      reason,
      userId: req.user.sub
    });
    res.json(result);
  } catch (err) {
    console.error('[coupons/beneficiaries/grant]', err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

/**
 * DELETE /api/coupons/beneficiaries/:id
 * Revoke coupon redemption rights (Admin/Manager/C-Level/Accounting)
 */
router.delete('/beneficiaries/:id', requireRole('ADMIN', 'MANAGER', 'C_LEVEL', 'ACCOUNTING'), async (req, res) => {
  try {
    const { reason } = req.body || {};
    const result = await couponService.revokeBeneficiary(
      req.params.id,
      reason || 'Revoked by administrator',
      req.user.sub
    );
    res.json(result);
  } catch (err) {
    console.error('[coupons/beneficiaries/revoke]', err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

/**
 * POST /api/coupons/post-native
 * Gated native posting for a single coupon reservation
 * R3-01: Client cannot dictate strictMode; warehouse cannot self-approve override
 */
router.post('/post-native', requireRole('WAREHOUSE', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const {
      reservationId,
      deliveryDocuNo,
      docuNo,
      carLicense,
      expectedRevision,
      overrideReason,
      overrideApprovedBy,
    } = req.body || {};

    const callerRole = req.user ? req.user.role : null;
    const callerId = req.user ? req.user.sub : null;

    // R3-01: Warehouse cannot self-approve policy overrides
    if (callerRole === 'WAREHOUSE' && (req.body.strictOverride !== undefined || overrideReason !== undefined || overrideApprovedBy !== undefined)) {
      return res.status(403).json({
        message: 'ผู้ใช้งานบทบาท WAREHOUSE ไม่สามารถอนุมัติผ่อนผันนโยบายตั๋วหมดอายุด้วยตนเองได้',
        code: 'CANNOT_SELF_APPROVE_OVERRIDE',
      });
    }

    // R4-05: Strict approval attribution guard (reject spoofed approver IDs)
    if (overrideApprovedBy !== undefined && overrideApprovedBy !== null) {
      if (String(overrideApprovedBy).trim() !== String(callerId).trim()) {
        return res.status(400).json({
          message: 'ผู้ใช้งานไม่สามารถระบุผู้อนุมัติผ่อนผัน (overrideApprovedBy) เป็นผู้อื่นได้ (ห้ามปลอมแปลงตัวตนผู้อนุมัติ)',
          code: 'APPROVAL_ATTRIBUTION_MISMATCH',
        });
      }
    }

    let overrideApproval = null;
    if (overrideReason) {
      if (typeof overrideReason !== 'string' || overrideReason.trim().length < 5) {
        return res.status(400).json({
          message: 'เหตุผลการขอผ่อนผันนโยบาย (overrideReason) ต้องมีความยาวอย่างน้อย 5 ตัวอักษร',
          code: 'INVALID_OVERRIDE_REASON',
        });
      }
      overrideApproval = {
        approved: true,
        approvedBy: callerId,
        executorId: callerId,
        reason: overrideReason.trim(),
        role: callerRole,
      };
    }

    const result = await couponService.postNativeCouponRedemption(reservationId, callerId, {
      docuNo,
      deliveryDocuNo: deliveryDocuNo || docuNo,
      carLicense,
      expectedRevision,
      callerRole,
      overrideApproval,
    });
    res.json(result);
  } catch (err) {
    console.error('[coupons/post-native]', err);
    res.status(err.status || 500).json({ message: err.message, code: err.code });
  }
});

/**
 * POST /api/coupons/post-native-delivery
 * Gated native posting for same-delivery batch (multi-coupon/multi-reservation)
 * R3-01: Client cannot dictate strictMode; warehouse cannot self-approve override
 * R4-05: Strict approval attribution guard
 */
router.post('/post-native-delivery', requireRole('WAREHOUSE', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const {
      deliveryDocuNo,
      reservationIds,
      expectedRevisions,
      carLicense,
      overrideReason,
      overrideApprovedBy,
    } = req.body || {};

    const callerRole = req.user ? req.user.role : null;
    const callerId = req.user ? req.user.sub : null;

    // R3-01: Warehouse cannot self-approve policy overrides
    if (callerRole === 'WAREHOUSE' && (req.body.strictOverride !== undefined || overrideReason !== undefined || overrideApprovedBy !== undefined)) {
      return res.status(403).json({
        message: 'ผู้ใช้งานบทบาท WAREHOUSE ไม่สามารถอนุมัติผ่อนผันนโยบายตั๋วหมดอายุด้วยตนเองได้',
        code: 'CANNOT_SELF_APPROVE_OVERRIDE',
      });
    }

    // R4-05: Strict approval attribution guard (reject spoofed approver IDs)
    if (overrideApprovedBy !== undefined && overrideApprovedBy !== null) {
      if (String(overrideApprovedBy).trim() !== String(callerId).trim()) {
        return res.status(400).json({
          message: 'ผู้ใช้งานไม่สามารถระบุผู้อนุมัติผ่อนผัน (overrideApprovedBy) เป็นผู้อื่นได้ (ห้ามปลอมแปลงตัวตนผู้อนุมัติ)',
          code: 'APPROVAL_ATTRIBUTION_MISMATCH',
        });
      }
    }

    let overrideApproval = null;
    if (overrideReason) {
      if (typeof overrideReason !== 'string' || overrideReason.trim().length < 5) {
        return res.status(400).json({
          message: 'เหตุผลการขอผ่อนผันนโยบาย (overrideReason) ต้องมีความยาวอย่างน้อย 5 ตัวอักษร',
          code: 'INVALID_OVERRIDE_REASON',
        });
      }
      overrideApproval = {
        approved: true,
        approvedBy: callerId,
        executorId: callerId,
        reason: overrideReason.trim(),
        role: callerRole,
      };
    }

    const result = await couponService.postNativeDeliveryRedemption({
      deliveryDocuNo,
      reservationIds,
      expectedRevisions,
      carLicense,
      callerRole,
      overrideApproval,
      userId: callerId,
    });
    res.json(result);
  } catch (err) {
    console.error('[coupons/post-native-delivery]', err);
    res.status(err.status || 500).json({ message: err.message, code: err.code });
  }
});

/**
 * POST /api/coupons/settle-cuts
 * Trigger automatic settlement of native cuts against reservations (R6-5 / D4)
 */
router.post('/settle-cuts', requireCapability('coupon.settle'), async (req, res) => {
  try {
    const { couponId } = req.body || {};
    if (couponId) {
      const result = await couponService.settleCouponReservations(couponId, req.user);
      return res.json(result);
    }

    // If no couponId provided, check all coupons with active reservations
    const { wfQuery } = require('../db');
    const activeCoupons = (await wfQuery(`
      SELECT DISTINCT CouponId FROM wf.CouponReservation WHERE Status = 'RESERVED'
    `)).recordset || [];

    let totalSettled = 0;
    const allSettlements = [];
    const allAmbiguous = [];
    const allUnmatched = [];

    for (const c of activeCoupons) {
      const r = await couponService.settleCouponReservations(c.CouponId, req.user);
      totalSettled += r.settledCount || 0;
      if (r.settlements?.length) allSettlements.push(...r.settlements);
      if (r.ambiguous?.length) allAmbiguous.push(...r.ambiguous);
      if (r.unmatched?.length) allUnmatched.push(...r.unmatched);
    }

    res.json({
      settledCount: totalSettled,
      settlements: allSettlements,
      ambiguous: allAmbiguous,
      unmatched: allUnmatched,
      processedCoupons: activeCoupons.length
    });
  } catch (err) {
    console.error('[coupons/settle-cuts]', err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

/**
 * POST /api/coupons/manual-settle
 * FR-1: Manual settlement of one native cut against one chosen reservation
 * Restricted to ADMIN, MANAGER, C_LEVEL, ACCOUNTING (O-3)
 */
router.post('/manual-settle', requireCapability('coupon.settle'), async (req, res) => {
  try {
    const { reservationId, redemptionId, reason, qty, beneficiaryCustId, overridePlate } = req.body || {};
    const result = await couponService.manualSettleCouponCut({
      reservationId,
      redemptionId,
      reason,
      qty,
      beneficiaryCustId,
      overridePlate: overridePlate === true,
      actor: req.user,
    });
    res.json(result);
  } catch (err) {
    console.error('[coupons/manual-settle]', err);
    res.status(err.status || 500).json({ message: err.message, code: err.code });
  }
});

module.exports = router;

