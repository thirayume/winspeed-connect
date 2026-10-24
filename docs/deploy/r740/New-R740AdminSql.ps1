<#
  New-R740AdminSql.ps1 - generate the SQL that creates the first Sale-App ADMIN account in
  dbwins_worldfert9-uat on R740-SRV\SQL2008, after the first UAT deploy applied the migrations
  (-Environment prod: dbwins_worldfert9 after the go-live deploy, file r740-prod-create-admin.local.sql).
  Run it on R740-SRV (elevated, from D:\SaleApp\uat\app) or on the dev PC:

    powershell -NoProfile -ExecutionPolicy Bypass -File D:\SaleApp\uat\app\docs\deploy\r740\New-R740AdminSql.ps1

  You type the username and password (hidden). The bcrypt hash is made with local Node.js
  and backend dependencies when present, otherwise inside the running UAT backend container
  (saleapp-uat-backend-1) through WSL; the password travels only on standard input.
  Only the hash goes into docs\deploy\r740\sql\r740-uat-create-admin.local.sql (Git-ignored);
  nothing connects to SQL. IT runs that whole file in SSMS on R740-SRV\SQL2008, then deletes
  it. The account must change its password at first sign-in.
#>
[CmdletBinding()]
param(
  [ValidateSet('uat', 'prod')][string]$Environment = 'uat',
  # Create the admin in a specific company database (dbwins_worldfert9 or dbwins_worldfert2)
  # after it is migrated; overrides -Environment's default database.
  [ValidatePattern('^dbwins_worldfert[0-9A-Za-z._-]*$')][string]$Database,
  [string]$Username,
  [System.Security.SecureString]$Password,
  [string]$BcryptModule,
  [string]$WslContainer
)
$ErrorActionPreference = 'Stop'
# -Environment prod: the first admin of dbwins_worldfert9 after the go-live migrations.
if (-not $Database) { $Database = if ($Environment -eq 'prod') { 'dbwins_worldfert9' } else { 'dbwins_worldfert9-uat' } }
$database = $Database
$fileTag = $database -replace '[^A-Za-z0-9]', '_'
if (-not $WslContainer) { $WslContainer = "saleapp-$Environment-backend-1" }
$arguments = @{
  Database = $database
  ServerName = 'R740-SRV\SQL2008'
  OutputPath = Join-Path $PSScriptRoot "sql\r740-$fileTag-create-admin.local.sql"
}
if (-not $BcryptModule -and (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  # This checkout, or (in a Git worktree, which has no node_modules) the main checkout.
  $candidates = @([System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\backend\node_modules\bcrypt')))
  if (Get-Command git -ErrorAction SilentlyContinue) {
    try {
      $common = (git -C $PSScriptRoot rev-parse --path-format=absolute --git-common-dir)
      if ($common) { $candidates += Join-Path (Split-Path -Parent $common.Trim()) 'backend\node_modules\bcrypt' }
    } catch { }
  }
  $BcryptModule = $candidates | Where-Object { Test-Path (Join-Path $_ 'package.json') } | Select-Object -First 1
}
if ($BcryptModule) {
  $arguments.BcryptModule = $BcryptModule
} elseif (Test-Path (Join-Path $env:SystemRoot 'System32\wsl.exe')) {
  $arguments.WslContainer = $WslContainer
} else {
  throw 'Needs Node.js with backend dependencies, or WSL with the running UAT backend container.'
}
if ($Username) { $arguments.Username = $Username }
if ($Password) { $arguments.Password = $Password }
$sqlDir = Join-Path $PSScriptRoot 'sql'
if (-not (Test-Path $sqlDir)) { New-Item -ItemType Directory -Path $sqlDir | Out-Null }
& (Join-Path $PSScriptRoot '..\onprem\New-Uat2AdminSql.ps1') @arguments
