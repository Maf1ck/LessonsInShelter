<#
  Качає дві програми, без яких проєкт не працює, і кладе їх у server\bin:
    mediamtx.exe - медіасервер
    ffmpeg.exe   - знімає звук з мікрофона

  Запускати на комп'ютері, де ще є інтернет. Права адміністратора не потрібні.

    .\download-tools.ps1

  Версія MediaMTX закріплена навмисно: у новіших випусках частина ключів
  конфігурації називається інакше, і server\mediamtx.yml перевірений саме на цій.
#>

param([string]$MediaMtxVersion = "v1.9.3")

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$bin  = (Resolve-Path (Join-Path $PSScriptRoot "..\bin")).Path
$temp = Join-Path $env:TEMP ("lessons-tools-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force -Path $temp | Out-Null

function Get-Tool {
  param([string]$Name, [string]$Url, [string]$ExeInside)

  $target = Join-Path $bin $Name
  if (Test-Path $target) {
    Write-Host "Вже є: $Name" -ForegroundColor DarkGray
    return
  }

  Write-Host "Качаю $Name ..." -ForegroundColor Cyan
  $zip = Join-Path $temp ($Name + ".zip")
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $zip

  $unpack = Join-Path $temp ($Name + "-unpacked")
  Expand-Archive -Path $zip -DestinationPath $unpack -Force

  $found = Get-ChildItem -Path $unpack -Recurse -Filter $ExeInside | Select-Object -First 1
  if (-not $found) { throw "В архіві $Url не знайшовся $ExeInside" }

  Copy-Item $found.FullName $target -Force
  # Windows позначає завантажені файли як «з інтернету» і не дає їх запустити.
  Unblock-File $target
  Write-Host "Готово: $Name" -ForegroundColor Green
}

try {
  Get-Tool -Name "mediamtx.exe" `
    -Url ("https://github.com/bluenviron/mediamtx/releases/download/{0}/mediamtx_{0}_windows_amd64.zip" -f $MediaMtxVersion) `
    -ExeInside "mediamtx.exe"

  Get-Tool -Name "ffmpeg.exe" `
    -Url "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" `
    -ExeInside "ffmpeg.exe"
} finally {
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Обидві програми лежать у $bin" -ForegroundColor Green
Write-Host "Далі: .\allow-firewall.ps1 (від імені адміністратора), потім .\start-server.ps1"
