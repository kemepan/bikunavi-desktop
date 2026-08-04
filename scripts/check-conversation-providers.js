const assert = require("node:assert/strict");
const { runProvider, isChatAbortError } = require("../conversation-providers");

const config = { geminiApiKey: "test-key", cwd: process.cwd() };

async function withStubbedFetch(stub, body) {
  const originalFetch = global.fetch;
  global.fetch = stub;
  try {
    return await body();
  } finally {
    global.fetch = originalFetch;
  }
}

(async () => {
  // 混雑しているモデルからは、次のモデルへ自動で退避する。
  {
    const requestedUrls = [];
    await withStubbedFetch(async (url) => {
      requestedUrls.push(String(url));
      if (requestedUrls.length === 1) {
        return {
          ok: false,
          status: 503,
          json: async () => ({
            error: { message: "Selected model is at capacity. Please try a different model." }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "fallback ok" }] } }]
        })
      };
    }, async () => {
      const result = await runProvider("gemini-api", "test prompt", config);
      assert.equal(result, "fallback ok");
      assert.equal(requestedUrls.length, 2);
      assert.match(requestedUrls[0], /gemini-3\.5-flash-lite/);
      assert.match(requestedUrls[1], /gemini-3\.1-flash-lite/);
    });
  }

  assert.equal(isChatAbortError(Object.assign(new Error("x"), { name: "BikunaviChatAborted" })), true);
  assert.equal(isChatAbortError(new Error("普通の失敗")), false);
  assert.equal(isChatAbortError(undefined), false);

  // 既に中断済みなら、リクエストを投げずに中断エラーで返す。
  {
    let called = 0;
    await withStubbedFetch(async () => {
      called += 1;
      return { ok: true, status: 200, json: async () => ({}) };
    }, async () => {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        runProvider("gemini-api", "test prompt", config, undefined, controller.signal),
        (error) => isChatAbortError(error)
      );
      assert.equal(called, 0);
    });
  }

  // 生成の途中で中断した時は、タイムアウト扱いにせず中断エラーにする。
  // そして別モデルへは退避しない（利用者が話しかけて割り込んだのだから、
  // 同じ質問を別のAIで蒸し返さない）。
  {
    const requestedUrls = [];
    await withStubbedFetch((url, options) => {
      requestedUrls.push(String(url));
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }, async () => {
      const controller = new AbortController();
      const pending = runProvider("gemini-api", "test prompt", config, undefined, controller.signal);
      controller.abort();
      await assert.rejects(pending, (error) => {
        assert.equal(isChatAbortError(error), true);
        assert.doesNotMatch(String(error.message), /時間内/);
        return true;
      });
      assert.equal(requestedUrls.length, 1);
    });
  }

  // 中断していないのに届いたAbortErrorは内側のタイムアウト。
  // これまでどおりタイムアウトとして伝える（中断と取り違えない）。
  {
    await withStubbedFetch(async () => {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      throw error;
    }, async () => {
      const controller = new AbortController();
      await assert.rejects(
        runProvider("gemini-api", "test prompt", config, undefined, controller.signal),
        (error) => {
          assert.equal(isChatAbortError(error), false);
          assert.match(String(error.message), /時間内/);
          return true;
        }
      );
    });
  }

  console.log("conversation-providers: OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// キャラクターシートを system へ切り出し、本文へ残さない（キャッシュのため）。
{
  const { splitCachedPrefix } = require("../conversation-providers");

  const prompt = [
    "あなたはびくたんです。",
    "<character_sheet>\n# シート\n- 明るい\n</character_sheet>",
    "記事から独り言を作ってください。"
  ].join("\n");
  const r = splitCachedPrefix(prompt);
  assert.ok(r.system.startsWith("<character_sheet>"));
  assert.ok(r.system.includes("明るい"));
  assert.equal(r.body.includes("明るい"), false);
  assert.equal(r.body.includes("<character_sheet>"), false);
  // 前後の指示は順番どおり残る。
  assert.ok(r.body.startsWith("あなたはびくたんです。"));
  assert.ok(r.body.endsWith("記事から独り言を作ってください。"));

  // シートが無いプロンプトは、そのまま本文として扱う。
  const plain = splitCachedPrefix("ふつうの依頼です。");
  assert.equal(plain.system, "");
  assert.equal(plain.body, "ふつうの依頼です。");

  // 空でも落ちない。
  assert.deepEqual(splitCachedPrefix(""), { system: "", body: "" });
  assert.deepEqual(splitCachedPrefix(undefined), { system: "", body: "" });
}

console.log("conversation-providers（キャッシュ用の切り出し）: OK");

// --- Windowsまわりの部品 ---
{
  const path = require("node:path");
  const { _internals } = require("../conversation-providers");
  const { augmentedPath, executableFileNames, quoteWindowsArgument, needsWindowsShell } = _internals;

  // PATHの区切りはOSに合わせる。ここが ":" 固定だとWindowsでPATHが壊れ、
  // 子プロセスがコマンドを何も見つけられなくなる（v0.4で実際に起きた）。
  const originalPath = process.env.PATH;
  process.env.PATH = ["a", "b"].join(path.delimiter);
  const augmented = augmentedPath();
  assert.ok(augmented.startsWith(`a${path.delimiter}b${path.delimiter}`));
  assert.equal(augmented.split(path.delimiter).includes("a"), true);
  assert.equal(augmented.split(path.delimiter).includes("b"), true);
  // 元のPATHの要素が分断されていない。
  assert.equal(augmented.split(path.delimiter).some((part) => part === ""), false);
  process.env.PATH = originalPath;

  if (process.platform === "win32") {
    // 拡張子なしはnpmが置くsh用スクリプト。Windowsからは起動できないので候補に入れない。
    assert.deepEqual(executableFileNames("gemini"), [
      "gemini.exe", "gemini.com", "gemini.cmd", "gemini.bat"
    ]);
    assert.equal(needsWindowsShell("C:\\x\\gemini.cmd"), true);
    assert.equal(needsWindowsShell("C:\\x\\gemini.CMD"), true);
    // .exe はcmd.exeを挟まずに直接起動できる。
    assert.equal(needsWindowsShell("C:\\x\\claude.exe"), false);
  } else {
    assert.deepEqual(executableFileNames("gemini"), ["gemini"]);
    assert.equal(needsWindowsShell("/usr/local/bin/gemini.cmd"), false);
  }

  // cmd.exe へ渡す引用。空白を含むパスが割れると別物のコマンドになる。
  assert.equal(quoteWindowsArgument("-p"), "-p");
  assert.equal(quoteWindowsArgument("C:\\Program Files\\x"), '"C:\\Program Files\\x"');
  assert.equal(quoteWindowsArgument(""), '""');
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"');
  // 閉じ引用符の直前のバックスラッシュは倍にする（MSの引数解析規則）。
  assert.equal(quoteWindowsArgument("a b\\"), '"a b\\\\"');
  // cmd.exe の記号は引用符で囲って無害化する。
  assert.equal(quoteWindowsArgument("a&b"), '"a&b"');
}

console.log("conversation-providers（Windowsのコマンド探索と引用）: OK");

// --- 診断からアカウント名を消す ---
{
  const { maskHome } = require("../conversation-providers")._internals;

  assert.equal(maskHome("/Users/a/.local/bin", "/Users/a"), "~/.local/bin");
  // Windowsは同じ場所を違う大小文字で書く。PATHに紛れた小文字の "c:" でも
  // 伏せられないと、他人へ貼る診断にアカウント名が残る。
  assert.equal(
    maskHome("c:\\Users\\name\\AppData\\Local\\Programs\\x", "C:\\Users\\name"),
    "~\\AppData\\Local\\Programs\\x"
  );
  // 1行に複数出てきても全部消す。
  assert.equal(
    maskHome("C:\\Users\\name;c:\\Users\\name\\bin", "C:\\Users\\name"),
    "~;~\\bin"
  );
  // 元の大小文字は、伏せない部分では変えない。
  assert.equal(maskHome("D:\\Program Files\\Git", "C:\\Users\\name"), "D:\\Program Files\\Git");
  assert.equal(maskHome("なにもない", ""), "なにもない");
}

console.log("conversation-providers（診断のアカウント名伏せ）: OK");

// --- 子プロセスへ渡す環境変数 ---
{
  const path = require("node:path");
  const { childEnvironment } = require("../conversation-providers")._internals;

  const originalEnv = process.env;
  // Windows は環境変数を大文字小文字で区別しない。OSが持っているのは "Path"。
  // そこへ "PATH" を足すと、同じ変数が2つ入った env を子へ渡すことになり、
  // どちらが採用されるか保証がない（増強が黙って無効になる）。
  process.env = { Path: ["a", "b"].join(path.delimiter), OTHER: "keep" };
  const env = childEnvironment();
  const pathKeys = Object.keys(env).filter((key) => key.toLowerCase() === "path");
  assert.deepEqual(pathKeys, ["PATH"]);
  assert.equal(env.OTHER, "keep");
  assert.ok(env.PATH.startsWith(`a${path.delimiter}b${path.delimiter}`));

  // 大文字の PATH しか無い環境（macOS/Linux）でも増えない。
  process.env = { PATH: "/x" };
  assert.deepEqual(Object.keys(childEnvironment()).filter((k) => k.toLowerCase() === "path"), ["PATH"]);

  // 変な大小文字混在でも1つにまとまる。
  process.env = { PaTh: "/y" };
  assert.deepEqual(Object.keys(childEnvironment()).filter((k) => k.toLowerCase() === "path"), ["PATH"]);

  process.env = originalEnv;
}

console.log("conversation-providers（子プロセスのPATH）: OK");
