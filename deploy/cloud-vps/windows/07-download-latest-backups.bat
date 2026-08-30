@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "SCRIPT_DIR=%~dp0"
call :load_config || exit /b 1
if not exist "%DOWNLOAD_DIR%" mkdir "%DOWNLOAD_DIR%"

for %%D in (mssql mysql) do (
  set "LATEST="
  for /f "usebackq delims=" %%F in (`ssh -p %SSH_PORT% -i "%DEPLOY_KEY%" %DEPLOY_USER%@%SERVER_HOST% "ls -1t /srv/wf-transfer/outgoing/%%D/*.gz"`) do if not defined LATEST set "LATEST=%%F"
  if not defined LATEST (
    echo WARNING: no %%D backup found.
  ) else (
    for %%F in ("!LATEST!") do set "BASE=%%~nxF"
    set "BATCH_FILE=%TEMP%\worldfert-download-%%D-!RANDOM!.txt"
    >"!BATCH_FILE!" echo get "/outgoing/%%D/!BASE!" "%DOWNLOAD_DIR%\!BASE!"
    >>"!BATCH_FILE!" echo get "/outgoing/%%D/!BASE!.sha256" "%DOWNLOAD_DIR%\!BASE!.sha256"
    sftp -P %SSH_PORT% -i "%SFTP_KEY%" -o StrictHostKeyChecking=accept-new -b "!BATCH_FILE!" %SFTP_USER%@%SERVER_HOST%
    if errorlevel 1 exit /b 1
    del /q "!BATCH_FILE!" >nul 2>&1
    set "WF_DOWNLOADED=%DOWNLOAD_DIR%\!BASE!"
    set "WF_MANIFEST=%DOWNLOAD_DIR%\!BASE!.sha256"
    powershell -NoProfile -Command "$expected=((Get-Content -LiteralPath $env:WF_MANIFEST -Raw) -split '\s+')[0].ToLower(); $s=[IO.File]::OpenRead($env:WF_DOWNLOADED); try{$a=[Security.Cryptography.SHA256]::Create(); try{$actual=[BitConverter]::ToString($a.ComputeHash($s)).Replace('-','').ToLowerInvariant()}finally{$a.Dispose()}}finally{$s.Dispose()}; if($actual -ne $expected){Write-Error ('Checksum mismatch: '+$env:WF_DOWNLOADED); exit 1}else{Write-Host ('[OK] '+$env:WF_DOWNLOADED)}"
    if errorlevel 1 exit /b 1
  )
)
echo DOWNLOAD OK: %DOWNLOAD_DIR%
exit /b 0

:load_config
if not exist "%SCRIPT_DIR%remote-config.bat" (
  echo ERROR: missing remote-config.bat
  exit /b 1
)
call "%SCRIPT_DIR%remote-config.bat"
exit /b 0
