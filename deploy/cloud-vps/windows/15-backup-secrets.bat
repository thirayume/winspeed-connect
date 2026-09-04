@echo off
rem =====================================================================
rem 15-backup-secrets.bat - encrypted backup of deploy/cloud-vps/.local-secrets
rem
rem WHY THIS EXISTS
rem   .local-secrets/ holds the ONLY copy of the Hostinger SSH deploy key,
rem   the SFTP key, CREDENTIALS.txt and the MSSQL CA certificate.
rem   It is gitignored on purpose, so git cannot restore it.
rem   If the folder is lost, PROD-B becomes unreachable permanently.
rem
rem   On 2026-09-04 remote-config.bat was destroyed by accident and could
rem   not be restored from git. The keys survived only by luck.
rem
rem WHAT IT DOES
rem   Creates ONE encrypted archive. Never writes plaintext outside the
rem   source folder. Refuses to run if it cannot encrypt.
rem
rem   Preferred: age (https://github.com/FiloSottile/age) - passphrase mode
rem   Fallback : 7-Zip with AES-256 and encrypted headers (-mhe=on)
rem
rem WHERE TO PUT THE RESULT
rem   NOT on this machine only. Copy it to at least one separate place:
rem   company file server, an offline USB drive, or the SFTP /outgoing
rem   folder on the VPS (which is itself backed up weekly).
rem
rem ASCII comments only - Thai text corrupts cmd.exe parsing.
rem =====================================================================
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "SRC=%SCRIPT_DIR%..\.local-secrets"
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul ^| find "="') do set "DT=%%I"
set "STAMP=%DT:~0,8%-%DT:~8,4%"
set "OUTDIR=%SCRIPT_DIR%..\..\..\..\secrets-backup"
set "BASE=worldfert-secrets-%STAMP%"

if not exist "%SRC%" (
  echo ERROR: source folder not found: %SRC%
  exit /b 2
)

if not exist "%OUTDIR%" mkdir "%OUTDIR%"

echo.
echo Source : %SRC%
echo Output : %OUTDIR%
echo.

rem ---- Preferred path: age ---------------------------------------------
where age >nul 2>&1
if not errorlevel 1 (
  echo Using age with a passphrase. You will be asked for it twice.
  echo Store that passphrase in your password manager, NOT next to the file.
  echo.
  tar -czf "%TEMP%\%BASE%.tgz" -C "%SRC%\.." ".local-secrets"
  if errorlevel 1 ( echo ERROR: tar failed & exit /b 1 )
  age -p -o "%OUTDIR%\%BASE%.tgz.age" "%TEMP%\%BASE%.tgz"
  set "RC=%errorlevel%"
  del /q "%TEMP%\%BASE%.tgz" >nul 2>&1
  if not "%RC%"=="0" ( echo ERROR: age encryption failed & exit /b 1 )
  echo.
  echo DONE: %OUTDIR%\%BASE%.tgz.age
  goto :verify
)

rem ---- Fallback: 7-Zip AES-256 with encrypted headers -------------------
set "SEVENZIP="
if exist "%ProgramFiles%\7-Zip\7z.exe" set "SEVENZIP=%ProgramFiles%\7-Zip\7z.exe"
if exist "%ProgramFiles(x86)%\7-Zip\7z.exe" set "SEVENZIP=%ProgramFiles(x86)%\7-Zip\7z.exe"

if defined SEVENZIP (
  echo age not found - using 7-Zip AES-256 with encrypted headers.
  echo You will be prompted for a password.
  echo.
  "%SEVENZIP%" a -t7z -mhe=on -p "%OUTDIR%\%BASE%.7z" "%SRC%\*"
  if errorlevel 1 ( echo ERROR: 7-Zip failed & exit /b 1 )
  echo.
  echo DONE: %OUTDIR%\%BASE%.7z
  goto :verify
)

echo ERROR: neither age nor 7-Zip is installed.
echo   Install one of them, then run this script again.
echo     age    : winget install FiloSottile.age
echo     7-Zip  : winget install 7zip.7zip
echo.
echo Refusing to write an unencrypted backup of private keys.
exit /b 3

:verify
echo.
echo NEXT STEPS - the backup is useless until it leaves this machine:
echo   1. Copy the file above to a second location
echo      (file server / offline USB / SFTP outgoing on the VPS).
echo   2. Save the passphrase in a password manager, separately.
echo   3. Test a restore once: decrypt into a temp folder and confirm
echo      worldfert-hostinger-deploy is present and works:
echo        ssh -i ^<restored key^> root@76.13.190.104 hostname
echo.
echo Do NOT commit the archive. secrets-backup/ sits outside the repo
echo on purpose so a stray "git add -A" cannot pick it up.
echo.
endlocal
