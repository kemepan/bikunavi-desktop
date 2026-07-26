const assert = require("node:assert/strict");
const {
  extractTopicTerms,
  formatTopicPreference,
  shouldAvoidHeadline,
  summarizeTopicPreference
} = require("../topic-preference-utils");

// 見出しからカタカナ語・英数字語・漢字熟語を拾う（2026-07-25の実データ）。
{
  const terms = extractTopicTerms(
    "人間には読めるのにAIには別の文字に見えてしまうフォント「Decoy Font」が登場 - GIGAZINE"
  );
  assert.ok(terms.includes("フォント"), terms.join(","));
  assert.ok(terms.includes("ai"), terms.join(","));
  assert.ok(terms.includes("decoy"), terms.join(","));
  // どの見出しにも出る語は手がかりにしない。
  assert.equal(terms.includes("登場"), false);
  assert.equal(terms.includes("人間"), false);
}
assert.deepEqual(extractTopicTerms(""), []);
assert.deepEqual(extractTopicTerms(undefined), []);

// 一度きりの評価では偏りが分からないので、好みとして扱わない。
{
  const summary = summarizeTopicPreference([
    { title: "フォントの話", source: "GIGAZINE", rating: "good" }
  ]);
  assert.deepEqual(summary.likedTerms, []);
  assert.deepEqual(summary.likedSources, []);
}

// 2回以上そろえば好みとして扱う。
{
  const summary = summarizeTopicPreference([
    { title: "新しいフォントが出た", source: "GIGAZINE", rating: "good" },
    { title: "フォントの選び方", source: "窓の杜", rating: "good" }
  ]);
  assert.deepEqual(summary.likedTerms.map((x) => x.key), ["フォント"]);
  assert.deepEqual(summary.dislikedTerms, []);
}

// バッドが優勢なら苦手として扱う。
{
  const summary = summarizeTopicPreference([
    { title: "仮想通貨の相場", source: "Crypto", rating: "bad" },
    { title: "仮想通貨がまた動いた", source: "Crypto", rating: "bad" }
  ]);
  assert.deepEqual(summary.dislikedTerms.map((x) => x.key), ["仮想通貨"]);
  assert.deepEqual(summary.dislikedSources.map((x) => x.key), ["crypto"]);
}

// 同じ媒体にグッドとバッドが混ざる場合は、どちらにも寄せない
// （実データのHacker Newsがこの形だった）。
{
  const summary = summarizeTopicPreference([
    { title: "面白い記事", source: "Hacker News", rating: "good" },
    { title: "退屈な記事", source: "Hacker News", rating: "bad" }
  ]);
  assert.deepEqual(summary.likedSources, []);
  assert.deepEqual(summary.dislikedSources, []);
}

// 苦手な語を含む見出しは避ける。
{
  const summary = summarizeTopicPreference([
    { title: "仮想通貨の相場", source: "A", rating: "bad" },
    { title: "仮想通貨がまた動いた", source: "B", rating: "bad" }
  ]);
  assert.equal(shouldAvoidHeadline({ title: "仮想通貨の新サービス", source: "C" }, summary), true);
  assert.equal(shouldAvoidHeadline({ title: "フォントの新作", source: "C" }, summary), false);
  // 判断材料が無ければ何も避けない。
  assert.equal(shouldAvoidHeadline({ title: "仮想通貨の話" }, undefined), false);
  assert.equal(shouldAvoidHeadline({ title: "仮想通貨の話" }, summarizeTopicPreference([])), false);
}

// プロンプトへ渡す文。好みが無ければ空。
{
  assert.equal(formatTopicPreference(summarizeTopicPreference([])), "");
  const summary = summarizeTopicPreference([
    { title: "新しいフォントが出た", source: "GIGAZINE", rating: "good" },
    { title: "フォントの選び方", source: "GIGAZINE", rating: "good" }
  ]);
  const text = formatTopicPreference(summary);
  assert.ok(text.includes("フォント"));
  // 好みへ寄せすぎないよう、必ず釘を刺す。
  assert.ok(text.includes("新しい分野も混ぜて"));
}

console.log("topic-preference-utils: OK");
