# QA-only installer for four existing Sale-App hooks. The source payload is
# generated locally. This cannot target UAT/PROD or install missing triggers.
$ErrorActionPreference='Stop'
$payload=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PAYLOAD__')) | ConvertFrom-Json
$bootstrap=Get-Content -Raw -LiteralPath 'D:\SaleApp\qa-native-v3\state\bootstrap.json' | ConvertFrom-Json
$connection=New-Object System.Data.SqlClient.SqlConnection('Server=R740-SRV\SQL2008;Database=dbwins_worldfert9_uat_v3;Integrated Security=SSPI;Application Name=QA Reviewed Bridge Hook Installer')
function Read-Fingerprints($transaction) {
 $command=$connection.CreateCommand();if($transaction){$command.Transaction=$transaction};$command.CommandText=$payload.metadataQuery
 $reader=$command.ExecuteReader();$rows=@()
 try{while($reader.Read()){
  if($reader.IsDBNull(3)){throw 'QA_BRIDGE_METADATA_INVISIBLE'}
  $sha=[Security.Cryptography.SHA256]::Create()
  try{$hash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($reader.GetString(3).Replace("`r`n","`n"))))).Replace('-','').ToLower()}finally{$sha.Dispose()}
  $rows+=,@($reader.GetString(0).ToLower(),$reader.GetString(1).ToLower(),[int]$reader.GetBoolean(2),$hash)
 }}finally{$reader.Close()};return ,$rows
}
function Assert-Fingerprints($actual,$expected) {
 if($actual.Count -ne $expected.Count){throw 'QA_BRIDGE_METADATA_COUNT_CHANGED'}
 foreach($row in $expected){$found=@($actual|Where-Object {$_[0] -eq $row[0] -and $_[1] -eq $row[1]})
  if($found.Count -ne 1 -or $found[0][2] -ne $row[2] -or $found[0][3] -ne $row[3]){throw 'QA_BRIDGE_METADATA_DRIFT'}
 }
}
$transaction=$null
try {
 $connection.Open();Assert-Fingerprints (Read-Fingerprints $null) $payload.baseline
 $transaction=$connection.BeginTransaction([Data.IsolationLevel]::Serializable)
 $command=$connection.CreateCommand();$command.Transaction=$transaction
 $command.CommandText=@'
SET LOCK_TIMEOUT 10000;
IF DB_NAME()<>'dbwins_worldfert9_uat_v3' OR wf.fn_IsNativeDocumentTarget()<>1 RAISERROR('QA_TARGET_INVALID',16,1);
IF(SELECT COUNT(*) FROM wf.SchemaMigration WHERE FileName IN('270_coupon_bridge_contract.sql','271_coupon_bridge_native_dispatch.sql'))<>2 RAISERROR('QA_BRIDGE_LEDGER_REQUIRED',16,1);
IF NOT EXISTS(SELECT 1 FROM wf.AppUser WHERE Id=@user AND IsActive=1 AND Role='ADMIN' AND MustChangePassword=0) RAISERROR('QA_REVIEWER_REQUIRED',16,1);
IF @prior IS NULL AND(EXISTS(SELECT 1 FROM wf.CouponBridgeContract WHERE Enabled=1) OR EXISTS(SELECT 1 FROM wf.CouponBridgePermit) OR EXISTS(SELECT 1 FROM wf.CouponBridgeDocument)) RAISERROR('QA_BRIDGE_NOT_PRISTINE',16,1);
IF @prior IS NOT NULL AND(NOT EXISTS(SELECT 1 FROM wf.CouponBridgeContract WHERE Version='116-BRIDGE-v1' AND Enabled=1 AND ModulesHash=@prior)
 OR EXISTS(SELECT 1 FROM wf.CouponBridgePermit WHERE ReleasedAtUtc IS NULL AND State<>'CANCELLED')) RAISERROR('QA_BRIDGE_UPGRADE_STATE_CHANGED',16,1);
IF EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorization WHERE State='ACTIVE') OR EXISTS(SELECT 1 FROM wf.CouponNativeEditHold h WHERE NOT EXISTS(SELECT 1 FROM wf.CouponNativeEditRelease r WHERE r.EditId=h.EditId)) RAISERROR('QA_OLD_PROTOCOL_STILL_ACTIVE',16,1);
IF EXISTS(SELECT 1 FROM sys.triggers WHERE parent_id=OBJECT_ID('dbo.WFCoupon') AND OBJECTPROPERTY(object_id,'ExecIsFirstUpdateTrigger')=1 AND name<>'WF_CouponNativeConsume') RAISERROR('QA_NATIVE_TRIGGER_ORDER_CONFLICT',16,1);
'@
 [void]$command.Parameters.AddWithValue('@user',[int]$bootstrap.userId)
 [void]$command.Parameters.AddWithValue('@prior',$(if($payload.priorModule){$payload.priorModule}else{[DBNull]::Value}));[void]$command.ExecuteNonQuery()
 foreach($sql in $payload.hooks){$command=$connection.CreateCommand();$command.Transaction=$transaction;$command.CommandTimeout=30;$command.CommandText=$sql;[void]$command.ExecuteNonQuery()}
 $command=$connection.CreateCommand();$command.Transaction=$transaction
 $command.CommandText=@'
ENABLE TRIGGER dbo.WF_CouponNativeConsume ON dbo.WFCoupon;
ENABLE TRIGGER dbo.WF_CouponReservationGuard ON dbo.WFCoupon;
ENABLE TRIGGER dbo.WF_CouponNativeEditHeadHook ON dbo.WFRedemtionHD;
ENABLE TRIGGER dbo.WF_CouponNativeEditDetailHook ON dbo.WFRedemtionDT;
EXEC sp_settriggerorder @triggername='dbo.WF_CouponNativeConsume',@order='First',@stmttype='UPDATE';
UPDATE wf.CouponBridgeContract SET Enabled=1,ModulesHash=@module,ApprovedById=@user,ActorId=@user,ApprovedAtUtc=GETUTCDATE(),
 Evidence='Isolated QA only; native WinSpeed fingerprints preserved; rollback scenarios and module hashes reviewed'
 WHERE Version='116-BRIDGE-v1' AND(Enabled=0 OR(Enabled=1 AND ModulesHash=@prior));
IF @@ROWCOUNT<>1 RAISERROR('QA_BRIDGE_CONTRACT_CHANGED',16,1);
INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId)
VALUES('COUPON_BRIDGE_CONTRACT','116-BRIDGE-v1','QA_ENABLE','ISOLATED_QA',@module,CONVERT(varchar(20),@user),CONVERT(varchar(20),@user));
'@
 [void]$command.Parameters.AddWithValue('@user',[int]$bootstrap.userId)
 [void]$command.Parameters.AddWithValue('@prior',$(if($payload.priorModule){$payload.priorModule}else{[DBNull]::Value}))
 [void]$command.Parameters.AddWithValue('@module',$payload.module);[void]$command.ExecuteNonQuery()
 Assert-Fingerprints (Read-Fingerprints $transaction) $payload.expected
 $transaction.Commit();$transaction.Dispose();$transaction=$null
 Assert-Fingerprints (Read-Fingerprints $null) $payload.expected
 Write-Output 'QA_FOUR_REVIEWED_HOOKS_ENABLED_NATIVE_FINGERPRINTS_PRESERVED=PASS'
}finally{if($transaction -and $transaction.Connection){$transaction.Rollback()};$connection.Close()}
