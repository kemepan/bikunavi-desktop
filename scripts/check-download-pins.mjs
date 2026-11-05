// 固定したハッシュと、手元の現物が合っているか。
//
// 取得スクリプトを通さずに差し替わった時（手で置いた・古い控えを戻した）に
// 気づけるようにする。手元に無いものは飛ばす（音声入力を使わない人は
// モデルを落としていない）。
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PINS, assertPinned, sha256, verifyExistingFile } from "./download-pins.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- 現物の照合 ---
const targets = [
  ["live2dcubismcore.min.js", path.join(root, "vendor", "live2dcubismcore.min.js")],
  ["pixi.min.js", path.join(root, "vendor", "pixi.min.js")],
  ["unsafe-eval.min.js", path.join(root, "vendor", "unsafe-eval.min.js")],
  ["cubism4.min.js", path.join(root, "vendor", "cubism4.min.js")],
  ["ggml-base.bin", path.join(root, "models", "ggml-base.bin")]
];
const report = [];
for (const [name, filePath] of targets) {
  const result = verifyExistingFile(name, filePath);
  report.push(`${name}: ${result.status}`);
  assert.notEqual(
    result.status,
    "不一致",
    `${name} が固定した値と違います。\n  期待: ${result.expected}\n  実際: ${result.actual}\n` +
    "上流が差し替わったか、手で置き換えられています。配る前に確かめてください。"
  );
}

// --- 門そのものの検査 ---
{
  // 固定していない名前は通さない。
  assert.throws(() => assertPinned("見知らぬもの.zip", Buffer.from("x")), /固定していない/);
  // 中身が違えば通さない。
  assert.throws(() => assertPinned("ggml-base.bin", Buffer.from("ちがう")), /固定した値と違います/);
  // 合っていれば、渡したものがそのまま返る（呼び出し側がこれを書き込む）。
  const name = "live2dcubismcore.min.js";
  const fake = Buffer.from("");
  assert.equal(sha256(fake), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.throws(() => assertPinned(name, fake), /固定した値と違います/);
}

// 固定値は64桁の16進でなければ、どこかで壊れている。
for (const [name, digest] of Object.entries(PINS)) {
  assert.match(digest, /^[0-9a-f]{64}$/, `${name} の固定値の形がおかしい`);
}

console.log(`download-pins: OK（${report.join(" / ")}）`);
