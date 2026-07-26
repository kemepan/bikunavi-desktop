// ニュース・情報への「グッド／バッド」評価。
//
// 記事そのものを覚えても次の話題選びには効かない（同じURLは二度と来ない）。
// ここでは評価の記録だけを扱い、話題の傾向への反映は別で行う。
//
// 保存先はMac内の state.json だけ。何に興味があるかの記録そのものなので、
// 外部へ送らず、データ管理画面から確認・削除できるようにする。
(function exposeSourceRatingUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviSourceRating = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const RATINGS = new Set(["good", "bad"]);
  const MAX_ENTRIES = 200;

  function normalizeEntry(raw) {
    const url = String(raw?.url || "");
    if (!/^https?:\/\//.test(url)) return undefined;
    const rating = RATINGS.has(raw?.rating) ? raw.rating : "good";
    return {
      title: String(raw?.title || "").slice(0, 180),
      url: url.slice(0, 1000),
      source: String(raw?.source || "").slice(0, 80),
      rating,
      ratedAt: Number(raw?.ratedAt) || Number(raw?.savedAt) || Date.now()
    };
  }

  // 保存データの読み直し。同じURLは後の評価を残す。
  function normalizeRatings(rawList) {
    const list = Array.isArray(rawList) ? rawList : [];
    const byUrl = new Map();
    for (const raw of list) {
      const entry = normalizeEntry(raw);
      if (!entry) continue;
      const previous = byUrl.get(entry.url);
      if (previous && previous.ratedAt > entry.ratedAt) continue;
      byUrl.set(entry.url, entry);
    }
    return [...byUrl.values()]
      .sort((left, right) => left.ratedAt - right.ratedAt)
      .slice(-MAX_ENTRIES);
  }

  // 旧「☆保存」を引き継ぐ。保存＝好意的な評価とみなす。
  // 貯めた分を捨てないための移行で、一度きり動けばよい。
  function migrateSavedLinks(savedLinks, existingRatings = []) {
    const migrated = (Array.isArray(savedLinks) ? savedLinks : [])
      .map((link) => normalizeEntry({ ...link, rating: "good" }))
      .filter(Boolean);
    if (!migrated.length) return normalizeRatings(existingRatings);
    // 既存の評価を後に置く。移行元より新しい評価があればそちらが勝つ。
    return normalizeRatings([...migrated, ...(existingRatings || [])]);
  }

  // 同じ評価をもう一度渡せば取り消し、違う側なら付け替える。
  // ただし吹き出しのボタンは一度押したら確定で、二度は押せない
  // （切り替わると今どちらを選んだのか分からなくなるため）。
  // 取り消しは、グッドならトレイの「気になる記事」から外せる。
  // バッドの個別取り消しは今はない（データ管理からまとめて消す）。
  function applyRating(ratings, source, rating) {
    if (!RATINGS.has(rating)) {
      return { ratings: normalizeRatings(ratings), rating: "", changed: false };
    }
    const entry = normalizeEntry({ ...source, rating });
    if (!entry) {
      return { ratings: normalizeRatings(ratings), rating: "", changed: false };
    }
    const list = normalizeRatings(ratings);
    const index = list.findIndex((item) => item.url === entry.url);
    if (index >= 0 && list[index].rating === rating) {
      list.splice(index, 1);
      return { ratings: list, rating: "", changed: true };
    }
    if (index >= 0) list.splice(index, 1);
    list.push(entry);
    return { ratings: list.slice(-MAX_ENTRIES), rating, changed: true };
  }

  function getRating(ratings, url) {
    const target = String(url || "");
    const hit = normalizeRatings(ratings).find((item) => item.url === target);
    return hit?.rating || "";
  }

  function filterByRating(ratings, rating) {
    return normalizeRatings(ratings).filter((item) => item.rating === rating);
  }

  return {
    applyRating,
    filterByRating,
    getRating,
    migrateSavedLinks,
    normalizeRatings
  };
});
