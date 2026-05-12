# HAPI pm2 持久化启动脚本
# 用法: 在 PowerShell 中运行此脚本
#   .\start-pm2.ps1          # 首次启动（会停掉旧的非 pm2 HAPI 进程）
#   .\start-pm2.ps1 -SkipStop  # 不停旧进程，仅启动 pm2（调试用）

param(
    [switch]$SkipStop = $false
)

$ErrorActionPreference = 'Continue'
$HapiExe = 'E:\dev\hapi\cli\dist-exe\bun-windows-x64\hapi.exe'
$Config  = 'E:\dev\hapi\ecosystem.config.cjs'

# --- Step 0: 检查依赖 ---
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Error "pm2 not found. Install: npm install -g pm2"
    exit 1
}

if (-not (Test-Path $HapiExe)) {
    Write-Error "hapi.exe not found at $HapiExe"
    exit 1
}

if (-not (Test-Path $Config)) {
    Write-Error "ecosystem.config.cjs not found at $Config"
    exit 1
}

# --- Step 1: 停掉旧的非 pm2 HAPI 进程 ---
if (-not $SkipStop) {
    $existing = Get-Process hapi -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Stopping existing HAPI processes..." -ForegroundColor Yellow
        $existing | Stop-Process -Force
        Start-Sleep -Seconds 2
        Write-Host "  Stopped $($existing.Count) process(es)" -ForegroundColor Green
    } else {
        Write-Host "No existing HAPI processes found" -ForegroundColor Gray
    }
}

# --- Step 2: 停掉旧的 pm2 HAPI（如果有） ---
$pm2Running = pm2 jlist 2>$null | ConvertFrom-Json | Where-Object { $_.name -like 'hapi-*' }
if ($pm2Running) {
    Write-Host "Stopping old pm2 HAPI processes..." -ForegroundColor Yellow
    pm2 delete hapi-hub hapi-runner 2>$null
    Start-Sleep -Seconds 1
}

# --- Step 3: 启动 hub ---
Write-Host "Starting hapi-hub..." -ForegroundColor Cyan
pm2 start $Config --only hapi-hub
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start hapi-hub"
    exit 1
}

Write-Host "  Waiting for hub to initialize..." -ForegroundColor Gray
Start-Sleep -Seconds 3

# --- Step 4: 启动 runner ---
Write-Host "Starting hapi-runner..." -ForegroundColor Cyan
pm2 start $Config --only hapi-runner
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start hapi-runner"
    exit 1
}

Start-Sleep -Seconds 2

# --- Step 5: 保存 & 显示状态 ---
pm2 save
Write-Host ""
Write-Host "HAPI started with pm2!" -ForegroundColor Green
pm2 list

Write-Host ""
Write-Host "Common commands:" -ForegroundColor Cyan
Write-Host "  pm2 list                    # 查看状态"
Write-Host "  pm2 logs hapi-hub           # 查看 hub 日志"
Write-Host "  pm2 logs hapi-runner        # 查看 runner 日志"
Write-Host "  pm2 restart hapi-hub        # 重启 hub"
Write-Host "  pm2 restart hapi-runner     # 重启 runner"
Write-Host "  pm2 stop hapi-hub hapi-runner  # 停止所有"
Write-Host "  pm2 startup                 # 设置开机自启"
