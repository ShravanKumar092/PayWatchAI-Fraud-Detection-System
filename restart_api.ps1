# Restart API Server Script
Write-Host "=== Restarting PayWatch AI API Server ===" -ForegroundColor Green
Write-Host ""

# Stop any existing server on port 8021
Write-Host "Stopping any existing server on port 8021..." -ForegroundColor Yellow
$processes = Get-NetTCPConnection -LocalPort 8021 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess
if ($processes) {
    $processes | ForEach-Object { 
        Stop-Process -Id $_ -Force
        Write-Host "  Stopped process: $_" -ForegroundColor Gray
    }
} else {
    Write-Host "  No server found on port 8021" -ForegroundColor Gray
}

# Wait a moment
Write-Host "Waiting 2 seconds..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

# Ensure we're in the project root directory
Write-Host "Starting API server..." -ForegroundColor Yellow
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# Start the server from project root (this ensures all imports work correctly)
Write-Host ""
Write-Host "Server starting on http://127.0.0.1:8021" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Cyan
Write-Host ""
python -m uvicorn api.app:app --host 127.0.0.1 --port 8021

