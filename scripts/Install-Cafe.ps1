param([int]$Port=3000)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22.12+ LTS first: https://nodejs.org/' }
$version=[Version]((node --version).TrimStart('v'))
if ($version -lt [Version]'22.12.0') { throw 'Node.js 22.12+ is required.' }
if (-not (Test-Path '.env')) {
  Write-Host 'PostgreSQL connection. Defaults: localhost:5432, database cafe, user postgres.'
  $dbHost=Read-Host 'PostgreSQL host [localhost]'; if (-not $dbHost) {$dbHost='localhost'}
  $dbPort=Read-Host 'PostgreSQL port [5432]'; if (-not $dbPort) {$dbPort='5432'}
  $dbName=Read-Host 'Database name [cafe]'; if (-not $dbName) {$dbName='cafe'}
  $dbUser=Read-Host 'PostgreSQL user [postgres]'; if (-not $dbUser) {$dbUser='postgres'}
  if ($dbHost -notmatch '^[a-zA-Z0-9.-]+$' -or $dbPort -notmatch '^\d+$' -or $dbName -notmatch '^[a-zA-Z][a-zA-Z0-9_]{0,62}$') {throw 'Invalid database host, port or name.'}
  $securePassword=Read-Host 'PostgreSQL password' -AsSecureString
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {$plainPassword=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
  $dbUrl='postgres://'+[Uri]::EscapeDataString($dbUser)+':'+[Uri]::EscapeDataString($plainPassword)+'@'+$dbHost+':'+$dbPort+'/'+$dbName
  $plainPassword=$null
  $bytes=New-Object byte[] 48
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create();$rng.GetBytes($bytes);$rng.Dispose()
  $secret=([BitConverter]::ToString($bytes)).Replace('-','').ToLower()
  $content="PORT=$Port`nHOST=0.0.0.0`nDATABASE_URL=$dbUrl`nJWT_SECRET=$secret`nCOOKIE_SECURE=false`n"
  [IO.File]::WriteAllText((Join-Path (Get-Location) '.env'),$content,(New-Object Text.UTF8Encoding($false)))
  $dbUrl=$null;$secret=$null;$content=$null
}
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
npm.cmd run db:init
if ($LASTEXITCODE -ne 0) { throw 'Database setup failed. Check PostgreSQL service and credentials.' }
Write-Host 'Installation complete. Start with Start-Cafe.cmd. Create the administrator at http://localhost:3000.'
Write-Host 'For phones: configure the POS as a private network and permit TCP 3000 from the local subnet only. See README.'
