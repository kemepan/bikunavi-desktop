# GitHub保存メモ

`bikunavi-desktop` をBrain Vaultから独立した単独プロジェクトとしてGitHubへ保存・管理するためのメモ。

現在のリモート:

```text
https://github.com/kemepan/bikunavi-desktop.git
```

## 推奨方針

- まずはprivate repositoryで保存する。
- Live2Dモデル、テクスチャ、キャラクター素材の公開・再配布可否を確認してからpublic化を検討する。
- `node_modules/`、Cubism Core、ローカル生成plist、実行用コピー先はgit管理しない。

## 事前確認

```bash
npm run check
git status --short
```

`.gitignore` により、以下は除外される想定。

- `node_modules/`
- `vendor/live2dcubismcore.min.js`
- `models/`
- `native/stt/*/whisper-cli`
- `native/stt/*/whisper-cli.exe`
- `launchd/*.plist`
- `dist/`
- `build/`
- `release/`
- `*.log`

## ローカル単独repo化

Brain Vault内のサブディレクトリをそのまま独立repoにする場合:

```bash
cd /path/to/bikunavi-desktop
git init
git add .
git status --short
git commit -m "Initial bikunavi desktop app"
```

Brain Vaultから完全に別フォルダへ切り出す場合:

```bash
ditto /path/to/current/bikunavi-desktop /path/to/new/bikunavi-desktop
cd /path/to/new/bikunavi-desktop
git init
git add .
git status --short
git commit -m "Initial bikunavi desktop app"
```

## GitHubへprivate repoとしてpush

GitHub CLIを使う場合:

```bash
gh repo create bikunavi-desktop --private --source=. --remote=origin --push
```

手動でGitHub側に空repoを作った場合:

```bash
git remote add origin git@github.com:YOUR_ACCOUNT/bikunavi-desktop.git
git branch -M main
git push -u origin main
```

## 初回clone後に必要なもの

```bash
npm install
npm run fetch-core
npm run fetch-whisper-model # 音声入力を使う場合
npm run check
npm start
```

## ログイン時自動起動の設定

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

停止:

```bash
launchctl bootout "gui/$(id -u)/online.bikunitan.bikunavi-desktop"
```

## 注意

- `main.js` は既定で `~/Documents/Brain` を会話AIの作業ディレクトリにする。
- 別のVaultや作業場所を使う場合は `BIKUNAVI_AI_CWD` を設定する。旧名 `BIKUNAVI_CODEX_CWD` も互換のため有効。
- Codex CLIの場所が違う場合は `BIKUNAVI_CODEX_PATH` を設定する。
- `native/now-playing` はmacOS向けのビルド済みバイナリ。必要なら `npm run build-media-helper` で作り直す。
- ローカルSTTバイナリとWhisperモデルは大きく、環境依存もあるためgit管理しない。詳しくは `native/stt/README.md`。
