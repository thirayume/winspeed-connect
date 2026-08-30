@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
call :load_config || exit /b 1
for %%I in ("%SCRIPT_DIR%..\..\..") do set "REPO_ROOT=%%~fI"
set "ENV_FILE=%REPO_ROOT%\deploy\cloud-vps\.env"
set "SYNC_ENV=0"
if /i "%~1"=="--sync-env" set "SYNC_ENV=1"

set "NEED_ENV=0"
ssh -p %SSH_PORT% -i "%DEPLOY_KEY%" %DEPLOY_USER%@%SERVER_HOST% "sudo test -f %APP_ROOT%/app/deploy/cloud-vps/.env"
if errorlevel 1 set "NEED_ENV=1"
if "%SYNC_ENV%"=="1" set "NEED_ENV=1"
if "%NEED_ENV%"=="1" if not exist "%ENV_FILE%" (
  echo ERROR: the VPS has no .env and local deploy\cloud-vps\.env is missing.
  exit /b 2
)

set "ARCHIVE=%TEMP%\worldfert-release-%RANDOM%.tgz"
echo Packaging application source...
tar -czf "%ARCHIVE%" --exclude=node_modules --exclude=.git --exclude=deliverables --exclude=backup --exclude=backend/.env --exclude=backend/.env.* --exclude=WSSale-App/.env --exclude=WSSale-App/.env.* --exclude=deploy/cloud-vps/.env --exclude=deploy/cloud-vps/.local-secrets --exclude=remote-config.bat --exclude=server-config.env -C "%REPO_ROOT%" backend WSSale-App deploy
if errorlevel 1 exit /b 1

echo Uploading release archive...
scp -P %SSH_PORT% -i "%DEPLOY_KEY%" "%ARCHIVE%" %DEPLOY_USER%@%SERVER_HOST%:/tmp/worldfert-release.tgz
if errorlevel 1 (
  del /q "%ARCHIVE%" >nul 2>&1
  exit /b 1
)

set "ENV_INSTALL="
if "%NEED_ENV%"=="1" (
  echo Uploading protected environment configuration...
  scp -P %SSH_PORT% -i "%DEPLOY_KEY%" "%ENV_FILE%" %DEPLOY_USER%@%SERVER_HOST%:/tmp/worldfert.env
  if errorlevel 1 (
    del /q "%ARCHIVE%" >nul 2>&1
    exit /b 1
  )
  set "ENV_INSTALL=sudo install -m 600 /tmp/worldfert.env %APP_ROOT%/app/deploy/cloud-vps/.env; rm -f /tmp/worldfert.env;"
)

echo Deploying remotely. Sudo may ask for a password.
ssh -tt -p %SSH_PORT% -i "%DEPLOY_KEY%" %DEPLOY_USER%@%SERVER_HOST% "sudo mkdir -p %APP_ROOT%/app; sudo tar -xzf /tmp/worldfert-release.tgz -C %APP_ROOT%/app; %ENV_INSTALL% sudo chown -R %DEPLOY_USER%:%DEPLOY_USER% %APP_ROOT%/app; sudo chmod 600 %APP_ROOT%/app/deploy/cloud-vps/.env; rm -f /tmp/worldfert-release.tgz; sudo chmod +x %APP_ROOT%/app/deploy/cloud-vps/server/*.sh; sudo %APP_ROOT%/app/deploy/cloud-vps/server/deploy-release.sh %APP_ROOT%/app"
set "RC=%errorlevel%"
del /q "%ARCHIVE%" >nul 2>&1
exit /b %RC%

rem By default, the protected .env on the VPS is preserved.
rem Use: 03-remote-deploy.bat --sync-env only for an intentional local-to-VPS replacement.

:load_config
if not exist "%SCRIPT_DIR%remote-config.bat" (
  echo ERROR: missing remote-config.bat
  exit /b 1
)
call "%SCRIPT_DIR%remote-config.bat"
exit /b 0
