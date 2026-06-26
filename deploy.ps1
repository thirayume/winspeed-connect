#!/usr/bin/env pwsh
# ============================================================
#  deploy.ps1  -  WinSpeed CI/CD Deploy Script
#  ============================================================
#  Usage:
#    .\deploy.ps1                        -> patch bump + migrate + push
#    .\deploy.ps1 -BumpType minor        -> minor bump
#    .\deploy.ps1 -BumpType major        -> major bump
#    .\deploy.ps1 -SkipMigration         -> skip DB migration step
#    .\deploy.ps1 -SkipMigration -DryRun -> preview only, no changes
#
#  What it does:
#    1. Bump version in package.json (root, backend, frontend)
#    2. Run DB migrations against Remote DB
#    3. Commit + Push to GitHub
#       -> Railway auto-deploys backend from GitHub
#       -> Vercel  auto-deploys frontend from GitHub
# ============================================================
param(
  [ValidateSet("patch","minor","major")]
  [string] $BumpType     = "patch",
  [switch] $SkipMigration,
  [switch] $DryRun
)

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot

# -- helpers --------------------------------------------------
function Write-Step([string]$msg) {
  Write-Host "`n>> $msg" -ForegroundColor Cyan
}
function Write-OK([string]$msg) {
  Write-Host "  [OK]  $msg" -ForegroundColor Green
}
function Write-Warn([string]$msg) {
  Write-Host "  [!]   $msg" -ForegroundColor Yellow
}
function Write-Fail([string]$msg) {
  Write-Host "  [ERR] $msg" -ForegroundColor Red
  exit 1
}

function Bump-Version([string]$currentVer, [string]$bumpType) {
  $parts = $currentVer -split '\.'
  $major = [int]$parts[0]
  $minor = [int]$parts[1]
  $patch = [int]$parts[2]
  switch ($bumpType) {
    "major" { $major++; $minor = 0; $patch = 0 }
    "minor" { $minor++;             $patch = 0 }
    "patch" { $patch++ }
  }
  return "$major.$minor.$patch"
}

function Update-PackageJson([string]$filePath, [string]$newVersion) {
  # Read as-is and replace only the "version" field with regex.
  # This avoids PowerShell ConvertTo-Json re-formatting (BOM, extra spaces, & escapes).
  $raw = [System.IO.File]::ReadAllText($filePath)
  $raw = $raw -replace '("version"\s*:\s*)"[^"]*"', "`$1`"$newVersion`""
  [System.IO.File]::WriteAllText($filePath, $raw, [System.Text.UTF8Encoding]::new($false))
}

# -- banner ---------------------------------------------------
Write-Host ""
Write-Host "=============================================" -ForegroundColor Magenta
Write-Host "     WinSpeed Connect - Deploy Pipeline      " -ForegroundColor Magenta
Write-Host "=============================================" -ForegroundColor Magenta
if ($DryRun) { Write-Host "  [DRY RUN - no changes will be committed]" -ForegroundColor Yellow }
Write-Host ""

# -- Step 1: Bump Version -------------------------------------
Write-Step "Step 1/4 - Bump version ($BumpType)"

$rootPkg = Join-Path $ROOT "package.json"
$bePkg   = Join-Path $ROOT "backend\package.json"
$fePkg   = Join-Path $ROOT "WSSale-App\package.json"

$currentVersion = (Get-Content $rootPkg -Raw | ConvertFrom-Json).version
$newVersion     = Bump-Version $currentVersion $BumpType

Write-Host "  $currentVersion -> $newVersion" -ForegroundColor White

if (-not $DryRun) {
  Update-PackageJson $rootPkg $newVersion
  Update-PackageJson $bePkg  $newVersion
  Update-PackageJson $fePkg  $newVersion

  # Update CHANGELOG.md date stamp
  $changelog = Join-Path $ROOT "docs\CHANGELOG.md"
  if (Test-Path $changelog) {
    $date    = Get-Date -Format "yyyy-MM-dd"
    $content = Get-Content $changelog -Raw
    $content = $content -replace "\[v$([regex]::Escape($newVersion))\].*", "## [v$newVersion] - $date"
    $content | Set-Content $changelog -Encoding UTF8
  }
}
Write-OK "Version bumped to v$newVersion"

# -- Step 2: DB Migration -------------------------------------
Write-Step "Step 2/4 - Run DB migrations (Remote)"

if ($SkipMigration) {
  Write-Warn "Skipped (--SkipMigration flag set)"
} elseif ($DryRun) {
  Write-Warn "Skipped (dry run)"
} else {
  Push-Location (Join-Path $ROOT "backend")
  try {
    $env:DB_MODE = "remote"
    node run_migrations.js
    if ($LASTEXITCODE -ne 0) { Write-Fail "Migration failed! Fix errors before deploying." }
    Write-OK "Migrations applied to Remote DB"
  } finally {
    Pop-Location
  }
}

# -- Step 3: Git commit + push --------------------------------
Write-Step "Step 3/4 - Commit & Push to GitHub"

if ($DryRun) {
  Write-Warn "Skipped (dry run)"
} else {
  Push-Location $ROOT
  try {
    git add -A
    $commitMsg = "chore: release v$newVersion"
    git commit -m $commitMsg
    git push origin main
    Write-OK "Pushed: '$commitMsg'"
  } catch {
    Write-Fail "Git push failed: $_"
  } finally {
    Pop-Location
  }
}

# -- Step 4: Summary ------------------------------------------
Write-Step "Step 4/4 - Deployment triggered"
Write-Host ""
Write-Host "  Railway -> auto-deploy triggered on push" -ForegroundColor Blue
Write-Host "  Vercel  -> auto-deploy triggered on push" -ForegroundColor Blue
Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "   v$newVersion deploy pipeline complete!    " -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Monitor deployments:" -ForegroundColor Gray
Write-Host "  -> Railway : https://railway.com/dashboard" -ForegroundColor Gray
Write-Host "  -> Vercel  : https://vercel.com/dashboard" -ForegroundColor Gray
Write-Host ""
