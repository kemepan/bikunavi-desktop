# びくにたん Desktop

Live2Dキャラクター「びくにたん」をmacOSデスクトップに常駐させる、Electron製のAIコンシェルジュ実験アプリです。

サイト上で動いていたLive2Dモデルの挙動をベースに、デスクトップ常駐、会話、読み上げ、自動セリフ、音楽再生への反応を追加しています。

## 現在できること

- 透明背景・枠なし・最前面のLive2Dデスクトップ表示
- メニューバーの芽アイコンから表示切替、サイズ変更、位置リセット、終了
- キャラクター本体のドラッグ移動
- マウスオーバーで笑顔、手振り、吹き出し、会話入力欄を表示
- サイト版と同じLive2D物理演算、表情、モーション、呼吸、瞬き、視線追従
- 自由入力のAIコンシェルジュ会話
- `CHARACTER_SHEET.md` に基づくキャラクター性・口調
- 会話履歴の簡易表示
- AIニュースや時事・技術見出しを混ぜた自動セリフ
- ニュース・会話中に参照した情報のソースURLボタン表示
- VOICEVOX「猫使ビィ・ノーマル（speaker 58）」による読み上げ
- VOICEVOXが使えない場合のmacOS音声フォールバック
- 音声再生に合わせた口パク
- 音楽アプリやChrome/YouTubeで音声再生中のノリノリ反応

## 必要なもの

- macOS
- Node.js / npm
- Codex.app
  - 会話生成と自動セリフ生成にCodex CLIを利用します。
  - Codexアプリ側のログイン認証を使い、アプリ内にAPIキーは保存しません。
- VOICEVOX.app
  - 読み上げに使います。
  - 未起動の場合は、アプリ側からローカルエンジンを起動します。
- Live2D Cubism Core
  - `npm run fetch-core` で取得します。
  - `vendor/live2dcubismcore.min.js` はgit管理外です。

## 起動

```bash
npm install
npm run fetch-core
npm start
```

開発中の構文確認:

```bash
npm run check
```

## macOSログイン時の自動起動

macOSのプライバシー保護により、LaunchAgentからDocuments配下の開発フォルダを直接実行すると失敗することがあります。そのため、実行用一式を `~/Library/Application Support/BikunaviDesktop/` へコピーして起動します。

```bash
ditto . "$HOME/Library/Application Support/BikunaviDesktop"
chmod +x "$HOME/Library/Application Support/BikunaviDesktop/scripts/start-bikunavi-desktop.sh"
chmod +x "$HOME/Library/Application Support/BikunaviDesktop/native/now-playing"
sed "s#__HOME__#$HOME#g" \
  launchd/jp.a.bikunavi-desktop.plist.template \
  > "$HOME/Library/LaunchAgents/jp.a.bikunavi-desktop.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/jp.a.bikunavi-desktop.plist"
launchctl kickstart -k "gui/$(id -u)/jp.a.bikunavi-desktop"
```

ログ:

- `/tmp/bikunavi-desktop.out.log`
- `/tmp/bikunavi-desktop.err.log`

停止:

```bash
launchctl bootout "gui/$(id -u)/jp.a.bikunavi-desktop"
```

## AI機能の方針

- 通常会話は短い吹き出し向け回答を返します。
- Brain Vaultなどローカル情報の検索は、ユーザーが明示した場合だけ行う想定です。
- ニュース・最新情報・URL・出典に関する質問では、取得済み見出しや回答内URLをソースボタンとして表示します。
- 自動セリフでは、Google News RSSとHacker News APIの見出しを軽く参照します。
- 見出しだけで分からない内容は断定しないようにしています。

Codex CLIまわりは環境変数で上書きできます。

| 環境変数 | 既定値 | 用途 |
|---|---|---|
| `BIKUNAVI_CODEX_PATH` | `/Applications/Codex.app/Contents/Resources/codex` | Codex CLIのパス |
| `BIKUNAVI_CODEX_CWD` | `~/Documents/Brain` | Codexに渡す作業ディレクトリ |

## 素材と権利

- `assets/bikunavi/` に実行用Live2Dモデル一式を置いています。
- Live2Dモデル、テクスチャ、キャラクター素材の公開・再配布可否は、GitHub公開前に必ず確認してください。
- VOICEVOXおよび猫使ビィの利用条件は、配布形態に応じて公式の利用規約を確認してください。

迷ったら、まずはprivate repositoryで管理するのが安全です。

## 主なファイル

| ファイル | 役割 |
|---|---|
| `main.js` | Electronウィンドウ、Tray、LaunchAgent向け起動、Codex CLI、VOICEVOX、ニュース取得 |
| `renderer.js` | Live2D描画、表情、口パク、会話UI、ソースリンク表示、ドラッグ判定 |
| `style.css` | 透明画面、吹き出し、入力欄、ソースボタン |
| `index.html` | Canvas、吹き出し、Cubism Core読込 |
| `CHARACTER_SHEET.md` | びくたんの性格・話し方設定 |
| `assets/bikunavi/` | Live2Dモデル一式 |
| `native/now-playing.m` | macOS再生状態取得ヘルパーのソース |
| `native/now-playing` | ビルド済み再生状態取得ヘルパー |
| `scripts/fetch-cubism-core.mjs` | Cubism Core取得 |
| `scripts/start-bikunavi-desktop.sh` | LaunchAgent起動用スクリプト |
| `launchd/*.plist.template` | LaunchAgentテンプレート |

## GitHubへ保存する前のメモ

- `node_modules/`、`vendor/live2dcubismcore.min.js`、ローカル生成した `launchd/*.plist` はgit管理外です。
- 実行用コピー先 `~/Library/Application Support/BikunaviDesktop/` はgit管理しません。
- 素材の権利確認が済むまではprivate repository推奨です。
- このプロジェクトは、今後Brain Vaultから独立した単独リポジトリとして管理する想定です。
