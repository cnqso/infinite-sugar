#!/usr/bin/env bash
# ES modules + fetch() do not work over file://, so a static server is required.
PORT="${1:-7377}"
cd "$(dirname "$0")/web"
echo "-> http://localhost:$PORT"
exec python3 -m http.server "$PORT"
