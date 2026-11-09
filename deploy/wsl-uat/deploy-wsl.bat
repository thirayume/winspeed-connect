@echo off
setlocal EnableExtensions

set "WSL_DISTRO=Ubuntu"
set "REPO_WIN="
for %%I in ("%~dp0..\..\..") do set "REPO_WIN=%%~fI"
set "SQL_SCRIPT=%REPO_WIN%\docs\deploy\onprem\sql\local-uat2-principals.sql"
set "MIGRATOR_ENV=%REPO_WIN%\.env.migrator.local"
set "MIGRATOR_TEMPLATE=%REPO_WIN%\docker.migrator.env.example"
set "ADMIN_GENERATOR=%REPO_WIN%\docs\deploy\onprem\New-Uat2AdminSql.ps1"

if not exist "%REPO_WIN%\docker-compose.yml" (
  echo ERROR: Repository root was not found next to this deploy script.
  pause
  exit /b 2
)

if not exist "%SQL_SCRIPT%" (
  echo ERROR: The UAT2 SQL setup file is missing:
  echo "%SQL_SCRIPT%"
  pause
  exit /b 2
)

:menu
echo.
echo ============================================================
echo Sale-App local UAT2 setup
echo Target: AMYOU-YOGA7\V2008R2 / dbwins_worldfert9_uat2
echo ============================================================
echo 1. Open the SQL principal setup file for manual use in SSMS
echo 2. Create or edit the local migrator settings file
echo 3. Deploy or redeploy the UAT2 stack and apply pending migrations
echo 4. Generate app administrator SQL from a username and password
echo 5. Exit
echo.
choice /c 12345 /n /m "Choose an option [1-5]: "
if errorlevel 5 exit /b 0
if errorlevel 4 goto :admin_setup
if errorlevel 3 goto :deploy
if errorlevel 2 goto :migrator_setup
if errorlevel 1 goto :sql_setup

:admin_setup
if not exist "%ADMIN_GENERATOR%" (
  echo ERROR: The app administrator SQL generator is missing.
  pause
  goto :menu
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ADMIN_GENERATOR%"
if errorlevel 1 (
  echo ERROR: App administrator SQL generation failed. No SQL was executed.
) else (
  echo Open docs\deploy\onprem\sql\local-uat2-create-admin.local.sql in SSMS and run the whole file.
)
pause
goto :menu

:migrator_setup
if not exist "%MIGRATOR_TEMPLATE%" (
  echo.
  echo ERROR: The migrator settings template is missing:
  echo "%MIGRATOR_TEMPLATE%"
  pause
  goto :menu
)
if not exist "%MIGRATOR_ENV%" (
  copy /y "%MIGRATOR_TEMPLATE%" "%MIGRATOR_ENV%" >nul
  if errorlevel 1 (
    echo.
    echo ERROR: Could not create the local migrator settings file.
    pause
    goto :menu
  )
  echo Created the Git-ignored local migrator settings file.
) else (
  echo Opening the existing local migrator settings file without replacing it.
)
echo.
echo Set ONPREM_MIGRATOR_USER to wf_local_uat_migrator.
echo Set ONPREM_MIGRATOR_PASSWORD to the same password assigned to that SQL login in SSMS.
echo Keep this password separate from the application login password. Do not share this file.
echo Save your changes and close Notepad before returning here.
start /wait "" notepad.exe "%MIGRATOR_ENV%"
pause
goto :menu

:sql_setup
echo.
echo Opening the SQL file in the registered .sql editor.
echo Connect to the pinned SQL instance as an administrator and run it manually.
echo This BAT does not execute SQL and does not set or display passwords.
start "" "%SQL_SCRIPT%"
pause
goto :menu

:deploy
where wsl.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Windows Subsystem for Linux ^(wsl.exe^) is unavailable.
  pause
  exit /b 2
)
where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Windows PowerShell ^(powershell.exe^) is unavailable.
  pause
  exit /b 2
)

echo WSL_STAGE=LIST_REGISTERED_DISTROS
echo Registered WSL distributions for this Windows account:
wsl.exe --list --quiet
if errorlevel 1 (
  echo ERROR: Could not list WSL distributions for this Windows account.
  pause
  exit /b 2
)
echo.
set /p "WSL_DISTRO=Enter the exact distro name from the list [Ubuntu]: "
if not defined WSL_DISTRO set "WSL_DISTRO=Ubuntu"

echo.
echo WSL_STAGE=LAUNCH_DEPLOY_COMMAND
echo Starting the deploy script in WSL distribution "%WSL_DISTRO%"...
echo Docker Desktop users: enable WSL Integration for this distro; do not select docker-desktop.
echo Pending migrations are planned, applied to the pinned UAT2 database, and verified before web services start.
powershell.exe -NoProfile -NonInteractive -Command "& wsl.exe --distribution $env:WSL_DISTRO --user root --cd $env:REPO_WIN --exec /bin/bash docs/deploy/onprem/wsl-deploy.sh; exit $LASTEXITCODE"
set "DEPLOY_EXIT=%ERRORLEVEL%"

if not "%DEPLOY_EXIT%"=="0" (
  echo.
  echo WSL_STAGE=DEPLOY_COMMAND_FAILED
  echo If WSL_STAGE=DEPLOY_SCRIPT_STARTED was not printed, WSL did not reach the deploy shell script.
  echo Deploy stopped or failed with exit code %DEPLOY_EXIT%.
)
pause
exit /b %DEPLOY_EXIT%
