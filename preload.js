const { contextBridge, ipcRenderer } = require("electron");

const SEND_CHANNELS = new Set([
  "companion:hover",
  "companion:drag-start",
  "companion:drag-move",
  "companion:drag-end",
  "companion:auto-move",
  "companion:stop-speech",
  "companion:save-history"
]);

const INVOKE_CHANNELS = new Set([
  "companion:chat",
  "companion:prepare-idle-lines",
  "companion:idle-line",
  "companion:speak",
  "companion:music-playing",
  "companion:system-sleeping",
  "companion:pomodoro-state",
  "companion:pomodoro-action",
  "companion:open-url",
  "companion:copy-text",
  "companion:load-history",
  "companion:settings",
  "companion:answer-character-question",
  "companion:defer-character-question",
  "companion:answer-growth-question",
  "companion:defer-growth-question",
  "companion:answer-fortune-question",
  "companion:defer-fortune-question",
  "companion:transcribe-audio",
  "companion:api-key-status",
  "companion:set-api-key",
  "companion:close-api-key"
]);

const ON_CHANNELS = new Set([
  "companion:cursor",
  "companion:speech-ended",
  "companion:speech-started",
  "companion:music-playing",
  "companion:fortune",
  "companion:show-line-history",
  "companion:system-sleep",
  "companion:pomodoro",
  "companion:settings-changed",
  "companion:clear-history",
  "companion:window-edge",
  "companion:open-chat",
  "companion:custom-question",
  "companion:ambient-line"
]);

contextBridge.exposeInMainWorld("bikunavi", {
  send(channel, ...args) {
    if (!SEND_CHANNELS.has(channel)) return;
    ipcRenderer.send(channel, ...args);
  },
  invoke(channel, ...args) {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, listener) {
    if (!ON_CHANNELS.has(channel) || typeof listener !== "function") return;
    ipcRenderer.on(channel, (_event, ...args) => listener(...args));
  }
});
