@echo off
title FTC ATEM Switcher - DRY RUN
echo.
echo  ========================================
echo   FTC ATEM Auto-Switcher (DRY RUN)
echo  ========================================
echo  No ATEM commands will be sent.
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Node.js is not installed!
    echo  Please install from: https://nodejs.org/
    pause
    exit /b 1
)

if not exist "%~dp0node_modules" (
    echo  Installing dependencies...
    cd /d "%~dp0"
    npm install
    echo.
)

cd /d "%~dp0"
node src/index.js --dry-run

pause
