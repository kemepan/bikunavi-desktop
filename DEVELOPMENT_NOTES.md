# びくにたん Desktop — 開発履歴・引き継ぎ

最終更新: 2026-07-07

## 目的

サイト `bikunitan.online` で動いているLive2Dキャラクター「びくにたん」を、macOSデスクトップに常駐するAIコンシェルジュへ発展させる。

## 参照したサイト版

- リポジトリ: ローカルの `bikunitan.online/`
- モデル: `bikunitan.online/assets/live2d/bikunavi/`
- 挙動: `bikunitan.online/js/live2d-manager.js`
- 設定・セリフ: `bikunitan.online/js/config.js`
- 吹き出し等の見た目: `bikunitan.online/style.css`

初回に渡されたLive2D素材は旧版で、物理演算・表情・一部モーションが欠けていた。途中でサイト稼働版一式へ差し替えた。

## サイト版から引き継いだもの

- Live2Dモデル本体、テクスチャ、表示情報
- `bikunavi.physics3.json` の物理演算7系統
  - 体揺れY
  - 頭揺れ
  - 腕揺れ
  - 前髪
  - アクセ
  - あごリボン
  - 袖リボン
- 表情 `f01`〜`f06`
- `Wave` / `Happy` モーション
- 呼吸、ランダム瞬き、視線追従
- マウスオーバー時の笑顔、手振り、吹き出し
- ドラッグ中の驚き顔と専用セリフ
- サイト版由来の自動セリフ機構と緩やかな自動移動

## デスクトップ版で追加・変更したもの

### macOS常駐

- Electronの透明・枠なしウィンドウ
- 常に手前、全ワークスペース表示、Dock非表示
- メニューバーの `🌱` から操作
  - 表示のチェック切替
  - 常に手前の切替
  - サイズ「小／中／大」
  - 右下へ位置リセット
  - 終了
- キャラクターを5px以上ドラッグした時だけウィンドウ移動
- クリックだけでは移動しない
- 自動移動中でも、マウスオーバーした瞬間に停止

### サイズ・配置

サイズプリセットは、キャラクター領域に加えて上側260pxを吹き出し専用領域として持つ。

| サイズ | ウィンドウ |
|---|---:|
| 小 | 220 × 513 |
| 中 | 280 × 598 |
| 大 | 360 × 718 |

- キャラクター本体の表示領域は、吹き出し拡張前と同じ大きさ
- Live2Dの全Drawable頂点から実描画範囲を計算し、中央へフィット
- 「大 → 中 → 小」でも古いキャンバス寸法を使わないよう、リサイズ時は最新の `window.innerWidth/innerHeight` を使用
- 吹き出しの下端をキャラクター頭上5pxへ固定
- 文字量が増えた場合、吹き出しは上へ伸びる

### 会話UI

- マウスオーバーで一行入力欄を表示
- 質問中も質問文を残して「考え中です…」を表示
- 起動中は最大10件の質問・回答を画面側に保持
- `‹ 件数 ›` で過去の回答を切替
- `Esc` で会話欄を閉じる
- 会話操作が30秒ない場合、吹き出しをフェードアウトして通常状態・自動移動へ復帰
- 回答は原則180文字以内になるようAIへ指示
- 常時スクロールバーは使わず、表示上は質問80文字・回答240文字で省略

### 表情・口パク

- 考え中:
  - 目をほぼ閉じる
  - 口パクを止める
  - `thinking` / `f04` 系の表情
- 回答後:
  - 回答文字数に応じて約1.8〜6秒口パク
  - 笑顔へ移行
- `eyeSmile > 0.5` のにっこり目では通常瞬きを止め、表情崩れを防止
- 通常顔では2〜5秒間隔のランダム瞬き

### 音声読み上げ

- インストール済み `/Applications/VOICEVOX.app` のローカルエンジンAPIを使用
- 音声は `猫使ビィ・ノーマル`（speaker 58）に固定
- VOICEVOXエンジンをびくたんと一緒に自動起動
- 合成したWAVを一時ファイルへ保存し、`/usr/bin/afplay` で再生後に削除
- VOICEVOX起動・合成失敗時はmacOS `Sandy` へフォールバック
- AI回答と自動セリフを読み上げ
- メニューバーから読み上げ全体、自動セリフの読み上げ、速度3段階を設定
- 新しい発話が始まった場合は、前の音声を停止
- 実際の読み上げ終了通知に合わせて口パクを停止

### AIコンシェルジュ

- `/Applications/Codex.app/Contents/Resources/codex` のCodex CLIを利用
- Codexアプリのログイン認証を使用し、APIキーはアプリ側へ保存しない
- 各問い合わせは `codex exec` の一時セッション
- 起動オプション:
  - `--ephemeral`
  - `--ignore-user-config`
  - `--sandbox read-only`
  - `-C <BIKUNAVI_CODEX_CWD または ~/Documents/Brain>`
- アプリ起動中はmain側でも直近6往復をプロンプトへ渡す
- 通常は会話だけを行う
- ユーザーが「Brain内を探して」等と明示した時だけVaultを読み取り検索するよう指示
- `AGENTS.md` の個人記録・作業ログ等のルールを尊重
- 読み取り専用のため、変更依頼は実行せず提案と確認事項を返す
- 「クリップボード」「コピーした」等を含む依頼時だけ、現在のクリップボード本文をプロンプトへ添付
- 自動セリフはCodexで20個ずつまとめて生成し、約30秒ごとに一つ表示
- 自動セリフが残り5個未満になるとバックグラウンドで補充
- AI生成に失敗した場合はローカルの固定セリフ6個へフォールバック
- 自己紹介・ポエム・格言・抽象的な励ましは禁止し、作業仲間風の具体的な雑談を生成
- Google News日本向けRSSとHacker News公式APIから見出しを取得し、20個中4〜5個だけ軽い時事・技術ネタにする
- AIニュース専用RSS検索から取得した見出しは、参照IDとURLを保持する
- ニュース由来の自動セリフには、吹き出し下にソースボタンを表示する
- 会話回答も `{ text, sources }` 形式で扱い、参照した情報のURLをソースボタン化する
- 回答本文に直接URLが含まれた場合も、読み上げ対象からは外し、表示上のソースボタンへ分離する
- 見出し以上の断定を禁止し、事故・災害・戦争・犯罪・訃報・政争・健康不安等は自動セリフから除外

### 音楽再生への反応

- `native/now-playing` ヘルパーでmacOSの再生状態を取得する
- Chrome / YouTubeなど、MediaRemoteで拾えない場合は `pmset -g assertions` の音声再生情報も参照する
- 音楽再生中は自動移動を止め、笑顔で体・頭・上下位置をリズミカルに動かす

### 単独リポジトリ化準備

- GitHub保存を見据え、READMEを単独プロジェクト向けに更新
- ローカル絶対パスを含む `launchd/*.plist` はgit管理外にし、代わりに `launchd/*.plist.template` を追加
- Codex CLIのパスと作業ディレクトリを環境変数で上書き可能にした
  - `BIKUNAVI_CODEX_PATH`
  - `BIKUNAVI_CODEX_CWD`

## ファイルの役割

| ファイル | 役割 |
|---|---|
| `main.js` | Electronウィンドウ、Tray、移動、サイズ、Codex CLI呼び出し |
| `renderer.js` | Live2D描画、表情、物理、会話UI、履歴、ドラッグ判定 |
| `style.css` | 透明画面、吹き出し、会話欄 |
| `index.html` | Canvas・吹き出し・Cubism Core読込 |
| `assets/bikunavi/` | サイト稼働版Live2D一式 |
| `vendor/live2dcubismcore.min.js` | 公式配布先から取得するCubism Core（git管理外） |
| `scripts/fetch-cubism-core.mjs` | Cubism Core取得 |
| `launchd/jp.a.bikunavi-desktop.plist.template` | LaunchAgentテンプレート |

## 起動

```bash
npm install
npm run fetch-core
npm start
```

2026-07-06にLaunchAgentを追加。macOSログイン時に自動起動する。

- 原本: `launchd/jp.a.bikunavi-desktop.plist.template`
- 起動: `scripts/start-bikunavi-desktop.sh`
- 実行用コピー: `~/Library/Application Support/BikunaviDesktop/`
- `RunAtLoad: true`
- `KeepAlive: false`（メニューから終了した後、勝手に復活しない）
- LaunchAgentはmacOSのプライバシー保護によりDocuments配下を直接実行できないため、Vaultを原本、Application Supportを実行先とする
- 今後Vault側を編集した場合、Application Support側へ再コピーしてLaunchAgentを再起動する

## 次回以降の調整候補

1. `.app` 化し、ダブルクリック起動へ対応
2. ウィンドウ位置・サイズ・会話履歴の永続化
3. 吹き出し専用領域を常時確保せず、会話時だけ動的に上へ拡張
4. AIの書き込み操作に、差分表示とユーザー承認フローを追加
5. 「今日の予定」「Brain検索」「お願い」などのショートカット
6. ソースURL一覧、回答全文のコピー、履歴一覧、履歴削除
7. Codex応答のストリーミング表示
8. 自動移動・音楽反応のON/OFF・間隔・速度をメニュー設定化
9. GitHub private repositoryへの初回保存
10. 配布前のElectronセキュリティ改善
   - `nodeIntegration: true`
   - `contextIsolation: false`
   - `webSecurity: false`
   - CSP未設定
11. Electronの `console-message` 非推奨APIを更新

## 注意点

- `npm audit --omit=dev` は2026-07-05時点で0件。開発依存には警告が残る場合がある。
- Cubism Coreは `.gitignore` 対象。新環境では `npm run fetch-core` が必要。
- Live2Dモデルとサイト側素材の権利・配布条件は、`.app` を外部配布する前に再確認する。
- GitHubへ置く場合、素材の権利確認が済むまではprivate repository推奨。
- コミット・pushは未実施。
