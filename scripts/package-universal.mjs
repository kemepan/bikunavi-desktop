// ユニバーサル(.app)パッケージ。native/stt/ 配下はアーキ別バイナリを
// 意図的に同梱しているため、lipo合成の対象から除外する必要があり、
// CLIでは渡せない osxUniversal オプションをAPI経由で指定する。
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

await packager({
  dir: fileURLToPath(new URL("..", import.meta.url)),
  name: "びくたん",
  platform: "darwin",
  arch: "universal",
  out: "dist",
  overwrite: true,
  asar: false,
  ignore: [
    /^\/dist(\/|$)/,
    /^\/docs(\/|$)/,
    /^\/launchd(\/|$)/,
    /^\/\.gitignore$/,
    /\.log$/
  ],
  osxUniversal: {
    x64ArchFiles: "**/native/stt/**"
  }
});

console.log(".app を作成しました: dist/びくたん-darwin-universal/");
