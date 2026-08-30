@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
call :load_config || exit /b 1
set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=report"
set "DAYS=%~2"
if "%DAYS%"=="" set "DAYS=7"

if /I "%ACTION%"=="install" goto install
if /I "%ACTION%"=="collect" goto collect
if /I "%ACTION%"=="report" goto report
if /I "%ACTION%"=="stop" goto stop
echo Usage: %~nx0 [install [days]^|collect^|report^|stop]
exit /b 2

:install
ssh -tt -p %SSH_PORT% -i "%DEPLOY_KEY%" %DEPLOY_USER%@%SERVER_HOST% "sudo %APP_ROOT%/app/deploy/cloud-vps/server/pilot-monitor.sh install %DAYS%"
exit /b %errorlevel%

:collect
ssh -tt -p %SSH_PORT% -i "%DEPLOY_KEY%" %DEPLOY_USER%@%SERVER_HOST% "sudo %APP_ROOT%/app/deploy/cloud-vps/server/pilot-monitor.sh collect"
exit /b %errorlevel%

:report
ssh -tt -p %SSH_PORT% -i "%DEPLOY_KEY%" %DEPLOY_USER%@%SERVER_HOST% "sudo %APP_ROOT%/app/deploy/cloud-vps/server/pilot-monitor.sh report"
exit /b %errorlevel%

:stop
ssh -tt -p %SSH_PORT% -i "%DEPLOY_KEY%" %DEPLOY_USER%@%SERVER_HOST% "sudo %APP_ROOT%/app/deploy/cloud-vps/server/pilot-monitor.sh stop"
exit /b %errorlevel%

:load_config
if not exist "%SCRIPT_DIR%remote-config.bat" (
  echo ERROR: missing remote-config.bat
  exit /b 1
)
call "%SCRIPT_DIR%remote-config.bat"
exit /b 0
