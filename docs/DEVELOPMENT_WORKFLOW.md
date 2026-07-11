# 開発・検証・反映手順

最終更新: 2026-07-11

## 基本方針

- 原本はリポジトリ直下。
- ログイン時自動起動・常駐で使う実行版は `~/Library/Application Support/BikunaviDesktop/` にコピーする。
- 変更後は構文確認をしてから実行版へ反映する。
- 大きいモデル、ローカルSTTバイナリ、Cubism Core、`node_modules/`、`dist/` はgit管理しない。

## よく使うコマンド

```bash
npm install
npm run fetch-core
npm run fetch-whisper-model
npm run check
npm start
```

`.app` 作成:

```bash
npm run package
npm run package:universal
```

now-playing helper の再ビルド:

```bash
npm run build-media-helper
```

## 実行中のびくたんへ反映

リポジトリ側で修正した後:

```bash
./scripts/deploy-launchagent.sh
```

手動で行う場合:

```bash
ditto . "$HOME/Library/Application Support/BikunaviDesktop"
launchctl kickstart -k "gui/$(id -u)/online.bikunitan.bikunavi-desktop"
```

## 起動・停止

起動:

```bash
launchctl kickstart -k "gui/$(id -u)/online.bikunitan.bikunavi-desktop"
```

停止:

```bash
launchctl bootout "gui/$(id -u)/online.bikunitan.bikunavi-desktop"
```

状態確認:

```bash
launchctl print "gui/$(id -u)/online.bikunitan.bikunavi-desktop"
```

## ログ確認

```bash
tail -80 /tmp/bikunavi-desktop.out.log
tail -80 /tmp/bikunavi-desktop.err.log
```

STTまわりを追う時:

```bash
rg -n "Whisper|transcribe|Voice transcription|bikunavi-voice-input" /tmp/bikunavi-desktop.*.log
```

録音WAV確認:

```bash
find /var/folders -path '*bikunavi-voice-input*' -type f -print 2>/dev/null | tail -20
```

## ローカル音声認識

モデル取得:

```bash
npm run fetch-whisper-model
```

Homebrew 版 `whisper-cli` を使う開発環境:

```bash
brew install whisper-cpp
```

環境変数で明示:

```bash
BIKUNAVI_WHISPER_BIN=/path/to/whisper-cli
BIKUNAVI_WHISPER_MODEL=/path/to/ggml-base.bin
```

配布時の置き場:

```text
native/stt/
  darwin-arm64/whisper-cli
  darwin-x64/whisper-cli
  win32-x64/whisper-cli.exe
```

詳細は [`../native/stt/README.md`](../native/stt/README.md)。

## 変更前後の確認

最低限:

```bash
npm run check
git diff --stat
git status --short
```

動作確認したい項目:

- 起動するか
- Live2Dが表示されるか
- ホバーで吹き出しが出るか
- 会話入力・送信ができるか
- マイク入力で入力欄に文字が入るか
- 読み上げと口パクが同期するか
- メニューバー操作が効くか
- ポモドーロ操作が押せるか
- 音楽再生中にノリ動作になるか

## Git運用

- 通常の開発対象は `bikunavi-desktop` 単独リポジトリ。
- Brain Vault 側とは別repoなので、コミット対象を混ぜない。
- モデル・STTバイナリ・配布zipは原則git管理しない。
- コミット前に `git status --short --ignored` で意図しない大容量ファイルが入らないか確認する。
