# Windows でソースから動かす

Windows 機でびくたんを直したり試したりするための手順。

配布物（`bikutan.exe` 入りのフォルダ）を受け取って**動かすだけ**なら、この手順は要らない。
`DISTRIBUTION_README_WIN.md` の方を読む。

## 用意するもの

- **Node.js 20 以降** — [nodejs.org](https://nodejs.org/) の LTS 版
- **Git** — [git-scm.com](https://git-scm.com/)
- リポジトリへのアクセス権（private のため）

以下のコマンドは、すべて**コマンドプロンプト**で実行する。

## 最短で起動するまで

```bash
git clone https://github.com/kemepan/bikunavi-desktop.git
```

```bash
cd bikunavi-desktop && npm install
```

`npm install` は Electron 本体（Windows 用）も落としてくるので、数分かかる。

```bash
npm run fetch-core
```

Live2D Cubism Core を取得する。**これを飛ばすとキャラクターが表示されない。**
`vendor/` は容量とライセンスの都合で git に入れていないため、毎回この手順が要る。

```bash
npm run start:win
```

これで起動する。`npm start` は macOS 用（環境変数の書き方が cmd.exe では通らない）なので、
Windows では `start:win` を使う。

開発モードでは保存先が本番と分かれる（`%APPDATA%\bikunavi-desktop-dev`）。
配布版を入れていても、設定を壊さない。

## 音声入力も使う場合（任意）

**入れなくてもアプリは動く。**マイクからの入力（ハンズフリー会話・録音ボタン）が
使えないだけで、会話欄からの入力も読み上げも普通に動く。

### モデル

```bash
npm run fetch-whisper-model
```

`models/ggml-base.bin`（141MB）を落とす。

### 実行ファイル

whisper.cpp の公式リリースから取る。手順の詳細は `native/stt/README.md` にある。
ブラウザで済ませるなら:

1. [whisper.cpp v1.9.1](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.1) から
   **`whisper-bin-x64.zip`**（CPU版）をダウンロード
   ※ CUDA 版は 265MB あり、配布には重すぎるので使わない
2. zip を展開する
3. `native\stt\win32-x64\` フォルダを作り、展開した `Release\` から次をコピーする
   - `whisper-cli.exe`
   - `whisper.dll` / `ggml.dll` / `ggml-base.dll`
   - `ggml-cpu-*.dll`（複数ある。CPU の世代ごとに分かれていて実行時に選ばれるので全部入れる）

`SDL2.dll`、`whisper-server.exe`、`test-*.exe` などは要らない。びくたんは `whisper-cli` しか呼ばない。

## 会話AIを用意する

起動しただけでは会話できない。通知領域のアイコン → 🤖 会話AI から設定する。

一番手軽なのは [Google AI Studio](https://aistudio.google.com/apikey) の無料 API キー
（「Gemini APIキーを設定…」に貼る）。CLI（Claude Code / Codex / Gemini）は、
入っていれば自動で見つける。

繋がらない時は「🔎 検出状況をコピー」。探した場所と、AI が返したエラーがそのまま入る。

## 声を出す（任意）

[VOICEVOX](https://voicevox.hiroshiba.jp/) を入れると「猫使ビィ」の声で喋る。

**Windows には代替の音声が無い。**VOICEVOX を入れるまで、びくたんは声を出さず
吹き出しの文字だけになる（macOS には OS 標準の代替音声がある）。

## 直したら

```bash
npm run check
```

構文チェックと各ユーティリティの検査が走る。コミット前に通しておく。

## Windows でできないこと

- **アイコンの作り直しだけは macOS が要る。**
  `assets/app-icon.ico` はコミット済みなので普段は困らないが、
  `app-icon.png` を変えて `.ico` を作り直す（`npm run build-windows-icon`）には
  macOS の `sips` が要る。Windows では何もせず正常終了する。
- `npm run package` / `package:universal`（macOS 版のビルド）は動かない。

なお `npm run package:win`（Windows 配布物のビルド）は **Windows でも動く**。
CI（GitHub Actions の windows-latest）も同じコマンドで組んでいる。

## つまずきやすいところ

| 症状 | 原因 |
|---|---|
| `'BIKUNAVI_DATA_CHANNEL' is not recognized...` | `npm start` を使っている。`npm run start:win` を使う |
| 起動するがキャラクターが出ない | `npm run fetch-core` を飛ばしている |
| 通知領域にアイコンが見当たらない | Windows 11 が「^」の中に隠している。外へドラッグする |
| 話しかけても返事が無い | 会話AIが未設定。「🔎 検出状況をコピー」で確認する |
| 声が出ない | VOICEVOX が未インストール（Windows では無音が既定） |
| マイクが反応しない | whisper の実行ファイルとモデルが未配置 |
