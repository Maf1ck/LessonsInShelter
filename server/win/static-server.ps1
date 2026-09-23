<#
  Найпростіший статичний вебсервер для папки web (сторінка для дітей).
  Без Python і без Node — лише вбудований у Windows HttpListener.

  Запускати від імені адміністратора (інакше Windows не дозволить
  слухати на всіх інтерфейсах), або один раз виконати:
    netsh http add urlacl url=http://+:8080/ user=Everyone
#>

param([int]$Port = 8080)

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\web")).Path

$types = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$Port/")
try {
  $listener.Start()
} catch {
  # Windows дозволяє слухати на всіх інтерфейсах тільки адміністратору.
  $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
             ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    Write-Host "Потрібні права адміністратора, перезапускаю..." -ForegroundColor Yellow
    Start-Process -Verb RunAs -FilePath "powershell.exe" `
      -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath, "-Port", $Port)
    exit 0
  }
  Write-Host "Не вдалось зайняти порт $Port - можливо, він уже зайнятий." -ForegroundColor Red
  exit 1
}

Write-Host "Сторінка для дітей: http://<IP-сервера>:$Port/" -ForegroundColor Green
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
  ForEach-Object { Write-Host ("   http://{0}:{1}/" -f $_.IPAddress, $Port) }
Write-Host "Зупинити — Ctrl+C" -ForegroundColor DarkGray

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path -eq "/") { $path = "/index.html" }

    $file = Join-Path $root ($path.TrimStart("/") -replace "/", "\")
    $full = [System.IO.Path]::GetFullPath($file)

    if ($full.StartsWith($root) -and (Test-Path $full -PathType Leaf)) {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ctx.Response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { "application/octet-stream" }
      $ctx.Response.Headers.Add("Cache-Control", "no-store")
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404")
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $ctx.Response.OutputStream.Close()
  }
} finally {
  $listener.Stop()
}
