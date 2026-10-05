Write-Host "Аудіовходи, які бачить ffmpeg:" -ForegroundColor Cyan
Write-Host ""

$ffmpeg = Join-Path $PSScriptRoot "..\bin\ffmpeg.exe"
if (-not (Test-Path $ffmpeg)) { $ffmpeg = "ffmpeg" }

& $ffmpeg -hide_banner -list_devices true -f dshow -i dummy
