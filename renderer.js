const PIXI = require("pixi.js");
const { ipcRenderer } = require("electron");
window.PIXI = PIXI;

const { Live2DModel } = require("pixi-live2d-display/cubism4");

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
let chatActive = false;
let pendingQuestion = "";
let chatEntryIndex = -1;
const chatEntries = [];
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
let musicPlaying = false;
let musicDanceWeight = 0;

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
  const targetCenterY = bubbleSpace + (height - bubbleSpace) / 2;
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
  bubble.style.top = `${characterHitBounds.y - 5}px`;
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

function normalizeSpeechItem(item) {
  if (typeof item === "string") return { text: item, sources: [] };
  return {
    text: String(item?.text ?? ""),
    sources: Array.isArray(item?.sources) ? item.sources : []
  };
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
      ipcRenderer.invoke("companion:open-url", source.url).catch(console.error);
    });
    sourceList.append(link);
  }
  return sourceList;
}

function showBubble(item) {
  clearTimeout(hideBubbleTimer);
  const speechItem = normalizeSpeechItem(item);
  bubble.replaceChildren();
  const message = document.createElement("div");
  message.className = "bubble-message";
  message.textContent = speechItem.text;
  bubble.append(message);
  const sourceList = createSourceLinks(speechItem.sources);
  if (sourceList) bubble.append(sourceList);
  bubble.classList.remove("has-actions", "has-chat");
  bubble.classList.add("is-active");
}

function shortenForBubble(text, limit) {
  const normalized = String(text).replace(/\n{3,}/g, "\n\n");
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function showChatBubble(busy = false) {
  clearTimeout(hideBubbleTimer);
  bubble.replaceChildren();
  const message = document.createElement("div");
  message.className = "chat-message";
  const entry = chatEntries[chatEntryIndex];
  if (busy) {
    message.textContent = `あなた：${shortenForBubble(pendingQuestion, 80)}\n\nびくたん：考え中です…`;
  } else if (entry) {
    message.textContent =
      `あなた：${shortenForBubble(entry.question, 80)}\n\n` +
      `びくたん：${shortenForBubble(entry.answer, 240)}`;
  } else {
    message.textContent = "何をお手伝いしましょう？";
  }

  const sourceList = !busy && entry ? createSourceLinks(entry.sources) : undefined;
  if (!busy && chatEntries.length) {
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
    history.append(previous, count, next);
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
  input.placeholder = "びくたんに話しかける…";
  input.maxLength = 4000;
  input.disabled = busy;
  input.setAttribute("aria-label", "びくたんへのメッセージ");
  const send = document.createElement("button");
  send.type = "submit";
  send.textContent = busy ? "…" : "送信";
  send.disabled = busy;
  form.append(input, send);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    runChat(input.value);
  });
  input.addEventListener("focus", () => {
    chatActive = true;
    ipcRenderer.send("companion:hover", true);
    scheduleChatIdleReset();
  });
  input.addEventListener("input", scheduleChatIdleReset);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeChat();
  });
  bubble.append(form);
  bubble.classList.add("has-chat", "is-active");
}

function closeChat() {
  clearTimeout(chatIdleTimer);
  chatActive = false;
  ipcRenderer.send("companion:hover", isHovered);
  if (!isHovered) hideBubble();
}

function scheduleChatIdleReset() {
  clearTimeout(chatIdleTimer);
  if (!chatActive || isThinking) return;
  chatIdleTimer = setTimeout(() => {
    chatActive = false;
    isSpeaking = false;
    isThinking = false;
    isHovered = false;
    pendingQuestion = "";
    suppressHoverUntilLeave = true;
    resumeAmbientState();
    bubble.classList.remove("is-active");
    ipcRenderer.send("companion:hover", false);
  }, 30000);
}

async function runChat(rawMessage) {
  const message = rawMessage.trim();
  if (!message || isSpeaking) return;
  chatActive = true;
  clearTimeout(chatIdleTimer);
  clearTimeout(responseSpeechTimer);
  isSpeaking = false;
  isThinking = true;
  pendingQuestion = message;
  ipcRenderer.send("companion:hover", true);
  setEmote("thinking");
  showChatBubble(true);
  try {
    const response = normalizeSpeechItem(await ipcRenderer.invoke("companion:chat", message));
    let speechId = null;
    try {
      speechId = await ipcRenderer.invoke("companion:speak", response.text, "answer");
    } catch (speechError) {
      console.error("Speech failed:", speechError);
    }

    chatEntries.push({ question: message, answer: response.text, sources: response.sources });
    if (chatEntries.length > 10) chatEntries.shift();
    chatEntryIndex = chatEntries.length - 1;
    pendingQuestion = "";
    isThinking = false;
    showChatBubble();
    setEmote("joy");
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
    chatEntryIndex = chatEntries.length - 1;
    pendingQuestion = "";
    isThinking = false;
    isSpeaking = false;
    showChatBubble();
    setEmote("surprised");
    scheduleChatIdleReset();
  }
}

function hideBubble(delay = 0) {
  clearTimeout(hideBubbleTimer);
  hideBubbleTimer = setTimeout(() => {
    if (!isSpeaking && !isHovered && !dragging && !chatActive) {
      bubble.classList.remove("is-active");
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
  } else if (!isHovered && !dragging && !chatActive && !isThinking && !isSpeaking) {
    setEmote("default");
  }
}

function enterCharacter() {
  if (isHovered || dragging) return;
  isHovered = true;
  ipcRenderer.send("companion:hover", true);
  setEmote("joy");
  showChatBubble();
  model?.motion("Wave", 0);
}

function leaveCharacter() {
  if (!isHovered || dragging) return;
  isHovered = false;
  ipcRenderer.send("companion:hover", false);
  hideBubble(1500);
  resumeAmbientState();
}

function startChatter() {
  ipcRenderer.invoke("companion:prepare-idle-lines").catch(console.error);
  setInterval(async () => {
    if (
      isHovered ||
      dragging ||
      isSpeaking ||
      chatActive ||
      idleChatterBusy ||
      !model
    ) return;

    idleChatterBusy = true;
    try {
      const lineItem = normalizeSpeechItem(await ipcRenderer.invoke("companion:idle-line"));
      if (isHovered || dragging || chatActive) return;

      let speechId = null;
      try {
        speechId = await ipcRenderer.invoke("companion:speak", lineItem.text, "idle");
      } catch (speechError) {
        console.error("Idle speech failed:", speechError);
      }
      if (isHovered || dragging || chatActive) {
        if (speechId) ipcRenderer.send("companion:stop-speech");
        return;
      }

      isSpeaking = true;
      if (speechId) {
        currentSpeechId = speechId;
        currentSpeechKind = "idle";
      }
      showBubble(lineItem);
      setEmote("joy");

      clearTimeout(chatterEndTimer);
      const displayDuration = speechId
        ? 60000
        : Math.min(30000, Math.max(6500, lineItem.text.length * 180));
      chatterEndTimer = setTimeout(() => {
        currentSpeechKind = undefined;
        isSpeaking = false;
        resumeAmbientState();
        hideBubble();
      }, displayDuration);
    } catch (error) {
      console.error(error);
    } finally {
      idleChatterBusy = false;
    }
  }, 30000);
}

function startFloating() {
  setTimeout(() => {
    if (!isHovered && !dragging && !chatActive) ipcRenderer.send("companion:auto-move");
  }, 1000);
  setInterval(() => {
    if (!isHovered && !dragging && !chatActive) ipcRenderer.send("companion:auto-move");
  }, 15000);
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

    startChatter();
    startFloating();
    musicPlaying = Boolean(await ipcRenderer.invoke("companion:music-playing"));
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

ipcRenderer.on("companion:cursor", (_event, point) => {
  if (!model || pointerDown) return;
  const inside = characterHitBounds?.contains(point.x, point.y) ?? false;
  if (suppressHoverUntilLeave) {
    if (!inside) suppressHoverUntilLeave = false;
    model.focus(point.x, point.y);
    return;
  }
  if (inside) enterCharacter();
  else leaveCharacter();
  model.focus(point.x, point.y);
});

ipcRenderer.on("companion:speech-ended", (_event, speechId) => {
  if (speechId !== currentSpeechId) return;
  const speechKind = currentSpeechKind;
  currentSpeechId = undefined;
  currentSpeechKind = undefined;
  isSpeaking = false;
  if (speechKind === "idle") {
    clearTimeout(chatterEndTimer);
    resumeAmbientState();
    hideBubble(900);
  }
});

ipcRenderer.on("companion:music-playing", (_event, playing) => {
  musicPlaying = Boolean(playing);
  resumeAmbientState();
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
    showBubble("わわっ！どこに連れていくんですか〜？");
    ipcRenderer.send("companion:drag-start");
  }
  if (dragging) ipcRenderer.send("companion:drag-move");
});

canvas.addEventListener("pointerup", (event) => {
  if (!pointerDown) return;
  canvas.releasePointerCapture(event.pointerId);
  if (dragging) ipcRenderer.send("companion:drag-end");
  pointerDown = undefined;
  dragging = false;
  if (isHovered) {
    setEmote("joy");
    showChatBubble();
  } else {
    resumeAmbientState();
    hideBubble(1500);
  }
});

canvas.addEventListener("pointercancel", () => {
  if (dragging) ipcRenderer.send("companion:drag-end");
  pointerDown = undefined;
  dragging = false;
  if (isHovered) {
    setEmote("joy");
    showChatBubble();
  } else {
    resumeAmbientState();
    hideBubble(1500);
  }
});

start();
