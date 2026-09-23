<#
  Бере звук з петличного мікрофона і публікує його на локальний сервер.

  Приклад:
    .\start-mic.ps1 -Device "Мікрофон (USB Audio Device)" -Channel klas-5a

  Назву пристрою дивимось через .\list-devices.ps1
  Ключ -Slow додатково піднімає резервний AAC-потік для «повільного режиму».
#>

param(
  [Parameter(Mandatory = $true)][string]$Device,
  [string]$Channel = "klas-5a",
  [int]$Bitrate = 48,
  [string]$ServerHost = "127.0.0.1",
  [switch]$Slow
)

$ffmpeg = Join-Path $PSScriptRoot "..\bin\ffmpeg.exe"
if (-not (Test-Path $ffmpeg)) { $ffmpeg = "ffmpeg" }

# Легка обробка голосу: зріз низів, компресор проти перепадів, лімітер.
$filter = "highpass=f=90,acompressor=threshold=-18dB:ratio=3:attack=10:release=200,alimiter=limit=0.95"

Write-Host ""
Write-Host "  Мікрофон: $Device"
Write-Host "  Канал:    $Channel"
Write-Host "  Слухати:  http://<IP-сервера>:8080/listen.html?ch=$Channel"
if ($Slow) { Write-Host "  Резервний потік для iPhone: $Channel-slow (AAC/HLS)" }
Write-Host ""
Write-Host "Зупинити — Ctrl+C" -ForegroundColor DarkGray
Write-Host ""

# Обидва потоки веде один процес: мікрофон відкривається лише раз,
# і резервний AAC не розходиться з основним Opus.
$arguments = @(
  "-hide_banner", "-loglevel", "warning",
  "-f", "dshow", "-audio_buffer_size", "20", "-i", "audio=$Device",
  "-af", $filter,
  "-c:a", "libopus", "-b:a", "${Bitrate}k", "-ar", "48000", "-ac", "1",
  "-application", "voip", "-frame_duration", "20",
  "-f", "rtsp", "-rtsp_transport", "tcp", "rtsp://${ServerHost}:8554/$Channel"
)

if ($Slow) {
  # Safari не грає Opus у HLS, тому для iPhone поруч іде окремий AAC-потік.
  $arguments += @(
    "-af", $filter,
    "-c:a", "aac", "-b:a", "64k", "-ar", "48000", "-ac", "1",
    "-f", "rtsp", "-rtsp_transport", "tcp", "rtsp://${ServerHost}:8554/$Channel-slow"
  )
}

& $ffmpeg @arguments
