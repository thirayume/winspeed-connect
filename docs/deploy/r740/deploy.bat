@echo off
setlocal EnableExtensions
rem Sale-App deploy to R740-SRV (172.16.30.169) from this PC.
rem   deploy.bat uat              deploy origin/uat to UAT (https://172.16.30.169:8444)
rem   deploy.bat uat -PlanOnly    sync, check, build and plan only; no database writes
rem   deploy.bat prod             production stays disabled until go-live approval
rem See docs\deploy\r740\README.md. The BAT never reads or prints passwords.

if "%~1"=="" (
  echo Usage: deploy.bat uat [-PlanOnly]
  exit /b 2
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-r740.ps1" -Environment %*
set "DEPLOY_EXIT=%ERRORLEVEL%"
if not "%DEPLOY_EXIT%"=="0" echo Deploy stopped with exit code %DEPLOY_EXIT%.
pause
exit /b %DEPLOY_EXIT%
