'use strict';
// Runs inside the participant reset transaction while the caller holds the
// exclusive global and participant fences. Business identities must be
// resolved for this database by the coordinator; they may not be guessed.
const { shipmentUnits } = require('./rebate-shipment-accrual');
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;

async function cancelPendingConversionRequestsForReset(query, input, previous) {
  const schema = (await query(`SELECT CASE WHEN OBJECT_ID('wf.RebateConversionApprovalRequest','U') IS NULL
    THEN 0 ELSE 1 END AS HasSchema`, {})).recordset?.[0]?.HasSchema;
  if (Number(schema) === 0) return { cancelled: 0 };
  if (Number(schema) !== 1) fail('REBATE_RESET_APPROVAL_SCHEMA_UNAVAILABLE');
  const p = { environment: input.environment, oldGeneration: previous.generation, oldResetId: previous.resetId };
  const stale = (await query(`SELECT TOP 1 Id FROM wf.RebateConversionApprovalRequest WITH(UPDLOCK,HOLDLOCK)
    WHERE EnvironmentKind=@environment AND Status='PENDING'
      AND (Generation<>@oldGeneration OR @oldResetId IS NULL OR ResetId<>@oldResetId)`, p)).recordset || [];
  if (stale.length) fail('REBATE_RESET_CONVERSION_EPOCH_MISMATCH');
  const broken = (await query(`SELECT TOP 1 r.Id FROM wf.RebateConversionApprovalRequest r WITH(UPDLOCK,HOLDLOCK)
    WHERE r.EnvironmentKind=@environment AND r.Generation=@oldGeneration AND r.ResetId=@oldResetId AND r.Status='PENDING'
      AND NOT EXISTS (SELECT 1 FROM wf.FertilizerTicketConversion c WHERE c.Id=r.ConversionId AND c.CustId=r.CustId)`, p)).recordset || [];
  if (broken.length) fail('REBATE_RESET_CONVERSION_INVALID');
  const rows = (await query(`SELECT r.Id,r.CustId,r.ConversionId,c.Status AS ConversionStatus,c.ConvertedValueBaht
    FROM wf.RebateConversionApprovalRequest r WITH(UPDLOCK,HOLDLOCK)
    JOIN wf.FertilizerTicketConversion c WITH(UPDLOCK,HOLDLOCK) ON c.Id=r.ConversionId AND c.CustId=r.CustId
    WHERE r.EnvironmentKind=@environment AND r.Generation=@oldGeneration AND r.ResetId=@oldResetId AND r.Status='PENDING'
    ORDER BY r.CustId,r.Id`, p)).recordset || [];
  if (!rows.length) return { cancelled: 0 };
  const ids = [input.actorId, input.effectiveId, input.businessActorId, input.businessEffectiveId];
  if (!ids.every(positive)) fail('REBATE_RESET_BUSINESS_IDENTITY_UNAVAILABLE');
  await query(`SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON;
    SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON; SET NUMERIC_ROUNDABORT OFF;`, {});
  let count = 0;
  for (const row of rows) {
    const id = Number(row.Id), custId = Number(row.CustId), conversionId = Number(row.ConversionId);
    if (![id,custId,conversionId].every(positive) || row.ConversionStatus !== 'PENDING_APPROVAL') fail('REBATE_RESET_CONVERSION_INVALID');
    const lock = (await query(`DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,
      @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult;`,
    { resource: `RebateCust_${custId}` })).recordset?.[0]?.LockResult;
    if (!Number.isInteger(lock) || lock < 0) fail('REBATE_RESERVATION_LOCK_UNAVAILABLE');
    const reservations = (await query(`SELECT Id,AmountBaht,Status FROM wf.RebateShipmentReservation WITH(UPDLOCK,HOLDLOCK)
      WHERE ConversionId=@conversionId ORDER BY Id`, { conversionId })).recordset || [];
    if (!reservations.length || reservations.some(r => r.Status !== 'ACTIVE') ||
        reservations.reduce((sum, r) => sum + shipmentUnits(r.AmountBaht, 2), 0n) !== shipmentUnits(row.ConvertedValueBaht, 2))
      fail('REBATE_RESET_CONVERSION_INVALID');
    const values = { ...p, id, conversionId, actor: ids[0], effective: ids[1], actorBusiness: ids[2],
      effectiveBusiness: ids[3], reason: 'Rebate reset' };
    const release = await query(`UPDATE wf.RebateShipmentReservation SET Status='RELEASED',ReleasedAtUtc=GETUTCDATE(),
      ReleaseActorPrimaryId=@actor,ReleaseEffectivePrimaryId=@effective,ReleaseActorBusinessId=@actorBusiness,
      ReleaseEffectiveBusinessId=@effectiveBusiness,ReleaseReason=@reason WHERE ConversionId=@conversionId AND Status='ACTIVE'`, values);
    if (Number(release.rowsAffected?.[0]) !== reservations.length) fail('REBATE_RESET_CONVERSION_INVALID');
    const conversion = await query(`UPDATE wf.FertilizerTicketConversion SET Status='CANCELLED'
      WHERE Id=@conversionId AND Status='PENDING_APPROVAL'`, values);
    if (Number(conversion.rowsAffected?.[0]) !== 1) fail('REBATE_RESET_CONVERSION_INVALID');
    const request = await query(`UPDATE wf.RebateConversionApprovalRequest SET Status='CANCELLED',DecidedAtUtc=GETUTCDATE(),
      DecisionActorPrimaryId=@actor,DecisionEffectivePrimaryId=@effective,DecisionActorBusinessId=@actorBusiness,
      DecisionEffectiveBusinessId=@effectiveBusiness,DecisionReason=@reason WHERE Id=@id AND Status='PENDING'`, values);
    if (Number(request.rowsAffected?.[0]) !== 1) fail('REBATE_RESET_CONVERSION_INVALID');
    count++;
  }
  return { cancelled: count };
}
module.exports = { cancelPendingConversionRequestsForReset };
