# Read only, bounded QA lock observer. No SQL text, names or credentials.
$ErrorActionPreference='Stop'
$c=New-Object System.Data.SqlClient.SqlConnection('Server=R740-SRV\SQL2008;Database=dbwins_worldfert9_uat_v3;Integrated Security=SSPI;Application Name=QA Native Overlap Observer')
$samples=@();$started=[DateTime]::UtcNow
try {
 $c.Open()
 $guard=$c.CreateCommand();$guard.CommandText="IF DB_NAME()<>'dbwins_worldfert9_uat_v3' OR IS_SRVROLEMEMBER('sysadmin')<>1 BEGIN RAISERROR('QA_OBSERVER_TARGET',16,1);RETURN;END;SELECT Mode FROM wf.QaCouponBridgeOverlap"
 $mode=[string]$guard.ExecuteScalar()
 while(([DateTime]::UtcNow-$started).TotalSeconds -lt 30) {
  $q=$c.CreateCommand();$q.CommandTimeout=2
  $q.CommandText="SELECT r.session_id,r.blocking_session_id,r.wait_type,
   CASE WHEN SUBSTRING(r.context_info,1,DATALENGTH(q.Marker))=q.Marker THEN 1 ELSE 0 END AS BarrierOwner
   FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions s ON s.session_id=r.session_id CROSS JOIN wf.QaCouponBridgeOverlap q
   WHERE r.database_id=DB_ID() AND(r.session_id IN(SELECT session_id FROM sys.dm_exec_requests WHERE SUBSTRING(context_info,1,DATALENGTH(q.Marker))=q.Marker)
    OR r.blocking_session_id IN(SELECT session_id FROM sys.dm_exec_requests WHERE SUBSTRING(context_info,1,DATALENGTH(q.Marker))=q.Marker))"
  $r=$q.ExecuteReader()
  try {while($r.Read()){$samples+=@{at=[DateTime]::UtcNow.ToString('o');session=[int]$r[0];blocker=[int]$r[1];wait=[string]$r[2];owner=[int]$r[3]}}}finally{$r.Close()}
  Start-Sleep -Milliseconds 200
 }
 $result=@{mode=$mode;markerObserved=@($samples|Where-Object {$_.owner -eq 1}).Count -gt 0;blockedObserved=@($samples|Where-Object {$_.blocker -gt 0 -and $_.owner -eq 0}).Count -gt 0;samples=$samples}
 $file='D:\SaleApp\qa-native-v3\state\loop-r740v3-20261123-10\overlap-'+$mode+'-'+$started.ToString('yyyyMMdd-HHmmssfff')+'.json'
 [IO.File]::WriteAllText($file,($result|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
 Write-Output ('QA_OVERLAP_OBSERVER_DONE mode='+$mode+' marker='+$result.markerObserved+' blocked='+$result.blockedObserved)
} finally {$c.Close()}
