@echo off
rem Option B of 02-transaction-log.sql only: back up the PROD log every 30 minutes (Task Scheduler, Windows login
rem with SQL Server sysadmin; no password in this file). Keeps 3 days of log backups.
set BK=D:\MSSQL\MSSQL10_50.SQL2008\Backup
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set STAMP=%%i
sqlcmd -S R740-SRV\SQL2008 -E -b -Q "BACKUP LOG [dbwins_worldfert9] TO DISK = N'%BK%\dbwins_worldfert9_log_%STAMP%.trn' WITH CHECKSUM, INIT"
if errorlevel 1 exit /b 1
forfiles /p "%BK%" /m dbwins_worldfert9_log_*.trn /d -3 /c "cmd /c del @path" 2>nul
exit /b 0
