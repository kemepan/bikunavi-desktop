const assert = require("node:assert/strict");
const {
  parseGeneratedIdleLine,
  sanitizeSpokenSourceIds
} = require("../source-utils");

const sources = new Map([
  ["A3", { title: "AIの記事", url: "https://example.com/ai", source: "AIニュース" }],
  ["G7", { title: "天気の記事", url: "https://example.com/weather", source: "天気ニュース" }]
]);

assert.deepEqual(
  parseGeneratedIdleLine("news|A3|新しいモデルが出ました。", sources),
  {
    text: "新しいモデルが出ました。",
    sources: [{ title: "AIの記事", url: "https://example.com/ai", source: "AIニュース" }],
    sourceIds: ["A3"],
    invalidSourceIds: [],
    kind: "news"
  }
);
assert.equal(
  parseGeneratedIdleLine("新しいモデルが出ました。|A3|", sources).text,
  "新しいモデルが出ました。"
);
assert.equal(
  parseGeneratedIdleLine("news|新しいモデルが出ました。|A3", sources).sources.length,
  1
);
assert.deepEqual(
  parseGeneratedIdleLine("未確認のニュースです。|A49|", sources).invalidSourceIds,
  ["A49"]
);
assert.equal(
  sanitizeSpokenSourceIds("A3によると新機能が出ました。", ["A3"], sources),
  "AIニュースによると新機能が出ました。"
);

console.log("source-utils: OK");
