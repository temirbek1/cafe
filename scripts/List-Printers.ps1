$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$items = @(Get-Printer | ForEach-Object { @{name=$_.Name; port=$_.PortName; driver=$_.DriverName} })
ConvertTo-Json -InputObject $items -Compress
