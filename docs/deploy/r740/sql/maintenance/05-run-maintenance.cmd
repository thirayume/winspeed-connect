@echo off
rem Nightly database maintenance for R740-SRV\SQL2008 (Express has no SQL Agent).
rem Task Scheduler: daily 02:00, "Run whether user is logged on or not", a Windows account that is SQL Server
rem sysadmin. Windows login only (-E): never put a SQL password in this file.
set HERE=%~dp0
set LOGDIR=D:\SaleApp\maintenance-logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"') do set DAY=%%i
sqlcmd -S R740-SRV\SQL2008 -E -b -I -i "%HERE%04-nightly-maintenance.sql" >> "%LOGDIR%\maintenance-%DAY%.log" 2>&1
set RC=%ERRORLEVEL%
forfiles /p "%LOGDIR%" /m maintenance-*.log /d -30 /c "cmd /c del @path" 2>nul
exit /b %RC%
