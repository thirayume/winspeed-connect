# Read only. Wait for the exact isolated-QA request marker before any UI save.
param([ValidateRange(1,20)][int]$TimeoutSeconds=12)
$ErrorActionPreference='Stop'
$c=New-Object System.Data.SqlClient.SqlConnection('Server=R740-SRV\SQL2008;Database=dbwins_worldfert9_uat_v3;Integrated Security=SSPI;Application Name=QA Overlap Ready')
try {
 $c.Open()
 $guard=$c.CreateCommand();$guard.CommandTimeout=2
 $guard.CommandText="IF DB_NAME()<>'dbwins_worldfert9_uat_v3' OR IS_SRVROLEMEMBER('sysadmin')<>1 BEGIN RAISERROR('QA_READY_TARGET',16,1);RETURN;END;SELECT COUNT(*) FROM wf.QaCouponBridgeOverlap WHERE ExpiresAtUtc>GETUTCDATE()"
 if([int]$guard.ExecuteScalar() -ne 1){throw 'QA_ACTIVE_BARRIER_REQUIRED'}
 $deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
 while([DateTime]::UtcNow -lt $deadline) {
  $q=$c.CreateCommand();$q.CommandTimeout=2
  $q.CommandText="SELECT COUNT(*) FROM sys.dm_exec_requests r CROSS JOIN wf.QaCouponBridgeOverlap q WHERE r.database_id=DB_ID() AND SUBSTRING(r.context_info,1,DATALENGTH(q.Marker))=q.Marker AND r.wait_type='WAITFOR'"
  if([int]$q.ExecuteScalar() -eq 1){Write-Output 'QA_OVERLAP_BARRIER_READY';return}
  Start-Sleep -Milliseconds 100
 }
 throw 'QA_OVERLAP_BARRIER_NOT_READY'
} finally {$c.Close()}
