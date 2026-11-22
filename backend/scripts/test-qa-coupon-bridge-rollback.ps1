# Caller substitutes a locally generated, non-secret source payload before
# sending this script over stdin to the QA host. Never accepts a database name.
$ErrorActionPreference='Stop'
$payload=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PAYLOAD__')) | ConvertFrom-Json
$connection=New-Object System.Data.SqlClient.SqlConnection('Server=R740-SRV\SQL2008;Database=dbwins_worldfert9_uat_v3;Integrated Security=SSPI;Application Name=QA Bridge Outer Rollback')
function Read-Fingerprints {
 param($transaction)
 $command=$connection.CreateCommand();if($transaction){$command.Transaction=$transaction}
 $command.CommandText=$payload.metadataQuery
 $reader=$command.ExecuteReader();$rows=@()
 try {while($reader.Read()) {
  if($reader.IsDBNull(3)){throw 'QA_BRIDGE_METADATA_INVISIBLE'}
  $sha=[Security.Cryptography.SHA256]::Create()
  try {$hash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($reader.GetString(3).Replace("`r`n","`n"))))).Replace('-','').ToLower()}finally{$sha.Dispose()}
  $rows+=,@($reader.GetString(0).ToLower(),$reader.GetString(1).ToLower(),[int]$reader.GetBoolean(2),$hash)
 }}finally{$reader.Close()}
 return ,$rows
}
function Assert-Fingerprints($actual,$expected) {
 if($actual.Count -ne $expected.Count){throw 'QA_BRIDGE_METADATA_COUNT_CHANGED'}
 foreach($row in $expected) {
  $found=@($actual|Where-Object {$_[0] -eq $row[0] -and $_[1] -eq $row[1]})
  if($found.Count -ne 1 -or $found[0][2] -ne $row[2] -or $found[0][3] -ne $row[3]){
   Write-Output ("QA_METADATA_MISMATCH "+$row[0]+'.'+$row[1]+" expected="+$row[2]+":"+$row[3]+" actual="+($found|ConvertTo-Json -Compress))
   throw 'QA_BRIDGE_METADATA_DRIFT'
  }
 }
}
try {
 $connection.Open()
 Assert-Fingerprints (Read-Fingerprints $null) $payload.baseline
 $command=$connection.CreateCommand();$command.CommandText="SELECT OBJECT_ID('wf.CouponBridgePermit','U')";$initialBridgeId=$command.ExecuteScalar()
 foreach($case in @('positive','recovery','header-first','header-net','header-recovery','legacy','duplicate','unpermitted-edit','expired-permit','held-reservation','changed-source','partial-batch')) {
  $transaction=$connection.BeginTransaction([Data.IsolationLevel]::Serializable)
  $expectedFailure=$null
  if($case -eq 'duplicate'){$expectedFailure='BRIDGE_DUPLICATE_NATIVE_DEBIT'}
  if($case -eq 'unpermitted-edit'){$expectedFailure='BRIDGE_NATIVE_EDIT_OR_ADOPTION_REQUIRES_PERMIT'}
  if($case -eq 'expired-permit'){$expectedFailure='BRIDGE_NATIVE_TRANSACTION_OR_EXPIRY'}
  if($case -eq 'held-reservation'){$expectedFailure='BRIDGE_RESERVATION_HELD'}
  if($case -eq 'changed-source'){$expectedFailure='BRIDGE_NATIVE_DOCUMENT_INCOMPLETE'}
  if($case -eq 'partial-batch'){$expectedFailure='BRIDGE_NATIVE_DEBIT_BATCH_INCOMPLETE'}
  try {
   $commands=@('SET LOCK_TIMEOUT 10000;SET ARITHABORT ON;SET ANSI_WARNINGS ON;SET ANSI_PADDING ON;SET CONCAT_NULL_YIELDS_NULL ON;SET NUMERIC_ROUNDABORT OFF;')
   $commands+=@($payload.up)
   $commands+=@($payload.hooks)
   $commands+=@('ENABLE TRIGGER dbo.WF_CouponNativeConsume ON dbo.WFCoupon;ENABLE TRIGGER dbo.WF_CouponReservationGuard ON dbo.WFCoupon;ENABLE TRIGGER dbo.WF_CouponNativeEditHeadHook ON dbo.WFRedemtionHD;ENABLE TRIGGER dbo.WF_CouponNativeEditDetailHook ON dbo.WFRedemtionDT;')
   $commands+=@("IF EXISTS(SELECT 1 FROM sys.triggers WHERE parent_id=OBJECT_ID('dbo.WFCoupon') AND OBJECTPROPERTY(object_id,'ExecIsFirstUpdateTrigger')=1 AND name<>'WF_CouponNativeConsume') RAISERROR('QA_NATIVE_TRIGGER_ORDER_CONFLICT',16,1);EXEC sp_settriggerorder @triggername='dbo.WF_CouponNativeConsume',@order='First',@stmttype='UPDATE';")
   $commands+=@($payload.scenario)
   foreach($statement in $commands) {
    $command=$connection.CreateCommand();$command.Transaction=$transaction;$command.CommandTimeout=60;$command.CommandText=$statement
    [void]$command.ExecuteNonQuery()
   }
   Assert-Fingerprints (Read-Fingerprints $transaction) $payload.expected
   $command=$connection.CreateCommand();$command.Transaction=$transaction;$command.CommandTimeout=60
   $command.CommandText='EXEC wf.usp_QaCouponBridgeScenario @module,@case;'
   [void]$command.Parameters.AddWithValue('@module',$payload.module)
   [void]$command.Parameters.AddWithValue('@case',$case)
   [void]$command.ExecuteNonQuery()
   if($expectedFailure){throw 'QA_EXPECTED_BRIDGE_FAILURE_WAS_NOT_RAISED'}
   Write-Output "QA_BRIDGE_SQL_$($case.ToUpper())=PASS"
  }catch {
   if($expectedFailure -and $_.Exception.Message.Contains($expectedFailure)){
    Write-Output "QA_BRIDGE_SQL_$($case.ToUpper())=PASS_BLOCKED"
   }else{throw}
  }finally {
   if($transaction.Connection){$transaction.Rollback()}
   $transaction.Dispose()
  }
  Assert-Fingerprints (Read-Fingerprints $null) $payload.baseline
 }
 $command=$connection.CreateCommand();$command.CommandText="SELECT OBJECT_ID('wf.CouponBridgePermit','U')";
 if([string]$command.ExecuteScalar() -ne [string]$initialBridgeId){throw 'QA_BRIDGE_SCHEMA_NOT_ROLLED_BACK'}
 Write-Output 'QA_BRIDGE_ALL_SCHEMA_HOOKS_AND_BUSINESS_WRITES_ROLLED_BACK=PASS'
}finally{$connection.Close()}
