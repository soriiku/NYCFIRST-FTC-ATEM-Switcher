@echo off
title FTC ATEM Auto-Switcher
echo.
echo  ========================================
echo   FTC ATEM Auto-Switcher
echo  ========================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Node.js is not installed!
    echo.
    echo  Please install Node.js from:
    echo  https://nodejs.org/
    echo.
    echo  Download the LTS version, install it,
    echo  then double-click this file again.
    echo.
    pause
    exit /b 1
)

echo  Node.js found: 
node --version
echo.

:: Check if node_modules exists
if not exist "%~dp0node_modules" (
    echo  Installing dependencies...
    echo.
    cd /d "%~dp0"
    npm install
    echo.
)

echo  Starting switcher...
echo  Dashboard will open at http://localhost:3000
echo.
echo  Press Ctrl+C to stop
echo.

cd /d "%~dp0"
node src/index.js

pause
