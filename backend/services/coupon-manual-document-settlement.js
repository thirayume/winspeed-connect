'use strict';

const { sql, wfTransaction } = require('../db');
const { hasPermission } = require('./role-capabilities');
const { assertPrimaryDatabase } = require('./coupon-manual-window-fence');
const { isValidStartDate } = require('./data-window');

function problem(message, code, status = 409) {
  return Object.assign(new Error(message), { code, status });
}
function integerId(value) {
  const n = Number(value);
  return /^\d+$/.test(String(value)) && Number.isSafeInteger(n) && n > 0 && n <= 2147483647 ? n : null;
}
function quantityUnits(value) {
  if (value == null || value === '') return null;
  const n = Number(value), units = Math.round(n * 10000);
  return Number.isFinite(n) && n > 0 && Number.isSafeInteger(units) && units <= 999999999999 && units / 10000 === n ? units : null;
}

// Explicit human-reviewed linking AFTER WinSpeed has committed a document.
// This is not a native posting guard: unapproved WinSpeed writes are not blocked.
// Only complete, previously unlinked documents with one line per coupon are
// accepted. Every manual settlement, audit and outbox event shares one SQL tx.
async function manualSettleCouponDocument({ redemptionId, items, reason, actor, dataWindow }, deps = {}) {
  if (!actor || !hasPermission(actor, 'coupon.settle'))
    throw problem('สิทธิ์ไม่เพียงพอ', 'COUPON_SETTLEMENT_PERMISSION_REQUIRED', 403);
  if (!isValidStartDate(dataWindow?.businessDate))
    throw problem('ไม่สามารถตรวจวันเริ่มข้อมูลได้', 'DATA_WINDOW_UNAVAILABLE', 503);
  const docId = integerId(redemptionId);
  if (!docId || !Array.isArray(items) || !items.length || items.length > 100 ||
      typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500)
    throw problem('ข้อมูลใบขนหรือเหตุผลไม่ถูกต้อง', 'COUPON_DOCUMENT_SETTLEMENT_INVALID', 400);
  const normalized = items.map(item => ({
    reservationId: integerId(item?.reservationId), couponId: integerId(item?.couponId),
    units: quantityUnits(item?.qty), beneficiaryCustId: item?.beneficiaryCustId,
    overridePlate: item?.overridePlate === true,
  }));
  if (normalized.some(item => !item.reservationId || !item.couponId || !item.units) ||
      new Set(normalized.map(item => item.reservationId)).size !== normalized.length ||
      new Set(normalized.map(item => item.couponId)).size !== normalized.length)
    throw problem('รายการจอง สินค้า หรือจำนวนซ้ำหรือไม่ถูกต้อง', 'COUPON_DOCUMENT_LINES_INVALID', 400);
  normalized.sort((a,b) => a.couponId-b.couponId);
  const transact = deps.wfTransaction || wfTransaction;
  const settleOne = deps.settleOne || require('./coupon-service').manualSettleCouponCut;
  return transact(async tx => {
    await (deps.assertPrimaryDatabase || assertPrimaryDatabase)(tx);
    const query = async (text, inputs = {}) => {
      const req = tx.request();
      for (const [key, {type, value}] of Object.entries(inputs)) req.input(key, type, value);
      return req.query(text);
    };
    // Take the same native coupon locks used by reservation creation, in a
    // stable order, before inspecting the document or writing any settlement.
    for (const item of normalized) {
      const rows=(await query('SELECT CouponID FROM dbo.WFCoupon WITH (UPDLOCK,HOLDLOCK) WHERE CouponID=@cid',
        {cid:{type:sql.Int,value:item.couponId}})).recordset || [];
      if (rows.length !== 1) throw problem('ไม่พบรายการที่ตรวจสอบได้', 'COUPON_DOCUMENT_NOT_VERIFIED', 404);
    }
    for (const item of normalized) {
      const rows=(await query('SELECT Id FROM wf.CouponReservation WITH (UPDLOCK,HOLDLOCK) WHERE Id=@rid AND CouponId=@cid',
        {rid:{type:sql.BigInt,value:item.reservationId},cid:{type:sql.Int,value:item.couponId}})).recordset || [];
      if (rows.length !== 1) throw problem('ไม่พบรายการที่ตรวจสอบได้', 'COUPON_DOCUMENT_NOT_VERIFIED', 404);
    }
    const couponVisible=deps.couponVisible || require('./coupon-access-scope').couponVisible;
    const reservationsVisible=deps.reservationsVisible || require('./coupon-access-scope').reservationsVisible;
    for (const item of normalized) {
      if (!await couponVisible(actor,item.couponId,query))
        throw problem('ไม่พบรายการที่ตรวจสอบได้', 'COUPON_DOCUMENT_NOT_VERIFIED', 404);
    }
    if (!await reservationsVisible(actor,normalized.map(x=>x.reservationId),query))
      throw problem('ไม่พบรายการที่ตรวจสอบได้', 'COUPON_DOCUMENT_NOT_VERIFIED', 404);
    const headers=(await query(`SELECT RedemtionID FROM dbo.WFRedemtionHD WITH (UPDLOCK,HOLDLOCK)
      WHERE RedemtionID=@id AND DocuType=116 AND DocuDate>=@start
        AND ISNULL(LTRIM(RTRIM(DocuStatus)),'') IN ('N','Y')`, {
      id:{type:sql.Int,value:docId}, start:{type:sql.Date,value:dataWindow.businessDate},
    })).recordset || [];
    if (headers.length !== 1) throw problem('ไม่พบใบขนที่ตรวจสอบได้', 'COUPON_DOCUMENT_NOT_VERIFIED', 404);
    const lines=(await query(`SELECT TOP 101 CouponID,GoodQty FROM dbo.WFRedemtionDT WITH (UPDLOCK,HOLDLOCK)
      WHERE RedemtionID=@id ORDER BY CouponID`, {id:{type:sql.Int,value:docId}})).recordset || [];
    const previous=(await query(`SELECT TOP 1 1 AS Existing FROM wf.CouponReservationSettlement WITH (UPDLOCK,HOLDLOCK)
      WHERE NativeRedemptionId=@id`, {id:{type:sql.Int,value:docId}})).recordset || [];
    if (previous.length) throw problem('ใบขนนี้มีรายการจับคู่แล้ว กรุณาตรวจสอบ', 'COUPON_DOCUMENT_ALREADY_LINKED');
    if (lines.length !== normalized.length || lines.length > 100 || lines.some((line,i) =>
      integerId(line.CouponID) !== normalized[i].couponId || quantityUnits(line.GoodQty) !== normalized[i].units))
      throw problem('รายการหรือจำนวนในใบขนไม่ตรงกับรายการที่ตรวจสอบ กรุณาโหลดใหม่', 'COUPON_DOCUMENT_LINES_CHANGED');
    const settlements=[];
    for (const item of normalized) {
      const result=await settleOne({reservationId:item.reservationId,redemptionId:docId,reason,
        qty:item.units/10000,beneficiaryCustId:item.beneficiaryCustId,overridePlate:item.overridePlate,actor,dataWindow,
        deps:{wfQuery:query,wfTransaction:async fn=>fn(tx)}});
      if (!result?.success || Number(result.reservationId)!==item.reservationId || quantityUnits(result.settledQty)!==item.units)
        throw problem('ผลการจับคู่ไม่ตรงกับรายการที่ตรวจสอบ', 'COUPON_DOCUMENT_SETTLEMENT_INCONSISTENT');
      settlements.push({reservationId:result.reservationId,couponId:item.couponId,settledQty:result.settledQty,status:result.status});
    }
    return {success:true,redemptionId:docId,settlements};
  }, {isolationLevel:sql.ISOLATION_LEVEL.SERIALIZABLE});
}
module.exports = { manualSettleCouponDocument };
