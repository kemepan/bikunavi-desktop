const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  screen,
  ipcMain,
  clipboard,
  shell,
  powerMonitor
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

let companionWindow;
let tray;
let dragOrigin;
let cursorTimer;
let autoMoveTimer;
let currentSize = "small";
let characterHovered = false;
let speechEnabled = true;
let idleSpeechEnabled = true;
let speechRate = 190;
let speechProvider = "voicevox";
const voicevoxSpeaker = 58;
const voicevoxVoiceLabel = "猫使ビィ";
let speechProcess;
let speechSequence = 0;
let activeSpeechId;
let speechFile;
const speechWaiters = new Map();
let voicevoxProcess;
let voicevoxOwned = false;
let voicevoxReadyPromise;
const conversationHistory = [];
const idleLineQueue = [];
let idleLineGeneration;
let latestTopicSources = new Map();
const characterSheetPath = path.join(__dirname, "CHARACTER_SHEET.md");
const nowPlayingHelperPath = path.join(__dirname, "native", "now-playing");
let mediaPlaybackTimer;
let mediaPlaybackCheckRunning = false;
let musicPlaying = false;
let systemSleeping = false;
let fortuneAutoEnabled = true;
let pomodoroTimer;
let pomodoroState = {
  active: false,
  running: false,
  phase: undefined,
  label: "",
  duration: 0,
  remaining: 0,
  startedAt: 0,
  endsAt: 0
};

const FALLBACK_IDLE_LINES = [
  "水分とってます？",
  "肩、上がってませんか？",
  "保存しました？ 念のため！",
  "その作業、あと少しですか？",
  "いったん休憩します？",
  "画面、見つめすぎ注意です。"
];

const SIZE_PRESETS = {
  small: { label: "小", width: 220, height: 513 },
  medium: { label: "中", width: 280, height: 598 },
  large: { label: "大", width: 360, height: 718 }
};

const POMODORO_PRESETS = {
  focus90: {
    label: "90分作業",
    duration: 90 * 60,
    startMessage: "90分作業、はじめましょう。深めに潜るやつですね。びくたん、静かに見守ります。",
    nextPhase: "break15",
    nextReason: "autoBreakStarted",
    nextMessage: "90分おつかれさまです。15分休憩に入ります。いったん画面から離れてもいいやつです。"
  },
  break15: {
    label: "15分休憩",
    duration: 15 * 60,
    startMessage: "15分休憩です。ちゃんと休む時間にしましょう。",
    nextPhase: "focus90",
    nextReason: "autoFocusStarted",
    nextMessage: "15分休憩おしまいです。次の90分、ゆっくり戻っていきましょう。"
  },
  focus25: {
    label: "25分作業",
    duration: 25 * 60,
    startMessage: "25分集中、はじめましょう。びくたん、ここで見てますね。",
    nextPhase: "break5",
    nextReason: "autoBreakStarted",
    nextMessage: "25分おつかれさまです。5分休憩に入ります。目と肩、ちょっとゆるめましょう。"
  },
  break5: {
    label: "5分休憩",
    duration: 5 * 60,
    startMessage: "5分休憩です。目と肩、ちょっとゆるめましょう。",
    nextPhase: "focus25",
    nextReason: "autoFocusStarted",
    nextMessage: "5分休憩おしまいです。次の25分、ゆるっと始めましょう。"
  },
  focus15: {
    label: "15分作業",
    duration: 15 * 60,
    startMessage: "15分作業、いきましょう。短く区切って、さくっと進める回です。",
    nextPhase: "focus15",
    nextReason: "autoFocusStarted",
    nextMessage: "15分おつかれさまです。肩を落として、深呼吸をひとつ。では、続けていきましょう。"
  }
};

const FORTUNE_STEMS = [
  { symbol: "甲", element: "木", keyword: "育てる", mood: "広げるより、芽を守る" },
  { symbol: "乙", element: "木", keyword: "整える", mood: "小さく手を入れる" },
  { symbol: "丙", element: "火", keyword: "見せる", mood: "明るく出してみる" },
  { symbol: "丁", element: "火", keyword: "灯す", mood: "一点集中で温める" },
  { symbol: "戊", element: "土", keyword: "固める", mood: "土台を作る" },
  { symbol: "己", element: "土", keyword: "ならす", mood: "散らばりをまとめる" },
  { symbol: "庚", element: "金", keyword: "削る", mood: "余分を落とす" },
  { symbol: "辛", element: "金", keyword: "磨く", mood: "細部をきれいにする" },
  { symbol: "壬", element: "水", keyword: "流す", mood: "詰まりをほどく" },
  { symbol: "癸", element: "水", keyword: "潤す", mood: "静かに補給する" }
];
const FORTUNE_BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const FORTUNE_ACTIONS = [
  "机の上をひと区画だけ空ける",
  "途中保存してから次へ進む",
  "よく使うファイルを一つだけ定位置に戻す",
  "大きい作業を三つに割る",
  "飲み物を用意してから始める",
  "後回しメモを一行だけ書く",
  "ブラウザのタブを三つ閉じる",
  "5分だけ手を動かしてみる",
  "今日やらないことを一つ決める",
  "ケーブルやペンを一つ戻す"
];
const FORTUNE_ITEMS = [
  "あたたかい飲み物",
  "小さなメモ",
  "白い余白",
  "いつものペン",
  "畳んだハンカチ",
  "お気に入りの曲",
  "空のトレイ",
  "短いチェックリスト",
  "明るい画面",
  "一口のおやつ"
];

const traySvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
  <path fill="black" d="M8 5C5 2 2 3 1 1c4-1 7 0 8 3 1-3 4-4 8-3-1 2-4 1-7 4v2h3c2 0 3 1 3 3v5c0 2-1 3-3 3H5c-2 0-3-1-3-3v-5c0-2 1-3 3-3h3V5Zm-3 5v5h8v-5H5Z"/>
</svg>`;

function createWindow() {
  const display = screen.getPrimaryDisplay().workArea;
  const { width, height } = SIZE_PRESETS[currentSize];

  companionWindow = new BrowserWindow({
    width,
    height,
    x: display.x + display.width - width - 24,
    y: display.y + display.height - height - 24,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  companionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  companionWindow.webContents.on("console-message", (_event, level, message) => {
    const logger = level >= 2 ? console.error : console.log;
    logger(`[renderer] ${message}`);
  });
  companionWindow.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`Renderer load failed (${code}): ${description}`);
  });
  companionWindow.loadFile("index.html");
  companionWindow.once("ready-to-show", () => companionWindow.showInactive());
  cursorTimer = setInterval(() => {
    if (!companionWindow || !companionWindow.isVisible()) return;
    const cursor = screen.getCursorScreenPoint();
    const [windowX, windowY] = companionWindow.getPosition();
    companionWindow.webContents.send("companion:cursor", {
      x: cursor.x - windowX,
      y: cursor.y - windowY
    });
  }, 33);
  companionWindow.on("closed", () => {
    clearInterval(cursorTimer);
    companionWindow = undefined;
  });
}

function setCompanionSize(sizeName) {
  const preset = SIZE_PRESETS[sizeName];
  if (!companionWindow || !preset) return;

  clearInterval(autoMoveTimer);
  const [oldX, oldY] = companionWindow.getPosition();
  const [oldWidth, oldHeight] = companionWindow.getSize();
  const centerX = oldX + oldWidth / 2;
  const centerY = oldY + oldHeight / 2;
  currentSize = sizeName;
  companionWindow.setSize(preset.width, preset.height);

  const targetBounds = {
    x: Math.round(centerX - preset.width / 2),
    y: Math.round(centerY - preset.height / 2),
    width: preset.width,
    height: preset.height
  };
  const area = screen.getDisplayMatching(targetBounds).workArea;
  const x = Math.max(
    area.x,
    Math.min(targetBounds.x, area.x + area.width - preset.width)
  );
  const y = Math.max(
    area.y,
    Math.min(targetBounds.y, area.y + area.height - preset.height)
  );
  companionWindow.setPosition(x, y);
  tray?.setContextMenu(buildTrayMenu());
}

function getJstDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day)
  };
}

function makeDailyFortune(date = new Date()) {
  const { year, month, day } = getJstDateParts(date);
  const dateNumber = year * 10000 + month * 100 + day;
  const stem = FORTUNE_STEMS[dateNumber % FORTUNE_STEMS.length];
  const branch = FORTUNE_BRANCHES[(Math.floor(dateNumber / 3) + day) % FORTUNE_BRANCHES.length];
  const action = FORTUNE_ACTIONS[(dateNumber + month) % FORTUNE_ACTIONS.length];
  const item = FORTUNE_ITEMS[(dateNumber + day) % FORTUNE_ITEMS.length];
  const lines = [
    `今日のびくたん占いです。${stem.symbol}${branch}っぽい${stem.element}の日です。`,
    `テーマは「${stem.keyword}」。${stem.mood}感じでいきましょう。`,
    `${action}と吉です。`,
    `ラッキー小物は${item}です。`
  ];
  return {
    text: lines.join("\n"),
    lines,
    sources: []
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function showDailyFortune() {
  const fortune = makeDailyFortune();
  try {
    const lines = Array.isArray(fortune.lines) && fortune.lines.length
      ? fortune.lines
      : [fortune.text];
    for (const [index, line] of lines.entries()) {
      if (systemSleeping) return;
      companionWindow?.webContents.send("companion:fortune", {
        text: line,
        sources: [],
        index,
        total: lines.length
      });
      await speakAndWait(line, "answer");
      if (index < lines.length - 1) await delay(450);
    }
  } catch (error) {
    console.error("Fortune speech failed:", error);
  }
}

function formatPomodoroTime(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function getPomodoroSnapshot(reason = "tick") {
  return {
    ...pomodoroState,
    reason,
    timeText: formatPomodoroTime(pomodoroState.remaining)
  };
}

function refreshPomodoroUi(reason = "tick") {
  if (tray) {
    tray.setTitle(pomodoroState.active ? `🍅 ${formatPomodoroTime(pomodoroState.remaining)}` : "🌱");
    tray.setContextMenu(buildTrayMenu());
  }
  companionWindow?.webContents.send("companion:pomodoro", getPomodoroSnapshot(reason));
}

function clearPomodoroTimer() {
  if (pomodoroTimer) {
    clearInterval(pomodoroTimer);
    pomodoroTimer = undefined;
  }
}

function completePomodoro() {
  const preset = POMODORO_PRESETS[pomodoroState.phase];
  clearPomodoroTimer();

  if (preset?.nextPhase) {
    startPomodoro(preset.nextPhase, {
      reason: preset.nextReason || "autoFocusStarted",
      message: preset.nextMessage
    });
    return;
  }

  pomodoroState = {
    ...pomodoroState,
    active: false,
    running: false,
    remaining: 0,
    endsAt: 0
  };
  refreshPomodoroUi("completed");
  if (preset?.completeMessage) {
    speakFromMain(preset.completeMessage, "answer").catch((error) => {
      console.error("Pomodoro completion speech failed:", error);
    });
  }
}

function tickPomodoro() {
  if (!pomodoroState.active || !pomodoroState.running) return;
  const remaining = Math.max(0, Math.ceil((pomodoroState.endsAt - Date.now()) / 1000));
  if (remaining === pomodoroState.remaining && remaining > 0) return;
  pomodoroState = { ...pomodoroState, remaining };
  if (remaining <= 0) {
    completePomodoro();
    return;
  }
  refreshPomodoroUi("tick");
}

function startPomodoro(phase, options = {}) {
  const preset = POMODORO_PRESETS[phase];
  if (!preset) return;
  clearPomodoroTimer();
  const now = Date.now();
  pomodoroState = {
    active: true,
    running: true,
    phase,
    label: preset.label,
    duration: preset.duration,
    remaining: preset.duration,
    startedAt: now,
    endsAt: now + preset.duration * 1000
  };
  pomodoroTimer = setInterval(tickPomodoro, 1000);
  refreshPomodoroUi(options.reason || "started");
  const message = options.message ?? preset.startMessage;
  if (options.speak !== false && message) {
    speakFromMain(message, "answer").catch((error) => {
      console.error("Pomodoro start speech failed:", error);
    });
  }
}

function pausePomodoro() {
  if (!pomodoroState.active || !pomodoroState.running) return;
  tickPomodoro();
  clearPomodoroTimer();
  pomodoroState = {
    ...pomodoroState,
    running: false,
    endsAt: 0
  };
  refreshPomodoroUi("paused");
}

function resumePomodoro() {
  if (!pomodoroState.active || pomodoroState.running) return;
  pomodoroState = {
    ...pomodoroState,
    running: true,
    endsAt: Date.now() + pomodoroState.remaining * 1000
  };
  clearPomodoroTimer();
  pomodoroTimer = setInterval(tickPomodoro, 1000);
  refreshPomodoroUi("resumed");
}

function stopPomodoro() {
  if (!pomodoroState.active) return;
  clearPomodoroTimer();
  pomodoroState = {
    active: false,
    running: false,
    phase: undefined,
    label: "",
    duration: 0,
    remaining: 0,
    startedAt: 0,
    endsAt: 0
  };
  refreshPomodoroUi("stopped");
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: "びくにたんを表示",
      type: "checkbox",
      checked: companionWindow?.isVisible() ?? false,
      click: (item) => {
        if (!companionWindow) createWindow();
        else if (item.checked) companionWindow.showInactive();
        else companionWindow.hide();
        tray.setContextMenu(buildTrayMenu());
      }
    },
    {
      label: "いつも手前",
      type: "checkbox",
      checked: companionWindow?.isAlwaysOnTop() ?? true,
      click: (item) => companionWindow?.setAlwaysOnTop(item.checked)
    },
    {
      label: "読み上げ",
      type: "checkbox",
      checked: speechEnabled,
      click: (item) => {
        speechEnabled = item.checked;
        if (!speechEnabled) stopSpeech();
        tray.setContextMenu(buildTrayMenu());
      }
    },
    {
      label: "自動セリフも読む",
      type: "checkbox",
      checked: idleSpeechEnabled,
      enabled: speechEnabled,
      click: (item) => {
        idleSpeechEnabled = item.checked;
        tray.setContextMenu(buildTrayMenu());
      }
    },
    {
      label: "読み上げ速度",
      enabled: speechEnabled,
      submenu: [
        { label: "ゆっくり", rate: 150 },
        { label: "標準", rate: 190 },
        { label: "速め", rate: 230 }
      ].map((option) => ({
        label: option.label,
        type: "radio",
        checked: speechRate === option.rate,
        click: () => {
          speechRate = option.rate;
          tray.setContextMenu(buildTrayMenu());
        }
      }))
    },
    {
      label: "音声テスト",
      enabled: speechEnabled,
      click: () => {
        speakText("びくたんの音声テストです。聞こえますか？", "answer")
          .catch((error) => console.error("Voice test failed:", error));
      }
    },
    {
      label: "今日のびくたん占い",
      click: showDailyFortune
    },
    {
      label: "占いを自動セリフに混ぜる",
      type: "checkbox",
      checked: fortuneAutoEnabled,
      click: (item) => {
        fortuneAutoEnabled = item.checked;
        tray.setContextMenu(buildTrayMenu());
      }
    },
    {
      label: "最近のセリフを表示",
      click: () => {
        companionWindow?.webContents.send("companion:show-line-history");
      }
    },
    {
      label: "サイズ",
      submenu: Object.entries(SIZE_PRESETS).map(([name, preset]) => ({
        label: preset.label,
        type: "radio",
        checked: currentSize === name,
        click: () => setCompanionSize(name)
      }))
    },
    {
      label: pomodoroState.active
        ? `ポモドーロ: ${pomodoroState.label} ${formatPomodoroTime(pomodoroState.remaining)}${pomodoroState.running ? "" : " 一時停止中"}`
        : "ポモドーロ",
      submenu: [
        {
          label: "90分 作業を開始",
          click: () => startPomodoro("focus90")
        },
        {
          label: "25分 作業を開始",
          click: () => startPomodoro("focus25")
        },
        {
          label: "15分 作業を開始",
          click: () => startPomodoro("focus15")
        },
        { type: "separator" },
        {
          label: "一時停止",
          enabled: pomodoroState.active && pomodoroState.running,
          click: pausePomodoro
        },
        {
          label: "再開",
          enabled: pomodoroState.active && !pomodoroState.running,
          click: resumePomodoro
        },
        {
          label: "停止",
          enabled: pomodoroState.active,
          click: stopPomodoro
        }
      ]
    },
    {
      label: "右下へ戻す",
      click: () => {
        const display = screen.getPrimaryDisplay().workArea;
        const [width, height] = companionWindow.getSize();
        companionWindow.setPosition(
          display.x + display.width - width - 24,
          display.y + display.height - height - 24
        );
      }
    },
    { type: "separator" },
    { label: "終了", role: "quit" }
  ]);
}

function stopSpeech() {
  if (!speechProcess && !activeSpeechId) return;
  const processToStop = speechProcess;
  const stoppedSpeechId = activeSpeechId;
  speechProcess = undefined;
  activeSpeechId = undefined;
  processToStop?.kill("SIGTERM");
  if (speechFile) {
    fs.promises.unlink(speechFile).catch(() => {});
    speechFile = undefined;
  }
  if (stoppedSpeechId) {
    companionWindow?.webContents.send("companion:speech-ended", stoppedSpeechId);
    resolveSpeechWaiter(stoppedSpeechId);
  }
}

function setSystemSleeping(sleeping) {
  if (systemSleeping === sleeping) return;
  systemSleeping = sleeping;
  if (systemSleeping) stopSpeech();
  companionWindow?.webContents.send("companion:system-sleep", systemSleeping);
}

async function isVoicevoxReady() {
  try {
    const response = await fetch("http://127.0.0.1:50021/version", {
      signal: AbortSignal.timeout(1000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureVoicevoxEngine() {
  if (await isVoicevoxReady()) return;
  if (voicevoxReadyPromise) return voicevoxReadyPromise;

  voicevoxReadyPromise = (async () => {
    const engine =
      "/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run";
    if (!fs.existsSync(engine)) throw new Error("VOICEVOX.appが見つかりません");
    voicevoxProcess = spawn(
      engine,
      [
        "--host", "127.0.0.1",
        "--port", "50021",
        "--disable_mutable_api",
        "--cpu_num_threads", "2"
      ],
      { stdio: "ignore" }
    );
    voicevoxOwned = true;
    voicevoxProcess.on("exit", () => {
      voicevoxProcess = undefined;
      voicevoxOwned = false;
    });

    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await isVoicevoxReady()) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("VOICEVOXエンジンの起動がタイムアウトしました");
  })().finally(() => {
    voicevoxReadyPromise = undefined;
  });
  return voicevoxReadyPromise;
}

async function createVoicevoxAudio(text, speechId) {
  await ensureVoicevoxEngine();
  const queryResponse = await fetch(
    `http://127.0.0.1:50021/audio_query?text=${encodeURIComponent(text)}&speaker=${voicevoxSpeaker}`,
    { method: "POST", signal: AbortSignal.timeout(15000) }
  );
  if (!queryResponse.ok) {
    throw new Error(`VOICEVOX audio_query: ${queryResponse.status}`);
  }
  const query = await queryResponse.json();
  query.speedScale = Math.max(0.75, Math.min(1.35, speechRate / 190));
  query.intonationScale = 1.08;

  const synthesisResponse = await fetch(
    `http://127.0.0.1:50021/synthesis?speaker=${voicevoxSpeaker}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(30000)
    }
  );
  if (!synthesisResponse.ok) {
    throw new Error(`VOICEVOX synthesis: ${synthesisResponse.status}`);
  }
  const output = path.join(app.getPath("temp"), `bikunavi-speech-${speechId}.wav`);
  await fs.promises.writeFile(output, Buffer.from(await synthesisResponse.arrayBuffer()));
  return output;
}

function startSpeechProcess(child, speechId, file) {
  speechProcess = child;
  speechFile = file;
  child.on("close", () => {
    if (speechProcess === child) {
      speechProcess = undefined;
      activeSpeechId = undefined;
      if (speechFile) {
        fs.promises.unlink(speechFile).catch(() => {});
        speechFile = undefined;
      }
      companionWindow?.webContents.send("companion:speech-ended", speechId);
      resolveSpeechWaiter(speechId);
    }
  });
  child.on("error", (error) => {
    console.error("Speech failed:", error);
    resolveSpeechWaiter(speechId);
  });
}

function resolveSpeechWaiter(speechId) {
  const waiter = speechWaiters.get(speechId);
  if (!waiter) return;
  speechWaiters.delete(speechId);
  waiter();
}

async function speakText(rawText, kind) {
  if (systemSleeping) return undefined;
  if (!speechEnabled || (kind === "idle" && !idleSpeechEnabled)) return undefined;
  const text = String(rawText ?? "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
  if (!text) return undefined;

  stopSpeech();
  const speechId = ++speechSequence;
  activeSpeechId = speechId;

  if (speechProvider === "voicevox") {
    try {
      const output = await createVoicevoxAudio(text, speechId);
      if (activeSpeechId !== speechId) {
        fs.promises.unlink(output).catch(() => {});
        return undefined;
      }
      const child = spawn("/usr/bin/afplay", [output], { stdio: "ignore" });
      startSpeechProcess(child, speechId, output);
      return speechId;
    } catch (error) {
      console.error(`VOICEVOX (${voicevoxVoiceLabel}) failed; using macOS voice:`, error);
    }
  }

  if (activeSpeechId !== speechId) return undefined;
  const child = spawn(
    "/usr/bin/say",
    ["-v", "Sandy (日本語（日本）)", "-r", String(speechRate), text],
    { stdio: "ignore" }
  );
  startSpeechProcess(child, speechId);
  return speechId;
}

async function speakFromMain(text, kind = "answer") {
  const speechId = await speakText(text, kind);
  if (speechId) {
    companionWindow?.webContents.send("companion:speech-started", {
      speechId,
      kind
    });
  }
  return speechId;
}

async function speakAndWait(text, kind = "answer") {
  const speechId = await speakFromMain(text, kind);
  if (!speechId) return undefined;
  const fallbackMs = Math.min(12000, Math.max(1600, String(text).length * 170));
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      speechWaiters.delete(speechId);
      resolve();
    }, fallbackMs);
    speechWaiters.set(speechId, () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  return speechId;
}

app.whenReady().then(() => {
  app.dock?.hide();
  createWindow();

  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(traySvg).toString("base64")}`
  );
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setTitle("🌱");
  tray.setToolTip("びくにたん");
  tray.setContextMenu(buildTrayMenu());
  startMusicPlaybackMonitor();
  powerMonitor.on("suspend", () => {
    setSystemSleeping(true);
  });
  powerMonitor.on("resume", () => {
    setSystemSleeping(false);
  });
  ensureVoicevoxEngine().catch((error) => {
    console.error("VOICEVOX prewarm failed:", error);
  });
});

ipcMain.on("companion:drag-start", () => {
  if (!companionWindow) return;
  clearInterval(autoMoveTimer);
  dragOrigin = {
    cursor: screen.getCursorScreenPoint(),
    window: companionWindow.getPosition()
  };
});

ipcMain.on("companion:drag-move", () => {
  if (!companionWindow || !dragOrigin) return;
  const cursor = screen.getCursorScreenPoint();
  companionWindow.setPosition(
    dragOrigin.window[0] + cursor.x - dragOrigin.cursor.x,
    dragOrigin.window[1] + cursor.y - dragOrigin.cursor.y
  );
});

ipcMain.on("companion:drag-end", () => {
  dragOrigin = undefined;
});

ipcMain.on("companion:auto-move", () => {
  if (!companionWindow || dragOrigin || characterHovered || musicPlaying || pomodoroState.active) return;
  clearInterval(autoMoveTimer);

  const bounds = companionWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const destination = {
    x: area.x + Math.round(Math.random() * Math.max(0, area.width - bounds.width)),
    y: area.y + Math.round(Math.random() * Math.max(0, area.height - bounds.height))
  };
  const origin = companionWindow.getPosition();
  const startedAt = Date.now();
  const duration = 10000;

  autoMoveTimer = setInterval(() => {
    if (!companionWindow || dragOrigin || characterHovered || musicPlaying || pomodoroState.active) {
      clearInterval(autoMoveTimer);
      return;
    }
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const eased = (1 - Math.cos(Math.PI * progress)) / 2;
    companionWindow.setPosition(
      Math.round(origin[0] + (destination.x - origin[0]) * eased),
      Math.round(origin[1] + (destination.y - origin[1]) * eased)
    );
    if (progress === 1) clearInterval(autoMoveTimer);
  }, 33);
});

ipcMain.on("companion:hover", (_event, hovered) => {
  characterHovered = Boolean(hovered);
  if (characterHovered) clearInterval(autoMoveTimer);
});

function runCodex(prompt) {
  const codexAppPath =
    process.env.BIKUNAVI_CODEX_PATH ||
    "/Applications/Codex.app/Contents/Resources/codex";
  const codexCommand = fs.existsSync(codexAppPath) ? codexAppPath : "codex";
  const codexWorkingDirectory =
    process.env.BIKUNAVI_CODEX_CWD ||
    path.join(app.getPath("home"), "Documents", "Brain");

  return new Promise((resolve, reject) => {
    const child = spawn(
      codexCommand,
      [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "-C",
        codexWorkingDirectory,
        "-"
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    let output = "";
    let errors = "";

    child.stdout.on("data", (chunk) => {
      if (output.length < 100000) output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      if (errors.length < 100000) errors += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = output.trim();
      if (code === 0 && result) resolve(result);
      else reject(new Error(errors.trim() || "Codexから返答を受け取れませんでした。"));
    });
    child.stdin.end(prompt);
  });
}

function readCharacterSheet() {
  try {
    return fs.readFileSync(characterSheetPath, "utf8").trim();
  } catch (error) {
    console.error("Character sheet could not be read:", error);
    return "明るく実務的で、少しだけいたずらっぽい創作仲間として話す。";
  }
}

function detectMediaRemotePlayback() {
  if (!fs.existsSync(nowPlayingHelperPath)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const child = spawn(nowPlayingHelperPath, [], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      resolve(undefined);
    }, 3000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(undefined);
    });
    child.on("close", () => {
      clearTimeout(timeout);
      if (output.includes("playing")) resolve(true);
      else if (output.includes("stopped")) resolve(false);
      else resolve(undefined);
    });
  });
}

function detectBrowserAudioPlayback() {
  return new Promise((resolve) => {
    const child = spawn("/usr/bin/pmset", ["-g", "assertions"], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      resolve(undefined);
    }, 3000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(undefined);
    });
    child.on("close", () => {
      clearTimeout(timeout);
      resolve(/named:\s*"Playing audio"/i.test(output));
    });
  });
}

async function detectMusicPlayback() {
  const [mediaRemotePlaying, browserAudioPlaying] = await Promise.all([
    detectMediaRemotePlayback(),
    detectBrowserAudioPlayback()
  ]);
  if (mediaRemotePlaying === true || browserAudioPlaying === true) return true;
  if (mediaRemotePlaying === false || browserAudioPlaying === false) return false;
  return undefined;
}

async function updateMusicPlayback() {
  if (mediaPlaybackCheckRunning) return;
  mediaPlaybackCheckRunning = true;
  try {
    const playing = await detectMusicPlayback();
    if (playing === undefined || playing === musicPlaying) return;
    musicPlaying = playing;
    if (musicPlaying) clearInterval(autoMoveTimer);
    companionWindow?.webContents.send("companion:music-playing", musicPlaying);
  } finally {
    mediaPlaybackCheckRunning = false;
  }
}

function startMusicPlaybackMonitor() {
  updateMusicPlayback().catch(console.error);
  mediaPlaybackTimer = setInterval(() => {
    updateMusicPlayback().catch(console.error);
  }, 4000);
}

function decodeXmlText(value) {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .trim();
}

function getXmlTagValue(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeXmlText(match[1]) : "";
}

function parseRssItems(xml, limit) {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .slice(0, limit)
    .map((match) => {
      const itemXml = match[0];
      const title = getXmlTagValue(itemXml, "title");
      const url = getXmlTagValue(itemXml, "link");
      const source = getXmlTagValue(itemXml, "source");
      return { title, url, source };
    })
    .filter((item) => item.title && /^https?:\/\//.test(item.url));
}

function formatTopicForPrompt(id, item) {
  const source = item.source ? `（${item.source}）` : "";
  return `[${id}] ${item.title}${source}`;
}

function normalizeSourceItem(item) {
  if (!item?.url || !/^https?:\/\//.test(item.url)) return undefined;
  return {
    title: String(item.title || item.url).slice(0, 180),
    url: item.url,
    source: String(item.source || "").slice(0, 80)
  };
}

function uniqueSources(sources) {
  const seen = new Set();
  return sources
    .map(normalizeSourceItem)
    .filter(Boolean)
    .filter((source) => {
      if (seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    })
    .slice(0, 4);
}

function extractUrlsFromText(text) {
  return [...String(text).matchAll(/https?:\/\/[^\s)）\]}」』]+/g)]
    .map((match) => ({
      title: match[0],
      url: match[0],
      source: ""
    }));
}

function extractJsonObject(text) {
  const trimmed = String(text).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (_error) {
    return undefined;
  }
}

function parseChatResponse(rawResponse, sourceMap) {
  const parsed = extractJsonObject(rawResponse);
  if (!parsed || typeof parsed.answer !== "string") {
    const text = String(rawResponse).trim();
    return { text, sources: uniqueSources(extractUrlsFromText(text)) };
  }

  const text = parsed.answer.trim();
  const sourceIds = Array.isArray(parsed.sourceIds) ? parsed.sourceIds : [];
  const idSources = sourceIds
    .map((id) => String(id).replace(/[\[\]]/g, "").trim())
    .filter(Boolean)
    .map((id) => sourceMap.get(id))
    .filter(Boolean);
  const explicitSources = Array.isArray(parsed.sources) ? parsed.sources : [];
  return {
    text,
    sources: uniqueSources([
      ...idSources,
      ...explicitSources,
      ...extractUrlsFromText(text)
    ])
  };
}

function shouldAttachLatestTopics(message) {
  return /ニュース|最新|最近|今日|いま|今|時事|話題|トレンド|記事|ソース|出典|URL|情報|AI|生成AI|OpenAI|生活|暮らし|家事|時短|整理|収納|掃除|ライフハック/i.test(message);
}

async function fetchLatestTopics() {
  const generalNews = [];
  const techNews = [];
  const aiNews = [];
  const lifestyleNews = [];
  const sourceItems = [];

  const addSources = (kind, items) => {
    for (const item of items) {
      const id = `${kind}${sourceItems.length + 1}`;
      const sourceItem = { id, ...item };
      sourceItems.push(sourceItem);
      if (kind === "A") aiNews.push(formatTopicForPrompt(id, sourceItem));
      else if (kind === "G") generalNews.push(formatTopicForPrompt(id, sourceItem));
      else if (kind === "L") lifestyleNews.push(formatTopicForPrompt(id, sourceItem));
      else techNews.push(formatTopicForPrompt(id, sourceItem));
    }
  };

  const googleNewsTask = (async () => {
    const response = await fetch(
      "https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) throw new Error(`Google News RSS: ${response.status}`);
    const xml = await response.text();
    addSources("G", parseRssItems(xml, 12));
  })();

  const hackerNewsTask = (async () => {
    const idsResponse = await fetch(
      "https://hacker-news.firebaseio.com/v0/topstories.json",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!idsResponse.ok) throw new Error(`Hacker News IDs: ${idsResponse.status}`);
    const ids = (await idsResponse.json()).slice(0, 8);
    const stories = await Promise.all(
      ids.map(async (id) => {
        const response = await fetch(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
          { signal: AbortSignal.timeout(8000) }
        );
        return response.ok ? response.json() : undefined;
      })
    );
    addSources(
      "T",
      stories
        .filter((story) => story?.title)
        .map((story) => ({
          title: story.title,
          url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
          source: "Hacker News"
        }))
    );
  })();

  const aiNewsTask = (async () => {
    const query = encodeURIComponent("生成AI OR 人工知能 OR AIモデル");
    const response = await fetch(
      `https://news.google.com/rss/search?q=${query}&hl=ja&gl=JP&ceid=JP:ja`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) throw new Error(`Google AI News RSS: ${response.status}`);
    const xml = await response.text();
    addSources("A", parseRssItems(xml, 15));
  })();

  const lifestyleNewsTask = (async () => {
    const query = encodeURIComponent("ライフハック OR 生活の知恵 OR 家事 時短 OR 整理術 OR 収納");
    const response = await fetch(
      `https://news.google.com/rss/search?q=${query}&hl=ja&gl=JP&ceid=JP:ja`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) throw new Error(`Google Lifestyle News RSS: ${response.status}`);
    const xml = await response.text();
    addSources("L", parseRssItems(xml, 12));
  })();

  const results = await Promise.allSettled([
    googleNewsTask,
    hackerNewsTask,
    aiNewsTask,
    lifestyleNewsTask
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Latest topic fetch failed:", result.reason);
    }
  }

  latestTopicSources = new Map(sourceItems.map((item) => [item.id, item]));

  const promptText = [
    aiNews.length ? `AI関連の最新見出し:\n${aiNews.join("\n")}` : "",
    lifestyleNews.length ? `生活ハック・暮らしの見出し:\n${lifestyleNews.join("\n")}` : "",
    generalNews.length ? `日本の最新見出し:\n${generalNews.join("\n")}` : "",
    techNews.length ? `技術コミュニティの最新見出し:\n${techNews.join("\n")}` : ""
  ].filter(Boolean).join("\n\n");

  return { promptText, sources: latestTopicSources };
}

async function generateIdleLines() {
  if (idleLineGeneration) return idleLineGeneration;
  idleLineGeneration = (async () => {
    const now = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      dateStyle: "full",
      timeStyle: "short"
    }).format(new Date());
    const latestTopics = await fetchLatestTopics();
    const latestTopicText = latestTopics.promptText;
    const characterSheet = readCharacterSheet();
    const prompt = [
      "あなたはデスクトップに住むAIコンシェルジュ「びくたん」です。",
      "以下のキャラクターシートを一貫して演じてください。例文のコピーではなく、性格・価値観・口調を新しい発言に反映してください。",
      `<character_sheet>\n${characterSheet}\n</character_sheet>`,
      `現在の日本時間は ${now} です。`,
      "ユーザーが作業中に、たまに話すセリフを20個作ってください。",
      "通常のセリフは10〜35文字、情報共有系は50〜120文字の自然な日本語にしてください。各セリフは改行せず、一行に一つだけ出力してください。",
      "出力形式は必ず `種別|参照ID|セリフ` にしてください。通常セリフは `normal||セリフ`、ニュース系は `news|A3|セリフ`、生活ハック系は `life|L3|セリフ` のように、元にした見出しのIDを1〜2個入れてください。",
      "番号、箇条書き記号、引用符、説明は付けないでください。",
      "自己紹介や『AIナビです』は禁止です。",
      "気の合う作業仲間のような、具体的でくだけた口調にしてください。",
      "時間帯、休憩、保存確認、創作やPC作業、日常の小ネタ、軽いユーモアを混ぜてください。",
      "ポエム、格言、抽象的な励まし、悟った言い回し、仏教・スピリチュアル調は禁止です。",
      latestTopicText
        ? "20個のうち5個はAI関連ニュース、3個は生活ハック・暮らしの小ネタ、2個はその他の時事・技術ネタにしてください。残りは日常や制作の短いセリフにしてください。"
        : "",
      latestTopicText
        ? "ニュース系・生活ハック系は情報共有として少し長めに、見出しから分かる出来事やコツと、創作やPC作業の相棒として気になる点を一つ話してください。"
        : "",
      latestTopicText
        ? "生活ハック系は、机まわり、整理、家事時短、休憩、作業環境、買い物前の確認など、すぐ試せる軽い内容にしてください。医療・治療・サプリ・危険な掃除方法・不安を煽る健康話は避けてください。"
        : "",
      latestTopicText
        ? "見出しだけで分からない詳細は補わず、推測は『〜かもしれません』と明示してください。ニュース媒体名は自然に入れられる場合だけ添えてください。"
        : "",
      latestTopicText
        ? "事故、災害、戦争、犯罪、訃報、政争、健康不安など、デスクトップで突然話すのに重い話題は使わないでください。"
        : "",
      "ユーザーを監視しているような発言、説教、同じ言い回しの反復は避けてください。",
      "ファイルや外部情報は調べず、この依頼と下記見出しだけに答えてください。",
      latestTopicText ? `参考にする最新見出し:\n${latestTopicText}` : ""
    ].join("\n");
    try {
      const response = await runCodex(prompt);
      const lines = response
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*(?:[-*・]|\d+[.)、])\s*/, "").trim())
        .map((line) => line.replace(/^["「]|["」]$/g, ""))
        .map((line) => {
          const parts = line.split("|").map((part) => part.trim());
          if (parts.length >= 3 && /^(?:normal|news|life)$/i.test(parts[0])) {
            const text = parts.slice(2).join("|").trim();
            const sourceIds = parts[1]
              .split(",")
              .map((id) => id.replace(/[\[\]]/g, "").trim())
              .filter(Boolean)
              .slice(0, 2);
            const kind = parts[0].toLowerCase();
            const sources = ["news", "life"].includes(kind)
              ? sourceIds
                .map((id) => latestTopics.sources.get(id))
                .filter(Boolean)
                .map((source) => ({
                  title: source.title,
                  url: source.url,
                  source: source.source
                }))
              : [];
            return { text, sources };
          }
          return { text: line, sources: [] };
        })
        .filter((item) => item.text.length >= 4 && item.text.length <= 160);
      if (lines.length < 5) throw new Error("セリフの生成数が不足しました");
      const queuedLines = [...lines];
      if (fortuneAutoEnabled) {
        const fortune = makeDailyFortune();
        const fortuneLines = (fortune.lines || [fortune.text]).map((text) => ({
          text,
          sources: []
        }));
        queuedLines.splice(Math.min(queuedLines.length, 2), 0, ...fortuneLines);
      }
      idleLineQueue.push(...queuedLines.slice(0, 20));
    } catch (error) {
      console.error("Idle line generation failed:", error);
      idleLineQueue.push(...FALLBACK_IDLE_LINES);
    } finally {
      idleLineGeneration = undefined;
    }
  })();
  return idleLineGeneration;
}

ipcMain.handle("companion:chat", async (_event, rawMessage) => {
  const message = String(rawMessage ?? "").trim().slice(0, 4000);
  if (!message) return { text: "何でも話しかけてください。", sources: [] };

  const wantsClipboard = /クリップボード|コピーした|コピーしている/.test(message);
  const clipboardText = wantsClipboard ? clipboard.readText().trim().slice(0, 12000) : "";
  let latestTopics = { promptText: "", sources: new Map() };
  if (shouldAttachLatestTopics(message)) {
    try {
      latestTopics = await fetchLatestTopics();
    } catch (error) {
      console.error("Chat topic fetch failed:", error);
    }
  }
  const history = conversationHistory
    .slice(-6)
    .map((turn) => `${turn.role === "user" ? "ユーザー" : "びくたん"}: ${turn.text}`)
    .join("\n");
  const characterSheet = readCharacterSheet();
  const prompt = [
    "あなたはデスクトップ常駐AIコンシェルジュ「びくたん」です。",
    "以下のキャラクターシートを一貫して演じてください。例文をそのまま繰り返さず、性格・価値観・口調として反映してください。",
    `<character_sheet>\n${characterSheet}\n</character_sheet>`,
    "キャラクター性を保ちながら、結論から簡潔に答えてください。",
    "吹き出し表示のため、回答は原則180文字以内にしてください。",
    "出力は必ずJSONだけにしてください。形式は {\"answer\":\"吹き出しに出す回答\",\"sourceIds\":[\"A1\"],\"sources\":[{\"title\":\"ページ名\",\"url\":\"https://...\",\"source\":\"サイト名\"}]} です。",
    "本文 answer にはURLを直接書かず、URLは sourceIds または sources に入れてください。使った情報源がなければ sourceIds と sources は空配列にしてください。",
    latestTopics.promptText
      ? "下の最新見出しを使った場合は、元にした見出しIDを sourceIds に入れてください。見出しだけで分からない詳細は補わず、推測は推測と分かるようにしてください。"
      : "外部情報を断定するときは、実在すると確信できる公式ページや記事URLだけ sources に入れてください。URLの推測は禁止です。",
    "通常は会話だけを行い、ユーザーがBrain内の検索を明示した場合だけファイルを参照してください。",
    "この実行は読み取り専用です。変更依頼には、実行せず内容と確認事項を返してください。",
    "プロジェクトのAGENTS.mdとプライバシー範囲を必ず守ってください。",
    history ? `直近の会話:\n${history}` : "",
    latestTopics.promptText ? `参考にできる最新見出し:\n${latestTopics.promptText}` : "",
    clipboardText ? `現在のクリップボード:\n${clipboardText}` : "",
    `ユーザー: ${message}`,
    "びくたんJSON:"
  ].filter(Boolean).join("\n\n");

  const rawResponse = await runCodex(prompt);
  const response = parseChatResponse(rawResponse, latestTopics.sources);
  conversationHistory.push(
    { role: "user", text: message },
    { role: "assistant", text: response.text }
  );
  if (conversationHistory.length > 12) conversationHistory.splice(0, 2);
  return response;
});

ipcMain.handle("companion:prepare-idle-lines", async () => {
  if (idleLineQueue.length < 5) await generateIdleLines();
  return idleLineQueue.length;
});

ipcMain.handle("companion:idle-line", async () => {
  if (!idleLineQueue.length) await generateIdleLines();
  const line = idleLineQueue.shift() ?? FALLBACK_IDLE_LINES[0];
  if (idleLineQueue.length < 5) generateIdleLines().catch(() => {});
  return line;
});

ipcMain.handle("companion:speak", (_event, text, kind = "answer") => {
  return speakText(text, kind);
});

ipcMain.handle("companion:music-playing", () => musicPlaying);

ipcMain.handle("companion:system-sleeping", () => systemSleeping);

ipcMain.handle("companion:pomodoro-state", () => getPomodoroSnapshot("sync"));

ipcMain.handle("companion:pomodoro-action", (_event, action) => {
  if (action === "pause") pausePomodoro();
  else if (action === "resume") resumePomodoro();
  else if (action === "stop") stopPomodoro();
  return getPomodoroSnapshot("sync");
});

ipcMain.handle("companion:open-url", async (_event, rawUrl) => {
  const url = String(rawUrl ?? "");
  if (!/^https?:\/\//.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.on("companion:stop-speech", () => {
  stopSpeech();
});

app.on("before-quit", () => {
  clearPomodoroTimer();
  clearInterval(mediaPlaybackTimer);
  stopSpeech();
  if (voicevoxOwned) voicevoxProcess?.kill("SIGTERM");
});

app.on("window-all-closed", () => {
  // Keep the menu-bar companion alive on macOS.
  if (process.platform !== "darwin") app.quit();
});
