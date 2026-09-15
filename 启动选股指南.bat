@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 18 or later, then run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required. Install Node.js 18 or later, then run this file again.
  pause
  exit /b 1
)

if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  echo A .env file was created. Set TUSHARE_TOKEN before starting the application.
  start "" notepad ".env"
  pause
  exit /b 0
)

if not exist "node_modules" (
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

start "" /B cmd /C "timeout /t 3 /nobreak >nul ^& start http://localhost:5173"
call npm run dev
