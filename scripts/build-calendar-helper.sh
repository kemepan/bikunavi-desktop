#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/native/calendar-probe.app"
CONTENTS="$APP/Contents"
EXECUTABLE="$CONTENTS/MacOS/calendar-probe"

mkdir -p "$CONTENTS/MacOS"
cp "$ROOT/native/calendar-probe-Info.plist" "$CONTENTS/Info.plist"

xcrun clang \
  -fobjc-arc \
  -fblocks \
  -mmacosx-version-min=12.0 \
  -framework Foundation \
  -framework EventKit \
  "$ROOT/native/calendar-probe.m" \
  -o "$EXECUTABLE" \
  -arch arm64 \
  -arch x86_64 2>/dev/null

# カレンダーは Info.plist の記述だけでは足りず、entitlement が要る。
# 無いと tccd が "requires entitlement ... but it is missing" で弾く。
codesign \
  --force \
  --deep \
  --sign - \
  --entitlements "$ROOT/native/calendar-entitlements.plist" \
  --identifier online.bikunitan.bikutan.calendar-probe \
  "$APP"

echo "カレンダー確認ヘルパーを作成しました: $APP"
