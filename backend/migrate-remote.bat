@echo off
cd /d "%~dp0"
node scripts/migrate-targets.js --targets remote_b
exit /b %errorlevel%
