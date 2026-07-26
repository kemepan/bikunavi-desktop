// グッド／バッドの評価から、話題の好みを割り出す。
//
// 記事そのものを覚えても次には効かない（同じURLは二度と来ない）。
// 効くのは傾向なので、見出しから語を取り出して集計する。
//
// 媒体だけでは足りない。実データでは同じHacker Newsにグッドとバッドが
// 混ざっていた。媒体と語の両方を見る。
(function exposeTopicPreferenceUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviTopicPreference = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  // どの見出しにも出るような語は、好みの手がかりにならない。
  const STOP_TERMS = new Set([
    "登場", "発表", "公開", "提供", "開始", "実施", "対応", "利用", "活用",
    "使用", "導入", "検討", "実現", "可能", "必要", "方法", "場合", "自分",
    "今回", "最新", "話題", "記事", "内容", "情報", "本日", "今年", "来年",
    "企業", "会社", "日本", "世界", "人間", "自動", "無料", "有料", "機能"
  ]);

  function normalizeTerm(term) {
    return String(term || "").trim().toLowerCase();
  }

  // 見出しから手がかりになりそうな語を抜く。形態素解析は使わず、
  // カタカナ語・英数字語・漢字熟語だけを拾う。
  function extractTopicTerms(rawTitle) {
    const title = String(rawTitle || "");
    const terms = [];
    const push = (value) => {
      const term = normalizeTerm(value);
      if (!term || STOP_TERMS.has(term) || terms.includes(term)) return;
      terms.push(term);
    };
    for (const match of title.matchAll(/[ァ-ヴー]{3,}/g)) push(match[0]);
    for (const match of title.matchAll(/[A-Za-z][A-Za-z0-9+#.]{1,}/g)) push(match[0]);
    for (const match of title.matchAll(/[一-龠]{2,4}/g)) push(match[0]);
    return terms.slice(0, 12);
  }

  function tally(map, key, rating) {
    if (!key) return;
    const entry = map.get(key) || { good: 0, bad: 0 };
    if (rating === "good") entry.good += 1;
    else if (rating === "bad") entry.bad += 1;
    map.set(key, entry);
  }

  // 好み・苦手を割り出す。
  // 一度きりの評価では偏りが分からないので、minSamples 回以上ついたものだけ使う。
  function summarizeTopicPreference(ratings, { minSamples = 2, maxItems = 8 } = {}) {
    const termCounts = new Map();
    const sourceCounts = new Map();
    for (const entry of Array.isArray(ratings) ? ratings : []) {
      const rating = entry?.rating;
      if (rating !== "good" && rating !== "bad") continue;
      tally(sourceCounts, normalizeTerm(entry.source), rating);
      for (const term of extractTopicTerms(entry.title)) tally(termCounts, term, rating);
    }

    const split = (counts) => {
      const liked = [];
      const disliked = [];
      for (const [key, { good, bad }] of counts) {
        if (good + bad < minSamples) continue;
        if (good > bad) liked.push({ key, good, bad });
        else if (bad > good) disliked.push({ key, good, bad });
      }
      const byStrength = (left, right) => (
        Math.abs(right.good - right.bad) - Math.abs(left.good - left.bad)
      );
      return {
        liked: liked.sort(byStrength).slice(0, maxItems),
        disliked: disliked.sort(byStrength).slice(0, maxItems)
      };
    };

    const terms = split(termCounts);
    const sources = split(sourceCounts);
    return {
      likedTerms: terms.liked,
      dislikedTerms: terms.disliked,
      likedSources: sources.liked,
      dislikedSources: sources.disliked
    };
  }

  // 見出しを避けるべきか。苦手と分かっている語・媒体を含む時だけ true。
  function shouldAvoidHeadline(headline, summary) {
    if (!summary) return false;
    const title = String(headline?.title || "");
    const source = normalizeTerm(headline?.source);
    if ((summary.dislikedSources || []).some((item) => item.key && item.key === source)) {
      return true;
    }
    const terms = extractTopicTerms(title);
    return (summary.dislikedTerms || []).some((item) => terms.includes(item.key));
  }

  // 好みをプロンプトへ渡す文。無ければ空文字。
  function formatTopicPreference(summary) {
    if (!summary) return "";
    const liked = [
      ...(summary.likedTerms || []).map((item) => item.key),
      ...(summary.likedSources || []).map((item) => item.key)
    ].slice(0, 10);
    if (!liked.length) return "";
    return [
      "以下は、これまで「気になる」と言われた話題の傾向です。似た切り口を少し多めに選んでください。",
      `- ${liked.join(" / ")}`,
      "ただし毎回この話題に寄せず、新しい分野も混ぜてください。"
    ].join("\n");
  }

  return {
    extractTopicTerms,
    formatTopicPreference,
    shouldAvoidHeadline,
    summarizeTopicPreference
  };
});
