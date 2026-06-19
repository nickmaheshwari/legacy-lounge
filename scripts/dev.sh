#!/usr/bin/env bash
# Local dev: regenerate config.js from .env, then serve the client.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$ROOT/scripts/gen-config.sh"
echo "serving http://localhost:8000  (Ctrl+C to stop)"
cd "$ROOT/public" && exec python3 -m http.server 8000
