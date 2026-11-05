// ビルド時に外から入ってくるものの、期待するハッシュ。
//
// **ここが「配布物に何が混ざるか」の一覧になる。** HTTPS は経路を守るだけで、
// 上流のファイルが差し替わったことは教えてくれない。固定しておけば、中身が
// 変わった時に黙って同梱されるのではなく、取得の段階で止まる。
//
// 値はすべて、v0.4.1 として実際に配った現物か、発行元のメタデータで確かめた。
// 入れ替える時は、何をどう確かめたかを一緒に書き足す。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PINS = {
  // Live2D Cubism Core。URL が「最新」を指しているので、上流が新版を出すと
  // ここで止まる。**止まったら壊れたのではなく、知らせている。** 新しい版で
  // 描画を確かめてから値を入れ替える（キャラクターが出なくなる類の変更が
  // 混ざっていないかは、動かさないと分からない）。
  //
  // 2026-11-05: 手元の vendor/live2dcubismcore.min.js の実測値。
  // Cubism Core 5.1.0 として v0.1.0〜v0.4.1 で配ってきたもの。
  "live2dcubismcore.min.js":
    "25ae938cb4fe282ce189b357bcc97e603d1e1f7ec78bf04150d401c23cdc792f",

  // Whisper のモデル。huggingface の LFS は x-linked-etag に sha256 を返すので、
  // 発行元の値と手元の現物が一致することを確かめてある（2026-11-05）。
  "ggml-base.bin":
    "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",

  // whisper.cpp の Windows 実行ファイル一式。GitHub の Release API が返す
  // digest と同じ値（2026-11-05 に確認）。タグ v1.9.1 のアセット。
  //
  // arm64 版の Windows アセットは上流に存在しない（Win32 と x64 だけ）。
  // ここに無い名前を要求された時は、404 の前に分かる形で止めたい。
  "whisper-bin-x64.zip":
    "7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539",

  // ここから下は npm から来るが、**画面に読み込まれる事前ビルド済みの
  // バンドル**なので同じ扱いにする。node_modules から vendor へ写して、
  // どの実体を配ったのかを残す（scripts/vendor-browser-bundles.mjs）。
  //
  // 2026-11-05: pixi.js 6.5.10 / @pixi/unsafe-eval 6.5.10 /
  // pixi-live2d-display 0.4.0 の dist から実測。版を上げる時は、
  // ここで止まるので描画を確かめてから入れ替える。
  "pixi.min.js":
    "403f2f2ee8145fa17f60c5c89403056efe2680e5096ec2762036486914ed19c5",
  "unsafe-eval.min.js":
    "94bb4bfdbd015087772ee03bc4117e253c326e8ca73a61646bd331b22f6847ad",
  "cubism4.min.js":
    "af1267e6d52759b245766c578d905bfa025b532d5c3cc727c370957c4409e21b"
};

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// 取得したものが、固定した値と一致するか。合わなければ書き込む前に止める。
export function assertPinned(name, buffer) {
  const expected = PINS[name];
  if (!expected) {
    throw new Error(
      `ハッシュを固定していないものは取得しません: ${name}\n` +
      "scripts/download-pins.mjs に、発行元で確かめた値を追記してください。\n" +
      `登録済み: ${Object.keys(PINS).join(" / ")}`
    );
  }
  const actual = sha256(buffer);
  if (actual !== expected) {
    throw new Error(
      `${name} の中身が、固定した値と違います。\n` +
      `  期待: ${expected}\n` +
      `  実際: ${actual}\n` +
      "上流が差し替わった可能性があります。**そのまま同梱しないでください。**\n" +
      "新しい版で動作を確かめたうえで、scripts/download-pins.mjs の値を\n" +
      "入れ替えてから、もう一度実行してください。"
    );
  }
  return buffer;
}

// 手元に既に置かれているものが、固定した値と合っているか。
// 取得スクリプトを通さずに差し替わった場合に気づけるようにする。
export function verifyExistingFile(name, filePath) {
  if (!fs.existsSync(filePath)) return { name, status: "なし" };
  const actual = sha256(fs.readFileSync(filePath));
  const expected = PINS[name];
  if (!expected) return { name, status: "固定なし" };
  return { name, status: actual === expected ? "一致" : "不一致", actual, expected };
}

export function projectRoot(importMetaUrl) {
  return path.dirname(path.dirname(new URL(importMetaUrl).pathname));
}
