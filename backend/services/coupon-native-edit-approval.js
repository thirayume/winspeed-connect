'use strict';

const { randomUUID } = require('node:crypto');
const { sql, wfTransaction } = require('../db');
const { requireAuthorizationActor } = require('./coupon-native-authorization');
const { assertNativeHoldPrimary } = require('./coupon-native-review-queue');
const { loadNativeRecoverySnapshotForUpdate } = require('./coupon-native-recovery-snapshot');
const { couponVisible, reservationsVisible } = require('./coupon-access-scope');
const { isValidStartDate, DEFAULT_START_DATE } = require('./data-window');
const { KEY } = require('./global-data-window-store');

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

function nativeId(value) {
  return /^\d+$/.test(String(value)) && Number(value) > 0 && Number(value) <= 2147483647
    ? Number(value) : null;
}

function quantityUnits(value) {
  if (typeof value !== 'string' || !/^\d{1,8}(?:\.\d{1,4})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 10000 + Number(fraction.padEnd(4, '0'));
}

function targetsFor(operation, items) {
  if (operation === 'cancel' && (items == null || (Array.isArray(items) && items.length === 0))) return null;
  if (operation !== 'reduce' || !Array.isArray(items) || items.length === 0 || items.length > 100)
    fail('COUPON_EDIT_APPROVAL_TARGETS_INVALID', 400);
  const targets = new Map();
  for (const item of items) {
    const id = nativeId(item?.couponId);
    const units = quantityUnits(item?.qtyAfter);
    if (!id || units === null || targets.has(id)) fail('COUPON_EDIT_APPROVAL_TARGETS_INVALID', 400);
    targets.set(id, units);
  }
  return targets;
}

async function assertBridge(query) {
  const result = await query(`SELECT CASE WHEN
    OBJECT_ID('wf.sp_ApproveCouponNativeEditLine','P') IS NOT NULL
    AND (SELECT COUNT(*) FROM sys.triggers
         WHERE name IN ('WF_CouponNativeEditBalanceHook','WF_CouponNativeEditHeadHook','WF_CouponNativeEditDetailHook',
                        'WF_CouponNativeEditFinalize','WF_CouponRecoveryFence','WF_NativeEditHoldRetain') AND is_disabled=0)=6
    AND NOT EXISTS(SELECT 1 FROM sys.triggers WHERE is_disabled=0 AND name IN (
      'WF_CouponEvidenceHeaderFence','WF_CouponEvidenceDetailFence','WF_CouponEvidenceInsertFence',
      'WF_CouponAuthorizationReservationFence','WF_CouponNativeEditHoldGuard'))
    THEN 1 ELSE 0 END AS Ready`);
  if (result.recordset?.length !== 1 || result.recordset[0].Ready !== 1)
    fail('COUPON_EDIT_APPROVAL_BRIDGE_UNAVAILABLE', 503);
}

async function approveNativeEdit({ actor, redemptionId, operation, items, reason, dataWindow }, deps = {}) {
  const rid = nativeId(redemptionId);
  const targets = targetsFor(operation, items);
  if (!rid || typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500 ||
      !isValidStartDate(dataWindow?.businessDate)) fail('COUPON_EDIT_APPROVAL_INVALID', 400);
  const ids = await requireAuthorizationActor(actor, deps);
  const editId = randomUUID();

  return (deps.wfTransaction || wfTransaction)(async tx => {
    await (deps.assertNativeHoldPrimary || assertNativeHoldPrimary)(tx);
    const reqFor = input => {
      const request = tx.request();
      for (const [name, [type, value]] of Object.entries(input)) request.input(name, type, value);
      return request;
    };
    const query = (text, inputs = {}) => {
      const request = tx.request();
      for (const [name, { type, value }] of Object.entries(inputs)) request.input(name, type, value);
      return request.query(text);
    };
    await (deps.assertBridge || assertBridge)(query);
    const settings = (await reqFor({ key:[sql.NVarChar(100), KEY] }).query(
      'SELECT SettingValue FROM wf.SystemSetting WITH (HOLDLOCK) WHERE SettingKey=@key')).recordset;
    const cutoff = settings?.[0]?.SettingValue || DEFAULT_START_DATE;
    if (!Array.isArray(settings) || settings.length > 1 || !isValidStartDate(cutoff))
      fail('DATA_WINDOW_UNAVAILABLE', 503);
    if (cutoff !== dataWindow.businessDate) fail('DATA_WINDOW_CHANGED');

    const snapshot = await (deps.loadSnapshot || loadNativeRecoverySnapshotForUpdate)(tx, rid);
    for (const line of snapshot.lines) {
      if (!await (deps.couponVisible || couponVisible)(actor, line.couponId, query))
        fail('COUPON_EDIT_APPROVAL_NOT_FOUND', 404);
    }
    const links = (await reqFor({ rid:[sql.Int, rid] }).query(`
      SELECT TOP 101 s.CouponId,s.ReservationId,
       CONVERT(varchar(20),s.Id) AS SettlementId,CONVERT(varchar(20),l.Id) AS AuthorizationLineId
      FROM wf.CouponReservationSettlement s WITH (UPDLOCK,HOLDLOCK)
      JOIN wf.CouponNativeCutAuthorizationLine l WITH (HOLDLOCK)
        ON l.CouponId=s.CouponId AND l.ReservationId=s.ReservationId
      JOIN wf.CouponNativeCutEvidence e WITH (HOLDLOCK)
        ON e.AuthorizationLineId=l.Id AND e.NativeRedemptionId=s.NativeRedemptionId AND e.EvidenceState='APPLIED'
      WHERE s.NativeRedemptionId=@rid ORDER BY s.CouponId`)).recordset;
    if (!Array.isArray(links) || links.length !== snapshot.lines.length ||
        links.some((row, index) => Number(row.CouponId) !== snapshot.lines[index].couponId))
      fail('COUPON_EDIT_APPROVAL_LINKS_INVALID');
    if (!await (deps.reservationsVisible || reservationsVisible)(actor, links.map(row => row.ReservationId), query))
      fail('COUPON_EDIT_APPROVAL_NOT_FOUND', 404);

    const planned = snapshot.lines.map((line, index) => {
      const before = quantityUnits(line.qty);
      const after = targets ? targets.get(line.couponId) : 0;
      if (before === null || after == null || after > before) fail('COUPON_EDIT_APPROVAL_TARGETS_INVALID', 400);
      return { ...line, before, after, ...links[index] };
    });
    if ((targets && (targets.size !== planned.length || planned.every(line => line.after === 0))) ||
        !planned.some(line => line.after < line.before)) fail('COUPON_EDIT_APPROVAL_TARGETS_INVALID', 400);

    for (const line of planned) {
      const request = reqFor({
        editId:[sql.UniqueIdentifier, editId], couponId:[sql.Int, line.couponId],
        authorizationLineId:[sql.VarChar(20), line.AuthorizationLineId], settlementId:[sql.VarChar(20), line.SettlementId],
        redemptionId:[sql.Int, rid], qtyBefore:[sql.Decimal(12,4), line.before / 10000],
        qtyAfter:[sql.Decimal(12,4), line.after / 10000], nativeBefore:[sql.VarChar(32), line.nativeBalance],
        operation:[sql.Char(1), operation === 'cancel' ? 'C' : 'E'],
        docuNo:[sql.VarChar(50), snapshot.docuNo], docuDate:[sql.VarChar(10), snapshot.docuDate],
        effectiveUserId:[sql.Int, ids.effective], actorUserId:[sql.Int, ids.actor],
      });
      try {
        await request.query(`EXEC wf.sp_ApproveCouponNativeEditLine @editId,@couponId,@authorizationLineId,@settlementId,
          @redemptionId,@qtyBefore,@qtyAfter,@nativeBefore,@operation,@docuNo,@docuDate,@effectiveUserId,@actorUserId`);
      } catch (error) {
        const conflict = error?.message?.trim().match(/^COUPON_EDIT_APPROVAL_(ALREADY_EXISTS|SOURCE_CHANGED)$/)?.[0];
        if (conflict) fail(conflict);
        throw error;
      }
    }

    const recovery = (await query(`SELECT CASE WHEN NOT EXISTS(
      SELECT 1 FROM wf.SchemaMigration WHERE FileName='237_coupon_native_edit_resume.sql') THEN 0
      WHEN OBJECT_ID('wf.sp_SnapshotCouponNativeEdit','P') IS NOT NULL THEN 1
      ELSE -1 END AS Enabled`)).recordset?.[0]?.Enabled;
    if (recovery !== 0 && recovery !== 1) fail('COUPON_EDIT_SNAPSHOT_UNAVAILABLE',503);
    if (recovery === 1 && operation === 'reduce') {
      await reqFor({ editId:[sql.UniqueIdentifier, editId] })
        .query('EXEC wf.sp_SnapshotCouponNativeEdit @editId');
    }
    await reqFor({
      editId:[sql.VarChar(36), editId], effective:[sql.VarChar(20), String(ids.effective)],
      actor:[sql.VarChar(20), String(ids.actor)], reason:[sql.NVarChar(500), reason.trim()],
      summary:[sql.NVarChar(sql.MAX), JSON.stringify({ operation, lineCount: planned.length })],
    }).query(`INSERT wf.ChangeEvent (EntityType,EntityId,Action,ReasonCode,ReasonText,AfterJson,UserId,ActorUserId)
      VALUES('COUPON_NATIVE_EDIT',@editId,'APPROVE','NATIVE_116_EDIT',@reason,@summary,@effective,@actor)`);
    return { editId, operation, lineCount: planned.length };
  }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
}

module.exports = { approveNativeEdit, assertBridge };
