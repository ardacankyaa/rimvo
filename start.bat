@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 goto failed
title RIMVO - localhost

where node >nul 2>nul
if errorlevel 1 goto missing_node
where npm.cmd >nul 2>nul
if errorlevel 1 goto missing_npm

call node -e "const v=process.versions.node.split('.').map(Number);if(!(v[0]>=24 || (v[0]===22 && v[1]>=13))){console.error('Node.js 24+ or 22.13+ (22.x) is required.');process.exit(1)}"
if errorlevel 1 goto failed

rem Reinstall when dependencies are missing or package-lock.json changed after the last install.
call node -e "const fs=require('fs');try{fs.statSync('node_modules/vite/bin/vite.js');process.exit(fs.statSync('package-lock.json').mtimeMs>fs.statSync('node_modules/.package-lock.json').mtimeMs?1:0)}catch{process.exit(1)}"
if not errorlevel 1 goto launch
echo Installing project dependencies from package-lock.json...
call npm ci --no-audit --no-fund
if errorlevel 1 goto failed

:launch
echo Opening RIMVO at http://localhost:5173
echo Keep this window open. Press Ctrl+C to stop the local server.
call npm run dev -- --open
if errorlevel 1 goto failed
exit /b 0

:missing_node
echo Node.js 24+ or 22.13+ (22.x) is required. Install Node.js, then double-click start.bat again.
goto failed

:missing_npm
echo npm was not found. Repair your Node.js installation, then try again.
goto failed

:failed
echo RIMVO could not start. Check the message above.
echo If port 5173 is in use, stop the other server or use its existing browser tab.
pause
exit /b 1
