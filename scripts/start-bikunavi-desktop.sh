#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ELECTRON="$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
export BIKUNAVI_DATA_CHANNEL=dev

if [[ ! -x "$ELECTRON" ]]; then
  echo "Electron is not installed. Run npm install in $APP_DIR" >&2
  exit 1
fi

exec "$ELECTRON" "$APP_DIR"
