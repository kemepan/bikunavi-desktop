# びくたん Desktop

Live2Dキャラクター「びくたん」をmacOSデスクトップに常駐させる、Electron製のAIコンシェルジュアプリです。

ビルド済みアプリは [Releases](https://github.com/kemepan/bikunavi-desktop/releases) からダウンロードできます（Apple Silicon / Intel 両対応）。初回起動の手順は下記「利用条件・配布版について」を見てください。

サイト上で動いていたLive2Dモデルの挙動をベースに、デスクトップ常駐、会話、読み上げ、自動セリフ、音楽再生への反応を追加しています。

## 資料ナビ

詳しい仕様・開発手順・今後の課題は `docs/` に整理しています。

| 目的 | 資料 |
|---|---|
| 資料全体の目次 | [`docs/README.md`](docs/README.md) |
| 今の機能・構成 | [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) |
| 開発・検証・実行版への反映手順 | [`docs/DEVELOPMENT_WORKFLOW.md`](docs/DEVELOPMENT_WORKFLOW.md) |
| UI改善や配布準備などの課題 | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| 実装履歴・引き継ぎ | [`DEVELOPMENT_NOTES.md`](DEVELOPMENT_NOTES.md) |
| びくたんの性格・話し方 | [`CHARACTER_SHEET.md`](CHARACTER_SHEET.md) |

## 現在できること

- 透明背景・枠なし・最前面のLive2Dデスクトップ表示
- メニューバーの芽アイコンから表示切替、サイズ変更、位置リセット、終了
- キャラクター本体のドラッグ移動
- マウスオーバーで笑顔、手振り、吹き出し、会話入力欄を表示
- `⌘⇧B` のグローバルショートカットで、どのアプリからでも会話入力欄を開く
- サイト版と同じLive2D物理演算、表情、モーション、呼吸、瞬き、視線追従
- 自由入力のAIコンシェルジュ会話
- 会話入力欄のマイクボタンによる音声入力
  - `getUserMedia`で録音し、WAV化してローカルSTTへ渡す構成
  - `whisper.cpp`互換バイナリとモデルが未設定の場合は録音のみ行い、文字起こしは保留
- `CHARACTER_SHEET.md` に基づくキャラクター性・口調
- `CHARACTER_QUESTIONS.json` の問答集から時々質問し、回答を会話・自動セリフの個性へ反映
- メニューバーの「キャラカスタム」から質問を今すぐ呼び出し可能
- 「ことば帳」「思い出帳」に教わった表現や一緒の出来事を保存し、後日の会話で時々思い出す
- `BIKUTAN_GROWTH_QUESTIONS.json`を使い、びくたん自身の好みや考えをユーザーとの問答で育てる
- 好きな音楽ジャンル・雰囲気を質問として覚え、音楽の話題になった時だけ自然に会話へ混ぜる
- びくたんがしている小さな作業や勉強を、時々自動セリフとして話す（会話で「何してるの？」と聞くと踏まえて答える）
- メニューバーから「日記をつける」から今日の要点を3〜5行で保存し、最近の日記を表示可能
- 会話履歴の簡易表示
- AIニュースや時事・技術見出しを混ぜた自動セリフ
- 家事・整理・時短などの生活ハック系見出しを混ぜた自動セリフ
- 日付ベースの「今日のびくたん占い」（短文に分けて読み上げ）
- びくたんがたまに今の気分を質問し、答えた内容で心理学風の短いミニ占いを返す
- メニューバーの「びくたん占い」から、今日の占い／気分でミニ占いを呼び出し可能
- 占いのおすすめBGMには、雰囲気名でYouTube検索するリンクを表示
- メニューバーから直近20件の「最近のセリフ」を表示
- ニュース・会話中に参照した情報のソースURLボタン表示
- ソース付き・長めの情報共有セリフは、読み上げ後もしばらく吹き出しを残す
- VOICEVOX「猫使ビィ・ノーマル（speaker 58）」による読み上げ
- VOICEVOXが使えない場合のmacOS音声フォールバック
- 音声再生に合わせた口パク
- 音声入力はローカルSTT前提。`native/stt/<platform>-<arch>/whisper-cli` と `models/ggml-base.bin`、または環境変数 `BIKUNAVI_WHISPER_BIN` / `BIKUNAVI_WHISPER_MODEL` を使います。
- 音楽アプリやChrome/YouTubeで音声再生中のノリノリ反応
- ポモドーロ中でも音楽再生中はノリノリ反応を継続
- macOSスリープ中は自動セリフと読み上げを停止し、復帰後に再開
- ウィンドウ位置・サイズ・各種設定・セリフ履歴・会話履歴の永続化（再起動後も保持）
- メニューバーからの設定: 自動移動ON/OFF、音楽反応ON/OFF、自動セリフの間隔（30秒/1分/2分）、履歴の消去
- 会話回答・セリフ履歴のコピーボタン
- メニューバーから使えるポモドーロタイマー
  - 90分作業
  - 25分作業
  - 15分作業
  - 一時停止・再開・停止
  - 90分作業は15分休憩、25分作業は5分休憩へ自動移行
  - 15分作業は深呼吸コメントを挟んで続行
  - ポモドーロ中はマウスオーバーで一時停止・再開・停止ボタンを表示

## 必要なもの

- macOS 11以降
- Node.js / npm
- 会話AI（いずれか1つ。なくても定型セリフ・占い・ポモドーロ等は動きます）
  - **Codex CLI**（ChatGPT.app／旧Codex.appに同梱）／ **Claude Code CLI** ／ **Gemini CLI** — 各CLIのログイン認証をそのまま使います。
  - **Gemini API（高速）** — トレイメニュー「会話AI」からAPIキーを設定します。キーは `~/.gemini/.env` に権限 `600` で保存されます。無料枠では入力・出力がGoogleの製品改善に利用される場合があります。
  - **Claude API** — トレイメニュー「会話AI」からAPIキー（sk-ant-…）を設定します。キーは `state.json` に平文保存されるため共有マシンでは注意してください。
  - 既定は「自動」で、見つかったAIを上記の順で使います。トレイメニュー「会話AI」で固定選択もできます。
- VOICEVOX.app
  - 読み上げに使います。
  - 未起動の場合は、アプリ側からローカルエンジンを起動します。
- Live2D Cubism Core
  - `npm run fetch-core` で取得します。
  - `vendor/live2dcubismcore.min.js` はgit管理外です。
- ローカル音声認識（任意）
  - `whisper.cpp`互換の `whisper-cli`
  - `npm run fetch-whisper-model` で `models/ggml-base.bin` を取得できます。
  - 未設定でもアプリは起動しますが、マイク入力の文字起こしは行われません。

## 起動

```bash
npm install
npm run fetch-core
npm run fetch-whisper-model # 音声入力を使う場合
npm start
```

開発中の構文確認:

```bash
npm run check
```

## .app の作成（ダブルクリック起動）

```bash
npm run package            # Apple Silicon 用（開発時の確認向け・速い）
npm run package:universal  # Intel + Apple Silicon 両対応（配布向け）
```

`dist/びくたん-darwin-arm64/`（または `-universal/`）に `びくたん.app` が生成されます。ad-hoc署名済みなので、この Mac 上ではダブルクリックで起動できます（他の Mac に配布する場合は正式な署名・公証が必要）。

配布ZIPにはApple Silicon／Intel両方の音声認識バイナリを同梱します。ソースから自分でビルドする場合、`native/stt/<platform>-<arch>/whisper-cli` が無ければ音声入力だけ無効になります（`brew install whisper-cpp` でも代替可）。

## セキュリティ構成

- Renderer は `nodeIntegration: false` / `contextIsolation: true` / `sandbox: true`
- Node 連携は `preload.js` の contextBridge（許可チャンネルのみ）経由
- ファイル配信は独自スキーム `bikunavi://`（アプリフォルダ外へのアクセスは拒否）
- CSP 設定済み。pixi.js の動的コード生成は `@pixi/unsafe-eval` で CSP を緩めず対応

## 設定・履歴の保存先

配布版は `~/Library/Application Support/bikunavi-desktop/state.json`、開発版（`npm start` とLaunchAgent常駐版）は `~/Library/Application Support/bikunavi-desktop-dev/state.json` に保存します。ウィンドウ位置・サイズ・メニュー設定・セリフ履歴（20件）・会話履歴（10件）・キャラカスタム回答・ことば帳・思い出帳・日記（最大14日分）が含まれます。

開発版を初めて反映するときは `deploy-launchagent.sh` が配布版の既存データを開発用保存先へ一度だけ複製します。その後は別々に更新されるため、両方を起動してもデータを上書きし合いません。

## 保存データと外部通信

- 音声入力は同梱のWhisperでローカル処理し、録音音声を外部へ送信しません。
- AI会話や自動セリフを利用すると、直近の会話、キャラクター設定への回答、ことば帳・思い出帳・日記、取得済みニュース見出し等が、選択したAIサービスへプロンプトとして送られる場合があります。
- クリップボード内容は、クリップボードについて明示的に質問した場合だけAIへ渡します。
- Claude APIキーは `state.json` に平文保存し、Anthropic APIの認証以外には使用しません。
- Claude APIキーはメニューバーの「会話AI」→「Claude APIキーを削除」で消去できます。保存データをすべて初期化する場合は、びくたんを終了してから上記の `state.json` を削除します。
- 自動セリフ用の公開見出し取得ではGoogle News RSSとHacker News APIへ接続します。
- 本アプリ独自の収集サーバーや広告・解析SDKはありません。

## 手動での起動・再起動

メニューバーの🌱から「終了」するとアプリごと終了します（アイコンも消えます）。再び起動するには:

```bash
launchctl kickstart -k "gui/$(id -u)/online.bikunitan.bikunavi-desktop"
```

または `npm run package` で作った `dist/びくたん-darwin-arm64/びくたん.app` をダブルクリックでも起動できます。

コードを変更した後の反映は、次のスクリプトで一括実行できます（コピー→検証→再起動）:

```bash
./scripts/deploy-launchagent.sh
```

## macOSログイン時の自動起動

macOSのプライバシー保護により、LaunchAgentからDocuments配下の開発フォルダを直接実行すると失敗することがあります。そのため、実行用一式を `~/Library/Application Support/BikunaviDesktop/` へコピーして起動します。

```bash
ditto . "$HOME/Library/Application Support/BikunaviDesktop"
chmod +x "$HOME/Library/Application Support/BikunaviDesktop/scripts/start-bikunavi-desktop.sh"
chmod +x "$HOME/Library/Application Support/BikunaviDesktop/native/now-playing"
sed "s#__HOME__#$HOME#g" \
  launchd/online.bikunitan.bikunavi-desktop.plist.template \
  > "$HOME/Library/LaunchAgents/online.bikunitan.bikunavi-desktop.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/online.bikunitan.bikunavi-desktop.plist"
launchctl kickstart -k "gui/$(id -u)/online.bikunitan.bikunavi-desktop"
```

ログ:

- `/tmp/bikunavi-desktop.out.log`
- `/tmp/bikunavi-desktop.err.log`

停止:

```bash
launchctl bootout "gui/$(id -u)/online.bikunitan.bikunavi-desktop"
```

## AI機能の方針

- 通常会話は短い吹き出し向け回答を返します。
- Brain Vaultなどローカル情報の検索は、ユーザーが明示した場合だけ行う想定です。
- ニュース・最新情報・URL・出典に関する質問では、取得済み見出しや回答内URLをソースボタンとして表示します。
- 自動セリフでは、Google News RSSとHacker News APIの見出しを軽く参照します。
- 生活ハック系は、机まわり、整理、家事時短、休憩、作業環境など軽く試せる話題に寄せます。
- 見出しだけで分からない内容は断定しないようにしています。
- 占いは生年月日を使わず、日付から作る軽い五行風の気分づけです。本格的な四柱推命ではありません。

会話AIまわりは環境変数で上書きできます。

| 環境変数 | 既定値 | 用途 |
|---|---|---|
| `BIKUNAVI_CODEX_PATH` | ChatGPT.app／旧Codex.app／PATHから自動検出 | Codex CLIのパス |
| `BIKUNAVI_CLAUDE_CLI_PATH` | PATH等から自動検出 | Claude Code CLIのパス |
| `BIKUNAVI_GEMINI_CLI_PATH` | PATH等から自動検出 | Gemini CLIのパス |
| `BIKUNAVI_GEMINI_MODEL` | `gemini-3.1-flash-lite` | Gemini API使用時のモデル |
| `BIKUNAVI_AI_CWD`（旧 `BIKUNAVI_CODEX_CWD`） | `~/Documents/Brain`（無ければホーム） | CLIに渡す作業ディレクトリ |
| `BIKUNAVI_CLAUDE_MODEL` | `claude-opus-4-8` | Claude API使用時のモデル |

## 利用条件・配布版について

- アプリの個人利用は無料です。スクリーンショットや配信画面への映り込みも自由です。
- 本リポジトリのソースコード、Live2Dモデル、キャラクター「びくにたん」の権利は制作者（びくに / bikunitan.online）が保持します。アプリ・モデルの再配布、モデルデータの抽出・流用、コードの転用は許可していません。詳細は [`LICENSE.md`](LICENSE.md) を確認してください。
- 配布版はAppleのDeveloper ID署名・公証を受けていません。まず「システム設定」→「プライバシーとセキュリティ」→「このまま開く」を利用してください。`xattr -cr` は、公式Releaseから取得してSHA-256を確認したアプリが、それでも開けない場合の代替手順です。

## 素材と権利

- `assets/bikunavi_desktop/` に実行用Live2Dモデル一式を置いています。モデル・キャラクターデザインは制作者の自作で、権利確認済みです（経緯は `docs/RIGHTS_CHECK.md`）。
- サードパーティのライセンス表記は `THIRD_PARTY_NOTICES.md` に集約しています（Live2D Cubism Core、pixi.js、pixi-live2d-display、Electron、whisper.cpp、Whisperモデル）。このファイルは `npm run package` で `.app` 内にもそのまま同梱されます。
- 読み上げ音声: **VOICEVOX:猫使ビィ**（エンジンは同梱せず、利用者のVOICEVOX.appを使用）。

## 主なファイル

| ファイル | 役割 |
|---|---|
| `main.js` | Electronウィンドウ、Tray、LaunchAgent向け起動、Codex CLI、VOICEVOX、ニュース取得、設定・履歴の永続化 |
| `preload.js` | contextBridge。Rendererへ許可したIPCチャンネルだけを公開 |
| `renderer.js` | Live2D描画、表情、口パク、会話UI、ソースリンク表示、ドラッグ判定 |
| `style.css` | 透明画面、吹き出し、入力欄、ソースボタン |
| `index.html` | Canvas、吹き出し、Cubism Core読込 |
| `CHARACTER_SHEET.md` | びくたんの性格・話し方設定 |
| `assets/bikunavi_desktop/` | Live2Dモデル一式 |
| `native/now-playing.m` | macOS再生状態取得ヘルパーのソース |
| `native/now-playing` | ビルド済み再生状態取得ヘルパー |
| `native/stt/` | OS/CPU別のローカル音声認識バイナリ置き場 |
| `scripts/fetch-cubism-core.mjs` | Cubism Core取得 |
| `scripts/fetch-whisper-model.mjs` | whisper.cpp向けモデル取得 |
| `scripts/start-bikunavi-desktop.sh` | LaunchAgent起動用スクリプト |
| `launchd/*.plist.template` | LaunchAgentテンプレート |

## GitHubへ保存する前のメモ

- `node_modules/`、`vendor/live2dcubismcore.min.js`、`models/`、ローカルSTTバイナリ、ローカル生成した `launchd/*.plist` はgit管理外です。
- 実行用コピー先 `~/Library/Application Support/BikunaviDesktop/` はgit管理しません。
- GitHub保存・公開の詳しい手順は [`docs/GITHUB_SETUP.md`](docs/GITHUB_SETUP.md) と [`docs/公開手順-v0.1.0.md`](docs/公開手順-v0.1.0.md) に整理しています。
