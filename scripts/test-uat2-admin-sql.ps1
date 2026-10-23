param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$VerifyBcryptPath
)

$ErrorActionPreference = 'Stop'
$taskGenerator = Join-Path $RepoRoot 'docs\deploy\onprem\New-Uat2AdminSql.ps1'
if (-not $VerifyBcryptPath) { $VerifyBcryptPath = Join-Path $RepoRoot 'backend\node_modules\bcrypt' }
$taskOutput = Join-Path ([System.IO.Path]::GetTempPath()) ('uat2-admin-test-' + [guid]::NewGuid().ToString('N') + '.sql')
$taskVerifyInput = $taskOutput + '.json'

try {
    # Dummy-only input: include shell metacharacters, SQL quotes and non-ASCII text.
    $taskPassword = 'TestOnly! $&''' + [char]0x0E01
    $taskUsername = "qa'" + [char]0x0E01
    $taskDisplayName = "QA'" + [char]0x0E02
    $taskSecure = ConvertTo-SecureString $taskPassword -AsPlainText -Force
    $taskMessages = & $taskGenerator -Username $taskUsername -Password $taskSecure `
        -DisplayName $taskDisplayName -OutputPath $taskOutput 6>&1
    $taskSql = [System.IO.File]::ReadAllText($taskOutput)
    if (-not $taskSql.Contains("N'" + $taskUsername.Replace("'", "''") + "'")) { throw 'Username escaping failed.' }
    if (-not $taskSql.Contains("N'" + $taskDisplayName.Replace("'", "''") + "'")) { throw 'Display name escaping failed.' }
    if ($taskSql.Contains($taskPassword) -or ($taskMessages -join '').Contains($taskPassword)) { throw 'Plaintext password leaked.' }
    if (-not $taskSql.Contains('WHERE Username = @Username') -or
        -not $taskSql.Contains('WITH (UPDLOCK, HOLDLOCK)') -or
        -not $taskSql.Contains('Username already exists') -or
        -not $taskSql.Contains('SET ARITHABORT ON;') -or
        -not $taskSql.Contains('SET NUMERIC_ROUNDABORT OFF;') -or
        $taskSql -notmatch 'SET NUMERIC_ROUNDABORT OFF;\r?\nGO\r?\n' -or
        -not $taskSql.Contains("N'AMYOU-YOGA7\V2008R2'") -or
        $taskSql.Contains('UPDATE wf.AppUser')) { throw 'SQL target/existing-account guards changed.' }
    $taskHashMatch = [regex]::Match($taskSql, '\$2b\$12\$[./A-Za-z0-9]{53}')
    if (-not $taskHashMatch.Success) { throw 'Missing cost-12 bcrypt hash.' }
    $taskCheck = @{ password = $taskPassword; hash = $taskHashMatch.Value; modulePath = $VerifyBcryptPath }
    $taskPayload = ConvertTo-Json $taskCheck -Compress
    $taskVerifyWorker = @'
const x = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
if (!require(x.modulePath).compareSync(x.password, x.hash)) process.exit(1);
'@
    [System.IO.File]::WriteAllText($taskVerifyInput, $taskPayload, (New-Object System.Text.UTF8Encoding($false)))
    node.exe -e $taskVerifyWorker $taskVerifyInput
    if ($LASTEXITCODE -ne 0) { throw 'Special-character password hash mismatch.' }
    Write-Output 'PASS: bcrypt matches Unicode/metacharacter password; SQL escapes names and contains no plaintext password.'

    $taskBefore = [System.IO.File]::ReadAllText($taskOutput)
    $taskOverlong = ([string][char]0x0E01) * 25 # 75 UTF-8 bytes, not 25 bytes.
    $taskRejected = $false
    try {
        & $taskGenerator -Username 'qa' -Password (ConvertTo-SecureString $taskOverlong -AsPlainText -Force) `
            -OutputPath $taskOutput 6>$null
    } catch {
        if ($_.Exception.Message -notlike '*72 UTF-8 bytes*') { throw }
        $taskRejected = $true
    }
    if (-not $taskRejected -or [System.IO.File]::ReadAllText($taskOutput) -cne $taskBefore) {
        throw 'Overlong password did not fail without changing the output file.'
    }
    $taskRejected = $false
    try { & $taskGenerator -Username ('a' * 51) -Password $taskSecure -OutputPath $taskOutput 6>$null }
    catch {
        if ($_.Exception.Message -notlike '*Username must contain*') { throw }
        $taskRejected = $true
    }
    if (-not $taskRejected) { throw 'Overlong username was accepted.' }
    Write-Output 'PASS: invalid inputs stop before output replacement; target and existing-account guards retained.'
    Write-Output 'DATABASE_CONNECTIONS=0'
} finally {
    if (Test-Path -LiteralPath $taskOutput) { Remove-Item -LiteralPath $taskOutput }
    if (Test-Path -LiteralPath $taskVerifyInput) { Remove-Item -LiteralPath $taskVerifyInput }
    $taskPassword = $null
    $taskPayload = $null
    $taskCheck = $null
    $taskSql = $null
}
