#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/native/speech-recognizer.app"
CONTENTS="$APP/Contents"
EXECUTABLE="$CONTENTS/MacOS/speech-recognizer"

mkdir -p "$CONTENTS/MacOS"
cp "$ROOT/native/speech-recognizer-Info.plist" "$CONTENTS/Info.plist"

xcrun clang \
  -fobjc-arc \
  -fblocks \
  -mmacosx-version-min=12.0 \
  -framework Foundation \
  -framework Speech \
  "$ROOT/native/speech-recognizer.m" \
  -o "$EXECUTABLE" \
  -arch arm64 \
  -arch x86_64

codesign \
  --force \
  --deep \
  --sign - \
  --identifier online.bikunitan.bikutan.speech-recognizer \
  "$APP"

echo "macOS Speech helperを作成しました: $APP"
