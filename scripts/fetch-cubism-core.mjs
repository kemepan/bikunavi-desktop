import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPinned } from "./download-pins.mjs";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(projectDir, "vendor", "live2dcubismcore.min.js");
// 「最新」を指す URL なので、上流が新版を出せば中身が変わる。
// 変わったことに気づけるよう、ハッシュを固定してある（download-pins.mjs）。
const url = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";

const response = await fetch(url);
if (!response.ok) {
  throw new Error(`Cubism Core download failed: ${response.status}`);
}

// 検査してから書く。書いてから確かめると、止めた時に壊れたものが残る。
const body = assertPinned(
  "live2dcubismcore.min.js",
  Buffer.from(await response.arrayBuffer())
);

await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, body);
console.log(`Saved Cubism Core to ${destination}`);
