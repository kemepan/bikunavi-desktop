import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const modelsDir = path.join(root, "models");
const modelName = process.argv[2] || "ggml-base.bin";
const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`;
const outputPath = path.join(modelsDir, modelName);

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

await download(modelUrl, outputPath);

console.log("Whisper model downloaded.");
