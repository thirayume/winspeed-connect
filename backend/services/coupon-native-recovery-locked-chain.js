'use strict';

// Candidate reader only. Requires a caller-owned SQL transaction, which must
// remain open until any future writer commits or rolls back. It neither checks
// the current native 116/balance nor authorizes a user or writes recovery.
const {sql}=require('../db');
const {validateRecoveryChain}=require('./coupon-native-recovery-chain');
function invalid() { throw Object.assign(new Error('RECOVERY_LOCKED_CHAIN_INVALID'),{code:'RECOVERY_LOCKED_CHAIN_INVALID'}); }
function key(value) {
  if(typeof value!=='string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value)>9223372036854775807n) invalid();
  return value;
}
async function loadRecoveryChainForUpdate(tx,settlementKey,lineKey) {
  const sid=key(settlementKey),lid=key(lineKey);
  if(!tx || typeof tx.request!=='function') invalid();
  const context=(await tx.request().query('SELECT @@TRANCOUNT AS TransactionCount, XACT_STATE() AS TransactionState')).recordset;
  if(!Array.isArray(context) || context.length!==1 || !Number.isInteger(context[0].TransactionCount) ||
    context[0].TransactionCount<1 || context[0].TransactionState!==1) invalid();
  const base=(await tx.request().input('sid',sql.VarChar(19),sid).input('lid',sql.VarChar(19),lid).query(`
    SELECT CONVERT(varchar(20),l.Id) AS LineId,CONVERT(varchar(20),l.ReservationId) AS LineReservationId,
      CONVERT(varchar(20),l.CouponId) AS LineCouponId,CONVERT(varchar(32),l.AuthorizedQty) AS AuthorizedQty,
      CONVERT(varchar(20),e.AuthorizationLineId) AS EvidenceLineId,CONVERT(varchar(20),e.NativeRedemptionId) AS EvidenceRedemptionId,
      e.EvidenceState,CONVERT(varchar(32),e.BalanceBefore) AS EvidenceBalanceBefore,
      CONVERT(varchar(32),e.BalanceAfter) AS EvidenceBalanceAfter,
      CONVERT(varchar(20),s.Id) AS SettlementId,CONVERT(varchar(20),s.ReservationId) AS SettlementReservationId,
      CONVERT(varchar(20),s.CouponId) AS SettlementCouponId,CONVERT(varchar(20),s.NativeRedemptionId) AS SettlementRedemptionId,
      CONVERT(varchar(32),s.SettledQty) AS SettledQty
    FROM wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK)
    JOIN wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK) ON e.AuthorizationLineId=l.Id
    JOIN wf.CouponReservationSettlement s WITH (UPDLOCK,HOLDLOCK)
      ON s.ReservationId=l.ReservationId AND s.CouponId=l.CouponId AND s.NativeRedemptionId=e.NativeRedemptionId
    WHERE l.Id=CONVERT(bigint,@lid) AND s.Id=CONVERT(bigint,@sid)
  `)).recordset;
  if(!Array.isArray(base) || base.length!==1) invalid();
  const rows=(await tx.request().input('sid',sql.VarChar(19),sid).input('lid',sql.VarChar(19),lid).query(`
    SELECT CONVERT(varchar(20),r.Id) AS Id,CONVERT(varchar(20),r.AuthorizationLineId) AS AuthorizationLineId,
      CONVERT(varchar(20),r.SettlementId) AS SettlementId,r.RecoveryKey,
      CONVERT(varchar(32),r.SettledBefore) AS SettledBefore,CONVERT(varchar(32),r.SettledAfter) AS SettledAfter,
      CONVERT(varchar(32),r.RestoredQty) AS RestoredQty,CONVERT(varchar(32),r.NativeBefore) AS NativeBefore,
      CONVERT(varchar(32),r.NativeAfter) AS NativeAfter,CONVERT(varchar(20),r.AuditEventId) AS AuditEventId,
      CONVERT(varchar(20),r.EffectiveUserId) AS EffectiveUserId,CONVERT(varchar(20),r.ActorUserId) AS ActorUserId,
      a.EntityType AS AuditEntityType,a.EntityId AS AuditEntityId,a.Action AS AuditAction,
      a.UserId AS AuditUserId,a.ActorUserId AS AuditActorUserId,a.AfterJson AS AuditAfterJson
    FROM wf.CouponNativeRecovery r WITH (UPDLOCK,HOLDLOCK)
    LEFT JOIN wf.ChangeEvent a WITH (UPDLOCK,HOLDLOCK) ON a.EventId=r.AuditEventId
    WHERE r.SettlementId=CONVERT(bigint,@sid) OR r.AuthorizationLineId=CONVERT(bigint,@lid) ORDER BY r.Id
  `)).recordset;
  if(!Array.isArray(rows)) invalid();
  const b=base[0];
  for(const r of rows) {
    let after;
    try { after=JSON.parse(r.AuditAfterJson); } catch (_) { invalid(); }
    if(!after || typeof after!=='object' || Array.isArray(after) ||
      r.AuditEntityType!=='COUPON_RESERVATION' || r.AuditAction!=='NATIVE_RECOVERY' ||
      String(r.AuditEntityId)!==b.LineReservationId || String(r.AuditUserId)!==r.EffectiveUserId ||
      String(r.AuditActorUserId)!==r.ActorUserId ||
      !/^[1-9]\d*$/.test(r.EffectiveUserId || '') || !/^[1-9]\d*$/.test(r.ActorUserId || '') ||
      after.authorizationLineId!==r.AuthorizationLineId || after.settlementId!==r.SettlementId ||
      after.settledBefore!==r.SettledBefore || after.settledAfter!==r.SettledAfter ||
      after.restoredQty!==r.RestoredQty || after.nativeBefore!==r.NativeBefore || after.nativeAfter!==r.NativeAfter) invalid();
  }
  return validateRecoveryChain({
    line:{id:b.LineId,reservationId:b.LineReservationId,couponId:b.LineCouponId,authorizedQty:b.AuthorizedQty},
    evidence:{authorizationLineId:b.EvidenceLineId,nativeRedemptionId:b.EvidenceRedemptionId,state:b.EvidenceState,
      balanceBefore:b.EvidenceBalanceBefore,balanceAfter:b.EvidenceBalanceAfter},
    settlement:{id:b.SettlementId,reservationId:b.SettlementReservationId,couponId:b.SettlementCouponId,
      nativeRedemptionId:b.SettlementRedemptionId,settledQty:b.SettledQty},
    history:rows.map(r=>({id:r.Id,authorizationLineId:r.AuthorizationLineId,settlementId:r.SettlementId,
      recoveryKey:r.RecoveryKey,settledBefore:r.SettledBefore,settledAfter:r.SettledAfter,restoredQty:r.RestoredQty,
      nativeBefore:r.NativeBefore,nativeAfter:r.NativeAfter,auditEventId:r.AuditEventId})),
  });
}
module.exports={loadRecoveryChainForUpdate};
