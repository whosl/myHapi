@echo off
cd /d E:\dev\hapi
set HAPI_CLAUDE_PATH=C:\Users\Administrator\AppData\Roaming\npm\claude.cmd
set CORS_ORIGINS=*

REM Stop existing runner
cli\dist-exe\bun-windows-x64\hapi.exe runner stop 2>nul

REM Start hub in background
start "" /B cmd /c "cli\dist-exe\bun-windows-x64\hapi.exe hub > hub.log 2>&1"

REM Wait for hub to start
timeout /t 3 /nobreak >nul

REM Start runner with workspace root
cli\dist-exe\bun-windows-x64\hapi.exe runner start --workspace-root E:\dev
echo.
echo Done! Hub log: hub.log
