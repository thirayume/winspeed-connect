param([string]$RepositoryRoot,[string]$Case,[string]$Layer)
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$file=if($Layer-eq'proof'){'docs/deploy/r740/deploy-r740.ps1'}else{'docs/deploy/r740/host/Refresh-UAT.ps1'}
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $RepositoryRoot $file),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'SOURCE_PARSE_FAILED'}
$OnServer=$true;$Auto=$true;$Environment='uat';$NativeWriterAction=$null;$Distro='Ubuntu'
function Fail([string]$message){throw $message}
function Invoke-Git { [pscustomobject]@{Code=0;Out=@(('a'*40))} }
function Log([string]$message){Write-Host $message}
$global:TemplateEntered=$false
if($Layer-eq'proof'){
 $definition=$ast.Find({param($n)$n-is[Management.Automation.Language.FunctionDefinitionAst]-and$n.Name-eq'Invoke-NativeWriterRefresh'},$true)
 $definitionPath=Join-Path $PSScriptRoot 'function-under-test.ps1'
 Set-Content -LiteralPath $definitionPath -Value $definition.Extent.Text
 . $definitionPath
 $wsl=Join-Path $PSScriptRoot 'fake-wsl.cmd'
 $env:NATIVE_REFRESH_TEST_CASE=$Case
 Set-Content -LiteralPath (Join-Path $PSScriptRoot 'native-writer-release.ps1.template') -Value '$global:TemplateEntered=$true; Write-Output ''NATIVE_RELEASE_APPLIED=ENABLE'''
 $call={Invoke-NativeWriterRefresh}
}else{
 $statement=$ast.Find({param($n)$n-is[Management.Automation.Language.IfStatementAst]-and$n.Extent.Text.Contains("Log 'Revalidating copied native writer approval for UAT ...'")},$true)
 if(-not$statement){throw 'OUTER_REFRESH_BLOCK_MISSING'}
 $body=$statement.Clauses[0].Item2.Extent.Text
 $driver=Join-Path $PSScriptRoot 'fake-driver.ps1';$log=Join-Path $PSScriptRoot 'outer.log'
 $exit=if($Case-eq'nonzero'){3}else{0}
 Set-Content -LiteralPath $driver -Value ("[Console]::Error.WriteLine('[DEP0123] simulated TLS warning'); Write-Output 'NATIVE_RELEASE_APPLIED=ENABLE'; exit "+$exit)
 $call=[scriptblock]::Create($body.Substring(1,$body.Length-2)+"`nif(`$ErrorActionPreference-ne'Stop'){throw 'PREFERENCE_NOT_RESTORED'}")
}
$ok=$false;$failure=$null
try{& $call;$ok=$true}catch{$failure=$_.Exception.Message}
$result=[ordered]@{success=$ok;failure=$failure;templateEntered=$global:TemplateEntered;preference=[string]$ErrorActionPreference;layer=$Layer;case=$Case}
Write-Output ('NATIVE_WARNING_TEST='+($result|ConvertTo-Json -Compress))
