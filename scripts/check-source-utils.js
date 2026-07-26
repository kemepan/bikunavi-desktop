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

// 種別欄を落として先頭へIDだけ書く出力（`T58|本文`）。管理IDを本文へ残さない。
// 2026-07-25にセリフ履歴で実際に漏れていた形。
{
  const withTech = new Map([
    ...sources,
    ["T58", { title: "rebaseの記事", url: "https://example.com/git", source: "Tech" }]
  ]);
  const leaked = parseGeneratedIdleLine("T58|Gitのrebase -iは怖くないそうですよ。", withTech);
  assert.equal(leaked.text, "Gitのrebase -iは怖くないそうですよ。");
  assert.equal(leaked.text.includes("T58"), false);
  // 出典も取りこぼさない（これまでは本文に混ざったままsourcesが空だった）。
  assert.equal(leaked.sources.length, 1);
  assert.equal(leaked.kind, "news");

  // 生活ハック系のIDなら kind も揃う。
  assert.equal(parseGeneratedIdleLine("L3|机の上を片付けました。", sources).kind, "life");

  // 複数IDも拾う。
  const multi = parseGeneratedIdleLine("A3,G7|二つの記事を見ました。", sources);
  assert.equal(multi.text, "二つの記事を見ました。");
  assert.equal(multi.sources.length, 2);
}

// 本文が英数字＋縦棒で始まっても、IDの形でなければ本文として残す。
{
  const notId = parseGeneratedIdleLine("Z9|これは管理IDではありません。", sources);
  assert.equal(notId.text, "Z9|これは管理IDではありません。");
}

console.log("source-utils（先頭の管理ID）: OK");
