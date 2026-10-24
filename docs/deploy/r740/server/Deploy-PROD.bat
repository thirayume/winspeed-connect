@echo off
setlocal EnableExtensions
rem One-click on R740-SRV: deploy origin/main to PROD (https://172.16.30.169).
rem Keep this file in D:\SaleApp. PROD stays refused until the go-live commit enables it; with
rem pending migrations it also needs the pre-deploy backup (sql\r740-prod-backup.sql).
rem It runs deploy-r740.ps1 from the UAT clone; add -PlanOnly to stop before any database write.
set "DRIVER=D:\SaleApp\uat\app\docs\deploy\r740\deploy-r740.ps1"
if not exist "%DRIVER%" (
  echo ERROR: %DRIVER% was not found. Deploy UAT once from the dev PC with deploy.bat uat.
  pause
  exit /b 2
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%DRIVER%" -Environment prod -OnServer %*
set "DEPLOY_EXIT=%ERRORLEVEL%"
if not "%DEPLOY_EXIT%"=="0" echo Deploy stopped with exit code %DEPLOY_EXIT%.
pause
exit /b %DEPLOY_EXIT%
