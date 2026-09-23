<#
  Бере звук з петличного мікрофона і публікує його на локальний сервер.

  Приклад:
    .\start-mic.ps1 -Device "Мікрофон (USB Audio Device)" -Channel klas-5-1

  Назву пристрою дивимось через .\list-devices.ps1
  Ключ -Slow додатково піднімає резервний AAC-потік для «повільного режиму».
#>

param(
  [Parameter(Mandatory = $true)][string]$Device,
  [string]$Channel = "klas-5-1",
  [int]$Bitrate = 48,
  [string]$ServerHost = "127.0.0.1",
  [int]$WebPort = 8080,
  [switch]$Slow
)

. (Join-Path $PSScriptRoot "lib.ps1")

$ffmpeg = Join-Path $PSScriptRoot "..\bin\ffmpeg.exe"
if (-not (Test-Path $ffmpeg)) { $ffmpeg = "ffmpeg" }

# Легка обробка голосу: зріз низів, компресор проти перепадів, лімітер.
$filter = "highpass=f=90,acompressor=threshold=-18dB:ratio=3:attack=10:release=200,alimiter=limit=0.95"

$info      = Get-ChannelInfo -Channel $Channel
$addresses = @(Get-ServerAddresses)

Write-Host ""
if ($info) {
  Write-Host ("  Клас:     {0}   ({1})" -f $info.name, $info.room)
} else {
  # Друкарська помилка в назві каналу інакше помітна лише посеред уроку.
  Write-Host "  Каналу '$Channel' немає у web\channels.json." -ForegroundColor Yellow
  Write-Host "  У списку на телефоні він не з'явиться - тільки за прямим посиланням." -ForegroundColor Yellow
}
Write-Host "  Мікрофон: $Device"
Write-Host "  Канал:    $Channel"
if ($Slow) { Write-Host "  Резерв для iPhone: $Channel-slow (AAC/HLS)" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "  Посилання саме на цей клас - його можна надіслати дітям:" -ForegroundColor Green
if ($addresses.Count -eq 0) {
  Write-Host "     мережеву адресу визначити не вдалось - перевірте Wi-Fi чи кабель" -ForegroundColor Red
} else {
  foreach ($ip in $addresses) {
    Write-Host ("     http://{0}:{1}/listen.html?ch={2}" -f $ip, $WebPort, $Channel) -ForegroundColor Cyan
  }
}

Write-Host ""
Write-Host "Зупинити - Ctrl+C" -ForegroundColor DarkGray
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
