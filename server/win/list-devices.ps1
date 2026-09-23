# Показує точні назви аудіопристроїв Windows.
# Потрібну назву (в лапках, після "audio=") копіюємо в start-mic.ps1.

Write-Host "Аудіовходи, які бачить ffmpeg:" -ForegroundColor Cyan
Write-Host ""

$ffmpeg = Join-Path $PSScriptRoot "..\bin\ffmpeg.exe"
if (-not (Test-Path $ffmpeg)) { $ffmpeg = "ffmpeg" }

& $ffmpeg -hide_banner -list_devices true -f dshow -i dummy
