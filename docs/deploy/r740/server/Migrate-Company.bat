@echo off
setlocal EnableExtensions
rem One-click on R740-SRV: migrate a live company database (dbwins_worldfert9 or dbwins_worldfert2).
rem Usage:
rem   Migrate-Company.bat dbwins_worldfert9            apply (needs a fresh backup)
rem   Migrate-Company.bat dbwins_worldfert9 plan       read-only plan, no writes
rem BEFORE apply: take the backup in SSMS with sql\r740-company-backup-<db>.sql, and fill
rem D:\SaleApp\prod\config\.env.migrator.local with the wf_r740_prod_migrator password.
rem Migrations add only the wf schema; dbo data is never changed.
set "DB=%~1"
set "PHASE=%~2"
if "%DB%"=="" (
  echo Usage: Migrate-Company.bat dbwins_worldfert9^|dbwins_worldfert2 [plan]
  exit /b 2
)
if "%PHASE%"=="" set "PHASE=apply"
set "SH=/mnt/d/SaleApp/uat/app/docs/deploy/r740/migrate-company.sh"
if not exist "D:\SaleApp\uat\app\docs\deploy\r740\migrate-company.sh" (
  echo ERROR: migrate-company.sh not found. Deploy UAT once from the dev PC first.
  pause
  exit /b 2
)
echo Migrating %DB% (%PHASE%) ...
wsl.exe --distribution Ubuntu --user root --exec bash "%SH%" "%DB%" "%PHASE%"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo Migrate stopped with exit code %RC%.
pause
exit /b %RC%
