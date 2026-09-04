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
rem -- Purge stale sources before extracting -----------------------------
rem tar -xzf overwrites files but never DELETES files that are gone from
rem the source tree. Anything removed from the repo lingers on the server
rem forever, and if a stale file still imports something that no longer
rem exists, the container build fails even though it passes locally.
rem
rem Hit for real on 2026-09-04: WSSale-App/src/components/truckscale was
rem deleted from the repo, the stale copy on the VPS survived, and tsc
rem failed on imports that api.ts no longer exports.
rem
rem Purge only pure-source trees that the archive replaces in full.
rem NEVER purge deploy/ wholesale - it holds the protected .env file.
rem NOTE: ASCII comments only in .bat files. Thai text here corrupts how
rem cmd.exe parses the file and it starts executing garbage.
set "PURGE=%APP_ROOT%/app/WSSale-App/src"
set "PURGE=%PURGE% %APP_ROOT%/app/backend/routes"
set "PURGE=%PURGE% %APP_ROOT%/app/backend/services"
set "PURGE=%PURGE% %APP_ROOT%/app/backend/scripts"
set "PURGE=%PURGE% %APP_ROOT%/app/backend/tests"
set "PURGE=%PURGE% %APP_ROOT%/app/backend/migrations"

ssh -tt -p %SSH_PORT% -i "%DEPLOY_KEY%" %DEPLOY_USER%@%SERVER_HOST% "sudo mkdir -p %APP_ROOT%/app; sudo rm -rf %PURGE%; sudo tar -xzf /tmp/worldfert-release.tgz -C %APP_ROOT%/app; %ENV_INSTALL% sudo chown -R %DEPLOY_USER%:%DEPLOY_USER% %APP_ROOT%/app; sudo chmod 600 %APP_ROOT%/app/deploy/cloud-vps/.env; rm -f /tmp/worldfert-release.tgz; sudo chmod +x %APP_ROOT%/app/deploy/cloud-vps/server/*.sh; sudo %APP_ROOT%/app/deploy/cloud-vps/server/deploy-release.sh %APP_ROOT%/app"
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
