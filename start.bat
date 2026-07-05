@echo off
title Xianyu Monitor

echo ========================================
echo   Xianyu Shop Monitor
echo ========================================
echo.

:: 1. Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js not found. Install from nodejs.org
    pause
    exit /b 1
)

:: 2. Install dependencies
if not exist "node_modules\ws" (
    echo Installing dependencies...
    call npm install --no-audit --no-fund
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
)

:: 3. Start server (it will auto-launch Chrome)
echo.
echo Starting service...
echo Open http://localhost:3000 in your browser
echo.

node server.mjs

pause
