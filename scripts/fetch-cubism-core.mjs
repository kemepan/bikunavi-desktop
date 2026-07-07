import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(projectDir, "vendor", "live2dcubismcore.min.js");
const url = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";

const response = await fetch(url);
if (!response.ok) {
  throw new Error(`Cubism Core download failed: ${response.status}`);
}

await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, Buffer.from(await response.arrayBuffer()));
console.log(`Saved Cubism Core to ${destination}`);
