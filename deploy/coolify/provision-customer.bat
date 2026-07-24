@echo off
rem ============================================================
rem  provision-customer.bat
rem  Double-click to run the new-customer install wizard.
rem ============================================================
rem  DO NOT right-click > "Run as administrator".
rem  Elevated ssh.exe cannot bind loopback ports on Windows.
rem ============================================================
chcp 65001 >nul
title WS-Sale-App - Provision Customer

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0provision-customer.ps1" %*

if errorlevel 1 pause
