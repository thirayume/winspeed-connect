'use strict';
// Internal transaction primitive. Caller holds the environment fence and
// supplies a reviewed scope verifier; this is not exposed as an HTTP writer.
const { authorizeConversionAction } = require('./rebate-conversion-approval-policy');
const { acquireRebateParticipantFence } = require('./rebate-participant-fence');
const { shipmentUnits } = require('./rebate-shipment-accrual');
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

async function releaseConversionApprovalRequest(query, user, input, epoch, options = {}) {
  const id = Number(input?.id), action = input?.action;
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (typeof query !== 'function' || !positive(id) || !['REJECT','CANCEL'].includes(action) || !reason || reason.length > 500)
    fail('REBATE_CONVERSION_DECISION_INVALID', 400);
  const identity = authorizeConversionAction(user, action === 'CANCEL' ? 'REQUEST' : 'REJECT');
  if (!(options.windowStartUtc instanceof Date) || !Number.isFinite(options.windowStartUtc.getTime()))
    fail('REBATE_DATA_WINDOW_UNAVAILABLE', 503);
  if (!epoch || !['uat','production'].includes(epoch.environment) || !epoch.resetId || !Number.isSafeInteger(epoch.generation) || epoch.generation < 1)
    fail('REBATE_RESET_EPOCH_INVALID', 503);
  if (typeof options.authorizeScope !== 'function') fail('REBATE_CONVERSION_SCOPE_VERIFIER_UNAVAILABLE', 503);
  await (options.participantFence || acquireRebateParticipantFence)(query, epoch);
  const initial = (await query('SELECT Id,CustId FROM wf.RebateConversionApprovalRequest WHERE Id=@id AND CreatedAtUtc>=@windowStartUtc',
    { id, windowStartUtc: options.windowStartUtc })).recordset?.[0];
  const custId = Number(initial?.CustId);
  if (!positive(custId)) fail('REBATE_CONVERSION_REQUEST_NOT_FOUND', 404);
  const lock = (await query(`DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,
    @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult;`,
  { resource: `RebateCust_${custId}` })).recordset?.[0]?.LockResult;
  if (!Number.isInteger(lock) || lock < 0) fail('REBATE_RESERVATION_LOCK_UNAVAILABLE', 503);
  const row = (await query(`SELECT r.*,c.Status AS ConversionStatus,c.ConvertedValueBaht
    FROM wf.RebateConversionApprovalRequest r WITH(UPDLOCK,HOLDLOCK)
    JOIN wf.FertilizerTicketConversion c WITH(UPDLOCK,HOLDLOCK) ON c.Id=r.ConversionId
    WHERE r.Id=@id AND r.CreatedAtUtc>=@windowStartUtc`, { id, windowStartUtc: options.windowStartUtc })).recordset?.[0];
  if (!row || Number(row.CustId) !== custId || !same(row.EnvironmentKind, epoch.environment) ||
      !same(row.ResetId, epoch.resetId) || Number(row.Generation) !== epoch.generation) fail('REBATE_CONVERSION_REQUEST_NOT_FOUND', 404);
  if (action === 'CANCEL' && Number(row.EffectivePrimaryId) !== identity.effectivePrimaryId)
    fail('REBATE_CONVERSION_CANCEL_FORBIDDEN', 403);
  if (!await options.authorizeScope(query, user, row)) fail('REBATE_CONVERSION_REQUEST_NOT_FOUND', 404);
  const next = action === 'REJECT' ? 'REJECTED' : 'CANCELLED';
  if (row.Status === next) {
    if (Number(row.DecisionActorPrimaryId) !== identity.actorPrimaryId || Number(row.DecisionEffectivePrimaryId) !== identity.effectivePrimaryId ||
        Number(row.DecisionActorBusinessId) !== identity.actorBusinessId || Number(row.DecisionEffectiveBusinessId) !== identity.effectiveBusinessId ||
        String(row.DecisionReason || '') !== reason || row.ConversionStatus !== next)
      fail('REBATE_CONVERSION_DECISION_CONFLICT');
    const left = (await query(`SELECT TOP 1 Id FROM wf.RebateShipmentReservation WHERE ConversionId=@conversionId AND Status='ACTIVE'`,
      { conversionId: Number(row.ConversionId) })).recordset || [];
    if (left.length) fail('REBATE_CONVERSION_RESERVATION_INVALID');
    return { id, status: next, replayed: true };
  }
  if (row.Status !== 'PENDING' || row.ConversionStatus !== 'PENDING_APPROVAL') fail('REBATE_CONVERSION_DECISION_CONFLICT');
  const reservations = (await query(`SELECT Id,AmountBaht,Status FROM wf.RebateShipmentReservation WITH(UPDLOCK,HOLDLOCK)
    WHERE ConversionId=@conversionId ORDER BY Id`, { conversionId: Number(row.ConversionId) })).recordset || [];
  if (!reservations.length || reservations.some(r => r.Status !== 'ACTIVE')) fail('REBATE_CONVERSION_RESERVATION_INVALID');
  const total = reservations.reduce((sum, r) => sum + shipmentUnits(r.AmountBaht, 2), 0n);
  if (total !== shipmentUnits(row.ConvertedValueBaht, 2)) fail('REBATE_CONVERSION_RESERVATION_INVALID');
  await query(`SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON;
    SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON; SET NUMERIC_ROUNDABORT OFF;`, {});
  const p = { id, conversionId: Number(row.ConversionId), status: next, reason,
    actor: identity.actorPrimaryId, effective: identity.effectivePrimaryId,
    actorBusiness: identity.actorBusinessId, effectiveBusiness: identity.effectiveBusinessId };
  const released = await query(`UPDATE wf.RebateShipmentReservation SET Status='RELEASED',ReleasedAtUtc=GETUTCDATE(),
    ReleaseActorPrimaryId=@actor,ReleaseEffectivePrimaryId=@effective,ReleaseActorBusinessId=@actorBusiness,
    ReleaseEffectiveBusinessId=@effectiveBusiness,ReleaseReason=@reason WHERE ConversionId=@conversionId AND Status='ACTIVE'`, p);
  if (Number(released.rowsAffected?.[0]) !== reservations.length) fail('REBATE_CONVERSION_RESERVATION_INVALID');
  const conversion = await query(`UPDATE wf.FertilizerTicketConversion SET Status=@status
    WHERE Id=@conversionId AND Status='PENDING_APPROVAL'`, p);
  if (Number(conversion.rowsAffected?.[0]) !== 1) fail('REBATE_CONVERSION_DECISION_CONFLICT');
  const request = await query(`UPDATE wf.RebateConversionApprovalRequest SET Status=@status,DecidedAtUtc=GETUTCDATE(),
    DecisionActorPrimaryId=@actor,DecisionEffectivePrimaryId=@effective,DecisionActorBusinessId=@actorBusiness,
    DecisionEffectiveBusinessId=@effectiveBusiness,DecisionReason=@reason WHERE Id=@id AND Status='PENDING'`, p);
  if (Number(request.rowsAffected?.[0]) !== 1) fail('REBATE_CONVERSION_DECISION_CONFLICT');
  return { id, status: next, replayed: false };
}
module.exports = { releaseConversionApprovalRequest };
