@echo off
rem ============================================================
rem  tunnel.bat - double-click to open the SSH tunnel to the
rem               Coolify/Hetzner databases (SQL Server + MySQL)
rem ============================================================
rem  DO NOT right-click > "Run as administrator".
rem  Elevated ssh.exe cannot bind loopback ports on Windows:
rem      bind [127.0.0.1]:14330: Permission denied
rem  A plain double-click is correct.
rem ============================================================
chcp 65001 >nul
title WF SSH Tunnel

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tunnel.ps1" %*

rem keep the window open if PowerShell exited with an error
if errorlevel 1 pause
