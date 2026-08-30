@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
call :load_config || exit /b 1

set "SERVER_CONFIG=%SCRIPT_DIR%..\server\server-config.env"
set "PREPARE_SCRIPT=%SCRIPT_DIR%..\server\prepare-server.sh"
if not exist "%SERVER_CONFIG%" (
  echo ERROR: copy server-config.env.example to server-config.env and edit it.
  exit /b 2
)
for %%F in ("%PREPARE_SCRIPT%" "%DEPLOY_PUBLIC_KEY%" "%SFTP_PUBLIC_KEY%" "%BOOTSTRAP_KEY%") do (
  if not exist "%%~fF" (
    echo ERROR: missing %%~fF
    exit /b 2
  )
)

echo Uploading server preparation files...
scp -P %SSH_PORT% -i "%BOOTSTRAP_KEY%" "%PREPARE_SCRIPT%" "%SERVER_CONFIG%" "%DEPLOY_PUBLIC_KEY%" "%SFTP_PUBLIC_KEY%" %BOOTSTRAP_USER%@%SERVER_HOST%:/tmp/
if errorlevel 1 exit /b 1

for %%F in ("%SERVER_CONFIG%") do set "SERVER_CONFIG_NAME=%%~nxF"
for %%F in ("%DEPLOY_PUBLIC_KEY%") do set "DEPLOY_PUB_NAME=%%~nxF"
for %%F in ("%SFTP_PUBLIC_KEY%") do set "SFTP_PUB_NAME=%%~nxF"

echo Preparing Ubuntu, Docker, TLS and SFTP. Hostinger Firewall is configured separately.
ssh -tt -p %SSH_PORT% -i "%BOOTSTRAP_KEY%" %BOOTSTRAP_USER%@%SERVER_HOST% "sudo bash /tmp/prepare-server.sh /tmp/%SERVER_CONFIG_NAME% /tmp/%DEPLOY_PUB_NAME% /tmp/%SFTP_PUB_NAME%; rc=$?; rm -f /tmp/prepare-server.sh /tmp/%SERVER_CONFIG_NAME% /tmp/%DEPLOY_PUB_NAME% /tmp/%SFTP_PUB_NAME%; exit $rc"
exit /b %errorlevel%

:load_config
if not exist "%SCRIPT_DIR%remote-config.bat" (
  echo ERROR: copy remote-config.example.bat to remote-config.bat and edit it.
  exit /b 1
)
call "%SCRIPT_DIR%remote-config.bat"
exit /b 0
