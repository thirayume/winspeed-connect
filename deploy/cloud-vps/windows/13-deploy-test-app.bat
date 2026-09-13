@echo off
setlocal EnableExtensions
set "MSSQL_TEST_DB=%~1"
if not defined MSSQL_TEST_DB set "MSSQL_TEST_DB=dbwins_worldfert9_test_v2"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Deploy-TestStack.ps1" -Mode App -MssqlTestDb "%MSSQL_TEST_DB%"
exit /b %errorlevel%
