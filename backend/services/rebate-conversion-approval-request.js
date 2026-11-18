'use strict';
// Internal transaction primitive. The caller holds the global reset fence and
// must roll back on every error. No HTTP writer is exposed yet.
const crypto = require('crypto');
const { normalize } = require('./rebate-conversion-execution');
const { authorizeConversionAction } = require('./rebate-conversion-approval-policy');
const { acquireRebateParticipantFence } = require('./rebate-participant-fence');
const { sharedRebateScopeFilter } = require('./rebate-shared-scope');
const { readRebateCycleMonths } = require('./rebate-cycle-policy');
const { getBangkokDateString } = require('./so-pickup-policy');
const { executeShipmentSourceConversion } = require('./rebate-shipment-conversion');
const { reserveShipmentAccrual } = require('./rebate-shipment-reservation');
const { readShipmentLots } = require('./rebate-shipment-lots');
const { shipmentUnits } = require('./rebate-shipment-accrual');
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
function sameId(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }

async function createConversionApprovalRequest(query, user, payload, epoch, options = {}) {
  const input = normalize(payload);
  const identity = authorizeConversionAction(user, 'REQUEST');
  if (!(options.windowStartUtc instanceof Date) || !Number.isFinite(options.windowStartUtc.getTime()))
    fail('REBATE_DATA_WINDOW_UNAVAILABLE', 503);
  if (typeof query !== 'function' || !epoch || !['uat','production'].includes(epoch.environment) ||
      !Number.isSafeInteger(epoch.generation) || epoch.generation < 1 || !epoch.resetId)
    fail('REBATE_RESET_EPOCH_INVALID', 503);
  await (options.participantFence || acquireRebateParticipantFence)(query, epoch);
  const lock = (await query(`DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,
    @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult;`,
  { resource: `RebateCust_${input.custId}` })).recordset?.[0]?.LockResult;
  if (!Number.isInteger(lock) || lock < 0) fail('REBATE_RESERVATION_LOCK_UNAVAILABLE', 503);
  const scope = await (options.scopeFilter || sharedRebateScopeFilter)(user, options.getScope);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const old = (await query(`SELECT r.*,c.Status AS ConversionStatus,c.ConvertedValueBaht,
      CASE WHEN r.CreatedAtUtc>=@windowStartUtc THEN 1 ELSE 0 END AS InDataWindow
    FROM wf.RebateConversionApprovalRequest r WITH(UPDLOCK,HOLDLOCK)
    JOIN wf.FertilizerTicketConversion c WITH(UPDLOCK,HOLDLOCK) ON c.Id=r.ConversionId
    WHERE r.RequestId=@requestId`, { requestId: input.requestId, windowStartUtc: options.windowStartUtc })).recordset || [];
  if (old.length > 1) fail('REBATE_CONVERSION_REQUEST_CONFLICT');
  if (old.length) {
    const r = old[0];
    if (Number(r.InDataWindow) !== 1) fail('REBATE_CONVERSION_REQUEST_NOT_FOUND', 404);
    if (!sameId(r.Fingerprint, fingerprint) || !sameId(r.EnvironmentKind, epoch.environment) ||
        !sameId(r.ResetId, epoch.resetId) || Number(r.Generation) !== epoch.generation || Number(r.CustId) !== input.custId ||
        Number(r.ActorPrimaryId) !== identity.actorPrimaryId || Number(r.EffectivePrimaryId) !== identity.effectivePrimaryId ||
        Number(r.ActorBusinessId) !== identity.actorBusinessId || Number(r.EffectiveBusinessId) !== identity.effectiveBusinessId ||
        !Number.isSafeInteger(Number(r.Id)) || Number(r.Id) < 1 || !Number.isSafeInteger(Number(r.ConversionId)) || Number(r.ConversionId) < 1 ||
        r.Status !== 'PENDING' || r.ConversionStatus !== 'PENDING_APPROVAL') fail('REBATE_CONVERSION_REQUEST_CONFLICT');
    const reservations = (await query(`SELECT AccrualId,QuantityTon,AmountBaht,Status FROM wf.RebateShipmentReservation WITH(UPDLOCK,HOLDLOCK)
      WHERE ConversionId=@conversionId ORDER BY AccrualId`, { conversionId: Number(r.ConversionId) })).recordset || [];
    if (!reservations.length) fail('REBATE_CONVERSION_RESERVATION_INVALID');
    const visibleLots = await (options.readLots || readShipmentLots)(query,
      { epoch, custId: input.custId, scopeSql: scope.sql, scopeInputs: scope.inputs });
    const visibleIds = new Set(visibleLots.map(lot => Number(lot.AccrualId)));
    let total = 0n;
    for (const reservation of reservations) {
      if (reservation.Status !== 'ACTIVE' || !visibleIds.has(Number(reservation.AccrualId))) fail('REBATE_CONVERSION_RESERVATION_INVALID');
      total += shipmentUnits(reservation.AmountBaht, 2);
      await (options.reserve || reserveShipmentAccrual)(query, epoch, { accrualId: Number(reservation.AccrualId),
        custId: input.custId, documentId: Number(r.ConversionId), documentType: 'CONVERSION', quantityTon: reservation.QuantityTon });
    }
    if (total !== shipmentUnits(r.ConvertedValueBaht, 2)) fail('REBATE_CONVERSION_RESERVATION_INVALID');
    return { requestId: input.requestId, id: Number(r.Id), status: 'PENDING', replayed: true };
  }
  const today = (options.clock || getBangkokDateString)();
  if (input.expiryDate && input.expiryDate < today) fail('INVALID_TICKET_EXPIRY', 400);
  const cycleMonths = await (options.readCycle || readRebateCycleMonths)(query, { lock: true });
  const result = await (options.createConversion || executeShipmentSourceConversion)(query, {
    ...input, epoch, cycleMonths, scopeSql: scope.sql, scopeInputs: scope.inputs, asOfDate: today,
    actorUser: { ...user, id: identity.effectiveBusinessId },
  }, { pendingApproval: true });
  const conversionId = Number(result?.conversion?.id);
  if (!Number.isSafeInteger(conversionId) || conversionId < 1 || result?.conversion?.status !== 'PENDING_APPROVAL')
    fail('CONVERSION_RECEIPT_INVALID', 500);
  const inserted = (await query(`INSERT wf.RebateConversionApprovalRequest
    (RequestId,Fingerprint,EnvironmentKind,ResetId,Generation,CustId,ConversionId,Status,RequestedExpiryDate,
      ActorPrimaryId,EffectivePrimaryId,ActorBusinessId,EffectiveBusinessId)
    OUTPUT INSERTED.Id VALUES(@requestId,@fingerprint,@environment,@resetId,@generation,@custId,@conversionId,
      'PENDING',@expiryDate,@actor,@effective,@actorBusiness,@effectiveBusiness)`, {
    requestId: input.requestId, fingerprint, environment: epoch.environment, resetId: epoch.resetId, generation: epoch.generation,
    custId: input.custId, conversionId, expiryDate: input.expiryDate, actor: identity.actorPrimaryId,
    effective: identity.effectivePrimaryId, actorBusiness: identity.actorBusinessId, effectiveBusiness: identity.effectiveBusinessId,
  })).recordset?.[0];
  if (!Number.isSafeInteger(Number(inserted?.Id)) || Number(inserted.Id) < 1) fail('CONVERSION_RECEIPT_INVALID', 500);
  return { requestId: input.requestId, id: Number(inserted.Id), status: 'PENDING', replayed: false };
}
module.exports = { createConversionApprovalRequest };
