@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
call :load_config || exit /b 1
ssh -tt -p %SSH_PORT% -i "%DEPLOY_KEY%" %DEPLOY_USER%@%SERVER_HOST% "sudo %APP_ROOT%/app/deploy/cloud-vps/server/health-check.sh %APP_ROOT%/app"
exit /b %errorlevel%

:load_config
if not exist "%SCRIPT_DIR%remote-config.bat" (
  echo ERROR: missing remote-config.bat
  exit /b 1
)
call "%SCRIPT_DIR%remote-config.bat"
exit /b 0
