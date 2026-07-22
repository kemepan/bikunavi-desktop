(function exposeConversationContextUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviConversationContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function validTime(rawValue) {
    const value = Number(rawValue);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function pickConversationContext({
    displayedLineItem,
    lastAmbientLine,
    latestChatEntry,
    now = Date.now(),
    ambientMaxAgeMs = 90000,
    chatMaxAgeMs = 5 * 60 * 1000,
    directMaxAgeMs = 10 * 60 * 1000
  } = {}) {
    // 表示しっぱなしのセリフを、何時間経っても「いま返信された先」として
    // 渡さない。古い独り言へ話を寄せると、目の前の発言が無視される。
    const displayedTime = validTime(displayedLineItem?.time);
    const displayedIsFresh = !displayedTime ||
      (now - displayedTime >= 0 && now - displayedTime < directMaxAgeMs);
    if (String(displayedLineItem?.text || "").trim() && displayedIsFresh) {
      return { item: displayedLineItem, direct: true };
    }

    const candidates = [];
    const ambientTime = validTime(lastAmbientLine?.time);
    if (
      String(lastAmbientLine?.text || "").trim() &&
      ambientTime &&
      now - ambientTime >= 0 &&
      now - ambientTime < ambientMaxAgeMs
    ) {
      candidates.push({
        item: lastAmbientLine,
        time: ambientTime
      });
    }

    const chatTime = validTime(latestChatEntry?.time);
    const latestAnswer = String(latestChatEntry?.answer || "").trim();
    const isFailedAnswer = latestAnswer.startsWith("うまく考えられませんでした");
    if (
      latestAnswer &&
      !isFailedAnswer &&
      chatTime &&
      now - chatTime >= 0 &&
      now - chatTime < chatMaxAgeMs
    ) {
      candidates.push({
        item: {
          text: latestAnswer,
          sources: Array.isArray(latestChatEntry.sources) ? latestChatEntry.sources : [],
          kind: "recent-answer",
          time: chatTime
        },
        time: chatTime
      });
    }

    candidates.sort((left, right) => right.time - left.time);
    return { item: candidates[0]?.item, direct: false };
  }

  return { pickConversationContext };
});
