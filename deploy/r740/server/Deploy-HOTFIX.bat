@echo off
setlocal EnableExtensions
rem One-click on R740-SRV: deploy a hotfix to UAT, then PROD (after "3. Hotfix" in GitHub Actions).
rem PROD is skipped if UAT fails or is stopped. Each environment asks for its own confirmation.
rem Keep this file in D:\SaleApp; add -PlanOnly to stop before any database write.
set "DRIVER=D:\SaleApp\uat\app\docs\deploy\r740\deploy-r740.ps1"
if not exist "%DRIVER%" (
  echo ERROR: %DRIVER% was not found. Deploy UAT once from the dev PC with deploy.bat uat.
  pause
  exit /b 2
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%DRIVER%" -Environment hotfix -OnServer %*
set "DEPLOY_EXIT=%ERRORLEVEL%"
if not "%DEPLOY_EXIT%"=="0" echo Deploy stopped with exit code %DEPLOY_EXIT%.
pause
exit /b %DEPLOY_EXIT%
