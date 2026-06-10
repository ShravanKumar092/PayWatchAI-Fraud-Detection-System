@echo off
echo ========================================
echo Stopping PayWatch AI API Server
echo ========================================
echo.

REM Find and kill process on port 8021
set FOUND=0
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8021 ^| findstr LISTENING 2^>nul') do (
    set FOUND=1
    echo Found process on port 8021: %%a
    taskkill /F /PID %%a >nul 2>&1
    if !errorlevel! == 0 (
        echo Process killed successfully.
    ) else (
        echo Warning: Could not kill process %%a. You may need admin rights.
    )
)

if %FOUND% == 0 (
    echo No process found on port 8021.
)

echo.
echo Checking for Python processes...
for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq python.exe" /FO LIST ^| findstr /C:"PID:"') do (
    echo Found Python process: %%a
    REM Optionally kill all Python processes (uncomment if needed)
    REM taskkill /F /PID %%a
)

echo.
echo Done!
echo.
pause

