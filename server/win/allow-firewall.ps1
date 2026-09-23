<#
  Відкриває у Windows-фаєрволі порти, без яких телефони не достукаються до сервера.
  Запускати один раз, у PowerShell від імені адміністратора.

  Порти:
    8080/tcp  сторінка для дітей (інший порт - ключ -WebPort)
    8889/tcp  WebRTC: домовленість про з'єднання (WHEP)
    8189/udp  WebRTC: сам звук
    8888/tcp  резервний HLS-потік для iPhone

  Порт 8554 (RTSP) не відкриваємо: ним ffmpeg ходить лише всередині самого сервера.

  Прибрати правила: .\allow-firewall.ps1 -Remove
#>

param([int]$WebPort = 8080, [switch]$Remove)

$rules = @(
  @{ Name = "Lessons in Shelter - сторінка ($WebPort/tcp)"; Protocol = "TCP"; Port = $WebPort },
  @{ Name = "Lessons in Shelter - WebRTC (8889/tcp)";   Protocol = "TCP"; Port = 8889 },
  @{ Name = "Lessons in Shelter - WebRTC звук (8189/udp)"; Protocol = "UDP"; Port = 8189 },
  @{ Name = "Lessons in Shelter - HLS для iPhone (8888/tcp)"; Protocol = "TCP"; Port = 8888 }
)

$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host "Потрібні права адміністратора: відкрийте PowerShell через «Запуск від імені адміністратора»." -ForegroundColor Red
  exit 1
}

foreach ($r in $rules) {
  $existing = Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue
  if ($Remove) {
    if ($existing) { $existing | Remove-NetFirewallRule; Write-Host "Прибрано: $($r.Name)" -ForegroundColor DarkGray }
    continue
  }
  if ($existing) {
    Write-Host "Вже є: $($r.Name)" -ForegroundColor DarkGray
    continue
  }
  # Profile Private: правило діє у шкільній/домашній мережі, а не в публічних Wi-Fi.
  New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Action Allow `
    -Protocol $r.Protocol -LocalPort $r.Port -Profile Private | Out-Null
  Write-Host "Відкрито: $($r.Name)" -ForegroundColor Green
}

if (-not $Remove) {
  Write-Host ""
  Write-Host "Мережа, до якої підключені телефони, має бути позначена як «приватна»." -ForegroundColor Yellow
  Write-Host "Перевірити: Get-NetConnectionProfile" -ForegroundColor DarkGray
}
