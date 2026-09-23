<#
  Піднімає дві речі:
    1) MediaMTX — роздає звук у браузери (WebRTC :8889, резерв HLS :8888)
    2) статичний вебсервер зі сторінкою для дітей (:8080)

  Мікрофон запускається окремо: .\start-mic.ps1 -Device "..." -Channel klas-5-1
#>

param([int]$WebPort = 8080)

. (Join-Path $PSScriptRoot "lib.ps1")

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

# Порти медіасервера. Найчастіша причина - попередній запуск, який не закрився:
# MediaMTX тоді мовчки вмирає через 0.15 c, і без цієї перевірки лишається
# незрозуміле "не стартував".
foreach ($port in 8554, 8888, 8889) {
  $taken = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $taken) { continue }
  $owner = Get-Process -Id $taken[0].OwningProcess -ErrorAction SilentlyContinue
  Write-Host "Порт $port уже зайнятий: $($owner.ProcessName) (PID $($taken[0].OwningProcess))" -ForegroundColor Red
  if ($owner.ProcessName -eq "mediamtx") {
    Write-Host "Медіасервер з попереднього запуску не закрився. Зупиніть його:" -ForegroundColor Yellow
    Write-Host "   Stop-Process -Id $($taken[0].OwningProcess) -Force"
  }
  exit 1
}

# Чим роздавати сторінку - вирішуємо ДО запуску медіасервера.
# Python вміє це без прав адміністратора, а вбудований HttpListener - ні.
# Якщо дати йому підвищувати права самому, він відкриє нове вікно, поточне
# закриється, і блок finally забере медіасервер із собою - сторінка буде,
# а звуку не буде взагалі.
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }

if (-not $python) {
  $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
             ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    Write-Host "Python не знайдено, тож сторінку роздаватиме вбудований вебсервер Windows," -ForegroundColor Yellow
    Write-Host "а він працює лише з правами адміністратора." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Закрийте це вікно і відкрийте PowerShell через «Запуск від імені адміністратора»." -ForegroundColor Yellow
    exit 1
  }
}

Write-Host "Запускаю медіасервер..." -ForegroundColor Cyan
# Лапки обов'язкові: шлях може містити пробіли, а Start-Process їх сам не додає.
$mtx = Start-Process -PassThru -WindowStyle Minimized -FilePath $mediamtx -ArgumentList ("`"" + $config + "`"")

Start-Sleep -Milliseconds 800
if ($mtx.HasExited) {
  Write-Host "MediaMTX не стартував - перевірте mediamtx.yml і зайняті порти." -ForegroundColor Red
  exit 1
}
Write-Host "Медіасервер працює (PID $($mtx.Id))." -ForegroundColor Green

Write-Host ""
Write-Host "Сторінка для дітей:" -ForegroundColor Green
$addresses = @(Get-ServerAddresses)
if ($addresses.Count -eq 0) {
  Write-Host "   мережеву адресу визначити не вдалось - перевірте Wi-Fi чи кабель" -ForegroundColor Red
} else {
  foreach ($ip in $addresses) { Write-Host ("   http://{0}:{1}/" -f $ip, $WebPort) -ForegroundColor Cyan }
}
Write-Host "Зупинити - Ctrl+C" -ForegroundColor DarkGray
Write-Host ""

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
