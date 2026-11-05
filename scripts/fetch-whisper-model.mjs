import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPinned } from "./download-pins.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const modelsDir = path.join(root, "models");
const modelName = process.argv[2] || "ggml-base.bin";
// **`main` ではなく、リビジョンで固定する。** `resolve/main` は可変の参照で、
// 上流が差し替えれば黙って別のモデルが降ってくる。
// 2026-11-05 時点の main がこのリビジョンで、x-linked-etag（LFS の sha256）が
// download-pins.mjs の値と一致することを確かめてある。
const revision = "5359861c739e955e79d9a303bcbc70fb988958b1";
const modelUrl =
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/${revision}/${modelName}`;
const outputPath = path.join(modelsDir, modelName);
// 検査を通るまで、置き場所には出さない。途中で止めた時に、確かめていない
// ものが「あるように見える」状態を残さないため。
const temporaryPath = `${outputPath}.download-${process.pid}`;

await fs.promises.mkdir(modelsDir, { recursive: true });

if (fs.existsSync(outputPath)) {
  console.log(`Whisper model already exists: ${outputPath}`);
  process.exit(0);
}

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    https.get(url, (response) => {
    if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      file.close();
      fs.promises.unlink(destination).catch(() => {});
      if (redirects > 5) {
        reject(new Error("Too many redirects while downloading model."));
        return;
      }
      const nextUrl = new URL(response.headers.location, url).toString();
      download(nextUrl, destination, redirects + 1).then(resolve, reject);
      return;
    }
    if (response.statusCode !== 200) {
      file.close();
      fs.promises.unlink(destination).catch(() => {});
      reject(new Error(`Download failed: HTTP ${response.statusCode}`));
      return;
    }
    response.pipe(file);
    file.on("finish", () => {
      file.close(resolve);
    });
  }).on("error", (error) => {
    file.close();
      fs.promises.unlink(destination).catch(() => {});
    reject(error);
  });
  });
}

console.log(`Downloading ${modelUrl}`);
console.log(`Output: ${outputPath}`);

await download(modelUrl, temporaryPath);

try {
  // 148MB を丸ごとメモリへ載せずに済むよう、一時ファイルを読んで確かめる。
  assertPinned(modelName, fs.readFileSync(temporaryPath));
} catch (error) {
  await fs.promises.unlink(temporaryPath).catch(() => {});
  throw error;
}

await fs.promises.rename(temporaryPath, outputPath);
console.log("Whisper model downloaded.");
