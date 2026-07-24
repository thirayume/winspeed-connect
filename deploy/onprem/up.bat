@echo off
rem ============================================================
rem  up.bat - one-click install/start for WS-Sale-App (on-prem)
rem ============================================================
rem  Usage:
rem    up.bat                  install / start everything
rem    up.bat -Rebuild         rebuild images from scratch
rem    up.bat -SkipBootstrap   start only, do not touch the databases
rem    up.bat -Down            stop all containers (volumes are kept)
rem
rem  Requires: Docker Desktop running, and Git for Windows (for bash).
rem  A plain double-click is correct - no "Run as administrator" needed.
rem ============================================================
chcp 65001 >nul
title WS-Sale-App - On-Prem

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0up.ps1" %*

if errorlevel 1 pause
