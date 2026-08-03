// 会話AIプロバイダの抽象化。
// 「プロンプト文字列を渡すとテキストが返る」契約で、Codex CLI / Claude Code CLI /
// Gemini API / Gemini CLI / Claude API（APIキー）を切り替えられるようにする。
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { Anthropic } = require("@anthropic-ai/sdk");

const CLI_TIMEOUT_MS = 90000;
const API_TIMEOUT_MS = 30000;
const HOME = os.homedir();
const IS_WINDOWS = process.platform === "win32";
// CLI の実体を探す場所。PATH だけに頼れない事情がOSごとにある。
// macOS/Linux: LaunchAgent 起動時は PATH が最小構成になる。
// Windows: npm -g の入れ先（%APPDATA%\npm）が PATH に無いことがある。
const COMMON_BIN_DIRS = IS_WINDOWS
  ? [
      path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "npm"),
      path.join(HOME, ".local", "bin"),
      path.join(HOME, "bin")
    ]
  : [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      path.join(HOME, ".local", "bin"),
      path.join(HOME, "bin")
    ];
// Windowsの実行ファイルは拡張子が要る。spawnで直接起動できるものだけを見る
// （.ps1 は直接起動できないので入れない）。.exe を .cmd より先に試すのは、
// ネイティブ版があるならシムを経由しない方が確実なため。
const WINDOWS_EXECUTABLE_EXTENSIONS = [".exe", ".com", ".cmd", ".bat"];

function isExistingFile(candidate) {
  try {
    // ディレクトリを実行ファイルと取り違えない（Windowsでは同名のフォルダが有り得る）。
    return fs.statSync(candidate).isFile();
  } catch (_error) {
    return false;
  }
}

function firstExistingPath(candidates) {
  return candidates.filter(Boolean).find(isExistingFile);
}

// 「codex」から、そのOSで実際に置かれうるファイル名を並べる。
function executableFileNames(name) {
  if (!IS_WINDOWS) return [name];
  // 拡張子なしのファイルはnpmがsh用に置くシェルスクリプトで、
  // Windowsからは起動できない。候補に入れない。
  return WINDOWS_EXECUTABLE_EXTENSIONS.map((extension) => `${name}${extension}`);
}

function searchDirectories() {
  const fromPath = String(process.env.PATH || "")
    .split(path.delimiter)
    .map((directory) => directory.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  // 既知の場所を先に見る。PATHは補い。
  return [...COMMON_BIN_DIRS, ...fromPath];
}

function findExecutable(name, extraCandidates = []) {
  const candidates = [...extraCandidates];
  for (const directory of searchDirectories()) {
    for (const fileName of executableFileNames(name)) {
      candidates.push(path.join(directory, fileName));
    }
  }
  return firstExistingPath(candidates);
}

function augmentedPath() {
  const current = process.env.PATH || "";
  // 区切りはOSで違う（macOS/Linuxは":"、Windowsは";"）。
  // ここを ":" 固定にすると、WindowsではPATH全体が壊れて子プロセスが
  // 何も見つけられなくなる。
  const parts = current.split(path.delimiter);
  for (const dir of COMMON_BIN_DIRS) {
    if (!parts.includes(dir)) parts.push(dir);
  }
  return parts.join(path.delimiter);
}

// Windowsで .cmd / .bat を起動するには cmd.exe を挟むしかない
// （Node 20.12 以降、shell なしでのバッチ起動は塞がれている）。
function needsWindowsShell(command) {
  if (!IS_WINDOWS) return false;
  const extension = path.extname(String(command)).toLowerCase();
  return extension === ".cmd" || extension === ".bat";
}

// cmd.exe へ渡す引数の引用。shell:true のNodeは引数を空白で繋ぐだけで
// 何も逃がしてくれないため、こちらで括ってから渡す。
// 注意: 二重引用符の中でも cmd.exe は %VAR% を展開する。これを打ち消す
// 方法はコマンドラインには無いので、% を含む引数は渡さない前提で使う。
function quoteWindowsArgument(value) {
  const text = String(value);
  if (text === "") return '""';
  if (!/[\s"^&|<>()]/.test(text)) return text;
  // 閉じ引用符の直前のバックスラッシュは倍にする決まり（MSの引数解析規則）。
  const escaped = text
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\+)$/, "$1$1");
  return `"${escaped}"`;
}

function codexExecutable() {
  return findExecutable("codex", [
    process.env.BIKUNAVI_CODEX_PATH,
    "/Applications/Codex.app/Contents/Resources/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex"
  ]);
}

function claudeCliExecutable() {
  return findExecutable("claude", [
    process.env.BIKUNAVI_CLAUDE_CLI_PATH,
    path.join(HOME, ".claude", "local", "claude")
  ]);
}

function geminiCliExecutable() {
  return findExecutable("gemini", [process.env.BIKUNAVI_GEMINI_CLI_PATH]);
}

function unquoteEnvValue(value) {
  const trimmed = String(value || "").trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function geminiApiKey(config) {
  if (config?.geminiApiKey) return config.geminiApiKey;
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;

  // Gemini CLIと同じ保存場所を使う。キーを公開リポジトリやstate.jsonへ保存しない。
  const envPath = path.join(HOME, ".gemini", ".env");
  try {
    // Windowsのst_modeは実際のアクセス権を表していない（常に0666前後を返す）。
    // ここでPOSIXの権限ビットを見ると必ず「危険」と判定してしまうので見ない。
    // Windowsではユーザープロファイル配下のACLが既定で本人と管理者に限られる。
    const mode = IS_WINDOWS ? 0 : fs.statSync(envPath).mode & 0o777;
    if (mode & 0o077) {
      // 手動やCLIが0644で作ったファイルを黙って無視しない。
      // 権限を600へ締めてから読む（締められない場合のみ安全側で不使用）。
      try {
        fs.chmodSync(envPath, 0o600);
        console.log("Gemini .env の権限を600へ変更しました。");
      } catch (chmodError) {
        console.error("Gemini .env が第三者に読める権限のため使用しません:", chmodError.message);
        return "";
      }
    }
    const line = fs
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .find((candidate) => /^\s*(?:export\s+)?GEMINI_API_KEY\s*=/.test(candidate));
    if (!line) return "";
    return unquoteEnvValue(line.replace(/^\s*(?:export\s+)?GEMINI_API_KEY\s*=\s*/, ""));
  } catch (_error) {
    return "";
  }
}

// APIキーが使えるかを、発行元に問い合わせて確かめる。
//
// 以前は「AIzaで始まる39文字以上」のような見た目の検査で弾いていたが、
// これはこちらの推測でしかない。発行元が形式を変えれば正しいキーも弾くし、
// 形が合っているだけの無効なキーは通してしまう。どちらも利用者には
// 理由が分からない。実際に一度問い合わせれば、答えは確実に出る。
//
// トークンを消費しないモデル一覧の取得を使う。
async function verifyApiKey(provider, key) {
  const trimmed = String(key || "").trim();
  if (!trimmed) return { ok: false, message: "キーが空です。" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = provider === "gemini"
      ? await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": trimmed },
        signal: controller.signal
      })
      : await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": trimmed, "anthropic-version": "2023-06-01" },
        signal: controller.signal
      });
    if (response.ok) return { ok: true, message: "" };
    let detail = "";
    try {
      const data = await response.json();
      detail = data?.error?.message || "";
    } catch (_error) {
      detail = "";
    }
    return { ok: false, message: detail || `HTTP ${response.status} で断られました。` };
  } catch (error) {
    // 通信できないだけかもしれない。キーが悪いと決めつけない。
    return {
      ok: false,
      offline: true,
      message: error?.name === "AbortError"
        ? "確認の問い合わせが時間内に終わりませんでした。"
        : `確認の問い合わせに失敗しました（${error?.message || error}）。`
    };
  } finally {
    clearTimeout(timeout);
  }
}

const PROVIDERS = [
  {
    id: "codex",
    label: "Codex CLI",
    isAvailable: () => Boolean(codexExecutable())
  },
  {
    id: "claude-cli",
    label: "Claude Code CLI",
    isAvailable: () => Boolean(claudeCliExecutable())
  },
  {
    id: "gemini-api",
    label: "Gemini API（高速）",
    isAvailable: (config) => Boolean(geminiApiKey(config))
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    isAvailable: () => Boolean(geminiCliExecutable())
  },
  {
    id: "claude-api",
    label: "Claude API（APIキー）",
    isAvailable: (config) => Boolean(config?.anthropicApiKey)
  }
];

// ホームフォルダを ~ に伏せる。この診断は利用者が他人へ貼るものなので、
// アカウント名が残らないようにする。
//
// Windowsは同じ場所を違う大小文字で書く（PATHに "c:\Users\..." と
// "C:\Users\..." が混ざる）。単純な置換では片方が伏せられずに残るため、
// 大小文字を無視して探す。
function maskHome(text, home) {
  const source = String(text);
  if (!home) return source;
  const needle = home.toLowerCase();
  const haystack = source.toLowerCase();
  let result = "";
  let index = 0;
  for (;;) {
    const hit = haystack.indexOf(needle, index);
    if (hit === -1) return result + source.slice(index);
    result += source.slice(index, hit) + "~";
    index = hit + needle.length;
  }
}

// 「使えるAIが見つからない」時に、どこを探して何が無かったのかを見せる。
// 手元にWindows機が無いと、探索先の一つ違いを延々と当てずっぽうで直すことになる。
// ホームフォルダは ~ に伏せる（利用者がそのまま貼れるように）。
function describeProviderDetection(config) {
  const hide = (text) => maskHome(String(text), HOME);
  const lines = [
    `OS: ${process.platform} ${process.arch}`,
    `ホーム: ${hide(HOME)}`,
    "",
    "■ 探した場所（この順）"
  ];
  for (const directory of searchDirectories()) {
    lines.push(`  ${fs.existsSync(directory) ? "あり" : "なし"}  ${hide(directory)}`);
  }
  lines.push("", "■ CLIの実体");
  for (const [name, resolve] of [
    ["codex", codexExecutable],
    ["claude", claudeCliExecutable],
    ["gemini", geminiCliExecutable]
  ]) {
    const found = resolve();
    lines.push(`  ${name}: ${found ? hide(found) : "見つからない"}`);
    if (found) lines.push(`    起動方法: ${needsWindowsShell(found) ? "cmd.exe 経由" : "直接"}`);
  }
  lines.push("", "  探したファイル名: " + executableFileNames("〇〇").join(" / "));
  lines.push("", "■ 会話AIの状態");
  for (const provider of detectProviders(config)) {
    lines.push(`  ${provider.available ? "使える" : "使えない"}  ${provider.label}`);
  }
  // キーそのものは絶対に出さない。有無だけ。
  lines.push("", `Gemini APIキー: ${geminiApiKey(config) ? "設定済み" : "未設定"}`);
  lines.push(`Claude APIキー: ${config?.anthropicApiKey ? "設定済み" : "未設定"}`);
  return lines.join("\n");
}

function detectProviders(config) {
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    available: provider.isAvailable(config)
  }));
}

function resolveProviderId(preference, config) {
  const providers = detectProviders(config);
  if (preference && preference !== "auto") {
    const selected = providers.find((provider) => provider.id === preference);
    if (selected?.available) return selected.id;
    return undefined;
  }
  return providers.find((provider) => provider.available)?.id;
}

function providerLabel(providerId) {
  return PROVIDERS.find((provider) => provider.id === providerId)?.label;
}

// 会話の生成を途中でやめた時のエラー。未ログインやタイムアウトのような
// 「失敗」と区別する。自動モードで次のAIへフォールバックさせない、
// 利用者へエラー文言を出さない、といった判断に使う。
const CHAT_ABORT_ERROR_NAME = "BikunaviChatAborted";

function chatAbortError() {
  const error = new Error("会話の生成を中断しました。");
  error.name = CHAT_ABORT_ERROR_NAME;
  return error;
}

function isChatAbortError(error) {
  return error?.name === CHAT_ABORT_ERROR_NAME;
}

// 打ち切りと中断で使う。Windowsで cmd.exe を挟んだ場合、cmd.exe を殺しても
// その先のCLI本体（node）は生き残る。会話の割り込みが効かなくなるので、
// プロセスの木ごと止める。
function killChildTree(child) {
  if (IS_WINDOWS && child.pid) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" })
        .on("error", () => child.kill("SIGTERM"));
      return;
    } catch (_error) {
      // taskkill を起動できない時は、せめて cmd.exe だけでも止める。
    }
  }
  child.kill("SIGTERM");
}

function runCli(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { signal } = options;
    if (signal?.aborted) {
      reject(chatAbortError());
      return;
    }
    const useWindowsShell = needsWindowsShell(command);
    const child = spawn(
      useWindowsShell ? quoteWindowsArgument(command) : command,
      useWindowsShell ? args.map(quoteWindowsArgument) : args,
      {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: options.cwd,
        env: { ...process.env, PATH: augmentedPath() },
        shell: useWindowsShell
      }
    );
    let output = "";
    let errors = "";
    let timedOut = false;
    let aborted = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      killChildTree(child);
    }, CLI_TIMEOUT_MS);
    const onAbort = () => {
      aborted = true;
      killChildTree(child);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const settle = (callback, value) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };

    child.stdout.on("data", (chunk) => {
      if (output.length < 100000) output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      if (errors.length < 100000) errors += chunk.toString();
    });
    // 中断でkillした直後の書き込みはEPIPEになる。捨てないとunhandled errorで落ちる。
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      settle(reject, aborted ? chatAbortError() : error);
    });
    child.on("close", (code) => {
      const result = output.trim();
      if (aborted) settle(reject, chatAbortError());
      else if (timedOut) settle(reject, new Error(`${path.basename(command)} が時間内に応答しませんでした。`));
      else if (code === 0 && result) settle(resolve, result);
      else settle(reject, new Error(errors.trim() || `${path.basename(command)} から返答を受け取れませんでした。`));
    });
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

function runCodex(prompt, config, _onDelta, signal) {
  const executable = codexExecutable();
  if (!executable) return Promise.reject(new Error("Codex CLIが見つかりませんでした。"));
  return runCli(
    executable,
    [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--sandbox",
      "read-only",
      "--color",
      "never",
      // 配布先ではcwdがgit管理下とは限らない。sandboxはread-onlyなので許容する。
      "--skip-git-repo-check",
      "-C",
      config.cwd,
      "-"
    ],
    { stdin: prompt, cwd: config.cwd, signal }
  );
}

function runClaudeCli(prompt, config, _onDelta, signal) {
  const executable = claudeCliExecutable();
  if (!executable) return Promise.reject(new Error("Claude Code CLIが見つかりませんでした。"));
  // -p（printモード）+ stdin。対話許可を出せないため、ツール実行は自動的に拒否される。
  return runCli(executable, ["-p"], { stdin: prompt, cwd: config.cwd, signal });
}

function runGeminiCli(prompt, config, _onDelta, signal) {
  const executable = geminiCliExecutable();
  if (!executable) return Promise.reject(new Error("Gemini CLIが見つかりませんでした。"));
  // 会話生成にプロジェクトの読み書きは不要。Gemini CLIのツールからBrain内の
  // ファイルへ触れないよう、空の専用ディレクトリ＋読み取り専用Planモードで動かす。
  const cwd = path.join(os.tmpdir(), "bikunavi-gemini");
  fs.mkdirSync(cwd, { recursive: true });
  // プロンプトは -p ではなく標準入力から渡す（パイプで渡すと、その中身が
  // そのままプロンプトになる）。codex や claude と同じ形。
  //
  // 引数で渡すとWindowsで二重に詰む。cmd.exe のコマンドラインは改行を運べず、
  // 長さも約8191文字で頭打ちになる。びくたんのプロンプトはキャラクターシートと
  // 会話履歴を含むのでどちらにも引っかかる。
  return runCli(
    executable,
    ["--skip-trust", "--approval-mode", "plan", "--output-format", "text"],
    { stdin: prompt, cwd, signal }
  );
}

async function runGeminiApiWithModel(prompt, config, onDelta, model, signal) {
  const apiKey = geminiApiKey(config);
  if (!apiKey) {
    throw new Error("Gemini APIキーが設定されていないか、~/.gemini/.env の権限が安全ではありません。");
  }
  const streaming = typeof onDelta === "function";
  if (signal?.aborted) throw chatAbortError();
  const controller = new AbortController();
  // ストリーミングは受信完了まで時間がかかるため、非ストリーミングより長めに待つ
  const timeout = setTimeout(() => controller.abort(), streaming ? 60000 : API_TIMEOUT_MS);
  // タイムアウト用のcontrollerへ、外からの中断も相乗りさせる。
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const endpoint = streaming
    ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 4096,
          thinkingConfig: { thinkingLevel: "minimal" }
        }
      }),
      signal: controller.signal
    });

    if (streaming) {
      if (!response.ok) {
        let data;
        try {
          data = await response.json();
        } catch (_error) {
          data = undefined;
        }
        throw new Error(data?.error?.message || `Gemini APIでエラーが発生しました（HTTP ${response.status}）。`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      const consumeLine = (line) => {
        if (!line.startsWith("data:")) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") return;
        try {
          const data = JSON.parse(payload);
          const text = (data.candidates?.[0]?.content?.parts || [])
            .filter((part) => !part.thought)
            .map((part) => part.text || "")
            .join("");
          if (text) {
            full += text;
            try {
              onDelta(text);
            } catch (_error) {
              // 表示側の失敗で生成まで止めない
            }
          }
        } catch (_error) {
          // 分割されたJSONは無視（次のdata:行で完結する）
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          consumeLine(buffer.slice(0, newlineIndex).trim());
          buffer = buffer.slice(newlineIndex + 1);
        }
      }
      consumeLine(buffer.trim());
      const text = full.trim();
      if (!text) throw new Error("Gemini APIから返答を受け取れませんでした。");
      return text;
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      // 中断とタイムアウトは同じAbortErrorで届くので、発火元で見分ける。
      if (signal?.aborted) throw chatAbortError();
      throw new Error("Gemini APIが時間内に応答しませんでした。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }

  let data;
  try {
    data = await response.json();
  } catch (_error) {
    throw new Error(`Gemini APIから読み取れない応答が返りました（HTTP ${response.status}）。`);
  }
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini APIでエラーが発生しました（HTTP ${response.status}）。`);
  }
  const text = (data.candidates?.[0]?.content?.parts || [])
    .filter((part) => !part.thought)
    .map((part) => part.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini APIから返答を受け取れませんでした。");
  return text;
}

function isGeminiCapacityError(error) {
  return /(?:at capacity|overloaded|resource[_ ]exhausted|temporarily unavailable|HTTP\s*(?:429|503)|\b(?:429|503)\b)/i
    .test(String(error?.message || error || ""));
}

async function runGeminiApi(prompt, config, onDelta, signal) {
  const configuredModel = String(process.env.BIKUNAVI_GEMINI_MODEL || "").trim();
  const models = configuredModel
    ? [configuredModel]
    : ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
  let lastError;
  for (const [index, model] of models.entries()) {
    try {
      return await runGeminiApiWithModel(prompt, config, onDelta, model, signal);
    } catch (error) {
      lastError = error;
      // 中断は「混雑」ではないので、別モデルへ切り替えず即座に伝える。
      if (isChatAbortError(error)) throw error;
      if (!isGeminiCapacityError(error) || index >= models.length - 1) throw error;
      console.warn(`Gemini model busy (${model}); trying ${models[index + 1]}.`);
    }
  }
  throw lastError;
}

// キャラクターシートはどの依頼でも同じ文面が丸ごと入る（約7000文字）。
// これを system へ移してキャッシュすると、2回目以降は読み込みが約1/10の値段になる。
// プロンプトの先頭から一致した部分だけが対象なので、変わらないものを前に出す。
function splitCachedPrefix(rawPrompt) {
  const prompt = String(rawPrompt || "");
  const match = prompt.match(/<character_sheet>[\s\S]*?<\/character_sheet>\n?/);
  if (!match) return { system: "", body: prompt };
  const body = (prompt.slice(0, match.index) + prompt.slice(match.index + match[0].length))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { system: match[0].trim(), body };
}

async function runClaudeApi(prompt, config, onDelta, signal) {
  const apiKey = config?.anthropicApiKey;
  if (!apiKey) throw new Error("Claude APIキーが設定されていません。");
  const client = new Anthropic({ apiKey, timeout: 120000 });
  const model = process.env.BIKUNAVI_CLAUDE_MODEL || "claude-opus-4-8";
  const { system, body } = splitCachedPrefix(prompt);
  const request = {
    model,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    // マスコット用途は短文・低レイテンシ優先
    output_config: { effort: "low" },
    messages: [{ role: "user", content: body }]
  };
  // 毎回同じキャラクターシートを送り直さない。既定のTTLは5分で、
  // 独り言はそれより短い間隔で回るため次の呼び出しで読み出せる。
  if (system) {
    request.system = [
      { type: "text", text: system, cache_control: { type: "ephemeral" } }
    ];
  }
  if (signal?.aborted) throw chatAbortError();
  let response;
  try {
    if (typeof onDelta === "function") {
      const stream = client.messages.stream(request, { signal });
      stream.on("text", (delta) => {
        try {
          onDelta(delta);
        } catch (_error) {
          // 表示側の失敗で生成まで止めない
        }
      });
      response = await stream.finalMessage();
    } else {
      response = await client.messages.create(request, { signal });
    }
  } catch (error) {
    // SDKが投げる中断エラーの型に依存せず、発火元で判定する。
    if (signal?.aborted) throw chatAbortError();
    throw error;
  }
  if (response.stop_reason === "refusal") {
    throw new Error("Claudeがこの内容への回答を控えました。");
  }
  // キャッシュが効いているかは、読み出したトークン数でしか分からない。
  // 0 のまま続くなら、送っている中身が毎回変わっている。
  const usage = response.usage || {};
  const cacheRead = Number(usage.cache_read_input_tokens) || 0;
  const cacheWrite = Number(usage.cache_creation_input_tokens) || 0;
  console.log(
    `Claude API usage: 入力${Number(usage.input_tokens) || 0} ` +
    `/ キャッシュ書込${cacheWrite} / キャッシュ読出${cacheRead} ` +
    `/ 出力${Number(usage.output_tokens) || 0}`
  );
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!text) throw new Error("Claude APIから返答を受け取れませんでした。");
  return text;
}

const RUNNERS = {
  codex: runCodex,
  "claude-cli": runClaudeCli,
  "gemini-api": runGeminiApi,
  "gemini-cli": runGeminiCli,
  "claude-api": runClaudeApi
};

// テキストを受信しながら逐次コールバックできるプロバイダ（API系のみ）
const STREAMABLE = new Set(["claude-api", "gemini-api"]);

function runProvider(providerId, prompt, config, onDelta, signal) {
  const runner = RUNNERS[providerId];
  if (!runner) return Promise.reject(new Error(`未知の会話AIです: ${providerId}`));
  const deltaHandler = STREAMABLE.has(providerId) && typeof onDelta === "function"
    ? onDelta
    : undefined;
  return runner(prompt, config, deltaHandler, signal);
}

module.exports = {
  splitCachedPrefix,
  detectProviders,
  describeProviderDetection,
  verifyApiKey,
  // 検査用。Windowsでのコマンド探索と引用は実機が無いと確かめにくいので、
  // 部品だけ取り出して落ち着いて見られるようにしておく。
  _internals: { augmentedPath, executableFileNames, quoteWindowsArgument, needsWindowsShell, maskHome },
  getGeminiApiKey: geminiApiKey,
  isChatAbortError,
  resolveProviderId,
  providerLabel,
  runProvider
};
