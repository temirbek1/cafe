$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path 'logs/server-process.json')) {
  throw 'No server started by Start-Cafe.cmd was recorded. If started with npm start, stop that console with Ctrl+C.'
}
$record = Get-Content 'logs/server-process.json' -Raw | ConvertFrom-Json
$process = Get-Process -Id $record.id -ErrorAction SilentlyContinue
if ($process) {
  if ($process.ProcessName -ne 'node' -or $process.StartTime.ToUniversalTime().ToString('o') -ne $record.started) {
    throw 'The recorded process has changed. No process was stopped.'
  }
  Stop-Process -Id $process.Id -ErrorAction Stop
}
Remove-Item 'logs/server-process.json'
Write-Host 'Cafe POS server stopped. PostgreSQL is still running. Start again with Start-Cafe.cmd.'
