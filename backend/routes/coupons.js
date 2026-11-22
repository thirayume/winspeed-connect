'use strict';

const router = require('express').Router();
const { requireAuth, requireRole, requireCapability } = require('../middleware/auth');
const couponService = require('../services/coupon-service');

router.use(requireAuth);

router.post('/native-edits/:redemptionId/approval', requireCapability('coupon.settle'), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const { operation, items, reason } = req.body || {};
    const approved = await require('../services/coupon-native-edit-approval').approveNativeEdit({
      actor: req.user, redemptionId: req.params.redemptionId, operation, items, reason, dataWindow,
    });
    res.status(201).json(approved);
  } catch (err) {
    res.status(err.status || 500).json({
      code: err.code,
      message: err.status ? err.message : 'ไม่สามารถอนุมัติการแก้ไขใบขนได้ กรุณาลองใหม่',
    });
  }
});

router.post('/native-edits/:editId/release', requireCapability('coupon.settle'), async (req,res)=>{
  res.set('Cache-Control','no-store');
  try {
    const result=await require('../services/coupon-native-edit-release').releaseNativeEdit({
      actor:req.user,editId:req.params.editId,reason:req.body?.reason,
    });
    res.json(result);
  } catch(error) {
    res.status(error.status||500).json({code:error.code,message:'ไม่สามารถตรวจและปล่อยยอดพักได้ กรุณาตรวจหลักฐานแล้วลองใหม่'});
  }
});

router.post('/native-edits/:editId/resume', requireCapability('coupon.settle'), async (req,res)=>{
  res.set('Cache-Control','no-store');
  try {
    const result=await require('../services/coupon-native-edit-release').resumeNativeEdit({
      actor:req.user,editId:req.params.editId,reason:req.body?.reason,
    });
    res.json(result);
  } catch(error) {
    res.status(error.status||500).json({code:error.code,message:'กู้ใบขนตามแผนไม่ได้ กรุณาตรวจสถานะและหลักฐานอีกครั้ง'});
  }
});

// Review only: never consumes or releases a reservation. The service limits
// access to the primary database and audits both identities transactionally.
router.get('/native-review', requireCapability('coupon.settle'), async (req,res) => {
  try {
    const window=await require('../services/global-data-window-store').readGlobalDataWindow();
    const db=require('../db');
    const database=`${db.getTarget()}:${db.getDbName() || process.env.ONPREM_DB_NAME || ''}`;
    const {encodeCursor,decodeCursor}=require('../services/coupon-review-cursor');
    // Validate availability before reading/auditing the queue.
    encodeCursor(0,req.user,database,window.businessDate);
    const afterId=req.query.cursor==null?0:decodeCursor(req.query.cursor,req.user,database,window.businessDate);
    const limit=10;
    const result=await require('../services/coupon-native-review-queue').listNativeCutReview({
      actor:req.user,dataWindow:window,afterId,limit,
    });
    res.set('Cache-Control','no-store');
    res.json({items:result.items,nextCursor:result.scannedCount===limit
      ?encodeCursor(result.scannedThrough,req.user,database,window.businessDate):null});
  } catch(err) {
    res.set('Cache-Control','no-store');
    res.status(err.status || 500).json({message:err.status ? err.message : 'ไม่สามารถตรวจคิวใบขนได้ กรุณาลองใหม่',code:err.code});
  }
});

// Records a review decision only; the hold and all native balances remain.
router.post('/native-review/:authorizationId/hold', requireCapability('coupon.settle'), async (req,res) => {
  try {
    const window=await require('../services/global-data-window-store').readGlobalDataWindow();
    const result=await require('../services/coupon-native-review-queue').recordNativeReviewHold({
      actor:req.user,dataWindow:window,authorizationId:req.params.authorizationId,
      expectedCode:req.body?.expectedCode,note:req.body?.note,
    });
    res.set('Cache-Control','no-store');
    res.json(result);
  } catch(err) {
    res.set('Cache-Control','no-store');
    res.status(err.status || 500).json({message:err.status ? err.message : 'ไม่สามารถบันทึกผลตรวจได้ กรุณาลองใหม่',code:err.code});
  }
});

// Read-only, permission- and scope-checked confirmation after a WinSpeed save.
router.get('/verify-redemption', requireCapability('coupon.settle'), async (req, res) => {
  try {
    req.auditVerificationRead = true;
    const result = await require('../services/coupon-redemption-verification').verifyRedemptionDocument(req.user, req.query.docNo,{
      includeEdit:req.query.forEdit==='1',
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.status ? err.message : 'ไม่สามารถตรวจใบขนได้ กรุณาลองใหม่', code: err.code });
  }
});

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
    const coupons = await couponService.getCouponsForCustomer(customerId, { goodId, billPrefix, actor:req.user });
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
      actor: req.user,
      idempotencyKey,
      expiresAt,
      goodUnit,
      billPrefix
    });

    res.json(result);
  } catch (err) {
    console.error('[coupons/reserve]', err);
    res.status(err.status || 500).json({ message: err.message, code: err.code });
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
      req.user.role,
      null,
      req.user
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
    const result = await couponService.reconcileCoupon(req.params.couponId, { actor:req.user });
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
    if (!await require('../services/coupon-access-scope').couponVisible(req.user,req.params.id))
      return res.status(404).json({ message: 'ไม่พบตั๋วปุ๋ย' });
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
    const updated = await couponService.updateCouponExpiry(req.params.id, expiryDate, req.user.sub, note, req.user);
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
      actor: req.user,
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
      actor: req.user,
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
    const window=await require('../services/global-data-window-store').readGlobalDataWindow();
    const {presentSettlement}=require('../services/coupon-settlement-presentation');
    const { couponId } = req.body || {};
    if (couponId) {
      const result = await couponService.settleCouponReservations(couponId, req.user);
      return res.json(await presentSettlement(result,window));
    }

    // If no couponId provided, check all coupons with active reservations
    const { wfQuery } = require('../db');
    const scope = await require('../services/coupon-access-scope').couponScope(req.user);
    const activeCoupons = (await wfQuery(`
      SELECT DISTINCT cr.CouponId FROM wf.CouponReservation cr
      JOIN dbo.WFCoupon c ON c.CouponID=cr.CouponId
      JOIN dbo.SOHD s ON s.SOID=c.DocuID
      LEFT JOIN wf.SalesOrderExt couponOwnerExt ON couponOwnerExt.SOID=CONVERT(VARCHAR(50),s.SOID)
      WHERE cr.Status='RESERVED' AND ${scope.sql}
    `,scope.inputs)).recordset || [];

    let totalSettled = 0;
    const allSettlements = [];
    const allAmbiguous = [];
    const allUnmatched = [];
    const failures = [];

    for (const c of activeCoupons) {
      try {
        const r = await couponService.settleCouponReservations(c.CouponId, req.user);
        if (r.code === 'SETTLEMENT_IN_PROGRESS' || r.code === 'MIGRATION_139_REQUIRED') {
          failures.push({code:r.code});
          continue;
        }
        totalSettled += r.settledCount || 0;
        if (r.settlements?.length) allSettlements.push(...r.settlements);
        if (r.ambiguous?.length) allAmbiguous.push(...r.ambiguous);
        if (r.unmatched?.length) allUnmatched.push(...r.unmatched);
      } catch (e) {
        const code=String(e.code || 'SETTLEMENT_FAILED');
        failures.push({code:/^[A-Z0-9_]{1,60}$/.test(code) ? code : 'SETTLEMENT_FAILED'});
      }
    }

    const response=await presentSettlement({
      settledCount: totalSettled,
      settlements: allSettlements,
      ambiguous: allAmbiguous,
      unmatched: allUnmatched,
      processedCoupons: activeCoupons.length,
      failedCoupons:failures.length,
      failures,
      partial:failures.length>0,
      ...(failures.length ? {note:`มี ${failures.length} ตั๋วที่ตรวจไม่สำเร็จ กรุณาลองใหม่`} : {}),
    },window);
    res.status(failures.length ? 207 : 200).json(response);
  } catch (err) {
    console.error('[coupons/settle-cuts]', err);
    res.status(err.status || 500).json({ message: err.message });
  }
});

/**
 * Link every coupon line of one committed 116 atomically after human review.
 * This does not itself prevent an independent WinSpeed write.
 */
router.post('/manual-settle-document', requireCapability('coupon.settle'), async (req, res) => {
  try {
    const window=await require('../services/global-data-window-store').readGlobalDataWindow();
    const { redemptionId, items, reason }=req.body || {};
    const result=await require('../services/coupon-manual-document-settlement').manualSettleCouponDocument({
      redemptionId, items, reason, actor:req.user, dataWindow:window,
    });
    res.json(result);
  } catch (err) {
    console.error('[coupons/manual-settle-document]',err);
    res.status(err.status || 500).json({message:err.status ? err.message : 'ไม่สามารถจับคู่ใบขนได้ กรุณาลองใหม่',code:err.code});
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
    const window=await require('../services/global-data-window-store').readGlobalDataWindow();
    if (!(await require('../services/coupon-settlement-presentation').visibleRedemptionIds([redemptionId],window)).has(String(Number(redemptionId))))
      return res.status(404).json({message:'ไม่พบรายการตัดตั๋ว'});
    const result = await couponService.manualSettleCouponCut({
      reservationId,
      redemptionId,
      reason,
      qty,
      beneficiaryCustId,
      overridePlate: overridePlate === true,
      dataWindow: window,
      actor: req.user,
    });
    res.json(result);
  } catch (err) {
    console.error('[coupons/manual-settle]', err);
    res.status(err.status || 500).json({ message: err.message, code: err.code });
  }
});

module.exports = router;

