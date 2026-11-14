#!/usr/bin/env bash
# One-command launcher: sets up dependencies on first run, builds the UI and serves everything on :8000.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

cd "$ROOT/backend"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi

cd "$ROOT/frontend"
if [ ! -d node_modules ]; then
  npm install
fi
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  npm run build
fi

cd "$ROOT/backend"
if [ "${SEED:-0}" = "1" ]; then
  .venv/bin/python -m app.seed
fi
echo ""
echo "  AI DevSecure running at http://127.0.0.1:${PORT:-8000}"
echo ""
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "${PORT:-8000}"
