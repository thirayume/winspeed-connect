@echo off
setlocal EnableExtensions
set "FAILED=0"
for %%C in (ssh.exe scp.exe sftp.exe tar.exe curl.exe powershell.exe) do (
  where %%C >nul 2>&1
  if errorlevel 1 (
    echo [MISSING] %%C
    set "FAILED=1"
  ) else (
    echo [OK] %%C
  )
)
if "%FAILED%"=="1" (
  echo.
  echo Install Windows OpenSSH Client and retry.
  exit /b 1
)
echo.
echo Prerequisites OK.
exit /b 0

