'use strict';

const router = require('express').Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const couponService = require('../services/coupon-service');

router.use(requireAuth);

/**
 * GET /api/coupons
 * List eligible coupons for a customer (as owner or beneficiary)
 */
router.get('/', async (req, res) => {
  try {
    const { customerId, goodId } = req.query;
    if (!customerId) {
      return res.status(400).json({ message: 'กรุณาระบุ customerId' });
    }
    const coupons = await couponService.getCouponsForCustomer(customerId, { goodId });
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
      goodUnit
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
      goodUnit
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
 * GET /api/coupons/beneficiaries
 * List coupon beneficiaries
 */
router.get('/beneficiaries', async (req, res) => {
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
 * Grant coupon redemption rights between customers (Admin/Manager only)
 */
router.post('/beneficiaries', requireRole('ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
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
 * Revoke coupon redemption rights (Admin/Manager only)
 */
router.delete('/beneficiaries/:id', requireRole('ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
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
 * Gated native posting
 */
router.post('/post-native', requireRole('WAREHOUSE', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const { reservationId } = req.body || {};
    const result = await couponService.postNativeCouponRedemption(reservationId, req.user.sub);
    res.json(result);
  } catch (err) {
    console.error('[coupons/post-native]', err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

module.exports = router;
