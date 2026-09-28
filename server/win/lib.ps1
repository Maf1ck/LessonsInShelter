<#
  Спільні дрібниці для скриптів у цій папці. Підключається так:
    . (Join-Path $PSScriptRoot "lib.ps1")
#>

<#
  Повертає IP-адреси, за якими телефони справді дістануть сервер.

  Відсіює те, що тільки заплутає вчителя: петлю 127.x, автоадреси 169.254.x
  (адаптер піднятий, але мережі немає) і віртуальні адаптери на кшталт Radmin VPN
  чи VirtualBox. Якщо після відсіювання не лишилось нічого - віддаємо все, що є,
  бо точка доступу могла бути піднята саме віртуальним адаптером.
#>
function Get-ServerAddresses {
  $physical = @(
    Get-NetAdapter -ErrorAction SilentlyContinue |
      Where-Object { $_.Status -eq "Up" -and -not $_.Virtual } |
      Select-Object -ExpandProperty Name
  )

  $ips = @(
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -notlike "169.254.*" -and
        ($_.PrefixOrigin -eq "Dhcp" -or $_.PrefixOrigin -eq "Manual")
      }
  )

  $real = @($ips | Where-Object { $physical -contains $_.InterfaceAlias })
  if ($real.Count -eq 0) { $real = $ips }

  $real | Select-Object -ExpandProperty IPAddress
}

<#
  Читає web/channels.json і повертає опис каналу або $null, якщо такого немає.
  Потрібно, щоб помітити друкарську помилку в назві каналу ще до початку уроку.
#>
function Get-ChannelInfo {
  param([string]$Channel)

  Get-Channels | Where-Object { $_.id -eq $Channel } | Select-Object -First 1
}

# Усі канали з web/channels.json; порожньо, якщо файлу немає або він зламаний.
function Get-Channels {
  $file = Join-Path $PSScriptRoot "..\..\web\channels.json"
  if (-not (Test-Path $file)) { return @() }
  try {
    $cfg = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return @()
  }
  @($cfg.channels)
}

<#
  Друкує таблицю класів: назва, сектор і код для start-mic.ps1 -Channel.
  Щоб код класу не доводилось шукати у channels.json.
#>
function Show-Channels {
  $channels = @(Get-Channels)
  if ($channels.Count -eq 0) {
    Write-Host "  Список класів порожній - перевірте web\channels.json" -ForegroundColor Yellow
    return
  }
  Write-Host "  Класи (код підставляється у start-mic.ps1 -Channel ...):" -ForegroundColor Green
  foreach ($ch in $channels) {
    Write-Host ("     {0,-6} {1,-12}" -f $ch.name, $ch.room) -NoNewline
    Write-Host $ch.id -ForegroundColor Cyan
  }
}

# Логотип і контакт розробника на початку кожного скрипта.
function Show-Banner {
  $logo = @(
    "                       ▄███▄ ▄██         ██     ",
    "                       ██     ██         ██     ",
    "  ▄████████▄ ▄██████▄ █████   ██ ▄██████ ██  ▄██",
    "  ██  ██  ██  ▄▄▄▄▄██  ██     ██ ██      ██▄██▀ ",
    "  ██  ██  ██ ██▀▀▀▀██  ██     ██ ██      ██▀██▄ ",
    "  ▀▀  ▀▀  ▀▀ ▀███████  ▀▀     ▀▀ ▀██████ ▀▀  ▀▀▀"
  )
  Write-Host ""
  foreach ($line in $logo) { Write-Host $line -ForegroundColor White }
  Write-Host "                   p r o j e c t s" -ForegroundColor Green
  Write-Host ""
  Write-Host "  Lessons in Shelter - звук уроку в укритті" -ForegroundColor Gray
  Write-Host "  Розробник: maf1ck   Telegram: " -NoNewline -ForegroundColor Gray
  Write-Host "@zxcmaf1ck" -NoNewline -ForegroundColor Green
  Write-Host "  (https://t.me/zxcmaf1ck)" -ForegroundColor DarkGray
  Write-Host ""
}
