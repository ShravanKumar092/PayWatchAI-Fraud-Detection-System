# Stop API Server Script
Write-Host "=== Stopping PayWatch AI API Server ===" -ForegroundColor Yellow
Write-Host ""

# Find and stop processes on port 8021
$processes = Get-NetTCPConnection -LocalPort 8021 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess

if ($processes) {
    $processes | ForEach-Object { 
        Write-Host "Stopping process: $_" -ForegroundColor Yellow
        Stop-Process -Id $_ -Force
    }
    Write-Host ""
    Write-Host "Server stopped successfully!" -ForegroundColor Green
} else {
    Write-Host "No server found running on port 8021" -ForegroundColor Gray
}
