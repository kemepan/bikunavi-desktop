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
