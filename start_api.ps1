# Start API Server Script
Write-Host "=== Starting PayWatch AI API Server ===" -ForegroundColor Green
Write-Host ""

# Prefer the local compatibility API on 8021 because Docker owns 8020/8080.
$apiPort = 8021

# Check if port is already in use
$existing = Get-NetTCPConnection -LocalPort $apiPort -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "WARNING: Port $apiPort is already in use!" -ForegroundColor Red
    Write-Host "Please stop the existing server first or use restart_api.ps1" -ForegroundColor Yellow
    Write-Host ""
    $response = Read-Host "Do you want to kill the existing process? (y/n)"
    if ($response -eq "y" -or $response -eq "Y") {
        $existing | Select-Object -ExpandProperty OwningProcess | ForEach-Object { 
            Stop-Process -Id $_ -Force
            Write-Host "Stopped process: $_" -ForegroundColor Gray
        }
        Start-Sleep -Seconds 2
    } else {
        Write-Host "Exiting..." -ForegroundColor Yellow
        exit
    }
}

# Ensure we're in the project root directory
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# Start the server from project root (this ensures all imports work correctly)
Write-Host "Server starting on http://127.0.0.1:$apiPort" -ForegroundColor Green
Write-Host "API Docs: http://127.0.0.1:$apiPort/docs" -ForegroundColor Cyan
Write-Host "Health Check: http://127.0.0.1:$apiPort/healthz" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host "Hot reload is disabled to avoid the Windows watchfiles descriptor crash." -ForegroundColor DarkGray
Write-Host ""
python -m uvicorn api.app:app --host 127.0.0.1 --port $apiPort

