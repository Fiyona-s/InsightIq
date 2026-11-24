# Windows version of scripts/demo.sh (NOT tested on Windows; the shell version is the tested one).
#   powershell -ExecutionPolicy Bypass -File scripts\demo.ps1          start
#   powershell -ExecutionPolicy Bypass -File scripts\demo.ps1 stop     stop
param([string]$Action = "start")
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Pointer = Join-Path $env:TEMP "insightiq-demo.last"
if ($Action -eq "stop") {
  if (-not (Test-Path $Pointer)) { Write-Host "Nothing to stop."; exit 0 }
  $Dir = Get-Content $Pointer
  foreach ($f in "api.pid", "web.pid") { $p = Join-Path $Dir $f; if (Test-Path $p) { Stop-Process -Id (Get-Content $p) -ErrorAction SilentlyContinue } }
  Write-Host "Stopped. Demo data folder: $Dir"; exit 0
}
Set-Location $Root
if (-not (Test-Path ".venv\Scripts\python.exe")) { python -m venv .venv; .venv\Scripts\pip install -r backend\requirements.txt }
if (-not (Test-Path "frontend\node_modules")) { Push-Location frontend; npm ci; Pop-Location }
$Dir = Join-Path $env:TEMP ("insightiq-demo." + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $Dir | Out-Null
Set-Content $Pointer $Dir
# AI settings are read from .env and passed on; never printed.
if (Test-Path ".env") {
  foreach ($line in Get-Content ".env") {
    if ($line -match '^(LLM_API_KEY|LLM_MODEL|LLM_BASE_URL|LLM_INPUT_USD_PER_MILLION|LLM_OUTPUT_USD_PER_MILLION)=(.+)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim('"', "'"), "Process") }
  }
}
$env:DATA_DIR = $Dir
$api = Start-Process -PassThru -WindowStyle Hidden -WorkingDirectory "$Root\backend" -FilePath "$Root\.venv\Scripts\python.exe" -ArgumentList "-m", "app.serve", "--host", "127.0.0.1", "--port", "8030"
$api.Id | Set-Content (Join-Path $Dir "api.pid")
$env:API_PROXY_TARGET = "http://127.0.0.1:8030"
$web = Start-Process -PassThru -WindowStyle Hidden -WorkingDirectory "$Root\frontend" -FilePath "npm.cmd" -ArgumentList "run", "dev", "--", "--host", "127.0.0.1", "--port", "5230", "--strictPort"
$web.Id | Set-Content (Join-Path $Dir "web.pid")
Start-Sleep -Seconds 12
Write-Host "InsightIQ is running: http://127.0.0.1:5230   (stop: scripts\demo.ps1 stop)"
Start-Process "http://127.0.0.1:5230"
