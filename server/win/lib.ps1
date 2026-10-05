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

function Get-ChannelInfo {
  param([string]$Channel)

  Get-Channels | Where-Object { $_.id -eq $Channel } | Select-Object -First 1
}

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
