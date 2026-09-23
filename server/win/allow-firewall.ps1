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

if ($Remove) {
  # Прибираємо за префіксом, а не за списком: правило для сторінки могло бути
  # створене з іншим -WebPort, і за точною назвою воно б не знайшлось.
  $mine = Get-NetFirewallRule -DisplayName "Lessons in Shelter*" -ErrorAction SilentlyContinue
  if (-not $mine) { Write-Host "Правил цього проєкту не знайдено." -ForegroundColor DarkGray }
  foreach ($m in $mine) {
    Remove-NetFirewallRule -DisplayName $m.DisplayName
    Write-Host "Прибрано: $($m.DisplayName)" -ForegroundColor DarkGray
  }
  exit 0
}

foreach ($r in $rules) {
  $existing = Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "Вже є: $($r.Name)" -ForegroundColor DarkGray
    continue
  }
  # Profile Private: правило діє у шкільній/домашній мережі, а не в публічних Wi-Fi.
  New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Action Allow `
    -Protocol $r.Protocol -LocalPort $r.Port -Profile Private | Out-Null
  Write-Host "Відкрито: $($r.Name)" -ForegroundColor Green
}

Write-Host ""
Write-Host "Мережа, до якої підключені телефони, має бути позначена як «приватна»." -ForegroundColor Yellow
Write-Host "Перевірити: Get-NetConnectionProfile" -ForegroundColor DarkGray
