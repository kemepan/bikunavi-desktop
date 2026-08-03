// assets/app-icon.png からWindows用ICOを生成する。
//
// macOS用（build-app-icon.mjs）と分けてあるのは、必要なサイズも
// コンテナの構造も別物だから。ICNSはビッグエンディアンの4文字タグ、
// ICOはリトルエンディアンの固定長テーブル。同じ関数に押し込むと
// どちらの都合で書かれた行なのか読めなくなる。
//
// ICOの中身はPNGのまま入れている（Windows Vista以降はPNG圧縮の
// アイコンを読める）。ICNS側と同じやり方で、変換ライブラリが要らない。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const sourcePath = path.join(projectDirectory, "assets", "app-icon.png");
const outputPath = path.join(projectDirectory, "assets", "app-icon.ico");
// 16=通知領域とタイトルバー、24/32=タスクバー、48=エクスプローラの中、
// 64/128/256=大きいアイコン表示とプロパティ画面。
// 拡大率125%/150%の画面では24や48が選ばれるので、間を飛ばさない。
const iconSizes = [16, 24, 32, 48, 64, 128, 256];

const ICONDIR_LENGTH = 6;
const ICONDIRENTRY_LENGTH = 16;

// 縮小に macOS の sips を使うので、作り直せるのは Mac の上だけ。
// ただし .ico は git に入れてあるので、他のOSでは作り直さず、
// 既にあるものをそのまま使えばよい。
//
// ここで例外を投げると、Windows で package:win を走らせる CI が
// アイコンを作れないという理由だけで落ちる（実際に落とした）。
if (process.platform !== "darwin") {
  const state = fs.existsSync(outputPath) ? "既にあるものを使います" : "ありません（既定アイコンで組まれます）";
  console.log(`アイコンの作り直しは macOS でのみ行います。${state}: ${path.relative(projectDirectory, outputPath)}`);
  process.exit(0);
}
if (!fs.existsSync(sourcePath)) {
  throw new Error(`アイコン元画像がありません: ${sourcePath}`);
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "bikutan-win-icon-"));

try {
  const images = iconSizes.map((size) => {
    const resizedPath = path.join(temporaryDirectory, `${size}.png`);
    execFileSync("/usr/bin/sips", [
      "-z", String(size), String(size), sourcePath,
      "--out", resizedPath
    ], { stdio: "ignore" });
    return { size, data: fs.readFileSync(resizedPath) };
  });

  const directory = Buffer.alloc(ICONDIR_LENGTH);
  directory.writeUInt16LE(0, 0); // 予約領域。常に0
  directory.writeUInt16LE(1, 2); // 1=アイコン（2=カーソル）
  directory.writeUInt16LE(images.length, 4);

  let offset = ICONDIR_LENGTH + ICONDIRENTRY_LENGTH * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(ICONDIRENTRY_LENGTH);
    // 幅と高さは1バイトしかないので、256は0で表す決まりになっている。
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // パレット色数。フルカラーなので0
    entry.writeUInt8(0, 3); // 予約領域
    entry.writeUInt16LE(1, 4); // プレーン数
    entry.writeUInt16LE(32, 6); // 1ピクセルあたりのビット数
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  fs.writeFileSync(outputPath, Buffer.concat([
    directory,
    ...entries,
    ...images.map(({ data }) => data)
  ]));
  console.log(
    `Windows用アイコンを生成しました: ${path.relative(projectDirectory, outputPath)}` +
    `（${iconSizes.join("/")}px）`
  );
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
