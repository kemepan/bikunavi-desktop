// Windows 版のパッケージ。
//
// macOS 版（package-universal.mjs）とは同梱するものが違うので分けた。
// 同じスクリプトに分岐を足すと、どちらの都合か分からないコードになる。
//
// 入れないもの:
//   native/*.m, now-playing, speech-recognizer.app  … macOS 専用のヘルパー
//   native/stt/darwin-*                              … macOS 用の whisper
//   launchd/                                         … LaunchAgent の雛形
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

const projectDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arch = process.argv.includes("--arm64") ? "arm64" : "x64";
const bundledWhisperModel = "ggml-base.bin";
const windowsIconPath = path.join(projectDirectory, "assets", "app-icon.ico");

// .exe とタスクバーのアイコン。無いと Electron の既定のまま出てしまう。
function reportIconState() {
  if (fs.existsSync(windowsIconPath)) {
    console.log(`アイコン: ${path.relative(projectDirectory, windowsIconPath)} を使います`);
    return;
  }
  console.warn(
    "アイコン: assets/app-icon.ico がありません。Electronの既定アイコンで作ります。" +
    "`npm run build-windows-icon` で生成できます。"
  );
}

// Windows 用の whisper が同梱されているか。無くても配布はできるが、
// 音声入力は使えないので、はっきり知らせる。
function reportWhisperState() {
  const dir = path.join(projectDirectory, "native", "stt", `win32-${arch}`);
  const exe = path.join(dir, "whisper-cli.exe");
  if (fs.existsSync(exe)) {
    console.log(`音声入力: 同梱の whisper を使えます（${path.relative(projectDirectory, exe)}）`);
    return;
  }
  console.warn(
    `音声入力: win32-${arch} の whisper-cli.exe がありません。` +
    "この配布物では音声入力が使えません（会話欄からの入力は動きます）。"
  );
}

async function main() {
  reportWhisperState();
  reportIconState();

  const outputPaths = await packager({
    dir: projectDirectory,
    name: "bikutan",
    platform: "win32",
    arch,
    out: "dist",
    overwrite: true,
    asar: false,
    appCopyright: "Copyright © 2026 びくに. All rights reserved.",
    // アイコンは .ico が要る（`npm run build-windows-icon` が作る）。
    // 無い時は Electron の既定アイコンのまま進むが、配布物としては
    // 目立って困るので reportIconState() で知らせる。
    ...(fs.existsSync(windowsIconPath) ? { icon: windowsIconPath } : {}),
    ignore: [
      /^\/dist(\/|$)/,
      /^\/docs(\/|$)/,
      /^\/launchd(\/|$)/,
      /^\/\.gitignore$/,
      /\.log$/,
      // macOS 専用のヘルパー。Windows では使わないので入れない。
      /^\/native\/.*\.m$/,
      /^\/native\/now-playing$/,
      /^\/native\/speech-recognizer/,
      /^\/native\/stt\/darwin-/,
      new RegExp(`^/models/(?!${bundledWhisperModel.replace(/\./g, "\\.")}$)`)
    ]
  });

  for (const outputPath of outputPaths) {
    // Electron自身のライセンスが LICENSE という名前で出てくる。
    // 同梱する LICENSE.md（このアプリの利用条件）と紛らわしいので改名する。
    const electronLicensePath = path.join(outputPath, "LICENSE");
    if (fs.existsSync(electronLicensePath)) {
      fs.renameSync(electronLicensePath, path.join(outputPath, "ELECTRON_LICENSE"));
    }
    // 説明書きは macOS 版と別。手順もデータの置き場所も違うので、
    // Mac向けの文面をそのまま渡すと全部おかしくなる。
    fs.copyFileSync(
      path.join(projectDirectory, "DISTRIBUTION_README_WIN.md"),
      path.join(outputPath, "はじめにお読みください.md")
    );
    for (const fileName of ["LICENSE.md", "THIRD_PARTY_NOTICES.md"]) {
      fs.copyFileSync(path.join(projectDirectory, fileName), path.join(outputPath, fileName));
    }
    console.log(`.exe を作成しました: ${path.relative(projectDirectory, outputPath)}/`);
    // 入ってはいけないものが混ざっていないか確かめる。
    const resources = path.join(outputPath, "resources", "app");
    for (const unwanted of ["native/now-playing", "native/speech-recognizer.app"]) {
      if (fs.existsSync(path.join(resources, unwanted))) {
        throw new Error(`macOS 専用のファイルが含まれています: ${unwanted}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
