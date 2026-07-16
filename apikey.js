// 会話AIのAPIキー設定小窓。preload.js 経由の IPC のみ使用する。
const provider = new URLSearchParams(window.location.search).get("provider") === "gemini"
  ? "gemini"
  : "claude";
const input = document.getElementById("api-key");
const status = document.getElementById("status");
const title = document.getElementById("title");
const note = document.getElementById("note");

if (provider === "gemini") {
  document.title = "Gemini APIキー設定";
  title.textContent = "Gemini APIキー";
  note.textContent = "Google AI Studioで発行したAPIキーを入力してください。\nキーは ~/.gemini/.env に権限600で保存されます。無料枠では、入力と出力がGoogleの製品改善に利用される場合があります。";
  input.placeholder = "AIza…";
} else {
  document.title = "Claude APIキー設定";
  title.textContent = "Claude APIキー";
  note.textContent = "Anthropic Consoleで発行したAPIキー（sk-ant-…）を入力してください。\nキーはこのMacの設定ファイル（state.json）に平文で保存されます。共有マシンでは注意してください。";
  input.placeholder = "sk-ant-api03-…";
}

async function showCurrentStatus() {
  try {
    const info = await window.bikunavi.invoke("companion:api-key-status", provider);
    if (info.hasKey) status.textContent = `現在のキー: ${info.masked}（空で保存すると削除）`;
  } catch (error) {
    console.error("API key status failed:", error);
  }
}

document.getElementById("save").addEventListener("click", async () => {
  const key = input.value.trim();
  if (provider === "claude" && key && !key.startsWith("sk-ant-")) {
    status.textContent = "sk-ant- で始まるキーではないようです。もう一度確認してください。";
    return;
  }
  if (provider === "gemini" && key && (!key.startsWith("AIza") || key.length < 30)) {
    status.textContent = "Google AI StudioのAPIキーではないようです。もう一度確認してください。";
    return;
  }
  try {
    await window.bikunavi.invoke("companion:set-api-key", provider, key);
  } catch (error) {
    console.error("API key save failed:", error);
    status.textContent = "保存できませんでした。保存先の権限を確認してください。";
  }
});

document.getElementById("cancel").addEventListener("click", () => {
  window.bikunavi.invoke("companion:close-api-key");
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") document.getElementById("save").click();
  if (event.key === "Escape") document.getElementById("cancel").click();
});

showCurrentStatus();
