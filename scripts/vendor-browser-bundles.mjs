// 画面が読み込む事前ビルド済みバンドルを、node_modules から vendor へ写す。
//
// **なぜ写すのか。** index.html から node_modules を直に読んでいたせいで、
// 配布物に node_modules ごと入っていた。そこには実行時には一切使わない
// ものまで付いてくる（pixi-live2d-display は gh-pages をなぜか実行時依存と
// して宣言しており、その下に脆弱性報告のある deploy 用の依存が連なる）。
//
// 読むのは dist の1ファイルだけなので、それだけを vendor へ置き、
// パッケージ自体は devDependencies へ下げる。packager は devDependencies を
// prune するので、配布物から丸ごと消える。
//
// vendor/ は「setup 時に用意する場所」。Cubism Core と同じ扱いで、
// リポジトリには置かず postinstall で生成する。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPinned } from "./download-pins.mjs";

const projectDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// 置き先の名前 → node_modules の中の実体
const BUNDLES = {
  "pixi.min.js": "pixi.js/dist/browser/pixi.min.js",
  "unsafe-eval.min.js": "@pixi/unsafe-eval/dist/browser/unsafe-eval.min.js",
  "cubism4.min.js": "pixi-live2d-display/dist/cubism4.min.js"
};

const vendorDirectory = path.join(projectDirectory, "vendor");
fs.mkdirSync(vendorDirectory, { recursive: true });

const placed = [];
for (const [name, source] of Object.entries(BUNDLES)) {
  const from = path.join(projectDirectory, "node_modules", source);
  if (!fs.existsSync(from)) {
    throw new Error(
      `${source} がありません。先に npm install を実行してください。\n` +
      "（このスクリプトは node_modules から写すだけで、取得はしません）"
    );
  }
  // 写す前に、どの実体なのかを確かめる。版が変わればここで止まる。
  const body = assertPinned(name, fs.readFileSync(from));
  fs.writeFileSync(path.join(vendorDirectory, name), body);
  placed.push(name);
}

console.log(`vendor へ置きました: ${placed.join(", ")}`);
