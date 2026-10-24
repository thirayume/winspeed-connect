[CmdletBinding()]
param(
    [string]$Username,
    [System.Security.SecureString]$Password,
    [string]$DisplayName = 'UAT Administrator',
    [string]$OutputPath,
    # Defaults are the local UAT2 target; docs/deploy/r740/New-R740AdminSql.ps1 passes R740 UAT.
    [ValidatePattern('^[A-Za-z0-9_-]{1,128}$')][string]$Database = 'dbwins_worldfert9_uat2',
    [ValidatePattern('^[A-Za-z0-9_-]{1,64}(\\[A-Za-z0-9_-]{1,64})?$')][string]$ServerName = 'AMYOU-YOGA7\V2008R2',
    [string]$BcryptModule,
    # Hash inside this running backend container of the WSL Ubuntu Docker engine (R740-SRV).
    [ValidatePattern('^[A-Za-z0-9_.-]{1,128}$')][string]$WslContainer
)

$ErrorActionPreference = 'Stop'
$taskPlainPassword = $null
$taskPayload = $null
$taskPasswordPointer = [IntPtr]::Zero
$taskProcess = $null
$taskInputBytes = $null
$taskInputEncoding = $null

try {
    $taskRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
    if (-not $PSBoundParameters.ContainsKey('Username')) {
        $Username = Read-Host 'Application username [admin]'
        if ([string]::IsNullOrWhiteSpace($Username)) { $Username = 'admin' }
    }
    if ([string]::IsNullOrWhiteSpace($Username) -or $Username.Length -gt 50) {
        throw 'Username must contain 1 to 50 characters.'
    }
    if ([string]::IsNullOrWhiteSpace($DisplayName) -or $DisplayName.Length -gt 100) {
        throw 'DisplayName must contain 1 to 100 characters.'
    }
    if ($null -eq $Password) {
        $Password = Read-Host 'New application password (input is hidden)' -AsSecureString
    }
    $taskPasswordPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
    $taskPlainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPasswordPointer)
    if ([string]::IsNullOrEmpty($taskPlainPassword)) { throw 'Password cannot be empty.' }
    if ([System.Text.Encoding]::UTF8.GetByteCount($taskPlainPassword) -gt 72) {
        throw 'Password exceeds bcrypt limit of 72 UTF-8 bytes; choose a shorter password.'
    }

    # Send credentials as JSON on standard input, never as command arguments or env vars.
    $taskWorker = @'
try {
  const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const bcrypt = require(input.modulePath || 'bcrypt');
  const hash = bcrypt.hashSync(input.password, 12);
  if (!bcrypt.compareSync(input.password, hash)) throw new Error('verification');
  process.stdout.write(hash);
} catch (_) {
  process.stderr.write('BCRYPT_GENERATION_FAILED');
  process.exitCode = 1;
}
'@
    $taskInput = @{ password = $taskPlainPassword }
    $taskNode = Get-Command node.exe -ErrorAction SilentlyContinue
    $taskBcryptModule = if ($BcryptModule) { $BcryptModule } else { Join-Path $taskRepoRoot 'backend\node_modules\bcrypt' }
    if ($WslContainer) {
        # wsl.exe --exec takes Windows-style arguments; pass the worker as one line.
        $taskExecutable = Join-Path $env:SystemRoot 'System32\wsl.exe'
        $taskArguments = '--distribution Ubuntu --user root --exec docker exec -i --workdir /app ' + $WslContainer +
            ' node -e "' + ($taskWorker -replace "`r?`n", ' ') + '"'
    } elseif ($taskNode -and (Test-Path -LiteralPath (Join-Path $taskBcryptModule 'package.json'))) {
        $taskInput.modulePath = $taskBcryptModule
        $taskExecutable = $taskNode.Source
        $taskArguments = '-e "' + $taskWorker + '"'
    } else {
        $taskDocker = Get-Command docker.exe -ErrorAction SilentlyContinue
        if (-not $taskDocker) { throw 'Node.js with backend dependencies or Docker Desktop is required.' }
        $taskExecutable = $taskDocker.Source
        $taskArguments = '--context desktop-linux exec -i --workdir /app web-saleapp-uat-backend-1 node -e "' + $taskWorker + '"'
    }
    $taskPayload = ConvertTo-Json -InputObject $taskInput -Compress
    # PowerShell 5.1 can still use ASCII for native pipelines in a child script.
    # Write UTF-8 bytes to stdin directly so non-ASCII passwords are never replaced.
    # .NET Framework writes the console input encoding's BOM into redirected stdin first,
    # which breaks JSON.parse when the console uses UTF-8 (code page 65001).
    $taskInputEncoding = [Console]::InputEncoding
    [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
    $taskStartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $taskStartInfo.FileName = $taskExecutable
    $taskStartInfo.Arguments = $taskArguments
    $taskStartInfo.UseShellExecute = $false
    $taskStartInfo.CreateNoWindow = $true
    $taskStartInfo.RedirectStandardInput = $true
    $taskStartInfo.RedirectStandardOutput = $true
    $taskStartInfo.RedirectStandardError = $true
    $taskProcess = New-Object System.Diagnostics.Process
    $taskProcess.StartInfo = $taskStartInfo
    [void]$taskProcess.Start()
    $taskOutputTask = $taskProcess.StandardOutput.ReadToEndAsync()
    $taskErrorTask = $taskProcess.StandardError.ReadToEndAsync()
    $taskInputBytes = [System.Text.Encoding]::UTF8.GetBytes($taskPayload)
    $taskProcess.StandardInput.BaseStream.Write($taskInputBytes, 0, $taskInputBytes.Length)
    $taskProcess.StandardInput.Close()
    if (-not $taskProcess.WaitForExit(30000)) {
        $taskProcess.Kill()
        throw 'bcrypt generation timed out; no SQL file was written.'
    }
    $taskHashOutput = $taskOutputTask.GetAwaiter().GetResult()
    [void]$taskErrorTask.GetAwaiter().GetResult()
    if ($taskProcess.ExitCode -ne 0) { throw 'Could not generate bcrypt. Ensure the UAT backend is running, or install local backend dependencies.' }
    $taskHash = $taskHashOutput.Trim()
    if ($taskHash -cnotmatch '^\$2b\$12\$[./A-Za-z0-9]{53}$') {
        throw 'Invalid bcrypt output; no SQL file was written.'
    }

    $taskUsernameLiteral = $Username.Replace("'", "''")
    $taskDisplayNameLiteral = $DisplayName.Replace("'", "''")
    $taskSql = @"
-- Generated locally for $Database on $ServerName. Run the whole file in SSMS as a SQL administrator.
-- Password is bcrypt, not plaintext. This creates an app account, not a SQL login.
-- Existing accounts are never reset. Change the password in the app profile after login.
USE [$Database];
SET NOCOUNT ON;
SET XACT_ABORT ON;
-- Required by SQL Server 2008 R2 filtered indexes on this table.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_WARNINGS ON;
SET ANSI_PADDING ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;
GO

DECLARE @Username nvarchar(50) = N'$taskUsernameLiteral';
DECLARE @PasswordHash nvarchar(255) = N'$taskHash';
DECLARE @DisplayName nvarchar(100) = N'$taskDisplayNameLiteral';

IF CONVERT(nvarchar(128), SERVERPROPERTY('ServerName')) <> N'$ServerName'
   OR DB_NAME() <> N'$Database'
BEGIN
    RAISERROR(N'STOP: Wrong SQL Server or database.', 16, 1);
    RETURN;
END;

IF OBJECT_ID(N'wf.AppUser', N'U') IS NULL
   OR COL_LENGTH(N'wf.AppUser', N'MustChangePassword') IS NULL
BEGIN
    RAISERROR(N'STOP: Complete the $Database migrations first.', 16, 1);
    RETURN;
END;

IF @@TRANCOUNT <> 0
BEGIN
    RAISERROR(N'STOP: Open a new query window without an existing transaction.', 16, 1);
    RETURN;
END;

BEGIN TRY
    BEGIN TRANSACTION;
    IF EXISTS (SELECT 1 FROM wf.AppUser WITH (UPDLOCK, HOLDLOCK) WHERE Username = @Username)
        RAISERROR(N'STOP: Username already exists; its password and role were not changed.', 16, 1);

    INSERT INTO wf.AppUser
        (Username, PasswordHash, DisplayName, Role, EmpId, IsActive, MustChangePassword)
    VALUES
        (@Username, @PasswordHash, @DisplayName, N'ADMIN', NULL, 1, 1);

    COMMIT TRANSACTION;
    SELECT Id, Username, DisplayName, Role, IsActive, MustChangePassword
    FROM wf.AppUser WHERE Username = @Username;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    DECLARE @ErrorMessage nvarchar(4000);
    SET @ErrorMessage = ERROR_MESSAGE();
    RAISERROR(N'%s', 16, 1, @ErrorMessage);
END CATCH;
"@
    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        $OutputPath = Join-Path $PSScriptRoot 'sql\local-uat2-create-admin.local.sql'
    }
    [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($OutputPath), $taskSql,
        (New-Object System.Text.UTF8Encoding($true)))
    Write-Host 'Created the SQL file. No database changes were executed.'
    Write-Host ([System.IO.Path]::GetFullPath($OutputPath))
    Write-Host 'Run the whole file in SSMS; then sign in using the username and password you entered.'
} finally {
    if ($taskPasswordPointer -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPasswordPointer)
    }
    $taskPlainPassword = $null
    $taskPayload = $null
    $taskInput = $null
    if ($null -ne $taskInputBytes) { [Array]::Clear($taskInputBytes, 0, $taskInputBytes.Length) }
    if ($null -ne $taskProcess) { $taskProcess.Dispose() }
    if ($null -ne $taskInputEncoding) { [Console]::InputEncoding = $taskInputEncoding }
}
