#!/usr/bin/env bash
# Container entrypoint: serves the app on $PORT and fills in the demo projects in the background.
set -euo pipefail
cd /app/backend

if [ "${SEED:-1}" = "1" ]; then
  python -m app.seed &
fi

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
