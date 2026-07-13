# びくたん Desktop 現状メモ

最終更新: 2026-07-11

## 何のアプリか

Live2Dキャラクター「びくたん」をデスクトップに常駐させる、Electron製のAIコンシェルジュアプリ。

サイト `bikunitan.online` で動いていた Live2D モデルの挙動をベースに、デスクトップ常駐、会話、読み上げ、自動セリフ、音声入力、ポモドーロ、音楽反応を追加している。

## 現在の大きな機能

- Live2D常駐
  - 透明・枠なし・最前面ウィンドウ
  - メニューバー常駐
  - サイズ切替、位置リセット、表示ON/OFF
  - ドラッグ移動
- サイト版Live2D挙動
  - `assets/bikunavi_desktop/` のデスクトップ用モデルを使用
  - Retina表示の滲み対策として2048pxテクスチャ版へ差し替え済み
  - 物理演算
  - 表情 `f01`〜`f06`
  - `Wave` / `Happy` モーション
  - 呼吸、瞬き、視線追従
  - AI回答の `emote` に応じて、回答後の表情を `joy` / `wink` / `proud` / `surprised` / `normal` から選ぶ
- 会話
  - 会話AIプロバイダの自動選択または固定選択
  - Codex CLI / Claude Code CLI / Gemini CLI / Claude API
  - 会話履歴の簡易保持
  - 回答・セリフのコピー
  - ソースURLボタン表示
  - 自動セリフ・ニュース・占いの表示中にホバーしても本文とソースを残し、入力欄だけ追加する
- 音声
  - VOICEVOX「猫使ビィ」読み上げ
  - 読み上げに合わせた口パク
  - macOS音声フォールバック
  - マイク録音 + ローカルSTT連携
- 自動セリフ
  - AI生成の短い雑談
  - AIニュース、技術見出し、生活ハック
  - 長めの情報共有は読み上げ後もしばらく表示
  - セリフ履歴表示
- キャラ育成・記憶
  - キャラカスタム問答
  - ことば帳、思い出帳
  - びくたん自身の成長問答
  - 好きな音楽ジャンルなどを会話に自然に混ぜる
  - 今日の日記
- 生活機能
  - ポモドーロタイマー
  - 今日のびくたん占い
  - 気分でミニ占い
  - 音楽再生中のノリノリ反応
  - スリープ中の自動セリフ・読み上げ停止

## 現在の実行方式

開発元:

```text
任意の開発用チェックアウト（例: `~/Projects/bikunavi-desktop`）
```

LaunchAgent実行用コピー:

```text
~/Library/Application Support/BikunaviDesktop
```

LaunchAgent:

```text
online.bikunitan.bikunavi-desktop
```

ログ:

```text
/tmp/bikunavi-desktop.out.log
/tmp/bikunavi-desktop.err.log
```

## 永続化されるもの

保存先:

```text
配布版: ~/Library/Application Support/bikunavi-desktop/state.json
開発版: ~/Library/Application Support/bikunavi-desktop-dev/state.json
```

主な保存内容:

- ウィンドウ位置・サイズ
- 表示設定、常に手前、自動移動、音楽反応
- 自動セリフ間隔
- 読み上げ設定
- セリフ履歴、会話履歴
- キャラカスタム回答
- ことば帳、思い出帳
- びくたん成長問答の回答
- 日記
- ポモドーロ状態

## ローカルSTTの現状

音声入力は、ブラウザ側で録音した音声をWAV化し、main process から `whisper.cpp` 互換CLIへ渡す構成。

既定の探索先:

- `BIKUNAVI_WHISPER_BIN`
- `/opt/homebrew/bin/whisper-cli`
- `/usr/local/bin/whisper-cli`
- `native/stt/<platform>-<arch>/whisper-cli`
- 旧名 `main` / `main.exe`

既定モデル:

```text
models/ggml-base.bin
```

メモ:

- `ggml-base.bin` は軽いが、書き起こし精度はまだ粗い。
- 精度改善候補は `small` / `medium`。
- 配布版では Homebrew 依存にできないため、OS/CPU別の同梱バイナリ方針を決める必要がある。

## 既知の注意点

- UI部品が小さい吹き出し内に密集しやすい。
- コピーはアイコン化済み、マイクは拡大済み。ただし履歴、ソースURL、入力欄、送信ボタンを含む全体の整理はまだ必要。
- 音声入力の録音には `ScriptProcessorNode` を使っている。将来的には `AudioWorkletNode` へ移行したい。
- 配布前に Electron のセキュリティ設定、署名、公証、STTバイナリ同梱を整理する。
- Windows対応は設計方針のみ。STT、読み上げ、音楽検出、常駐UIの代替実装が必要。
