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
// LaunchAgent 起動時は PATH が最小構成のため、CLI の実体は既知の場所から探す。
const COMMON_BIN_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  path.join(HOME, ".local", "bin"),
  path.join(HOME, "bin")
];

function firstExistingPath(candidates) {
  return candidates.filter(Boolean).find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch (_error) {
      return false;
    }
  });
}

function findExecutable(name, extraCandidates = []) {
  return firstExistingPath([
    ...extraCandidates,
    ...COMMON_BIN_DIRS.map((dir) => path.join(dir, name))
  ]);
}

function augmentedPath() {
  const current = process.env.PATH || "";
  const parts = current.split(":");
  for (const dir of COMMON_BIN_DIRS) {
    if (!parts.includes(dir)) parts.push(dir);
  }
  return parts.join(":");
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
    const mode = fs.statSync(envPath).mode & 0o777;
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

function runCli(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: options.cwd,
      env: { ...process.env, PATH: augmentedPath() }
    });
    let output = "";
    let errors = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, CLI_TIMEOUT_MS);

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
      const result = output.trim();
      if (timedOut) reject(new Error(`${path.basename(command)} が時間内に応答しませんでした。`));
      else if (code === 0 && result) resolve(result);
      else reject(new Error(errors.trim() || `${path.basename(command)} から返答を受け取れませんでした。`));
    });
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

function runCodex(prompt, config) {
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
    { stdin: prompt, cwd: config.cwd }
  );
}

function runClaudeCli(prompt, config) {
  const executable = claudeCliExecutable();
  if (!executable) return Promise.reject(new Error("Claude Code CLIが見つかりませんでした。"));
  // -p（printモード）+ stdin。対話許可を出せないため、ツール実行は自動的に拒否される。
  return runCli(executable, ["-p"], { stdin: prompt, cwd: config.cwd });
}

function runGeminiCli(prompt, config) {
  const executable = geminiCliExecutable();
  if (!executable) return Promise.reject(new Error("Gemini CLIが見つかりませんでした。"));
  // 会話生成にプロジェクトの読み書きは不要。Gemini CLIのツールからBrain内の
  // ファイルへ触れないよう、空の専用ディレクトリ＋読み取り専用Planモードで動かす。
  const cwd = path.join(os.tmpdir(), "bikunavi-gemini");
  fs.mkdirSync(cwd, { recursive: true });
  return runCli(
    executable,
    [
      "--skip-trust",
      "--approval-mode",
      "plan",
      "--output-format",
      "text",
      "-p",
      prompt
    ],
    { cwd }
  );
}

async function runGeminiApi(prompt, config, onDelta) {
  const apiKey = geminiApiKey(config);
  if (!apiKey) {
    throw new Error("Gemini APIキーが設定されていないか、~/.gemini/.env の権限が安全ではありません。");
  }
  const model = process.env.BIKUNAVI_GEMINI_MODEL || "gemini-3.1-flash-lite";
  const streaming = typeof onDelta === "function";
  const controller = new AbortController();
  // ストリーミングは受信完了まで時間がかかるため、非ストリーミングより長めに待つ
  const timeout = setTimeout(() => controller.abort(), streaming ? 60000 : API_TIMEOUT_MS);
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
      throw new Error("Gemini APIが時間内に応答しませんでした。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
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

async function runClaudeApi(prompt, config, onDelta) {
  const apiKey = config?.anthropicApiKey;
  if (!apiKey) throw new Error("Claude APIキーが設定されていません。");
  const client = new Anthropic({ apiKey, timeout: 120000 });
  const model = process.env.BIKUNAVI_CLAUDE_MODEL || "claude-opus-4-8";
  const request = {
    model,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    // マスコット用途は短文・低レイテンシ優先
    output_config: { effort: "low" },
    messages: [{ role: "user", content: prompt }]
  };
  let response;
  if (typeof onDelta === "function") {
    const stream = client.messages.stream(request);
    stream.on("text", (delta) => {
      try {
        onDelta(delta);
      } catch (_error) {
        // 表示側の失敗で生成まで止めない
      }
    });
    response = await stream.finalMessage();
  } else {
    response = await client.messages.create(request);
  }
  if (response.stop_reason === "refusal") {
    throw new Error("Claudeがこの内容への回答を控えました。");
  }
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

function runProvider(providerId, prompt, config, onDelta) {
  const runner = RUNNERS[providerId];
  if (!runner) return Promise.reject(new Error(`未知の会話AIです: ${providerId}`));
  const deltaHandler = STREAMABLE.has(providerId) && typeof onDelta === "function"
    ? onDelta
    : undefined;
  return runner(prompt, config, deltaHandler);
}

module.exports = {
  detectProviders,
  getGeminiApiKey: geminiApiKey,
  resolveProviderId,
  providerLabel,
  runProvider
};
