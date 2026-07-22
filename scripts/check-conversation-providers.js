const assert = require("node:assert/strict");
const { runProvider } = require("../conversation-providers");

(async () => {
  const originalFetch = global.fetch;
  const requestedUrls = [];
  try {
    global.fetch = async (url) => {
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
    };

    const result = await runProvider(
      "gemini-api",
      "test prompt",
      { geminiApiKey: "test-key", cwd: process.cwd() }
    );
    assert.equal(result, "fallback ok");
    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[0], /gemini-3\.5-flash-lite/);
    assert.match(requestedUrls[1], /gemini-3\.1-flash-lite/);
    console.log("conversation-providers: OK");
  } finally {
    global.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
