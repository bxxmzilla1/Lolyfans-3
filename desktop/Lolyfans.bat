@echo off
setlocal
title Lolyfans Desktop

rem Run from this file's folder no matter where it was launched from.
cd /d "%~dp0"

rem First run (or after a fresh clone): install Electron once.
if not exist "node_modules\electron\dist\electron.exe" (
    echo Installing Lolyfans Desktop dependencies, this happens only once...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo npm install failed. Make sure Node.js is installed: https://nodejs.org
        pause
        exit /b 1
    )
)

rem Launch detached so this console window closes right away.
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0
