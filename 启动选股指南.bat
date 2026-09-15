@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"

if exist "runtime\win-x64\node.exe" if exist "build\server.mjs" goto portable

where node >nul 2>nul
if errorlevel 1 goto missing
where npm >nul 2>nul
if errorlevel 1 goto missing
if not exist "node_modules" call npm ci
if errorlevel 1 goto failed
call npm run build:local
if errorlevel 1 goto failed
node "build\server.mjs"
if errorlevel 1 goto failed
exit /b 0

:portable
"runtime\win-x64\node.exe" "build\server.mjs"
if errorlevel 1 goto failed
exit /b 0

:missing
echo Please download the Windows portable ZIP from the project's Releases page.
echo It includes Node.js. Source checkouts require Node.js 22 or newer.
goto failed

:failed
echo The application could not start. See the message above.
pause
exit /b 1
