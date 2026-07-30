const assert = require("node:assert/strict");
const { extractSearchQuery, makeSearchUrl } = require("../search-request-utils");

// 実際に言われた形（2026-07-30）。
assert.equal(extractSearchQuery("ハーベストマン検索して"), "ハーベストマン");

// よくある頼み方。
assert.equal(extractSearchQuery("ハーベストマンを検索して"), "ハーベストマン");
assert.equal(extractSearchQuery("ハーベストマンについて調べて"), "ハーベストマン");
assert.equal(extractSearchQuery("Live2D 物理演算 をググって"), "Live2D 物理演算");
assert.equal(extractSearchQuery("検索: 動くマスコット"), "動くマスコット");
assert.equal(extractSearchQuery("ウェブ検索してほしい"), "");  // 何を、が無い

// 依頼ではないもの。答えを返してほしい場面なので、リンクを出さない。
assert.equal(extractSearchQuery("検索できるの？"), "");
assert.equal(extractSearchQuery("web検索はできない？"), "");
assert.equal(extractSearchQuery("検索の方法"), "");
assert.equal(extractSearchQuery("ハーベストマンって何？"), "");

// 前置きは落とす。
assert.equal(extractSearchQuery("ちょっとハーベストマン調べて"), "ハーベストマン");

// 1文字は聞き間違いのことが多い。
assert.equal(extractSearchQuery("あ検索して"), "");

// 検索の依頼ではない普通の会話。
assert.equal(extractSearchQuery("おはよう"), "");
assert.equal(extractSearchQuery("今日は暑いですね"), "");
assert.equal(extractSearchQuery(""), "");
assert.equal(extractSearchQuery(undefined), "");

// 長すぎるものは検索語ではない（会話の一部）。
assert.equal(extractSearchQuery("あ".repeat(130) + "を検索して"), "");

// URL の組み立て。
assert.equal(
  makeSearchUrl("ハーベストマン"),
  "https://www.google.com/search?q=%E3%83%8F%E3%83%BC%E3%83%99%E3%82%B9%E3%83%88%E3%83%9E%E3%83%B3"
);
assert.equal(makeSearchUrl(""), "");
assert.match(makeSearchUrl("a b"), /q=a%20b|q=a\+b/);

console.log("search-request-utils: OK");
