$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$startup=[Environment]::GetFolderPath('Startup')
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut((Join-Path $startup 'Cafe POS.lnk'))
$shortcut.TargetPath=Join-Path $project 'Start-Cafe.cmd'
$shortcut.WorkingDirectory=$project
$shortcut.Save()
Write-Host 'Cafe POS starts after this Windows user signs in. PostgreSQL must run as an automatic Windows service.'
