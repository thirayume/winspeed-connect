@echo off
setlocal EnableExtensions
rem ======================================================================
rem  Install-SaleAppCert.bat - trust the Sale-App HTTPS certificate (R740-SRV) on this PC.
rem  One click: double-click it in S:\SaleAppCert, next to caddy-root.crt.
rem  It asks for administrator rights once (UAC), checks the file against the pinned
rem  SHA-256 fingerprint, then runs: certutil -addstore -f Root caddy-root.crt
rem  Safe to run again. Close and reopen the browser afterwards.
rem  Remove later: certutil -delstore Root 4149091EFC2B2C0DBB03FA1136FFC1C45ECF5D63
rem ======================================================================
set "PIN_SHA256=372F32028D78F537D652F300E3650F5D3D3CBAFF207FB8D9A8ED86DAF31D0FA8"

if /i "%~1"=="--elevated" goto :install

rem 1. Find the certificate: next to this file, then the shared folder, or a path argument.
set "CERT_SRC=%~1"
if not defined CERT_SRC set "CERT_SRC=%~dp0caddy-root.crt"
if not exist "%CERT_SRC%" set "CERT_SRC=S:\SaleAppCert\caddy-root.crt"
if not exist "%CERT_SRC%" (
  echo ERROR: caddy-root.crt was not found next to this file or in S:\SaleAppCert.
  pause
  exit /b 2
)

rem 2. An elevated window cannot see mapped drives such as S:, so copy this file and
rem    the certificate to a folder only this user can change, then elevate that copy.
set "WORK=%LOCALAPPDATA%\SaleAppCert"
if not exist "%WORK%" mkdir "%WORK%"
copy /y "%CERT_SRC%" "%WORK%\caddy-root.crt" >nul || (echo ERROR: could not copy the certificate to %WORK%. & pause & exit /b 2)
copy /y "%~f0" "%WORK%\Install-SaleAppCert.bat" >nul || (echo ERROR: could not copy the installer to %WORK%. & pause & exit /b 2)

fltmc >nul 2>&1
if not errorlevel 1 goto :install_here
echo Asking for administrator rights ...
powershell -NoProfile -Command "Start-Process -FilePath '%WORK%\Install-SaleAppCert.bat' -ArgumentList ('--elevated', [char]34 + '%WORK%' + [char]34) -Verb RunAs"
if errorlevel 1 (
  echo ERROR: administrator rights were not granted; nothing was installed.
  pause
  exit /b 5
)
exit /b 0

:install_here
set "ELEVATED_DIR=%WORK%"
goto :check

:install
set "ELEVATED_DIR=%~2"

:check
fltmc >nul 2>&1
if errorlevel 1 (
  echo ERROR: administrator rights are required.
  pause
  exit /b 5
)
set "CERT_LOCAL=%ELEVATED_DIR%\caddy-root.crt"
if not exist "%CERT_LOCAL%" (
  echo ERROR: %CERT_LOCAL% is missing.
  pause
  exit /b 2
)

rem 3. Trust nothing until the fingerprint matches. Exit 10 = already installed.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2('%CERT_LOCAL%'); $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($c.RawData)).Replace('-',''); if ($h -ne '%PIN_SHA256%') { Write-Host ('This file has SHA-256 ' + $h); exit 3 }; if (Test-Path ('Cert:\LocalMachine\Root\' + $c.Thumbprint)) { exit 10 }; exit 0"
if errorlevel 10 goto :already
if errorlevel 3 goto :mismatch
if errorlevel 1 goto :unreadable

certutil -addstore -f Root "%CERT_LOCAL%"
if errorlevel 1 (
  echo ERROR: certutil failed; the certificate was not installed.
  pause
  exit /b 6
)
echo.
echo Installed. Close and reopen the browser, then open https://172.16.30.169:8444
goto :done

:already
echo The Sale-App certificate is already trusted on this PC. Nothing to do.
goto :done

:mismatch
echo ERROR: this caddy-root.crt is NOT the approved Sale-App certificate.
echo Expected SHA-256 %PIN_SHA256%
echo Nothing was installed. Please tell IT.
pause
exit /b 3

:unreadable
echo ERROR: the certificate file could not be read. Nothing was installed.
pause
exit /b 4

:done
pause
exit /b 0
