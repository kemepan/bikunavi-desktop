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
    chatMaxAgeMs = 5 * 60 * 1000
  } = {}) {
    if (String(displayedLineItem?.text || "").trim()) {
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
