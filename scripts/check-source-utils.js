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

// ID欄が不正でも「news|…|」プレフィックスを本文へ漏らさない（2026-07-18修正の回帰テスト)
{
  const leaked = parseGeneratedIdleLine("news|A3 TechCrunch|新しいモデルが出たみたいですよ。", sources);
  assert.equal(leaked.text, "新しいモデルが出たみたいですよ。");
  assert.deepEqual(leaked.sources, []);
}

// 一覧外の管理IDが本文へ [D8] 形式で混ざっても漏らさない（2026-07-18修正の回帰テスト）
assert.equal(
  sanitizeSpokenSourceIds("この[D8]のデザインの話、面白いですよ。", [], sources).includes("[D8]"),
  false
);

console.log("source-utils: OK");
