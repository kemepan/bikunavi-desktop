# 素材・依存の権利確認（2026-07-10 時点）

`.app` の外部配布・リポジトリ公開の前提となる権利状況の棚卸し。個人利用（現状）の範囲では追加対応は不要。

## 同梱している素材・コード

| 対象 | 場所 | ライセンス / 状況 |
|------|------|------------------|
| びくにたん Live2Dモデル一式 | `assets/bikunavi_desktop/` | 自作（確認済み・下記） |
| Live2D Cubism Core | `vendor/live2dcubismcore.min.js` | Live2D Proprietary Software License。再配布は出版許諾（下記） |
| whisper.cpp バイナリ | `native/stt/darwin-arm64/whisper-cli` | MIT（whisper.cpp）。配布時にライセンス文同梱 |
| Whisper モデル | `models/ggml-base.bin` | MIT（OpenAI Whisper）。配布時にライセンス文同梱 |
| now-playing | `native/now-playing`（`.m` ソース同梱） | 自作 |
| npm 依存（pixi.js / pixi-live2d-display / @pixi/unsafe-eval / Electron） | `node_modules/` | すべて MIT（packager は BSD-2）。パッケージ時にライセンス表記を同梱するのが安全 |

## 参照するが同梱しないもの

| 対象 | 扱い |
|------|------|
| VOICEVOX エンジン | ユーザーの `/Applications/VOICEVOX.app` を利用。アプリには同梱しないので再配布には当たらない |
| 猫使ビィ 音声（speaker 58） | 生成音声を公開する場合は「VOICEVOX:猫使ビィ」のクレジット必須。商用可（企業利用は事前問い合わせ）。政治・宗教用途、別キャラと誤認される VTuber 的活動は禁止。規約: https://nekotukarb.wixsite.com/nekonohako/利用規約 |
| Codex CLI | ユーザーのローカルインストールを利用。同梱しない |

## Live2D Cubism SDK の出版許諾（リリースライセンス）

- 検証・開発は無償。**リリース時**に出版許諾契約の対象になる
- **個人・小規模事業者（直近年間売上 1,000万円未満）は契約・支払いとも免除**
- ただし「拡張性アプリケーション」（ユーザーが任意の Live2D モデルを読み込める汎用ビューア等）は規模によらず契約必須
  - びくにたんは固定モデルのみなので現状は非該当。**モデル差し替え機能を付けると該当する**ので注意
- 配布物に Live2D の権利表記（Cubism Core のライセンス通知）を含めること
- 参照: https://www.live2d.com/sdk/license/

## びくにたんモデル本体（確認済み 2026-07-10）

- 出典はサイト `bikunitan.online`（自サイト）の稼働版一式
- 制作経緯: ユーザー自作の6頭身キャラクターイラストをもとに、AI（nanobanana）でSDサイズ画像を出力 → ユーザー自身がパーツ分けし Live2D でモデリング
- 外部絵師・外部発注なし。元キャラデザインはユーザーの著作物、AI出力部分も Google の生成AI規約上ユーザーが商用含め利用可。パーツ分け・リギングで人の手による創作が大きく入っている
- → **第三者の権利者は存在せず、同梱・配布はユーザーの判断で可能**

## 結論（2026-07-10）

- **個人利用のみの現状**: 問題なし。対応不要
- **リポジトリを public にする場合**: モデルの権利はクリア済み。Cubism Core は gitignore 済み（`npm run fetch-core`）なので問題なし。公開自体は可能
- **`.app` を外部配布する場合**:
  1. Live2D 出版許諾: 個人・売上1,000万円未満なら免除（拡張性アプリ化しない限り）
  2. ライセンス表記の同梱: **対応済み（2026-07-10）**。`THIRD_PARTY_NOTICES.md`（リポジトリ直下）に集約し、`npm run package` で `.app` 内に同梱される
  3. VOICEVOX / 猫使ビィのクレジット: **対応済み（2026-07-10）**。`THIRD_PARTY_NOTICES.md` と README に「VOICEVOX:猫使ビィ」を記載
  4. ad-hoc 署名のままでは Gatekeeper に弾かれるため、Developer ID 署名＋公証が実務上必要（権利とは別件）
- **やってはいけない変更**: ユーザーが任意の Live2D モデルを読み込める機能（モデル差し替え）を付けると「拡張性アプリケーション」となり、規模によらず Live2D 社との出版許諾契約が必須になる
