const assert = require("node:assert/strict");
const { createSpeechProviderRegistry } = require("../speech-provider-utils");

const synthesize = async () => "/tmp/test.wav";
const registry = createSpeechProviderRegistry([
  {
    id: "voicevox",
    label: "VOICEVOX",
    synthesize,
    capabilities: { sentenceStreaming: true }
  },
  { id: "macos", label: "macOS音声", synthesize }
], { fallbackIds: ["macos", "macos", "unknown"] });

assert.equal(registry.get("voicevox").label, "VOICEVOX");
assert.equal(registry.supports("voicevox", "sentenceStreaming"), true);
assert.equal(registry.supports("macos", "sentenceStreaming"), false);
assert.deepEqual(
  registry.getFallbackChain("voicevox").map((provider) => provider.id),
  ["voicevox", "macos"]
);
assert.deepEqual(
  registry.getFallbackChain("macos").map((provider) => provider.id),
  ["macos"]
);
assert.deepEqual(
  registry.getFallbackChain("unknown").map((provider) => provider.id),
  ["macos"]
);
assert.throws(
  () => createSpeechProviderRegistry([{ id: "Bad ID", synthesize }]),
  /IDが不正/
);
assert.throws(
  () => createSpeechProviderRegistry([{ id: "broken" }]),
  /音声合成関数/
);

console.log("speech-provider-utils: OK");
