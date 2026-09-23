#!/usr/bin/env bash
# Медіасервер + сторінка для дітей. Мікрофон запускається окремо (start-mic.sh).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEB_PORT="${WEB_PORT:-8080}"

"$ROOT/server/bin/mediamtx" "$ROOT/server/mediamtx.yml" &
MTX_PID=$!
trap 'kill $MTX_PID 2>/dev/null || true' EXIT

sleep 1
echo "Сторінка для дітей:"
for ip in $(hostname -I); do echo "   http://$ip:$WEB_PORT/"; done
echo

python3 -m http.server "$WEB_PORT" --directory "$ROOT/web"
