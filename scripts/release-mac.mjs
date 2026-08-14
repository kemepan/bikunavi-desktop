// macOS 配布物を zip に固め、SHA-256 を出す。
//
// Windows には `release:win` があるのに、macOS 側だけ手作業だった。そのせいで
// v0.4.0 では **説明書きが利用者の目に触れない形**（.app だけを固めた zip）で
// 配ってしまった。DISTRIBUTION_README.md はアプリの内部に埋もれていて、
// 「署名していないので初回は右クリックから開く」が誰にも読めない状態だった。
//
// Windows 版と同じく、展開したら説明書きが横に並ぶ形にする。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appDirectory = path.join(projectDirectory, "dist", "びくたん-darwin-universal");
const appPath = path.join(appDirectory, "びくたん.app");
const { version } = JSON.parse(
  fs.readFileSync(path.join(projectDirectory, "package.json"), "utf8")
);
const stageName = `bikutan-mac-universal-v${version}`;
const stageDirectory = path.join(projectDirectory, "dist", stageName);
const archiveName = `${stageName}.zip`;
const archivePath = path.join(projectDirectory, "dist", archiveName);

// 中身が揃っているか。ここを通っていない物を配ると、起動しても
// キャラクターが出ない・声が出ないといった形で相手の時間を奪う。
function verifyApp() {
  if (!fs.existsSync(appPath)) {
    throw new Error(
      `配布物がありません: ${path.relative(projectDirectory, appPath)}\n` +
      "`npm run package:universal` を先に実行してください。"
    );
  }
  const resources = path.join(appPath, "Contents", "Resources", "app");
  const required = [
    path.join(resources, "main.js"),
    path.join(resources, "vendor", "live2dcubismcore.min.js"),
    path.join(resources, "assets", "bikunavi_desktop"),
    path.join(resources, "models", "ggml-base.bin")
  ];
  const missing = required.filter((name) => !fs.existsSync(name));
  if (missing.length) {
    throw new Error(
      "配布物に足りないものがあります:\n  " +
      missing.map((name) => path.relative(appPath, name)).join("\n  ")
    );
  }

  // 配るのはユニバーサル版。片方しか入っていないと、相手の Mac で起動しない。
  const binary = path.join(appPath, "Contents", "MacOS", "びくたん");
  const archs = execFileSync("lipo", ["-archs", binary], { encoding: "utf8" }).trim();
  for (const arch of ["x86_64", "arm64"]) {
    if (!archs.includes(arch)) {
      throw new Error(`ユニバーサルになっていません（${archs}）。${arch} が入っていない。`);
    }
  }

  // バージョンの取り違えは、受け取った側からは確かめようがない。
  const plist = path.join(appPath, "Contents", "Info.plist");
  const built = execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleShortVersionString", plist],
    { encoding: "utf8" }
  ).trim();
  if (built !== version) {
    throw new Error(
      `バージョンが食い違っています: package.json=${version} / .app=${built}\n` +
      "`npm run package:universal` をやり直してください。"
    );
  }
}

// 展開した時、説明書きが .app の横に並ぶようにする。
// **署名していないアプリなので、初回の開き方が読めないと詰まる。**
function stage() {
  fs.rmSync(stageDirectory, { recursive: true, force: true });
  fs.mkdirSync(stageDirectory, { recursive: true });
  execFileSync("ditto", [appPath, path.join(stageDirectory, "びくたん.app")]);
  const documents = [
    ["DISTRIBUTION_README.md", "はじめにお読みください.md"],
    ["LICENSE.md", "LICENSE.md"],
    ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"]
  ];
  for (const [source, destination] of documents) {
    const from = path.join(projectDirectory, source);
    if (!fs.existsSync(from)) throw new Error(`説明書きがありません: ${source}`);
    fs.copyFileSync(from, path.join(stageDirectory, destination));
  }
}

function createArchive() {
  fs.rmSync(archivePath, { force: true });
  // ditto は macOS の属性（署名を含む）を保ったまま固められる。
  // zip コマンドだと署名が壊れることがある。
  execFileSync("ditto", [
    "-c", "-k", "--sequesterRsrc", "--keepParent", stageDirectory, archivePath
  ], { stdio: "inherit" });
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

verifyApp();
stage();
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
console.log(`  shasum -a 256 ${archiveName}`);
