# Sky Fury - Run the game
# Uses port 8080 (not 3000)
$port = 8080
$url = "http://localhost:$port"

Write-Host "Starting Sky Fury on $url" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

# Start server in current window so you see it running
Set-Location $PSScriptRoot
python -m http.server $port
