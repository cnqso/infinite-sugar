#!/usr/bin/env bash
# ES modules + fetch() do not work over file://, so a static server is required.
PORT="${1:-7377}"
cd "$(dirname "$0")/web"
echo "-> http://localhost:$PORT"
exec python3 -c '
import sys, http.server
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # no caching: editing app.js/brain.js and getting a stale module back is a real trap
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()
http.server.test(HandlerClass=H, port=int(sys.argv[1]), bind="127.0.0.1")
' "$PORT"
