// Claude APIキー設定小窓のスクリプト。preload.js 経由の IPC のみ使用する。
const input = document.getElementById("api-key");
const status = document.getElementById("status");

async function showCurrentStatus() {
  try {
    const info = await window.bikunavi.invoke("companion:api-key-status");
    if (info.hasKey) status.textContent = `現在のキー: ${info.masked}（空で保存すると削除）`;
  } catch (error) {
    console.error("API key status failed:", error);
  }
}

document.getElementById("save").addEventListener("click", async () => {
  const key = input.value.trim();
  if (key && !key.startsWith("sk-ant-")) {
    status.textContent = "sk-ant- で始まるキーではないようです。もう一度確認してください。";
    return;
  }
  await window.bikunavi.invoke("companion:set-api-key", key);
});

document.getElementById("cancel").addEventListener("click", () => {
  window.bikunavi.invoke("companion:close-api-key");
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") document.getElementById("save").click();
  if (event.key === "Escape") document.getElementById("cancel").click();
});

showCurrentStatus();
