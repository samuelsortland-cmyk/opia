@echo off
rem Double-click to start Opia 5.5. The first time, it installs what Opia needs (about a minute).
title Opia 5.5
cd /d "%~dp0"

if exist "node_modules\electron\dist\electron.exe" goto run

where npm >nul 2>nul
if errorlevel 1 (
  echo Opia needs Node.js first. Install the LTS version from https://nodejs.org , then double-click this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
echo Setting up Opia for the first time (this takes a minute)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo Setup failed. Send the messages above to whoever helps you with Opia.
  pause
  exit /b 1
)

:run
rem Start Opia without keeping this window open. If Opia is already running, this opens its panel.
start "" "node_modules\electron\dist\electron.exe" "%~dp0."
exit /b 0
