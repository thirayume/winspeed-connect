'use strict';

// Safe orchestration for a manual financial conversion. This service is not
// exposed until the shared-source and issuance contracts are validated on UAT.
const crypto = require('crypto');
const db = require('../db');
const { transactionQuery } = require('./rebate-sql');
const { approvalIdentity } = require('./approval-identity');
const { businessIds } = require('./business-identity');
const { hasPermission } = require('./role-capabilities');
const { getBangkokDateString } = require('./so-pickup-policy');
const { assertAgingNotBlocked, issueTicketFromConversion, mapTicketRow } = require('./rebate-ticket-service');
const { isValidStartDate } = require('./data-window');
const { readRebateCycleMonths } = require('./rebate-cycle-policy');
const { executeSharedSourceConversion } = require('./rebate-shared-conversion');
const { executeShipmentSourceConversion } = require('./rebate-shipment-conversion');
const { readShipmentLots } = require('./rebate-shipment-lots');
const { mapConversionRow } = require('./rebate-pool-models');
const { sharedRebateScopeFilter } = require('./rebate-shared-scope');
const { withRebateOperationFence } = require('./rebate-reset-fence');
const { acquireRebateParticipantFence } = require('./rebate-participant-fence');

function fail(code, status = 400) { throw Object.assign(new Error(code), { code, status }); }
function normalize(payload) {
  const requestId = String(payload?.requestId || '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) fail('INVALID_REQUEST_ID');
  const custId = Number(payload.custId), goodId = Number(payload.goodId), standingYear = Number(payload.standingYear);
  if (![custId, goodId].every(n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647)) fail('INVALID_CUSTOMER_OR_GOOD');
  if (!Number.isInteger(standingYear) || standingYear < 2000 || standingYear > 2100) fail('INVALID_STANDING_YEAR');
  if (payload.asOfDate != null || payload.agingOverrideGranted != null || payload.conversionNo != null || payload.isAutomated === true ||
      (payload.executionMode != null && payload.executionMode !== 'MANUAL')) fail('UNTRUSTED_CONVERSION_INPUT');
  const note = typeof payload.note === 'string' ? payload.note.trim() : '';
  if (!note || note.length > 500) fail('INVALID_CONVERSION_NOTE');
  const modes = [payload.requestedAmountBaht != null, payload.requestedTons != null, payload.convertAllEligible === true];
  if (modes.filter(Boolean).length !== 1) fail('INVALID_CONVERSION_AMOUNT');
  const amount = modes[0] ? Number(payload.requestedAmountBaht) : modes[1] ? Number(payload.requestedTons) : null;
  const decimals = modes[0] ? 2 : 4;
  if (amount != null && (!Number.isFinite(amount) || amount <= 0 || amount > 100000000 ||
      Math.abs(amount * 10 ** decimals - Math.round(amount * 10 ** decimals)) > 1e-6)) fail('INVALID_CONVERSION_AMOUNT');
  if (payload.maturedOnly != null && typeof payload.maturedOnly !== 'boolean') fail('INVALID_MATURITY_FILTER');
  const expiryDate = payload.expiryDate == null || payload.expiryDate === '' ? null : String(payload.expiryDate);
  if (expiryDate != null && !isValidStartDate(expiryDate)) fail('INVALID_TICKET_EXPIRY');
  return { requestId, custId, goodId, standingYear, note, maturedOnly: payload.maturedOnly === true,
    requestedAmountBaht: modes[0] ? amount : null, requestedTons: modes[1] ? amount : null, convertAllEligible: modes[2], expiryDate };
}

async function readTicketValidityDays(query) {
  const row = (await query("SELECT SettingValue FROM wf.SystemSetting WITH (UPDLOCK,HOLDLOCK) WHERE SettingKey='TICKET_VALIDITY_DAYS'", {})).recordset?.[0];
  const value = row?.SettingValue == null ? 90 : Number(row.SettingValue);
  if (!Number.isSafeInteger(value) || value < 1 || value > 36500) fail('INVALID_TICKET_VALIDITY', 503);
  return value;
}

async function executeReviewedConversion(user, payload, overrides = {}) {
  const input = normalize(payload);
  const identity = approvalIdentity(user);
  const actor = identity.impersonating ? { role: user.actorRole, roles: user.actorRoles,
    permissions: user.actorPermissions, disabledActions: user.actorDisabledActions } : user;
  if (!hasPermission(user, 'rebate.convert') || !hasPermission(actor, 'rebate.convert')) fail('FORBIDDEN_CONVERTER_ROLE', 403);
  const business = businessIds(user);
  if (!business.actor || !business.effective) fail('INVALID_APPROVAL_IDENTITY', 401);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ custId: input.custId, goodId: input.goodId,
    standingYear: input.standingYear, note: input.note, maturedOnly: input.maturedOnly,
    requestedAmountBaht: input.requestedAmountBaht, requestedTons: input.requestedTons,
    convertAllEligible: input.convertAllEligible, expiryDate: input.expiryDate })).digest('hex');
  const runTx = overrides.runTx || (fn => db.wfTransaction(tx => fn(transactionQuery(tx, db.sql))));
  const runFence = overrides.runFence || (fn => withRebateOperationFence(fn));
  const participantFence = overrides.participantFence || acquireRebateParticipantFence;
  const assertAging = overrides.assertAging || assertAgingNotBlocked;
  const issue = overrides.issue || issueTicketFromConversion;
  const today = (overrides.clock || getBangkokDateString)();
  const filter = await sharedRebateScopeFilter(user, overrides.getScope);
  return runFence(epoch => runTx(async query => {
    await participantFence(query, epoch);
    // HTTP use is restricted to the new, shared shipment ledger. Never fall
    // back to pre-reset 104 lots when enabling the Pool workflow.
    if (overrides.requireShipmentEpoch && !(Number.isSafeInteger(epoch.generation) && epoch.generation>0))
      fail('REBATE_RESET_NOT_COMPLETED', 409);
    // Shared with claim creation so the view and reservations cannot be read
    // concurrently by a claim and a conversion for the same customer.
    await query(`DECLARE @result INT;
      EXEC @result=sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
      IF @result < 0 RAISERROR('Unable to acquire rebate customer lock',16,1);`, { resource: `RebateCust_${input.custId}` });
    const shipmentEpoch = epoch.generation>0;
    const visible = shipmentEpoch
      ? {recordset:await readShipmentLots(query,{epoch,custId:input.custId,scopeSql:filter.sql,scopeInputs:filter.inputs})}
      : await query(`SELECT TOP 1 1 AS ok FROM wf.v_RebateAccrualRemaining
          WHERE CustId=@cid AND ${filter.sql}`, { ...filter.inputs, cid: String(input.custId) });
    if (!visible.recordset?.length) fail('REBATE_CUSTOMER_OUT_OF_SCOPE', 404);
    const existing = (await query('SELECT * FROM wf.RebateConversionRequest WITH (UPDLOCK,HOLDLOCK) WHERE RequestId=@requestId',
      { requestId: input.requestId })).recordset?.[0];
    if (existing) {
      if (String(existing.Fingerprint).trim() !== fingerprint || Number(existing.IdentityActorId) !== identity.actorId ||
          Number(existing.IdentityEffectiveId) !== identity.effectiveId || Number(existing.BusinessActorId) !== business.actor ||
          Number(existing.BusinessEffectiveId) !== business.effective || Number(existing.CustId) !== input.custId) fail('CONVERSION_REQUEST_CONFLICT', 409);
      if (!existing.ConversionId) fail('CONVERSION_REQUEST_INCOMPLETE', 409);
      const row = (await query('SELECT * FROM wf.FertilizerTicketConversion WHERE Id=@id', { id: Number(existing.ConversionId) })).recordset?.[0];
      if (!row) fail('CONVERSION_RECEIPT_INVALID', 409);
      const tickets = (await query('SELECT * FROM wf.FertilizerTicket WHERE ConversionId=@id', { id: Number(existing.ConversionId) })).recordset || [];
      if (tickets.length !== 1) fail('CONVERSION_RECEIPT_INVALID', 409);
      return { conversion: mapConversionRow(row), ticket: mapTicketRow(tickets[0]), replayed: true };
    }
    if (input.expiryDate && input.expiryDate < today) fail('INVALID_TICKET_EXPIRY');
    const cycleMonths = await (overrides.readCycle || readRebateCycleMonths)(query, { lock: true });
    const validityDays = await (overrides.readValidity || readTicketValidityDays)(query);
    await query(`INSERT INTO wf.RebateConversionRequest
      (RequestId,Fingerprint,IdentityActorId,IdentityEffectiveId,BusinessActorId,BusinessEffectiveId,CustId,BusinessDate,CycleMonths)
      VALUES (@requestId,@fingerprint,@actor,@effective,@businessActor,@businessEffective,@custId,@today,@cycleMonths)`, {
      requestId: input.requestId, fingerprint, actor: identity.actorId, effective: identity.effectiveId,
      businessActor: business.actor, businessEffective: business.effective, custId: input.custId, today, cycleMonths,
    });
    await assertAging(query, input.custId, { asOfDate: today, lock: true });
    const convert=shipmentEpoch ? (overrides.convertShipment || executeShipmentSourceConversion)
      : (overrides.convert || executeSharedSourceConversion);
    const result = await convert(query, { ...input, epoch, cycleMonths, scopeSql: filter.sql, scopeInputs: filter.inputs,
      actorUser: { ...user, id: business.effective }, asOfDate: today, executionMode: 'MANUAL' });
    const id = Number(result?.conversion?.id);
    if (!Number.isSafeInteger(id) || id <= 0) fail('CONVERSION_RECEIPT_INVALID', 500);
    const c = result.conversion;
    const ticket = await issue(query, { conversionId: id, custId: input.custId, custCode: c.custCode, custName: c.custName,
      goodId: input.goodId, goodCode: c.goodCode, goodName: c.goodName, oct31ReferencePrice: c.standingPricePerTon,
      convertedRebateAmount: c.convertedValueBaht, issuedTonnage: c.convertedTons, issuedDate: today,
      validityDays, expiryDate: input.expiryDate, actorUser: { ...user, id: business.effective } });
    if (!Number.isSafeInteger(Number(ticket?.id)) || Number(ticket.id) <= 0 || Number(ticket.conversionId) !== id) fail('TICKET_RECEIPT_INVALID', 500);
    const updated = await query(`UPDATE wf.RebateConversionRequest SET ConversionId=@id, CompletedAt=GETUTCDATE()
      WHERE RequestId=@requestId AND ConversionId IS NULL`, { id, requestId: input.requestId });
    if (Number(updated.rowsAffected?.[0]) !== 1) fail('CONVERSION_RECEIPT_INVALID', 409);
    return { conversion: result.conversion, ticket, replayed: false };
  }));
}

module.exports = { normalize, readTicketValidityDays, executeReviewedConversion };
