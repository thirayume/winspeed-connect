@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
call :load_config || exit /b 1

set "DB_TYPE=%~1"
set "LOCAL_FILE=%~2"
if /i not "%DB_TYPE%"=="mssql" if /i not "%DB_TYPE%"=="mysql" goto :usage
if "%LOCAL_FILE%"=="" goto :usage
if not exist "%LOCAL_FILE%" (
  echo ERROR: file not found: %LOCAL_FILE%
  exit /b 2
)
for %%F in ("%LOCAL_FILE%") do set "FILE_NAME=%%~nxF"

set "WF_LOCAL_FILE=%LOCAL_FILE%"
set "WF_FILE_NAME=%FILE_NAME%"
set "HASH_FILE=%TEMP%\%FILE_NAME%.sha256"
set "WF_HASH_FILE=%HASH_FILE%"
powershell -NoProfile -Command "$s=[IO.File]::OpenRead($env:WF_LOCAL_FILE); try{$a=[Security.Cryptography.SHA256]::Create(); try{$h=[BitConverter]::ToString($a.ComputeHash($s)).Replace('-','').ToLowerInvariant()}finally{$a.Dispose()}}finally{$s.Dispose()}; [IO.File]::WriteAllText($env:WF_HASH_FILE,($h+'  '+$env:WF_FILE_NAME+[Environment]::NewLine),[Text.Encoding]::ASCII)"
if errorlevel 1 exit /b 1

set "BATCH_FILE=%TEMP%\worldfert-sftp-%RANDOM%.txt"
>"%BATCH_FILE%" echo put "%LOCAL_FILE%" "/incoming/%DB_TYPE%/%FILE_NAME%.part"
>>"%BATCH_FILE%" echo rename "/incoming/%DB_TYPE%/%FILE_NAME%.part" "/incoming/%DB_TYPE%/%FILE_NAME%"
>>"%BATCH_FILE%" echo put "%HASH_FILE%" "/incoming/%DB_TYPE%/%FILE_NAME%.sha256.part"
>>"%BATCH_FILE%" echo rename "/incoming/%DB_TYPE%/%FILE_NAME%.sha256.part" "/incoming/%DB_TYPE%/%FILE_NAME%.sha256"
>>"%BATCH_FILE%" echo ls -l "/incoming/%DB_TYPE%/%FILE_NAME%"

echo Uploading %FILE_NAME% by direct SFTP to %SERVER_HOST%...
sftp -P %SSH_PORT% -i "%SFTP_KEY%" -o StrictHostKeyChecking=accept-new -b "%BATCH_FILE%" %SFTP_USER%@%SERVER_HOST%
set "RC=%errorlevel%"
del /q "%BATCH_FILE%" "%HASH_FILE%" >nul 2>&1
if not "%RC%"=="0" exit /b %RC%

echo.
echo UPLOAD OK. The file is staged only; no database was restored.
echo Next: run 04-restore-mssql.bat or 05-restore-mysql.bat with %FILE_NAME%.
exit /b 0

:usage
echo Usage: %~nx0 mssql C:\backup\database.bak[.gz]
echo    or: %~nx0 mysql C:\backup\database.sql[.gz]
exit /b 2

:load_config
if not exist "%SCRIPT_DIR%remote-config.bat" (
  echo ERROR: missing remote-config.bat
  exit /b 1
)
call "%SCRIPT_DIR%remote-config.bat"
exit /b 0
