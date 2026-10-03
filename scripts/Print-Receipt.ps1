$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -AssemblyName System.Drawing
  $document = New-Object System.Drawing.Printing.PrintDocument
  $document.PrinterSettings.PrinterName = $payload.printer
  if (-not $document.PrinterSettings.IsValid) { throw 'Printer is unavailable in Windows.' }
  $document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  $document.DocumentName = 'Cafe POS receipt'
  $document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(8,8,8,8)
  $font = New-Object System.Drawing.Font('Consolas',9)
  $paperWidth = [int]($payload.width / 25.4 * 100)
  # Leave a short feed tail so the cutter clears the printed text before cutting.
  $printLines = @($payload.lines) + @(' ', ' ', ' ', ' ', ' ')
  $measure = $document.PrinterSettings.CreateMeasurementGraphics()
  try {
    $paperHeight = 16
    foreach ($line in $printLines) {
      $paperHeight += [Math]::Ceiling($measure.MeasureString([string]$line, $font, $paperWidth - 16).Height + 4)
    }
  } finally { $measure.Dispose() }
  # Keep short receipts short; long orders continue on additional pages.
  $document.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('Receipt', $paperWidth, [int][Math]::Max(150, [Math]::Min(1200, $paperHeight + 10)))
  $state = @{index=0; lines=$printLines}
  $document.add_PrintPage({
    param($sender,$event)
    $y = [single]$event.MarginBounds.Top
    $width = [single]$event.MarginBounds.Width
    while ($state.index -lt $state.lines.Count) {
      $line = [string]$state.lines[$state.index]
      $size = $event.Graphics.MeasureString($line,$font,[int]$width)
      $height = [single][Math]::Ceiling($size.Height + 4)
      if (($y+$height) -gt $event.MarginBounds.Bottom) { $event.HasMorePages=$true; return }
      $rectangle = New-Object System.Drawing.RectangleF([single]$event.MarginBounds.Left,$y,$width,$height)
      $event.Graphics.DrawString($line,$font,[System.Drawing.Brushes]::Black,$rectangle)
      $y += $height
      $state.index++
    }
    $event.HasMorePages=$false
  })
  $document.Print()
  $font.Dispose()
  $document.Dispose()
  '{"submitted":true}'
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
