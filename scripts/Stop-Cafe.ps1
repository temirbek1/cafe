$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path 'logs/server-process.json')) {
  $port = 3000
  if (Test-Path '.env') {
    Get-Content '.env' | ForEach-Object { if ($_ -match '^PORT=(\d+)') { $port = [int]$Matches[1] } }
  }
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 3
  } catch {
    Write-Host 'Cafe POS is not running on its configured port. Nothing to stop.'
    exit 0
  }
  if ($health.app -ne 'cafe-pos' -or $health.status -ne 'ok') {
    throw "Port $port is in use, but the service is not Cafe POS. No process was stopped."
  }
  $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  $listenerId = if ($listener) { $listener.OwningProcess } else {
    $line = netstat.exe -ano -p tcp | Select-String -Pattern "^\s*TCP\s+\S+:$port\s+\S+\s+LISTENING\s+(\d+)\s*$" | Select-Object -First 1
    if ($line) { [int]$line.Matches[0].Groups[1].Value }
  }
  if (-not $listenerId) { throw "Cafe POS answered on port $port, but its process could not be identified. No process was stopped." }
  $process = Get-Process -Id $listenerId -ErrorAction SilentlyContinue
  if (-not $process -or $process.ProcessName -ne 'node') {
    throw "Cafe POS is responding, but the listener is not a Node process. No process was stopped."
  }
  try {
    Stop-Process -Id $process.Id -ErrorAction Stop
  } catch {
    throw "Windows refused to stop Cafe POS (PID $($process.Id)). Close it from the Windows account that started it, or run Stop-Cafe.cmd as Administrator."
  }
  Write-Host "Cafe POS server stopped (PID $($process.Id)). PostgreSQL is still running."
  exit 0
}
$record = Get-Content 'logs/server-process.json' -Raw | ConvertFrom-Json
$process = Get-Process -Id $record.id -ErrorAction SilentlyContinue
if ($process) {
  if ($process.ProcessName -ne 'node' -or $process.StartTime.ToUniversalTime().ToString('o') -ne $record.started) {
    throw 'The recorded process has changed. No process was stopped.'
  }
  Stop-Process -Id $process.Id -ErrorAction Stop
}
Remove-Item 'logs/server-process.json' -Force -ErrorAction SilentlyContinue
Write-Host 'Cafe POS server stopped. PostgreSQL is still running. Start again with Start-Cafe.cmd.'
