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

  $file = Join-Path $PSScriptRoot "..\..\web\channels.json"
  if (-not (Test-Path $file)) { return $null }
  try {
    $cfg = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
  $cfg.channels | Where-Object { $_.id -eq $Channel } | Select-Object -First 1
}
