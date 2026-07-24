<#
  Build and validate the source-aligned SRS, Analysis & Design, and
  Technical Specification DOCX candidates.

  This pipeline always keeps artifacts in Review status. It does not accept
  a source/document baseline and does not create an approval record.
#>
[CmdletBinding()]
param(
    [string]$PythonExe = "",
    [string]$RunId = "",
    [switch]$TryLibreOffice
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$pipeline = Split-Path -Parent $here
$enterprise = Split-Path -Parent $pipeline
$repo = Split-Path (Split-Path -Parent $enterprise) -Parent
$docsControl = Join-Path $pipeline "docs.ps1"
$sourceReportPath = Join-Path $pipeline "reports\source-alignment-report.json"
$documentReportPath = Join-Path $pipeline "reports\document-validation-report.json"
$buildReportPath = Join-Path $pipeline "reports\technical-core-build-report.json"
$validationReportPath = Join-Path $pipeline "reports\technical-core-validation-report.json"
$pipelineReportPath = Join-Path $pipeline "reports\technical-core-pipeline-report.json"
$outputRoot = Join-Path $enterprise "01-DOCX\candidate\technical-core"

if ([string]::IsNullOrWhiteSpace($RunId)) {
    $RunId = Get-Date -Format "yyyyMMdd-HHmmss"
}
if ($RunId -notmatch "^[0-9A-Za-z._-]+$") {
    throw "RunId may contain only letters, digits, dot, underscore, and hyphen."
}

if ([string]::IsNullOrWhiteSpace($PythonExe)) {
    $bundledPython = "C:\Users\amyou\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
    if (Test-Path -LiteralPath $bundledPython) {
        $PythonExe = $bundledPython
    } else {
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if ($pythonCommand) { $PythonExe = $pythonCommand.Source }
    }
}
if (-not $PythonExe -or -not (Test-Path -LiteralPath $PythonExe)) {
    throw "Python runtime not found. Pass -PythonExe explicitly."
}

$requiredFiles = @(
    $docsControl,
    (Join-Path $here "technical-core-manifest.json"),
    (Join-Path $here "build_technical_core.py"),
    (Join-Path $here "render-domain-diagrams.ps1"),
    (Join-Path $here "render-uat-candidate.ps1"),
    (Join-Path $here "validate_technical_core.py")
)
foreach ($requiredFile in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $requiredFile)) {
        throw "Required pipeline file not found: $requiredFile"
    }
}

& $PythonExe -c "import mistune, docx, lxml, PIL, pypdfium2"
if ($LASTEXITCODE -ne 0) {
    $requirements = Join-Path $here "requirements-technical-core.txt"
    throw "Technical-core Python dependencies are missing. Run: `"$PythonExe`" -m pip install -r `"$requirements`""
}

Push-Location $repo
try {
    # Gate 1: capture a current source/document snapshot before generation.
    & $docsControl validate
    if ($LASTEXITCODE -ne 0) {
        throw "Source/document preflight failed. Review pipeline reports before building."
    }
    $sourceStart = Get-Content -Raw -LiteralPath $sourceReportPath | ConvertFrom-Json
    $documentStart = Get-Content -Raw -LiteralPath $documentReportPath | ConvertFrom-Json
    if (-not $sourceStart.summary.passed) {
        throw "Source preflight contains blocking errors."
    }
    if (($documentStart.summary.counts.ERROR | ForEach-Object { [int]$_ }) -gt 0) {
        throw "Document preflight contains blocking errors."
    }

    # Gate 2: regenerate source diagrams, then regenerate all three DOCX files.
    & (Join-Path $here "render-domain-diagrams.ps1")
    if ($LASTEXITCODE -ne 0) { throw "Domain diagram rendering failed." }

    & $PythonExe (Join-Path $here "build_technical_core.py")
    if ($LASTEXITCODE -ne 0) { throw "Technical-core DOCX generation failed." }

    # Gate 3: render every page into an immutable run folder.
    $renderRoot = Join-Path $outputRoot ("qa-render\" + $RunId)
    New-Item -ItemType Directory -Force -Path $renderRoot | Out-Null
    $documents = @(
        @{ key = "srs"; file = "SRS-v1.0-candidate.docx" },
        @{ key = "analysis-design"; file = "Analysis-and-Design-v1.0-candidate.docx" },
        @{ key = "technical-spec"; file = "Technical-Specification-v1.0-candidate.docx" }
    )
    $renderReports = @()
    foreach ($document in $documents) {
        $docxPath = Join-Path $outputRoot $document.file
        $renderDirectory = Join-Path $renderRoot $document.key
        $renderArguments = @{
            DocxPath = $docxPath
            OutputDir = $renderDirectory
            PythonExe = $PythonExe
        }
        if (-not $TryLibreOffice) { $renderArguments.ForceWordFallback = $true }
        & (Join-Path $here "render-uat-candidate.ps1") @renderArguments | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "DOCX render failed: $($document.file)" }
        $renderReports += Get-Content -Raw -LiteralPath (Join-Path $renderDirectory "render-report.json") | ConvertFrom-Json
    }

    # Gate 4: validate structure, accessibility, provenance, and every page.
    & $PythonExe (Join-Path $here "validate_technical_core.py") --render-root $renderRoot
    if ($LASTEXITCODE -ne 0) { throw "Technical-core validation failed." }
    $technicalValidation = Get-Content -Raw -LiteralPath $validationReportPath | ConvertFrom-Json

    # Gate 5: rescan after artifacts were generated and prove source stability.
    & $docsControl validate
    if ($LASTEXITCODE -ne 0) {
        throw "Post-build source/document validation failed."
    }
    $sourceEnd = Get-Content -Raw -LiteralPath $sourceReportPath | ConvertFrom-Json
    $documentEnd = Get-Content -Raw -LiteralPath $documentReportPath | ConvertFrom-Json
    if ($sourceStart.sourceInventorySha256 -ne $sourceEnd.sourceInventorySha256) {
        throw "Tracked source changed during the technical-core build; discard this run and start again."
    }

    $buildReport = Get-Content -Raw -LiteralPath $buildReportPath | ConvertFrom-Json
    $pipelineReport = [ordered]@{
        schemaVersion = 1
        kind = "WS-Sale-App Technical Core Pipeline"
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        runId = $RunId
        status = "PASSED"
        lifecycleStatus = "Review"
        approvalBoundary = "Candidate only; human review and baseline acceptance required"
        source = [ordered]@{
            commit = (& git rev-parse HEAD).Trim()
            inventorySha256 = $sourceEnd.sourceInventorySha256
            fileCount = $sourceEnd.facts.sourceFileCount
            stableDuringBuild = $true
            validationErrors = [int]($sourceEnd.summary.counts.ERROR | ForEach-Object { if ($_ -eq $null) { 0 } else { $_ } })
            validationWarnings = [int]($sourceEnd.summary.counts.WARNING | ForEach-Object { if ($_ -eq $null) { 0 } else { $_ } })
        }
        documents = [ordered]@{
            inventorySha256 = $documentEnd.inventorySha256
            validationErrors = [int]($documentEnd.summary.counts.ERROR | ForEach-Object { if ($_ -eq $null) { 0 } else { $_ } })
            validationWarnings = [int]($documentEnd.summary.counts.WARNING | ForEach-Object { if ($_ -eq $null) { 0 } else { $_ } })
        }
        build = $buildReport
        renderRoot = $renderRoot
        renders = $renderReports
        validation = $technicalValidation.summary
        reportRefs = @(
            $sourceReportPath,
            $documentReportPath,
            $buildReportPath,
            $validationReportPath
        )
    }
    $pipelineReport | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $pipelineReportPath -Encoding UTF8
    $pipelineReport | ConvertTo-Json -Depth 12
} finally {
    Pop-Location
}
