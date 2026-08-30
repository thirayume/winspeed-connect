@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
call :load_config || exit /b 1

set "MODE=%~1"
if not defined MODE set "MODE=all"
if /i not "%MODE%"=="all" if /i not "%MODE%"=="mssql" if /i not "%MODE%"=="mysql" goto :usage

set "MSSQL_TEST_DB=%~2"
if not defined MSSQL_TEST_DB set "MSSQL_TEST_DB=dbwins_worldfert9_test"
set "MYSQL_TEST_DB=%~3"
if not defined MYSQL_TEST_DB set "MYSQL_TEST_DB=db_truckscale_test"

echo.
echo WorldFert Production to Test database clone
echo   Mode         : %MODE%
echo   MSSQL target : %MSSQL_TEST_DB%
echo   MySQL target : %MYSQL_TEST_DB%
echo.
echo Running a read-only preflight first. No database will be changed...
ssh -tt -p %SSH_PORT% -i "%DEPLOY_KEY%" %DEPLOY_USER%@%SERVER_HOST% "sudo APP_DIR=%APP_ROOT%/app %APP_ROOT%/app/deploy/cloud-vps/server/clone-databases-to-test.sh %MODE% %MSSQL_TEST_DB% %MYSQL_TEST_DB% --dry-run"
if errorlevel 1 (
  echo ERROR: clone preflight failed. No database was changed.
  exit /b 1
)

echo.
echo WARNING: Production will NOT be replaced, but existing test target databases will be replaced.
echo Safety backups of existing test databases will be kept in SFTP /outgoing.
set /p "ANSWER=Type CLONE-TO-TEST to continue: "
if not "%ANSWER%"=="CLONE-TO-TEST" (
  echo Cancelled. No database was changed.
  exit /b 2
)

ssh -tt -p %SSH_PORT% -i "%DEPLOY_KEY%" %DEPLOY_USER%@%SERVER_HOST% "sudo APP_DIR=%APP_ROOT%/app %APP_ROOT%/app/deploy/cloud-vps/server/clone-databases-to-test.sh %MODE% %MSSQL_TEST_DB% %MYSQL_TEST_DB% --confirm-replace-test"
exit /b %errorlevel%

:usage
echo Usage: %~nx0 [all^|mssql^|mysql] [MSSQL_TEST_DB] [MYSQL_TEST_DB]
echo Example: %~nx0 all dbwins_worldfert9_test db_truckscale_test
echo Test database names must contain test, qa, uat or sandbox.
exit /b 2

:load_config
if not exist "%SCRIPT_DIR%remote-config.bat" (
  echo ERROR: missing remote-config.bat
  exit /b 1
)
call "%SCRIPT_DIR%remote-config.bat"
exit /b 0
