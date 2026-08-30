@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
call :load_config || exit /b 1
set "BACKUP_NAME=%~1"
if "%BACKUP_NAME%"=="" (
  echo Usage: %~nx0 db_truckscale_YYYYMMDD.sql[.gz]
  exit /b 2
)
echo This will replace the MySQL database with: %BACKUP_NAME%
set /p "ANSWER=Type RESTORE-MYSQL to continue: "
if not "%ANSWER%"=="RESTORE-MYSQL" (
  echo Cancelled.
  exit /b 3
)
ssh -tt -p %SSH_PORT% -i "%DEPLOY_KEY%" %DEPLOY_USER%@%SERVER_HOST% "sudo APP_DIR=%APP_ROOT%/app %APP_ROOT%/app/deploy/cloud-vps/server/restore-mysql.sh /srv/wf-transfer/incoming/mysql/%BACKUP_NAME% --confirm-replace"
exit /b %errorlevel%

:load_config
if not exist "%SCRIPT_DIR%remote-config.bat" (
  echo ERROR: missing remote-config.bat
  exit /b 1
)
call "%SCRIPT_DIR%remote-config.bat"
exit /b 0
