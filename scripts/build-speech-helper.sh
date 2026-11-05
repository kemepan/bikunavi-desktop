#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/native/speech-recognizer.app"
CONTENTS="$APP/Contents"
EXECUTABLE="$CONTENTS/MacOS/speech-recognizer"

mkdir -p "$CONTENTS/MacOS"
cp "$ROOT/native/speech-recognizer-Info.plist" "$CONTENTS/Info.plist"

# **使える SDK を選ぶ。** 既定の SDK が clang より新しいと、リンクの段で
# 「unknown architecture / tapi error: malformed file」で落ちる。Command Line
# Tools だけの環境では、clang と SDK の更新がずれることが実際にあった
# （2026-11-05: clang 21 に対して MacOSX27.0.sdk が入っており、.tbd を
# 解釈できなかった）。
#
# 新しい順に試して、本当にリンクできるものを使う。版を決め打ちにすると、
# その SDK が消えた時に同じ形で止まるため。
# BIKUNAVI_MACOS_SDK で明示指定もできる。
probe() {
  local sdk_path="$1"
  local probe_source
  probe_source="$(mktemp -t bikunavi-sdk-probe).m"
  printf '#import <Foundation/Foundation.h>\n#import <Speech/Speech.h>\nint main(void){return 0;}\n' > "$probe_source"
  local ok=1
  if xcrun clang -fobjc-arc -fblocks -mmacosx-version-min=12.0 \
      -isysroot "$sdk_path" -framework Foundation -framework Speech \
      "$probe_source" -o "${probe_source%.m}.out" >/dev/null 2>&1; then
    ok=0
  fi
  rm -f "$probe_source" "${probe_source%.m}.out"
  return $ok
}

SDK_PATH=""
CANDIDATES=()
if [[ -n "${BIKUNAVI_MACOS_SDK:-}" ]]; then
  CANDIDATES+=("$(xcrun --sdk "$BIKUNAVI_MACOS_SDK" --show-sdk-path 2>/dev/null || true)")
fi
CANDIDATES+=("$(xcrun --show-sdk-path 2>/dev/null || true)")
# 新しい順。sort -V なので MacOSX15 より MacOSX26 が後ろに来る。
while IFS= read -r candidate; do
  CANDIDATES+=("$candidate")
done < <(ls -d "$(xcode-select -p)"/SDKs/MacOSX*.sdk 2>/dev/null | sort -Vr)

for candidate in "${CANDIDATES[@]}"; do
  [[ -z "$candidate" || ! -d "$candidate" ]] && continue
  if probe "$candidate"; then
    SDK_PATH="$candidate"
    break
  fi
  echo "この SDK ではリンクできないので次を試します: $candidate" >&2
done

if [[ -z "$SDK_PATH" ]]; then
  echo "使える macOS SDK が見つかりませんでした。" >&2
  echo "Command Line Tools の更新（softwareupdate --list）か、" >&2
  echo "BIKUNAVI_MACOS_SDK で明示指定してください。" >&2
  exit 1
fi

echo "使う SDK: $SDK_PATH"

xcrun clang \
  -isysroot "$SDK_PATH" \
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
