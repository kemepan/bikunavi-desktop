const assert = require("node:assert/strict");
const {
  applyRating,
  filterByRating,
  getRating,
  migrateSavedLinks,
  normalizeRatings
} = require("../source-rating-utils");

const article = { title: "AIの記事", url: "https://example.com/ai", source: "AIニュース" };
const other = { title: "机の記事", url: "https://example.com/desk", source: "暮らし" };

// URLでないものは記録しない。
assert.deepEqual(normalizeRatings([{ url: "javascript:alert(1)" }]), []);
assert.deepEqual(normalizeRatings([{ url: "" }]), []);
assert.deepEqual(normalizeRatings(undefined), []);

// グッドを付ける。
{
  const { ratings, rating, changed } = applyRating([], article, "good");
  assert.equal(rating, "good");
  assert.equal(changed, true);
  assert.equal(ratings.length, 1);
  assert.equal(getRating(ratings, article.url), "good");
}

// 同じボタンをもう一度押したら取り消す。
{
  const first = applyRating([], article, "good");
  const second = applyRating(first.ratings, article, "good");
  assert.equal(second.rating, "");
  assert.equal(second.changed, true);
  assert.equal(second.ratings.length, 0);
  assert.equal(getRating(second.ratings, article.url), "");
}

// 違う側を押したら付け替える（両方が同時に立たない）。
{
  const good = applyRating([], article, "good");
  const bad = applyRating(good.ratings, article, "bad");
  assert.equal(bad.rating, "bad");
  assert.equal(bad.ratings.length, 1);
  assert.equal(getRating(bad.ratings, article.url), "bad");
}

// 別の記事は独立して持つ。
{
  let state = applyRating([], article, "good").ratings;
  state = applyRating(state, other, "bad").ratings;
  assert.equal(state.length, 2);
  assert.deepEqual(filterByRating(state, "good").map((x) => x.url), [article.url]);
  assert.deepEqual(filterByRating(state, "bad").map((x) => x.url), [other.url]);
}

// 未知の評価値は無視する。
{
  const result = applyRating([], article, "great");
  assert.equal(result.changed, false);
  assert.equal(result.ratings.length, 0);
}

// 旧「☆保存」はグッドとして引き継ぐ（貯めた分を捨てない）。
{
  const savedLinks = [
    { ...article, savedAt: 1000 },
    { ...other, savedAt: 2000 }
  ];
  const migrated = migrateSavedLinks(savedLinks, []);
  assert.equal(migrated.length, 2);
  assert.ok(migrated.every((item) => item.rating === "good"));
  // savedAt を評価時刻として引き継ぐ。
  assert.equal(migrated.find((x) => x.url === article.url).ratedAt, 1000);
}

// 移行後に付けた評価のほうが新しければ、そちらが残る。
{
  const savedLinks = [{ ...article, savedAt: 1000 }];
  const existing = [{ ...article, rating: "bad", ratedAt: 5000 }];
  const migrated = migrateSavedLinks(savedLinks, existing);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].rating, "bad");
}

// 同じURLが重複していても1件にまとまる。
{
  const list = normalizeRatings([
    { ...article, rating: "good", ratedAt: 1 },
    { ...article, rating: "bad", ratedAt: 2 }
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].rating, "bad");
}

// 際限なく増えない。
{
  const many = Array.from({ length: 300 }, (_, i) => ({
    title: `記事${i}`,
    url: `https://example.com/${i}`,
    source: "テスト",
    rating: "good",
    ratedAt: i + 1
  }));
  const list = normalizeRatings(many);
  assert.equal(list.length, 200);
  // 新しいものが残る。
  assert.equal(list[list.length - 1].url, "https://example.com/299");
}

console.log("source-rating-utils: OK");
