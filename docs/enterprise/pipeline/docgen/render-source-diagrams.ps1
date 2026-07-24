[CmdletBinding()]
param(
    [string]$MermaidCli = "$env:LOCALAPPDATA\wf-docgen\node_modules\.bin\mmdc.cmd",
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$pipelineDirectory = Split-Path -Parent $scriptDirectory
$diagramDirectory = Join-Path $pipelineDirectory "diagrams"

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = $diagramDirectory
}

if (-not (Test-Path -LiteralPath $MermaidCli)) {
    throw "Mermaid CLI not found: $MermaidCli"
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$mermaidConfig = Join-Path $scriptDirectory "mermaid-config.json"
$puppeteerConfig = Join-Path $scriptDirectory "puppeteer-config.json"

$jobs = @(
    @{ Name = "09-current-system-context"; Width = 2400; Height = 1100; Scale = 2 },
    @{ Name = "10-current-api-surface"; Width = 2200; Height = 2500; Scale = 2 },
    @{ Name = "11-document-evidence-flow"; Width = 2600; Height = 1200; Scale = 2 }
)

$outputs = @()
foreach ($job in $jobs) {
    $inputPath = Join-Path $diagramDirectory ($job.Name + ".mmd")
    $outputPath = Join-Path $OutputDirectory ($job.Name + ".png")
    if (-not (Test-Path -LiteralPath $inputPath)) {
        throw "Mermaid source not found: $inputPath"
    }

    & $MermaidCli `
        -i $inputPath `
        -o $outputPath `
        -c $mermaidConfig `
        -p $puppeteerConfig `
        -b white `
        -w $job.Width `
        -H $job.Height `
        -s $job.Scale

    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputPath)) {
        throw "Mermaid render failed for $($job.Name) (exit $LASTEXITCODE)"
    }

    $item = Get-Item -LiteralPath $outputPath
    $pngBytes = [System.IO.File]::ReadAllBytes($outputPath)
    if ($pngBytes.Length -lt 24 -or $pngBytes[0] -ne 137 -or $pngBytes[1] -ne 80 -or $pngBytes[2] -ne 78 -or $pngBytes[3] -ne 71) {
        throw "Rendered output is not a valid PNG: $outputPath"
    }
    $actualWidth = (([int]$pngBytes[16] -shl 24) -bor ([int]$pngBytes[17] -shl 16) -bor ([int]$pngBytes[18] -shl 8) -bor [int]$pngBytes[19])
    $actualHeight = (([int]$pngBytes[20] -shl 24) -bor ([int]$pngBytes[21] -shl 16) -bor ([int]$pngBytes[22] -shl 8) -bor [int]$pngBytes[23])
    $outputs += [ordered]@{
        source = $inputPath
        output = $outputPath
        requestedViewport = [ordered]@{ width = $job.Width; height = $job.Height; scale = $job.Scale }
        actualPixels = [ordered]@{ width = $actualWidth; height = $actualHeight }
        bytes = $item.Length
        sha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash
    }
}

$report = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    renderer = (& $MermaidCli --version | Select-Object -First 1)
    fontPolicy = "Prompt body/labels; Kanit fallback; Arial fallback"
    outputs = $outputs
}
$reportPath = Join-Path $OutputDirectory "source-diagram-render-report.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
Write-Host "Rendered $($outputs.Count) source-aligned diagrams. Report: $reportPath"
