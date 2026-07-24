<#
  Controlled UAT candidate build.
  - runs read-only document/source change discovery before generation;
  - requires an explicit switch to proceed when known drift exists;
  - builds XLSX and DOCX from one JSON source;
  - renders/validates outputs and writes an auditable build report;
  - never marks an artefact Approved or Released.
#>
param(
  [switch]$AllowKnownDrift,
  [switch]$SkipPreflight,
  [switch]$SkipPreviews,
  [switch]$SkipDocxRender,
  [switch]$SkipArtifactValidation,
  [string]$PythonExe = '',
  [string]$NodeExe = '',
  [string]$NodeModules = ''
)
$ErrorActionPreference = 'Stop'
$HERE = $PSScriptRoot
$ENT = Split-Path (Split-Path $HERE -Parent) -Parent
$REPO = Split-Path (Split-Path $ENT -Parent) -Parent
$CONTROL = Join-Path (Split-Path $HERE -Parent) 'docs.ps1'
$data = Join-Path $HERE 'uat-cases.json'
$xlsxBuilder = Join-Path $HERE 'build-uat-workbook.mjs'
$docxBuilder = Join-Path $HERE 'build_uat_run_plan.py'
$renderScript = Join-Path $HERE 'render-uat-candidate.ps1'
$validator = Join-Path $HERE 'validate_uat_artifacts.py'
$xlsx = Join-Path $ENT '06-XLSX\candidate\UAT-Master-Script-v1.0.xlsx'
$docx = Join-Path $ENT '01-DOCX\candidate\UAT-Full-Loop-Run-Plan-v1.0.docx'
$previewDir = Join-Path $ENT '06-XLSX\candidate\preview'
$reportDir = Join-Path $ENT 'pipeline\reports'

if (-not $NodeExe) {
  $bundled = 'C:\Users\amyou\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path -LiteralPath $bundled) { $NodeExe = $bundled }
  else { $cmd = Get-Command node -ErrorAction SilentlyContinue; if ($cmd) { $NodeExe = $cmd.Source } }
}
if (-not $PythonExe) {
  $bundled = 'C:\Users\amyou\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
  if (Test-Path -LiteralPath $bundled) { $PythonExe = $bundled }
  else { $cmd = Get-Command python -ErrorAction SilentlyContinue; if ($cmd) { $PythonExe = $cmd.Source } }
}
if (-not $NodeModules) { $NodeModules = 'C:\Users\amyou\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules' }
foreach ($required in @($NodeExe,$PythonExe,$data,$xlsxBuilder,$docxBuilder,$validator)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required input/tool not found: $required" }
}

$preflightExit = $null
if (-not $SkipPreflight) {
  & $CONTROL preflight -NoWrite
  $preflightExit = $LASTEXITCODE
  if ($preflightExit -ne 0 -and -not $AllowKnownDrift) {
    throw 'Candidate build blocked by read-only preflight. Review source/document drift; rerun with -AllowKnownDrift only for an explicitly reviewed candidate build.'
  }
}

$sourceCommit = (& git -c "safe.directory=$REPO" -C $REPO rev-parse HEAD).Trim()
if (-not $sourceCommit) { throw 'Unable to resolve repository HEAD.' }
$evidencePath = Join-Path $REPO 'test-results\e2e-evidence.json'
$e2eStatus = 'RERUN REQUIRED - no current source-bound E2E evidence'
$evidenceSummary = $null
if (Test-Path -LiteralPath $evidencePath) {
  $evidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
  $isCurrent = $evidence.status -eq 'PASSED_COMPLETE' -and $evidence.complete -eq $true -and
    $evidence.git.commit -eq $sourceCommit -and $evidence.sourceStability.stable -eq $true -and
    $evidence.counts.total -ge 10 -and $evidence.counts.passed -eq $evidence.counts.total -and
    $evidence.counts.failed -eq 0 -and $evidence.counts.flaky -eq 0 -and $evidence.counts.skipped -eq 0 -and
    $evidence.counts.timedOut -eq 0 -and $evidence.counts.interrupted -eq 0 -and $evidence.counts.notRun -eq 0
  $evidenceSummary = [ordered]@{
    path = $evidencePath
    status = $evidence.status
    runId = $evidence.runId
    completedAt = $evidence.completedAt
    gitCommit = $evidence.git.commit
    sourceStable = $evidence.sourceStability.stable
    counts = $evidence.counts
    currentForHead = $isCurrent
  }
  if ($isCurrent) {
    $e2eStatus = "PASSED_COMPLETE - $($evidence.counts.passed)/$($evidence.counts.total) automated tests on $sourceCommit; business/manual UAT still required"
  }
}
$env:NODE_PATH = $NodeModules

$xlsxArgs = @($xlsxBuilder, '--source-commit', $sourceCommit)
if (-not $SkipPreviews) { $xlsxArgs += @('--preview-dir', $previewDir) }
& $NodeExe @xlsxArgs
$xlsxExit = $LASTEXITCODE
if (-not (Test-Path -LiteralPath $xlsx)) { throw 'UAT workbook was not created.' }
if (-not $SkipPreviews) {
  $expected = @('readme.png','run-control.png','dashboard.png','uat-cases.png','full-loop.png','defects.png','evidence.png','sign-off.png','lookups.png')
  $missing = @($expected | Where-Object { -not (Test-Path -LiteralPath (Join-Path $previewDir $_)) })
  if ($missing.Count -gt 0) { throw "Workbook preview missing: $($missing -join ', ')" }
}

& $PythonExe $docxBuilder --source-commit $sourceCommit --e2e-status $e2eStatus
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $docx)) { throw 'UAT DOCX candidate build failed.' }

$renderResult = $null
if (-not $SkipDocxRender) {
  $renderJson = & $renderScript -DocxPath $docx -PythonExe $PythonExe
  if ($LASTEXITCODE -ne 0) { throw 'DOCX candidate render failed.' }
  $renderResult = $renderJson | ConvertFrom-Json
}

New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
$report = [ordered]@{
  status = 'CANDIDATE_BUILT'
  sourceCommit = $sourceCommit
  preflightExit = $preflightExit
  allowKnownDrift = [bool]$AllowKnownDrift
  sourceData = $data
  e2eEvidence = $evidenceSummary
  caseCount = ((Get-Content -LiteralPath $data -Raw | ConvertFrom-Json).cases.Count)
  outputs = [ordered]@{
    xlsx = [ordered]@{ path=$xlsx; sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $xlsx).Hash; generatorExit=$xlsxExit }
    docx = [ordered]@{ path=$docx; sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $docx).Hash; render=$renderResult }
  }
  generatedAt = (Get-Date).ToString('o')
  releaseStatus = 'Review - human approval and current E2E/business UAT required'
}
$reportPath = Join-Path $reportDir 'uat-candidate-build-report.json'
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath -Encoding UTF8

if (-not $SkipArtifactValidation) {
  if ($SkipPreviews -or $SkipDocxRender) {
    throw 'Artifact validation requires workbook previews and DOCX render; remove skip switches or use -SkipArtifactValidation explicitly.'
  }
  & $PythonExe $validator
  if ($LASTEXITCODE -ne 0) { throw 'UAT artifact validation failed. Review pipeline/reports/uat-artifact-validation-report.json.' }
  $validationPath = Join-Path $reportDir 'uat-artifact-validation-report.json'
  $validation = Get-Content -LiteralPath $validationPath -Raw | ConvertFrom-Json
  $report['artifactValidation'] = [ordered]@{
    path = $validationPath
    status = $validation.status
    generatedAt = $validation.generatedAt
  }
  $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath -Encoding UTF8
}

$report | ConvertTo-Json -Depth 10

