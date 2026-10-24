@echo off
setlocal EnableExtensions
rem Sale-App deploy on R740-SRV (172.16.30.169), from this PC over SSH or on the server itself.
rem   deploy.bat uat              origin/uat  -> UAT  (https://172.16.30.169:8444)
rem   deploy.bat prod             origin/main -> PROD (https://172.16.30.169, after go-live)
rem   deploy.bat hotfix           UAT first, then PROD (PROD is skipped if UAT fails)
rem   add -PlanOnly to sync, check, build and plan only (no database writes)
rem See docs\deploy\r740\README.md. The BAT never reads or prints passwords.

if "%~1"=="" (
  echo Usage: deploy.bat uat^|prod^|hotfix [-PlanOnly]
  exit /b 2
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-r740.ps1" -Environment %*
set "DEPLOY_EXIT=%ERRORLEVEL%"
if not "%DEPLOY_EXIT%"=="0" echo Deploy stopped with exit code %DEPLOY_EXIT%.
pause
exit /b %DEPLOY_EXIT%
