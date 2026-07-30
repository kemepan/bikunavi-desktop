// 「〜を検索して」と頼まれた時に、検索リンクを渡すための判定。
//
// びくたん自身は外のページを読まない。読んだふりをすると、
// 見ていないことを見たように話すことになる。代わりに、
// 開けばすぐ探せるリンクを渡す（YouTube検索と同じ考え方）。
(function exposeSearchRequestUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviSearchRequest = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  // 「検索」「調べて」で終わる頼み方を拾う。
  // 「検索できないの？」のような問いかけは、依頼ではないので外す。
  const REQUEST_PATTERNS = [
    /^(.+?)\s*(?:を|について)?\s*(?:で)?(?:ウェブ|web|ネット)?検索(?:して|してみて|お願い|頼む)?[。！!？?]?$/i,
    /^(.+?)\s*(?:を|について)?\s*(?:調べて|ググって|検索かけて)(?:みて|ください|くれる|ほしい)?[。！!？?]?$/,
    /^(?:ウェブ|web|ネット)?検索[：:]\s*(.+)$/i
  ];

  // 依頼ではないもの。聞かれているだけなら答えを返したい。
  const NOT_A_REQUEST = /(?:できる|できない|できます|可能|方法|やり方|とは|って何|なに)[?？]?$/;

  function extractSearchQuery(rawText) {
    const text = String(rawText || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 120) return "";
    if (NOT_A_REQUEST.test(text)) return "";
    for (const pattern of REQUEST_PATTERNS) {
      const match = text.match(pattern);
      const query = String(match?.[1] || "").trim()
        // 前置きが付いたまま渡さない。
        .replace(/^(?:ちょっと|あとで|これ|それ|あの)\s*/, "")
        .trim();
      // 1文字だと聞き間違いのことが多い。検索しても役に立たない。
      if (query.length >= 2) return query;
    }
    return "";
  }

  function makeSearchUrl(query) {
    const safe = String(query || "").trim();
    if (!safe) return "";
    return `https://www.google.com/search?q=${encodeURIComponent(safe)}`;
  }

  return { extractSearchQuery, makeSearchUrl };
});
