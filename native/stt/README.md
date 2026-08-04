# Local STT runtime

びくたんの音声入力は、配布アプリ化を見据えてローカル音声認識を前提にしています。

## Expected layout

Place `whisper.cpp` compatible binaries here:

```text
native/stt/
  darwin-arm64/whisper-cli
  darwin-x64/whisper-cli
  win32-x64/whisper-cli.exe
```

The app also accepts legacy `main` / `main.exe` names.

## Model

The default model path is:

```text
models/ggml-base.bin
```

You can download it with:

```bash
npm run fetch-whisper-model
```

Or override paths at runtime:

```bash
BIKUNAVI_WHISPER_BIN=/path/to/whisper-cli
BIKUNAVI_WHISPER_MODEL=/path/to/ggml-base.bin
```

`models/` and local STT binaries are intentionally gitignored because they are large and platform-specific.

## Notes

- `ggml-base.bin` is the current default because it is light enough for quick local tests.
- If transcription quality is too rough, try `small` or `medium` models and compare latency.
- For packaged distribution, do not rely on Homebrew paths. Bundle platform-specific binaries here, preferably static builds or builds whose dylib dependencies are also included.
- The app tries multiple candidates and falls back to the next one if a binary exists but fails to run.


## Windows 用バイナリの入手

```bash
npm run fetch-whisper-binaries
```

必要なものだけを `native/stt/win32-x64/` へ置く（合計 9.4MB）。macOS でも
Windows でも動く（展開は OS 標準の unzip / Expand-Archive を使う）。
既に置かれている場合は何もしない。入れ直す時はフォルダを消してから実行する。

以下は、このスクリプトが何をしているかの記録（手で追う場合の手順でもある）。

### 中身（2026-07-31 時点）

whisper.cpp の公式リリースから取得する。`whisper-cli.exe` は DLL に依存するので、
実行ファイルだけでは動かない。

```bash
# 1. CPU 版を取得（CUDA 版は 265MB あり、配布には重すぎる）
gh release download v1.9.1 --repo ggml-org/whisper.cpp --pattern "whisper-bin-x64.zip"
unzip whisper-bin-x64.zip -d extracted

# 2. 必要なものだけ native/stt/win32-x64/ へ置く（合計 9.4MB）
mkdir -p native/stt/win32-x64
cp extracted/Release/whisper-cli.exe native/stt/win32-x64/
cp extracted/Release/whisper.dll extracted/Release/ggml.dll \
   extracted/Release/ggml-base.dll native/stt/win32-x64/
cp extracted/Release/ggml-cpu-*.dll native/stt/win32-x64/
```

`ggml-cpu-*.dll` は CPU の世代ごとに分かれていて、実行時に合うものが選ばれる。
どれが使われるかは動かす機械次第なので、一式入れておく（1つ 0.7〜0.8MB）。

**入れないもの**: `SDL2.dll`、`whisper-talk-llama.exe`、`test-*.exe`、`command.exe`、
`whisper-server.exe` など。びくたんは `whisper-cli` しか呼ばない。
