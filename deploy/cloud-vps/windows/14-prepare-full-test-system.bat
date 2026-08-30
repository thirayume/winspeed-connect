@echo off
setlocal EnableExtensions
set "MSSQL_TEST_DB=%~1"
if not defined MSSQL_TEST_DB set "MSSQL_TEST_DB=dbwins_worldfert9_test"
set "MYSQL_TEST_DB=%~2"
if not defined MYSQL_TEST_DB set "MYSQL_TEST_DB=db_truckscale_test"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Deploy-TestStack.ps1" -Mode Full -MssqlTestDb "%MSSQL_TEST_DB%" -MysqlTestDb "%MYSQL_TEST_DB%"
exit /b %errorlevel%
