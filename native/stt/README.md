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
