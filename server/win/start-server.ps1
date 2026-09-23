<#
  Піднімає дві речі:
    1) MediaMTX — роздає звук у браузери (WebRTC :8889, резерв HLS :8888)
    2) статичний вебсервер зі сторінкою для дітей (:8080)

  Мікрофон запускається окремо: .\start-mic.ps1 -Device "..." -Channel klas-5a
#>

param([int]$WebPort = 8080)

$root     = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$web      = Join-Path $root "web"
$mediamtx = Join-Path $root "server\bin\mediamtx.exe"
$config   = Join-Path $root "server\mediamtx.yml"

if (-not (Test-Path $mediamtx)) {
  Write-Host "Немає $mediamtx" -ForegroundColor Red
  Write-Host "Завантажте MediaMTX (Windows amd64) з https://github.com/bluenviron/mediamtx/releases"
  Write-Host "і покладіть mediamtx.exe у папку server\bin"
  exit 1
}

# Порт для сторінки буває зайнятий чужою програмою (pgAdmin/EnterpriseDB, Jenkins тощо).
# Якщо це прогавити, телефони відкриють чужу сторінку, а не наш список класів.
$busy = Get-NetTCPConnection -LocalPort $WebPort -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  $names = $busy | ForEach-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName } |
           Where-Object { $_ } | Select-Object -Unique
  Write-Host "Порт $WebPort вже зайнятий: $($names -join ', ')" -ForegroundColor Red
  Write-Host "Запустіть на іншому порту, наприклад:" -ForegroundColor Yellow
  Write-Host "   .\start-server.ps1 -WebPort 8081"
  Write-Host "і не забудьте відкрити його у фаєрволі: .\allow-firewall.ps1 -WebPort 8081"
  exit 1
}

Write-Host "Запускаю медіасервер..." -ForegroundColor Cyan
$mtx = Start-Process -PassThru -WindowStyle Minimized -FilePath $mediamtx -ArgumentList $config

Start-Sleep -Milliseconds 800
if ($mtx.HasExited) {
  Write-Host "MediaMTX не стартував - перевірте mediamtx.yml і зайняті порти." -ForegroundColor Red
  exit 1
}
Write-Host "Медіасервер працює (PID $($mtx.Id))." -ForegroundColor Green

Write-Host ""
Write-Host "Сторінка для дітей:" -ForegroundColor Green
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
  ForEach-Object { Write-Host ("   http://{0}:{1}/" -f $_.IPAddress, $WebPort) }
Write-Host "Зупинити - Ctrl+C" -ForegroundColor DarkGray
Write-Host ""

# Python роздає файли без прав адміністратора, тому він у пріоритеті.
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }

try {
  if ($python) {
    & $python.Source -m http.server $WebPort --directory $web
  } else {
    # Запасний варіант на вбудованому HttpListener (потребує прав адміністратора).
    & (Join-Path $PSScriptRoot "static-server.ps1") -Port $WebPort
  }
} finally {
  if (-not $mtx.HasExited) {
    Write-Host "Зупиняю медіасервер..." -ForegroundColor DarkGray
    Stop-Process -Id $mtx.Id -ErrorAction SilentlyContinue
  }
}
