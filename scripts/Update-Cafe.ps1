$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
Set-Location $project

if (-not (Test-Path '.env')) { throw 'Cafe POS is not installed. Run Install-Cafe.cmd first.' }
if (-not (Test-Path '.git')) { throw 'This folder is not a Git checkout. Download the new Cafe POS version into this folder, then run Update-Cafe.cmd.' }

& (Join-Path $project 'Stop-Cafe.cmd') -NoPause
if ($LASTEXITCODE -ne 0) { throw 'Could not stop Cafe POS. Update cancelled.' }

git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'Could not fetch a clean update. Resolve local changes or update the source folder, then run Update-Cafe.cmd again.' }

npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency update failed. Cafe POS remains stopped.' }

npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed. Cafe POS remains stopped.' }

npm.cmd run db:init
if ($LASTEXITCODE -ne 0) { throw 'Database update failed. Cafe POS remains stopped.' }

& (Join-Path $project 'Start-Cafe.cmd')
if ($LASTEXITCODE -ne 0) { throw 'Update completed, but Cafe POS did not start. Check logs/server-error.log.' }
Write-Host 'Cafe POS updated and started. Refresh the cashier page on other devices.'
