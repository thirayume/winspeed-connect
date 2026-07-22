@echo off
echo =========================================
echo Running Migrations on LOCAL Environment
echo =========================================
set DB_MODE=local
node run_migrations.js
pause
