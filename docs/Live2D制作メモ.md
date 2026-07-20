# Live2D 制作メモ（表情・モーションの使われ方）

最終更新: 2026-07-20（v0.2開発中）

モデル: `assets/bikunavi_desktop/bikunavi_desktop.model3.json`

## 現在の表情（exp3.json）— 2026-07-20 f07〜f09追加で全番一致

| ファイル | データの実体 | アプリでの用途 |
|---|---|---|
| f01 | ? | —（未使用・空き番） |
| f02 | にこにこ | joy: 通常会話・挨拶・回答のデフォルト |
| f03 | 驚き | surprised: 驚いた回答・ドラッグで掴まれた時 |
| f04 | 困り顔 | troubled: 謝罪・うまくできなかった時・困った時 |
| f05 | 泣き顔 | sad: 悲しい話・寂しい話・しんみりした話題 |
| f06 | キリッ | proud: 断言・張り切る回答 |
| f07 | ×マスク | ミュート連動（ミュート中は表情をマスクで固定） |
| f08 | 考え中 | thinking: 返答待ち（目とじパラメータと併用） |
| f09 | ウインク | wink: 冗談・軽口 |

- 「normal（素の顔）」は表情ファイルではなく、表情リセット＋パラメータ直制御で実現している。
- AIが回答ごとに joy / wink / proud / surprised / troubled / sad / normal を選んで表情が切り替わる。
  troubled / sad / normal のときは喜びモーション（Happy）は跳ねない。
- **再エクスポートするとmodel3.jsonのExpressions/Motions登録が消える**ので、書き出し後は
  Claude側でmodel3.jsonのマージが必要（2026-07-16と07-20の2回発生。要注意）。

## 現在のモーション（motion3.json）

| グループ | ファイル | 使われる場面 |
|---|---|---|
| Happy | happy.motion3.json | 嬉しい瞬間全般（normal以外の回答・占い表示・再生時など） |
| Wave | wave.motion3.json | チャット欄を開いた時・呼び出された時の手振り |

## 済んだこと（2026-07-20）

- f07×マスク・f08考え中・f09ウインクを追加（ユーザー作画）→ model3.jsonマージ＋アプリ連携済み。
- f04困り顔=troubled・f05泣き顔=sad としてAIの表情パレットに追加済み。

## 今後の候補（任意）

- **首かしげモーション** — 考え中の強化。表情+モーションで分かりやすくなる。
- 「聞いてる」表情/モーション（音声入力・ハンズフリー導入時に）。
- f01の用途決め（現在空き番）。

## 再エクスポート時の注意

- テクスチャアトラスは **2048px** で書き出す（1024だとぼやける。2026-07-16に対応済み）。
- 書き出し後は `assets/bikunavi_desktop/` を差し替え → `./scripts/deploy-launchagent.sh` で反映。
- 表情・モーションを増減したら、model3.json の Expressions/Motions 登録と、
  renderer.js の `EXPRESSION_NAMES` / `ANSWER_EMOTES`、emote-utils.js の `CHAT_EMOTES` を同期すること（アプリ側対応）。
