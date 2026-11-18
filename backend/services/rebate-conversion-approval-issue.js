'use strict';
// Caller owns the environment fence and transaction. No public route yet.
const { authorizeConversionAction } = require('./rebate-conversion-approval-policy');
const { acquireRebateParticipantFence } = require('./rebate-participant-fence');
const { readShipmentLots } = require('./rebate-shipment-lots');
const { reserveShipmentAccrual } = require('./rebate-shipment-reservation');
const { requireOct31StandingPrice } = require('./rebate-conversion-service');
const { issueTicketFromConversion } = require('./rebate-ticket-service');
const { readTicketValidityDays } = require('./rebate-conversion-execution');
const { shipmentUnits } = require('./rebate-shipment-accrual');
const { getBangkokDateString } = require('./so-pickup-policy');
const { formatYmd, round4 } = require('./rebate-pool-models');
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

async function approveConversionRequest(query, user, input, epoch, options = {}) {
  const id = Number(input?.id), reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (typeof query !== 'function' || !positive(id) || !reason || reason.length > 500) fail('REBATE_CONVERSION_DECISION_INVALID', 400);
  const identity = authorizeConversionAction(user, 'APPROVE');
  if (!(options.windowStartUtc instanceof Date) || !Number.isFinite(options.windowStartUtc.getTime()))
    fail('REBATE_DATA_WINDOW_UNAVAILABLE', 503);
  if (!epoch || !['uat','production'].includes(epoch.environment) || !epoch.resetId || !Number.isSafeInteger(epoch.generation) || epoch.generation < 1)
    fail('REBATE_RESET_EPOCH_INVALID', 503);
  if (typeof options.authorizeScope !== 'function') fail('REBATE_CONVERSION_SCOPE_VERIFIER_UNAVAILABLE', 503);
  await (options.participantFence || acquireRebateParticipantFence)(query, epoch);
  const initial = (await query('SELECT Id,CustId FROM wf.RebateConversionApprovalRequest WHERE Id=@id AND CreatedAtUtc>=@windowStartUtc',
    { id, windowStartUtc: options.windowStartUtc })).recordset?.[0];
  const custId = Number(initial?.CustId); if (!positive(custId)) fail('REBATE_CONVERSION_REQUEST_NOT_FOUND', 404);
  const lock = (await query(`DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,
    @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult;`,
  { resource: `RebateCust_${custId}` })).recordset?.[0]?.LockResult;
  if (!Number.isInteger(lock) || lock < 0) fail('REBATE_RESERVATION_LOCK_UNAVAILABLE', 503);
  const row = (await query(`SELECT r.*,c.CustId AS ConversionCustId,c.Status AS ConversionStatus,c.StandingYear,c.GoodId,c.CustCode,c.CustName,
      c.GoodCode,c.GoodName,c.StandingPricePerTon,c.ConvertedTons,c.ConvertedValueBaht
    FROM wf.RebateConversionApprovalRequest r WITH(UPDLOCK,HOLDLOCK)
    JOIN wf.FertilizerTicketConversion c WITH(UPDLOCK,HOLDLOCK) ON c.Id=r.ConversionId
    WHERE r.Id=@id AND r.CreatedAtUtc>=@windowStartUtc`, { id, windowStartUtc: options.windowStartUtc })).recordset?.[0];
  if (!row || Number(row.CustId) !== custId || Number(row.ConversionCustId) !== custId || !same(row.EnvironmentKind, epoch.environment) ||
      !same(row.ResetId, epoch.resetId) || Number(row.Generation) !== epoch.generation) fail('REBATE_CONVERSION_REQUEST_NOT_FOUND', 404);
  const scope = await options.authorizeScope(query, user, row);
  if (!scope || typeof scope.sql !== 'string' || !scope.inputs) fail('REBATE_CONVERSION_REQUEST_NOT_FOUND', 404);
  if (row.Status === 'APPROVED') {
    if (row.ConversionStatus !== 'ISSUED' || Number(row.DecisionActorPrimaryId) !== identity.actorPrimaryId ||
        Number(row.DecisionEffectivePrimaryId) !== identity.effectivePrimaryId || Number(row.DecisionActorBusinessId) !== identity.actorBusinessId ||
        Number(row.DecisionEffectiveBusinessId) !== identity.effectiveBusinessId || String(row.DecisionReason || '') !== reason)
      fail('REBATE_CONVERSION_DECISION_CONFLICT');
    const tickets = (await query('SELECT Id,CustId,GoodId,IssuedTonnage FROM wf.FertilizerTicket WHERE ConversionId=@conversionId', { conversionId: Number(row.ConversionId) })).recordset || [];
    if (tickets.length !== 1 || !positive(Number(tickets[0].Id)) || Number(tickets[0].CustId) !== custId ||
        Number(tickets[0].GoodId) !== Number(row.GoodId) || Number(tickets[0].IssuedTonnage) !== Number(row.ConvertedTons))
      fail('REBATE_CONVERSION_TICKET_INVALID');
    return { id, ticketId: Number(tickets[0].Id), status: 'APPROVED', replayed: true };
  }
  if (row.Status !== 'PENDING' || row.ConversionStatus !== 'PENDING_APPROVAL') fail('REBATE_CONVERSION_DECISION_CONFLICT');
  const visible = await (options.readLots || readShipmentLots)(query,
    { epoch, custId, scopeSql: scope.sql, scopeInputs: scope.inputs });
  const visibleIds = new Set(visible.map(lot => Number(lot.AccrualId)));
  const reservations = (await query(`SELECT AccrualId,QuantityTon,AmountBaht,Status FROM wf.RebateShipmentReservation WITH(UPDLOCK,HOLDLOCK)
    WHERE ConversionId=@conversionId ORDER BY AccrualId`, { conversionId: Number(row.ConversionId) })).recordset || [];
  if (!reservations.length) fail('REBATE_CONVERSION_RESERVATION_INVALID');
  let total = 0n;
  for (const r of reservations) {
    if (r.Status !== 'ACTIVE' || !visibleIds.has(Number(r.AccrualId))) fail('REBATE_CONVERSION_RESERVATION_INVALID');
    total += shipmentUnits(r.AmountBaht, 2);
    await (options.reserve || reserveShipmentAccrual)(query, epoch, { accrualId: Number(r.AccrualId), custId,
      documentId: Number(row.ConversionId), documentType: 'CONVERSION', quantityTon: r.QuantityTon });
  }
  if (total !== shipmentUnits(row.ConvertedValueBaht, 2)) fail('REBATE_CONVERSION_RESERVATION_INVALID');
  if (!positive(Number(row.GoodId)) || !Number.isInteger(Number(row.StandingYear)) ||
      !Number.isFinite(Number(row.StandingPricePerTon)) || Number(row.StandingPricePerTon) <= 0 ||
      !Number.isFinite(Number(row.ConvertedTons)) || Number(row.ConvertedTons) <= 0 ||
      round4(Number(row.ConvertedValueBaht) / Number(row.StandingPricePerTon)) !== Number(row.ConvertedTons))
    fail('REBATE_CONVERSION_RECEIPT_INVALID');
  const standing = await (options.standingPrice || requireOct31StandingPrice)(query,
    { standingYear: Number(row.StandingYear), goodId: Number(row.GoodId), lock: true });
  if (Number(standing.goodId) !== Number(row.GoodId) || shipmentUnits(standing.basePrice, 2) !== shipmentUnits(row.StandingPricePerTon, 2))
    fail('REBATE_CONVERSION_PRICE_CHANGED');
  const today = (options.clock || getBangkokDateString)();
  const validityDays = await (options.readValidity || readTicketValidityDays)(query);
  const p = { id, conversionId: Number(row.ConversionId), reason, actor: identity.actorPrimaryId,
    effective: identity.effectivePrimaryId, actorBusiness: identity.actorBusinessId, effectiveBusiness: identity.effectiveBusinessId };
  const changed = await query(`UPDATE wf.FertilizerTicketConversion SET Status='ISSUED'
    WHERE Id=@conversionId AND Status='PENDING_APPROVAL'`, p);
  if (Number(changed.rowsAffected?.[0]) !== 1) fail('REBATE_CONVERSION_DECISION_CONFLICT');
  const expiryDate = row.RequestedExpiryDate == null ? null : formatYmd(row.RequestedExpiryDate);
  if (row.RequestedExpiryDate != null && !expiryDate) fail('INVALID_TICKET_EXPIRY');
  const ticket = await (options.issue || issueTicketFromConversion)(query, { conversionId: p.conversionId, custId,
    custCode: row.CustCode, custName: row.CustName, goodId: Number(row.GoodId), goodCode: row.GoodCode,
    goodName: row.GoodName, oct31ReferencePrice: Number(row.StandingPricePerTon), convertedRebateAmount: Number(row.ConvertedValueBaht),
    issuedTonnage: Number(row.ConvertedTons), issuedDate: today, validityDays, expiryDate,
    actorUser: { ...user, id: identity.effectiveBusinessId } });
  if (!positive(Number(ticket?.id)) || Number(ticket.conversionId) !== p.conversionId || Number(ticket.custId) !== custId ||
      Number(ticket.goodId) !== Number(row.GoodId) || Number(ticket.issuedTonnage) !== Number(row.ConvertedTons))
    fail('REBATE_CONVERSION_TICKET_INVALID');
  const request = await query(`UPDATE wf.RebateConversionApprovalRequest SET Status='APPROVED',DecidedAtUtc=GETUTCDATE(),
    DecisionActorPrimaryId=@actor,DecisionEffectivePrimaryId=@effective,DecisionActorBusinessId=@actorBusiness,
    DecisionEffectiveBusinessId=@effectiveBusiness,DecisionReason=@reason WHERE Id=@id AND Status='PENDING'`, p);
  if (Number(request.rowsAffected?.[0]) !== 1) fail('REBATE_CONVERSION_DECISION_CONFLICT');
  return { id, ticketId: Number(ticket.id), status: 'APPROVED', replayed: false };
}
module.exports = { approveConversionRequest };
