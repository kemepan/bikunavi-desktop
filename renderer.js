// PIXI と PIXI.live2d は index.html の <script> で読み込むブラウザビルドを使う。
// Node 連携は preload.js が公開する window.bikunavi 経由のみ。
const { Live2DModel } = PIXI.live2d;
const {
  calculateRms,
  classifyTranscriptConfidence,
  createVoiceActivityDetector,
  isUsableTranscript
} = window.BikunaviVad;
const { pickConversationContext } = window.BikunaviConversationContext;
const {
  createAudioDropMeter,
  measureAudioGap,
  recordProcessingTime,
  formatDropSummary
} = window.BikunaviAudioMeter;

const canvas = document.querySelector("#stage");
const bubble = document.querySelector("#bubble");
const pomodoroQuick = document.querySelector("#pomodoro-quick");
// 待機中の中身（「集中する？」＋分数ボタン）。実行中の表示から戻す時に使う。
const pomodoroQuickIdleNodes = pomodoroQuick
  ? Array.from(pomodoroQuick.childNodes)
  : [];
const soundControls = document.querySelector("#sound-controls");
const soundToggle = document.querySelector("#sound-toggle");
const volumeControl = document.querySelector("#volume-control");
const volumeSlider = document.querySelector("#volume-slider");
const volumeValue = document.querySelector("#volume-value");
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
  // f09はモデルの顔変形と目パラメータが重なると崩れるため使わず、
  // 左目はOpen=1のままSmile=1にして、通常の目閉じではなく笑顔の目を使う。
  wink: {
    eyeOpen: 1,
    eyeSmile: 0,
    eyeLOpen: 1,
    eyeROpen: 1,
    eyeLSmile: 1,
    eyeRSmile: 0.15,
    mouthForm: 0.75,
    mouthOpen: 0
  },
  proud: { eyeOpen: 1, eyeSmile: 0, mouthForm: 0.4, mouthOpen: 0 },
  troubled: { eyeOpen: 0.65, eyeSmile: 0, mouthForm: -0.35, mouthOpen: 0 },
  sad: { eyeOpen: 0.45, eyeSmile: 0, mouthForm: -0.6, mouthOpen: 0 }
};
const EXPRESSION_NAMES = {
  joy: "f02",
  surprised: "f03",
  // thinkingはf08＋目とじパラメータの併用（docs/Live2D制作メモ.md）
  thinking: "f08",
  proud: "f06",
  troubled: "f04",
  sad: "f05"
};
// ミュート中はびくたん本人が×マスクを着ける（表情はf07）
const MASK_EXPRESSION = "f07";
let lastEmoteName = "default";
// AI回答が指定できる表情。"normal" はEMOTES/EXPRESSION_NAMES未定義のため
// setEmoteで自然にデフォルト顔（表情リセット）へ落ちる。
// emote-utils.js の CHAT_EMOTES と同一内容を保つこと（表情の増減時は両方更新）。
const ANSWER_EMOTES = new Set(["joy", "wink", "proud", "surprised", "troubled", "sad", "normal"]);
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
let pendingCharacterCustomization;
let chatEntryIndex = -1;
const chatEntries = [];
const lineHistory = [];
// 記事URL → "good" / "bad"。ボタンの見た目を復元するために持つ。
const sourceRatings = new Map();
let lineHistoryIndex = -1;
let lineHistoryActive = false;
let currentEmote = { ...EMOTES.default };
let motionSequence = 0;
let blinkTimer = 0;
// 触られている間の口の開閉。位相を積み上げて持つ（周期を揺らしても飛ばないように）
let hoverMouthPhase = 0;
// 掴んで動かした時の慣性。実際の移動速度から作り、離しても揺り戻しが残る。
const dragSway = { x: 0, y: 0 };
let lastDragPoint;
let lastDragMoveAt = 0;
// 振り幅の調整用。掴んでいる間の最大速度をログに出す。
let dragPeak = 0;
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
const interactionMotionWeights = {
  idle: 1,
  listening: 0,
  thinking: 0,
  speaking: 0
};
let systemSleeping = false;
let topDocked = false;
let pomodoroState = { active: false, running: false, remaining: 0, label: "", timeText: "" };
let pomodoroHideTimer;
let pomodoroQuickVisible;
let soundMuted = false;
let soundToggleVisible;
let speechVolume = 100;
// いま素の吹き出しに出しているソース。ニュース吹き出しにホバーして会話欄へ
// 切り替わっても、このソースボタンを引き継いで消さないために覚えておく。
let displayedLineSources = [];
// ポモドーロ開始時に渡されたセリフ。BGMの推薦と検索リンクを持っている。
// タイマー表示は毎秒作り直されるため、ここへ取っておかないとリンクが消える。
let pomodoroStartLineItem;
// 表示中の自動セリフ・ニュース等。ホバーで会話欄を開いても読み続けられるよう保持する
let displayedLineItem;
// 吹き出しが閉じた後も、次のホバーでは過去の会話より直前の独り言・ニュースを優先する。
let latestAmbientLineItem;
let idleIntervalMs = 30000;
let chatterTimer;
let chatterFollowUpTimer;
// 直前に話した独り言に続きがあるか（main側のキューが持っている）
let threadFollowUpPending = false;
let historySaveTimer;
let voiceInputActive = false;
let voiceInputButton;
let voiceInputTargetInput;
let voiceRecorder;
let voiceRecordingTimer;
let handsFreeEnabled = false;
let handsFreeRecorder;
let handsFreeStartPromise;
let handsFreeUtterance;
let handsFreeTranscribing = false;
let handsFreeGeneration = 0;
let handsFreeIgnoreUntil = 0;
let chatDraft = "";
let preferredUserName = "あなた";
const VOICE_INPUT_MAX_MS = 15000;
// 発話を検知するより前の音を、この長さぶん取っておく。頭を欠けさせないため。
//
// **VADの startMs（既定360ms）より十分長くないと意味がない。** 検知は
// 「しきい値を超えた状態が startMs 続く」ことで成立するので、started が
// 出た時点で既に360ms喋り終わっている。同じ360msしか持っていないと、
// しきい値を超えるまでの立ち上がり（子音や小さい入りの音）が押し出される。
// さらに VAD は声が揺れると aboveMs を1.6倍の速さで減らすので、検知まで
// もっと伸びることがある。その分も飲み込める長さにする。
//
// 900ms なら 48kHz float32 でも約173KB。常に持ち歩いても負担にならない。
const HANDS_FREE_PRE_ROLL_MS = 900;
const HANDS_FREE_SPEAKING_THRESHOLD = 0.09;
// 「本当に人が喋った」とみなす音の大きさ（録音中の最大RMS）。
//
// 開始しきい値（0.045〜0.090）は、遠くの声や小さい入りを取りこぼさないよう
// 低めに置いてある。その代わり物音でも始まってしまい、継続しきい値も低い
// （0.018）ので、そのまま数秒ぶん何も無い音を録り続ける。
//
// 2026-08-05の実測（macOS実機）:
//   実際に喋った時   … peak RMS 0.368 / 0.527 → 文字起こし成功（confidence 0.97）
//   雑音で始まった時 … peak RMS 0.097〜0.286 → すべて0文字
// この間で切る。
const HANDS_FREE_VOICE_PEAK_RMS = 0.32;
const HANDS_FREE_BUFFER_SIZE = 4096;
// 続きものの次の行までの間。吹き出しを出したまま差し替えるので、
// 消して出し直していた頃より短くてよい。
const THREAD_FOLLOW_UP_MS = 3500;
// マイクを押したままハンズフリーを切り替えるまでの時間。
const MIC_LONG_PRESS_MS = 600;
// 聞き取りの確信度のしきい値は vad-utils.js の classifyTranscriptConfidence が持つ。
// 較正は out.log の「Hands-free transcript ignore / confirm / trusted」を見て行う。
// 待機中にキャラクターを薄くする濃さ。0だと居なくなったように見えるので、
// 気配は残る程度にする。
const DIM_IDLE_OPACITY = 0.4;
// 惜しい音のログを間引く間隔。
const HANDS_FREE_NEAR_MISS_LOG_MS = 5000;
// 取りこぼしは起きた瞬間に状態つきで残したいが、詰まっている間は連続するので
// この間隔でまとめる。累計は別に定期要約として出す。
const AUDIO_DROP_LOG_THROTTLE_MS = 3000;
const AUDIO_DROP_SUMMARY_MS = 5 * 60 * 1000;
let statusFallback = "";

function setStatusFallback(message) {
  const previous = statusFallback;
  statusFallback = String(message || "");
  if (!status.textContent || status.textContent === previous) {
    status.textContent = statusFallback;
  }
}

function showStatusMessage(message, duration = 2600) {
  status.textContent = message;
  if (duration > 0) {
    setTimeout(() => {
      if (status.textContent === message) status.textContent = statusFallback;
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
    if (status.textContent === "文字起こし中…") status.textContent = statusFallback;
    scheduleChatIdleReset();
  }
}

async function startVoiceInput(input, button) {
  if (handsFreeEnabled) {
    showStatusMessage("ハンズフリー会話が待機中です（マイク長押しでOFF）");
    return;
  }
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

// 取りこぼしが「いつ」起きたかを残す。AudioWorkletへ移すべきかは、落ちた総数より
// 会話中（描画やDOM更新が重い瞬間）に落ちているかどうかで決まる。
function handsFreeStateLabel() {
  const flags = [];
  if (isThinking) flags.push("thinking");
  if (isSpeaking) flags.push("speaking");
  if (handsFreeUtterance) flags.push("capturing");
  if (handsFreeTranscribing) flags.push("transcribing");
  if (dragging) flags.push("dragging");
  return flags.join("+") || "idle";
}

function reportAudioDrops(recorder, droppedBuffers, gapMs, label) {
  recorder.pendingDrops += droppedBuffers;
  const now = Date.now();
  if (now - recorder.lastDropLogAt < AUDIO_DROP_LOG_THROTTLE_MS) return;
  recorder.lastDropLogAt = now;
  // 他のハンズフリー計測ログと突き合わせられるよう、warnではなくlogで出す。
  // main側でwarnはstderr（err.log）へ振り分けられ、発話ログと分かれてしまうため。
  console.log(
    `Hands-free audio dropped: ${recorder.pendingDrops} buffers ` +
    `(gap ${Math.round(gapMs)}ms) during ${label}`
  );
  recorder.pendingDrops = 0;
}

function logAudioMeterSummary(recorder, reason) {
  if (!recorder?.meter?.callbacks) return;
  console.log(`Hands-free audio meter (${reason}): ${formatDropSummary(recorder.meter)}`);
}

function releaseHandsFreeRecorder(recorder) {
  if (!recorder) return;
  try {
    recorder.processor.disconnect();
    recorder.source.disconnect();
  } catch (_error) {
    // ignore disconnect races
  }
  recorder.processor.onaudioprocess = null;
  for (const track of recorder.stream.getTracks()) track.stop();
  recorder.audioContext.close().catch(() => {});
}

function stopHandsFreeListening() {
  handsFreeGeneration += 1;
  const recorder = handsFreeRecorder;
  const utterance = handsFreeUtterance;
  handsFreeRecorder = undefined;
  handsFreeUtterance = undefined;
  handsFreeTranscribing = false;
  handsFreeIgnoreUntil = 0;
  logAudioMeterSummary(recorder, "停止");
  releaseHandsFreeRecorder(recorder);
  setStatusFallback("");
  restoreHandsFreeCaptureState(utterance);
}

function clearHandsFreePreRoll(recorder) {
  recorder.preRoll = [];
  recorder.preRollSamples = 0;
}

function appendHandsFreePreRoll(recorder, chunk) {
  recorder.preRoll.push(chunk);
  recorder.preRollSamples += chunk.length;
  const maxSamples = Math.ceil(recorder.sampleRate * HANDS_FREE_PRE_ROLL_MS / 1000);
  while (recorder.preRoll.length > 1 && recorder.preRollSamples > maxSamples) {
    recorder.preRollSamples -= recorder.preRoll.shift().length;
  }
}

function interruptSpeechForHandsFree() {
  if (!isSpeaking && !currentSpeechId) return;
  bikunavi.send("companion:stop-speech");
  clearTimeout(speechWatchdogTimer);
  clearTimeout(chatterEndTimer);
  clearTimeout(responseSpeechTimer);
  currentSpeechId = undefined;
  currentSpeechKind = undefined;
  isSpeaking = false;
}

// 話しかけられたら、読み上げ中なら止め、生成中なら畳む。
// 中断した回答はmain側で履歴にも残らないので、聞き直しにも出てこない。
function interruptChatForHandsFree() {
  if (isThinking) {
    bikunavi.send("companion:cancel-chat");
    console.log("Hands-free interrupted a chat in progress");
  }
  interruptSpeechForHandsFree();
}

function restoreHandsFreeCaptureState(utterance) {
  const userIsEditing = document.activeElement instanceof HTMLInputElement &&
    Boolean(document.activeElement.closest("#bubble"));
  if (
    utterance?.wasChatActive ||
    userIsEditing ||
    handsFreeUtterance ||
    isThinking ||
    isSpeaking
  ) return;
  chatActive = false;
  bikunavi.send("companion:hover", isHovered);
  resumeAmbientState();
  if (!isHovered) hideBubble(1200);
}

async function finishHandsFreeUtterance(utterance) {
  if (!utterance?.chunks?.length || utterance.generation !== handsFreeGeneration) {
    console.log(
      "Hands-free utterance dropped: " +
      `${utterance?.chunks?.length ? "" : "音が空 / "}` +
      `世代 ${utterance?.generation}/${handsFreeGeneration}`
    );
    restoreHandsFreeCaptureState(utterance);
    return;
  }
  // 一度も声の大きさに届かなかった録音は、人の声ではなく物音とみなす。
  // 実測では、この手のものは文字起こしへ送っても例外なく0文字で返ってきた。
  // ヘルパーを起動するだけ無駄なので、ここで捨てる。
  if (!utterance.reachedVoice) {
    console.log(
      `Hands-free utterance dropped: 声の大きさに届かず ` +
      `peak RMS ${utterance.peakRms.toFixed(3)} < ${HANDS_FREE_VOICE_PEAK_RMS}`
    );
    restoreHandsFreeCaptureState(utterance);
    return;
  }
  const samples = mergeAudioChunks(utterance.chunks);
  const durationMs = samples.length / utterance.sampleRate * 1000;
  if (durationMs < 420) {
    showStatusMessage("もう少し長く話してみてください");
    restoreHandsFreeCaptureState(utterance);
    return;
  }

  console.log(
    `Hands-free utterance: ${Math.round(durationMs)}ms, ` +
    `peak RMS ${Number(utterance.peakRms || 0).toFixed(3)}, ` +
    `dropped ${Number(utterance.droppedBuffers || 0)} buffers`
  );

  handsFreeTranscribing = true;
  showStatusMessage("文字起こし中…", 0);
  let chatStarted = false;
  try {
    const wav = encodeWav(samples, utterance.sampleRate);
    const result = await bikunavi.invoke("companion:transcribe-audio", {
      audio: wav,
      format: "wav",
      sampleRate: utterance.sampleRate
    });
    if (
      utterance.generation !== handsFreeGeneration ||
      !handsFreeEnabled ||
      systemSleeping
      ) {
        // 黙って捨てると、話しかけても無反応な理由が誰にも分からない。
        console.log(
          "Hands-free transcript dropped: " +
          `世代 ${utterance.generation}/${handsFreeGeneration}` +
          `${handsFreeEnabled ? "" : " / ハンズフリーOFF"}` +
          `${systemSleeping ? " / スリープ中" : ""}`
        );
        return;
      }
    const text = String(result?.text || "").trim();
    if (!isUsableTranscript(text, { handsFree: true })) {
      // 何が弾かれたのかが分からないと、無反応の理由を追えない。
      console.log(
        `Hands-free transcript rejected: ${JSON.stringify(text.slice(0, 40))} `
        + `(${text.length}文字)`
      );
      showStatusMessage(result?.message || "うまく聞き取れませんでした");
      return;
    }

    // 確信度で3段階に分ける。手入力や単発録音は本人が目で確かめてから
    // 送るので、この判定は常時待機の時だけ。
    const confidence = Number(result?.confidence) || 0;
    const grade = classifyTranscriptConfidence(confidence);
    console.log(
      `Hands-free transcript ${grade}: ${text.length}文字, ` +
      `confidence ${confidence ? confidence.toFixed(3) : "なし"}`
    );
    if (grade === "ignore") {
      // 環境音の誤認識とみなして会話へ送らない。話していないのに聞き返されると
      // それ自体が noise になるため、短い表示だけ出して黙る。
      showStatusMessage("うまく聞き取れませんでした");
      return;
    }

    showStatusMessage(`「${shortenForBubble(text, 42)}」`, 1200);
    handsFreeTranscribing = false;
    await runChat(text, { uncertain: grade === "confirm" });
    chatStarted = true;
  } catch (error) {
    console.error("Hands-free transcription failed:", error);
    showStatusMessage(error?.message || "文字起こしに失敗しました");
  } finally {
    if (utterance.generation === handsFreeGeneration) handsFreeTranscribing = false;
    if (status.textContent === "文字起こし中…") status.textContent = statusFallback;
    if (!chatStarted) restoreHandsFreeCaptureState(utterance);
  }
}

function processHandsFreeAudio(recorder, chunk) {
  if (recorder !== handsFreeRecorder || !handsFreeEnabled || systemSleeping) return;
  if (
    voiceInputActive ||
    handsFreeTranscribing ||
    Date.now() < handsFreeIgnoreUntil
  ) {
    recorder.detector.reset();
    clearHandsFreePreRoll(recorder);
    return;
  }

  if (!handsFreeUtterance) appendHandsFreePreRoll(recorder, chunk);
  const elapsedMs = chunk.length / recorder.sampleRate * 1000;
  // 読み上げ中・生成中はびくたん自身の声や環境音を拾いやすいので、高い閾値で待つ。
  // ここを越えた時だけ、読み上げの停止や生成の中断まで踏み込む。
  const guardedAgainstSelf = isSpeaking || isThinking;
  const decision = recorder.detector.process(calculateRms(chunk), elapsedMs, guardedAgainstSelf
    ? { minStartRms: HANDS_FREE_SPEAKING_THRESHOLD, startMs: 420 }
    : undefined);

  if (decision.started) {
    const generation = handsFreeGeneration;
    handsFreeUtterance = {
      chunks: recorder.preRoll.slice(),
      sampleRate: recorder.sampleRate,
      generation,
      wasChatActive: chatActive,
      peakRms: decision.level,
      droppedBuffers: 0
    };
    console.log(
      `Hands-free detected: RMS ${decision.level.toFixed(3)}, ` +
      `threshold ${decision.startThreshold.toFixed(3)}, noise ${decision.noiseFloor.toFixed(3)}`
    );
    clearHandsFreePreRoll(recorder);
    // ここではまだ読み上げを止めない。物音でも開始してしまうため、
    // 遮ってから0文字で終わると「急に黙った」だけになる。
    // 声らしい大きさに届いた時点（下の interruptedAt）で初めて踏み込む。
    if (handsFreeUtterance.peakRms >= HANDS_FREE_VOICE_PEAK_RMS) {
      handsFreeUtterance.reachedVoice = true;
      interruptChatForHandsFree();
    }
    chatActive = true;
    lineHistoryActive = false;
    setEmote("joy");
    showStatusMessage("聞いています…", 0);
  } else if (handsFreeUtterance) {
    handsFreeUtterance.chunks.push(chunk);
    handsFreeUtterance.peakRms = Math.max(handsFreeUtterance.peakRms, decision.level);
    // 録音の途中で声の大きさに届いたら、そこで読み上げ・生成へ割り込む。
    if (!handsFreeUtterance.reachedVoice && handsFreeUtterance.peakRms >= HANDS_FREE_VOICE_PEAK_RMS) {
      handsFreeUtterance.reachedVoice = true;
      interruptChatForHandsFree();
    }
  } else if (decision.nearMiss && !guardedAgainstSelf) {
    // 「話したのに拾ってくれない」を後から確かめられるようにする。
    // 連続するので間引いて、しきい値と環境ノイズを添えて残す。
    recorder.nearMissCount += 1;
    if (Date.now() - recorder.lastNearMissLogAt >= HANDS_FREE_NEAR_MISS_LOG_MS) {
      recorder.lastNearMissLogAt = Date.now();
      console.log(
        `Hands-free near miss: ${recorder.nearMissCount}回, ` +
        `RMS ${decision.level.toFixed(3)} < threshold ${decision.startThreshold.toFixed(3)}, ` +
        `noise ${decision.noiseFloor.toFixed(3)}`
      );
      recorder.nearMissCount = 0;
    }
  }

  if (decision.ended && handsFreeUtterance) {
    const utterance = handsFreeUtterance;
    handsFreeUtterance = undefined;
    recorder.detector.reset();
    clearHandsFreePreRoll(recorder);
    finishHandsFreeUtterance(utterance).catch(console.error);
  }
}

async function startHandsFreeListening() {
  if (
    !handsFreeEnabled ||
    systemSleeping ||
    handsFreeRecorder ||
    handsFreeStartPromise
  ) return handsFreeStartPromise;
  if (!navigator.mediaDevices?.getUserMedia) {
    showStatusMessage("この環境ではハンズフリー会話を使えません");
    await bikunavi.invoke("companion:set-hands-free-enabled", false).catch(() => {});
    return undefined;
  }

  const generation = ++handsFreeGeneration;
  let acquiredStream;
  let pendingAudioContext;
  handsFreeStartPromise = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    acquiredStream = stream;
    if (!handsFreeEnabled || systemSleeping || generation !== handsFreeGeneration) {
      for (const track of stream.getTracks()) track.stop();
      acquiredStream = undefined;
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextClass();
    pendingAudioContext = audioContext;
    await audioContext.resume();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(HANDS_FREE_BUFFER_SIZE, 1, 1);
    const recorder = {
      stream,
      audioContext,
      source,
      processor,
      sampleRate: audioContext.sampleRate,
      detector: createVoiceActivityDetector(),
      preRoll: [],
      preRollSamples: 0,
      nearMissCount: 0,
      lastNearMissLogAt: 0,
      meter: createAudioDropMeter({
        sampleRate: audioContext.sampleRate,
        bufferSize: HANDS_FREE_BUFFER_SIZE
      }),
      pendingDrops: 0,
      lastDropLogAt: 0,
      lastSummaryAt: Date.now()
    };
    processor.onaudioprocess = (event) => {
      // 取りこぼし計測を先に済ませる。processHandsFreeAudioが早期returnする
      // 状態（考え中など）でも、バッファが落ちた事実は記録しておきたい。
      //
      // 時刻は playbackTime を優先する。これはバッファ境界の音声クロックなので、
      // 落ちた分がちょうどバッファ長の整数倍として現れる。currentTime は
      // 「メインスレッドへ配送された時点」の値でジッタが乗り、詰まりと
      // 取りこぼしを区別しにくい。
      const label = handsFreeStateLabel();
      const usePlaybackTime = Number.isFinite(event.playbackTime) && event.playbackTime > 0;
      const audioTime = usePlaybackTime ? event.playbackTime : audioContext.currentTime;
      if (!recorder.clockLogged) {
        recorder.clockLogged = true;
        console.log(
          `Hands-free audio meter started: ${Math.round(recorder.sampleRate)}Hz, ` +
          `buffer ${HANDS_FREE_BUFFER_SIZE} (${recorder.meter.expectedGapMs.toFixed(1)}ms/回), ` +
          `clock ${usePlaybackTime ? "playbackTime" : "currentTime"}`
        );
      }
      const { droppedBuffers, gapMs } = measureAudioGap(recorder.meter, audioTime, label);
      if (droppedBuffers) {
        if (handsFreeUtterance) handsFreeUtterance.droppedBuffers += droppedBuffers;
        reportAudioDrops(recorder, droppedBuffers, gapMs, label);
      }
      const startedAt = performance.now();
      processHandsFreeAudio(recorder, new Float32Array(event.inputBuffer.getChannelData(0)));
      recordProcessingTime(recorder.meter, performance.now() - startedAt, label);
      if (Date.now() - recorder.lastSummaryAt >= AUDIO_DROP_SUMMARY_MS) {
        recorder.lastSummaryAt = Date.now();
        logAudioMeterSummary(recorder, "定期");
      }
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
    handsFreeRecorder = recorder;
    acquiredStream = undefined;
    pendingAudioContext = undefined;
    setStatusFallback("🎙 ハンズフリー待機中");
    showStatusMessage("ハンズフリー会話を開始しました", 2200);
  })().catch(async (error) => {
    for (const track of acquiredStream?.getTracks?.() || []) track.stop();
    pendingAudioContext?.close().catch(() => {});
    if (generation !== handsFreeGeneration) return;
    console.error("Hands-free start failed:", error);
    handsFreeEnabled = false;
    setStatusFallback("");
    showStatusMessage(error?.name === "NotAllowedError"
      ? "マイク入力が許可されませんでした"
      : "ハンズフリー会話を開始できませんでした");
    await bikunavi.invoke("companion:set-hands-free-enabled", false).catch(() => {});
  }).finally(() => {
    handsFreeStartPromise = undefined;
  });
  return handsFreeStartPromise;
}

// マイクの長押しからハンズフリーを切り替える。トレイメニューまで
// 行かなくてよいようにするための入口で、状態の反映はmain経由で揃える。
function toggleHandsFreeFromMic() {
  const next = !handsFreeEnabled;
  if (next) stopVoiceInput();
  bikunavi.invoke("companion:set-hands-free-enabled", next)
    .then(() => {
      showStatusMessage(next
        ? "ハンズフリー会話をONにしました（長押しでOFF）"
        : "ハンズフリー会話をOFFにしました");
    })
    .catch((error) => {
      console.error("Hands-free toggle failed:", error);
      showStatusMessage("ハンズフリー会話を切り替えられませんでした");
    });
}

function applyHandsFreeSetting(enabled) {
  const next = Boolean(enabled);
  const changed = handsFreeEnabled !== next;
  handsFreeEnabled = next;
  if (next) startHandsFreeListening().catch(console.error);
  else stopHandsFreeListening();
  if (changed && bubble.classList.contains("has-chat") && !isThinking) showChatBubble();
}

function saveHistorySoon() {
  clearTimeout(historySaveTimer);
  historySaveTimer = setTimeout(() => {
    bikunavi.send("companion:save-history", { lineHistory, chatEntries });
  }, 1200);
}

// 画面の拡大率が変わったら、描画の解像度を合わせ直す。
//
// resolution は起動時の devicePixelRatio で固定されるので、拡大率の違う
// モニタへ移した時（Windowsで125%と150%が混在、macOSでRetinaと外部ディスプレイ）
// に、ぼやけたり無駄に高精細になったりする。
// resize では発火しないことがあるため、devicePixelRatio 自体を見張る。
function watchPixelRatio() {
  let media;
  const apply = () => {
    const ratio = window.devicePixelRatio || 1;
    if (Math.abs(pixiApp.renderer.resolution - ratio) > 0.01) {
      pixiApp.renderer.resolution = ratio;
      fitModel();
    }
    // matchMedia は「今の値」でしか張れないので、変わるたびに張り直す。
    media?.removeEventListener("change", apply);
    media = window.matchMedia(`(resolution: ${ratio}dppx)`);
    media.addEventListener("change", apply);
  };
  apply();
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
  const soundButtonLeft = Math.min(width - 38, characterHitBounds.x + characterHitBounds.width - 12);
  const soundLeft = Math.max(4, Math.min(width - 140, soundButtonLeft - 98));
  const soundTop = Math.max(8, characterHitBounds.y + Math.min(64, characterHitBounds.height * 0.16));
  soundControls.style.left = `${soundLeft}px`;
  soundControls.style.top = `${soundTop}px`;
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

// 吹き出しそのものの上か（キャラとの間を埋める余白は含めない）。
// クリック透過の判定に使う。ホバー検知と同じ広さにすると、吹き出しが
// 出ている間だけ後ろのウィンドウを触れなくなる。
function isPointInBubbleRect(point) {
  if (!bubble.classList.contains("is-active")) return false;
  const rect = bubble.getBoundingClientRect();
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
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

function isPointInSoundControls(point) {
  if (!soundControls?.classList.contains("is-visible")) return false;
  const rect = soundControls.getBoundingClientRect();
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

// ポモドーロの枠は吹き出しから独立させる。セリフと混ぜると、
// タイマーがセリフの一部に見えたり、入力欄が押しのけられたりする。
function renderPomodoroQuick() {
  if (!pomodoroQuick) return;
  if (!pomodoroState.active) {
    // 待機中は「集中する？」＋分数ボタン（HTMLの初期状態）へ戻す。
    if (pomodoroQuick.dataset.mode !== "idle") {
      pomodoroQuick.dataset.mode = "idle";
      pomodoroQuick.replaceChildren(...pomodoroQuickIdleNodes);
    }
    return;
  }
  // 実行中は残り時間と操作ボタン。作り直すと押しづらいので、
  // 時間の表示だけ書き換える。
  if (pomodoroQuick.dataset.mode === "running") {
    const time = pomodoroQuick.querySelector(".pomodoro-quick-time");
    if (time) time.textContent = pomodoroTimerText(pomodoroState);
    const toggle = pomodoroQuick.querySelector('[data-action="toggle"]');
    if (toggle) toggle.textContent = pomodoroState.running ? "一時停止" : "再開";
    return;
  }
  pomodoroQuick.dataset.mode = "running";
  const time = document.createElement("span");
  time.className = "pomodoro-quick-time";
  time.textContent = pomodoroTimerText(pomodoroState);
  const controls = createPomodoroControls(pomodoroState);
  pomodoroQuick.replaceChildren(time);
  if (controls) pomodoroQuick.append(controls);
}

function updatePomodoroQuickVisibility() {
  renderPomodoroQuick();
  const visible = Boolean(
    isHovered &&
    !dragging &&
    !lineHistoryActive &&
    !voiceInputActive &&
    // 実行中は、考え中や読み上げ中でも残り時間を見せる。
    (pomodoroState.active || (!chatActive && !isThinking && !isSpeaking))
  );
  if (visible === pomodoroQuickVisible) return;
  pomodoroQuickVisible = visible;
  pomodoroQuick?.classList.toggle("is-visible", visible);
  pomodoroQuick?.setAttribute("aria-hidden", visible ? "false" : "true");
}

let soundToggleMutedRendered;

function updateSoundToggle() {
  const visible = Boolean(isHovered && !dragging);
  if (visible !== soundToggleVisible) {
    soundToggleVisible = visible;
    soundControls?.classList.toggle("is-visible", visible);
    soundControls?.setAttribute("aria-hidden", visible ? "false" : "true");
  }
  // 毎フレーム呼ばれるため、ミュート表示は値が変わった時だけDOMを触る
  if (soundMuted === soundToggleMutedRendered) return;
  soundToggleMutedRendered = soundMuted;
  // ミュート切替に合わせて、びくたん本人のマスク表情も着脱する。
  // 状態はキャラクター側で見せるので、ボタンは音量マークに徹する
  // （以前はびくたんアイコンを載せていたが、マスクと二重になっていた）。
  if (soundMuted) model?.expression(MASK_EXPRESSION);
  else setEmote(lastEmoteName);
  soundToggle?.classList.toggle("is-muted", soundMuted);
  soundToggle.textContent = soundMuted ? "🔇" : "🔊";
  soundToggle?.setAttribute("aria-pressed", soundMuted ? "true" : "false");
  soundToggle?.setAttribute(
    "aria-label",
    soundMuted ? "びくたんの音を再開" : "びくたんの音をミュート"
  );
  soundToggle.title = soundMuted ? "音を再開" : "音をミュート";
}

function updateVolumeControl() {
  if (!volumeSlider || !volumeValue) return;
  if (document.activeElement !== volumeSlider) volumeSlider.value = String(speechVolume);
  volumeValue.textContent = `${speechVolume}%`;
  volumeControl?.classList.toggle("is-muted", soundMuted);
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
    updateVolumeControl();
  } catch (error) {
    console.error("Sound mute toggle failed:", error);
  }
});

volumeSlider?.addEventListener("input", () => {
  speechVolume = Number(volumeSlider.value) || speechVolume;
  volumeValue.textContent = `${speechVolume}%`;
});

volumeSlider?.addEventListener("change", async (event) => {
  event.stopPropagation();
  try {
    const settings = await bikunavi.invoke("companion:set-speech-volume", volumeSlider.value);
    speechVolume = Number(settings?.speechVolume) || speechVolume;
    soundMuted = Boolean(settings?.soundMuted);
    updateSoundToggle();
    updateVolumeControl();
  } catch (error) {
    console.error("Speech volume update failed:", error);
    updateVolumeControl();
  }
});

function normalizeSpeechItem(item) {
  if (typeof item === "string") return { text: item, sources: [], choices: [], continues: false };
  return {
    text: String(item?.text ?? ""),
    sources: Array.isArray(item?.sources) ? item.sources : [],
    kind: String(item?.kind || ""),
    questionId: String(item?.questionId || ""),
    answerKind: String(item?.answerKind || ""),
    choices: Array.isArray(item?.choices)
      ? item.choices.map((choice) => String(choice).trim()).filter(Boolean).slice(0, 6)
      : [],
    emote: ANSWER_EMOTES.has(item?.emote) ? item.emote : "",
    // 続きものの印。落とすと、あとから話題の先頭を辿れなくなる。
    continues: Boolean(item?.continues)
  };
}

function createChoiceButtons(item) {
  if (!item?.choices?.length) return undefined;
  // 出た／出ないを後から追えるようにする。押せたかまでは分からないので、
  // 実際に描いた時だけ残す。
  console.log(`Choice buttons shown: [${item.choices.join("] [")}]`);
  const container = document.createElement("div");
  container.className = "choice-buttons";
  for (const choice of item.choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = choice;
    button.addEventListener("click", () => {
      answerWithChoice(choice, item);
    });
    container.append(button);
  }
  return container;
}

async function answerWithChoice(choice, item) {
  // 読み上げ途中でも選択肢で即答できるよう、進行中の状態を畳んでから回答する
  clearTimeout(chatterEndTimer);
  clearTimeout(hideBubbleTimer);
  if (currentSpeechId) bikunavi.send("companion:stop-speech");
  currentSpeechId = undefined;
  currentSpeechKind = undefined;
  isSpeaking = false;
  chatActive = true;
  bikunavi.send("companion:hover", true);
  // 独り言の選択肢を押した時、未回答のキャラ質問が残っていると、この返事が
  // そちらへの回答として送られてしまう。先に「あとで」扱いにして切り離す。
  if (item?.kind !== "custom-question" && pendingCharacterCustomization) {
    await deferUnansweredQuestion(pendingCharacterCustomization).catch(console.error);
  }
  // このボタンが付いていたセリフを、そのまま返信先として渡す。
  runChat(choice, { replyTo: item });
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
    // 話題は先頭の行が持つので、途中の行だけを返信先にすると文脈が消える。
    continues: Boolean(speechItem.continues),
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
    // グッドは「気になる記事」へ残り、この分野を次から多めに集める。
    // バッドは似た話題を持ち込まないための記録。もう一度押すと取り消す。
    const good = document.createElement("button");
    const bad = document.createElement("button");
    const updateRatingState = () => {
      const rating = sourceRatings.get(source.url) || "";
      const decided = Boolean(rating);
      // 一度押したら確定にする。押すたびに切り替わると、今どちらを選んだのか
      // 分からなくなるため。選ばなかった側は消し、押した側だけ残す。
      // 取り消したい時はトレイの「気になる記事」から外す。
      // 種類はクラスで明示する。:first-of-type だと「ソース」ボタンを指してしまう。
      good.className = `source-rate is-good${rating === "good" ? " is-active" : ""}`;
      bad.className = `source-rate is-bad${rating === "bad" ? " is-active" : ""}`;
      good.textContent = "👍";
      bad.textContent = "👎";
      good.hidden = decided && rating !== "good";
      bad.hidden = decided && rating !== "bad";
      good.disabled = decided;
      bad.disabled = decided;
      good.title = rating === "good"
        ? "気になる記事に保存しました"
        : "気になる。この分野を多めに集める";
      bad.title = rating === "bad"
        ? "興味なしにしました"
        : "興味なし。似た話題を減らす";
      good.setAttribute("aria-label", good.title);
      bad.setAttribute("aria-label", bad.title);
      good.setAttribute("aria-pressed", rating === "good" ? "true" : "false");
      bad.setAttribute("aria-pressed", rating === "bad" ? "true" : "false");
    };
    const rate = async (rating) => {
      try {
        const result = await bikunavi.invoke("companion:rate-source", source, rating);
        if (result?.rating) sourceRatings.set(source.url, result.rating);
        else sourceRatings.delete(source.url);
        updateRatingState();
      } catch (error) {
        console.error("Source rating failed:", error);
      }
    };
    for (const [button, rating] of [[good, "good"], [bad, "bad"]]) {
      button.type = "button";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        rate(rating).catch(console.error);
      });
    }
    updateRatingState();
    item.append(link, good, bad);
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
    armSpeechWatchdog(replayText);
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
  button.className = "icon-replay";
  button.title = "もう一度聞く";
  button.setAttribute("aria-label", "この内容を先頭から読み上げ");
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
  // 表示した時刻を残す。何時間も前のセリフを「いま返信された先」として
  // 会話AIへ渡さないための判断材料になる。
  displayedLineItem = { ...speechItem, time: Date.now() };
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
  replay.className = "icon-replay";
  replay.title = "もう一度聞く";
  replay.setAttribute("aria-label", "びくたんの発言を読み上げ");
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
  // 選択肢を出したセリフは、押す時間を残す。短い問いかけは既定の0.9秒だと
  // 読み終わる前にボタンごと消えてしまう。
  if (speechItem.choices.length) return 20000;
  if (speechItem.text.length >= 70) return 18000;
  return 900;
}

function pomodoroTimerText(state) {
  // トレイの「🍅 ポモドーロ」と同じ絵文字を、作業名と残り時間の間へ置く。
  // 区切りになって、どちらも読みやすくなる。
  return `${state.label || "ポモドーロ"}` +
    `${state.running ? "" : "（一時停止中）"}` +
    ` 🍅 ${state.timeText || "0:00"}`;
}

// 集中している間の吹き出し。セリフと入力欄を主役にし、
// 残り時間と操作ボタンは下の一行へまとめる。
function showPomodoroWithChat() {
  // 吹き出しはセリフと入力欄だけ。残り時間と操作ボタンは
  // #pomodoro-quick が持つ（renderPomodoroQuick）。
  // 開始時のセリフ（BGMの推薦とリンク）が残っていればそれを見せる。
  const carried = pomodoroStartLineItem || displayedLineItem;
  const sources = pomodoroStartLineItem?.sources?.length
    ? pomodoroStartLineItem.sources
    : displayedLineSources;
  showChatBubble(false, sources, carried);
  updatePomodoroQuickVisibility();
}

function createPomodoroControls(state) {
  if (!state.active) return undefined;
  const controls = document.createElement("div");
  controls.className = "timer-actions";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.dataset.action = "toggle";
  toggle.textContent = state.running ? "一時停止" : "再開";
  toggle.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      pomodoroState = await bikunavi.invoke(
        "companion:pomodoro-action",
        state.running ? "pause" : "resume"
      );
      // 会話欄と並べて出している時はその表示を保つ。
      // タイマー単独へ戻すと、話しかける手段が消える。
      if (isHovered) showPomodoroWithChat();
      else showPomodoroBubble(pomodoroState, true);
    } catch (error) {
      console.error("Pomodoro toggle failed:", error);
    }
  });

  const finish = document.createElement("button");
  finish.type = "button";
  finish.dataset.action = "finish";
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
  // 実行中の残り時間は下の枠（#pomodoro-quick）が受け持つ。
  // 吹き出しへ出すと、セリフや会話欄を押しのけて一瞬ちらつく。
  // 呼び出し元が9箇所あるので、入口で止める方が取りこぼしがない。
  if (state.active && state.reason !== "completed") {
    // ホバー中は会話欄付きの表示へ寄せる（中で枠も描き直される）。
    if (isHovered && !dragging) showPomodoroWithChat();
    else updatePomodoroQuickVisibility();
    return;
  }
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

function showChatBubble(busy = false, carriedSources = [], carriedLine = undefined) {
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
    // もう一度聞くはアイコンだけにして、コピーの隣へ（本文スペースを確保）
    const replay = createReplayButton(entry?.answer);
    if (replay) history.append(previous, count, next, replay, copy);
    else history.append(previous, count, next, copy);
    bubble.append(message);
    if (sourceList) bubble.append(sourceList);
    bubble.append(history);
  } else {
    bubble.append(message);
    if (sourceList) bubble.append(sourceList);
    // ナビ行が無い表示（持ち越しセリフ・質問中）でも、もう一度聞くだけは残す
    if (!busy) {
      appendReplayAction(pendingCharacterCustomization?.text || carriedLine?.text || entry?.answer);
    }
  }

  // ホバーで入力欄付きの表示へ切り替わっても、選択肢は残す。
  // 押そうとマウスを近づけた瞬間に消えると、ボタンとして使えない。
  if (!busy) {
    const choiceSource = pendingCharacterCustomization?.choices?.length
      ? pendingCharacterCustomization
      : carriedLine;
    const choiceButtons = createChoiceButtons(choiceSource);
    if (choiceButtons) bubble.append(choiceButtons);
  }

  const form = document.createElement("form");
  form.className = "chat-form";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = pendingCharacterCustomization
    ? "びくたんへの答えを書く…"
    : "びくたんに話しかける…";
  input.maxLength = 4000;
  input.disabled = busy;
  if (!busy) input.value = chatDraft;
  input.setAttribute("aria-label", "びくたんへのメッセージ");
  const send = document.createElement("button");
  send.type = "submit";
  send.textContent = busy ? "…" : "送信";
  send.disabled = busy;
  const mic = document.createElement("button");
  mic.type = "button";
  mic.className = "voice-input-button";
  mic.classList.toggle("is-handsfree", handsFreeEnabled);
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia);
  mic.title = !canRecord
    ? "この環境では録音できません"
    : handsFreeEnabled
      ? "ハンズフリー会話が待機中（長押しでOFF）"
      : "クリックで録音／長押しでハンズフリーON";
  // ハンズフリー中も押せるようにしておく。無効化するとpointerイベントが
  // 飛ばず、長押しでOFFに戻せなくなる。
  mic.disabled = busy || !canRecord;
  mic.setAttribute("aria-label", handsFreeEnabled
    ? "ハンズフリー会話が待機中。長押しで解除"
    : "音声で入力。長押しでハンズフリー会話");
  mic.setAttribute("aria-pressed", handsFreeEnabled ? "true" : "false");

  let micLongPressTimer;
  let micLongPressFired = false;
  const startMicLongPress = () => {
    clearTimeout(micLongPressTimer);
    micLongPressFired = false;
    if (!canRecord) return;
    micLongPressTimer = setTimeout(() => {
      micLongPressFired = true;
      toggleHandsFreeFromMic();
    }, MIC_LONG_PRESS_MS);
  };
  const cancelMicLongPress = () => clearTimeout(micLongPressTimer);
  mic.addEventListener("pointerdown", startMicLongPress);
  mic.addEventListener("pointerup", cancelMicLongPress);
  mic.addEventListener("pointerleave", cancelMicLongPress);
  mic.addEventListener("pointercancel", cancelMicLongPress);
  mic.addEventListener("click", (event) => {
    // 長押しで切り替えた直後は、指を離した時のクリックまで拾わない。
    if (micLongPressFired) {
      micLongPressFired = false;
      event.preventDefault();
      return;
    }
    toggleVoiceInput(input, mic);
  });
  form.append(input);
  form.append(mic);
  // 「あとで」「この質問はもうしない」は入力欄と同じ行に置くと、
  // 入力欄が押しつぶされて打ちにくい。下の行へ分ける。
  const questionActions = document.createElement("div");
  questionActions.className = "chat-question-actions";
  if (pendingCharacterCustomization && !busy) {
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
      questionActions.append(defer);
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
        questionActions.append(skip);
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
  // 質問用のボタンは入力欄の下へ。同じ行に置くと入力欄が押しつぶされる。
  if (questionActions.childElementCount) bubble.append(questionActions);
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
  if (!chatActive || isThinking || voiceInputActive) return;
  chatIdleTimer = setTimeout(() => {
    // 長い読み上げの途中で会話モードを閉じると、口パクだけ先に止まってしまう。
    // 音声が終わるまでは会話を維持し、終わってから改めて30秒待つ。
    if (isSpeaking || isThinking || voiceInputActive) {
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

// 続きものの途中の行が返信先になった時、その話題の先頭まで遡って一つにまとめる。
// 「調整に時間かかりますよね？」だけ渡しても、何の調整か分からない。
function withThreadContext(item) {
  const text = String(item?.text || "").trim();
  if (!text) return item;
  const index = lineHistory.findIndex((line) => line.text === text);
  if (index < 0 || !lineHistory[index]?.continues) return item;
  let start = index;
  while (start > 0 && lineHistory[start]?.continues) start -= 1;
  if (start === index) return item;
  const thread = lineHistory.slice(start, index + 1).map((line) => line.text);
  console.log(`Choice reply context: ${thread.length}行さかのぼり`);
  return { ...item, text: thread.join(" ") };
}

async function runChat(rawMessage, { uncertain = false, replyTo } = {}) {
  const message = rawMessage.trim();
  if (!message || isSpeaking || isThinking) return;
  // 「考え中」表示へ切り替えると displayedLineItem が消えるため、先に返信先を固定する。
  // ホバーで復元した古い独り言でも、入力欄から送った場合は明示的な返信として扱う。
  const lastLine = lineHistory[lineHistory.length - 1];
  const latestChatEntry = chatEntries[chatEntries.length - 1];
  // 選択肢ボタンは、どのセリフに紐づくかを押した時点で持っている。
  // 推測に頼ると、直前の会話が履歴に残っている時にそちらへ引っ張られる。
  const pickedContext = String(replyTo?.text || "").trim()
    ? { item: withThreadContext(replyTo), direct: true }
    : pickConversationContext({
      displayedLineItem,
      lastAmbientLine: lastLine,
      latestChatEntry
    });
  const replyContextItem = pickedContext.item
    ? normalizeSpeechItem(pickedContext.item)
    : undefined;
  const contextLine = replyContextItem?.text || "";
  const contextSources = replyContextItem?.sources || [];
  const contextKind = replyContextItem?.kind || "";
  const isDirectReply = pickedContext.direct;
  console.log(
    `Chat context: ${isDirectReply ? "直接返信" : contextKind || "文脈なし"}` +
    (contextLine ? ` ← 「${contextLine.slice(0, 28)}」` : "")
  );
  stopVoiceInput();
  chatDraft = "";
  chatActive = true;
  // 話しかけられたので、途中の独り言の続きは追いかけない（main側でも捨てられる）。
  threadFollowUpPending = false;
  clearTimeout(chatterFollowUpTimer);
  clearTimeout(chatIdleTimer);
  clearTimeout(responseSpeechTimer);
  isSpeaking = false;
  isThinking = true;
  pendingQuestion = message;
  bikunavi.send("companion:hover", true);
  // ホバー時の手振りなどを考え中まで引きずらない。
  stopMotions();
  setEmote("thinking");
  showChatBubble(true);
  scheduleThinkingSound();
  try {
    const customizationQuestion = pendingCharacterCustomization;
    const rawChatResponse = customizationQuestion
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
        contextSources,
        contextKind,
        uncertain
      );
    if (rawChatResponse?.aborted) {
      // 生成中に話しかけられて畳んだ。回答も履歴も残さず静かに戻る。
      // 続きは、いま録っている発話の文字起こしが終わってから始まる。
      pendingQuestion = "";
      isThinking = false;
      isSpeaking = false;
      showChatBubble();
      return;
    }
    const response = normalizeSpeechItem(rawChatResponse);
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
    showChatBubble();
    setEmote(response.emote || "joy");
    // emoteはnormalizeSpeechItemでANSWER_EMOTES検証済み。明るい表情だけ喜びモーション付き
    // （normal・troubled・sad では跳ねない）
    if (["joy", "wink", "proud", "surprised"].includes(response.emote || "joy")) {
      playMotionOnce("Happy");
    }

    // main側の先行読み上げ（ストリーミング中に話し始めるやつ）が動いている
    // 場合は、こちらから読み上げを始めない（二重再生防止）。発話状態は
    // companion:speech-started / speech-ended イベント経由で同期される。
    // 中断が間に合わず回答が確定した直後でも、まだ話している最中なら
    // 声を被せない。本文の表示だけ済ませ、次の発話の番を待つ。
    if (!rawChatResponse?.alreadySpeaking && !handsFreeUtterance) {
      bikunavi.invoke("companion:speak", response.text, "answer")
        .then((speechId) => {
          if (!speechId) return;
          currentSpeechId = speechId;
          currentSpeechKind = "answer";
          isSpeaking = true;
          armSpeechWatchdog(response.text);
        })
        .catch((speechError) => {
          console.error("Speech failed:", speechError);
        });
    }
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
    isSpeaking = false;
    showChatBubble();
    setEmote("troubled");
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
  lastEmoteName = name;
  currentEmote = { ...(EMOTES[name] || EMOTES.default) };
  // ミュート中は表情をマスク（f07）で固定する。解除時に本来の表情へ戻る
  if (soundMuted) {
    model?.expression(MASK_EXPRESSION);
    return;
  }
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

function isBrightEmote(emote) {
  return ["joy", "wink", "proud", "surprised"].includes(emote);
}

function showLineEmote(lineItem, motionGroup = "Happy") {
  const emote = ANSWER_EMOTES.has(lineItem?.emote) ? lineItem.emote : "joy";
  setEmote(emote);
  if (isBrightEmote(emote)) playMotionOnce(motionGroup);
  else stopMotions();
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

// 夜更けと明け方は眠そうにする。待機している時だけで、話しかけられたら
// 普通の顔に戻る（眠そうなまま応対されると素っ気なく見えるため）。
// 表示の演出なのでMacのローカル時刻で足りる（会話の時刻感覚はmain側がJSTで持つ）。
const SLEEPY_FROM_HOUR = 20;
const SLEEPY_UNTIL_HOUR = 5;
// 誰にも触られない時間が続くと、だんだんうとうとしてくる。
// 「待機だから薄い」ではなく「眠ってしまったから薄い」に見せるための時間。
const DROWSY_FULL_MS = 150000;
// 夜はこの倍だけ早く眠くなる。
const DROWSY_NIGHT_SPEED = 2.4;

let lastAwakeAt = Date.now();

// 0（ぱっちり）〜1（すっかり眠い）。話しかけられていれば常に0。
function getSleepiness() {
  const busy = isHovered || dragging || chatActive || isThinking ||
    isSpeaking || lineHistoryActive || pomodoroState.active;
  if (busy) {
    lastAwakeAt = Date.now();
    return 0;
  }
  const hour = new Date().getHours();
  const night = hour >= SLEEPY_FROM_HOUR || hour < SLEEPY_UNTIL_HOUR;
  const speed = night ? DROWSY_NIGHT_SPEED : 1;
  return Math.min(1, (Date.now() - lastAwakeAt) * speed / DROWSY_FULL_MS);
}

// 待機中だけキャラクターを薄くする。吹き出し・会話・読み上げ中は元に戻す。
// canvasへCSSで掛ける。ウィンドウのsetOpacityだと吹き出しまで薄くなる。
let dimWhenIdleEnabled = false;
let appliedCharacterOpacity;

function updateCharacterOpacity(sleepiness = getSleepiness()) {
  // 眠りに合わせて薄くする。うとうとし始めた時点から少しずつ薄れ、
  // 眠りきった時にいちばん薄くなる。話しかければ即座に戻る。
  const raw = dimWhenIdleEnabled
    ? 1 - sleepiness * (1 - DIM_IDLE_OPACITY)
    : 1;
  // 毎フレームDOMを触らないよう、見た目に差が出る幅で丸める。
  const next = Math.round(raw * 20) / 20;
  if (next === appliedCharacterOpacity) return;
  appliedCharacterOpacity = next;
  canvas.style.opacity = String(next);
}

function applyDimWhenIdleSetting(enabled) {
  dimWhenIdleEnabled = Boolean(enabled);
  updateCharacterOpacity();
}

// クリック透過モード中、カーソルがびくたん本体・吹き出し・操作UIの上に
// 来た時だけウィンドウがクリックを受け取り、それ以外は後ろへ通す。
// 当たり判定は companion:cursor（mainのポーリング）で毎フレーム更新される。
let clickThroughEnabled = false;
let mouseIgnoreState; // undefined = 未確定。次のカーソル更新で必ず送る。

function updateMouseCapture(inside) {
  if (!clickThroughEnabled) return;
  const ignore = !inside;
  if (ignore === mouseIgnoreState) return;
  mouseIgnoreState = ignore;
  bikunavi.send("companion:set-mouse-ignore", ignore);
}

function applyClickThroughSetting(enabled) {
  const next = Boolean(enabled);
  if (next === clickThroughEnabled) return;
  clickThroughEnabled = next;
  // 切り替え直後は状態を未確定に戻し、次のカーソル更新で必ず送り直す。
  // OFF側のウィンドウ復帰は main が受け持つ。
  mouseIgnoreState = undefined;
}

function enterCharacter() {
  if (isHovered || dragging) return;
  isHovered = true;
  bikunavi.send("companion:hover", true);
  // セリフに合わせた表情（泣き顔・困り顔など）はホバーで上書きしない。
  // 素の顔のときだけ、気づいてにこっとする
  if (lastEmoteName === "default" || lastEmoteName === "normal") setEmote("joy");
  if (lineHistoryActive) return;
  if (chatActive && bubble.classList.contains("has-chat")) return;
  if (pomodoroState.active) {
    // 集中している間も話しかけられるようにする。タイマーだけに差し替えると
    // 入力欄とマイクが消えて、思いついたことを渡せなくなる。
    showPomodoroWithChat();
    model?.motion("Wave", 0);
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
    showChatBubble(false, readingLine?.sources || [], readingLine);
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
  chatterTimer = setInterval(() => {
    runIdleChatter().catch(console.error);
  }, idleIntervalMs);
}

// 続きものを話している間だけ、いつもの間隔を待たずに次の行へ進む。
// 30秒〜2分空くと「続き」に聞こえないため。
function scheduleThreadFollowUp() {
  clearTimeout(chatterFollowUpTimer);
  chatterFollowUpTimer = setTimeout(() => {
    runIdleChatter().catch(console.error);
  }, THREAD_FOLLOW_UP_MS);
}

async function runIdleChatter() {
  if (
    isHovered ||
    dragging ||
    isSpeaking ||
    chatActive ||
    pomodoroState.active ||
    systemSleeping ||
    idleChatterBusy ||
    !model
  ) {
    // 続きを出すつもりで残しておいた吹き出しを、宙ぶらりんにしない。
    // 実際に消すかどうかはhideBubble側がホバー等を見て判断する。
    if (threadFollowUpPending) {
      threadFollowUpPending = false;
      hideBubble(1200);
    }
    return;
  }

  idleChatterBusy = true;
  try {
    const rawLine = await bikunavi.invoke("companion:idle-line");
    const lineItem = normalizeSpeechItem(rawLine);
    threadFollowUpPending = Boolean(rawLine?.followUpSoon);
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
    showLineEmote(lineItem, lineItem.kind === "custom-question" ? "Wave" : "Happy");

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
      if (threadFollowUpPending) scheduleThreadFollowUp();
      else hideBubble();
    }, displayDuration);
  } catch (error) {
    console.error(error);
  } finally {
    idleChatterBusy = false;
  }
}

function startFloating() {
  // 一定間隔だと機械的なので、18〜35秒のゆらぎで移動チャンスを作る
  const scheduleNext = (delayMs) => {
    setTimeout(() => {
      if (!isHovered && !dragging && !chatActive && !pomodoroState.active) {
        bikunavi.send("companion:auto-move");
      }
      scheduleNext(18000 + Math.random() * 17000);
    }, delayMs);
  };
  scheduleNext(20000);
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

function updateInteractionMotion(core, seconds, deltaMs, disabled) {
  const activeState = disabled
    ? ""
    : isSpeaking
      ? "speaking"
      : isThinking
        ? "thinking"
        : (chatActive || isHovered)
          ? "listening"
          : "idle";
  const ease = Math.min(1, deltaMs / 260);
  for (const state of Object.keys(interactionMotionWeights)) {
    const target = state === activeState ? 1 : 0;
    interactionMotionWeights[state] += (target - interactionMotionWeights[state]) * ease;
  }

  const speaking = interactionMotionWeights.speaking;
  if (speaking > 0.001) {
    core.addParameterValueById("ParamBodyPositionY", Math.sin(seconds * 4.2) * 2.2, speaking);
    core.addParameterValueById("ParamBodyAngleZ", Math.sin(seconds * 2.1) * 1.4, speaking);
  }
  const thinking = interactionMotionWeights.thinking;
  if (thinking > 0.001) {
    core.addParameterValueById("ParamAngleZ", 1.7 + Math.sin(seconds * 1.7) * 1.3, thinking);
    core.addParameterValueById("ParamBodyPositionY", Math.sin(seconds * 1.2) * 0.8, thinking);
  }
  const listening = interactionMotionWeights.listening;
  if (listening > 0.001) {
    core.addParameterValueById("ParamAngleZ", 1.1 + Math.sin(seconds * 1.1) * 0.6, listening);
    core.addParameterValueById("ParamBodyPositionY", Math.sin(seconds * 1.3) * 0.7, listening);
  }
  const idle = interactionMotionWeights.idle;
  if (idle > 0.001) {
    core.addParameterValueById("ParamBodyPositionY", Math.sin(seconds * 0.9) * 0.75, idle);
    core.addParameterValueById("ParamBodyAngleZ", Math.sin(seconds * 0.55) * 0.55, idle);
  }
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
      console.log("びくたんのLive2D物理演算を読み込みました");
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
      // 掴んで振り回された時、体が置いていかれて傾く。手を離しても
      // すぐには止まらず、揺り戻しながら収まる。
      // 掴んでいる間も減衰させる。カーソルを止めると pointermove が来なくなり、
      // 減衰しないままだと傾いた姿勢で固まってしまう。
      const swayDecay = Math.pow(dragging ? 0.94 : 0.88, pixiApp.ticker.deltaMS / 16);
      dragSway.x *= swayDecay;
      dragSway.y *= swayDecay;
      if (Math.abs(dragSway.x) > 0.01 || Math.abs(dragSway.y) > 0.01) {
        // 少し動かしただけでも効くよう、上限は低めに取る。
        const swayX = Math.max(-1, Math.min(1, dragSway.x / 18));
        const swayY = Math.max(-1, Math.min(1, dragSway.y / 18));
        // 首（ParamAngleZ）は可動域が広いので大きく倒す。
        // 体（ParamBodyAngleZ）は±10前後で頭打ちなので控えめに。
        core.addParameterValueById("ParamAngleZ", swayX * -22);
        core.addParameterValueById("ParamBodyAngleZ", swayX * -10);
        core.addParameterValueById("ParamBodyX", swayX * -9);
        core.addParameterValueById("ParamBodyAngleX", swayX * -9);
        // 上下に振ると、体が縦に伸び縮みするように見せる。
        core.addParameterValueById("ParamBodyPositionY", swayY * -13);
        core.addParameterValueById("ParamAngleY", swayY * -10);
      }
      // 聞く・考える・話す・待機の動きを約0.26秒で混ぜ、状態切替時のカクつきを抑える。
      // 先行読み上げ中は、回答生成が続いていても「話す」を最優先する。
      updateInteractionMotion(core, seconds, pixiApp.ticker.deltaMS, danceActive || dragging);
      // 眠さは副作用（起きた時刻の更新）を持つので、1フレームに1回だけ求める。
      const sleepiness = getSleepiness();
      updateCharacterOpacity(sleepiness);
      blinkTimer -= pixiApp.ticker.deltaMS;
      // 眠い時はまばたきの間隔を詰め、閉じている時間も長くする。
      if (blinkTimer <= 0) {
        blinkTimer = (Math.random() * 3000 + 2000) * (1 - sleepiness * 0.45);
      }
      const eyeLSmile = currentEmote.eyeLSmile ?? currentEmote.eyeSmile;
      const eyeRSmile = currentEmote.eyeRSmile ?? currentEmote.eyeSmile;
      // まぶたを少し下ろす。完全には閉じない（寝落ちして見えないように）。
      const sleepyEyeScale = 1 - sleepiness * 0.4;
      const eyeLOpenBase = (currentEmote.eyeLOpen ?? currentEmote.eyeOpen) * sleepyEyeScale;
      const eyeROpenBase = (currentEmote.eyeROpen ?? currentEmote.eyeOpen) * sleepyEyeScale;
      const blinking = blinkTimer < 150 + sleepiness * 130;
      const eyeLOpen = eyeLSmile <= 0.5 && blinking ? 0 : eyeLOpenBase;
      const eyeROpen = eyeRSmile <= 0.5 && blinking ? 0 : eyeROpenBase;
      let mouthOpen = currentEmote.mouthOpen;
      let mouthForm = currentEmote.mouthForm;
      if (isSpeaking) {
        const noise = Math.sin(seconds * 25) * Math.sin(seconds * 7);
        mouthOpen = Math.max(mouthOpen, noise * 0.5 + 0.4);
      } else if (!isThinking && isHovered && !chatActive) {
        // 触られている間は、ふだん口を閉じたままで、たまにひと呼吸ぶんだけ開く。
        // 動きっぱなしにすると、何も言っていないのに喋って見える。
        //
        // 位相は経過時間を積み上げて進める。`seconds % cycle` だと、
        // 周期を揺らした時に余りが飛んで、開きかけで急に閉じたりする。
        const cycleMs = 3000 + Math.sin(seconds * 0.37) * 700;
        hoverMouthPhase = (hoverMouthPhase + pixiApp.ticker.deltaMS / cycleMs) % 1;
        // 周期の1/4だけ開く。実時間で0.6〜0.9秒かけて開き切って閉じるので、
        // ぱくぱくせず、ひと呼吸ぶんの動きに見える。
        const openWindow = 0.25;
        if (hoverMouthPhase < openWindow) {
          // 開いて閉じるまでをひと山で。開くほど口角を上げて笑顔側へ。
          // すでに笑っている表情なら、その口角を下げない。
          const ease = Math.sin((hoverMouthPhase / openWindow) * Math.PI);
          mouthOpen = ease * 0.8;
          mouthForm = Math.max(mouthForm, ease * 0.9);
        }
      } else {
        // 触っていない間は閉じた状態へ戻しておく。次に触れた時、
        // 開きかけの途中から始まらないように。
        hoverMouthPhase = 0;
      }
      core.setParameterValueById("ParamEyeLOpen", eyeLOpen);
      core.setParameterValueById("ParamEyeROpen", eyeROpen);
      core.setParameterValueById("ParamEyeLSmile", eyeLSmile);
      core.setParameterValueById("ParamEyeRSmile", eyeRSmile);
      core.setParameterValueById("ParamMouthForm", mouthForm);
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
      if (Number.isFinite(Number(settings?.speechVolume))) {
        speechVolume = Number(settings.speechVolume);
        updateVolumeControl();
      }
      if (typeof settings?.handsFreeEnabled === "boolean") {
        handsFreeEnabled = settings.handsFreeEnabled;
      }
      if (typeof settings?.clickThroughEnabled === "boolean") {
        applyClickThroughSetting(settings.clickThroughEnabled);
      }
      if (typeof settings?.dimWhenIdleEnabled === "boolean") {
        applyDimWhenIdleSetting(settings.dimWhenIdleEnabled);
      }
    } catch (error) {
      console.error("Settings load failed:", error);
    }
    try {
      const ratings = await bikunavi.invoke("companion:source-ratings");
      for (const item of Array.isArray(ratings) ? ratings : []) {
        if (typeof item?.url === "string" && item.rating) {
          sourceRatings.set(item.url, item.rating);
        }
      }
    } catch (error) {
      console.error("Source ratings load failed:", error);
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
    if (handsFreeEnabled) startHandsFreeListening().catch(console.error);
    console.log("サイト版の挙動でびくたんを起動しました");
    window.addEventListener("resize", () => {
      fitModel();
      requestAnimationFrame(fitModel);
    });
    watchPixelRatio();
  } catch (error) {
    console.error(error);
    status.textContent = "モデルを読み込めませんでした";
  }
}

bikunavi.on("companion:cursor", (point) => {
  if (!model || pointerDown) return;
  const insideCharacter = characterHitBounds?.contains(point.x, point.y) ?? false;
  const inside = insideCharacter || isPointInActiveBubble(point) ||
    isPointInPomodoroQuick(point) || isPointInSoundControls(point);
  // クリックを受け取るのは、実際に押せるものの上だけ。ホバー検知用の
  // 広い判定（キャラと吹き出しの間の余白を含む）をそのまま使うと、
  // 吹き出しが出ている間だけ後ろを触れなくなる。
  updateMouseCapture(
    insideCharacter || isPointInBubbleRect(point) ||
    isPointInPomodoroQuick(point) || isPointInSoundControls(point)
  );
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

// Dockに出ないアクセサリ型アプリのため、ウィンドウが非アクティブだと入力欄を
// クリックしてもmacOSがキーボードフォーカスをくれないことがある。
// その場合はmain側でウィンドウを明示的にフォーカスしてから入力欄へ戻す。
document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  const isInput = target instanceof HTMLInputElement;
  // 吹き出し内のテキスト選択→Cmd+Cにもキーボードフォーカスが要る
  const inBubble = target instanceof Element && Boolean(target.closest("#bubble"));
  if (!isInput && !inBubble) return;
  if (document.hasFocus()) return;
  bikunavi.send("companion:focus-window");
  if (isInput) {
    setTimeout(() => {
      if (document.hasFocus()) target.focus();
    }, 60);
  }
}, true);

new MutationObserver(() => {
  if (model && topDocked) fitModel();
}).observe(bubble, {
  attributes: true,
  attributeFilter: ["class"]
});

// 終了イベントを万一取りこぼしても、口パクと会話モードが「発話中」のまま
// 固まらないための自己回復タイマー（固まるとポモドーロUI等が出なくなる）
let speechWatchdogTimer;
function armSpeechWatchdog(text) {
  clearTimeout(speechWatchdogTimer);
  const limitMs = Math.min(60000, Math.max(10000, String(text || "").length * 250));
  speechWatchdogTimer = setTimeout(() => {
    currentSpeechId = undefined;
    currentSpeechKind = undefined;
    isSpeaking = false;
  }, limitMs);
}

bikunavi.on("companion:speech-ended", (speechId) => {
  if (speechId !== currentSpeechId) return;
  clearTimeout(speechWatchdogTimer);
  const speechKind = currentSpeechKind;
  currentSpeechId = undefined;
  currentSpeechKind = undefined;
  isSpeaking = false;
  if (handsFreeEnabled && handsFreeRecorder && !handsFreeUtterance) {
    handsFreeIgnoreUntil = Date.now() + 280;
    handsFreeRecorder.detector.reset();
    clearHandsFreePreRoll(handsFreeRecorder);
  }
  if (speechKind === "aizuchi" && isThinking) {
    setEmote("thinking");
  }
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
    // 続きものの途中は吹き出しを消さない。消して出し直すと、同じ話題の
    // 続きでも別々の発言に見えてしまう。次の行は本文だけ差し替える。
    if (threadFollowUpPending) scheduleThreadFollowUp();
    else hideBubble(holdMs);
  }
});

bikunavi.on("companion:speech-started", (payload) => {
  currentSpeechId = payload?.speechId;
  currentSpeechKind = payload?.kind || "answer";
  isSpeaking = Boolean(currentSpeechId);
  if (!isSpeaking) return;
  if (handsFreeEnabled && handsFreeRecorder && !handsFreeUtterance) {
    // スピーカーから出たびくたん自身の声の立ち上がりを、人の発話と誤認しない。
    // その後は高めの閾値で待機し、長い回答への割り込みは受け付ける。
    handsFreeIgnoreUntil = Date.now() + 850;
    handsFreeRecorder.detector.reset();
    clearHandsFreePreRoll(handsFreeRecorder);
  }
  if (currentSpeechKind === "aizuchi" && isThinking) {
    setEmote("joy");
  } else if (currentSpeechKind === "answer" && isThinking) {
    // 先行読み上げが始まった時点で、見た目とジングルも「考える」から「話す」へ移る。
    stopThinkingSound();
    if (lastEmoteName === "thinking") setEmote("joy");
  }
  armSpeechWatchdog(displayedLineItem?.text || latestAmbientLineItem?.text);
});

bikunavi.on("companion:music-playing", (playing) => {
  musicPlaying = Boolean(playing);
  resumeAmbientState();
});

// ストリーミング応答: 「考え中です…」の位置に、受信できた本文を育てて表示する。
// 完成した回答は従来どおり companion:chat の戻り値（サニタイズ済み）で置き換わる。
bikunavi.on("companion:chat-delta", (payload) => {
  if (!isThinking) return;
  const partial = String(payload?.text || "").trim();
  if (!partial) return;
  const message = bubble.querySelector(".chat-message");
  if (!message) return;
  message.textContent =
    `${preferredUserName}：${shortenForBubble(pendingQuestion, 80)}\n\n` +
    `びくたん：${shortenForBubble(partial, 240)}`;
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
  // 集中中はタイマー表示が毎秒入るので、開始時のセリフを取っておく。
  if (lineItem.kind === "pomodoro-start") pomodoroStartLineItem = lineItem;
  showBubble(lineItem);
  showLineEmote(lineItem, lineItem.kind === "custom-question" ? "Wave" : "Happy");

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
  if (Number.isFinite(Number(settings?.speechVolume))) {
    speechVolume = Number(settings.speechVolume);
    updateVolumeControl();
  }
  if (typeof settings?.handsFreeEnabled === "boolean") {
    applyHandsFreeSetting(settings.handsFreeEnabled);
  }
  if (typeof settings?.clickThroughEnabled === "boolean") {
    applyClickThroughSetting(settings.clickThroughEnabled);
  }
  if (typeof settings?.dimWhenIdleEnabled === "boolean") {
    applyDimWhenIdleSetting(settings.dimWhenIdleEnabled);
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
    stopHandsFreeListening();
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
  if (handsFreeEnabled) startHandsFreeListening().catch(console.error);
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
  // 先に枠を描き直す。これを忘れると、開始した直後に待機中の
  // 「集中する？」が残って一瞬見えてしまう。
  renderPomodoroQuick();
  // 開始・一時停止・再開は下の枠（#pomodoro-quick）が受け持つ。
  // ここで吹き出しへ出すと、切り替わる前の表示が一瞬見えてしまう。
  if (["completed", "stopped"].includes(reason)) {
    showPomodoroBubble(pomodoroState, reason === "completed");
  } else if (pomodoroState.active && bubble.classList.contains("has-timer")) {
    showPomodoroBubble(pomodoroState);
  } else if (pomodoroState.active && bubble.querySelector(".timer-inline")) {
    // 会話欄と並べて出している時は、その行だけ書き換える。
    // 吹き出しを作り直すと、入力途中の文字が消える。
    const inline = bubble.querySelector(".timer-inline");
    inline.textContent =
      `${pomodoroState.label || "ポモドーロ"}` +
      `${pomodoroState.running ? "" : " 一時停止中"}  ` +
      `${pomodoroState.timeText || "0:00"}`;
  }
  // 終わったら開始時のセリフは役目を終える。次の集中まで持ち越さない。
  if (!pomodoroState.active) pomodoroStartLineItem = undefined;
  if (!pomodoroState.active && reason !== "completed") resumeAmbientState();
});

// macOS 以外では、読み上げの音声を main から受け取ってここで鳴らす。
// afplay が無いため。鳴り終わったことを返さないと、次の文へ進めない。
// 読み上げと相づちは別チャンネルで持ち、互いに止め合わない
//（main 側の speechProcess / aizuchiProcess の分離と同じ形）。
const rendererAudioChannels = { speech: undefined, aizuchi: undefined, thinking: undefined };

function audioChannelName(channel) {
  return rendererAudioChannels[channel] !== undefined || channel in rendererAudioChannels
    ? channel
    : "speech";
}

function stopRendererAudio(channel) {
  const name = audioChannelName(channel);
  const audio = rendererAudioChannels[name];
  if (!audio) return;
  rendererAudioChannels[name] = undefined;
  audio.pause();
  audio.src = "";
}

bikunavi.on("companion:play-audio", async ({ id, data, volume, channel, mime } = {}) => {
  const name = audioChannelName(channel);
  stopRendererAudio(name);
  if (!data) {
    bikunavi.send("companion:audio-finished", { id, ok: false });
    return;
  }
  try {
    // data: URL ではなく Blob を使う。CSP を data: まで開けずに済み、
    // 長い音声でも URL 文字列にせずに扱える。
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    // 読み上げは wav、効果音は mp3。中身に合わせないと鳴らない環境がある。
    const url = URL.createObjectURL(new Blob([bytes], { type: mime || "audio/wav" }));
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, Number(volume) || 1));
    rendererAudioChannels[name] = audio;
    const done = (ok) => {
      if (rendererAudioChannels[name] === audio) rendererAudioChannels[name] = undefined;
      // 使い終わったら開放する。残すとメモリを持ち続ける。
      URL.revokeObjectURL(url);
      bikunavi.send("companion:audio-finished", { id, ok });
    };
    audio.addEventListener("ended", () => done(true), { once: true });
    audio.addEventListener("error", () => done(false), { once: true });
    // 停止された時も返す。返さないと main が待ち続ける。
    audio.addEventListener("pause", () => {
      if (!audio.ended) done(false);
    }, { once: true });
    await audio.play();
  } catch (error) {
    console.error("Audio playback failed:", error);
    bikunavi.send("companion:audio-finished", { id, ok: false });
  }
});

bikunavi.on("companion:stop-audio", (payload) => {
  stopRendererAudio(payload?.channel);
});

bikunavi.on("companion:pomodoro-chime", (kind) => {
  if (soundMuted) return;
  playPomodoroChime(kind === "finish" ? "finish" : "start").catch(console.error);
});

// びくたん本体を右クリックしたら、その場にメニューを出す。
//
// macOSは常駐アイコンが画面上端のメニューバーに常に見えているが、Windowsは
// 通知領域（右下）で、しかも既定では「^」の中に隠れている。設定を開くまでの
// 手数が多すぎるので、いつでも見えているびくたん自身を入り口にする。
// 吹き出しは別要素（z-index 上）なので、本文の選択は邪魔しない。
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  bikunavi.send("companion:open-menu");
});

canvas.addEventListener("pointerdown", (event) => {
  if (!model || event.button !== 0) return;
  pointerDown = { x: event.screenX, y: event.screenY };
  lastDragPoint = undefined;
  lastDragMoveAt = performance.now();
  dragPeak = 0;
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
  if (dragging) {
    // 画面上をどれだけ速く動かしたかを覚えておく。
    // 1フレームぶんの差分は跳ねやすいので、なまして積む。
    const now = performance.now();
    if (lastDragPoint) {
      const dt = Math.max(8, now - lastDragMoveAt);
      const vx = (event.screenX - lastDragPoint.x) / dt * 16;
      const vy = (event.screenY - lastDragPoint.y) / dt * 16;
      // なますとフレーム側の減衰に負けて、振っても傾かない。
      // 速い方を採る（振った瞬間にしっかり効かせ、あとは減衰に任せる）。
      if (Math.abs(vx) > Math.abs(dragSway.x)) dragSway.x = vx;
      if (Math.abs(vy) > Math.abs(dragSway.y)) dragSway.y = vy;
      dragPeak = Math.max(dragPeak, Math.abs(vx), Math.abs(vy));
    }
    lastDragPoint = { x: event.screenX, y: event.screenY };
    lastDragMoveAt = now;
    bikunavi.send("companion:drag-move");
  }
});

canvas.addEventListener("pointerup", (event) => {
  if (!pointerDown) return;
  canvas.releasePointerCapture(event.pointerId);
  if (dragging) {
    // 振り幅を調整できるよう、どれくらいの速さで動かされたか残す。
    console.log(`Drag sway peak: ${dragPeak.toFixed(1)}（18で最大の傾き）`);
    bikunavi.send("companion:drag-end");
  }
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

window.addEventListener("beforeunload", () => {
  stopHandsFreeListening();
  stopVoiceInput();
});

start();
