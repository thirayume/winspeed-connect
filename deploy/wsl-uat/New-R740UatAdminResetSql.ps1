[CmdletBinding()]
param(
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$taskPasswordPointer = [IntPtr]::Zero
$taskConfirmPointer = [IntPtr]::Zero
$taskPlainPassword = $null
$taskConfirmPassword = $null
$taskInputBytes = $null
$taskProcess = $null
$taskHashOutput = $null
$taskPasswordSecure = $null
$taskConfirmPasswordSecure = $null

try {
    $taskRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
    $taskPasswordSecure = Read-Host 'New UAT application password (input is hidden)' -AsSecureString
    $taskConfirmPasswordSecure = Read-Host 'Re-enter the new password (input is hidden)' -AsSecureString
    $taskConfirmPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskConfirmPasswordSecure)
    $taskConfirmPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskConfirmPointer)

    $taskPasswordPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskPasswordSecure)
    $taskPlainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPasswordPointer)
    if ([string]::IsNullOrEmpty($taskPlainPassword)) { throw 'Password cannot be empty.' }
    if ($null -ne $taskConfirmPassword -and
        -not [string]::Equals($taskPlainPassword, $taskConfirmPassword, [StringComparison]::Ordinal)) {
        throw 'The two hidden password entries did not match; no SQL file was written.'
    }
    if ($taskPlainPassword.Length -lt 12) { throw 'Choose a password with at least 12 characters.' }
    if ([System.Text.Encoding]::UTF8.GetByteCount($taskPlainPassword) -gt 72) {
        throw 'Password exceeds bcrypt limit of 72 UTF-8 bytes; choose a shorter password.'
    }

    # Send the password as JSON on stdin only; never put it in arguments, environment, or output.
    $taskWorker = @'
try {
  const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const bcrypt = require(input.modulePath);
  const hash = bcrypt.hashSync(input.password, 12);
  if (!bcrypt.compareSync(input.password, hash)) throw new Error('verification');
  process.stdout.write(hash);
} catch (_) {
  process.stderr.write('BCRYPT_GENERATION_FAILED');
  process.exitCode = 1;
}
'@
    $taskNode = Get-Command node.exe -ErrorAction SilentlyContinue
    $taskBcryptModule = Join-Path $taskRepoRoot 'backend\node_modules\bcrypt'
    if (-not $taskNode -or -not (Test-Path -LiteralPath (Join-Path $taskBcryptModule 'package.json'))) {
        throw 'Node.js with backend bcrypt dependencies is required to generate the SQL file.'
    }

    $taskPayload = @{ password = $taskPlainPassword; modulePath = $taskBcryptModule }
    $taskPayloadJson = ConvertTo-Json -InputObject $taskPayload -Compress
    $taskStartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $taskStartInfo.FileName = $taskNode.Source
    $taskEncodedWorker = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($taskWorker))
    $taskStartInfo.Arguments = '-e "eval(Buffer.from(''' + $taskEncodedWorker + ''',''base64'').toString())"'
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
    $taskInputBytes = [System.Text.Encoding]::UTF8.GetBytes($taskPayloadJson)
    $taskProcess.StandardInput.BaseStream.Write($taskInputBytes, 0, $taskInputBytes.Length)
    $taskProcess.StandardInput.Close()
    if (-not $taskProcess.WaitForExit(30000)) {
        $taskProcess.Kill()
        throw 'bcrypt generation timed out; no SQL file was written.'
    }
    $taskHashOutput = $taskOutputTask.GetAwaiter().GetResult()
    [void]$taskErrorTask.GetAwaiter().GetResult()
    if ($taskProcess.ExitCode -ne 0) { throw 'Could not generate bcrypt; no SQL file was written.' }
    $taskHash = $taskHashOutput.Trim()
    if ($taskHash -cnotmatch '^\$2b\$12\$[./A-Za-z0-9]{53}$') {
        throw 'Invalid bcrypt output; no SQL file was written.'
    }

    $taskSql = @"
-- Generated for the UAT app only. Contains a bcrypt verifier, not plaintext.
-- Run the whole file in a new SSMS query on R740-SRV\SQL2008.
USE [dbwins_worldfert9-uat];
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_WARNINGS ON;
SET ANSI_PADDING ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;
GO

DECLARE @Username nvarchar(50) = N'admin';
DECLARE @PasswordHash nvarchar(255) = N'$taskHash';

IF CONVERT(nvarchar(128), SERVERPROPERTY('ServerName')) <> N'R740-SRV\SQL2008'
   OR DB_NAME() <> N'dbwins_worldfert9-uat'
BEGIN
    RAISERROR(N'STOP: Wrong SQL Server or database.', 16, 1);
    RETURN;
END;

IF OBJECT_ID(N'wf.AppUser', N'U') IS NULL
   OR COL_LENGTH(N'wf.AppUser', N'PasswordHash') IS NULL
   OR COL_LENGTH(N'wf.AppUser', N'MustChangePassword') IS NULL
BEGIN
    RAISERROR(N'STOP: The UAT app user schema is unavailable.', 16, 1);
    RETURN;
END;

IF @@TRANCOUNT <> 0
BEGIN
    RAISERROR(N'STOP: Open a new query window without an existing transaction.', 16, 1);
    RETURN;
END;

BEGIN TRY
    BEGIN TRANSACTION;
    IF (SELECT COUNT(*) FROM wf.AppUser WITH (UPDLOCK, HOLDLOCK)
        WHERE Username = @Username AND Role = N'ADMIN' AND IsActive = 1) <> 1
        RAISERROR(N'STOP: Expected exactly one active ADMIN account; no password was changed.', 16, 1);

    UPDATE wf.AppUser
       SET PasswordHash = @PasswordHash,
           MustChangePassword = 1
     WHERE Username = @Username
       AND Role = N'ADMIN'
       AND IsActive = 1;

    IF @@ROWCOUNT <> 1
        RAISERROR(N'STOP: Expected one updated ADMIN account.', 16, 1);

    COMMIT TRANSACTION;
    SELECT Username, Role, IsActive, MustChangePassword
      FROM wf.AppUser
     WHERE Username = @Username;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    DECLARE @ErrorMessage nvarchar(4000);
    SET @ErrorMessage = ERROR_MESSAGE();
    RAISERROR(N'%s', 16, 1, @ErrorMessage);
END CATCH;
"@

    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        $OutputPath = Join-Path $PSScriptRoot 'sql\r740-uat-admin-reset.local.sql'
    }
    $taskFullOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
    [System.IO.File]::WriteAllText($taskFullOutputPath, $taskSql,
        (New-Object System.Text.UTF8Encoding($true)))
    Write-Host 'Created the local SQL reset file. No database changes were executed.'
    Write-Host $taskFullOutputPath
    Write-Host 'Run the whole file in SSMS only after confirming the server/database banner.'
} finally {
    if ($taskPasswordPointer -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPasswordPointer)
    }
    if ($taskConfirmPointer -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskConfirmPointer)
    }
    if ($null -ne $taskPasswordSecure) { $taskPasswordSecure.Dispose() }
    if ($null -ne $taskConfirmPasswordSecure) { $taskConfirmPasswordSecure.Dispose() }
    $taskPlainPassword = $null
    $taskConfirmPassword = $null
    $taskPayload = $null
    $taskPayloadJson = $null
    $taskHash = $null
    $taskSql = $null
    $taskHashOutput = $null
    if ($null -ne $taskInputBytes) { [Array]::Clear($taskInputBytes, 0, $taskInputBytes.Length) }
    if ($null -ne $taskProcess) { $taskProcess.Dispose() }
}
