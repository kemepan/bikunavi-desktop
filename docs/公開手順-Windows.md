# Windows 版の公開手順

macOS 版（`公開手順-v0.1.0.md`）と対になるもの。**配布物は macOS 上で作る**
（アイコンの生成に `sips` が要るため）。

## 1. 中身を揃える

`vendor/` と `models/`、whisper のバイナリは gitignore されているので、
クローンしただけでは揃っていない。

```bash
npm run fetch-core
```

```bash
npm run fetch-whisper-model
```

```bash
npm run fetch-whisper-binaries
```

`fetch-core` を飛ばすと**キャラクターの出ない配布物**ができる。
`package:win` が検査で止めるが、先に揃えておく方が早い。

whisper（音声入力）は無くても配れる。その場合はマイクが使えないだけで、
会話欄からの入力と読み上げは動く。

## 2. 組む

```bash
npm run package:win
```

`dist/bikutan-win32-x64/` ができる。中には `bikutan.exe` のほか、
`はじめにお読みください.md`（＝`DISTRIBUTION_README_WIN.md`）、`LICENSE.md`、
`THIRD_PARTY_NOTICES.md` が入る。

`.exe` のプロパティ（右クリック→プロパティ→詳細）には、製品名・会社名・
説明・著作権が入る。署名していないアプリなので、素性が見えるようにしてある。

## 3. zip に固めて SHA-256 を出す

```bash
npm run release:win
```

`dist/bikutan-win-x64-v<version>.zip` を作り、サイズと SHA-256 を表示する。
固める前に、配布物の中身（`bikutan.exe`、説明書き、Cubism Core、モデル一式）が
揃っているかを検査する。

**この SHA-256 は必ずリリースノートへ載せる。** 配布物の説明書きに
「配布時に示された SHA-256 と一致することを確認してください」と書いてあるので、
載せないと確かめようがない。

受け取った人の確認方法（説明書き側にも同じことを書く）:

```
certutil -hashfile bikutan-win-x64-vX.Y.Z.zip SHA256
Get-FileHash bikutan-win-x64-vX.Y.Z.zip
```

## 4. Release を作る

```bash
gh release create vX.Y.Z "dist/bikutan-win-x64-vX.Y.Z.zip" --repo kemepan/bikunavi-desktop --title "..." --notes-file docs/リリースノート-vX.Y.Z.md
```

**公開リポジトリ（`origin` = `kemepan/bikunavi-desktop`）へ出す。**
開発中のブランチは非公開側（`private` = `kemepan/bikunavi-desktop-private`）に
あるので、remote を取り違えないこと。

macOS 版と同時に出す場合は、1つの Release へ両方の zip を添付し、
SHA-256 を並べて載せる。

## 署名について

Windows 版はコード署名を受けていない。起動時に必ず SmartScreen の
「WindowsによってPCが保護されました」が出る（「詳細情報」→「実行」で進める）。

説明書きにその旨と、必ず配布元から直接受け取ることを書いてある。
**署名を取るまでは自動更新も入れない**（更新経路が署名なしのままだと、
入れ替えの安全性を担保できないため）。

## 確認すること

配る前に、Windows 実機で最低限これだけは見る。

1. zip を展開して `bikutan.exe` が起動するか（zip の中から直接実行しない）
2. **キャラクターが表示されるか**（`fetch-core` 忘れの検出）
3. 通知領域のアイコンが出るか。びくたんの右クリックでメニューが開くか
4. 会話AIを設定して返事が来るか
5. しばらく放置して、ウィンドウが大きくならないか
