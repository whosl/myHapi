#!/bin/bash
cd /e/dev/hapi
EXE="./cli/dist-exe/bun-windows-x64/hapi.exe"
export HAPI_CLAUDE_PATH="C:\\Users\\Administrator\\AppData\\Roaming\\npm\\claude.cmd"
export CORS_ORIGINS="*"

# Stop existing runner
$EXE runner stop 2>/dev/null

# Start hub in background
nohup $EXE hub > hub.log 2>&1 &
sleep 3
HUB_PID=$(netstat -ano 2>/dev/null | grep ":3006.*LISTENING" | awk '{print $NF}' | head -1)
if [ -n "$HUB_PID" ]; then
    echo "Hub started (PID $HUB_PID)"
else
    echo "Hub failed to start. Check hub.log"
    exit 1
fi

# Start runner with workspace root
$EXE runner start --workspace-root /e/dev
echo "Runner started"
