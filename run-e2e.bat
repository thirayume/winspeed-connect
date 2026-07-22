@echo off
echo ==================================================
echo WS-Sale-App : Automated E2E Test Runner
echo ==================================================

echo 1. Stopping stale background servers (Port 3000, 5173)...
call npm run predev

echo 2. Running SQL Seed Script (Test Data)...
sqlcmd -S .\SQLEXPRESS -U wf_owner -P "WfOwner_Strong#2026" -d dbwins_worldfert9 -i db-init\e2e-seed.sql -b
if errorlevel 1 (
    echo SQL Seed Failed. Proceeding anyway or check your SQL credentials.
)

echo 3. Starting App Servers...
start "WS-Sale-App Server" cmd /c "npm run dev"

echo Waiting for servers to start (10 seconds)...
timeout /t 10 /nobreak >nul

echo 4. Executing Playwright E2E Tests...
call npx playwright test

echo 5. Running SQL Cleanup Script...
sqlcmd -S .\SQLEXPRESS -U wf_owner -P "WfOwner_Strong#2026" -d dbwins_worldfert9 -i db-init\e2e-cleanup.sql

echo 6. Opening Test Report...
start playwright-report\index.html

echo Done!
pause
