<#
  build-all.ps1 — WorldFert doc-gen pipeline (diagrams + DOCX matrix + PPTX matrix)
  Reproducible: installs deps into a LOCAL cache (never onto Google Drive), then generates.

  USAGE:  ./build-all.ps1
  Deps installed on demand: pip (python-docx, mistune) · npm in cache (pptxgenjs, @mermaid-js/mermaid-cli)
#>
param(
  [string]$DepsDir = (Join-Path $env:LOCALAPPDATA "wf-docgen"),
  [string]$PythonExe = "",
  [switch]$SkipDiagrams
)
$ErrorActionPreference = "Stop"
$HERE = $PSScriptRoot
$ENT  = Split-Path (Split-Path $HERE -Parent) -Parent   # docs\enterprise
$DIAG = Join-Path $ENT "pipeline\diagrams"
$CONTROL = Join-Path (Split-Path $HERE -Parent) "docs.ps1"
function Say($m,$c="Gray"){ Write-Host $m -ForegroundColor $c }

$pythonResolved = $null
$pythonPrefix = @()
$localPython = Join-Path $DepsDir "tools\python\python.exe"
if ($PythonExe) {
  if (-not (Test-Path -LiteralPath $PythonExe)) { throw "Python executable not found: $PythonExe" }
  $pythonResolved = (Resolve-Path -LiteralPath $PythonExe).Path
} elseif (Test-Path -LiteralPath $localPython) {
  $pythonResolved = $localPython
} else {
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCommand) {
    $pythonResolved = $pythonCommand.Source
  } else {
    $pythonCommand = Get-Command py -ErrorAction SilentlyContinue
    if ($pythonCommand) {
      $pythonResolved = $pythonCommand.Source
      $pythonPrefix = @('-3')
    }
  }
}
if (-not $pythonResolved) { throw 'Python 3 is required. Install it in the docgen cache, use -PythonExe, or provide python/py on PATH.' }
$pythonPipScope = if ($pythonResolved -eq $localPython) { @() } else { @('--user') }

Say "== WorldFert Doc-Gen Pipeline ==" Cyan
Say "Enterprise: $ENT"
Say "Deps cache: $DepsDir (local, not on Drive)"

Say "[GATE] Strict documentation preflight..." Yellow
& $CONTROL preflight -Strict
if ($LASTEXITCODE -ne 0) {
  throw 'BUILD BLOCKED: documentation preflight failed. Review pipeline/reports before dependency installation or artifact generation.'
}

# 1) python deps
Say "`n[1/5] Ensure python deps (python-docx, mistune)..." Yellow
& $pythonResolved @pythonPrefix -m pip install --quiet @pythonPipScope python-docx mistune 2>&1 | Out-Null
Say "  ok"

# 2) node deps in local cache
Say "[2/5] Ensure node deps (pptxgenjs, mermaid-cli) in cache..." Yellow
New-Item -ItemType Directory -Force -Path $DepsDir | Out-Null
if (-not (Test-Path (Join-Path $DepsDir "package.json"))) { Push-Location $DepsDir; npm init -y | Out-Null; Pop-Location }
if (-not (Test-Path (Join-Path $DepsDir "node_modules\pptxgenjs"))) { Push-Location $DepsDir; npm install pptxgenjs @mermaid-js/mermaid-cli 2>&1 | Out-Null; Pop-Location }
$env:NODE_PATH = Join-Path $DepsDir "node_modules"
$env:PUPPETEER_CACHE_DIR = Join-Path $DepsDir "puppeteer-cache"
$mmdc = Join-Path $DepsDir "node_modules\.bin\mmdc.cmd"
if (-not (Test-Path -LiteralPath $mmdc)) { throw "Mermaid CLI not found after dependency setup: $mmdc" }
Say "  ok"

# 3) diagrams (author .mmd + render png)
if (-not $SkipDiagrams) {
  Say "[3/5] Diagrams: author + render mermaid..." Yellow
  $env:PYTHONUTF8="1"; & $pythonResolved @pythonPrefix (Join-Path $HERE "make_diagrams.py")
  $pcfg = Join-Path $DepsDir "pconfig.json"; '{"args":["--no-sandbox","--disable-setuid-sandbox"]}' | Out-File -Encoding ascii $pcfg
  $mcfg = Join-Path $DepsDir "mermaid-config.json"; '{"theme":"default","themeVariables":{"fontFamily":"Prompt"}}' | Out-File -Encoding ascii $mcfg
  $n=0; Get-ChildItem $DIAG -Filter *.mmd | ForEach-Object {
    $out = Join-Path $DIAG ($_.BaseName + ".png")
    & $mmdc -i $_.FullName -o $out -t default -b white -s 2 --configFile $mcfg --puppeteerConfigFile $pcfg *> $null
    if (Test-Path $out) { $n++ }
  }
  Say "  rendered $n diagrams"
} else { Say "[3/5] Diagrams skipped" }

# 4) DOCX matrix
Say "[4/5] Build DOCX matrix (SRS, Tech Spec, User Guides)..." Yellow
$env:PYTHONUTF8="1"; & $pythonResolved @pythonPrefix (Join-Path $HERE "build_docx.py")

# 5) PPTX matrix
Say "[5/5] Build PPTX matrix (training + support)..." Yellow
node (Join-Path $HERE "build_pptx.js")

Say "`n== DONE ==" Green
Say "DOCX -> $ENT\01-DOCX\generated"
Say "PPTX -> $ENT\02-PPTX\generated"
