<#
  New-R740AdminSql.ps1 - generate the SQL that creates the first Sale-App ADMIN account in
  dbwins_worldfert9-uat on R740-SRV\SQL2008. Run it on the dev PC after the first UAT
  deploy applied the migrations:

    powershell -NoProfile -ExecutionPolicy Bypass -File docs\deploy\r740\New-R740AdminSql.ps1

  You type the username and password (hidden). Only a bcrypt hash goes into
  docs\deploy\r740\sql\r740-uat-create-admin.local.sql (Git-ignored); nothing connects to SQL.
  IT runs that whole file in SSMS on R740-SRV\SQL2008. The account must change its password
  at first sign-in. Uses ..\onprem\New-Uat2AdminSql.ps1 with the R740 UAT target.
#>
[CmdletBinding()]
param(
  [string]$Username,
  [string]$BcryptModule
)
$ErrorActionPreference = 'Stop'
if (-not $BcryptModule) {
  # This checkout, or the main checkout that owns it (worktrees have no node_modules).
  $here = (git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
  $main = Split-Path -Parent (git -C $PSScriptRoot rev-parse --path-format=absolute --git-common-dir).Trim()
  $BcryptModule = @("$here\backend\node_modules\bcrypt", "$main\backend\node_modules\bcrypt") |
    Where-Object { Test-Path (Join-Path $_ 'package.json') } | Select-Object -First 1
  if (-not $BcryptModule) { throw 'Run npm install in backend once, or pass -BcryptModule <path to node_modules\bcrypt>.' }
}
$arguments = @{
  Database = 'dbwins_worldfert9-uat'
  ServerName = 'R740-SRV\SQL2008'
  BcryptModule = $BcryptModule
  OutputPath = Join-Path $PSScriptRoot 'sql\r740-uat-create-admin.local.sql'
}
if ($Username) { $arguments.Username = $Username }
& (Join-Path $PSScriptRoot '..\onprem\New-Uat2AdminSql.ps1') @arguments
