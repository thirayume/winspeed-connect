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
    $enterpriseDirectory = Split-Path -Parent $pipelineDirectory
    $OutputDirectory = Join-Path $enterpriseDirectory "04-DIAGRAMS-PNG\candidate\domain"
}
if (-not (Test-Path -LiteralPath $MermaidCli)) { throw "Mermaid CLI not found: $MermaidCli" }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$mermaidConfig = Join-Path $scriptDirectory "mermaid-config.json"
$puppeteerConfig = Join-Path $scriptDirectory "puppeteer-config.json"

$jobs = @(
    @{ Name = "13-runtime-architecture"; Width = 2600; Height = 1500; Scale = 2 },
    @{ Name = "14-so-lifecycle-source-aligned"; Width = 2400; Height = 1600; Scale = 2 },
    @{ Name = "15-operational-erd"; Width = 2800; Height = 1900; Scale = 2 },
    @{ Name = "16-rbac-source-aligned"; Width = 2500; Height = 1700; Scale = 2 },
    @{ Name = "17-order-to-cash-workflow"; Width = 3100; Height = 1500; Scale = 2 },
    @{ Name = "18-rebate-domain-uml"; Width = 2800; Height = 1800; Scale = 2 }
)

$outputs = @()
foreach ($job in $jobs) {
    $inputPath = Join-Path $diagramDirectory ($job.Name + ".mmd")
    $outputPath = Join-Path $OutputDirectory ($job.Name + ".png")
    & $MermaidCli -i $inputPath -o $outputPath -c $mermaidConfig -p $puppeteerConfig -b white -w $job.Width -H $job.Height -s $job.Scale
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputPath)) {
        throw "Mermaid render failed for $($job.Name) (exit $LASTEXITCODE)"
    }
    $bytes = [System.IO.File]::ReadAllBytes($outputPath)
    if ($bytes.Length -lt 24 -or $bytes[0] -ne 137 -or $bytes[1] -ne 80 -or $bytes[2] -ne 78 -or $bytes[3] -ne 71) {
        throw "Invalid PNG: $outputPath"
    }
    $actualWidth = (([int]$bytes[16] -shl 24) -bor ([int]$bytes[17] -shl 16) -bor ([int]$bytes[18] -shl 8) -bor [int]$bytes[19])
    $actualHeight = (([int]$bytes[20] -shl 24) -bor ([int]$bytes[21] -shl 16) -bor ([int]$bytes[22] -shl 8) -bor [int]$bytes[23])
    $outputs += [ordered]@{
        source = $inputPath
        output = $outputPath
        actualPixels = [ordered]@{ width = $actualWidth; height = $actualHeight }
        bytes = $bytes.Length
        sha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash
    }
}
$report = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    renderer = (& $MermaidCli --version | Select-Object -First 1)
    fontPolicy = "Prompt body/labels; Kanit fallback; Arial fallback"
    outputs = $outputs
}
$reportPath = Join-Path $OutputDirectory "domain-diagram-render-report.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
Write-Host "Rendered $($outputs.Count) domain diagrams. Report: $reportPath"
