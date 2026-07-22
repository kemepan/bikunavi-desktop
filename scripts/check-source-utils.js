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
    kind: "news",
    continues: false
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

// 独り言の「続き」行。話題は先頭の行が持つので種別は通常セリフ扱いにする。
{
  const first = parseGeneratedIdleLine("normal||リギングのボーン、名前で悩みますよね。", sources);
  assert.equal(first.continues, false);
  assert.equal(first.kind, "normal");

  const next = parseGeneratedIdleLine("cont||結局あとで自分が読めるかどうかなんですよね。", sources);
  assert.equal(next.continues, true);
  assert.equal(next.kind, "normal");
  assert.equal(next.text, "結局あとで自分が読めるかどうかなんですよね。");

  // ニュースの続きでも、種別は通常セリフ・出典なしで扱う（出典は先頭の行に付く）。
  const newsFollowUp = parseGeneratedIdleLine("cont|A3|さっきの話、実際どう動くのか気になります。", sources);
  assert.equal(newsFollowUp.continues, true);
  assert.equal(newsFollowUp.kind, "normal");
  assert.equal(newsFollowUp.text, "さっきの話、実際どう動くのか気になります。");
}

// 「cont」を本文に含む普通のセリフを、続き扱いにしない。
{
  const notContinuation = parseGeneratedIdleLine("normal||contという名前の変数、よく見かけます。", sources);
  assert.equal(notContinuation.continues, false);
  assert.equal(notContinuation.text, "contという名前の変数、よく見かけます。");
}

console.log("source-utils: OK");
