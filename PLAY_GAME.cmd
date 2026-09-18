@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  start "" "%~dp0index.html"
  exit /b 0
)
set "MEME_WAR_PORT=4173"
node "%~dp0run-game.mjs"
if errorlevel 1 pause
exit /b 0
