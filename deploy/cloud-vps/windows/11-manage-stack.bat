@echo off
setlocal EnableExtensions
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Manage-WorldFert.ps1" %*
exit /b %errorlevel%
