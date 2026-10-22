@echo off
setlocal EnableExtensions

set "REPO_WIN="
for %%I in ("%~dp0..\..\..") do set "REPO_WIN=%%~fI"

if not exist "%REPO_WIN%\docker-compose.yml" (
  echo ERROR: Repository root was not found next to this deploy script.
  pause
  exit /b 2
)

where wsl.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Windows Subsystem for Linux ^(wsl.exe^) is unavailable.
  pause
  exit /b 2
)

set "REPO_WSL="
for /f "usebackq delims=" %%P in (`wsl.exe --exec wslpath -a "%REPO_WIN%" 2^>nul`) do set "REPO_WSL=%%P"
if not defined REPO_WSL (
  echo ERROR: Could not translate the repository path into WSL.
  echo Check that the default WSL distribution is installed and running.
  pause
  exit /b 2
)

echo Deploying the UAT clone stack through the default WSL distribution...
wsl.exe --exec bash "%REPO_WSL%/docs/deploy/onprem/wsl-deploy.sh"
set "DEPLOY_EXIT=%ERRORLEVEL%"

if not "%DEPLOY_EXIT%"=="0" (
  echo.
  echo Deploy stopped or failed with exit code %DEPLOY_EXIT%.
)
pause
exit /b %DEPLOY_EXIT%
