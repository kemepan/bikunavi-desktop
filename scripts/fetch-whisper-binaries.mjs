// Windows 用の whisper 実行ファイル一式を native/stt/win32-x64/ へ置く。
//
// これまで native/stt/README.md の手順を手で追うしかなく、DLL の入れ忘れで
// 「実行ファイルはあるのに起動できない」になりやすかった。モデルを落とす
// fetch-whisper-model.mjs と同じ立ち位置のスクリプトにする。
//
// macOS 用は自前ビルドや Homebrew など事情が違うので、ここでは扱わない。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arch = process.argv.includes("--arm64") ? "arm64" : "x64";
const destination = path.join(projectDirectory, "native", "stt", `win32-${arch}`);
// CPU版を使う。CUDA版は265MBあり、配布物には重すぎる。
const release = "v1.9.1";
const assetName = `whisper-bin-${arch}.zip`;
const downloadUrl =
  `https://github.com/ggml-org/whisper.cpp/releases/download/${release}/${assetName}`;

// びくたんが呼ぶのは whisper-cli だけ。動かすのに要るものだけ移す。
// ggml-cpu-*.dll は CPU の世代ごとに分かれていて実行時に選ばれるので、
// どれが使われるかは動かす機械次第。一式そのまま入れる。
const requiredFiles = ["whisper-cli.exe", "whisper.dll", "ggml.dll", "ggml-base.dll"];
const requiredPatterns = [/^ggml-cpu-.*\.dll$/i];

function findInDirectory(root, predicate) {
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (predicate(entry.name)) found.push(full);
    }
  };
  walk(root);
  return found;
}

async function main() {
  if (fs.existsSync(path.join(destination, "whisper-cli.exe"))) {
    console.log(`既に置かれています: ${path.relative(projectDirectory, destination)}/`);
    console.log("入れ直す場合は、このフォルダを消してから実行してください。");
    return;
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "bikutan-whisper-"));
  const archivePath = path.join(work, assetName);
  try {
    console.log(`取得中: ${downloadUrl}`);
    const response = await fetch(downloadUrl, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`ダウンロードに失敗しました（HTTP ${response.status}）: ${downloadUrl}`);
    }
    fs.writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));

    // 展開は OS 標準のものを使う（依存を増やさない）。
    // macOS/Linux は unzip、Windows は PowerShell の Expand-Archive。
    if (process.platform === "win32") {
      execFileSync("powershell.exe", [
        "-NoProfile", "-Command",
        `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${work}" -Force`
      ], { stdio: "ignore" });
    } else {
      execFileSync("unzip", ["-q", archivePath, "-d", work], { stdio: "ignore" });
    }

    fs.mkdirSync(destination, { recursive: true });
    const copied = [];
    for (const name of requiredFiles) {
      const hits = findInDirectory(work, (fileName) => fileName.toLowerCase() === name.toLowerCase());
      if (!hits.length) throw new Error(`書庫の中に ${name} がありません（${assetName} の構成が変わった可能性）`);
      fs.copyFileSync(hits[0], path.join(destination, name));
      copied.push(name);
    }
    for (const pattern of requiredPatterns) {
      const hits = findInDirectory(work, (fileName) => pattern.test(fileName));
      if (!hits.length) throw new Error(`書庫の中に ${pattern} に合うDLLがありません`);
      for (const hit of hits) {
        const name = path.basename(hit);
        fs.copyFileSync(hit, path.join(destination, name));
        copied.push(name);
      }
    }

    const total = copied.reduce(
      (sum, name) => sum + fs.statSync(path.join(destination, name)).size,
      0
    );
    console.log(`置きました: ${path.relative(projectDirectory, destination)}/`);
    console.log(`  ${copied.join(", ")}`);
    console.log(`  合計 ${(total / 1048576).toFixed(1)}MB（whisper.cpp ${release} CPU版）`);
    console.log("音声認識のモデルは `npm run fetch-whisper-model` で別途取得します。");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
