$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
Set-Location $project
if (-not (Test-Path '.env') -or -not (Test-Path 'dist/index.html')) { throw 'Run scripts/Install-Cafe.ps1 first.' }
$port=3000
Get-Content '.env' | ForEach-Object {if ($_ -match '^PORT=(\d+)') {$port=[int]$Matches[1]}}
$url="http://localhost:$port"
function Test-Cafe {
  try { $health=Invoke-RestMethod "$url/health" -TimeoutSec 2; return $health.app -eq 'cafe-pos' -and $health.status -eq 'ok' } catch { return $false }
}
if (-not (Test-Cafe)) {
  New-Item -ItemType Directory -Force -Path 'logs' | Out-Null
  $node=(Get-Command node -ErrorAction Stop).Source
  $process=Start-Process -FilePath $node -ArgumentList 'src/server.js' -WorkingDirectory $project -WindowStyle Hidden -RedirectStandardOutput (Join-Path $project 'logs/server.log') -RedirectStandardError (Join-Path $project 'logs/server-error.log') -PassThru
  $ready=$false
  for ($i=0;$i -lt 30;$i++) { Start-Sleep -Seconds 1; if (Test-Cafe) {$ready=$true;break};if($process.HasExited){break} }
  if (-not $ready) {throw 'Cafe server did not start. Check logs/server-error.log and PostgreSQL service.'}
  @{id=$process.Id; started=$process.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content 'logs/server-process.json' -Encoding UTF8
}
$browsers=@("${env:ProgramFiles}\Google\Chrome\Application\chrome.exe","${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe","${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe")
$browser=$browsers | Where-Object {Test-Path $_} | Select-Object -First 1
if($browser){Start-Process $browser -ArgumentList "--app=$url","--start-maximized"}else{Start-Process $url}
