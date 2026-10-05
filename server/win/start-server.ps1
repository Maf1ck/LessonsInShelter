param([int]$WebPort = 8080)

. (Join-Path $PSScriptRoot "lib.ps1")
Show-Banner

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
#
# На свіжій Windows "python" - це заглушка Microsoft Store (WindowsApps\python.exe):
# Get-Command її знаходить, але вона лише друкує "Python" і одразу виходить.
# Тоді finally гасив медіасервер одразу після старту. Тому перевіряємо, що
# інтерпретатор справді запускається і має http.server.
$python = $null
foreach ($name in "python", "py", "python3") {
  $cmd = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $cmd) { continue }
  & $cmd.Source -c "import http.server" *> $null
  if ($LASTEXITCODE -eq 0) { $python = $cmd; break }
}

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
Write-Host ""
Show-Channels
Write-Host "Зупинити - Ctrl+C" -ForegroundColor DarkGray
Write-Host ""

try {
  if ($python) {
    & $python.Source -m http.server $WebPort --directory $web
    # Сюди доходимо лише тоді, коли вебсервер завершився сам, а не через Ctrl+C.
    Write-Host ""
    Write-Host "Вебсервер на Python несподівано завершився (код $LASTEXITCODE)." -ForegroundColor Red
    Write-Host "Разом із ним зупиняється і медіасервер. Перевірте, що Python встановлено з python.org," -ForegroundColor Yellow
    Write-Host "або запустіть PowerShell від імені адміністратора - тоді сторінку роздасть вбудований вебсервер." -ForegroundColor Yellow
  } else {
    & (Join-Path $PSScriptRoot "static-server.ps1") -Port $WebPort
  }
} finally {
  if (-not $mtx.HasExited) {
    Write-Host "Зупиняю медіасервер..." -ForegroundColor DarkGray
    Stop-Process -Id $mtx.Id -ErrorAction SilentlyContinue
  }
}
