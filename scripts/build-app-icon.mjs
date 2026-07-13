// assets/app-icon.png からmacOS用ICNSを生成する。
// iconutilへの依存を避け、PNGベースのICNSチャンクを直接組み立てる。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const sourcePath = path.join(projectDirectory, "assets", "app-icon.png");
const outputPath = path.join(projectDirectory, "assets", "app-icon.icns");
const iconSizes = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024]
];

if (!fs.existsSync(sourcePath)) {
  throw new Error(`アイコン元画像がありません: ${sourcePath}`);
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "bikutan-app-icon-"));

try {
  const chunks = iconSizes.map(([type, size]) => {
    const resizedPath = path.join(temporaryDirectory, `${size}.png`);
    execFileSync("/usr/bin/sips", [
      "-z", String(size), String(size), sourcePath,
      "--out", resizedPath
    ], { stdio: "ignore" });

    const imageData = fs.readFileSync(resizedPath);
    const chunkHeader = Buffer.alloc(8);
    chunkHeader.write(type, 0, 4, "ascii");
    chunkHeader.writeUInt32BE(imageData.length + chunkHeader.length, 4);
    return Buffer.concat([chunkHeader, imageData]);
  });

  const fileHeader = Buffer.alloc(8);
  fileHeader.write("icns", 0, 4, "ascii");
  fileHeader.writeUInt32BE(fileHeader.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  fs.writeFileSync(outputPath, Buffer.concat([fileHeader, ...chunks]));
  console.log(`アプリアイコンを生成しました: ${path.relative(projectDirectory, outputPath)}`);
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
