<#
  source.ps1 — source-code inventory, document alignment and drift control.

  E2E results are validated from the configured source-bound evidence manifest.
  This command never executes E2E tests or changes application code.
#>
param(
  [ValidateSet('scan', 'impact', 'validate', 'preflight', 'status', 'accept', 'release-check', 'sync-api')]
  [string]$Command = 'preflight',
  [switch]$Strict,
  [switch]$NoWrite,
  [string]$Actor = '',
  [string]$Reason = ''
)

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'source-alignment.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js is required to run source alignment.' }
if (-not (Test-Path -LiteralPath $script)) { throw "Source-alignment script not found: $script" }

$cliArgs = @($script, $Command)
if ($Strict) { $cliArgs += '--strict' }
if ($NoWrite) { $cliArgs += '--no-write' }
if ($Actor) { $cliArgs += @('--actor', $Actor) }
if ($Reason) { $cliArgs += @('--reason', $Reason) }

& $node.Source @cliArgs
exit $LASTEXITCODE
