#!/usr/bin/env bash
# Підготовка Raspberry Pi (або будь-якого Debian/Ubuntu) до ролі шкільного радіовузла.
# Виконати один раз, коли ще є інтернет.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$ROOT/server/bin"
VERSION="${MEDIAMTX_VERSION:-1.9.3}"

echo "==> Встановлюю ffmpeg, python3, alsa-utils"
sudo apt-get update
sudo apt-get install -y ffmpeg python3 alsa-utils curl

case "$(uname -m)" in
  aarch64) ARCH="linux_arm64v8" ;;
  armv7l)  ARCH="linux_armv7"   ;;
  x86_64)  ARCH="linux_amd64"   ;;
  *) echo "Невідома архітектура $(uname -m)"; exit 1 ;;
esac

mkdir -p "$BIN"
if [ ! -x "$BIN/mediamtx" ]; then
  echo "==> Завантажую MediaMTX $VERSION ($ARCH)"
  URL="https://github.com/bluenviron/mediamtx/releases/download/v${VERSION}/mediamtx_v${VERSION}_${ARCH}.tar.gz"
  curl -fL "$URL" | tar -xz -C "$BIN" mediamtx
  chmod +x "$BIN/mediamtx"
fi

echo
echo "Готово. Аудіовходи системи:"
arecord -l || true
echo
echo "Далі: ./start-server.sh  і в іншому терміналі  ./start-mic.sh plughw:1,0 klas-5a"
