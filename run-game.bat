@echo off
cd /d "%~dp0"
echo Starting Sky Fury on http://localhost:5500
echo.
echo Opening browser... Press Ctrl+C to stop the server
echo.
start http://localhost:5500
npx --yes http-server -p 5500 -c-1
pause
