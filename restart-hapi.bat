@echo off
echo Stopping HAPI...
taskkill /F /IM hapi.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Replacing hapi.exe...
copy /Y "cli\dist-exe-new\bun-windows-x64\hapi.exe" "cli\dist-exe\bun-windows-x64\hapi.exe"

echo Starting HAPI...
cd /d E:\dev\hapi
set HAPI_CLAUDE_PATH=C:\Users\Administrator\AppData\Roaming\npm\claude.cmd
set CORS_ORIGINS=*

start "" /B cmd /c "cli\dist-exe\bun-windows-x64\hapi.exe hub > hub.log 2>&1"
timeout /t 3 /nobreak >nul
cli\dist-exe\bun-windows-x64\hapi.exe runner start --workspace-root E:\dev

echo.
echo Done! Hub log: hub.log
