// Windows 配布物を zip に固め、SHA-256 を出す。
//
// DISTRIBUTION_README_WIN.md には「配布時に示された SHA-256 と一致することを
// 確認してください」と書いてあるのに、それを作る手順がどこにも無かった。
// 受け取った人が確かめようがない状態だったので、ここで用意する。
//
// macOS 版の公開手順（docs/公開手順-v0.1.0.md）と同じ形にそろえる:
//   dist/bikutan-<platform>-v<version>.zip ＋ SHA-256 をリリースノートへ載せる
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arch = process.argv.includes("--arm64") ? "arm64" : "x64";
const sourceDirectory = path.join(projectDirectory, "dist", `bikutan-win32-${arch}`);
const { version } = JSON.parse(
  fs.readFileSync(path.join(projectDirectory, "package.json"), "utf8")
);
const archiveName = `bikutan-win-${arch}-v${version}.zip`;
const archivePath = path.join(projectDirectory, "dist", archiveName);

// 中身が揃っているか。ここを通っていない物を配ると、起動しても
// キャラクターが出ない・声が出ないといった形で相手の時間を奪う。
function verifyDistribution() {
  if (!fs.existsSync(sourceDirectory)) {
    throw new Error(
      `配布物がありません: ${path.relative(projectDirectory, sourceDirectory)}\n` +
      "`npm run package:win` を先に実行してください。"
    );
  }
  const required = [
    "bikutan.exe",
    "はじめにお読みください.md",
    "LICENSE.md",
    "THIRD_PARTY_NOTICES.md",
    path.join("resources", "app", "vendor", "live2dcubismcore.min.js"),
    path.join("resources", "app", "assets", "bikunavi_desktop")
  ];
  const missing = required.filter((name) => !fs.existsSync(path.join(sourceDirectory, name)));
  if (missing.length) {
    throw new Error(`配布物に足りないものがあります:\n  ${missing.join("\n  ")}`);
  }
  // 音声認識は無くても配れるが、黙って欠けていると気づけない。
  const whisper = path.join(
    sourceDirectory, "resources", "app", "native", "stt", `win32-${arch}`, "whisper-cli.exe"
  );
  const model = path.join(sourceDirectory, "resources", "app", "models", "ggml-base.bin");
  if (!fs.existsSync(whisper) || !fs.existsSync(model)) {
    console.warn(
      "音声入力: whisper の実行ファイルかモデルが入っていません。" +
      "この配布物ではマイクが使えません（会話欄からの入力は動きます）。"
    );
  }
}

function createArchive() {
  fs.rmSync(archivePath, { force: true });
  // 展開した時にフォルダごと出るよう、親から相対で固める。
  if (process.platform === "win32") {
    execFileSync("powershell.exe", [
      "-NoProfile", "-Command",
      `Compress-Archive -Path "${sourceDirectory}" -DestinationPath "${archivePath}"`
    ], { stdio: "inherit" });
  } else {
    execFileSync("zip", ["-qr", archivePath, path.basename(sourceDirectory)], {
      cwd: path.dirname(sourceDirectory),
      stdio: "inherit"
    });
  }
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

verifyDistribution();
createArchive();

const size = fs.statSync(archivePath).size;
const digest = sha256(archivePath);

console.log("");
console.log(`zip: dist/${archiveName}`);
console.log(`サイズ: ${size.toLocaleString()} bytes（${(size / 1048576).toFixed(0)}MB）`);
console.log(`SHA-256: ${digest}`);
console.log("");
console.log("リリースノートへ、この SHA-256 をそのまま載せてください。");
console.log("受け取った人はこれで確かめます:");
console.log(`  certutil -hashfile ${archiveName} SHA256    （コマンドプロンプト）`);
console.log(`  Get-FileHash ${archiveName}                 （PowerShell）`);
