# サードパーティライセンス表記

本アプリ「びくたん」（bikunavi-desktop）が使用・同梱しているサードパーティ製ソフトウェア・素材の権利表記です。

## Live2D Cubism Core

- ファイル: `vendor/live2dcubismcore.min.js`
- © Live2D Inc.
- 本ソフトウェアには Live2D 社が開発した Live2D Cubism Core が含まれています。
- 「Live2D Proprietary Software 使用許諾契約書」に基づき使用しています。
  - 日本語: https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_jp.html
  - English: https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html

## VOICEVOX / 猫使ビィ

- 読み上げ音声: **VOICEVOX:猫使ビィ**
- VOICEVOX エンジンは本アプリに同梱していません。利用者の環境にインストールされた VOICEVOX（https://voicevox.hiroshiba.jp/）を呼び出して使用します。
- VOICEVOX ソフトウェア利用規約: https://voicevox.hiroshiba.jp/term/
- 猫使シリーズ利用規約: https://nekotukarb.wixsite.com/nekonohako/利用規約

## OtoLogic — ポモドーロジングル

- ファイル: `assets/sounds/pomodoro-start-bell.mp3`
  - 素材名: Winning Bell 01-11 (Far-Strong)
- ファイル: `assets/sounds/pomodoro-finish-bell.mp3`
  - 素材名: Winning Bell 01-12 (Far-Strong)
- ファイル: `assets/sounds/thinking-countdown.mp3`
  - 素材名: Countdown 05-1
- 音素材提供: [OtoLogic](https://otologic.jp/)
- ライセンス: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)
- 利用規約: https://otologic.jp/free/license.html

## whisper.cpp

- ファイル: `native/stt/darwin-arm64/whisper-cli`、`native/stt/darwin-x64/whisper-cli`
- Copyright (c) 2023-2024 The ggml authors
- MIT License（下記全文）
- https://github.com/ggml-org/whisper.cpp

## OpenAI Whisper モデル

- ファイル: `models/ggml-base.bin`（whisper.cpp 形式に変換された OpenAI Whisper base モデル）
- Copyright (c) 2022 OpenAI
- MIT License（下記全文）
- https://github.com/openai/whisper

## @anthropic-ai/sdk

- Copyright 2023 Anthropic, PBC.
- MIT License（下記全文）
- https://github.com/anthropics/anthropic-sdk-typescript

## pixi.js

- Copyright (c) 2013-2017 Mathew Groves, Chad Engler
- The MIT License（下記全文）
- https://github.com/pixijs/pixijs

## @pixi/unsafe-eval

- Copyright (c) 2013-2019 Mathew Groves, Chad Engler
- The MIT License（下記全文）
- https://github.com/pixijs/pixijs

## pixi-live2d-display

- Copyright (c) 2020 Guan
- MIT License（下記全文）
- https://github.com/guansss/pixi-live2d-display

## Electron

- Copyright (c) Electron contributors
- Copyright (c) 2013-2020 GitHub Inc.
- MIT License（下記全文）
- https://github.com/electron/electron
- Electron に含まれる Chromium・Node.js 等のライセンスは、配布物内の `ELECTRON_LICENSE` および `LICENSES.chromium.html` を参照してください。

---

## MIT License 全文

上記で「MIT License」と記載した各ソフトウェアには、それぞれの著作権者名で以下の条文が適用されます。

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

※ 各パッケージのライセンス原文は、同梱の `node_modules/<パッケージ名>/LICENSE` にも含まれています。

---

## 本アプリ独自の素材

- Live2D モデル「びくたん」（`assets/bikunavi_desktop/`）およびキャラクターデザインは本アプリ制作者の著作物です。無断での再配布・転用はできません。
- `native/now-playing` は自作（ソース: `native/now-playing.m`）。
