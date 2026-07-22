<#
  docs.ps1 — combined document + source-alignment control entry point.

  Source inventory and source-bound E2E evidence validation run before document
  inventory. This command validates evidence but never executes E2E tests.
#>
param(
  [ValidateSet('scan', 'impact', 'validate', 'preflight', 'status', 'accept', 'release-check')]
  [string]$Command = 'preflight',
  [switch]$Strict,
  [switch]$NoWrite,
  [string]$Actor = '',
  [string]$Reason = ''
)

$ErrorActionPreference = 'Stop'
$docScript = Join-Path $PSScriptRoot 'doc-control.js'
$sourceScript = Join-Path $PSScriptRoot 'source-alignment.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js is required to run the documentation control pipeline.' }
foreach ($required in @($docScript, $sourceScript)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Pipeline script not found: $required" }
}

$sourceCommand = if ($Command -eq 'accept') { 'validate' } else { $Command }
$sourceArgs = @($sourceScript, $sourceCommand)
if ($Strict -or $Command -in @('accept', 'release-check')) { $sourceArgs += '--strict' }
if ($NoWrite -or $Command -eq 'accept') { $sourceArgs += '--no-write' }
& $node.Source @sourceArgs
$sourceExit = $LASTEXITCODE

if ($Command -in @('accept', 'release-check') -and $sourceExit -ne 0) {
  Write-Error 'Combined gate blocked by source alignment. Review source-alignment-report.md; accept a source baseline separately with source.ps1 only after all blocking gaps are closed.'
  exit $sourceExit
}

$docArgs = @($docScript, $Command)
if ($Strict) { $docArgs += '--strict' }
if ($NoWrite) { $docArgs += '--no-write' }
if ($Actor) { $docArgs += @('--actor', $Actor) }
if ($Reason) { $docArgs += @('--reason', $Reason) }
& $node.Source @docArgs
$docExit = $LASTEXITCODE

if ($sourceExit -ne 0 -or $docExit -ne 0) { exit 1 }
exit 0
