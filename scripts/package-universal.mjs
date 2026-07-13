// ユニバーサル(.app)パッケージ。native/stt/ 配下はアーキ別バイナリを
// 意図的に同梱しているため、lipo合成の対象から除外する必要があり、
// CLIでは渡せない osxUniversal オプションをAPI経由で指定する。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const arch = process.argv.includes("--arm64") ? "arm64" : "universal";
const outputDirectoryName = `びくたん-darwin-${arch}`;

function plistPaths(root) {
  const results = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name === "Info.plist") results.push(target);
    }
  };
  visit(root);
  return results;
}

function removeUnusedCameraPermission(appPath) {
  for (const plistPath of plistPaths(appPath)) {
    try {
      execFileSync("/usr/bin/plutil", ["-extract", "NSCameraUsageDescription", "raw", plistPath], {
        stdio: "ignore"
      });
    } catch {
      // Helperによっては元からキーが無い。存在しない場合はそのままでよい。
      continue;
    }
    execFileSync("/usr/bin/plutil", ["-remove", "NSCameraUsageDescription", plistPath]);
  }
}

function executableArchitectures(executablePath) {
  return execFileSync("/usr/bin/lipo", ["-archs", executablePath], { encoding: "utf8" }).trim().split(/\s+/);
}

function assertExecutableArchitecture(executablePath, expectedArchitecture) {
  if (!fs.existsSync(executablePath)) {
    throw new Error(`配布に必要なバイナリがありません: ${path.relative(projectDirectory, executablePath)}`);
  }
  const architectures = executableArchitectures(executablePath);
  if (!architectures.includes(expectedArchitecture)) {
    throw new Error(
      `${path.relative(projectDirectory, executablePath)} は ${expectedArchitecture} ではありません（実体: ${architectures.join(", ")}）`
    );
  }
}

function verifyDistributionAssets() {
  const arm64Whisper = path.join(projectDirectory, "native", "stt", "darwin-arm64", "whisper-cli");
  if (fs.existsSync(arm64Whisper)) assertExecutableArchitecture(arm64Whisper, "arm64");
  if (arch !== "universal") return;

  assertExecutableArchitecture(arm64Whisper, "arm64");
  assertExecutableArchitecture(
    path.join(projectDirectory, "native", "stt", "darwin-x64", "whisper-cli"),
    "x86_64"
  );
  for (const requiredPath of [
    path.join(projectDirectory, "models", "ggml-base.bin"),
    path.join(projectDirectory, "vendor", "live2dcubismcore.min.js")
  ]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`配布に必要なファイルがありません: ${path.relative(projectDirectory, requiredPath)}`);
    }
  }
}

verifyDistributionAssets();

const outputPaths = await packager({
  dir: projectDirectory,
  name: "びくたん",
  platform: "darwin",
  arch,
  out: "dist",
  overwrite: true,
  asar: false,
  appBundleId: "online.bikunitan.bikutan",
  helperBundleId: "online.bikunitan.bikutan.helper",
  appCategoryType: "public.app-category.utilities",
  appCopyright: "Copyright © 2026 びくに. All rights reserved.",
  icon: path.join(projectDirectory, "assets", "app-icon.icns"),
  usageDescription: {
    Microphone: "音声入力を文字に変換して、びくたんと会話するためにマイクを使用します。"
  },
  ignore: [
    /^\/dist(\/|$)/,
    /^\/docs(\/|$)/,
    /^\/launchd(\/|$)/,
    /^\/\.gitignore$/,
    /\.log$/
  ],
  ...(arch === "universal" ? {
    osxUniversal: {
      x64ArchFiles: "**/native/stt/**"
    }
  } : {})
});

for (const outputPath of outputPaths) {
  const appPath = path.join(outputPath, "びくたん.app");
  removeUnusedCameraPermission(appPath);
  const electronLicensePath = path.join(outputPath, "LICENSE");
  if (fs.existsSync(electronLicensePath)) {
    fs.renameSync(electronLicensePath, path.join(outputPath, "ELECTRON_LICENSE"));
  }
  fs.copyFileSync(
    path.join(projectDirectory, "DISTRIBUTION_README.md"),
    path.join(outputPath, "はじめにお読みください.md")
  );
  fs.copyFileSync(
    path.join(projectDirectory, "LICENSE.md"),
    path.join(outputPath, "LICENSE.md")
  );
  fs.copyFileSync(
    path.join(projectDirectory, "THIRD_PARTY_NOTICES.md"),
    path.join(outputPath, "THIRD_PARTY_NOTICES.md")
  );
}

console.log(`.app を作成しました: dist/${outputDirectoryName}/`);
