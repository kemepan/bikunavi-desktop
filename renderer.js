// PIXI と PIXI.live2d は index.html の <script> で読み込むブラウザビルドを使う。
// Node 連携は preload.js が公開する window.bikunavi 経由のみ。
const { Live2DModel } = PIXI.live2d;

const canvas = document.querySelector("#stage");
const bubble = document.querySelector("#bubble");
const pomodoroQuick = document.querySelector("#pomodoro-quick");
const soundToggle = document.querySelector("#sound-toggle");
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
  wink: { eyeOpen: 1, eyeSmile: 1, mouthForm: 1, mouthOpen: 0 },
  proud: { eyeOpen: 1, eyeSmile: 0, mouthForm: 0.4, mouthOpen: 0 }
};
const EXPRESSION_NAMES = {
  joy: "f02",
  surprised: "f03",
  thinking: "f04",
  wink: "f05",
  proud: "f06"
};
// AI回答が指定できる表情。"normal" はEMOTES/EXPRESSION_NAMES未定義のため
// setEmoteで自然にデフォルト顔（表情リセット）へ落ちる。
// emote-utils.js の CHAT_EMOTES と同一内容を保つこと（表情の増減時は両方更新）。
const ANSWER_EMOTES = new Set(["joy", "wink", "proud", "surprised", "normal"]);
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
const savedLinkUrls = new Set();
let lineHistoryIndex = -1;
let lineHistoryActive = false;
let currentEmote = { ...EMOTES.default };
let motionSequence = 0;
let blinkTimer = 0;
let hideBubbleTimer;
let chatterEndTimer;
let responseSpeechTimer;
let thinkingSoundTimer;
let thinkingSoundPlaying = false;
let idleChatterBusy = false;
let chatIdleTimer;
let suppressHoverUntilLeave = false;
let currentSpeechId;
let currentSpeechKind;
let currentSpeechHoldMs = 900;
let musicPlaying = false;
let musicDanceWeight = 0;
let idleGazeX = 0;
let idleGazeY = 0;
let idleGazeTargetX = 0;
let idleGazeTargetY = 0;
let nextIdleGazeAt = 0;
let systemSleeping = false;
let topDocked = false;
let pomodoroState = { active: false, running: false, remaining: 0, label: "", timeText: "" };
let pomodoroHideTimer;
let pomodoroQuickVisible;
let soundMuted = false;
let soundToggleVisible;
// いま素の吹き出しに出しているソース。ニュース吹き出しにホバーして会話欄へ
// 切り替わっても、このソースボタンを引き継いで消さないために覚えておく。
let displayedLineSources = [];
// 表示中の自動セリフ・ニュース等。ホバーで会話欄を開いても読み続けられるよう保持する
let displayedLineItem;
// 吹き出しが閉じた後も、次のホバーでは過去の会話より直前の独り言・ニュースを優先する。
let latestAmbientLineItem;
let idleIntervalMs = 30000;
let chatterTimer;
let historySaveTimer;
let voiceInputActive = false;
let voiceInputButton;
let voiceInputTargetInput;
let voiceRecorder;
let voiceRecordingTimer;
let chatDraft = "";
let preferredUserName = "あなた";
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
  const soundLeft = Math.min(width - 34, characterHitBounds.x + characterHitBounds.width - 12);
  const soundTop = Math.max(8, characterHitBounds.y + Math.min(64, characterHitBounds.height * 0.16));
  soundToggle.style.left = `${soundLeft}px`;
  soundToggle.style.top = `${soundTop}px`;
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

function isPointInPomodoroQuick(point) {
  if (!pomodoroQuick?.classList.contains("is-visible")) return false;
  const rect = pomodoroQuick.getBoundingClientRect();
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function isPointInSoundToggle(point) {
  if (!soundToggle?.classList.contains("is-visible")) return false;
  const rect = soundToggle.getBoundingClientRect();
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function updatePomodoroQuickVisibility() {
  const visible = Boolean(
    isHovered &&
    !dragging &&
    !chatActive &&
    !lineHistoryActive &&
    !isThinking &&
    !isSpeaking &&
    !voiceInputActive &&
    !pomodoroState.active
  );
  if (visible === pomodoroQuickVisible) return;
  pomodoroQuickVisible = visible;
  pomodoroQuick?.classList.toggle("is-visible", visible);
  pomodoroQuick?.setAttribute("aria-hidden", visible ? "false" : "true");
}

let soundToggleMutedRendered;
// びくたんアイコン（assets/ui/sound-on.png / sound-off.png）が用意されていれば
// 絵文字の代わりに使う。片方だけ置いた場合はその状態のみ画像、残りは🔊/🔇のまま。
const soundToggleImageReady = { on: false, off: false };
(function probeSoundToggleImages() {
  const targets = [
    ["on", "assets/ui/sound-on.png"],
    ["off", "assets/ui/sound-off.png"]
  ];
  for (const [state, src] of targets) {
    const probe = new Image();
    probe.onload = () => {
      soundToggleImageReady[state] = true;
      soundToggleMutedRendered = undefined;
      updateSoundToggle();
    };
    probe.src = src;
  }
})();

function updateSoundToggle() {
  const visible = Boolean(isHovered && !dragging);
  if (visible !== soundToggleVisible) {
    soundToggleVisible = visible;
    soundToggle?.classList.toggle("is-visible", visible);
    soundToggle?.setAttribute("aria-hidden", visible ? "false" : "true");
  }
  // 毎フレーム呼ばれるため、ミュート表示は値が変わった時だけDOMを触る
  if (soundMuted === soundToggleMutedRendered) return;
  soundToggleMutedRendered = soundMuted;
  const useImage = soundMuted ? soundToggleImageReady.off : soundToggleImageReady.on;
  soundToggle?.classList.toggle("is-muted", soundMuted);
  soundToggle?.classList.toggle("has-image", useImage);
  soundToggle.textContent = useImage ? "" : (soundMuted ? "🔇" : "🔊");
  soundToggle?.setAttribute("aria-pressed", soundMuted ? "true" : "false");
  soundToggle?.setAttribute(
    "aria-label",
    soundMuted ? "びくたんの音を再開" : "びくたんの音をミュート"
  );
  soundToggle.title = soundMuted ? "音を再開" : "音をミュート";
}

pomodoroQuick?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-phase]");
  const phase = button?.dataset.phase;
  if (!phase || pomodoroState.active) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    pomodoroState = await bikunavi.invoke("companion:pomodoro-action", `start-${phase}`);
    updatePomodoroQuickVisibility();
    showPomodoroBubble(pomodoroState, true);
  } catch (error) {
    console.error("Quick pomodoro start failed:", error);
  }
});

soundToggle?.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  try {
    soundMuted = Boolean(await bikunavi.invoke("companion:toggle-sound-mute"));
    updateSoundToggle();
  } catch (error) {
    console.error("Sound mute toggle failed:", error);
  }
});

function normalizeSpeechItem(item) {
  if (typeof item === "string") return { text: item, sources: [], choices: [] };
  return {
    text: String(item?.text ?? ""),
    sources: Array.isArray(item?.sources) ? item.sources : [],
    kind: String(item?.kind || ""),
    questionId: String(item?.questionId || ""),
    answerKind: String(item?.answerKind || ""),
    choices: Array.isArray(item?.choices)
      ? item.choices.map((choice) => String(choice).trim()).filter(Boolean).slice(0, 6)
      : [],
    emote: ANSWER_EMOTES.has(item?.emote) ? item.emote : ""
  };
}

function createChoiceButtons(question) {
  if (!question?.choices?.length || question.kind !== "custom-question") return undefined;
  const container = document.createElement("div");
  container.className = "choice-buttons";
  for (const choice of question.choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = choice;
    button.addEventListener("click", () => {
      answerWithChoice(choice);
    });
    container.append(button);
  }
  return container;
}

function answerWithChoice(choice) {
  // 読み上げ途中でも選択肢で即答できるよう、進行中の状態を畳んでから回答する
  clearTimeout(chatterEndTimer);
  clearTimeout(hideBubbleTimer);
  if (currentSpeechId) bikunavi.send("companion:stop-speech");
  currentSpeechId = undefined;
  currentSpeechKind = undefined;
  isSpeaking = false;
  chatActive = true;
  bikunavi.send("companion:hover", true);
  runChat(choice);
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

async function playPomodoroChime(kind) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass || systemSleeping) return;
  const context = new AudioContextClass();
  if (context.state === "suspended") await context.resume();
  const now = context.currentTime;
  const notes = kind === "start"
    ? [{ frequency: 660, at: 0 }, { frequency: 880, at: 0.16 }]
    : [{ frequency: 880, at: 0 }, { frequency: 660, at: 0.18 }, { frequency: 523, at: 0.36 }];
  for (const note of notes) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startsAt = now + note.at;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(note.frequency, startsAt);
    gain.gain.setValueAtTime(0.0001, startsAt);
    gain.gain.exponentialRampToValueAtTime(0.24, startsAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + 0.22);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startsAt);
    oscillator.stop(startsAt + 0.23);
  }
  setTimeout(() => context.close().catch(() => {}), 1000);
}

async function deferUnansweredQuestion(question) {
  if (!question?.questionId || pendingCharacterCustomization?.questionId !== question.questionId) return;
  await bikunavi.invoke(customQuestionDeferChannel(question), question.questionId);
  if (pendingCharacterCustomization?.questionId === question.questionId) {
    pendingCharacterCustomization = undefined;
  }
}

function rememberLine(item, kind = "line") {
  const speechItem = normalizeSpeechItem(item);
  if (!speechItem.text.trim()) return;
  const previous = lineHistory[lineHistory.length - 1];
  if (previous?.text === speechItem.text) return;
  const remembered = {
    text: speechItem.text,
    sources: speechItem.sources,
    kind,
    time: Date.now()
  };
  lineHistory.push(remembered);
  if (["idle", "fortune"].includes(kind)) {
    latestAmbientLineItem = { ...normalizeSpeechItem(remembered), time: remembered.time };
  }
  if (lineHistory.length > 20) lineHistory.shift();
  if (!lineHistoryActive) lineHistoryIndex = getHistoryTimeline().length - 1;
  saveHistorySoon();
}

function formatHistoryTime(rawTime) {
  const time = Number(rawTime);
  if (!Number.isFinite(time) || time <= 0) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(time));
}

function getHistoryTimeline() {
  const lineTimes = lineHistory
    .map((entry) => Number(entry.time))
    .filter((time) => Number.isFinite(time) && time > 0);
  const oldestLineTime = lineTimes.length ? Math.min(...lineTimes) : Date.now();
  const legacyChatStart = oldestLineTime - (chatEntries.length + 1) * 1000;

  const lines = lineHistory.map((entry, index) => ({
    text: `びくたん：${entry.text}`,
    speakText: entry.text,
    sources: entry.sources,
    time: Number(entry.time) || oldestLineTime + index,
    displayTime: Number(entry.time) || 0,
    order: 0
  }));
  const chats = chatEntries.map((entry, index) => {
    const exactTime = Number(entry.time);
    return {
      text: [
        entry.question ? `${preferredUserName}：${entry.question}` : "",
        entry.answer ? `びくたん：${entry.answer}` : ""
      ].filter(Boolean).join("\n\n"),
      speakText: entry.answer || "",
      sources: entry.sources,
      time: exactTime > 0 ? exactTime : legacyChatStart + index * 1000,
      displayTime: exactTime > 0 ? exactTime : 0,
      order: 1
    };
  });

  return [...lines, ...chats]
    .filter((entry) => entry.text)
    .sort((left, right) => left.time - right.time || left.order - right.order)
    .slice(-30);
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
    const item = document.createElement("div");
    item.className = "source-link-item";
    const link = document.createElement("button");
    link.type = "button";
    link.textContent = `ソース: ${makeSourceLabel(source, index)}`;
    link.title = source.title || source.url;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      bikunavi.invoke("companion:open-url", source.url).catch(console.error);
    });
    const save = document.createElement("button");
    save.type = "button";
    save.className = "source-save";
    const updateSavedState = () => {
      const saved = savedLinkUrls.has(source.url);
      save.textContent = saved ? "★" : "☆";
      save.title = saved ? "気になる記事に保存済み" : "気になる記事に保存";
      save.setAttribute("aria-label", save.title);
    };
    updateSavedState();
    save.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const result = await bikunavi.invoke("companion:save-link", source);
        if (result?.saved) savedLinkUrls.add(source.url);
        updateSavedState();
      } catch (error) {
        console.error("Source save failed:", error);
      }
    });
    item.append(link, save);
    sourceList.append(item);
  }
  return sourceList;
}

async function replaySpeech(text) {
  const replayText = String(text || "").trim();
  if (!replayText) return;
  clearTimeout(chatterEndTimer);
  clearTimeout(hideBubbleTimer);
  if (currentSpeechId) bikunavi.send("companion:stop-speech");
  currentSpeechId = undefined;
  currentSpeechKind = undefined;
  isSpeaking = false;
  try {
    const speechId = await bikunavi.invoke("companion:speak", replayText, "answer");
    if (!speechId) return;
    currentSpeechId = speechId;
    currentSpeechKind = "answer";
    isSpeaking = true;
    setEmote("joy");
    playMotionOnce("Happy");
  } catch (error) {
    console.error("Replay speech failed:", error);
  }
}

function createReplayButton(text) {
  if (!String(text || "").trim()) return undefined;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "is-wide";
  button.textContent = "↻ もう一度聞く";
  button.title = "この内容を先頭から読み上げ";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    replaySpeech(text).catch(console.error);
    scheduleChatIdleReset();
  });
  return button;
}

function appendReplayAction(text) {
  const replay = createReplayButton(text);
  if (!replay) return;
  const actions = document.createElement("div");
  actions.className = "bubble-actions";
  actions.append(replay);
  bubble.append(actions);
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
  displayedLineItem = speechItem;
  const sourceList = createSourceLinks(validSources);
  if (sourceList) bubble.append(sourceList);
  appendReplayAction(speechItem.text);
  const choiceButtons = createChoiceButtons(speechItem);
  if (choiceButtons) bubble.append(choiceButtons);
  bubble.classList.remove("has-actions", "has-chat", "has-timer", "has-history");
  bubble.classList.add("is-active");
}

function showLineHistory(index = lineHistoryIndex) {
  clearTimeout(hideBubbleTimer);
  clearTimeout(pomodoroHideTimer);
  displayedLineSources = [];
  displayedLineItem = undefined;
  bubble.replaceChildren();
  bubble.classList.remove("has-actions", "has-chat", "has-timer", "has-history");
  bubble.classList.add("has-history", "is-active");
  lineHistoryActive = true;
  const timeline = getHistoryTimeline();

  if (!timeline.length) {
    const empty = document.createElement("div");
    empty.className = "bubble-message";
    empty.textContent = "まだおしゃべりの履歴がありません。";
    bubble.append(empty);
    const controls = document.createElement("div");
    controls.className = "line-history";
    controls.append(createLineHistoryCloseButton());
    bubble.append(controls);
    return;
  }

  lineHistoryIndex = Math.max(0, Math.min(index, timeline.length - 1));
  const entry = timeline[lineHistoryIndex];
  const message = document.createElement("div");
  message.className = "bubble-message history-message";
  const timeLabel = entry.displayTime
    ? formatHistoryTime(entry.displayTime)
    : "以前の会話（時刻記録なし）";
  message.textContent = `${timeLabel}\n${entry.text}`;
  bubble.append(message);
  const sourceList = createSourceLinks(entry.sources);
  if (sourceList) bubble.append(sourceList);

  const controls = document.createElement("div");
  controls.className = "line-history";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "‹";
  previous.title = "前のおしゃべり";
  previous.disabled = lineHistoryIndex <= 0;
  previous.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showLineHistory(lineHistoryIndex - 1);
  });

  const count = document.createElement("span");
  count.textContent = `${lineHistoryIndex + 1}/${timeline.length}`;

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "›";
  next.title = "次のおしゃべり";
  next.disabled = lineHistoryIndex >= timeline.length - 1;
  next.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showLineHistory(lineHistoryIndex + 1);
  });

  const replay = document.createElement("button");
  replay.type = "button";
  replay.className = "is-wide";
  replay.textContent = "↻ もう一度聞く";
  replay.title = "びくたんの発言を読み上げ";
  replay.disabled = !entry.speakText;
  replay.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    replaySpeech(entry.speakText).catch(console.error);
  });

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "icon-copy";
  copy.title = "このおしゃべりをコピー";
  copy.setAttribute("aria-label", "このおしゃべりをコピー");
  copy.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    bikunavi.invoke("companion:copy-text", message.textContent).catch(console.error);
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
  close.title = "最近のおしゃべりを閉じる";
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

function showChatBubble(busy = false, carriedSources = [], preparingSpeech = false, carriedLine = undefined) {
  clearTimeout(hideBubbleTimer);
  clearTimeout(pomodoroHideTimer);
  lineHistoryActive = false;
  // 通常の会話表示に切り替えたら、持ち越し中のセリフは役目を終える
  displayedLineItem = carriedLine;
  bubble.replaceChildren();
  const message = document.createElement("div");
  message.className = "chat-message";
  const entry = chatEntries[chatEntryIndex];
  if (busy) {
    message.textContent = `${preferredUserName}：${shortenForBubble(pendingQuestion, 80)}\n\nびくたん：考え中です…`;
  } else if (pendingCharacterCustomization) {
    message.textContent = pendingCharacterCustomization.text;
  } else if (carriedLine?.text) {
    // 表示中だったセリフ・記事をそのまま読み続けられるようにする
    message.textContent = carriedLine.text;
  } else if (entry) {
    message.textContent =
      `${preferredUserName}：${shortenForBubble(entry.question, 80)}\n\n` +
      `びくたん：${shortenForBubble(entry.answer, 240)}`;
  } else {
    message.textContent = "何をお手伝いしましょう？";
  }

  // ニュース吹き出しからホバーで会話欄へ切り替わった時は、直前に見ていた
  // ソースボタンを優先して残す。それ以外は表示中の回答のソースを出す。
  const sourceList = busy
    ? undefined
    : createSourceLinks(carriedSources.length ? carriedSources : entry?.sources);
  displayedLineSources = carriedLine ? carriedSources : [];
  // セリフ・記事を読んでいる最中は、過去の会話ナビより本文を優先する
  if (!busy && !pendingCharacterCustomization && !carriedLine && chatEntries.length) {
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
    copy.className = "icon-copy";
    copy.title = "この回答をコピー";
    copy.setAttribute("aria-label", "この回答をコピー");
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

  if (!busy) {
    const replayText = pendingCharacterCustomization?.text || carriedLine?.text || entry?.answer;
    appendReplayAction(replayText);
  }

  if (pendingCharacterCustomization && !busy && !preparingSpeech) {
    const choiceButtons = createChoiceButtons(pendingCharacterCustomization);
    if (choiceButtons) bubble.append(choiceButtons);
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
    if (pendingCharacterCustomization.answerKind === "character") {
      const skip = document.createElement("button");
      skip.type = "button";
      skip.textContent = "この質問はもうしない";
      skip.addEventListener("click", async () => {
        await bikunavi.invoke(
          "companion:skip-character-question",
          pendingCharacterCustomization?.questionId
        );
        pendingCharacterCustomization = undefined;
        showChatBubble();
        bubble.querySelector(".chat-form input")?.focus();
        scheduleChatIdleReset();
      });
      form.append(skip);
    }
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
    // 長い読み上げの途中で会話モードを閉じると、口パクだけ先に止まってしまう。
    // 音声が終わるまでは会話を維持し、終わってから改めて30秒待つ。
    if (isSpeaking || isThinking || isPreparingSpeech || voiceInputActive) {
      scheduleChatIdleReset();
      return;
    }
    chatActive = false;
    isHovered = false;
    pendingQuestion = "";
    suppressHoverUntilLeave = true;
    resumeAmbientState();
    bubble.classList.remove("is-active");
    bikunavi.send("companion:hover", false);
  }, 30000);
}

function scheduleThinkingSound() {
  clearTimeout(thinkingSoundTimer);
  thinkingSoundPlaying = false;
  // Geminiの返答が速い場合でも、考え始めた手触りが伝わるよう即時に鳴らす。
  // 返答を受け取ったら finally で止めるため、考え中だけ再生される。
  if (!isThinking || systemSleeping) return;
  thinkingSoundPlaying = true;
  bikunavi.send("companion:thinking-sound-start");
}

function stopThinkingSound() {
  clearTimeout(thinkingSoundTimer);
  if (thinkingSoundPlaying) bikunavi.send("companion:thinking-sound-stop");
  thinkingSoundPlaying = false;
}

async function runChat(rawMessage) {
  const message = rawMessage.trim();
  if (!message || isSpeaking || isThinking || isPreparingSpeech) return;
  // 「考え中」表示へ切り替えると displayedLineItem が消えるため、先に返信先を固定する。
  // ホバーで復元した古い独り言でも、入力欄から送った場合は明示的な返信として扱う。
  const directReplyItem = displayedLineItem?.text
    ? normalizeSpeechItem(displayedLineItem)
    : undefined;
  const lastLine = lineHistory[lineHistory.length - 1];
  const recentLineItem = lastLine && Date.now() - lastLine.time < 90000
    ? normalizeSpeechItem(lastLine)
    : undefined;
  const replyContextItem = directReplyItem || recentLineItem;
  const contextLine = replyContextItem?.text || "";
  const contextSources = replyContextItem?.sources || [];
  const isDirectReply = Boolean(directReplyItem);
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
  scheduleThinkingSound();
  try {
    const customizationQuestion = pendingCharacterCustomization;
    const response = normalizeSpeechItem(
      customizationQuestion
        ? await bikunavi.invoke(
          customQuestionAnswerChannel(customizationQuestion),
          customizationQuestion.questionId,
          message
        )
        : await bikunavi.invoke(
          "companion:chat",
          message,
          contextLine,
          isDirectReply,
          contextSources
        )
    );
    if (customizationQuestion) pendingCharacterCustomization = undefined;
    chatEntries.push({
      question: message,
      answer: response.text,
      sources: response.sources,
      contextLine: isDirectReply ? contextLine : "",
      time: Date.now()
    });
    latestAmbientLineItem = {
      ...normalizeSpeechItem({ text: response.text, sources: response.sources, kind: "answer" }),
      time: Date.now()
    };
    if (chatEntries.length > 10) chatEntries.shift();
    chatEntryIndex = chatEntries.length - 1;
    if (!lineHistoryActive) lineHistoryIndex = getHistoryTimeline().length - 1;
    saveHistorySoon();
    pendingQuestion = "";
    isThinking = false;
    // 回答テキストと入力欄を先に表示する。VOICEVOXの音声生成は数秒かかる場合が
    // あるため、ここでは待たず、次の会話操作を塞がない。
    isPreparingSpeech = false;
    showChatBubble();
    setEmote(response.emote || "joy");
    // emoteはnormalizeSpeechItemでANSWER_EMOTES検証済み。normal以外は喜びモーション付き
    if ((response.emote || "joy") !== "normal") {
      playMotionOnce("Happy");
    }

    bikunavi.invoke("companion:speak", response.text, "answer")
      .then((speechId) => {
        if (!speechId) return;
        currentSpeechId = speechId;
        currentSpeechKind = "answer";
        isSpeaking = true;
      })
      .catch((speechError) => {
        console.error("Speech failed:", speechError);
      });
    scheduleChatIdleReset();
  } catch (error) {
    console.error(error);
    chatEntries.push({
      question: message,
      answer: "うまく考えられませんでした。トレイメニューの「会話AI」設定を確認してください。",
      contextLine: isDirectReply ? contextLine : "",
      time: Date.now()
    });
    latestAmbientLineItem = {
      text: "うまく考えられませんでした。トレイメニューの「会話AI」設定を確認してください。",
      sources: [],
      kind: "answer",
      time: Date.now()
    };
    if (chatEntries.length > 10) chatEntries.shift();
    chatEntryIndex = chatEntries.length - 1;
    if (!lineHistoryActive) lineHistoryIndex = getHistoryTimeline().length - 1;
    saveHistorySoon();
    pendingQuestion = "";
    isThinking = false;
    isPreparingSpeech = false;
    isSpeaking = false;
    showChatBubble();
    setEmote("surprised");
    scheduleChatIdleReset();
  } finally {
    stopThinkingSound();
  }
}

function hideBubble(delay = 0) {
  clearTimeout(hideBubbleTimer);
  hideBubbleTimer = setTimeout(() => {
    if (!isSpeaking && !isHovered && !dragging && !chatActive && !lineHistoryActive && !pomodoroState.active) {
      bubble.classList.remove("is-active");
      displayedLineSources = [];
      displayedLineItem = undefined;
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
  motionSequence += 1;
  model?.internalModel.motionManager.stopAllMotions();
}

function playMotionOnce(group, duration = 2950) {
  if (!model) return;
  const sequence = ++motionSequence;
  model.motion(group, 0);
  setTimeout(() => {
    if (sequence !== motionSequence) return;
    stopMotions();
  }, duration);
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
    // 表示中、または直前の自動セリフ・ニュースを残したまま入力欄を足す。
    // 会話履歴はホバーの初期表示にせず、直前にびくたんが話した内容を優先する。
    const visibleLine = bubble.classList.contains("is-active") &&
      !bubble.classList.contains("has-chat") &&
      !bubble.classList.contains("has-timer") &&
      !bubble.classList.contains("has-history")
      ? displayedLineItem
      : undefined;
    const readingLine = visibleLine || latestAmbientLineItem;
    showChatBubble(false, readingLine?.sources || [], false, readingLine);
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
      playMotionOnce(lineItem.kind === "custom-question" ? "Wave" : "Happy");

      clearTimeout(chatterEndTimer);
      const displayDuration = speechId
        ? 60000
        : Math.max(
          currentSpeechHoldMs,
          Math.min(30000, Math.max(6500, lineItem.text.length * 180))
        );
      chatterEndTimer = setTimeout(() => {
        deferUnansweredQuestion(lineItem).catch(console.error);
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

function updateIdleGaze(seconds, deltaMs, active) {
  if (active && seconds >= nextIdleGazeAt) {
    // 見張っている印象にならないよう、視線はたまに・ごく小さく動かす。
    idleGazeTargetX = (Math.random() - 0.5) * 0.38;
    idleGazeTargetY = (Math.random() - 0.5) * 0.2;
    nextIdleGazeAt = seconds + 2.8 + Math.random() * 4.8;
  } else if (!active) {
    idleGazeTargetX = 0;
    idleGazeTargetY = 0;
  }
  const ease = Math.min(1, deltaMs / 1150);
  idleGazeX += (idleGazeTargetX - idleGazeX) * ease;
  idleGazeY += (idleGazeTargetY - idleGazeY) * ease;
}

async function start() {
  try {
    model = await Live2DModel.from("assets/bikunavi_desktop/bikunavi_desktop.model3.json", {
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
      updatePomodoroQuickVisibility();
      updateSoundToggle();
      const danceActive =
        musicPlaying && !isHovered && !dragging && !chatActive && !isThinking && !isSpeaking;
      const idleGazeActive =
        !isHovered && !dragging && !chatActive && !isThinking && !isSpeaking && !pomodoroState.active;
      updateIdleGaze(seconds, pixiApp.ticker.deltaMS, idleGazeActive);
      if (Math.abs(idleGazeX) > 0.001 || Math.abs(idleGazeY) > 0.001) {
        core.addParameterValueById("ParamEyeBallX", idleGazeX);
        core.addParameterValueById("ParamEyeBallY", idleGazeY);
        core.addParameterValueById("ParamAngleX", idleGazeX * 1.8);
        core.addParameterValueById("ParamAngleY", idleGazeY * 1.2);
      }
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
      if (!danceActive && !dragging) {
        if (isThinking) {
          // 考え中は少し首を傾け、話している時とは違う静かな動きにする。
          core.addParameterValueById("ParamAngleZ", Math.sin(seconds * 1.7) * 1.6);
          core.addParameterValueById("ParamBodyPositionY", Math.sin(seconds * 1.2) * 0.8);
        } else if (isSpeaking) {
          // 発話中は口だけでなく、声に合わせて上体も小さく弾ませる。
          core.addParameterValueById("ParamBodyPositionY", Math.sin(seconds * 4.2) * 2.2);
          core.addParameterValueById("ParamBodyAngleZ", Math.sin(seconds * 2.1) * 1.4);
        } else if (chatActive || isHovered) {
          // 聞いている間はユーザー側へ軽く首を傾ける。
          core.addParameterValueById("ParamAngleZ", 1.1 + Math.sin(seconds * 1.1) * 0.6);
          core.addParameterValueById("ParamBodyPositionY", Math.sin(seconds * 1.3) * 0.7);
        } else {
          // 待機中も完全停止にせず、呼吸より長い周期でごく小さく揺らす。
          core.addParameterValueById("ParamBodyPositionY", Math.sin(seconds * 0.9) * 0.75);
          core.addParameterValueById("ParamBodyAngleZ", Math.sin(seconds * 0.55) * 0.55);
        }
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
      if (String(settings?.preferredUserName || "").trim()) {
        preferredUserName = String(settings.preferredUserName).trim();
      }
      if (typeof settings?.soundMuted === "boolean") {
        soundMuted = settings.soundMuted;
        updateSoundToggle();
      }
    } catch (error) {
      console.error("Settings load failed:", error);
    }
    try {
      const savedLinks = await bikunavi.invoke("companion:saved-links");
      for (const link of Array.isArray(savedLinks) ? savedLinks : []) {
        if (typeof link?.url === "string") savedLinkUrls.add(link.url);
      }
    } catch (error) {
      console.error("Saved links load failed:", error);
    }
    try {
      const saved = await bikunavi.invoke("companion:load-history");
      for (const entry of saved?.lineHistory ?? []) {
        if (!entry?.text) continue;
        const restored = {
          ...normalizeSpeechItem(entry),
          kind: entry.kind || "line",
          time: entry.time || Date.now()
        };
        lineHistory.push(restored);
        if (["idle", "fortune"].includes(restored.kind)) {
          latestAmbientLineItem = { ...normalizeSpeechItem(restored), time: restored.time };
        }
      }
      lineHistory.splice(0, Math.max(0, lineHistory.length - 20));
      const savedChats = saved?.chatEntries ?? [];
      for (const [index, entry] of savedChats.entries()) {
        if (entry?.question || entry?.answer) {
          chatEntries.push({
            ...entry,
            time: Number(entry.time) || 0,
            legacyOrder: index
          });
        }
      }
      chatEntries.splice(0, Math.max(0, chatEntries.length - 10));
      chatEntryIndex = chatEntries.length - 1;
      const latestChat = chatEntries[chatEntries.length - 1];
      if (
        latestChat?.answer &&
        (!latestAmbientLineItem || Number(latestChat.time) >= Number(latestAmbientLineItem.time))
      ) {
        latestAmbientLineItem = {
          ...normalizeSpeechItem({ text: latestChat.answer, sources: latestChat.sources, kind: "answer" }),
          time: latestChat.time
        };
      }
      lineHistoryIndex = getHistoryTimeline().length - 1;
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
  const inside = insideCharacter || isPointInActiveBubble(point) ||
    isPointInPomodoroQuick(point) || isPointInSoundToggle(point);
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
  playMotionOnce("Wave", 2850);
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
  playMotionOnce("Wave", 2850);
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
    const unansweredQuestion = pendingCharacterCustomization;
    if (unansweredQuestion) {
      setTimeout(() => {
        if (!chatActive && !isHovered) deferUnansweredQuestion(unansweredQuestion).catch(console.error);
      }, Math.max(holdMs, 9000));
    }
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
  playMotionOnce("Happy");
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
  playMotionOnce(lineItem.kind === "custom-question" ? "Wave" : "Happy");

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
  if (typeof settings?.soundMuted === "boolean") {
    soundMuted = settings.soundMuted;
    updateSoundToggle();
  }
});

bikunavi.on("companion:clear-history", () => {
  lineHistory.length = 0;
  chatEntries.length = 0;
  latestAmbientLineItem = undefined;
  lineHistoryIndex = -1;
  chatEntryIndex = -1;
  if (lineHistoryActive) showLineHistory(0);
});

bikunavi.on("companion:show-line-history", () => {
  const timeline = getHistoryTimeline();
  showLineHistory(timeline.length ? timeline.length - 1 : 0);
  setEmote("joy");
});

bikunavi.on("companion:system-sleep", (sleeping) => {
  systemSleeping = Boolean(sleeping);
  if (systemSleeping) {
    stopThinkingSound();
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

bikunavi.on("companion:pomodoro-chime", (kind) => {
  if (soundMuted) return;
  playPomodoroChime(kind === "finish" ? "finish" : "start").catch(console.error);
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
