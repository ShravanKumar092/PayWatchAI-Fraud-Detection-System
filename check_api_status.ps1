# PowerShell script to check API server status
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "PayWatch AI API Server Status Check" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if port 8020 is in use
$port = 8020
$connection = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue

if ($connection) {
    $pid = $connection.OwningProcess
    $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
    
    Write-Host "✅ API Server is RUNNING" -ForegroundColor Green
    Write-Host "   Port: $port" -ForegroundColor White
    Write-Host "   Process ID: $pid" -ForegroundColor White
    if ($process) {
        Write-Host "   Process Name: $($process.ProcessName)" -ForegroundColor White
        Write-Host "   Started: $($process.StartTime)" -ForegroundColor White
    }
    
    # Test if API is responding
    Write-Host ""
    Write-Host "Testing API health endpoint..." -ForegroundColor Cyan
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:8020/health" -TimeoutSec 3 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Host "✅ API is responding correctly" -ForegroundColor Green
            $health = $response.Content | ConvertFrom-Json
            Write-Host "   Status: $($health.status)" -ForegroundColor White
            Write-Host "   Service: $($health.service)" -ForegroundColor White
        }
    } catch {
        Write-Host "⚠️  API is running but not responding to health checks" -ForegroundColor Yellow
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "❌ API Server is NOT RUNNING" -ForegroundColor Red
    Write-Host "   Port $port is not in use" -ForegroundColor White
    Write-Host ""
    Write-Host "To start the server, run:" -ForegroundColor Yellow
    Write-Host "   .\start_api.bat" -ForegroundColor Cyan
    Write-Host "   OR" -ForegroundColor Yellow
    Write-Host "   python -m uvicorn api.app:app --host 127.0.0.1 --port 8020 --reload" -ForegroundColor Cyan
}

Write-Host ""

