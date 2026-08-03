# Windows対応 設計メモ（v0.4 / v0.5）

macOS でしか動かない箇所を洗い出し、置き換えの方針を決める。**実機が無い間は「macOS で従来どおり動く」を壊さない範囲**で進める。

## 依存の一覧と状況

| 依存 | 状況 | 方針 |
|---|---|---|
| **効果音の再生**（`afplay`） | ✅ 対応済み（2026-07-29） | ポモドーロのベルは renderer 側で鳴らす。考え中の音は他OSでは鳴らさない |
| **VOICEVOX の場所** | ✅ 対応済み（2026-07-30） | 候補から探す。`BIKUNAVI_VOICEVOX_ENGINE` が最優先 |
| **読み上げ音声の再生**（`afplay` 3箇所） | ✅ 対応済み（2026-07-31） | renderer の `Audio` で鳴らし、完了を IPC で返す（Base64渡し）。下記「読み上げの再生」は当時の検討メモ |
| **音声認識**（`speech-recognizer.app`） | ✅ 対応済み（2026-07-31） | Whisper へ寄せた（Windows は同梱 `whisper-cli.exe`、macOS は Apple Speech 優先のまま） |
| **再生中の曲**（`native/now-playing`） | ✅ 対応済み（2026-07-30） | macOS 限定機能として切り分けた。他OSでは「再生中の曲なし」を返す |
| **自動起動** | ✅ 対応済み（2026-07-30） | `app.setLoginItemSettings()` で両OS対応。設定メニューから入り切りできる |

## 読み上げの再生（次の大物）

> **2026-07-31 実装済み。** 以下は当時の検討メモ。結論: renderer の `Audio` で鳴らし、
> 音声は Base64 で渡し、完了は `companion:audio-finished` の IPC で返す形を採った。

`/usr/bin/afplay` を使う3箇所。**単に鳴らすだけでなく、制御が絡む**のが厄介なところ。

| 場所 | 何を鳴らすか | 必要な制御 |
|---|---|---|
| `playSpeechAudio` | 合成した音声（一括） | 停止できること |
| `playSpeechChunk` | 合成した音声（文単位） | **再生完了を待って次の文へ進む**、途中で止める |
| `maybePlayAizuchi` | 相づちの音声 | 停止できること |

### いまの作り

```
main が VOICEVOX で .wav を作る
  → afplay で鳴らす（子プロセス）
  → close イベントで「鳴り終わった」と分かる
  → Promise を解決して次の文へ
```

`speechProcess` を持っておき、`stopSpeech()` で `kill` する。**プロセスがあることが、そのまま「再生中」の印**になっている。

### 移すなら

renderer（Chromium）なら `Audio` で鳴らせる。ただし次が要る。

1. **完了を main へ返す往復。** 今は `child.on("close")` で分かるが、renderer で鳴らすなら `ended` イベントを IPC で返す必要がある
2. **停止の指示。** `stopSpeech()` から renderer へ「止めて」を送る
3. **音量。** `afplay -v` の代わりに `audio.volume`
4. **ファイルの受け渡し。** 一時ファイルのパスを renderer から読めるようにする（`bikunavi://` スキームか、Base64 で渡すか）

**4が一番の分かれ目。** 今は main がファイルを作って main が鳴らすので、パスをそのまま使える。renderer で鳴らすには、特権スキーム経由で読ませるか、データとして渡すかを決める必要がある。

### 判断を保留している点

- **renderer が閉じている時に鳴らせない。** 今は main だけで完結するので、吹き出しが出ていなくても音は出る。renderer 依存にすると、その前提が変わる
- **Windows で `afplay` 相当を使う手もある。** PowerShell の `Media.SoundPlayer` は .wav を鳴らせるが、起動が重く、音量調整ができない
- 実機が無いと**どちらが軽いか測れない**。ここは Windows 機が用意できてから決める方が無駄がない

## 音楽連動の切り分け

`native/now-playing`（Objective-C）は macOS の MediaRemote を叩いている。**Windows に同等の手段が無い**ため、機能ごと macOS 限定にする。

- 曲に合わせて踊る、音楽の話題を出す、といった動作は Windows では働かない
- **全機能同等を目指すとここで止まる。** 落とす判断を先にしておく
- 実装としては、`process.platform !== "darwin"` の時は「再生中の曲なし」を返すだけでよい

## 自動起動

| | macOS | Windows |
|---|---|---|
| 仕組み | LaunchAgent（plist） | スタートアップフォルダ or タスクスケジューラ |
| 現状 | `scripts/deploy-launchagent.sh` | 未着手 |

Electron には `app.setLoginItemSettings()` があり、**両OSで使える**。今は開発用に LaunchAgent を使っているが、配布物の自動起動はこちらへ寄せる方が素直。

## 進め方

1. ✅ 効果音の再生
2. ✅ VOICEVOX の場所
3. ✅ 音楽連動を macOS 限定として切り分ける
4. ✅ 自動起動を `app.setLoginItemSettings()` へ寄せる
5. ✅ 読み上げの再生（2026-07-31。renderer の `Audio` + IPC）
6. ✅ 音声認識を Whisper へ寄せる（2026-07-31）
7. ✅ Windows でビルドして動作確認（ビルドと CI は 2026-07-30、実機での確認と修正は 2026-08-03 に開始）

**ここまで全て完了。** 以降の Windows 対応は実機で見つかった不具合の修正フェーズに入っている。

### 自動起動について（2026-07-30 に追加）

これまで自動起動は `scripts/deploy-launchagent.sh`（LaunchAgent）だけで、**開発者向けの手順**だった。
配布版を使う人には手段が無かったので、設定メニューへ「パソコンを起動したら開く」を足した。

- `app.setLoginItemSettings()` は macOS も Windows も同じ呼び方で使える
- **開発中（`app.isPackaged === false`）は登録しない。** LaunchAgent と二重になって、びくたんが2人立ち上がる
- 起動のたびに保存値をOSへ反映する。アプリを入れ直すと登録が消えることがあるため
