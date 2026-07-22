@echo off
echo ==========================================
echo Running Migrations on REMOTE Environment
echo ==========================================
set DB_MODE=remote
node run_migrations.js
pause
