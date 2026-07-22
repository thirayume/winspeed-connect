<#
  build-docs.ps1 - WorldFert Enterprise Doc-Sync Pipeline
  ---------------------------------------------------------
  Markdown = source of truth. Run this to sync the whole doc set (docx/manifest/version)
  to the latest markdown + source code. Use on: major version bump (v2.0, v3.0) or production deploy.

  USAGE (PowerShell):
    ./build-docs.ps1                       # cleanup + validate + manifest (no render)
    ./build-docs.ps1 -Render               # also render .docx via pandoc (must be installed)
    ./build-docs.ps1 -Version v2.0         # stamp a new doc version across headers
    ./build-docs.ps1 -Deploy               # production-deploy mode: enforce docs<->app version match

  REQUIRES for -Render: pandoc (https://pandoc.org).  docx only; pptx is a separate template step.
#>
param(
  [string]$EnterpriseRoot = (Split-Path $PSScriptRoot -Parent),
  [string]$SourceRepo     = "C:\MyWork\WorldFert\winspeed-frontend",
  [string]$DepsDir        = (Join-Path $env:LOCALAPPDATA "wf-docgen"),
  [string]$Version        = "",          # e.g. v2.0 ; empty = keep current
  [switch]$Render,
  [switch]$Deploy
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Say($m,$c='Gray'){ Write-Host $m -ForegroundColor $c }
function Resolve-DocTool([string]$CommandName, [string]$FileName) {
  $command = Get-Command $CommandName -EA SilentlyContinue
  if ($command) { return $command.Source }
  $toolRoot = Join-Path $DepsDir 'tools'
  if (-not (Test-Path -LiteralPath $toolRoot)) { return $null }
  $local = Get-ChildItem -LiteralPath $toolRoot -Filter $FileName -Recurse -File -EA SilentlyContinue |
    Sort-Object FullName | Select-Object -First 1
  if ($local) { return $local.FullName }
  return $null
}
$report = [System.Collections.Generic.List[string]]::new()

Say "== WorldFert Doc-Sync Pipeline ==" Cyan
Say "Enterprise: $EnterpriseRoot"
Say "SourceRepo: $SourceRepo`n"

$docControl = Join-Path $PSScriptRoot 'docs.ps1'
Say "[GATE] Strict documentation preflight..." Yellow
& $docControl preflight -Strict
if ($LASTEXITCODE -ne 0) {
  throw 'BUILD BLOCKED: documentation preflight failed. Review pipeline/reports before cleanup, stamping or rendering.'
}
$report.Add('Gate: strict documentation preflight passed before mutation/render')

# ---------- 1) CLEANUP junk ----------
Say "[1/6] Cleanup junk files..." Yellow
$killed = 0
Get-ChildItem -LiteralPath $EnterpriseRoot -Recurse -Force -File -EA SilentlyContinue |
  Where-Object { $_.Name -like '~$*' -or $_.Name -eq 'desktop.ini' -or $_.Extension -eq '.tmp' } |
  ForEach-Object { try { Remove-Item -LiteralPath $_.FullName -Force; $killed++ } catch {} }
# empty folders
Get-ChildItem -LiteralPath $EnterpriseRoot -Recurse -Directory -EA SilentlyContinue |
  Where-Object { (Get-ChildItem $_.FullName -Recurse -File -EA SilentlyContinue).Count -eq 0 } |
  ForEach-Object { try { Remove-Item -LiteralPath $_.FullName -Recurse -Force; $killed++ } catch {} }
Say "  removed $killed junk items"
$report.Add("Cleanup: removed $killed junk items (~`$, desktop.ini, .tmp, empty dirs)")

# ---------- 2) VERSION STAMP ----------
if ($Version) {
  Say "[2/6] Stamping doc version -> $Version ..." Yellow
  $stamped = 0
  Get-ChildItem -LiteralPath $EnterpriseRoot -Recurse -File -Filter *.md |
    Where-Object { $_.FullName -notmatch '\\_archive\\' } | ForEach-Object {
      $t = [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8)
      $n = [regex]::Replace($t, '(?<=Version[:\s|]*)v\d+\.\d+', $Version)
      if ($n -ne $t) { [System.IO.File]::WriteAllText($_.FullName, $n, $utf8); $stamped++ }
    }
  Say "  stamped $stamped files"
  $report.Add("Version: stamped $stamped markdown files to $Version")
  if ($stamped -gt 0) {
    Say "  candidate documents changed; refreshing preflight reports before stopping" Yellow
    & $docControl preflight -Strict
    throw 'BUILD PAUSED: version stamping created candidate changes. Review and explicitly accept the new baseline, then rerun without -Version.'
  }
} else { Say "[2/6] Version stamp skipped (no -Version)" }

# ---------- 3) SOURCE ALIGNMENT (docs <-> app) ----------
Say "[3/6] Source-alignment check..." Yellow
$appVer = $null
$pkg = Join-Path $SourceRepo "WSSale-App\package.json"
if (Test-Path $pkg) { $appVer = (Get-Content $pkg -Raw | ConvertFrom-Json).version }
$docVer = $null
$ctrl = Join-Path $EnterpriseRoot "00-GOVERNANCE\DOCUMENT-CONTROL.md"
if (Test-Path $ctrl) { $m = [regex]::Match((Get-Content $ctrl -Raw), 'App build[^\|]*\|\s*([^\|]+)\|'); if ($m.Success){ $docVer = $m.Groups[1].Value.Trim() } }
Say "  app package.json = $appVer"
Say "  docs reference   = $docVer"
if ($appVer -and $docVer -and ($docVer -notlike "*$appVer*")) {
  Say "  DRIFT: docs build ref ($docVer) != app version ($appVer)" Red
  $report.Add("ALIGN WARN: docs ref '$docVer' != app package.json '$appVer' - update DOCUMENT-CONTROL")
} else { $report.Add("ALIGN: docs/app version consistent ($appVer)") }
if ($Deploy -and $appVer -and $docVer -and ($docVer -notlike "*$appVer*")) {
  throw "DEPLOY BLOCKED: docs build reference must equal app version $appVer before production deploy."
}

# ---------- 4) TEST-SYNC drift (current screens vs test catalog) ----------
Say "[4/6] Test-catalog drift check..." Yellow
$compDir = Join-Path $SourceRepo "WSSale-App\src\components"
$screens = @()
if (Test-Path $compDir) { $screens = Get-ChildItem $compDir -Directory | Select-Object -ExpandProperty Name }
$catalog = Join-Path $EnterpriseRoot "06-QUALITY-OPERATIONS\TEST-CATALOG-CURRENT.md"
$missing = @()
if (Test-Path $catalog) {
  $ct = Get-Content $catalog -Raw
  foreach ($s in $screens) { if ($ct -notmatch [regex]::Escape($s)) { $missing += $s } }
}
if ($missing.Count) {
  Say ("  test catalog MISSING coverage for: " + ($missing -join ', ')) Red
  $report.Add("TEST WARN: catalog missing screens: " + ($missing -join ', '))
} else { $report.Add("TEST: catalog covers all $($screens.Count) source screen areas") }

# ---------- 5) RENDER single merged docx (pandoc) ----------
Say "[5/6] Render single complete docx..." Yellow
$pandocExe = Resolve-DocTool 'pandoc' 'pandoc.exe'
if ($Render -and $pandocExe) {
  $docxOut = Join-Path $EnterpriseRoot "01-DOCX"
  New-Item -ItemType Directory -Force -Path $docxOut | Out-Null
  # ordered concatenation: README, then section folders 00..09 (alnum), then root appendix md
  $ordered = @()
  $ordered += Get-ChildItem -LiteralPath $EnterpriseRoot -File -Filter 'README.md'
  Get-ChildItem -LiteralPath $EnterpriseRoot -Directory | Where-Object { $_.Name -match '^\d\d' } | Sort-Object Name | ForEach-Object {
    $ordered += Get-ChildItem -LiteralPath $_.FullName -Recurse -File -Filter *.md | Sort-Object FullName
  }
  $ordered += Get-ChildItem -LiteralPath $EnterpriseRoot -File -Filter '*.md' | Where-Object { $_.Name -notin @('README.md','MANIFEST-SHA256.md') }
  $inputs = $ordered | Where-Object { $_ } | Select-Object -ExpandProperty FullName -Unique
  $merged = Join-Path $docxOut "WorldFert-Enterprise-Documentation-$(if($Version){$Version}else{'v1.0'}).docx"
  & $pandocExe @inputs -o $merged --from gfm --toc --toc-depth=2 --top-level-division=chapter 2>$null
  if (Test-Path $merged) { Say "  built 1 complete docx from $($inputs.Count) sections"; $report.Add("Render: 1 merged docx ($($inputs.Count) sections) -> $(Split-Path $merged -Leaf)") }
  else { Say "  render failed" Red; $report.Add("Render FAILED") }
} elseif ($Render) {
  Say "  pandoc NOT found - skipped. Install: https://pandoc.org" Red
  $report.Add("Render SKIPPED: pandoc not installed")
} else { Say "  skipped (no -Render)"; $report.Add("Render: skipped") }

# ---------- 6) MANIFEST (sha256 of markdown source of truth) ----------
Say "[6/6] Regenerate MANIFEST-SHA256..." Yellow
$lines = @("# MANIFEST-SHA256", "", "> Generated $(Get-Date -Format 'yyyy-MM-dd HH:mm') - source-of-truth = markdown", "", "| File | SHA256 |", "|---|---|")
Get-ChildItem -LiteralPath $EnterpriseRoot -Recurse -File -Filter *.md |
  Where-Object { $_.FullName -notmatch '\\_archive\\' } | Sort-Object FullName | ForEach-Object {
    $h = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
    $lines += "| $($_.FullName.Substring($EnterpriseRoot.Length+1)) | $h |"
  }
[System.IO.File]::WriteAllText((Join-Path $EnterpriseRoot 'MANIFEST-SHA256.md'), ($lines -join "`n"), $utf8)
Say "  manifest written"
$report.Add("Manifest: regenerated MANIFEST-SHA256.md")

# ---------- report ----------
$rp = Join-Path $EnterpriseRoot "pipeline\last-run-report.md"
$hdr = "# Pipeline run - $(Get-Date -Format 'yyyy-MM-dd HH:mm')`n`n"
[System.IO.File]::WriteAllText($rp, $hdr + (($report | ForEach-Object { "- $_" }) -join "`n"), $utf8)
Say "`n== DONE ==  report: pipeline\last-run-report.md" Green
$report | ForEach-Object { Say "  - $_" }
