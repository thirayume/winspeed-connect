param(
    [string]$Spec = '',
    [switch]$OpenReport,
    [switch]$KeepServers
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$testExitCode = 1
$serverProcess = $null

function Wait-Endpoint([string]$Url, [int]$TimeoutSeconds = 60) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for $Url"
}

Write-Host '==================================================' -ForegroundColor Cyan
Write-Host 'WS-Sale-App : Deterministic E2E Test Runner' -ForegroundColor Cyan
Write-Host '==================================================' -ForegroundColor Cyan

try {
    Write-Host '1. Stopping stale background servers...' -ForegroundColor Yellow
    npm run predev

    Write-Host '2. Seeding stable E2E fixtures...' -ForegroundColor Yellow
    sqlcmd -S .\SQLEXPRESS -E -d dbwins_worldfert9 -i db-init\e2e-seed.sql -b
    if ($LASTEXITCODE -ne 0) { throw "SQL seed failed with exit code $LASTEXITCODE" }

    Write-Host '3. Starting API and frontend...' -ForegroundColor Yellow
    $serverProcess = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run dev:e2e' -WindowStyle Hidden -PassThru
    Wait-Endpoint 'http://localhost:3000/api/health'
    Wait-Endpoint 'http://localhost:5173'

    if ($Spec) {
        Write-Host "4. Running Playwright spec: $Spec" -ForegroundColor Yellow
        & node node_modules/@playwright/test/cli.js test $Spec
    } else {
        Write-Host '4. Running every Playwright spec...' -ForegroundColor Yellow
        & node node_modules/@playwright/test/cli.js test
    }
    $testExitCode = $LASTEXITCODE
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    $testExitCode = 1
} finally {
    Write-Host '5. Retaining stable E2E users for audit traceability...' -ForegroundColor Yellow
    try {
        sqlcmd -S .\SQLEXPRESS -E -d dbwins_worldfert9 -i db-init\e2e-cleanup.sql -b
    } catch {
        Write-Warning "E2E cleanup failed: $($_.Exception.Message)"
    }
    if (-not $KeepServers) {
        Write-Host '6. Stopping test servers...' -ForegroundColor Yellow
        npm run predev
    }
}

if ($OpenReport -and (Test-Path -LiteralPath 'playwright-report\index.html')) {
    Start-Process -FilePath 'playwright-report\index.html'
}

Write-Host "E2E exit code: $testExitCode" -ForegroundColor $(if ($testExitCode -eq 0) { 'Green' } else { 'Red' })
exit $testExitCode
