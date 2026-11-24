#!/bin/sh
# One command to try InsightIQ on THIS computer with a FRESH, empty data folder (never your real workspace).
#   sh scripts/demo.sh            start (installs what is missing the first time), open the browser, print how to stop
#   sh scripts/demo.sh stop       stop what the last start began
#   sh scripts/demo.sh --no-open  start without opening a browser
# AI: if a local .env file has LLM_API_KEY and LLM_MODEL (and optionally LLM_BASE_URL and the two price lines), they are passed to the app.
# The key is never printed, logged by this script, or copied anywhere. Without them everything except asking NEW questions works.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
POINTER="${TMPDIR:-/tmp}/insightiq-demo.last"
OPEN=1

if [ "${1:-}" = "stop" ]; then
  [ -f "$POINTER" ] || { echo "Nothing to stop (no earlier start found)."; exit 0; }
  DIR=$(cat "$POINTER")
  for pidfile in "$DIR/api.pid" "$DIR/web.pid"; do
    [ -f "$pidfile" ] && kill "$(cat "$pidfile")" 2>/dev/null || true
  done
  pkill -f "insightiq-demo-web-$(basename "$DIR")" 2>/dev/null || true
  echo "Stopped. The demo data folder is still here (delete it when you are done): $DIR"
  exit 0
fi
[ "${1:-}" = "--no-open" ] && OPEN=0

command -v python3 >/dev/null 2>&1 || { echo "Python 3.9 or newer is needed (python3 was not found)."; exit 1; }
command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || { echo "Node 22 or newer with npm is needed (node was not found)."; exit 1; }

cd "$ROOT"
if [ ! -x .venv/bin/python ]; then
  echo "First run: creating the Python environment and installing packages. This downloads a lot (a few GB) and can take several minutes."
  python3 -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r backend/requirements.txt
fi
if [ ! -d frontend/node_modules ]; then
  echo "First run: installing front-end packages."
  (cd frontend && npm ci --silent)
fi

# A fresh data folder every time. Never the real workspace and never a folder named by .env.
DIR=$(mktemp -d "${TMPDIR:-/tmp}/insightiq-demo.XXXXXX")
echo "$DIR" > "$POINTER"

# Read ONLY the AI settings from .env, without running the file and without printing anything.
AI=no
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      LLM_API_KEY=*|LLM_MODEL=*|LLM_BASE_URL=*|LLM_INPUT_USD_PER_MILLION=*|LLM_OUTPUT_USD_PER_MILLION=*)
        key=${line%%=*}; value=${line#*=}
        value=$(printf '%s' "$value" | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")
        [ -n "$value" ] && export "$key=$value" ;;
    esac
  done < .env
  [ -n "${LLM_API_KEY:-}" ] && [ -n "${LLM_MODEL:-}" ] && AI=yes
fi

free_port() { python3 - "$1" <<'PY'
import socket, sys
port = int(sys.argv[1])
while True:
    with socket.socket() as s:
        if s.connect_ex(('127.0.0.1', port)) != 0:
            print(port); break
    port += 1
PY
}
API_PORT=$(free_port 8030)
WEB_PORT=$(free_port 5230)

cd "$ROOT/backend"
DATA_DIR="$DIR" nohup ../.venv/bin/python -m app.serve --host 127.0.0.1 --port "$API_PORT" > "$DIR/api.log" 2>&1 < /dev/null &
echo $! > "$DIR/api.pid"
cd "$ROOT/frontend"
API_PROXY_TARGET="http://127.0.0.1:$API_PORT" nohup npm run dev -- --host 127.0.0.1 --port "$WEB_PORT" --strictPort > "$DIR/web.log" 2>&1 < /dev/null &
echo $! > "$DIR/web.pid"
cd "$ROOT"

i=0
until curl -s "http://127.0.0.1:$WEB_PORT/api/health" >/dev/null 2>&1; do
  i=$((i+1)); [ $i -gt 90 ] && { echo "The app did not start in time. See $DIR/api.log and $DIR/web.log"; exit 1; }
  sleep 1
done
URL="http://127.0.0.1:$WEB_PORT"
echo "InsightIQ is running: $URL"
echo "Data folder (empty, this demo only): $DIR"
if [ "$AI" = yes ]; then echo "AI provider: settings found in .env (not shown)."; else echo "AI provider: not configured, so asking NEW questions will not work. Everything else does. See .env.example."; fi
echo "To stop: sh scripts/demo.sh stop"
if [ "$OPEN" = 1 ]; then
  (command -v open >/dev/null 2>&1 && open "$URL") || (command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL") || true
fi
