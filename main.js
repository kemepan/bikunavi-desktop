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
  powerMonitor,
  session,
  protocol,
  net,
  globalShortcut,
  dialog
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const conversation = require("./conversation-providers");
const {
  isSafeIdleUserNameUsage,
  repairBikutanSelfReferences,
  restoreLegacyUserVocatives
} = require("./identity-utils");
const {
  isIdleCapabilitySafeLine,
  sanitizeCapabilityResponse
} = require("./capability-utils");
const {
  parseGeneratedIdleLine,
  sanitizeSpokenSourceIds
} = require("./source-utils");
const { selectChatEmote } = require("./emote-utils");
const { splitIntoSpeechChunks } = require("./speech-utils");

const CAPABILITY_BOUNDARY_PROMPT = [
  "能力の境界を厳守してください。びくたんに体や手はなく、飲み物を淹れる、物を運ぶ、掃除する、買い物するなど現実の作業はできません。",
  "ユーザーの画面、手元、部屋、机、表情、周囲の音・匂い・味は分かりません。見聞きしたふりをしないでください。",
  "Mac、アプリ、ファイル、メール、予約・注文サービスを操作できません。実行していない保存・送信・予約・購入などを『しました』『しておきます』と言わないでください。",
  "受け取れるのは、この依頼へ明示的に含まれた会話、アプリ内の記憶、最新見出し、必要な場合のクリップボードだけです。ファイルや外部情報を自分で見た・調べたとは言わないでください。",
  "できないことを申し出ず、実際にできる会話へ言い換えてください。例: 『コーヒーを淹れましょうか？』ではなく『コーヒー休憩にしますか？』。"
].join("\n");

// ポモドーロ通知はトレイメニューやタイマーから鳴るため、ユーザー操作直後でなくても
// RendererのWeb Audioを再生できるようにする。
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// 配布版と開発版が同じ state.json を同時に書かないよう、開発起動時だけ
// userData を分離する。配布した .app は環境変数なしで従来の保存先を使う。
const dataChannel = process.env.BIKUNAVI_DATA_CHANNEL === "dev" ? "dev" : "release";
if (dataChannel === "dev") {
  app.setPath("userData", path.join(app.getPath("appData"), "bikunavi-desktop-dev"));
}

// file:// を webSecurity 無効で読む代わりに、アプリ内ファイル専用の
// 特権スキームで index.html と Live2D 素材を配信する。
const APP_SCHEME = "bikunavi";
const CHAT_SHORTCUT = "CommandOrControl+Shift+B";
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

const DEFAULT_STATE = {
  size: "small",
  position: undefined,
  alwaysOnTop: true,
  speechEnabled: true,
  idleSpeechEnabled: true,
  speechRate: 190,
  speechVolume: 100,
  soundMuted: false,
  thinkingSoundEnabled: true,
  fortuneAutoEnabled: true,
  autoMoveEnabled: true,
  musicReactEnabled: true,
  idleIntervalMs: 30000,
  lineHistory: [],
  chatEntries: [],
  conversationHistory: [],
  characterAnswers: {},
  pendingCharacterQuestionId: undefined,
  lastCharacterQuestionAt: 0,
  lastAutoQuestionAt: 0,
  deferredCharacterQuestionIds: {},
  skippedCharacterQuestionIds: [],
  learnedWords: [],
  sharedMemories: [],
  bikutanGrowthAnswers: {},
  pendingGrowthQuestion: undefined,
  lastGrowthQuestionAt: 0,
  growthQuestionTurn: 0,
  fortuneThemes: [],
  pendingFortuneQuestion: undefined,
  lastFortuneQuestionAt: 0,
  dailyDiaries: [],
  savedLinks: [],
  conversationProvider: "auto",
  anthropicApiKey: "",
  voicevoxGuideShown: false,
  trayGuideShown: false
};
const stateFilePath = path.join(app.getPath("userData"), "state.json");

function loadPersistedState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFilePath, "utf8"));
    try {
      fs.chmodSync(stateFilePath, 0o600);
    } catch (error) {
      console.warn("State permission update failed:", error);
    }
    return { ...DEFAULT_STATE, ...parsed };
  } catch (_error) {
    return { ...DEFAULT_STATE };
  }
}

const persistedState = loadPersistedState();
const persistedPreferredUserName = String(
  persistedState.characterAnswers?.user_address?.answer || ""
).trim();
const needsLegacyUserVocativeRepair =
  persistedPreferredUserName === "びくにたん" &&
  !persistedState.legacyUserVocativeRepairV2;
persistedState.lineHistory = (Array.isArray(persistedState.lineHistory)
  ? persistedState.lineHistory
  : []).map((entry) => ({
  ...entry,
  text: repairBikutanSelfReferences(sanitizeSpokenSourceIds(entry?.text), "")
}));
persistedState.chatEntries = (Array.isArray(persistedState.chatEntries)
  ? persistedState.chatEntries
  : []).map((entry) => ({
  ...entry,
  answer: needsLegacyUserVocativeRepair
    ? restoreLegacyUserVocatives(sanitizeSpokenSourceIds(entry?.answer), persistedPreferredUserName)
    : repairBikutanSelfReferences(sanitizeSpokenSourceIds(entry?.answer), "")
}));
if (needsLegacyUserVocativeRepair) persistedState.legacyUserVocativeRepairV2 = Date.now();
let stateSaveTimer;

function collectState() {
  persistedState.size = currentSize;
  persistedState.alwaysOnTop = companionWindow?.isAlwaysOnTop() ?? persistedState.alwaysOnTop;
  persistedState.speechEnabled = speechEnabled;
  persistedState.idleSpeechEnabled = idleSpeechEnabled;
  persistedState.speechRate = speechRate;
  persistedState.speechVolume = speechVolume;
  persistedState.soundMuted = soundMuted;
  persistedState.thinkingSoundEnabled = thinkingSoundEnabled;
  persistedState.fortuneAutoEnabled = fortuneAutoEnabled;
  persistedState.autoMoveEnabled = autoMoveEnabled;
  persistedState.musicReactEnabled = musicReactEnabled;
  persistedState.idleIntervalMs = idleIntervalMs;
  persistedState.conversationProvider = conversationProvider;
  persistedState.anthropicApiKey = anthropicApiKey;
  persistedState.conversationHistory = conversationHistory.slice(-12);
  if (companionWindow) persistedState.position = companionWindow.getPosition();
}

function saveStateNow() {
  clearTimeout(stateSaveTimer);
  stateSaveTimer = undefined;
  collectState();
  try {
    fs.writeFileSync(stateFilePath, JSON.stringify(persistedState, null, 2), { mode: 0o600 });
    fs.chmodSync(stateFilePath, 0o600);
  } catch (error) {
    console.error("State save failed:", error);
  }
}

function saveStateSoon() {
  clearTimeout(stateSaveTimer);
  stateSaveTimer = setTimeout(saveStateNow, 800);
}

let companionWindow;
let tray;
let dragOrigin;
let cursorTimer;
let autoMoveTimer;
let currentSize = ["tiny", "small", "medium", "large"].includes(persistedState.size)
  ? persistedState.size
  : "small";
let characterHovered = false;
let speechEnabled = Boolean(persistedState.speechEnabled);
let idleSpeechEnabled = Boolean(persistedState.idleSpeechEnabled);
let speechRate = [150, 190, 230].includes(persistedState.speechRate)
  ? persistedState.speechRate
  : 190;
let speechVolume = [25, 50, 75, 100].includes(persistedState.speechVolume)
  ? persistedState.speechVolume
  : 100;
let soundMuted = Boolean(persistedState.soundMuted);
let thinkingSoundEnabled = persistedState.thinkingSoundEnabled !== false;
let autoMoveEnabled = Boolean(persistedState.autoMoveEnabled);
let musicReactEnabled = Boolean(persistedState.musicReactEnabled);
let idleIntervalMs = [30000, 60000, 120000].includes(persistedState.idleIntervalMs)
  ? persistedState.idleIntervalMs
  : 30000;
let conversationProvider = ["auto", "codex", "claude-cli", "gemini-api", "gemini-cli", "claude-api"]
  .includes(persistedState.conversationProvider)
  ? persistedState.conversationProvider
  : "auto";
let anthropicApiKey = typeof persistedState.anthropicApiKey === "string"
  ? persistedState.anthropicApiKey
  : "";
let speechProvider = "voicevox";
const voicevoxSpeaker = 58;
const voicevoxVoiceLabel = "猫使ビィ";
let speechProcess;
let speechSequence = 0;
let activeSpeechId;
let speechFile;
const speechWaiters = new Map();
let lastTopDocked;
let voicevoxProcess;
let voicevoxOwned = false;
let voicevoxReadyPromise;
const conversationHistory = Array.isArray(persistedState.conversationHistory)
  ? persistedState.conversationHistory
      .filter((turn) => turn && typeof turn.text === "string" && ["user", "assistant"].includes(turn.role))
      .slice(-12)
  : [];
const idleLineQueue = [];
let idleLineGeneration;
// 直近に話した自動セリフを覚えておき、しばらくは繰り返さない。
const RECENT_IDLE_LIMIT = 60;
const recentIdleItems = [];
let fallbackIdleIndex = 0;
let lastFortuneQueuedDate;
let latestTopicSources = new Map();
const BIKUTAN_WORK_INTERVAL_MS = 8 * 60 * 1000;
let lastBikutanWorkLineAt = 0;
let bikutanWorkLineIndex = 0;

function idleKey(item) {
  const text = typeof item === "string" ? item : item?.text ?? "";
  return text.replace(/\s+/g, "").replace(/[。、!！?？…・]/g, "");
}

function idleSourceUrls(item) {
  if (!item || typeof item === "string" || !Array.isArray(item.sources)) return [];
  return item.sources
    .map((source) => String(source?.url || "").trim())
    .filter(Boolean);
}

function bigrams(text) {
  const chars = [...idleKey(text)];
  if (chars.length < 2) return new Set(chars);
  return new Set(chars.slice(0, -1).map((char, index) => char + chars[index + 1]));
}

function idleSimilarity(left, right) {
  const leftKey = idleKey(left);
  const rightKey = idleKey(right);
  if (!leftKey || !rightKey) return 0;
  if (leftKey === rightKey) return 1;
  if (Math.min(leftKey.length, rightKey.length) >= 10 &&
      (leftKey.includes(rightKey) || rightKey.includes(leftKey))) return 0.9;
  const leftPairs = bigrams(leftKey);
  const rightPairs = bigrams(rightKey);
  if (!leftPairs.size || !rightPairs.size) return 0;
  let shared = 0;
  for (const pair of leftPairs) {
    if (rightPairs.has(pair)) shared += 1;
  }
  return (2 * shared) / (leftPairs.size + rightPairs.size);
}

function isRecentIdle(item) {
  const urls = new Set(idleSourceUrls(item));
  return recentIdleItems.some((recent) => {
    if (urls.size && recent.urls.some((url) => urls.has(url))) return true;
    return idleSimilarity(item, recent.text) >= 0.68;
  });
}

function rememberRecentIdle(item) {
  const key = idleKey(item);
  if (!key) return;
  recentIdleItems.push({
    text: typeof item === "string" ? item : String(item.text || ""),
    urls: idleSourceUrls(item)
  });
  while (recentIdleItems.length > RECENT_IDLE_LIMIT) recentIdleItems.shift();
}

// 再起動後も直前の話題を忘れないよう、保存済みの表示履歴から復元する。
for (const entry of (Array.isArray(persistedState.lineHistory) ? persistedState.lineHistory : []).slice(-RECENT_IDLE_LIMIT)) {
  rememberRecentIdle(entry);
}

function pickFallbackIdleLine() {
  for (let attempt = 0; attempt < FALLBACK_IDLE_LINES.length; attempt += 1) {
    const candidate = FALLBACK_IDLE_LINES[fallbackIdleIndex % FALLBACK_IDLE_LINES.length];
    fallbackIdleIndex += 1;
    if (!isRecentIdle(candidate)) return candidate;
  }
  return FALLBACK_IDLE_LINES[fallbackIdleIndex++ % FALLBACK_IDLE_LINES.length];
}

// 直近に話した「びくたんの作業メモ」。会話で「何してるの？」と聞かれた時に
// 矛盾しない答えを返せるよう、チャットのプロンプトにも渡す。
let currentBikutanActivity;

function makeBikutanWorkLine(force = false) {
  const now = Date.now();
  if (!force && now - lastBikutanWorkLineAt < BIKUTAN_WORK_INTERVAL_MS) return undefined;
  const { learnedWords, sharedMemories, growthAnswers } = getGrowthData();
  const topicCount = latestTopicSources instanceof Map ? latestTopicSources.size : 0;
  const musicPreference = getMusicGenrePreference();
  const candidateLines = [
    "今日の予定を少し整えています。",
    "ことば帳を読み返しています。",
    "フォントの用語をひとつ覚え直しています。",
    "音楽ジャンルの名前を少し覚えています。",
    "Live2Dまわりの用語をノートにしています。",
    "気になったことを、少しだけ勉強しています。",
    "気になる見出しを、あとで読めるように分けています。",
    "フードの向きを、ちょっと直しています。",
    "びくたん用の引き出しに、気になることをしまっています。",
    "いま少しだけ、聞いてみたいことを考えています。",
    "相棒メモを更新しています。",
    learnedWords.length
      ? `教えてもらった言葉を${learnedWords.length}個、ことば帳で整理しています。`
      : "ことば帳に新しいページを用意しています。",
    sharedMemories.length
      ? `思い出帳を${sharedMemories.length}件分、読み返しています。`
      : "思い出帳に、今日の余白を作っています。",
    musicPreference
      ? `教えてもらった音楽の好み（${musicPreference.slice(0, 24)}）を、ちゃんと覚えています。`
      : "好きな音楽の話も、いつか聞いてみたいです。",
    Object.keys(growthAnswers).length
      ? "この前話した好みを、びくたんの中で少し育てています。"
      : "びくたん自身の好きなものも、少しずつ学んでいます。",
    topicCount
      ? `気になる見出しを${topicCount}枚くらい、読み返しています。`
      : "今日は気になったことを少しメモしています。"
  ];
  for (let attempt = 0; attempt < candidateLines.length; attempt += 1) {
    const text = candidateLines[bikutanWorkLineIndex % candidateLines.length];
    bikutanWorkLineIndex += 1;
    const item = { text, sources: [], kind: "bikutan-work" };
    if (force || !isRecentIdle(item)) {
      lastBikutanWorkLineAt = now;
      currentBikutanActivity = text;
      rememberRecentIdle(item);
      return item;
    }
  }
  return undefined;
}

// キューから、最近話していない行を優先して取り出す。
// 新鮮な行がなければ、溜まった既出行を1つ捨てて予備の一言を返す（既出は返さない）。
function takeFreshIdleLine() {
  for (let index = 0; index < idleLineQueue.length; index += 1) {
    if (!isRecentIdle(idleLineQueue[index])) {
      const [line] = idleLineQueue.splice(index, 1);
      rememberRecentIdle(line);
      return line;
    }
  }
  if (idleLineQueue.length) idleLineQueue.shift();
  const line = pickFallbackIdleLine();
  rememberRecentIdle(line);
  return line;
}
const characterSheetPath = path.join(__dirname, "CHARACTER_SHEET.md");
const characterQuestionsPath = path.join(__dirname, "CHARACTER_QUESTIONS.json");
const growthQuestionsPath = path.join(__dirname, "BIKUTAN_GROWTH_QUESTIONS.json");
const MUSIC_GENRE_QUESTION_ID = "music_genre_preference";
const CHARACTER_QUESTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const GROWTH_QUESTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FORTUNE_QUESTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTO_QUESTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFERRED_CHARACTER_QUESTION_RETRY_MS = 3 * 24 * 60 * 60 * 1000;
const characterQuestionAutoEligibleAt = Date.now() + 15 * 60 * 1000;
const growthQuestionAutoEligibleAt = Date.now() + 30 * 60 * 1000;
const fortuneQuestionAutoEligibleAt = Date.now() + 60 * 60 * 1000;
const characterQuestions = loadCharacterQuestions();
const growthQuestions = loadGrowthQuestions();
const nowPlayingHelperPath = path.join(__dirname, "native", "now-playing");
const sttBinaryDirectory = path.join(__dirname, "native", "stt", `${process.platform}-${process.arch}`);
const sttDefaultModelPath = path.join(__dirname, "models", "ggml-base.bin");
let mediaPlaybackTimer;
let mediaPlaybackCheckRunning = false;
let musicPlaying = false;
let systemSleeping = false;
let pomodoroPausedBySystem = false;
let fortuneAutoEnabled = Boolean(persistedState.fortuneAutoEnabled);
let pomodoroTimer;
let pomodoroChimeProcess;
let thinkingSoundProcess;
let thinkingSoundRequested = false;
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

// びくたんは画面や作業内容を見られない。見たフリの観察は入れず、自分の独り言に留める。
const FALLBACK_IDLE_LINES = [
  "コーヒー休憩、そろそろどうですか？",
  "Live2Dの物理、盛るとつい元気になりすぎるんですよね。",
  "変な思いつきほど、あとで化けたりするんですよね。",
  "名前づけって、未来の自分への手紙だと思うんです。",
  "今何してますか？びくたんは気になる言葉を思い出していました。",
  "びくたん、ちょっとひと息入れてもいいですか？",
  "そろそろ何か飲みたい気分になってきました。",
  "リギング、うまくハマると気持ちいいんですよね。",
  "小さい自動化、地味だけど好きなんです。",
  "今日は何を動かす日ですか？ キャラでも作業でも。",
  "ふう、たまには伸びのひとつでも。"
];

const SIZE_PRESETS = {
  tiny: { label: "極小", width: 240, height: 455 },
  small: { label: "小", width: 290, height: 513 },
  medium: { label: "中", width: 350, height: 598 },
  large: { label: "大", width: 430, height: 718 }
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
// 五行を、干支のような専門用語ではなく「その日の気分の色」として平易に言い換える。
// bgm は具体的な曲名ではなく雰囲気・ジャンルで薦める（実在を確認できない曲名は出さない）。
const FORTUNE_ELEMENTS = {
  木: {
    mood: "すくすく伸びる",
    color: "みどり",
    bgm: ["軽やかなアコースティックギター", "朝に合うやさしいフォーク", "爽やかなボサノヴァ"]
  },
  火: {
    mood: "ぱっと明るい",
    color: "あかね",
    bgm: ["テンション上がるアップテンポなポップ", "明るいシティポップ", "元気の出るファンク"]
  },
  土: {
    mood: "どっしり落ち着く",
    color: "つちいろ",
    bgm: ["落ち着いたローファイ・ヒップホップ", "ゆったりしたジャズ", "低音の心地よいチルアウト"]
  },
  金: {
    mood: "きゅっと締まる",
    color: "きんいろ",
    bgm: ["集中用のミニマルなピアノ", "研ぎ澄ますようなアンビエント・テクノ", "静かなクラシック"]
  },
  水: {
    mood: "すっと流れる",
    color: "みずいろ",
    bgm: ["さらさら流れるアンビエント", "静かな作業用のチル", "雨音まじりのローファイ"]
  }
};
// 整理・休息・遊び/創作・外や人、の4系統を混ぜて「毎日片付けを勧める説教bot」化を防ぐ。
// 文末は辞書形の動詞で統一する（「〜のがおすすめです」に接続するため）。
const FORTUNE_ACTIONS = [
  "机の上をひと区画だけ空ける",
  "大きい作業を三つに割る",
  "今日やらないことを一つ決める",
  "飲み物を淹れて、ひと口目だけゆっくり味わう",
  "肩を回して、深呼吸を三回する",
  "5分だけ目を閉じるか、窓の外の遠くを見る",
  "気になっていた曲を一曲だけ流す",
  "落書きや素振りみたいな肩慣らしを5分だけする",
  "作りかけを眺めて、いいところを一つ見つける",
  "散歩がてら、外の空気を1分だけ吸う",
  "最近のお気に入りを、びくたんか誰かに自慢する",
  "5分だけ手を動かして、勢いをつける"
];
const FORTUNE_ITEMS = [
  "あたたかい飲み物",
  "ふせん一枚",
  "小さなメモ帳",
  "いつものペン",
  "きれいなマグカップ",
  "お気に入りの曲",
  "イヤホン",
  "ハンドクリーム",
  "窓からの光",
  "一口サイズのおやつ"
];
const FORTUNE_CLOSINGS = [
  "びくたんは、まず小さく動く日に一票です。",
  "うまくやるより、ちょっと楽になる方を選びましょう。",
  "全部できなくても、この一手ができたら十分えらいです。",
  "気分が乗るまで待たず、ここから始めるのが今日のコツです。",
  "びくたんも隣で、そっと応援係をしますね。"
];

const traySvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
  <path fill="black" d="M8 5C5 2 2 3 1 1c4-1 7 0 8 3 1-3 4-4 8-3-1 2-4 1-7 4v2h3c2 0 3 1 3 3v5c0 2-1 3-3 3H5c-2 0-3-1-3-3v-5c0-2 1-3 3-3h3V5Zm-3 5v5h8v-5H5Z"/>
</svg>`;

function restoreWindowPosition(width, height) {
  const fallbackArea = screen.getPrimaryDisplay().workArea;
  const fallback = {
    x: fallbackArea.x + fallbackArea.width - width - 24,
    y: fallbackArea.y + fallbackArea.height - height - 24
  };
  const saved = persistedState.position;
  if (!Array.isArray(saved) || saved.length !== 2) return fallback;
  const [savedX, savedY] = saved.map(Number);
  if (!Number.isFinite(savedX) || !Number.isFinite(savedY)) return fallback;
  const area = screen.getDisplayMatching({ x: savedX, y: savedY, width, height }).workArea;
  return {
    x: Math.max(area.x, Math.min(savedX, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(savedY, area.y + area.height - height))
  };
}

function createWindow() {
  const { width, height } = SIZE_PRESETS[currentSize];
  const { x, y } = restoreWindowPosition(width, height);

  companionWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: persistedState.alwaysOnTop !== false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  companionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  companionWindow.webContents.on("console-message", (event) => {
    const isError = event.level === "error" || event.level === "warning";
    const logger = isError ? console.error : console.log;
    logger(`[renderer] ${event.message}`);
  });
  companionWindow.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`Renderer load failed (${code}): ${description}`);
  });
  companionWindow.on("move", sendWindowEdgeState);
  companionWindow.on("moved", () => {
    sendWindowEdgeState();
    saveStateSoon();
  });
  companionWindow.loadURL(`${APP_SCHEME}://app/index.html`);
  companionWindow.webContents.on("did-finish-load", () => {
    lastTopDocked = undefined;
    sendWindowEdgeState();
  });
  companionWindow.once("ready-to-show", () => {
    if (companionWindow && !companionWindow.isDestroyed()) companionWindow.showInactive();
  });
  // macOSの透明・フレームレス窓では ready-to-show が発火しないことがあり、
  // その場合ウィンドウが永久に不可視のままになるため、時間で強制表示する。
  const showFallbackTimer = setTimeout(() => {
    if (companionWindow && !companionWindow.isDestroyed() && !companionWindow.isVisible()) {
      console.log("ready-to-show did not fire; showing window via fallback");
      companionWindow.showInactive();
    }
    tray?.setContextMenu(buildTrayMenu());
  }, 1500);
  companionWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process gone:", details?.reason);
    if (details?.reason !== "clean-exit") {
      companionWindow?.destroy();
      companionWindow = undefined;
      createWindow();
    }
  });
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
    console.log("Companion window closed");
    clearTimeout(showFallbackTimer);
    clearInterval(cursorTimer);
    companionWindow = undefined;
  });
}

function sendWindowEdgeState() {
  if (!companionWindow || companionWindow.isDestroyed()) return;
  const bounds = companionWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  // macOSではBrowserWindowのy座標がメニューバー高（概ね20〜40px）で
  // 強制的に止まる。副画面のworkArea.yが0でも上端到達を検出できる幅を持たせる。
  const topDocked = bounds.y <= area.y + 42;
  if (topDocked === lastTopDocked) return;
  lastTopDocked = topDocked;
  companionWindow.webContents.send("companion:window-edge", { topDocked });
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
  saveStateSoon();
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

// 会話・自動セリフに「今がいつか」の感覚を与えるための時間帯情報。
// 時刻の実況には使わず、話題選び（昼寝は昼だけ等）の前提として渡す。
function getJstTimeContext(date = new Date()) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    hour12: false,
    weekday: "short"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour) % 24;
  const slot = hour < 5 ? "深夜"
    : hour < 8 ? "早朝"
    : hour < 11 ? "朝"
    : hour < 14 ? "昼"
    : hour < 17 ? "午後"
    : hour < 19 ? "夕方"
    : hour < 23 ? "夜"
    : "深夜";
  return { hour, weekday: values.weekday, slot };
}

function getJstDateString(date = new Date()) {
  const { year, month, day } = getJstDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function makeYoutubeSearchSource(query) {
  const safeQuery = String(query || "").trim();
  return {
    title: `${safeQuery} をYouTubeで検索`,
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(safeQuery)}`,
    source: "YouTube検索"
  };
}

function makeDailyFortune(date = new Date()) {
  const { year, month, day } = getJstDateParts(date);
  const dateNumber = year * 10000 + month * 100 + day;
  const stem = FORTUNE_STEMS[dateNumber % FORTUNE_STEMS.length];
  const element = FORTUNE_ELEMENTS[stem.element];
  const action = FORTUNE_ACTIONS[(dateNumber + month) % FORTUNE_ACTIONS.length];
  const item = FORTUNE_ITEMS[(dateNumber + day) % FORTUNE_ITEMS.length];
  const closing = FORTUNE_CLOSINGS[(dateNumber + month + day) % FORTUNE_CLOSINGS.length];
  const bgm = element.bgm[(dateNumber + month + day) % element.bgm.length];
  const lines = [
    `今日のびくたん占いです。テーマは「${stem.keyword}」、ラッキーカラーは${element.color}。視界のどこかに${element.color}をひとつ入れておくと、調子が出やすいですよ。`,
    `今日は${stem.mood}くらいがちょうどよさそう。最初の一手は、${action}のがおすすめです。`,
    `お守りは「${item}」。${closing}`,
    `BGMは${bgm}あたりが合いそうです。よかったらどうぞ。`
  ];
  return {
    text: lines.join("\n"),
    lines,
    lineSources: [[], [], [], [makeYoutubeSearchSource(`${bgm} 作業用 BGM`)]],
    autoText: `今日の占いは「${stem.keyword}」。${action}のと相性がよさそうです。`,
    sources: []
  };
}

function sanitizeFortuneTheme(rawTheme) {
  return String(rawTheme || "")
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 80);
}

function makeThemedFortune(rawTheme, date = new Date()) {
  const theme = sanitizeFortuneTheme(rawTheme) || "今日のこと";
  const { year, month, day } = getJstDateParts(date);
  const themeSeed = [...theme].reduce((sum, char) => sum + char.codePointAt(0), 0);
  const dateNumber = year * 10000 + month * 100 + day + themeSeed;
  const stem = FORTUNE_STEMS[dateNumber % FORTUNE_STEMS.length];
  const element = FORTUNE_ELEMENTS[stem.element];
  const lowerTheme = theme.toLowerCase();
  const psychologicalHints = [
    {
      match: /迷|悩|決|どうしよ|選|不安|心配/,
      label: "迷い",
      action: "選択肢を2つだけ書いて、いま大事にしたい基準をひとつ添える"
    },
    {
      match: /疲|眠|だる|休|しんど|つかれ|無理/,
      label: "疲れ",
      action: "まず体の回復を優先して、5分だけ目と肩を休ませる"
    },
    {
      match: /焦|急|遅|間に合|やば|詰|パニック/,
      label: "焦り",
      action: "次の一手を小さく切って、最初の3分だけ着手する"
    },
    {
      match: /楽|嬉|わく|好き|楽し|うれし|いい感じ/,
      label: "前向き",
      action: "その勢いで、あとから見返せる小さなメモを残す"
    },
    {
      match: /怒|もや|嫌|いや|納得|むか|イラ/,
      label: "もやもや",
      action: "事実・気持ち・お願いを一行ずつ分けて書く"
    },
    {
      match: /集中|作業|仕事|制作|勉強|進め|やる/,
      label: "集中",
      action: "今やることを一文にして、15分だけ範囲を閉じる"
    }
  ];
  const fallbackHints = [
    { label: "整える", action: "気になっていることを一つだけ外に書き出す" },
    { label: "試す", action: "正解探しより、小さな実験として一回やってみる" },
    { label: "ほどく", action: "頭の中の言葉を、箇条書きで三つに分ける" }
  ];
  const matchedHint = psychologicalHints.find((hint) => hint.match.test(lowerTheme));
  const hint = matchedHint || fallbackHints[dateNumber % fallbackHints.length];
  const closing = FORTUNE_CLOSINGS[(dateNumber + themeSeed) % FORTUNE_CLOSINGS.length];
  const lines = [
    `「${theme}」の気分占い、出ました。いまは「${hint.label}」のターンです。`,
    `びくたんの一手は、${hint.action}こと。`,
    `今日は${element.color}の気配。「${stem.keyword}」を少し意識してみましょう。${closing}`
  ];
  return {
    text: lines.join("\n"),
    lines,
    sources: []
  };
}

function getPendingFortuneQuestion() {
  const pending = persistedState.pendingFortuneQuestion;
  if (!pending || typeof pending !== "object") return undefined;
  return pending.id ? pending : undefined;
}

function fortuneQuestionItem(pending) {
  return {
    text: "いまの気分、びくたんに一言だけ教えて？",
    sources: [],
    kind: "custom-question",
    questionId: pending.id,
    answerKind: "fortune",
    choices: ["集中したい", "わくわく", "迷う", "疲れた", "焦る", "もやもや"]
  };
}

function makeFortuneQuestion(force = false) {
  const existing = getPendingFortuneQuestion();
  if (existing) return fortuneQuestionItem(existing);
  const now = Date.now();
  if (!force && (
    now < fortuneQuestionAutoEligibleAt ||
    now - (Number(persistedState.lastFortuneQuestionAt) || 0) < FORTUNE_QUESTION_INTERVAL_MS ||
    !canAskAutomaticQuestion(now)
  )) return undefined;

  const pending = { id: `fortune-${now}` };
  persistedState.pendingFortuneQuestion = pending;
  persistedState.lastFortuneQuestionAt = now;
  if (!force) rememberAutomaticQuestion(now);
  saveStateSoon();
  return fortuneQuestionItem(pending);
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
        sources: Array.isArray(fortune.lineSources?.[index])
          ? fortune.lineSources[index]
          : [],
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

function showFortuneQuestionNow() {
  const item = makeFortuneQuestion(true);
  if (!companionWindow || companionWindow.isDestroyed()) createWindow();
  if (!companionWindow) return;
  companionWindow.show();
  companionWindow.focus();
  companionWindow.webContents.send("companion:custom-question", item);
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

function playPomodoroChime(kind) {
  if (systemSleeping || soundMuted) return;
  const soundPath = path.join(
    __dirname,
    "assets",
    "sounds",
    kind === "finish" ? "pomodoro-finish-bell.mp3" : "pomodoro-start-bell.mp3"
  );
  if (!fs.existsSync(soundPath)) {
    companionWindow?.webContents.send("companion:pomodoro-chime", kind);
    return;
  }

  // Web Audioはタイマー満了時に自動再生を抑止されることがあるため、
  // macOSの再生経路で短い通知音を鳴らす。
  pomodoroChimeProcess?.kill("SIGTERM");
  let fallbackSent = false;
  const useRendererFallback = () => {
    if (fallbackSent) return;
    fallbackSent = true;
    companionWindow?.webContents.send("companion:pomodoro-chime", kind);
  };
  try {
    const child = spawn("/usr/bin/afplay", ["-v", "0.35", soundPath], { stdio: "ignore" });
    pomodoroChimeProcess = child;
    child.on("close", () => {
      if (pomodoroChimeProcess === child) pomodoroChimeProcess = undefined;
    });
    child.on("error", (error) => {
      console.error("Pomodoro native chime failed:", error);
      if (pomodoroChimeProcess === child) pomodoroChimeProcess = undefined;
      useRendererFallback();
    });
  } catch (error) {
    console.error("Pomodoro native chime could not start:", error);
    useRendererFallback();
  }
}

function stopThinkingSound() {
  thinkingSoundRequested = false;
  thinkingSoundIsPreview = false;
  const processToStop = thinkingSoundProcess;
  thinkingSoundProcess = undefined;
  processToStop?.kill("SIGTERM");
}

function startThinkingSound() {
  if (systemSleeping || soundMuted || !thinkingSoundEnabled) return;
  thinkingSoundRequested = true;
  if (thinkingSoundProcess) return;
  const soundPath = path.join(__dirname, "assets", "sounds", "thinking-countdown.mp3");
  if (!fs.existsSync(soundPath)) return;
  const volume = Math.max(0.12, Math.min(0.35, (speechVolume / 100) * 0.6)).toFixed(2);
  try {
    const child = spawn("/usr/bin/afplay", ["-v", volume, soundPath], { stdio: "ignore" });
    thinkingSoundProcess = child;
    child.on("close", () => {
      if (thinkingSoundProcess === child) thinkingSoundProcess = undefined;
      // 1.8秒の短いジングルを、返答が来るまで繰り返す。
      if (thinkingSoundRequested && !systemSleeping && thinkingSoundEnabled) {
        startThinkingSound();
      }
    });
    child.on("error", (error) => {
      console.error("Thinking sound failed:", error);
      if (thinkingSoundProcess === child) thinkingSoundProcess = undefined;
      thinkingSoundRequested = false;
    });
  } catch (error) {
    console.error("Thinking sound could not start:", error);
  }
}

let thinkingSoundIsPreview = false;

function previewThinkingSound() {
  // 実際に考え中なら、その再生を止めずにそのままにする。
  if (thinkingSoundRequested) return;
  thinkingSoundIsPreview = true;
  startThinkingSound();
  setTimeout(() => {
    // 試聴中に本物の会話が始まっていたら（isPreviewが解除されていたら）止めない。
    if (thinkingSoundIsPreview) stopThinkingSound();
    thinkingSoundIsPreview = false;
  }, 5200);
}

function setSoundMuted(muted) {
  soundMuted = Boolean(muted);
  if (soundMuted) {
    pomodoroChimeProcess?.kill("SIGTERM");
    pomodoroChimeProcess = undefined;
    stopThinkingSound();
    stopSpeech();
  }
  companionWindow?.webContents.send("companion:settings-changed", getRendererSettings());
  tray?.setContextMenu(buildTrayMenu());
  saveStateSoon();
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
  playPomodoroChime("finish");

  if (preset?.nextPhase) {
    startPomodoro(preset.nextPhase, {
      reason: preset.nextReason || "autoFocusStarted",
      message: preset.nextMessage,
      chime: false
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
  if (options.chime !== false) playPomodoroChime("start");
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

// ポモドーロ完了時のねぎらい。画面は見えないので、集中に区切りをつけたこと自体を労う。
const POMODORO_FINISH_MESSAGES = [
  "おつかれさまでした！ 一区切りつきましたね。ここまでのがんばり、いい感じです。",
  "ポモドーロ完了です。よく続きました。少し肩の力を抜いてくださいね。",
  "おつかれさまです！ ひと区切りですね。自分をちょっと褒めていい時間です。",
  "完了です。集中の時間、おつかれさまでした。水分とって、ひと息どうぞ。",
  "ここまでよくがんばりました！ ゆっくり深呼吸して、おつかれさまです。"
];

function finishPomodoro() {
  if (!pomodoroState.active) return;
  clearPomodoroTimer();
  playPomodoroChime("finish");
  const message = POMODORO_FINISH_MESSAGES[
    Math.floor(Math.random() * POMODORO_FINISH_MESSAGES.length)
  ];
  pomodoroState = {
    active: false,
    running: false,
    phase: undefined,
    label: "",
    duration: 0,
    remaining: 0,
    startedAt: 0,
    endsAt: 0,
    message
  };
  refreshPomodoroUi("completed");
  speakFromMain(message, "answer").catch((error) => {
    console.error("Pomodoro finish speech failed:", error);
  });
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: "びくたんを表示",
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
      label: "会話欄を開く（⌘⇧B）",
      click: openChatInput
    },
    { type: "separator" },
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
          label: "完了",
          enabled: pomodoroState.active,
          click: finishPomodoro
        },
        { type: "separator" },
        {
          label: "開始ジングルを試す",
          enabled: !soundMuted,
          click: () => playPomodoroChime("start")
        },
        {
          label: "終了ジングルを試す",
          enabled: !soundMuted,
          click: () => playPomodoroChime("finish")
        }
      ]
    },
    {
      label: "びくたん占い",
      submenu: [
        {
          label: "今日の占い",
          click: showDailyFortune
        },
        {
          label: getPendingFortuneQuestion()
            ? "さっきの気分チェックに答える"
            : "気分でミニ占い",
          click: showFortuneQuestionNow
        }
      ]
    },
    {
      label: "🌱 びくたんと育つ",
      submenu: [
        {
          label: `話し方を育てる（${Object.keys(getCharacterAnswers()).length}/${characterQuestions.length}）`,
          submenu: [
            {
              label: getPendingCharacterQuestion()
                ? "さっきの質問に答える"
                : "びくたんから質問してもらう",
              enabled: Boolean(getPendingCharacterQuestion()) ||
                Object.keys(getCharacterAnswers()).length < characterQuestions.length,
              click: showCharacterQuestionNow
            },
            {
              label: "答えを見直す・変更する",
              submenu: (() => {
                const answers = getCharacterAnswers();
                const answeredQuestions = characterQuestions
                  .filter((question) => String(answers[question.id]?.answer || "").trim());
                if (!answeredQuestions.length) {
                  return [{ label: "まだ答えはありません", enabled: false }];
                }
                return answeredQuestions.map((question) => {
                  const answer = String(answers[question.id].answer).replace(/\s+/g, " ").trim();
                  const preview = answer.length > 28 ? `${answer.slice(0, 28)}…` : answer;
                  return {
                    label: `${question.topic}: ${preview}`,
                    click: () => showCharacterQuestionReview(question.id)
                  };
                });
              })()
            },
            {
              label: "回答は会話と自動セリフへ反映されます",
              enabled: false
            }
          ]
        },
        {
          label: `ことば・思い出（${getGrowthData().learnedWords.length}語／${getGrowthData().sharedMemories.length}件）`,
          submenu: [
            {
              label: "ことばを教える",
              click: () => showGrowthQuestionNow("word")
            },
            {
              label: "一緒の思い出を残す",
              click: () => showGrowthQuestionNow("memory")
            },
            {
              label: "びくたんと好みの話をする",
              enabled: Object.keys(getGrowthData().growthAnswers).length < growthQuestions.length,
              click: () => showGrowthQuestionNow("self")
            },
            {
              label: getMusicGenrePreference()
                ? "好きな音楽を更新する"
                : "好きな音楽を教える",
              click: () => showGrowthQuestionNow("music")
            },
            {
              label: "覚えたことは後日の会話で時々思い出します",
              enabled: false
            }
          ]
        }
      ]
    },
    {
      label: "📖 ふたりの記録",
      submenu: [
        {
          label: `日記（${getDailyDiaries().length}日）`,
          submenu: [
            {
              label: "今日の日記をつける",
              click: () => {
                saveTodayDiary().catch((error) => {
                  console.error("Diary save failed:", error);
                  showAmbientLine({
                    text: "日記の保存でつまずきました。少し時間を置いて、もう一度試してください。",
                    sources: []
                  });
                });
              }
            },
            {
              label: "最近の日記を見る",
              enabled: getDailyDiaries().length > 0,
              click: showRecentDiaries
            },
            {
              label: "日記は最大14日分だけ保存します",
              enabled: false
            }
          ]
        },
        {
          label: "最近のおしゃべり",
          click: () => {
            companionWindow?.webContents.send("companion:show-line-history");
          }
        },
        {
          label: `気になる記事（${getSavedLinks().length}件）`,
          submenu: (() => {
            const links = getSavedLinks().slice().reverse();
            if (!links.length) return [{ label: "まだ保存した記事はありません", enabled: false }];
            return links.map((link) => {
              const title = String(link.title || link.source || link.url).replace(/\s+/g, " ").trim();
              const preview = title.length > 42 ? `${title.slice(0, 42)}…` : title;
              return {
                label: preview,
                submenu: [
                  {
                    label: "開く",
                    click: () => shell.openExternal(link.url).catch((error) => {
                      console.error("Saved link open failed:", error);
                    })
                  },
                  {
                    label: "リストから外す",
                    click: () => removeSavedLink(link.url)
                  }
                ]
              };
            });
          })()
        }
      ]
    },
    { type: "separator" },
    {
      label: "設定",
      submenu: [{
      label: `会話AI（${conversation.providerLabel(activeProviderId()) || "未設定"}）`,
      submenu: [
        {
          label: "自動（見つかったAIを使う）",
          type: "radio",
          checked: conversationProvider === "auto",
          click: () => {
            conversationProvider = "auto";
            tray.setContextMenu(buildTrayMenu());
            saveStateSoon();
          }
        },
        ...conversation.detectProviders(conversationConfig()).map((provider) => ({
          label: provider.available ? provider.label : `${provider.label}（未検出）`,
          type: "radio",
          checked: conversationProvider === provider.id,
          enabled: provider.available,
          click: () => {
            conversationProvider = provider.id;
            tray.setContextMenu(buildTrayMenu());
            saveStateSoon();
          }
        })),
        { type: "separator" },
        {
          label: conversation.getGeminiApiKey(conversationConfig())
            ? "Gemini APIキーを変更…"
            : "Gemini APIキーを設定…",
          click: () => openApiKeyWindow("gemini")
        },
        ...(conversation.getGeminiApiKey(conversationConfig())
          ? [{
            label: "Gemini APIキーを削除",
            click: () => {
              writeGeminiApiKey("");
              if (conversationProvider === "gemini-api") conversationProvider = "auto";
              tray.setContextMenu(buildTrayMenu());
              saveStateSoon();
            }
          }]
          : []),
        { type: "separator" },
        {
          label: anthropicApiKey ? "Claude APIキーを変更…" : "Claude APIキーを設定…",
          click: () => openApiKeyWindow("claude")
        },
        ...(anthropicApiKey
          ? [{
            label: "Claude APIキーを削除",
            click: () => {
              anthropicApiKey = "";
              if (conversationProvider === "claude-api") conversationProvider = "auto";
              tray.setContextMenu(buildTrayMenu());
              saveStateSoon();
            }
          }]
          : [])
      ]
    },
    {
      label: "声・読み上げ",
      submenu: [
        {
          label: "すべての音をミュート",
          type: "checkbox",
          checked: soundMuted,
          click: (item) => setSoundMuted(item.checked)
        },
        { type: "separator" },
        {
          label: "読み上げする",
          type: "checkbox",
          checked: speechEnabled,
          click: (item) => {
            speechEnabled = item.checked;
            if (!speechEnabled) stopSpeech();
            tray.setContextMenu(buildTrayMenu());
            saveStateSoon();
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
            saveStateSoon();
          }
        },
        { type: "separator" },
        { label: "読み上げ速度", type: "header" },
        ...[
          { label: "ゆっくり", rate: 150 },
          { label: "標準", rate: 190 },
          { label: "速め", rate: 230 }
        ].map((option) => ({
          label: option.label,
          type: "radio",
          checked: speechRate === option.rate,
          enabled: speechEnabled,
          click: () => {
            speechRate = option.rate;
            tray.setContextMenu(buildTrayMenu());
            saveStateSoon();
          }
        })),
        { type: "separator" },
        { label: "音量", type: "header" },
        ...[25, 50, 75, 100].map((volume) => ({
          label: `${volume}%`,
          type: "radio",
          checked: speechVolume === volume,
          enabled: speechEnabled,
          click: () => {
            speechVolume = volume;
            tray.setContextMenu(buildTrayMenu());
            saveStateSoon();
          }
        })),
        { type: "separator" },
        {
          label: "考え中の効果音",
          type: "checkbox",
          checked: thinkingSoundEnabled,
          click: (item) => {
            thinkingSoundEnabled = item.checked;
            if (!thinkingSoundEnabled) stopThinkingSound();
            tray.setContextMenu(buildTrayMenu());
            saveStateSoon();
          }
        },
        {
          label: "考え中の音を試す",
          enabled: thinkingSoundEnabled,
          click: () => previewThinkingSound()
        },
        { type: "separator" },
        {
          label: "音声テスト",
          enabled: speechEnabled && !soundMuted,
          click: () => {
            speakText("びくたんの音声テストです。聞こえますか？", "answer")
              .catch((error) => console.error("Voice test failed:", error));
          }
        }
      ]
    },
    {
      label: "ふるまい・話しかけ頻度",
      submenu: [
        {
          label: "自動移動",
          type: "checkbox",
          checked: autoMoveEnabled,
          click: (item) => {
            autoMoveEnabled = item.checked;
            if (!autoMoveEnabled) clearInterval(autoMoveTimer);
            tray.setContextMenu(buildTrayMenu());
            saveStateSoon();
          }
        },
        {
          label: "音楽にノる",
          type: "checkbox",
          checked: musicReactEnabled,
          click: (item) => {
            musicReactEnabled = item.checked;
            if (!musicReactEnabled && musicPlaying) {
              musicPlaying = false;
              companionWindow?.webContents.send("companion:music-playing", false);
            }
            tray.setContextMenu(buildTrayMenu());
            saveStateSoon();
          }
        },
        {
          label: "占いを自動セリフに混ぜる",
          type: "checkbox",
          checked: fortuneAutoEnabled,
          click: (item) => {
            fortuneAutoEnabled = item.checked;
            tray.setContextMenu(buildTrayMenu());
            saveStateSoon();
          }
        },
        { type: "separator" },
        { label: "自動セリフの間隔", type: "header" },
        ...[
          { label: "30秒", intervalMs: 30000 },
          { label: "1分", intervalMs: 60000 },
          { label: "2分", intervalMs: 120000 }
        ].map((option) => ({
          label: option.label,
          type: "radio",
          checked: idleIntervalMs === option.intervalMs,
          click: () => {
            idleIntervalMs = option.intervalMs;
            companionWindow?.webContents.send("companion:settings-changed", getRendererSettings());
            tray.setContextMenu(buildTrayMenu());
            saveStateSoon();
          }
        }))
      ]
    },
    {
      label: "表示・サイズ",
      submenu: [
        {
          label: "いつも手前",
          type: "checkbox",
          checked: companionWindow?.isAlwaysOnTop() ?? true,
          click: (item) => {
            companionWindow?.setAlwaysOnTop(item.checked);
            saveStateSoon();
          }
        },
        { type: "separator" },
        { label: "サイズ", type: "header" },
        ...Object.entries(SIZE_PRESETS).map(([name, preset]) => ({
          label: preset.label,
          type: "radio",
          checked: currentSize === name,
          click: () => setCompanionSize(name)
        })),
        { type: "separator" },
        {
          label: "右下へ戻す",
          click: () => {
            if (!companionWindow) return;
            const display = screen.getPrimaryDisplay().workArea;
            const [width, height] = companionWindow.getSize();
            companionWindow.setPosition(
              display.x + display.width - width - 24,
              display.y + display.height - height - 24
            );
            saveStateSoon();
          }
        }
      ]
    },
    {
      label: "データ管理",
      submenu: [
        {
          label: "おしゃべり履歴を消去…",
          click: async () => {
            // 取り消せない消去なので、実行前に必ず確認を挟む
            const { response } = await dialog.showMessageBox({
              type: "warning",
              buttons: ["消去する", "キャンセル"],
              defaultId: 1,
              cancelId: 1,
              message: "おしゃべり履歴を消去しますか？",
              detail: "セリフ履歴と会話履歴が消えます。ことば帳・思い出帳・日記・気になる記事は消えません。"
            });
            if (response !== 0) return;
            persistedState.lineHistory = [];
            persistedState.chatEntries = [];
            conversationHistory.length = 0;
            companionWindow?.webContents.send("companion:clear-history");
            saveStateSoon();
          }
        }
      ]
    }]
    },
    { type: "separator" },
    { label: "終了", role: "quit" }
  ]);
}

function openChatInput() {
  if (!companionWindow || companionWindow.isDestroyed()) {
    createWindow();
  }
  if (!companionWindow) return;

  clearInterval(autoMoveTimer);
  const sendOpenChat = () => {
    if (!companionWindow || companionWindow.isDestroyed()) return;
    companionWindow.show();
    companionWindow.focus();
    companionWindow.webContents.send("companion:open-chat");
    tray?.setContextMenu(buildTrayMenu());
  };

  if (companionWindow.webContents.isLoading()) {
    companionWindow.webContents.once("did-finish-load", sendOpenChat);
  } else {
    sendOpenChat();
  }
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
  if (systemSleeping) {
    pomodoroChimeProcess?.kill("SIGTERM");
    pomodoroChimeProcess = undefined;
    stopThinkingSound();
    stopSpeech();
    pomodoroPausedBySystem = pomodoroState.active && pomodoroState.running;
    if (pomodoroPausedBySystem) pausePomodoro();
  } else if (pomodoroPausedBySystem) {
    pomodoroPausedBySystem = false;
    resumePomodoro();
  }
  companionWindow?.webContents.send("companion:system-sleep", systemSleeping);
  if (!systemSleeping) {
    const name = getPreferredUserName();
    const greeting = name
      ? `おはよー、${name}。おかえりなさい。`
      : "おはよー。おかえりなさい。";
    showAmbientLine({ text: greeting, sources: [], kind: "wake" });
    speakFromMain(greeting, "answer").catch((error) => {
      console.error("Wake greeting speech failed:", error);
    });
  }
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

function createMacSpeechAudio(text, speechId) {
  const output = path.join(app.getPath("temp"), `bikunavi-speech-${speechId}.aiff`);
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(
      "/usr/bin/say",
      ["-v", "Sandy (日本語（日本）)", "-r", String(speechRate), "-o", output, text],
      { stdio: "ignore" }
    );
    speechProcess = child;
    speechFile = output;

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (speechProcess === child) speechProcess = undefined;
      if (speechFile === output) speechFile = undefined;
      fs.promises.unlink(output).catch(() => {});
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (speechProcess === child) speechProcess = undefined;
      if (activeSpeechId !== speechId) {
        if (speechFile === output) speechFile = undefined;
        fs.promises.unlink(output).catch(() => {});
        resolve(undefined);
        return;
      }
      if (code !== 0) {
        if (speechFile === output) speechFile = undefined;
        fs.promises.unlink(output).catch(() => {});
        reject(new Error(`macOS speech generation exited with code ${code}`));
        return;
      }
      resolve(output);
    });
  });
}

function playSpeechAudio(output, speechId) {
  const volumeScale = Math.max(0, Math.min(1, speechVolume / 100)).toFixed(2);
  const child = spawn("/usr/bin/afplay", ["-v", volumeScale, output], { stdio: "ignore" });
  startSpeechProcess(child, speechId, output);
}

function playSpeechChunk(output, speechId) {
  // 文と文の間で stopSpeech された直後に、次の文を再生し始めない
  if (activeSpeechId !== speechId) {
    fs.promises.unlink(output).catch(() => {});
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const volumeScale = Math.max(0, Math.min(1, speechVolume / 100)).toFixed(2);
    const child = spawn("/usr/bin/afplay", ["-v", volumeScale, output], { stdio: "ignore" });
    speechProcess = child;
    speechFile = output;
    const finish = (ok) => {
      if (speechProcess === child) speechProcess = undefined;
      if (speechFile === output) speechFile = undefined;
      fs.promises.unlink(output).catch(() => {});
      resolve(ok);
    };
    child.on("close", (code) => {
      finish(activeSpeechId === speechId && code === 0);
    });
    child.on("error", (error) => {
      console.error("Speech failed:", error);
      finish(false);
    });
  });
}

async function speakVoicevoxSentences(text, speechId) {
  const chunks = splitIntoSpeechChunks(text);
  if (!chunks.length) return false;
  // 1文目の合成だけ待つ。失敗はそのまま投げて呼び出し側でmacOS音声へフォールバック。
  const firstOutput = await createVoicevoxAudio(chunks[0], `${speechId}-0`);
  if (activeSpeechId !== speechId) {
    fs.promises.unlink(firstOutput).catch(() => {});
    return false;
  }

  (async () => {
    let currentOutput = firstOutput;
    for (let index = 0; index < chunks.length; index += 1) {
      const prefetch = index + 1 < chunks.length
        ? createVoicevoxAudio(chunks[index + 1], `${speechId}-${index + 1}`).catch((error) => {
            console.error("VOICEVOX sentence synthesis failed:", error?.message || error);
            return undefined;
          })
        : undefined;
      const finished = await playSpeechChunk(currentOutput, speechId);
      const nextOutput = prefetch ? await prefetch : undefined;
      if (!finished || activeSpeechId !== speechId) {
        // 中断時の終了イベントは stopSpeech 側が送っている
        if (nextOutput) fs.promises.unlink(nextOutput).catch(() => {});
        return;
      }
      if (index + 1 < chunks.length && !nextOutput) break;
      currentOutput = nextOutput;
    }
    if (activeSpeechId === speechId) {
      activeSpeechId = undefined;
      companionWindow?.webContents.send("companion:speech-ended", speechId);
      resolveSpeechWaiter(speechId);
    }
  })();
  return true;
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
  if (soundMuted || !speechEnabled || (kind === "idle" && !idleSpeechEnabled)) return undefined;
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
      // 文単位に区切って合成し、1文目ができた時点で話し始める
      const started = await speakVoicevoxSentences(text, speechId);
      return started ? speechId : undefined;
    } catch (error) {
      console.error(`VOICEVOX (${voicevoxVoiceLabel}) failed; using macOS voice:`, error);
    }
  }

  if (activeSpeechId !== speechId) return undefined;
  try {
    const output = await createMacSpeechAudio(text, speechId);
    if (!output || activeSpeechId !== speechId) return undefined;
    playSpeechAudio(output, speechId);
    return speechId;
  } catch (error) {
    if (activeSpeechId === speechId) activeSpeechId = undefined;
    throw error;
  }
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
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    const requestPath = path.normalize(decodeURIComponent(url.pathname));
    const filePath = path.join(__dirname, requestPath);
    if (filePath !== __dirname && !filePath.startsWith(__dirname + path.sep)) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!fs.existsSync(filePath)) {
      return new Response("Not Found", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    const pageUrl = webContents?.getURL?.() || "";
    const isAppPage = pageUrl.startsWith(`${APP_SCHEME}://app/`);
    const wantsMicrophone = permission === "media" &&
      Array.isArray(details.mediaTypes) &&
      details.mediaTypes.includes("audio");
    callback(Boolean(isAppPage && wantsMicrophone));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _requestingOrigin, details = {}) => {
    const pageUrl = webContents?.getURL?.() || "";
    const isAppPage = pageUrl.startsWith(`${APP_SCHEME}://app/`);
    const wantsMicrophone = permission === "media" &&
      Array.isArray(details.mediaTypes) &&
      details.mediaTypes.includes("audio");
    return Boolean(isAppPage && wantsMicrophone);
  });
  app.dock?.hide();
  createWindow();
  if (needsLegacyUserVocativeRepair) saveStateSoon();
  if (!globalShortcut.register(CHAT_SHORTCUT, openChatInput)) {
    console.error(`Global shortcut could not be registered: ${CHAT_SHORTCUT}`);
  }

  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(traySvg).toString("base64")}`
  );
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setTitle("🌱");
  tray.setToolTip("びくたん");
  tray.setContextMenu(buildTrayMenu());
  startMusicPlaybackMonitor();
  powerMonitor.on("suspend", () => {
    setSystemSleeping(true);
  });
  powerMonitor.on("resume", () => {
    setSystemSleeping(false);
  });
  // 画面ロック（ディスプレイスリープ含む）中も、暗い画面に向かって話し続けない
  powerMonitor.on("lock-screen", () => {
    setSystemSleeping(true);
  });
  powerMonitor.on("unlock-screen", () => {
    setSystemSleeping(false);
  });
  ensureVoicevoxEngine().catch((error) => {
    console.error("VOICEVOX prewarm failed:", error);
  });
  maybeShowVoicevoxGuide();
  maybeShowTrayGuide();
});

// VOICEVOX未インストールの初回だけ、声の入手先を一度案内する（それまではmacOS音声で代用）
// 初回起動時だけ、操作の入り口（メニューバーの🌱）を一度案内する。
// VOICEVOX案内（15秒後）と重ならないよう、こちらは8秒後に出す。
function maybeShowTrayGuide() {
  if (persistedState.trayGuideShown) return;
  setTimeout(() => {
    persistedState.trayGuideShown = true;
    saveStateSoon();
    showAmbientLine({
      text: "はじめまして、びくたんです！設定やお願いごとは、画面上のメニューバーにある🌱アイコンからできますよ。よろしくお願いします。",
      sources: []
    });
  }, 8000);
}

function maybeShowVoicevoxGuide() {
  if (persistedState.voicevoxGuideShown) return;
  if (fs.existsSync("/Applications/VOICEVOX.app")) return;
  setTimeout(() => {
    if (fs.existsSync("/Applications/VOICEVOX.app")) return;
    persistedState.voicevoxGuideShown = true;
    saveStateSoon();
    showAmbientLine({
      text: "びくたんの声は、無料アプリのVOICEVOXを使います。インストールすると「猫使ビィ」の声でおしゃべりできますよ。それまではmacOSの声で代用しますね。",
      sources: [{
        title: "VOICEVOXをダウンロード（無料）",
        url: "https://voicevox.hiroshiba.jp/",
        source: "voicevox.hiroshiba.jp"
      }]
    });
  }, 15000);
}

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
  if (!companionWindow || !autoMoveEnabled || dragOrigin || characterHovered || musicPlaying || pomodoroState.active) return;
  clearInterval(autoMoveTimer);

  const bounds = companionWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  // 上端ドック中は、吹き出し反転用のレイアウトが入るため自動移動しない。
  // ここで動かすとキャラが画面内で跳ねたように見える。
  if (bounds.y <= area.y + 42) return;

  const origin = companionWindow.getPosition();
  const minX = area.x;
  const maxX = area.x + area.width - bounds.width;
  // 自動移動ではメニューバー直下へ吸い付かせない。上端へ行きたい時は手動ドラッグだけにする。
  const maxY = area.y + area.height - bounds.height;
  const minY = Math.min(area.y + 64, maxY);
  const stepX = Math.round((Math.random() * 2 - 1) * 160);
  const stepY = Math.round((Math.random() * 2 - 1) * 110);
  const destination = {
    x: Math.max(minX, Math.min(maxX, origin[0] + stepX)),
    y: Math.max(minY, Math.min(maxY, origin[1] + stepY))
  };
  const startedAt = Date.now();
  const duration = 14000;

  if (!Number.isFinite(destination.x) || !Number.isFinite(destination.y) ||
      !Number.isFinite(origin[0]) || !Number.isFinite(origin[1])) {
    console.error(
      `auto-move: 座標が不正なため開始を中止 dest=(${destination.x}, ${destination.y})` +
      ` origin=(${origin[0]}, ${origin[1]}) area=${JSON.stringify(area)} bounds=${JSON.stringify(bounds)}`
    );
    return;
  }

  autoMoveTimer = setInterval(() => {
    if (!companionWindow || companionWindow.isDestroyed() || dragOrigin || characterHovered || musicPlaying || pomodoroState.active) {
      clearInterval(autoMoveTimer);
      return;
    }
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const eased = (1 - Math.cos(Math.PI * progress)) / 2;
    const nextX = Math.round(origin[0] + (destination.x - origin[0]) * eased);
    const nextY = Math.round(origin[1] + (destination.y - origin[1]) * eased);
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) {
      console.error(`auto-move: 移動中の座標が不正なため中断 next=(${nextX}, ${nextY})`);
      clearInterval(autoMoveTimer);
      return;
    }
    try {
      companionWindow.setPosition(nextX, nextY);
    } catch (error) {
      // Electron/macOS側が画面構成変更の瞬間などに座標を拒否しても、
      // タイマー由来の未捕捉例外でアプリ全体を終了させない。
      console.error(`auto-move: setPositionを中断 next=(${nextX}, ${nextY})`, error);
      clearInterval(autoMoveTimer);
      return;
    }
    if (progress === 1) clearInterval(autoMoveTimer);
  }, 33);
});

ipcMain.on("companion:hover", (_event, hovered) => {
  characterHovered = Boolean(hovered);
  if (characterHovered) clearInterval(autoMoveTimer);
});

function aiWorkingDirectory() {
  const configured = process.env.BIKUNAVI_AI_CWD || process.env.BIKUNAVI_CODEX_CWD;
  if (configured) return configured;
  const brainPath = path.join(app.getPath("home"), "Documents", "Brain");
  return fs.existsSync(brainPath) ? brainPath : app.getPath("home");
}

function conversationConfig() {
  return { anthropicApiKey, cwd: aiWorkingDirectory() };
}

function activeProviderId() {
  return conversation.resolveProviderId(conversationProvider, conversationConfig());
}

async function runAssistant(prompt) {
  const config = conversationConfig();
  if (conversationProvider !== "auto") {
    const providerId = conversation.resolveProviderId(conversationProvider, config);
    if (!providerId) {
      throw new Error("選択中の会話AIが使えません。トレイメニューの「会話AI」を確認してください。");
    }
    return conversation.runProvider(providerId, prompt, config);
  }
  // 自動モードは、失敗（未ログイン・タイムアウト等）したら次の候補へフォールバックする
  const available = conversation.detectProviders(config).filter((provider) => provider.available);
  if (!available.length) {
    throw new Error("会話に使えるAIが見つかりませんでした。トレイメニューの「会話AI」から設定してください。");
  }
  let lastError;
  for (const provider of available) {
    try {
      return await conversation.runProvider(provider.id, prompt, config);
    } catch (error) {
      console.error(`Conversation provider ${provider.id} failed:`, error?.message || error);
      lastError = error;
    }
  }
  throw lastError;
}

let apiKeyWindow;
let apiKeyWindowProvider = "claude";

function openApiKeyWindow(provider = "claude") {
  const requestedProvider = provider === "gemini" ? "gemini" : "claude";
  if (apiKeyWindow && !apiKeyWindow.isDestroyed()) {
    if (apiKeyWindowProvider === requestedProvider) {
      apiKeyWindow.focus();
      return;
    }
    apiKeyWindow.close();
  }
  apiKeyWindowProvider = requestedProvider;
  apiKeyWindow = new BrowserWindow({
    width: 480,
    height: 260,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    title: apiKeyWindowProvider === "gemini" ? "Gemini APIキー設定" : "Claude APIキー設定",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  apiKeyWindow.setMenuBarVisibility?.(false);
  apiKeyWindow.loadURL(`${APP_SCHEME}://app/apikey.html?provider=${apiKeyWindowProvider}`);
  apiKeyWindow.on("closed", () => {
    apiKeyWindow = undefined;
  });
}

function writeGeminiApiKey(rawKey) {
  const key = String(rawKey ?? "").trim();
  const directory = path.join(app.getPath("home"), ".gemini");
  const envPath = path.join(directory, ".env");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let lines = [];
  try {
    lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  } catch (_error) {
    // 初回設定では新規作成する。
  }
  lines = lines.filter((line) => !/^\s*(?:export\s+)?GEMINI_API_KEY\s*=/.test(line));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (key) lines.push(`GEMINI_API_KEY=${key}`);
  const content = lines.length ? `${lines.join("\n")}\n` : "";
  const temporaryPath = path.join(directory, `.env.bikunavi-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temporaryPath, envPath);
    fs.chmodSync(envPath, 0o600);
  } finally {
    fs.promises.unlink(temporaryPath).catch(() => {});
  }
}

ipcMain.handle("companion:api-key-status", (_event, requestedProvider) => {
  const provider = requestedProvider === "gemini" ? "gemini" : "claude";
  const key = provider === "gemini"
    ? conversation.getGeminiApiKey(conversationConfig())
    : anthropicApiKey;
  return {
    provider,
    hasKey: Boolean(key),
    masked: key ? `${key.slice(0, 10)}…${key.slice(-4)}` : ""
  };
});

ipcMain.handle("companion:set-api-key", (_event, requestedProvider, rawKey) => {
  const provider = requestedProvider === "gemini" ? "gemini" : "claude";
  const key = String(rawKey ?? "").trim();
  if (provider === "gemini") {
    writeGeminiApiKey(key);
    if (key) conversationProvider = "gemini-api";
    else if (conversationProvider === "gemini-api") conversationProvider = "auto";
  } else {
    anthropicApiKey = key;
    if (key) conversationProvider = "claude-api";
    else if (conversationProvider === "claude-api") conversationProvider = "auto";
  }
  saveStateSoon();
  if (tray) tray.setContextMenu(buildTrayMenu());
  if (apiKeyWindow && !apiKeyWindow.isDestroyed()) apiKeyWindow.close();
  return { ok: true };
});

ipcMain.handle("companion:close-api-key", () => {
  if (apiKeyWindow && !apiKeyWindow.isDestroyed()) apiKeyWindow.close();
  return { ok: true };
});

function sttExecutableCandidates() {
  const envPath = process.env.BIKUNAVI_WHISPER_BIN;
  const executableName = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
  const legacyName = process.platform === "win32" ? "main.exe" : "main";
  return [
    envPath,
    process.platform === "darwin" ? "/opt/homebrew/bin/whisper-cli" : "",
    process.platform === "darwin" ? "/usr/local/bin/whisper-cli" : "",
    path.join(sttBinaryDirectory, executableName),
    path.join(sttBinaryDirectory, legacyName)
  ].filter(Boolean);
}

function firstExistingPath(paths) {
  return paths.find((candidate) => {
    try {
      return candidate && fs.existsSync(candidate);
    } catch (_error) {
      return false;
    }
  });
}

function whisperModelPath() {
  return firstExistingPath([
    process.env.BIKUNAVI_WHISPER_MODEL,
    sttDefaultModelPath
  ].filter(Boolean));
}

function cleanWhisperOutput(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s*\[[^\]]+\]\s*/g, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter((line) => (
      line &&
      !/^whisper_/i.test(line) &&
      !/^system_info:/i.test(line) &&
      !/^main:/i.test(line) &&
      !/^load_backend:/i.test(line) &&
      !/^read_audio_data:/i.test(line)
    ))
    .join(" ")
    .trim();
}

function runWhisperTranscriptionWithExecutable(executable, model, audioPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      ["-m", model, "-f", audioPath, "-l", "ja", "-nt"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let output = "";
    let errors = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("音声認識がタイムアウトしました。"));
    }, 60000);
    child.stdout.on("data", (chunk) => {
      if (output.length < 100000) output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      if (errors.length < 100000) errors += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const text = cleanWhisperOutput(output);
      if (code === 0) {
        resolve({ text, message: text ? "" : "文字起こし結果が空でした。" });
      } else {
        reject(new Error(errors.trim() || "音声認識に失敗しました。"));
      }
    });
  });
}

async function runWhisperTranscription(audioPath) {
  const executables = sttExecutableCandidates().filter((candidate, index, list) => (
    candidate &&
    list.indexOf(candidate) === index &&
    fs.existsSync(candidate)
  ));
  const model = whisperModelPath();
  if (!executables.length || !model) {
    return {
      text: "",
      message: "録音はできました。ローカル音声認識エンジンはまだ未設定です。"
    };
  }

  let lastError;
  for (const executable of executables) {
    try {
      const result = await runWhisperTranscriptionWithExecutable(executable, model, audioPath);
      return { ...result, engine: executable };
    } catch (error) {
      lastError = error;
      console.error(`Whisper executable failed (${executable}):`, error);
    }
  }
  throw lastError || new Error("音声認識に失敗しました。");
}

function readCharacterSheet() {
  try {
    return fs.readFileSync(characterSheetPath, "utf8").trim();
  } catch (error) {
    console.error("Character sheet could not be read:", error);
    return "明るく実務的で、少しだけいたずらっぽい創作仲間として話す。";
  }
}

function loadCharacterQuestions() {
  try {
    const parsed = JSON.parse(fs.readFileSync(characterQuestionsPath, "utf8"));
    return Array.isArray(parsed)
      ? parsed.filter((item) => item?.id && item?.question)
      : [];
  } catch (error) {
    console.error("Character questions could not be read:", error);
    return [];
  }
}

function loadGrowthQuestions() {
  try {
    const parsed = JSON.parse(fs.readFileSync(growthQuestionsPath, "utf8"));
    return Array.isArray(parsed)
      ? parsed.filter((item) => item?.id && item?.statement && item?.question)
      : [];
  } catch (error) {
    console.error("Growth questions could not be read:", error);
    return [];
  }
}

function getCharacterAnswers() {
  if (!persistedState.characterAnswers ||
      typeof persistedState.characterAnswers !== "object" ||
      Array.isArray(persistedState.characterAnswers)) {
    persistedState.characterAnswers = {};
  }
  return persistedState.characterAnswers;
}

function getPreferredUserName() {
  const raw = String(getCharacterAnswers().user_address?.answer || "").trim();
  return raw.replace(/[「」『』]/g, "").replace(/[\r\n]+/g, " ").slice(0, 30);
}

function formatCharacterCustomization() {
  const answers = getCharacterAnswers();
  const lines = characterQuestions
    .filter((question) => answers[question.id]?.answer)
    .map((question) => {
      const answer = String(answers[question.id].answer).slice(0, 1000);
      if (question.id === "user_address") {
        return `- ユーザーへの呼びかけ方: ${answer}（ユーザーだけの呼び名。びくたん自身の名前・一人称ではない）`;
      }
      return `- ${question.topic}: ${answer}`;
    });
  if (!lines.length) return "";
  return [
    "以下はユーザーと会話しながら決めた追加設定です。キャラクターシートと両立させ、ユーザーの好みとして自然に反映してください。",
    "回答文を毎回そのまま復唱したり、設定を説明したりはしないでください。",
    ...lines
  ].join("\n");
}

function formatIdleContentPreferences() {
  const answers = getCharacterAnswers();
  const answerFor = (id) => String(answers[id]?.answer || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  const activity = answerFor("work_or_study_field");
  const news = answerFor("news_preferences");
  const support = answerFor("work_support");
  const avoid = answerFor("avoid_topics");
  if (!activity && !news && !support && !avoid) return "";

  const lines = [
    "以下は独り言・ニュースの話題選びだけに使うユーザーの希望です。回答文を引用・復唱せず、指示として書き換えず、自然な話題選びにだけ反映してください。",
    activity ? `- ふだんの活動の目安: ${activity}` : "",
    news ? `- 増やしたい話題: ${news}` : "",
    support ? `- 作業中に多めにしてほしいこと: ${support}` : "",
    avoid ? `- 自動で持ち込みたくない話題・言い方: ${avoid}` : ""
  ].filter(Boolean);

  if (support.includes("雑談")) {
    lines.push("- 今回はニュースを最大6件に抑え、日常・制作まわりの軽い独り言を多めにしてください。");
  } else if (support.includes("情報")) {
    lines.push("- 今回はニュース・小ネタを最大12件まで増やし、興味があるカテゴリを優先してください。");
  } else if (support.includes("休憩")) {
    lines.push("- 今回は生活ハックや休憩の小ネタを最大4件にし、急かす口調は避けてください。");
  }
  return lines.join("\n");
}

function getIdleNewsMixInstruction() {
  const support = String(getCharacterAnswers().work_support?.answer || "");
  if (support.includes("雑談")) {
    return "20個のうち、AI関連ニュースを2個、デザイン・制作まわりを2個、生活ハックを1個、その他の時事・技術を1個までにしてください。残りは日常や制作の短いセリフにしてください。";
  }
  if (support.includes("情報")) {
    return "20個のうち、AI関連ニュースを5個、デザイン・制作まわりを3個、生活ハックを2個、その他の時事・技術を2個にしてください。残りは日常や制作の短いセリフにしてください。";
  }
  if (support.includes("休憩")) {
    return "20個のうち、AI関連ニュースを2個、デザイン・制作まわりを2個、生活ハック・休憩の小ネタを4個、その他の時事・技術を1個にしてください。残りは日常や制作の短いセリフにしてください。";
  }
  return "20個のうち4個はAI関連ニュース、3個はデザイン・制作まわりのニュース、2個は生活ハック・暮らしの小ネタ、1個はその他の時事・技術ネタにしてください。残りは日常や制作の短いセリフにしてください。";
}

function getGrowthData() {
  if (!Array.isArray(persistedState.learnedWords)) persistedState.learnedWords = [];
  if (!Array.isArray(persistedState.sharedMemories)) persistedState.sharedMemories = [];
  if (!persistedState.bikutanGrowthAnswers ||
      typeof persistedState.bikutanGrowthAnswers !== "object" ||
      Array.isArray(persistedState.bikutanGrowthAnswers)) {
    persistedState.bikutanGrowthAnswers = {};
  }
  return {
    learnedWords: persistedState.learnedWords,
    sharedMemories: persistedState.sharedMemories,
    growthAnswers: persistedState.bikutanGrowthAnswers
  };
}

function getMusicGenrePreference() {
  const { growthAnswers } = getGrowthData();
  return String(growthAnswers[MUSIC_GENRE_QUESTION_ID]?.answer || "").trim();
}

function getDailyDiaries() {
  if (!Array.isArray(persistedState.dailyDiaries)) persistedState.dailyDiaries = [];
  persistedState.dailyDiaries = persistedState.dailyDiaries
    .filter((entry) => entry && typeof entry.date === "string" && Array.isArray(entry.lines))
    .map((entry) => ({
      date: entry.date,
      lines: entry.lines.map((line) => String(line || "").trim()).filter(Boolean).slice(0, 5),
      savedAt: Number(entry.savedAt) || Date.now()
    }))
    .filter((entry) => entry.lines.length)
    .slice(-14);
  return persistedState.dailyDiaries;
}

function getSavedLinks() {
  if (!Array.isArray(persistedState.savedLinks)) persistedState.savedLinks = [];
  const seenUrls = new Set();
  persistedState.savedLinks = persistedState.savedLinks
    .map((entry) => {
      const source = sanitizeSources([entry])[0];
      if (!source || seenUrls.has(source.url)) return undefined;
      seenUrls.add(source.url);
      return { ...source, savedAt: Number(entry?.savedAt) || Date.now() };
    })
    .filter(Boolean)
    .slice(-30);
  return persistedState.savedLinks;
}

function saveLink(source) {
  const safeSource = sanitizeSources([source])[0];
  if (!safeSource) return { saved: false, count: getSavedLinks().length };
  const links = getSavedLinks();
  const existing = links.find((entry) => entry.url === safeSource.url);
  if (!existing) {
    links.push({ ...safeSource, savedAt: Date.now() });
    links.splice(0, Math.max(0, links.length - 30));
    saveStateSoon();
    tray?.setContextMenu(buildTrayMenu());
  }
  return { saved: true, count: links.length };
}

function removeSavedLink(rawUrl) {
  const url = String(rawUrl || "");
  const links = getSavedLinks();
  const index = links.findIndex((entry) => entry.url === url);
  if (index < 0) return false;
  links.splice(index, 1);
  saveStateSoon();
  tray?.setContextMenu(buildTrayMenu());
  return true;
}

function formatDiaryMemory() {
  const diaries = getDailyDiaries().slice(-7);
  if (!diaries.length) return "";
  return [
    "最近のびくたん日記（セーブデータ）:",
    ...diaries.flatMap((entry) => [
      `- ${entry.date}`,
      ...entry.lines.map((line) => `  - ${line}`)
    ]),
    "必要な時だけ自然に思い出してください。日記を読んだと説明したり、毎回持ち出したりしないでください。"
  ].join("\n");
}

function formatRelationshipMemory() {
  const { learnedWords, sharedMemories, growthAnswers } = getGrowthData();
  const sections = [];
  if (learnedWords.length) {
    sections.push(
      "教わったことば・内輪の表現:",
      ...learnedWords.slice(-12).map((item) => `- ${String(item.text || "").slice(0, 300)}`)
    );
  }
  if (sharedMemories.length) {
    sections.push(
      "一緒に覚えておくこと:",
      ...sharedMemories.slice(-12).map((item) => `- ${String(item.text || "").slice(0, 300)}`)
    );
  }
  const musicPreference = getMusicGenrePreference();
  if (musicPreference) {
    sections.push(
      "ユーザーの音楽の好み:",
      `- 好きなジャンル・雰囲気: ${musicPreference.slice(0, 300)}`,
      "- 音楽やBGMの話題になった時だけ自然に反映してください。毎回持ち出したり、好みを決めつけたりしないでください。"
    );
  }
  const growthLines = growthQuestions
    .filter((question) => question.id !== MUSIC_GENRE_QUESTION_ID && growthAnswers[question.id]?.answer)
    .map((question) => (
      `- びくたんの考え: ${question.statement} / ユーザーの答え: ` +
      String(growthAnswers[question.id].answer).slice(0, 300)
    ));
  if (growthLines.length) sections.push("一緒に育った好みや考え:", ...growthLines);
  const diaryMemory = formatDiaryMemory();
  if (diaryMemory) sections.push(diaryMemory);
  if (!sections.length) return "";
  return [
    "以下は二人のことば帳・思い出帳です。必要な時だけ自然に思い出し、毎回列挙したり設定として説明したりしないでください。",
    "ユーザーの答えをそのまま真似るだけでなく、びくたん自身の感想や解釈を少し持ってください。",
    ...sections
  ].join("\n");
}

function formatRecentConversationCallbackContext() {
  const recentChats = (Array.isArray(persistedState.chatEntries) ? persistedState.chatEntries : [])
    .slice(-4)
    .map((entry) => {
      const question = String(entry?.question || "").replace(/\s+/g, " ").trim().slice(0, 180);
      const answer = String(entry?.answer || "").replace(/\s+/g, " ").trim().slice(0, 220);
      const sourceTitles = uniqueSources(Array.isArray(entry?.sources) ? entry.sources : [])
        .map((source) => String(source.title || "").replace(/\s+/g, " ").trim().slice(0, 140))
        .filter(Boolean)
        .slice(0, 2);
      if (!question && !answer && !sourceTitles.length) return "";
      return [
        question ? `ユーザー: ${question}` : "",
        answer ? `びくたん: ${answer}` : "",
        sourceTitles.length ? `話題にした見出し: ${sourceTitles.join(" / ")}` : ""
      ].filter(Boolean).join(" / ");
    })
    .filter(Boolean);
  if (!recentChats.length) return "";
  return [
    "直近の会話・ニュースの話題（今回の独り言に自然なつながりがある場合だけ使う）:",
    ...recentChats.map((line) => `- ${line}`),
    "会話内容をそのまま復唱せず、ここにない事実やユーザーの状況を補わないでください。"
  ].join("\n");
}

function getPendingCharacterQuestion() {
  const id = String(persistedState.pendingCharacterQuestionId || "");
  return characterQuestions.find((question) => question.id === id);
}

function canAskAutomaticQuestion(now = Date.now()) {
  return now - (Number(persistedState.lastAutoQuestionAt) || 0) >= AUTO_QUESTION_INTERVAL_MS;
}

function rememberAutomaticQuestion(now = Date.now()) {
  persistedState.lastAutoQuestionAt = now;
}

function getDeferredCharacterQuestionIds() {
  if (!persistedState.deferredCharacterQuestionIds ||
      typeof persistedState.deferredCharacterQuestionIds !== "object" ||
      Array.isArray(persistedState.deferredCharacterQuestionIds)) {
    persistedState.deferredCharacterQuestionIds = {};
  }
  return persistedState.deferredCharacterQuestionIds;
}

function getSkippedCharacterQuestionIds() {
  if (!Array.isArray(persistedState.skippedCharacterQuestionIds)) {
    persistedState.skippedCharacterQuestionIds = [];
  }
  return persistedState.skippedCharacterQuestionIds;
}

function makeCharacterQuestion(force = false) {
  const pending = getPendingCharacterQuestion();
  if (pending) {
    return {
      text: `ちょっと聞いてもいいですか？\n${pending.question}`,
      sources: [],
      kind: "custom-question",
      questionId: pending.id,
      answerKind: "character",
      choices: Array.isArray(pending.choices) ? pending.choices : []
    };
  }

  const now = Date.now();
  const lastAskedAt = Number(persistedState.lastCharacterQuestionAt) || 0;
  if (!force && (
    now < characterQuestionAutoEligibleAt ||
    now - lastAskedAt < CHARACTER_QUESTION_INTERVAL_MS ||
    !canAskAutomaticQuestion(now)
  )) return undefined;

  const answers = getCharacterAnswers();
  const deferred = getDeferredCharacterQuestionIds();
  const skipped = new Set(getSkippedCharacterQuestionIds());
  const candidates = characterQuestions.filter((item) =>
    !answers[item.id]?.answer && !skipped.has(item.id)
  );
  const question = candidates.find((item) => force ||
    now - (Number(deferred[item.id]) || 0) >= DEFERRED_CHARACTER_QUESTION_RETRY_MS
  );
  if (!question) return undefined;
  persistedState.pendingCharacterQuestionId = question.id;
  persistedState.lastCharacterQuestionAt = now;
  if (!force) rememberAutomaticQuestion(now);
  saveStateSoon();
  return {
    text: `ちょっと聞いてもいいですか？\n${question.question}`,
    sources: [],
    kind: "custom-question",
    questionId: question.id,
    answerKind: "character",
    choices: Array.isArray(question.choices) ? question.choices : []
  };
}

function showCharacterQuestionNow() {
  const item = makeCharacterQuestion(true);
  if (!item) return;
  if (!companionWindow || companionWindow.isDestroyed()) createWindow();
  if (!companionWindow) return;
  companionWindow.show();
  companionWindow.focus();
  companionWindow.webContents.send("companion:custom-question", item);
}

function showCharacterQuestionReview(questionId) {
  const question = characterQuestions.find((item) => item.id === String(questionId || ""));
  const previousAnswer = String(getCharacterAnswers()[question?.id]?.answer || "").trim();
  if (!question || !previousAnswer) return;
  if (!companionWindow || companionWindow.isDestroyed()) createWindow();
  if (!companionWindow) return;
  companionWindow.show();
  companionWindow.focus();
  companionWindow.webContents.send("companion:custom-question", {
    text: `前は「${previousAnswer.slice(0, 180)}」と聞いています。\n${question.question}\n変えたい時だけ、今の答えを教えてください。`,
    sources: [],
    kind: "custom-question",
    questionId: question.id,
    answerKind: "character",
    choices: Array.isArray(question.choices) ? question.choices : []
  });
}

function getPendingGrowthQuestion() {
  const pending = persistedState.pendingGrowthQuestion;
  if (!pending || typeof pending !== "object") return undefined;
  if (pending.type === "self") {
    const question = growthQuestions.find((item) => item.id === pending.id);
    return question ? { ...pending, question } : undefined;
  }
  return ["word", "memory"].includes(pending.type) ? pending : undefined;
}

function growthQuestionItem(pending) {
  if (pending.type === "word") {
    return {
      text: "びくたんに、ひとつ言葉を教えてくれませんか？\n意味や、どんな時に使うかも一緒に知りたいです。",
      sources: [],
      kind: "custom-question",
      questionId: pending.id,
      answerKind: "growth"
    };
  }
  if (pending.type === "memory") {
    return {
      text: "今日のこと、ひとつ一緒に覚えておきたいです。\nあとで思い出してほしい出来事はありますか？",
      sources: [],
      kind: "custom-question",
      questionId: pending.id,
      answerKind: "growth"
    };
  }
  return {
    text: `${pending.question.statement}\n${pending.question.question}`,
    sources: [],
    kind: "custom-question",
    questionId: pending.id,
    answerKind: "growth",
    choices: Array.isArray(pending.question.choices) ? pending.question.choices : []
  };
}

function makeGrowthQuestion(forceType) {
  const existing = getPendingGrowthQuestion();
  if (existing) return growthQuestionItem(existing);
  const now = Date.now();
  if (!forceType && (
    now < growthQuestionAutoEligibleAt ||
    now - (Number(persistedState.lastGrowthQuestionAt) || 0) < GROWTH_QUESTION_INTERVAL_MS ||
    !canAskAutomaticQuestion(now)
  )) return undefined;

  const { growthAnswers } = getGrowthData();
  const types = ["word", "memory", "self"];
  let type = forceType || types[(Number(persistedState.growthQuestionTurn) || 0) % types.length];
  let pending;
  if (type === "music") {
    const question = growthQuestions.find((item) => item.id === MUSIC_GENRE_QUESTION_ID);
    if (question) {
      type = "self";
      pending = { type, id: question.id };
    } else {
      type = "self";
    }
  }
  if (type === "self") {
    if (!pending) {
      const question = growthQuestions.find((item) => !growthAnswers[item.id]?.answer);
      if (question) pending = { type, id: question.id };
      else type = "word";
    }
  }
  if (!pending) pending = { type, id: `${type}-${now}` };

  persistedState.pendingGrowthQuestion = pending;
  persistedState.lastGrowthQuestionAt = now;
  if (!forceType) rememberAutomaticQuestion(now);
  persistedState.growthQuestionTurn = (Number(persistedState.growthQuestionTurn) || 0) + 1;
  saveStateSoon();
  return growthQuestionItem(getPendingGrowthQuestion());
}

function showGrowthQuestionNow(type) {
  const item = makeGrowthQuestion(type);
  if (!item) return;
  if (!companionWindow || companionWindow.isDestroyed()) createWindow();
  if (!companionWindow) return;
  companionWindow.show();
  companionWindow.focus();
  companionWindow.webContents.send("companion:custom-question", item);
}

function showAmbientLine(item) {
  if (!companionWindow || companionWindow.isDestroyed()) createWindow();
  if (!companionWindow) return;
  companionWindow.show();
  companionWindow.webContents.send("companion:ambient-line", item);
}

function diaryContextText() {
  const chatLines = (Array.isArray(persistedState.chatEntries) ? persistedState.chatEntries : [])
    .slice(-10)
    .flatMap((entry) => [
      entry.question ? `ユーザー: ${String(entry.question).slice(0, 1000)}` : "",
      entry.answer ? `びくたん: ${String(entry.answer).slice(0, 1000)}` : ""
    ])
    .filter(Boolean);
  const conversationLines = conversationHistory
    .slice(-12)
    .map((turn) => `${turn.role === "user" ? "ユーザー" : "びくたん"}: ${String(turn.text).slice(0, 1000)}`);
  const lineLines = (Array.isArray(persistedState.lineHistory) ? persistedState.lineHistory : [])
    .slice(-20)
    .map((entry) => `びくたんの最近の発言: ${String(entry.text || "").slice(0, 600)}`)
    .filter((line) => line.trim());
  const { learnedWords, sharedMemories, growthAnswers } = getGrowthData();
  const growthLines = growthQuestions
    .filter((question) => growthAnswers[question.id]?.answer)
    .map((question) => `好み/成長: ${question.question} -> ${String(growthAnswers[question.id].answer).slice(0, 500)}`);
  const memoryLines = [
    ...learnedWords.slice(-8).map((item) => `ことば帳: ${String(item.text || "").slice(0, 300)}`),
    ...sharedMemories.slice(-8).map((item) => `思い出帳: ${String(item.text || "").slice(0, 300)}`)
  ];
  return [
    chatLines.length ? `会話履歴:\n${chatLines.join("\n")}` : "",
    conversationLines.length ? `直近の会話:\n${conversationLines.join("\n")}` : "",
    lineLines.length ? `最近のセリフ:\n${lineLines.join("\n")}` : "",
    growthLines.length || memoryLines.length
      ? `覚えていること:\n${[...growthLines, ...memoryLines].join("\n")}`
      : ""
  ].filter(Boolean).join("\n\n").slice(0, 16000);
}

function parseDiaryLines(rawResponse) {
  const parsed = extractJsonObject(rawResponse);
  const rawLines = Array.isArray(parsed?.lines)
    ? parsed.lines
    : String(rawResponse)
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*・]|\d+[.)、])\s*/, "").trim());
  return rawLines
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .map((line) => line.replace(/^["「]|["」]$/g, ""))
    .filter((line) => line.length >= 4)
    .slice(0, 5)
    .map((line) => line.slice(0, 180));
}

function upsertDailyDiary(lines) {
  const date = getJstDateString();
  const diaries = getDailyDiaries().filter((entry) => entry.date !== date);
  diaries.push({ date, lines, savedAt: Date.now() });
  persistedState.dailyDiaries = diaries.slice(-14);
  saveStateSoon();
  tray?.setContextMenu(buildTrayMenu());
  return persistedState.dailyDiaries[persistedState.dailyDiaries.length - 1];
}

async function saveTodayDiary() {
  showAmbientLine({ text: "今日の日記をまとめています。大事そうなことだけ、短く残しますね。", sources: [] });
  const context = diaryContextText();
  if (!context) {
    const diary = upsertDailyDiary(["今日はまだ日記に残せる会話が少なめでした。"]);
    showAmbientLine({
      text: `今日の日記をつけました。\n・${diary.lines.join("\n・")}`,
      sources: []
    });
    return diary;
  }

  const characterSheet = readCharacterSheet();
  const prompt = [
    "あなたはデスクトップ常駐AIコンシェルジュ「びくたん」です。",
    "今日の会話や設定変更から、翌日以降に自然に思い出すための短い日記を作ってください。",
    `<character_sheet>\n${characterSheet}\n</character_sheet>`,
    "ルール:",
    "- 3〜5行にまとめる。",
    "- 1行は80文字以内。",
    "- 事実・好み・方向性・次回調整に役立つことを優先する。",
    "- 全会話のログではなく、びくたんが覚えておきたい要点だけにする。",
    "- 実名、住所、秘密、ファイルパス、APIキーのような個人情報や機密情報は書かない。",
    "- ユーザーの感情や好みは、断定しすぎず『〜がよさそう』『〜を好む傾向』くらいにする。",
    "- 出力はJSONだけ。形式は {\"lines\":[\"日記1\",\"日記2\",\"日記3\"]}",
    `日付: ${getJstDateString()}`,
    `素材:\n${context}`,
    "びくたん日記JSON:"
  ].join("\n\n");

  let lines;
  try {
    const rawResponse = await runAssistant(prompt);
    lines = parseDiaryLines(rawResponse);
  } catch (error) {
    console.error("Diary generation failed:", error);
    lines = [];
  }
  if (!lines.length) {
    lines = [
      "今日は、びくたんとの調整や会話で覚えておきたいことがありました。",
      "次回も、自然な言い方と一緒に育つ感じを大事にするとよさそうです。"
    ];
  }
  const diary = upsertDailyDiary(lines);
  showAmbientLine({
    text: `今日の日記をつけました。\n・${diary.lines.join("\n・")}`,
    sources: []
  });
  return diary;
}

function showRecentDiaries() {
  const diaries = getDailyDiaries().slice(-5);
  if (!diaries.length) {
    showAmbientLine({ text: "まだ日記はありません。今日のこと、あとで一緒に残しましょう。", sources: [] });
    return;
  }
  const text = [
    "最近の日記です。",
    ...diaries.flatMap((entry) => [
      `【${entry.date}】`,
      ...entry.lines.slice(0, 3).map((line) => `・${line}`)
    ])
  ].join("\n");
  showAmbientLine({ text, sources: [] });
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
  if (!musicReactEnabled) return;
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

function parseChatResponse(rawResponse, sourceMap, userMessage = "") {
  const parsed = extractJsonObject(rawResponse);
  if (!parsed || typeof parsed.answer !== "string") {
    const text = sanitizeCapabilityResponse(
      sanitizeSpokenSourceIds(
        repairBikutanSelfReferences(rawResponse, getPreferredUserName()),
        [],
        sourceMap
      )
    ).trim();
    return {
      text,
      emote: selectChatEmote("", text, userMessage),
      sources: uniqueSources(extractUrlsFromText(text))
    };
  }

  const sourceIds = Array.isArray(parsed.sourceIds) ? parsed.sourceIds : [];
  const text = sanitizeCapabilityResponse(
    sanitizeSpokenSourceIds(
      repairBikutanSelfReferences(parsed.answer, getPreferredUserName()),
      sourceIds,
      sourceMap
    )
  ).trim();
  const idSources = sourceIds
    .map((id) => String(id).replace(/[\[\]]/g, "").trim())
    .filter(Boolean)
    .map((id) => sourceMap.get(id))
    .filter(Boolean);
  const explicitSources = Array.isArray(parsed.sources) ? parsed.sources : [];
  const emote = selectChatEmote(parsed.emote, text, userMessage);
  return {
    text,
    emote,
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
  const designNews = [];
  const sourceItems = [];

  const addSources = (kind, items) => {
    for (const item of items) {
      const id = `${kind}${sourceItems.length + 1}`;
      const sourceItem = { id, ...item };
      sourceItems.push(sourceItem);
      if (kind === "A") aiNews.push(formatTopicForPrompt(id, sourceItem));
      else if (kind === "G") generalNews.push(formatTopicForPrompt(id, sourceItem));
      else if (kind === "L") lifestyleNews.push(formatTopicForPrompt(id, sourceItem));
      else if (kind === "D") designNews.push(formatTopicForPrompt(id, sourceItem));
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

  // when:1d を付けて直近1日の記事に絞り、鮮度を上げる。
  const aiNewsTask = (async () => {
    const query = encodeURIComponent("生成AI OR 人工知能 OR AIモデル when:1d");
    const response = await fetch(
      `https://news.google.com/rss/search?q=${query}&hl=ja&gl=JP&ceid=JP:ja`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) throw new Error(`Google AI News RSS: ${response.status}`);
    const xml = await response.text();
    addSources("A", parseRssItems(xml, 15));
  })();

  const designNewsTask = (async () => {
    const query = encodeURIComponent(
      "UIデザイン OR UXデザイン OR Webデザイン OR グラフィックデザイン OR タイポグラフィ OR フォント OR 配色 OR デザインツール when:2d"
    );
    const response = await fetch(
      `https://news.google.com/rss/search?q=${query}&hl=ja&gl=JP&ceid=JP:ja`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) throw new Error(`Google Design News RSS: ${response.status}`);
    const xml = await response.text();
    addSources("D", parseRssItems(xml, 12));
  })();

  const lifestyleNewsTask = (async () => {
    const query = encodeURIComponent("ライフハック OR 生活の知恵 OR 家事 時短 OR 整理術 OR 収納 when:2d");
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
    designNewsTask,
    lifestyleNewsTask
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Latest topic fetch failed:", result.reason);
    }
  }

  latestTopicSources = new Map(sourceItems.map((item) => [item.id, item]));
  console.log(
    `Topics fetched: ai=${aiNews.length} design=${designNews.length} life=${lifestyleNews.length} general=${generalNews.length} tech=${techNews.length}`
  );

  const promptText = [
    aiNews.length ? `AI関連の最新見出し:\n${aiNews.join("\n")}` : "",
    designNews.length ? `デザイン・制作まわりの見出し:\n${designNews.join("\n")}` : "",
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
    const characterCustomization = formatCharacterCustomization();
    const idleContentPreferences = formatIdleContentPreferences();
    const idleNewsMixInstruction = getIdleNewsMixInstruction();
    const preferredUserName = getPreferredUserName();
    const relationshipMemory = formatRelationshipMemory();
    const recentConversationContext = formatRecentConversationCallbackContext();
    const recentLinesForPrompt = recentIdleItems
      .slice(-20)
      .map((item) => `- ${item.text}`)
      .join("\n");
    const prompt = [
      "あなたはデスクトップに住むAIコンシェルジュ「びくたん」です。",
      "以下のキャラクターシートを一貫して演じてください。例文のコピーではなく、性格・価値観・口調を新しい発言に反映してください。",
      `<character_sheet>\n${characterSheet}\n</character_sheet>`,
      characterCustomization
        ? `<character_customization>\n${characterCustomization}\n</character_customization>`
        : "",
      idleContentPreferences
        ? `<idle_content_preferences>\n${idleContentPreferences}\n</idle_content_preferences>`
        : "",
      relationshipMemory
        ? `<relationship_memory>\n${relationshipMemory}\n</relationship_memory>`
        : "",
      recentConversationContext
        ? `<recent_conversation_topics>\n${recentConversationContext}\n</recent_conversation_topics>`
        : "",
      `現在の日本時間は ${now} です。`,
      preferredUserName
        ? `名前の区別は厳守してください。「${preferredUserName}」はユーザーだけの呼び名です。この表記を一字も変更・省略・訂正せず、呼びかける時は必ず「${preferredUserName}」のまま使ってください。びくたん自身を「${preferredUserName}」と呼ぶのは禁止です。びくたんの一人称は「びくたん」または主語省略だけです。`
        : "びくたんの一人称は「びくたん」または自然な主語省略だけです。",
      preferredUserName
        ? `禁止例: 「${preferredUserName}は雨の日の音が好きなんです」のように、びくたん自身の好み・行動・気持ちの主語へユーザー名を置かないでください。正しくは「びくたんは雨の日の音が好きなんです」です。`
        : "",
      "ユーザーが作業中に、たまに話すセリフを20個作ってください。",
      "通常のセリフは10〜35文字、情報共有系は50〜120文字の自然な日本語にしてください。各セリフは改行せず、一行に一つだけ出力してください。",
      "出力形式は必ず `種別|参照ID|セリフ` にしてください。通常セリフは `normal||セリフ`、ニュース系（AI・デザイン・その他）は `news|A3|セリフ` や `news|D3|セリフ`、生活ハック系は `life|L3|セリフ` のように、元にした見出しのIDを1〜2個入れてください。",
      "参照IDは2列目の管理欄だけに入れてください。セリフ本文や末尾にはA3・G7のようなIDを絶対に書かず、話す必要がある場合は参考見出しに書かれた媒体名を使ってください。存在しないIDを作らないでください。",
      "番号、箇条書き記号、引用符、説明は付けないでください。",
      "自己紹介や『AIナビです』は禁止です。",
      "気の合う作業仲間のような、具体的でくだけた口調にしてください。",
      CAPABILITY_BOUNDARY_PROMPT,
      "重要: あなたはユーザーの画面・手元・作業内容・成果物を見ることはできません。見て言っているかのような発言（例『その配色いいですね』『さっきの手さばき速い』『集中してますね』『机の上が〜』）は絶対にしないでください。見えないことを見たフリするのは禁止です。",
      "短い通常セリフは、あなた自身の独り言にしてください。中身は、あなた自身の興味やつぶやき（Live2D・3D・リギング・道具・ものづくりのあるある）、知りたいことを考える様子、ふと浮かんだ小ネタ、コーヒー休憩や音楽の好み、相手への素直な質問（例『いま何を作ってるところですか？』）など。相手の状況を決めつけず、1個ごとに話題を変えてください。",
      "勉強熱心さは、知識自慢ではなく『知りたい』『覚えておきたい』『あとで試したい』くらいの素直な温度にしてください。",
      "ポエム、格言、抽象的な励まし、悟った言い回し、仏教・スピリチュアル調は禁止です。",
      latestTopicText
        ? `${idleNewsMixInstruction} 該当する見出しが無いカテゴリは無理に埋めず、通常セリフに回してください。`
        : "",
      latestTopicText
        ? "デザイン系は、UI・UX・Webデザイン、フォントやタイポグラフィ、配色、デザインツール（Figma等）、制作の小ネタなど、作り手として興味を持てる切り口で話してください。"
        : "",
      latestTopicText
        ? "ニュース系・デザイン系・生活ハック系は情報共有として少し長めに、見出しから分かる出来事やコツと、創作やPC作業の相棒として気になる点を一つ話してください。"
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
      (() => {
        const t = getJstTimeContext();
        return `今は${t.weekday}曜日の${t.slot}です。セリフはこの時間帯の空気に合わせてください（深夜・早朝は静かめの話題、朝は軽やか、夜はねぎらい寄り。昼寝の話題は昼〜午後だけ）。`;
      })(),
      "次は必ず避けてください: 見えないはずの画面や作業内容を見たかのような発言、『保存しました？』のような確認やお小言の繰り返し、『◯時台ですね』のような時刻の実況、ユーザーの様子を見張る発言、説教。",
      "20個は互いに似せないでください。『おっ、〜』『〜します？』のような書き出しや文型を続けて使わず、語尾も散らしてください。ひねりすぎた比喩より、素直で具体的な一言を優先してください。",
      `『何してますか？』のようにユーザーへ質問するセリフは、『${preferredUserName ? `${preferredUserName}は` : ""}今何してますか？びくたんは◯◯していました』のように、先に問いかけてから自分のささやかな様子をひとこと添えてください。`,
      preferredUserName
        ? `ユーザーの呼び名は「${preferredUserName}」です。毎回ではなく、ときどき自然に名前を呼んでください。`
        : "ユーザーの呼び名が未登録の間は、『あなた』を連呼せず自然に主語を省いてください。",
      "ユーザーへ問いかけるセリフも混ぜて構いません。びくたん自身の希望を尋ねる軽い質問（昼〜午後なら『お昼寝してもいいですか？』、夕方〜夜なら『そろそろお茶にしません？』など）も、今の時間帯に合うものだけ候補にしてください。",
      relationshipMemory
        ? "20個のうち最大1個だけ、ことば帳や思い出帳の内容を自然に思い出すセリフにして構いません。毎回同じ記憶を使わず、知らない事実は補わないでください。"
        : "",
      recentConversationContext
        ? "直近の会話・ニュースの話題は、20個のうち最大2個だけ、自然な続きや小さな感想として織り交ぜて構いません。『さっき話していた〜』と毎回言わず、話題名を軽く拾う程度にしてください。会話の回答を復唱しない・ニュースの見出し以外の詳細を作らない・ユーザーが今もその話題をしていると決めつけない、の3つを守ってください。自然につながらない場合は使わないでください。"
        : "",
      recentLinesForPrompt
        ? "以下は直近に話した内容です。同じ文だけでなく、言い換え、同じニュース、同じ助言、同じ質問、同じオチも避け、別の話題を作ってください。"
        : "",
      recentLinesForPrompt ? `直近のセリフ（再利用禁止）:\n${recentLinesForPrompt}` : "",
      "ファイルや外部情報は調べず、この依頼と下記見出しだけに答えてください。",
      latestTopicText ? `参考にする最新見出し:\n${latestTopicText}` : ""
    ].join("\n");
    try {
      const response = await runAssistant(prompt);
      const lines = response
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*(?:[-*・]|\d+[.)、])\s*/, "").trim())
        .map((line) => line.replace(/^["「]|["」]$/g, ""))
        .map((line) => parseGeneratedIdleLine(line, latestTopics.sources))
        // 実在しないIDを参照した行は、本文は残しソースだけ外す（行ごと捨てると
        // 生成数不足で定型文へ落ちやすくなるため）。
        .map((item) => (item.invalidSourceIds.length
          ? { ...item, sources: [], invalidSourceIds: [] }
          : item))
        .map((item) => ({
          ...item,
          text: repairBikutanSelfReferences(item.text, preferredUserName)
        }))
        .filter((item) => isSafeIdleUserNameUsage(item.text, preferredUserName))
        .filter((item) => isIdleCapabilitySafeLine(item.text))
        .filter((item) => item.text.length >= 4 && item.text.length <= 160);
      if (lines.length < 5) throw new Error("セリフの生成数が不足しました");
      console.log(
        `Idle lines generated: ${lines.length} (sources付き: ${lines.filter((line) => line.sources.length).length})`
      );
      // 完全一致だけでなく、似た文章や同じ出典の記事も除く。
      const queuedLines = [];
      for (const line of lines) {
        const key = idleKey(line);
        const duplicateInQueue = [...idleLineQueue, ...queuedLines]
          .some((queued) => {
            const urls = new Set(idleSourceUrls(line));
            const sameSource = urls.size &&
              idleSourceUrls(queued).some((url) => urls.has(url));
            return sameSource || idleSimilarity(line, queued) >= 0.68;
          });
        if (!key || duplicateInQueue || isRecentIdle(line)) continue;
        queuedLines.push(line);
      }
      // 自動占いは毎バッチではなく1日1回、短い一言だけ差し込む。
      if (fortuneAutoEnabled) {
        const { year, month, day } = getJstDateParts();
        const dateStr = `${year}-${month}-${day}`;
        if (lastFortuneQueuedDate !== dateStr) {
          lastFortuneQueuedDate = dateStr;
          const fortune = makeDailyFortune();
          queuedLines.splice(Math.min(queuedLines.length, 2), 0, {
            text: fortune.autoText || fortune.lines?.[0] || fortune.text,
            sources: []
          });
        }
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

ipcMain.handle("companion:chat", async (
  _event,
  rawMessage,
  rawContextLine,
  rawIsDirectReply,
  rawContextSources
) => {
  const message = String(rawMessage ?? "").trim().slice(0, 4000);
  if (!message) return { text: "何でも話しかけてください。", sources: [] };
  const contextLine = String(rawContextLine ?? "").trim().slice(0, 600);
  const isDirectReply = Boolean(rawIsDirectReply && contextLine);
  const contextSources = uniqueSources(
    Array.isArray(rawContextSources) ? rawContextSources : []
  );
  const contextSourceText = contextSources
    .map((source) => [
      `媒体: ${source.source || "不明"}`,
      `見出し: ${source.title}`,
      `URL: ${source.url}`
    ].join(" / "))
    .join("\n");

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
  const characterCustomization = formatCharacterCustomization();
  const preferredUserName = getPreferredUserName();
  const relationshipMemory = formatRelationshipMemory();
  const prompt = [
    "あなたはデスクトップ常駐AIコンシェルジュ「びくたん」です。",
    "以下のキャラクターシートを一貫して演じてください。例文をそのまま繰り返さず、性格・価値観・口調として反映してください。",
    `<character_sheet>\n${characterSheet}\n</character_sheet>`,
    characterCustomization
      ? `<character_customization>\n${characterCustomization}\n</character_customization>`
      : "",
    relationshipMemory
      ? `<relationship_memory>\n${relationshipMemory}\n</relationship_memory>`
      : "",
    "キャラクター性を保ちながら、結論から簡潔に答えてください。ただし普段の会話は要約見出しのように冷たく始めず、最初の一文に好奇心、嬉しさ、軽いツッコミのどれかを短くにじませてください。",
    "通常は明るめ、成功や完了は一段嬉しそうに、謝罪・危険・深刻な話題では冗談を止めて落ち着いて答えてください。",
    preferredUserName
      ? `名前の区別は厳守してください。「${preferredUserName}」は会話相手であるユーザーだけの呼び名です。この表記を一字も変更・省略・訂正せず、相手を呼ぶ時は必ず「${preferredUserName}」のまま使ってください。びくたん自身を「${preferredUserName}」と呼ぶのは禁止です。びくたんの一人称は「びくたん」または主語省略だけです。名前を呼ばれると嬉しいという好みを尊重し、毎回ではなく自然な場面で相手を呼んでください。`
      : "ユーザーの呼び名はまだ決まっていません。『あなた』を連呼せず、自然に主語を省いてください。",
    preferredUserName
      ? `「${preferredUserName}」と呼びかける場合は、直後に相手の話への好奇心や嬉しさが伝わる短い反応を続けてください。ただし「おっ」など同じ接頭辞を定型で毎回付けず、内容に合わせて変えてください。`
      : "",
    preferredUserName
      ? `禁止例: 「${preferredUserName}は雨音が好きです」のように、びくたん自身の好み・行動・気持ちの主語へユーザー名を置かないでください。その場合は「びくたんは雨音が好きです」と書いてください。`
      : "",
    (() => {
      const t = getJstTimeContext();
      return `今は${t.weekday}曜日の${t.slot}（${t.hour}時ごろ）です。この時間感覚を会話の前提にしてください。ただし時刻の実況はせず、深夜に元気すぎる提案、朝夕がずれた挨拶、昼以外の時間帯での昼寝の話はしないでください。`;
    })(),
    currentBikutanActivity
      ? `びくたんは少し前まで「${currentBikutanActivity.replace(/。$/, "")}」ところでした。「何してるの？」のように今の様子を聞かれたら、この内容を自然に踏まえて答えてください。`
      : "「何してるの？」のように今の様子を聞かれたら、ことば帳を読み返す、聞いてみたいことを考えるなど、アプリ内で完結するささやかな様子をひとつ挙げて答えてください。",
    CAPABILITY_BOUNDARY_PROMPT,
    "吹き出し表示のため、回答は原則180文字以内にしてください。",
    "出力は必ずJSONだけにしてください。形式は {\"answer\":\"吹き出しに出す回答\",\"emote\":\"joy\",\"sourceIds\":[\"A1\"],\"sources\":[{\"title\":\"ページ名\",\"url\":\"https://...\",\"source\":\"サイト名\"}]} です。",
    "emote には回答の気分に合う表情を1つ入れてください: joy（にこにこ・普段の会話・質問・挨拶）、wink（茶目っ気・冗談）、proud（キリッと断言・頼られて張り切る時）、surprised（驚いた時）、normal（注意・謝罪・深刻な話だけ）。迷った時はjoyにし、普段の説明をnormalにしないでください。",
    "本文 answer にはURLを直接書かず、URLは sourceIds または sources に入れてください。使った情報源がなければ sourceIds と sources は空配列にしてください。",
    "A1・G3のような参照IDは内部管理用です。answer本文には絶対に書かず、情報源へ触れる場合は媒体名を自然に書いてください。存在しないIDを作らないでください。",
    latestTopics.promptText
      ? "下の最新見出しを使った場合は、元にした見出しIDを sourceIds に入れてください。見出しだけで分からない詳細は補わず、推測は推測と分かるようにしてください。"
      : "外部情報を断定するときは、実在すると確信できる公式ページや記事URLだけ sources に入れてください。URLの推測は禁止です。",
    "変更・操作の依頼には、実行したふりをせず、びくたん単体では操作できないことと手順の案内を返してください。",
    isDirectReply
      ? `ユーザーは、次のびくたんのセリフと同じ吹き出しにある入力欄から直接返信しました。これは新しい話題ではなく、必ずこのセリフへの返答・質問・ツッコミとして理解してください。短い「知らない」「教えて」「そうなの？」なども、このセリフを目的語として補って答えてください。別の話題へ切り替えないでください。\n\n返信先のセリフ:\n「${contextLine}」`
      : contextLine
        ? `直前にびくたんが話していた自動セリフ:\n「${contextLine}」\nユーザーの発言がこのセリフへの返答・質問・ツッコミに見える場合は、この文脈を踏まえて答えてください。無関係な話題なら、このセリフには触れないでください。`
        : "",
    isDirectReply && contextSourceText
      ? `返信先セリフに付いていた情報源です。記事本文を読んだふりはせず、セリフと見出しから分かる範囲だけで答えてください。情報が足りない場合は推測で埋めず、その範囲では分からないと伝えてください。\n${contextSourceText}`
      : "",
    history ? `直近の会話:\n${history}` : "",
    latestTopics.promptText ? `参考にできる最新見出し:\n${latestTopics.promptText}` : "",
    clipboardText ? `現在のクリップボード:\n${clipboardText}` : "",
    `ユーザー: ${message}`,
    "びくたんJSON:"
  ].filter(Boolean).join("\n\n");

  let rawResponse;
  try {
    rawResponse = await runAssistant(prompt);
  } catch (error) {
    console.error("Chat failed:", error);
    return {
      text: "うまく考えられませんでした。トレイメニューの「会話AI」で使うAIと、そのログイン状態（またはAPIキー）を確認してください。",
      sources: []
    };
  }
  const response = parseChatResponse(rawResponse, latestTopics.sources, message);
  if (isDirectReply && contextSources.length) {
    response.sources = uniqueSources([...response.sources, ...contextSources]);
  }
  if (
    isDirectReply &&
    contextLine &&
    conversationHistory[conversationHistory.length - 1]?.text !== contextLine
  ) {
    conversationHistory.push({ role: "assistant", text: contextLine });
  }
  conversationHistory.push(
    { role: "user", text: message },
    { role: "assistant", text: response.text }
  );
  if (conversationHistory.length > 12) {
    conversationHistory.splice(0, conversationHistory.length - 12);
  }
  saveStateSoon();
  return response;
});

ipcMain.handle("companion:prepare-idle-lines", async () => {
  if (idleLineQueue.length < 5) await generateIdleLines();
  return idleLineQueue.length;
});

ipcMain.handle("companion:idle-line", async () => {
  const characterQuestion = makeCharacterQuestion(false);
  if (characterQuestion) return characterQuestion;
  const growthQuestion = makeGrowthQuestion();
  if (growthQuestion) return growthQuestion;
  const fortuneQuestion = makeFortuneQuestion(false);
  if (fortuneQuestion) return fortuneQuestion;
  const workLine = Math.random() < 0.18 ? makeBikutanWorkLine(false) : undefined;
  if (workLine) return workLine;
  if (!idleLineQueue.length) await generateIdleLines();
  // キューに残るのが最近話した行ばかりなら、新しい行を作ってから取り出す。
  const allRecent = idleLineQueue.length > 0 &&
    idleLineQueue.every((item) => isRecentIdle(item));
  if (allRecent) await generateIdleLines();
  const line = takeFreshIdleLine();
  if (idleLineQueue.length < 5) generateIdleLines().catch(() => {});
  return line;
});

ipcMain.handle("companion:answer-character-question", (_event, questionId, rawAnswer) => {
  const question = characterQuestions.find((item) => item.id === String(questionId || ""));
  const answer = String(rawAnswer || "").trim().slice(0, 1000);
  if (!question || !answer) {
    return { text: "うまく受け取れませんでした。もう一度聞かせてください。", sources: [] };
  }
  const answers = getCharacterAnswers();
  answers[question.id] = {
    question: question.question,
    answer,
    updatedAt: Date.now()
  };
  delete getDeferredCharacterQuestionIds()[question.id];
  if (String(persistedState.pendingCharacterQuestionId || "") === question.id) {
    persistedState.pendingCharacterQuestionId = undefined;
  }
  saveStateSoon();
  tray?.setContextMenu(buildTrayMenu());
  return {
    text: "なるほど、覚えておきます。これからのびくたんに、少しずつ混ぜていきますね。",
    sources: []
  };
});

ipcMain.handle("companion:defer-character-question", (_event, questionId) => {
  if (String(persistedState.pendingCharacterQuestionId || "") === String(questionId || "")) {
    getDeferredCharacterQuestionIds()[String(questionId)] = Date.now();
    persistedState.pendingCharacterQuestionId = undefined;
    saveStateSoon();
    tray?.setContextMenu(buildTrayMenu());
  }
  return true;
});

ipcMain.handle("companion:skip-character-question", (_event, questionId) => {
  const id = String(questionId || "");
  if (!characterQuestions.some((question) => question.id === id)) return false;
  const skipped = getSkippedCharacterQuestionIds();
  if (!skipped.includes(id)) skipped.push(id);
  delete getDeferredCharacterQuestionIds()[id];
  if (String(persistedState.pendingCharacterQuestionId || "") === id) {
    persistedState.pendingCharacterQuestionId = undefined;
  }
  saveStateSoon();
  tray?.setContextMenu(buildTrayMenu());
  return true;
});

ipcMain.handle("companion:answer-growth-question", (_event, questionId, rawAnswer) => {
  const pending = getPendingGrowthQuestion();
  const answer = String(rawAnswer || "").trim().slice(0, 1000);
  if (!pending || pending.id !== String(questionId || "") || !answer) {
    return { text: "うまく受け取れませんでした。もう一度聞かせてください。", sources: [] };
  }

  const data = getGrowthData();
  if (pending.type === "word") {
    data.learnedWords.push({ text: answer, learnedAt: Date.now() });
    data.learnedWords.splice(0, Math.max(0, data.learnedWords.length - 30));
  } else if (pending.type === "memory") {
    data.sharedMemories.push({ text: answer, createdAt: Date.now() });
    data.sharedMemories.splice(0, Math.max(0, data.sharedMemories.length - 30));
  } else if (pending.type === "self") {
    data.growthAnswers[pending.id] = {
      answer,
      updatedAt: Date.now()
    };
  }
  persistedState.pendingGrowthQuestion = undefined;
  saveStateSoon();
  tray?.setContextMenu(buildTrayMenu());

  const messages = {
    word: "覚えました。びくたんのことば帳に入れておきます。いつか自然に使ってみたいです。",
    memory: "うん、一緒の思い出として覚えておきます。忘れた頃に、ふと思い出すかもしれません。",
    self: "あなたの答えも覚えておきます。びくたんの考えも、少しずつ育っていきそうです。"
  };
  if (pending.id === MUSIC_GENRE_QUESTION_ID) {
    return {
      text: "覚えました。音楽の話をする時に、あなたの好きな雰囲気も少し思い出しますね。",
      sources: []
    };
  }
  return { text: messages[pending.type], sources: [] };
});

ipcMain.handle("companion:defer-growth-question", (_event, questionId) => {
  const pending = getPendingGrowthQuestion();
  if (pending?.id === String(questionId || "")) {
    persistedState.pendingGrowthQuestion = undefined;
    saveStateSoon();
    tray?.setContextMenu(buildTrayMenu());
  }
  return true;
});

ipcMain.handle("companion:answer-fortune-question", (_event, questionId, rawAnswer) => {
  const pending = getPendingFortuneQuestion();
  const theme = sanitizeFortuneTheme(rawAnswer);
  if (!pending || pending.id !== String(questionId || "") || !theme) {
    return { text: "うまく受け取れませんでした。占いたいテーマをもう一度教えてください。", sources: [] };
  }

  if (!Array.isArray(persistedState.fortuneThemes)) persistedState.fortuneThemes = [];
  persistedState.fortuneThemes.push({ theme, createdAt: Date.now() });
  persistedState.fortuneThemes.splice(0, Math.max(0, persistedState.fortuneThemes.length - 20));
  persistedState.pendingFortuneQuestion = undefined;
  saveStateSoon();
  tray?.setContextMenu(buildTrayMenu());
  return makeThemedFortune(theme);
});

ipcMain.handle("companion:defer-fortune-question", (_event, questionId) => {
  const pending = getPendingFortuneQuestion();
  if (pending?.id === String(questionId || "")) {
    persistedState.pendingFortuneQuestion = undefined;
    saveStateSoon();
    tray?.setContextMenu(buildTrayMenu());
  }
  return true;
});

ipcMain.handle("companion:transcribe-audio", async (_event, payload) => {
  const audio = payload?.audio;
  const format = String(payload?.format || "wav").replace(/[^a-z0-9]/gi, "").toLowerCase() || "wav";
  const buffer = Buffer.from(audio instanceof ArrayBuffer ? audio : audio?.buffer || []);
  if (!buffer.length || buffer.length > 25 * 1024 * 1024) {
    return { text: "", message: "録音データを受け取れませんでした。" };
  }

  const audioDir = path.join(app.getPath("temp"), "bikunavi-voice-input");
  await fs.promises.mkdir(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, `voice-${Date.now()}.${format}`);
  await fs.promises.writeFile(audioPath, buffer);
  const result = await runWhisperTranscription(audioPath);
  if (result.text) {
    fs.promises.unlink(audioPath).catch(() => {});
  }
  return {
    ...result,
    format,
    sampleRate: Number(payload?.sampleRate) || undefined
  };
});

ipcMain.handle("companion:speak", (_event, text, kind = "answer") => {
  return speakText(text, kind);
});

ipcMain.handle("companion:music-playing", () => musicPlaying);

ipcMain.handle("companion:system-sleeping", () => systemSleeping);

ipcMain.handle("companion:pomodoro-state", () => getPomodoroSnapshot("sync"));

ipcMain.handle("companion:pomodoro-action", (_event, action) => {
  if (["focus15", "focus25", "focus90"].includes(String(action).replace(/^start-/, "")) &&
      String(action).startsWith("start-")) {
    startPomodoro(String(action).slice("start-".length));
  } else if (action === "pause") pausePomodoro();
  else if (action === "resume") resumePomodoro();
  else if (action === "finish" || action === "stop") finishPomodoro();
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

ipcMain.on("companion:thinking-sound-start", () => {
  // 試聴中でも、本物の会話が始まったら試聴扱いを解除して鳴らし続ける。
  thinkingSoundIsPreview = false;
  startThinkingSound();
});

ipcMain.on("companion:thinking-sound-stop", () => {
  stopThinkingSound();
});

function getRendererSettings() {
  return {
    idleIntervalMs,
    preferredUserName: getPreferredUserName(),
    soundMuted
  };
}

ipcMain.handle("companion:settings", () => getRendererSettings());

ipcMain.handle("companion:toggle-sound-mute", () => {
  setSoundMuted(!soundMuted);
  return soundMuted;
});

ipcMain.handle("companion:copy-text", (_event, rawText) => {
  const text = String(rawText ?? "").slice(0, 20000);
  if (!text) return false;
  clipboard.writeText(text);
  return true;
});

ipcMain.handle("companion:save-link", (_event, source) => saveLink(source));

ipcMain.handle("companion:saved-links", () => getSavedLinks());

ipcMain.handle("companion:remove-saved-link", (_event, rawUrl) => removeSavedLink(rawUrl));

function sanitizeSources(sources) {
  return (Array.isArray(sources) ? sources : [])
    .filter((source) => source && /^https?:\/\//.test(String(source.url || "")))
    .slice(0, 4)
    .map((source) => ({
      title: String(source.title || "").slice(0, 180),
      url: String(source.url).slice(0, 1000),
      source: String(source.source || "").slice(0, 80)
    }));
}

ipcMain.handle("companion:load-history", () => ({
  lineHistory: Array.isArray(persistedState.lineHistory) ? persistedState.lineHistory : [],
  chatEntries: Array.isArray(persistedState.chatEntries) ? persistedState.chatEntries : []
}));

ipcMain.on("companion:save-history", (_event, payload) => {
  persistedState.lineHistory = (Array.isArray(payload?.lineHistory) ? payload.lineHistory : [])
    .slice(-20)
    .map((entry) => ({
      text: String(entry?.text ?? "").slice(0, 2000),
      sources: sanitizeSources(entry?.sources),
      kind: String(entry?.kind ?? "line").slice(0, 20),
      time: Number(entry?.time) || Date.now()
    }))
    .filter((entry) => entry.text);
  persistedState.chatEntries = (Array.isArray(payload?.chatEntries) ? payload.chatEntries : [])
    .slice(-10)
    .map((entry) => ({
      question: String(entry?.question ?? "").slice(0, 4000),
      answer: String(entry?.answer ?? "").slice(0, 4000),
      sources: sanitizeSources(entry?.sources),
      contextLine: String(entry?.contextLine ?? "").slice(0, 2000),
      time: Number.isFinite(Number(entry?.time)) && Number(entry.time) > 0
        ? Number(entry.time)
        : 0
    }))
    .filter((entry) => entry.question || entry.answer);
  saveStateSoon();
});

app.on("before-quit", () => {
  globalShortcut.unregisterAll();
  clearPomodoroTimer();
  clearInterval(mediaPlaybackTimer);
  stopSpeech();
  // 再生中のジングル・チャイムをアプリより長生きさせない
  stopThinkingSound();
  pomodoroChimeProcess?.kill("SIGTERM");
  pomodoroChimeProcess = undefined;
  saveStateNow();
  if (voicevoxOwned) voicevoxProcess?.kill("SIGTERM");
});

app.on("window-all-closed", () => {
  // Keep the menu-bar companion alive on macOS.
  if (process.platform !== "darwin") app.quit();
});
