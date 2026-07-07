#!/bin/bash
# Vault原本を LaunchAgent 実行用コピーへ反映して再起動する。
# 注意: --exclude は先頭 / でルート直下に固定すること。
#       素の "dist" だと node_modules/*/dist まで除外され、描画が壊れる事故が起きた。
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/Application Support/BikunaviDesktop"
LABEL="jp.a.bikunavi-desktop"

rsync -a --delete --exclude=/dist --exclude=/.git "$SRC/" "$DEST/"
chmod +x "$DEST/scripts/start-bikunavi-desktop.sh" "$DEST/native/now-playing"

# 必須ファイルの存在チェック（欠けたまま起動すると透明なまま何も描画されない）
REQUIRED=(
  "node_modules/pixi.js/dist/browser/pixi.min.js"
  "node_modules/@pixi/unsafe-eval/dist/browser/unsafe-eval.min.js"
  "node_modules/pixi-live2d-display/dist/cubism4.min.js"
  "vendor/live2dcubismcore.min.js"
  "preload.js"
)
for f in "${REQUIRED[@]}"; do
  if [ ! -f "$DEST/$f" ]; then
    echo "ERROR: $f が実行コピーにありません。反映を中止します。" >&2
    exit 1
  fi
done

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
else
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$LABEL.plist"
  launchctl kickstart "gui/$(id -u)/$LABEL"
fi
echo "反映して再起動しました。ログ: /tmp/bikunavi-desktop.out.log"
