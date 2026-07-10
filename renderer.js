// PIXI と PIXI.live2d は index.html の <script> で読み込むブラウザビルドを使う。
// Node 連携は preload.js が公開する window.bikunavi 経由のみ。
const { Live2DModel } = PIXI.live2d;

const canvas = document.querySelector("#stage");
const bubble = document.querySelector("#bubble");
const status = document.querySelector("#status");
const pixiApp = new PIXI.Application({
  view: canvas,
  resizeTo: window,
  backgroundAlpha: 0,
  antialias: true,
  autoDensity: true,
  resolution: window.devicePixelRatio
});

const EMOTES = {
  default: { eyeOpen: 1, eyeSmile: 0, mouthForm: 0, mouthOpen: 0 },
  joy: { eyeOpen: 1, eyeSmile: 1, mouthForm: 1, mouthOpen: 0 },
  surprised: { eyeOpen: 1.2, eyeSmile: 0, mouthForm: 0, mouthOpen: 0.8 },
  thinking: { eyeOpen: 0.08, eyeSmile: 0, mouthForm: -0.15, mouthOpen: 0 },
  wink: { eyeOpen: 1, eyeSmile: 1, mouthForm: 1, mouthOpen: 0 }
};
const EXPRESSION_NAMES = {
  joy: "f02",
  surprised: "f03",
  thinking: "f04",
  wink: "f05"
};
let model;
let originalModelWidth;
let originalModelHeight;
let visualBounds;
let characterHitBounds;
let pointerDown;
let dragging = false;
let isHovered = false;
let isSpeaking = false;
let isThinking = false;
let isPreparingSpeech = false;
let chatActive = false;
let pendingQuestion = "";
let pendingCharacterCustomization;
let chatEntryIndex = -1;
const chatEntries = [];
const lineHistory = [];
let lineHistoryIndex = -1;
let lineHistoryActive = false;
let currentEmote = { ...EMOTES.default };
let blinkTimer = 0;
let hideBubbleTimer;
let chatterEndTimer;
let responseSpeechTimer;
let idleChatterBusy = false;
let chatIdleTimer;
let suppressHoverUntilLeave = false;
let currentSpeechId;
let currentSpeechKind;
let currentSpeechHoldMs = 900;
let musicPlaying = false;
let musicDanceWeight = 0;
let systemSleeping = false;
let topDocked = false;
let pomodoroState = { active: false, running: false, remaining: 0, label: "", timeText: "" };
let pomodoroHideTimer;
// いま素の吹き出しに出しているソース。ニュース吹き出しにホバーして会話欄へ
// 切り替わっても、このソースボタンを引き継いで消さないために覚えておく。
let displayedLineSources = [];
let idleIntervalMs = 30000;
let chatterTimer;
let historySaveTimer;
let voiceInputActive = false;
let voiceInputButton;
let voiceInputTargetInput;
let voiceRecorder;
let voiceRecordingTimer;
let chatDraft = "";
const VOICE_INPUT_MAX_MS = 15000;

function showStatusMessage(message, duration = 2600) {
  status.textContent = message;
  if (duration > 0) {
    setTimeout(() => {
      if (status.textContent === message) status.textContent = "";
    }, duration);
  }
}

function setVoiceInputButtonState(active) {
  if (!voiceInputButton) return;
  voiceInputButton.classList.toggle("is-recording", active);
  voiceInputButton.title = active ? "録音を停止" : "音声を録音して入力";
  voiceInputButton.setAttribute("aria-pressed", active ? "true" : "false");
}

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);
  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }
  return buffer;
}

function mergeAudioChunks(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

async function finishVoiceInput() {
  if (!voiceRecorder) return;
  const recorder = voiceRecorder;
  voiceRecorder = undefined;
  clearTimeout(voiceRecordingTimer);
  voiceInputActive = false;
  setVoiceInputButtonState(false);

  try {
    recorder.processor.disconnect();
    recorder.source.disconnect();
  } catch (_error) {
    // ignore disconnect races
  }
  for (const track of recorder.stream.getTracks()) track.stop();
  await recorder.audioContext.close().catch(() => {});

  const samples = mergeAudioChunks(recorder.chunks);
  if (!samples.length) {
    showStatusMessage("声を拾えませんでした");
    return;
  }

  showStatusMessage("文字起こし中…", 0);
  try {
    const wav = encodeWav(samples, recorder.sampleRate);
    const result = await bikunavi.invoke("companion:transcribe-audio", {
      audio: wav,
      format: "wav",
      sampleRate: recorder.sampleRate
    });
    const text = String(result?.text || "").trim();
    if (text && voiceInputTargetInput) {
      const current = voiceInputTargetInput.value.trim();
      chatDraft = [current, text].filter(Boolean).join(current ? " " : "");
      voiceInputTargetInput.value = chatDraft;
      voiceInputTargetInput.dispatchEvent(new Event("input", { bubbles: true }));
      showStatusMessage("音声入力しました");
    } else {
      showStatusMessage(result?.message || "文字起こし結果が空でした");
    }
  } catch (error) {
    console.error("Voice transcription failed:", error);
    showStatusMessage(error?.message || "文字起こしに失敗しました");
  } finally {
    voiceInputTargetInput?.focus();
    if (status.textContent === "文字起こし中…") status.textContent = "";
    scheduleChatIdleReset();
  }
}

async function startVoiceInput(input, button) {
  if (!navigator.mediaDevices?.getUserMedia) {
    showStatusMessage("この環境では録音できません");
    return;
  }
  voiceInputTargetInput = input;
  voiceInputButton = button;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextClass();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    processor.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
    voiceRecorder = {
      stream,
      audioContext,
      source,
      processor,
      chunks,
      sampleRate: audioContext.sampleRate
    };
    voiceInputActive = true;
    setVoiceInputButtonState(true);
    showStatusMessage("録音しています…", 0);
    voiceRecordingTimer = setTimeout(() => {
      finishVoiceInput().catch(console.error);
    }, VOICE_INPUT_MAX_MS);
    scheduleChatIdleReset();
  } catch (error) {
    console.error("Voice recording start failed:", error);
    showStatusMessage(error?.name === "NotAllowedError"
      ? "マイク入力が許可されませんでした"
      : "録音を開始できませんでした");
  }
}

function stopVoiceInput() {
  if (!voiceInputActive) return;
  finishVoiceInput().catch(console.error);
}

function toggleVoiceInput(input, button) {
  if (voiceInputActive) {
    stopVoiceInput();
    return;
  }
  startVoiceInput(input, button).catch(console.error);
}

function saveHistorySoon() {
  clearTimeout(historySaveTimer);
  historySaveTimer = setTimeout(() => {
    bikunavi.send("companion:save-history", { lineHistory, chatEntries });
  }, 1200);
}

function fitModel() {
  if (!model || !visualBounds) return;
  const margin = 12;
  const bubbleSpace = 260;
  const width = window.innerWidth;
  const height = window.innerHeight;
  // Electron emits resize before Pixi's resizeTo handler has necessarily
  // updated the backing canvas. Resize it first so large -> small transitions
  // never calculate against the previous canvas dimensions.
  pixiApp.renderer.resize(width, height);
  const visualWidth = visualBounds.maxX - visualBounds.minX;
  const visualHeight = visualBounds.maxY - visualBounds.minY;
  const scale = Math.min(
    (width - margin * 2) / visualWidth,
    (height - bubbleSpace - margin * 2) / visualHeight
  );
  const visualCenterX = (visualBounds.minX + visualBounds.maxX) / 2;
  const visualCenterY = (visualBounds.minY + visualBounds.maxY) / 2;
  const targetCenterX = width / 2;
  // 画面上端ではキャラクターを常に上へ詰めたままにする。吹き出し表示時も
  // 位置を戻さず、空いた足元側へ吹き出しを反転する。
  const topDockOffset = topDocked ? 220 : 0;
  const targetCenterY = bubbleSpace + (height - bubbleSpace) / 2 - topDockOffset;
  model.scale.set(scale);
  model.anchor.set(0.5, 0.5);
  model.position.set(
    targetCenterX - (visualCenterX - originalModelWidth / 2) * scale,
    targetCenterY - (visualCenterY - originalModelHeight / 2) * scale
  );
  characterHitBounds = new PIXI.Rectangle(
    targetCenterX - visualWidth * scale / 2,
    targetCenterY - visualHeight * scale / 2,
    visualWidth * scale,
    visualHeight * scale
  );
  bubble.style.left = `${targetCenterX}px`;
  bubble.classList.toggle("is-below", topDocked);
  bubble.style.top = topDocked
    ? `${characterHitBounds.y + characterHitBounds.height + 5}px`
    : `${characterHitBounds.y - 5}px`;
}

function getVisualBounds(internalModel) {
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
  for (const id of internalModel.getDrawableIDs()) {
    const vertices = internalModel.getDrawableVertices(id);
    for (let index = 0; index < vertices.length; index += 2) {
      bounds.minX = Math.min(bounds.minX, vertices[index]);
      bounds.maxX = Math.max(bounds.maxX, vertices[index]);
      bounds.minY = Math.min(bounds.minY, vertices[index + 1]);
      bounds.maxY = Math.max(bounds.maxY, vertices[index + 1]);
    }
  }
  return Number.isFinite(bounds.minX)
    ? bounds
    : { minX: 0, minY: 0, maxX: originalModelWidth, maxY: originalModelHeight };
}

function isPointInActiveBubble(point) {
  if (!bubble.classList.contains("is-active")) return false;
  const rect = bubble.getBoundingClientRect();
  const padding = bubble.classList.contains("has-chat") || bubble.classList.contains("has-history")
    ? 24
    : 14;
  const insideBubble = (
    point.x >= rect.left - padding &&
    point.x <= rect.right + padding &&
    point.y >= rect.top - padding &&
    point.y <= rect.bottom + padding
  );
  if (insideBubble) return true;
  if (!characterHitBounds) return false;

  // Make the air between the character and the speech bubble feel touchable.
  // Without this bridge, moving the cursor from びくたん to small buttons can
  // briefly leave both hit areas and the UI changes under the cursor.
  const bridgeLeft = Math.min(rect.left, characterHitBounds.x) - 28;
  const bridgeRight = Math.max(rect.right, characterHitBounds.x + characterHitBounds.width) + 28;
  const bridgeTop = Math.min(rect.top, characterHitBounds.y) - 12;
  const bridgeBottom = Math.max(
    rect.bottom,
    characterHitBounds.y + characterHitBounds.height
  ) + 12;
  return (
    point.x >= bridgeLeft &&
    point.x <= bridgeRight &&
    point.y >= bridgeTop &&
    point.y <= bridgeBottom
  );
}

function normalizeSpeechItem(item) {
  if (typeof item === "string") return { text: item, sources: [] };
  return {
    text: String(item?.text ?? ""),
    sources: Array.isArray(item?.sources) ? item.sources : [],
    kind: String(item?.kind || ""),
    questionId: String(item?.questionId || ""),
    answerKind: String(item?.answerKind || "")
  };
}

function customQuestionAnswerChannel(question) {
  if (question?.answerKind === "growth") return "companion:answer-growth-question";
  if (question?.answerKind === "fortune") return "companion:answer-fortune-question";
  return "companion:answer-character-question";
}

function customQuestionDeferChannel(question) {
  if (question?.answerKind === "growth") return "companion:defer-growth-question";
  if (question?.answerKind === "fortune") return "companion:defer-fortune-question";
  return "companion:defer-character-question";
}

function rememberLine(item, kind = "line") {
  const speechItem = normalizeSpeechItem(item);
  if (!speechItem.text.trim()) return;
  const previous = lineHistory[lineHistory.length - 1];
  if (previous?.text === speechItem.text) return;
  lineHistory.push({
    text: speechItem.text,
    sources: speechItem.sources,
    kind,
    time: Date.now()
  });
  if (lineHistory.length > 20) lineHistory.shift();
  if (!lineHistoryActive) lineHistoryIndex = lineHistory.length - 1;
  saveHistorySoon();
}

function makeSourceLabel(source, index) {
  if (source.source) return source.source;
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch (_error) {
    return `ソース${index + 1}`;
  }
}

function createSourceLinks(sources) {
  const validSources = (Array.isArray(sources) ? sources : [])
    .filter((source) => /^https?:\/\//.test(source?.url || ""))
    .slice(0, 4);
  if (!validSources.length) return undefined;

  const sourceList = document.createElement("div");
  sourceList.className = "source-links";
  for (const [index, source] of validSources.entries()) {
    const link = document.createElement("button");
    link.type = "button";
    link.textContent = `ソース: ${makeSourceLabel(source, index)}`;
    link.title = source.title || source.url;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      bikunavi.invoke("companion:open-url", source.url).catch(console.error);
    });
    sourceList.append(link);
  }
  return sourceList;
}

function showBubble(item) {
  clearTimeout(hideBubbleTimer);
  clearTimeout(pomodoroHideTimer);
  lineHistoryActive = false;
  const speechItem = normalizeSpeechItem(item);
  bubble.replaceChildren();
  const message = document.createElement("div");
  message.className = "bubble-message";
  message.textContent = speechItem.text;
  bubble.append(message);
  const validSources = (speechItem.sources || [])
    .filter((source) => /^https?:\/\//.test(source?.url || ""));
  displayedLineSources = validSources;
  const sourceList = createSourceLinks(validSources);
  if (sourceList) bubble.append(sourceList);
  bubble.classList.remove("has-actions", "has-chat", "has-timer", "has-history");
  bubble.classList.add("is-active");
}

function showLineHistory(index = lineHistoryIndex) {
  clearTimeout(hideBubbleTimer);
  clearTimeout(pomodoroHideTimer);
  displayedLineSources = [];
  bubble.replaceChildren();
  bubble.classList.remove("has-actions", "has-chat", "has-timer", "has-history");
  bubble.classList.add("has-history", "is-active");
  lineHistoryActive = true;

  if (!lineHistory.length) {
    const empty = document.createElement("div");
    empty.className = "bubble-message";
    empty.textContent = "まだセリフ履歴がありません。";
    bubble.append(empty);
    const controls = document.createElement("div");
    controls.className = "line-history";
    controls.append(createLineHistoryCloseButton());
    bubble.append(controls);
    return;
  }

  lineHistoryIndex = Math.max(0, Math.min(index, lineHistory.length - 1));
  const entry = lineHistory[lineHistoryIndex];
  const message = document.createElement("div");
  message.className = "bubble-message history-message";
  message.textContent = entry.text;
  bubble.append(message);
  const sourceList = createSourceLinks(entry.sources);
  if (sourceList) bubble.append(sourceList);

  const controls = document.createElement("div");
  controls.className = "line-history";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "‹";
  previous.title = "前のセリフ";
  previous.disabled = lineHistoryIndex <= 0;
  previous.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showLineHistory(lineHistoryIndex - 1);
  });

  const count = document.createElement("span");
  count.textContent = `${lineHistoryIndex + 1}/${lineHistory.length}`;

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "›";
  next.title = "次のセリフ";
  next.disabled = lineHistoryIndex >= lineHistory.length - 1;
  next.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showLineHistory(lineHistoryIndex + 1);
  });

  const replay = document.createElement("button");
  replay.type = "button";
  replay.className = "is-wide";
  replay.textContent = "再読";
  replay.title = "このセリフを読み上げ";
  replay.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    bikunavi.invoke("companion:speak", entry.text, "answer").catch(console.error);
  });

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "is-wide";
  copy.textContent = "コピー";
  copy.title = "このセリフをコピー";
  copy.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    bikunavi.invoke("companion:copy-text", entry.text).catch(console.error);
  });

  controls.append(previous, count, next, replay, copy);
  controls.append(createLineHistoryCloseButton());
  bubble.append(controls);
}

function createLineHistoryCloseButton() {
  const close = document.createElement("button");
  close.type = "button";
  close.className = "is-wide";
  close.textContent = "閉じる";
  close.title = "セリフ履歴を閉じる";
  close.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    lineHistoryActive = false;
    if (isHovered && !pomodoroState.active) {
      showChatBubble();
    } else {
      hideBubble();
      resumeAmbientState();
    }
  });
  return close;
}

function getIdleSpeechHoldMs(item) {
  const speechItem = normalizeSpeechItem(item);
  const hasSources = speechItem.sources.some((source) => /^https?:\/\//.test(source?.url || ""));
  if (hasSources) return 30000;
  if (speechItem.text.length >= 70) return 18000;
  return 900;
}

function createPomodoroControls(state) {
  if (!state.active) return undefined;
  const controls = document.createElement("div");
  controls.className = "timer-actions";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = state.running ? "一時停止" : "再開";
  toggle.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      pomodoroState = await bikunavi.invoke(
        "companion:pomodoro-action",
        state.running ? "pause" : "resume"
      );
      showPomodoroBubble(pomodoroState, true);
    } catch (error) {
      console.error("Pomodoro toggle failed:", error);
    }
  });

  const finish = document.createElement("button");
  finish.type = "button";
  finish.textContent = "完了";
  finish.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      // 完了の吹き出しは main からの "completed" イベントで表示するので、ここでは再描画しない。
      await bikunavi.invoke("companion:pomodoro-action", "finish");
    } catch (error) {
      console.error("Pomodoro finish failed:", error);
    }
  });

  controls.append(toggle, finish);
  return controls;
}

function showPomodoroBubble(state = pomodoroState, force = false) {
  clearTimeout(hideBubbleTimer);
  clearTimeout(pomodoroHideTimer);
  lineHistoryActive = false;
  displayedLineSources = [];
  if ((chatActive || dragging) && !force) return;

  const title = state.active
    ? `${state.label || "ポモドーロ"}${state.running ? "" : " 一時停止中"}`
    : "ポモドーロ完了";
  const text = state.reason === "completed"
    ? (state.message || `${state.label || "タイマー"}おしまいです。\nおつかれさまでした！`)
    : `${title}\n${state.timeText || "0:00"}`;
  if (["started", "autoBreakStarted", "autoFocusStarted", "paused", "resumed", "completed"].includes(state.reason)) {
    rememberLine(text, "timer");
  }

  bubble.replaceChildren();
  const message = document.createElement("div");
  message.className = "bubble-message timer-message";
  message.textContent = text;
  bubble.append(message);
  if (state.active && isHovered) {
    const controls = createPomodoroControls(state);
    if (controls) bubble.append(controls);
  }
  bubble.classList.remove("has-actions", "has-chat", "has-history");
  bubble.classList.add("has-timer", "is-active");

  if (state.reason === "completed") {
    setEmote("joy");
    pomodoroHideTimer = setTimeout(() => hideBubble(), 9000);
  } else if (state.active) {
    setEmote(musicPlaying ? "joy" : getPomodoroEmote(state));
  }
}

function getPomodoroEmote(state = pomodoroState) {
  if (!state.active) return "default";
  if (!state.running) return "joy";
  return String(state.phase || "").startsWith("focus") ? "default" : "joy";
}

function shortenForBubble(text, limit) {
  const normalized = String(text).replace(/\n{3,}/g, "\n\n");
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function showChatBubble(busy = false, carriedSources = [], preparingSpeech = false) {
  clearTimeout(hideBubbleTimer);
  clearTimeout(pomodoroHideTimer);
  lineHistoryActive = false;
  bubble.replaceChildren();
  const message = document.createElement("div");
  message.className = "chat-message";
  const entry = chatEntries[chatEntryIndex];
  if (busy) {
    message.textContent = `あなた：${shortenForBubble(pendingQuestion, 80)}\n\nびくたん：考え中です…`;
  } else if (pendingCharacterCustomization) {
    message.textContent = pendingCharacterCustomization.text;
  } else if (entry) {
    message.textContent =
      `あなた：${shortenForBubble(entry.question, 80)}\n\n` +
      `びくたん：${shortenForBubble(entry.answer, 240)}`;
  } else {
    message.textContent = "何をお手伝いしましょう？";
  }

  // ニュース吹き出しからホバーで会話欄へ切り替わった時は、直前に見ていた
  // ソースボタンを優先して残す。それ以外は表示中の回答のソースを出す。
  const sourceList = busy
    ? undefined
    : createSourceLinks(carriedSources.length ? carriedSources : entry?.sources);
  displayedLineSources = [];
  if (!busy && !pendingCharacterCustomization && chatEntries.length) {
    const history = document.createElement("div");
    history.className = "chat-history";
    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "‹";
    previous.title = "前の回答";
    previous.disabled = chatEntryIndex <= 0;
    previous.addEventListener("click", () => {
      chatEntryIndex -= 1;
      showChatBubble();
      scheduleChatIdleReset();
    });
    const count = document.createElement("span");
    count.textContent = `${chatEntryIndex + 1}/${chatEntries.length}`;
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "›";
    next.title = "次の回答";
    next.disabled = chatEntryIndex >= chatEntries.length - 1;
    next.addEventListener("click", () => {
      chatEntryIndex += 1;
      showChatBubble();
      scheduleChatIdleReset();
    });
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "コピー";
    copy.title = "この回答をコピー";
    copy.addEventListener("click", () => {
      const current = chatEntries[chatEntryIndex];
      if (current) {
        bikunavi.invoke("companion:copy-text", current.answer).catch(console.error);
      }
      scheduleChatIdleReset();
    });
    history.append(previous, count, next, copy);
    bubble.append(message);
    if (sourceList) bubble.append(sourceList);
    bubble.append(history);
  } else {
    bubble.append(message);
    if (sourceList) bubble.append(sourceList);
  }

  const form = document.createElement("form");
  form.className = "chat-form";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = preparingSpeech
    ? "声を準備中…"
    : pendingCharacterCustomization
      ? "びくたんへの答えを書く…"
      : "びくたんに話しかける…";
  input.maxLength = 4000;
  input.disabled = busy || preparingSpeech;
  if (!busy && !preparingSpeech) input.value = chatDraft;
  input.setAttribute("aria-label", "びくたんへのメッセージ");
  const send = document.createElement("button");
  send.type = "submit";
  send.textContent = busy ? "…" : preparingSpeech ? "声…" : "送信";
  send.disabled = busy || preparingSpeech;
  const mic = document.createElement("button");
  mic.type = "button";
  mic.className = "voice-input-button";
  mic.title = navigator.mediaDevices?.getUserMedia
    ? "音声を録音して入力"
    : "この環境では録音できません";
  mic.disabled = busy || preparingSpeech || !navigator.mediaDevices?.getUserMedia;
  mic.setAttribute("aria-label", "音声で入力");
  mic.setAttribute("aria-pressed", "false");
  mic.addEventListener("click", () => {
    toggleVoiceInput(input, mic);
  });
  form.append(input);
  form.append(mic);
  if (pendingCharacterCustomization && !busy && !preparingSpeech) {
    const defer = document.createElement("button");
    defer.type = "button";
    defer.textContent = "あとで";
    defer.addEventListener("click", async () => {
      await bikunavi.invoke(
        customQuestionDeferChannel(pendingCharacterCustomization),
        pendingCharacterCustomization?.questionId
      );
      pendingCharacterCustomization = undefined;
      showChatBubble();
      bubble.querySelector(".chat-form input")?.focus();
      scheduleChatIdleReset();
    });
    form.append(defer);
  }
  form.append(send);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    runChat(input.value);
  });
  input.addEventListener("focus", () => {
    chatActive = true;
    bikunavi.send("companion:hover", true);
    scheduleChatIdleReset();
  });
  input.addEventListener("input", scheduleChatIdleReset);
  input.addEventListener("input", () => {
    chatDraft = input.value;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeChat();
  });
  bubble.append(form);
  bubble.classList.remove("has-timer", "has-history");
  bubble.classList.add("has-chat", "is-active");
}

function closeChat() {
  clearTimeout(chatIdleTimer);
  stopVoiceInput();
  chatActive = false;
  bikunavi.send("companion:hover", isHovered);
  if (!isHovered) hideBubble();
}

function scheduleChatIdleReset() {
  clearTimeout(chatIdleTimer);
  if (!chatActive || isThinking || isPreparingSpeech || voiceInputActive) return;
  chatIdleTimer = setTimeout(() => {
    chatActive = false;
    isSpeaking = false;
    isThinking = false;
    isHovered = false;
    pendingQuestion = "";
    suppressHoverUntilLeave = true;
    resumeAmbientState();
    bubble.classList.remove("is-active");
    bikunavi.send("companion:hover", false);
  }, 30000);
}

async function runChat(rawMessage) {
  const message = rawMessage.trim();
  if (!message || isSpeaking || isThinking || isPreparingSpeech) return;
  stopVoiceInput();
  chatDraft = "";
  chatActive = true;
  clearTimeout(chatIdleTimer);
  clearTimeout(responseSpeechTimer);
  isSpeaking = false;
  isThinking = true;
  pendingQuestion = message;
  bikunavi.send("companion:hover", true);
  setEmote("thinking");
  showChatBubble(true);
  try {
    const customizationQuestion = pendingCharacterCustomization;
    const response = normalizeSpeechItem(
      customizationQuestion
        ? await bikunavi.invoke(
          customQuestionAnswerChannel(customizationQuestion),
          customizationQuestion.questionId,
          message
        )
        : await bikunavi.invoke("companion:chat", message)
    );
    if (customizationQuestion) pendingCharacterCustomization = undefined;
    chatEntries.push({ question: message, answer: response.text, sources: response.sources });
    if (chatEntries.length > 10) chatEntries.shift();
    chatEntryIndex = chatEntries.length - 1;
    saveHistorySoon();
    pendingQuestion = "";
    isThinking = false;
    isPreparingSpeech = true;
    // VOICEVOX の音声合成は回答生成後にも時間がかかるため、合成完了を待たず
    // テキストを先に表示する。口パクは実際に再生が始まってから有効にする。
    showChatBubble(false, [], true);
    setEmote("joy");

    let speechId = null;
    try {
      speechId = await bikunavi.invoke("companion:speak", response.text, "answer");
    } catch (speechError) {
      console.error("Speech failed:", speechError);
    }
    isPreparingSpeech = false;
    showChatBubble();
    if (speechId) {
      currentSpeechId = speechId;
      currentSpeechKind = "answer";
      isSpeaking = true;
    } else {
      isSpeaking = true;
      const speakingDuration = Math.min(6000, Math.max(1800, response.text.length * 35));
      responseSpeechTimer = setTimeout(() => {
        isSpeaking = false;
      }, speakingDuration);
    }
    scheduleChatIdleReset();
  } catch (error) {
    console.error(error);
    chatEntries.push({
      question: message,
      answer: "うまく考えられませんでした。Codexのログイン状態を確認してください。"
    });
    if (chatEntries.length > 10) chatEntries.shift();
    chatEntryIndex = chatEntries.length - 1;
    saveHistorySoon();
    pendingQuestion = "";
    isThinking = false;
    isPreparingSpeech = false;
    isSpeaking = false;
    showChatBubble();
    setEmote("surprised");
    scheduleChatIdleReset();
  }
}

function hideBubble(delay = 0) {
  clearTimeout(hideBubbleTimer);
  hideBubbleTimer = setTimeout(() => {
    if (!isSpeaking && !isHovered && !dragging && !chatActive && !lineHistoryActive && !pomodoroState.active) {
      bubble.classList.remove("is-active");
      displayedLineSources = [];
    }
  }, delay);
}

function setEmote(name) {
  currentEmote = { ...(EMOTES[name] || EMOTES.default) };
  const expressionName = EXPRESSION_NAMES[name];
  if (expressionName) {
    model?.expression(expressionName);
  } else {
    model?.internalModel.motionManager.expressionManager?.resetExpression();
  }
}

function stopMotions() {
  model?.internalModel.motionManager.stopAllMotions();
}

function resumeAmbientState() {
  stopMotions();
  if (musicPlaying && !isHovered && !dragging && !chatActive && !isThinking && !isSpeaking) {
    setEmote("joy");
  } else if (pomodoroState.active && !isHovered && !dragging && !chatActive && !isThinking && !isSpeaking) {
    setEmote(getPomodoroEmote(pomodoroState));
  } else if (!isHovered && !dragging && !chatActive && !isThinking && !isSpeaking) {
    setEmote("default");
  }
}

function enterCharacter() {
  if (isHovered || dragging) return;
  isHovered = true;
  bikunavi.send("companion:hover", true);
  setEmote("joy");
  if (lineHistoryActive) return;
  if (chatActive && bubble.classList.contains("has-chat")) return;
  if (pomodoroState.active) {
    showPomodoroBubble(pomodoroState, true);
  } else {
    showChatBubble(false, displayedLineSources);
    model?.motion("Wave", 0);
  }
}

function leaveCharacter() {
  if (!isHovered || dragging) return;
  isHovered = false;
  bikunavi.send("companion:hover", false);
  if (lineHistoryActive) {
    resumeAmbientState();
    return;
  }
  if (pomodoroState.active) showPomodoroBubble(pomodoroState);
  else hideBubble(1500);
  resumeAmbientState();
}

function startChatter() {
  bikunavi.invoke("companion:prepare-idle-lines").catch(console.error);
  scheduleChatter();
}

function scheduleChatter() {
  clearInterval(chatterTimer);
  chatterTimer = setInterval(async () => {
    if (
      isHovered ||
      dragging ||
      isSpeaking ||
      chatActive ||
      pomodoroState.active ||
      systemSleeping ||
      idleChatterBusy ||
      !model
    ) return;

    idleChatterBusy = true;
    try {
      const lineItem = normalizeSpeechItem(await bikunavi.invoke("companion:idle-line"));
      if (systemSleeping || isHovered || dragging || chatActive) return;
      if (lineItem.kind === "custom-question" && lineItem.questionId) {
        pendingCharacterCustomization = lineItem;
      }

      let speechId = null;
      try {
        speechId = await bikunavi.invoke("companion:speak", lineItem.text, "idle");
      } catch (speechError) {
        console.error("Idle speech failed:", speechError);
      }
      if (systemSleeping || isHovered || dragging || chatActive) {
        if (speechId) bikunavi.send("companion:stop-speech");
        return;
      }

      isSpeaking = true;
      currentSpeechHoldMs = getIdleSpeechHoldMs(lineItem);
      if (speechId) {
        currentSpeechId = speechId;
        currentSpeechKind = "idle";
      }
      rememberLine(lineItem, "idle");
      showBubble(lineItem);
      setEmote("joy");

      clearTimeout(chatterEndTimer);
      const displayDuration = speechId
        ? 60000
        : Math.max(
          currentSpeechHoldMs,
          Math.min(30000, Math.max(6500, lineItem.text.length * 180))
        );
      chatterEndTimer = setTimeout(() => {
        currentSpeechKind = undefined;
        currentSpeechHoldMs = 900;
        isSpeaking = false;
        resumeAmbientState();
        hideBubble();
      }, displayDuration);
    } catch (error) {
      console.error(error);
    } finally {
      idleChatterBusy = false;
    }
  }, idleIntervalMs);
}

function startFloating() {
  setTimeout(() => {
    if (!isHovered && !dragging && !chatActive && !pomodoroState.active) bikunavi.send("companion:auto-move");
  }, 20000);
  setInterval(() => {
    if (!isHovered && !dragging && !chatActive && !pomodoroState.active) bikunavi.send("companion:auto-move");
  }, 45000);
}

async function start() {
  try {
    model = await Live2DModel.from("assets/bikunavi/bikunavi.model3.json", {
      autoInteract: false
    });
    originalModelWidth = model.width;
    originalModelHeight = model.height;
    visualBounds = getVisualBounds(model.internalModel);
    pixiApp.stage.addChild(model);
    model.interactive = true;
    fitModel();
    status.textContent = "";

    if (model.internalModel.physics) {
      console.log("びくにたんのLive2D物理演算を読み込みました");
    }

    // Site behavior: breathing, randomized blinking, and speaking mouth.
    model.internalModel.breath = undefined;
    model.internalModel.on("beforeMotionUpdate", () => {
      const seconds = performance.now() / 1000;
      model.internalModel.coreModel.setParameterValueById(
        "ParamBreath",
        (Math.sin(seconds * 0.8) + 1) / 2
      );
    });
    model.internalModel.on("beforeModelUpdate", () => {
      const core = model.internalModel.coreModel;
      const seconds = performance.now() / 1000;
      const danceActive =
        musicPlaying && !isHovered && !dragging && !chatActive && !isThinking && !isSpeaking;
      const danceTarget = danceActive ? 1 : 0;
      const danceEase = Math.min(1, pixiApp.ticker.deltaMS / 450);
      musicDanceWeight += (danceTarget - musicDanceWeight) * danceEase;
      if (musicDanceWeight > 0.001) {
        const bounce = Math.sin(seconds * Math.PI * 3.6);
        const sway = Math.sin(seconds * Math.PI * 1.8);
        core.addParameterValueById(
          "ParamBodyPositionY",
          bounce * 8,
          musicDanceWeight
        );
        core.addParameterValueById(
          "ParamBodyAngleZ",
          sway * 6,
          musicDanceWeight
        );
        core.addParameterValueById(
          "ParamAngleZ",
          sway * -4,
          musicDanceWeight
        );
        core.addParameterValueById(
          "ParamBodyX",
          sway * 4,
          musicDanceWeight
        );
      }
      blinkTimer -= pixiApp.ticker.deltaMS;
      if (blinkTimer <= 0) blinkTimer = Math.random() * 3000 + 2000;
      const smilingEyes = currentEmote.eyeSmile > 0.5;
      const eyeOpen = !smilingEyes && blinkTimer < 150 ? 0 : currentEmote.eyeOpen;
      let mouthOpen = currentEmote.mouthOpen;
      if (!isThinking && (isSpeaking || (isHovered && !chatActive))) {
        const noise = Math.sin(seconds * 25) * Math.sin(seconds * 7);
        mouthOpen = Math.max(mouthOpen, noise * 0.5 + 0.4);
      }
      core.setParameterValueById("ParamEyeLOpen", eyeOpen);
      core.setParameterValueById("ParamEyeROpen", eyeOpen);
      core.setParameterValueById("ParamEyeLSmile", currentEmote.eyeSmile);
      core.setParameterValueById("ParamEyeRSmile", currentEmote.eyeSmile);
      core.setParameterValueById("ParamMouthForm", currentEmote.mouthForm);
      core.setParameterValueById("ParamMouthOpenY", mouthOpen);
    });

    try {
      const settings = await bikunavi.invoke("companion:settings");
      if ([30000, 60000, 120000].includes(settings?.idleIntervalMs)) {
        idleIntervalMs = settings.idleIntervalMs;
      }
    } catch (error) {
      console.error("Settings load failed:", error);
    }
    try {
      const saved = await bikunavi.invoke("companion:load-history");
      for (const entry of saved?.lineHistory ?? []) {
        if (!entry?.text) continue;
        lineHistory.push({
          ...normalizeSpeechItem(entry),
          kind: entry.kind || "line",
          time: entry.time || Date.now()
        });
      }
      lineHistory.splice(0, Math.max(0, lineHistory.length - 20));
      lineHistoryIndex = lineHistory.length - 1;
      for (const entry of saved?.chatEntries ?? []) {
        if (entry?.question || entry?.answer) chatEntries.push(entry);
      }
      chatEntries.splice(0, Math.max(0, chatEntries.length - 10));
      chatEntryIndex = chatEntries.length - 1;
    } catch (error) {
      console.error("History load failed:", error);
    }

    startChatter();
    startFloating();
    musicPlaying = Boolean(await bikunavi.invoke("companion:music-playing"));
    systemSleeping = Boolean(await bikunavi.invoke("companion:system-sleeping"));
    pomodoroState = await bikunavi.invoke("companion:pomodoro-state");
    if (pomodoroState.active) showPomodoroBubble(pomodoroState);
    resumeAmbientState();
    console.log("サイト版の挙動でびくにたんを起動しました");
    window.addEventListener("resize", () => {
      fitModel();
      requestAnimationFrame(fitModel);
    });
  } catch (error) {
    console.error(error);
    status.textContent = "モデルを読み込めませんでした";
  }
}

bikunavi.on("companion:cursor", (point) => {
  if (!model || pointerDown) return;
  const insideCharacter = characterHitBounds?.contains(point.x, point.y) ?? false;
  const inside = insideCharacter || isPointInActiveBubble(point);
  if (suppressHoverUntilLeave) {
    if (!inside) suppressHoverUntilLeave = false;
    model.focus(point.x, point.y);
    return;
  }
  if (inside) enterCharacter();
  else leaveCharacter();
  model.focus(point.x, point.y);
});

bikunavi.on("companion:window-edge", (state) => {
  const nextTopDocked = Boolean(state?.topDocked);
  if (topDocked === nextTopDocked) return;
  topDocked = nextTopDocked;
  if (model) fitModel();
});

bikunavi.on("companion:open-chat", () => {
  clearTimeout(chatIdleTimer);
  clearTimeout(hideBubbleTimer);
  suppressHoverUntilLeave = false;
  chatActive = true;
  lineHistoryActive = false;
  bikunavi.send("companion:hover", true);
  setEmote("joy");
  showChatBubble();
  requestAnimationFrame(() => {
    bubble.querySelector(".chat-form input")?.focus();
  });
  scheduleChatIdleReset();
});

bikunavi.on("companion:custom-question", (item) => {
  const question = normalizeSpeechItem(item);
  if (!question.text || !question.questionId) return;
  pendingCharacterCustomization = question;
  clearTimeout(chatIdleTimer);
  clearTimeout(hideBubbleTimer);
  suppressHoverUntilLeave = false;
  chatActive = true;
  lineHistoryActive = false;
  bikunavi.send("companion:hover", true);
  setEmote("joy");
  showChatBubble();
  requestAnimationFrame(() => {
    bubble.querySelector(".chat-form input")?.focus();
  });
  scheduleChatIdleReset();
});

new MutationObserver(() => {
  if (model && topDocked) fitModel();
}).observe(bubble, {
  attributes: true,
  attributeFilter: ["class"]
});

bikunavi.on("companion:speech-ended", (speechId) => {
  if (speechId !== currentSpeechId) return;
  const speechKind = currentSpeechKind;
  currentSpeechId = undefined;
  currentSpeechKind = undefined;
  isSpeaking = false;
  if (speechKind === "idle") {
    const holdMs = currentSpeechHoldMs;
    currentSpeechHoldMs = 900;
    clearTimeout(chatterEndTimer);
    resumeAmbientState();
    hideBubble(holdMs);
  }
});

bikunavi.on("companion:speech-started", (payload) => {
  currentSpeechId = payload?.speechId;
  currentSpeechKind = payload?.kind || "answer";
  isSpeaking = Boolean(currentSpeechId);
});

bikunavi.on("companion:music-playing", (playing) => {
  musicPlaying = Boolean(playing);
  resumeAmbientState();
});

bikunavi.on("companion:fortune", (fortune) => {
  const fortuneItem = normalizeSpeechItem(fortune);
  rememberLine(fortuneItem, "fortune");
  showBubble(fortuneItem);
  setEmote("joy");
  hideBubble(25000);
});

bikunavi.on("companion:ambient-line", async (item) => {
  const lineItem = normalizeSpeechItem(item);
  if (!lineItem.text) return;
  clearTimeout(chatIdleTimer);
  clearTimeout(hideBubbleTimer);
  clearTimeout(chatterEndTimer);
  if (isSpeaking) bikunavi.send("companion:stop-speech");
  chatActive = false;
  lineHistoryActive = false;
  suppressHoverUntilLeave = false;
  rememberLine(lineItem, "idle");
  showBubble(lineItem);
  setEmote("joy");

  let speechId = null;
  try {
    speechId = await bikunavi.invoke("companion:speak", lineItem.text, "idle");
  } catch (speechError) {
    console.error("Ambient speech failed:", speechError);
  }
  isSpeaking = true;
  currentSpeechHoldMs = getIdleSpeechHoldMs(lineItem);
  if (speechId) {
    currentSpeechId = speechId;
    currentSpeechKind = "idle";
  }
  const displayDuration = speechId
    ? 60000
    : Math.max(currentSpeechHoldMs, Math.min(30000, Math.max(6500, lineItem.text.length * 180)));
  chatterEndTimer = setTimeout(() => {
    currentSpeechKind = undefined;
    currentSpeechHoldMs = 900;
    isSpeaking = false;
    resumeAmbientState();
    hideBubble();
  }, displayDuration);
});

bikunavi.on("companion:settings-changed", (settings) => {
  if ([30000, 60000, 120000].includes(settings?.idleIntervalMs)) {
    idleIntervalMs = settings.idleIntervalMs;
    scheduleChatter();
  }
});

bikunavi.on("companion:clear-history", () => {
  lineHistory.length = 0;
  chatEntries.length = 0;
  lineHistoryIndex = -1;
  chatEntryIndex = -1;
  if (lineHistoryActive) showLineHistory(0);
});

bikunavi.on("companion:show-line-history", () => {
  showLineHistory(lineHistory.length ? lineHistory.length - 1 : 0);
  setEmote("joy");
});

bikunavi.on("companion:system-sleep", (sleeping) => {
  systemSleeping = Boolean(sleeping);
  if (systemSleeping) {
    clearTimeout(chatterEndTimer);
    clearTimeout(responseSpeechTimer);
    idleChatterBusy = false;
    isSpeaking = false;
    currentSpeechId = undefined;
    currentSpeechKind = undefined;
    lineHistoryActive = false;
    if (!chatActive) bubble.classList.remove("is-active");
    return;
  }
  bikunavi.invoke("companion:prepare-idle-lines").catch(console.error);
  resumeAmbientState();
  if (pomodoroState.active && !chatActive && !dragging) {
    showPomodoroBubble(pomodoroState);
  }
});

bikunavi.on("companion:pomodoro", (state) => {
  pomodoroState = state || {
    active: false,
    running: false,
    remaining: 0,
    label: "",
    timeText: ""
  };
  const reason = pomodoroState.reason;
  if (["started", "autoBreakStarted", "autoFocusStarted", "paused", "resumed", "completed", "stopped"].includes(reason)) {
    showPomodoroBubble(pomodoroState, reason === "completed");
  } else if (pomodoroState.active && bubble.classList.contains("has-timer")) {
    showPomodoroBubble(pomodoroState);
  }
  if (!pomodoroState.active && reason !== "completed") resumeAmbientState();
});

canvas.addEventListener("pointerdown", (event) => {
  if (!model || event.button !== 0) return;
  pointerDown = { x: event.screenX, y: event.screenY };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerDown) return;
  const distance = Math.hypot(
    event.screenX - pointerDown.x,
    event.screenY - pointerDown.y
  );
  if (distance > 5 && !dragging) {
    dragging = true;
    clearTimeout(chatterEndTimer);
    isSpeaking = false;
    setEmote("surprised");
    const dragLine = "わわっ！どこに連れていくんですか〜？";
    rememberLine(dragLine, "system");
    showBubble(dragLine);
    bikunavi.send("companion:drag-start");
  }
  if (dragging) bikunavi.send("companion:drag-move");
});

canvas.addEventListener("pointerup", (event) => {
  if (!pointerDown) return;
  canvas.releasePointerCapture(event.pointerId);
  if (dragging) bikunavi.send("companion:drag-end");
  pointerDown = undefined;
  dragging = false;
  if (topDocked) {
    // 上端へ置いた直後はドラッグ中の吹き出しを閉じ、透明な頭上余白を
    // 折りたたんだ状態を見せる。再びホバーすれば通常どおり会話欄を開く。
    isHovered = false;
    chatActive = false;
    suppressHoverUntilLeave = true;
    bubble.classList.remove("is-active");
    bikunavi.send("companion:hover", false);
    resumeAmbientState();
    fitModel();
    return;
  }
  if (isHovered) {
    setEmote("joy");
    showChatBubble();
  } else {
    resumeAmbientState();
    if (pomodoroState.active) showPomodoroBubble(pomodoroState);
    else hideBubble(1500);
  }
});

canvas.addEventListener("pointercancel", () => {
  if (dragging) bikunavi.send("companion:drag-end");
  pointerDown = undefined;
  dragging = false;
  if (isHovered) {
    setEmote("joy");
    showChatBubble();
  } else {
    resumeAmbientState();
    if (pomodoroState.active) showPomodoroBubble(pomodoroState);
    else hideBubble(1500);
  }
});

start();
