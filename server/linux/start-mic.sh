#!/usr/bin/env bash
# Публікує звук петличного мікрофона в канал класу.
#
#   ./start-mic.sh plughw:1,0 klas-5-1          основний потік (WebRTC, Opus)
#   SLOW=1 ./start-mic.sh plughw:1,0 klas-5-1   плюс резервний AAC-потік для HLS
#
# Список входів: arecord -l

set -euo pipefail

DEVICE="${1:-plughw:1,0}"
CHANNEL="${2:-klas-5-1}"
BITRATE="${BITRATE:-48}"
SERVER="${SERVER:-127.0.0.1}"

FILTER="highpass=f=90,acompressor=threshold=-18dB:ratio=3:attack=10:release=200,alimiter=limit=0.95"

# Обидва потоки веде один процес: ALSA-вхід відкривається лише раз
# (plughw другий раз просто не відкрився б), і AAC не розходиться з Opus.
SLOW_OUT=()
if [ "${SLOW:-0}" = "1" ]; then
  echo "Резервний AAC-потік для iPhone: $CHANNEL-slow"
  SLOW_OUT=(
    -af "$FILTER"
    -c:a aac -b:a 64k -ar 48000 -ac 1
    -f rtsp -rtsp_transport tcp "rtsp://$SERVER:8554/$CHANNEL-slow"
  )
fi

echo "Мікрофон: $DEVICE  →  канал: $CHANNEL"
echo "Зупинити — Ctrl+C"

exec ffmpeg -hide_banner -loglevel warning -nostdin \
  -f alsa -channels 1 -sample_rate 48000 -thread_queue_size 1024 -i "$DEVICE" \
  -af "$FILTER" \
  -c:a libopus -b:a "${BITRATE}k" -ar 48000 -ac 1 -application voip -frame_duration 20 \
  -f rtsp -rtsp_transport tcp "rtsp://$SERVER:8554/$CHANNEL" \
  "${SLOW_OUT[@]}"
