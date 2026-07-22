function cleanChatPunctuation(rawText) {
  return String(rawText || "")
    // JSON内でモデルが「。」「」のような不要な開閉を作ることがある。
    .replace(/([\u3002\uff01\uff1f!?])」[「『]/g, "$1")
    .replace(/」{2,}/g, "」")
    .replace(/「{2,}/g, "「")
    .trim();
}

function recentlyUsedUserName(history, rawUserName, assistantTurns = 2) {
  const userName = String(rawUserName || "").trim();
  if (!userName || !Array.isArray(history)) return false;
  return history
    .filter((turn) => turn?.role === "assistant")
    .slice(-Math.max(1, Number(assistantTurns) || 2))
    .some((turn) => String(turn?.text || "").includes(userName));
}

function isGreetingOnly(rawMessage) {
  const message = String(rawMessage || "")
    .replace(/[\s。！？!?~〜～ー]+/g, "")
    .toLowerCase();
  return /^(?:おはよう|こんにちは|こんばんは|ただいま|おかえり|やっほ|やあ|どうも|おつかれ|お疲れさま)$/.test(message);
}

function looksLikeCorrection(rawMessage) {
  const message = String(rawMessage || "").trim();
  return /(?:違う|そうじゃない|ってこと|言ってない|聞いてない|行ってない|してないよ|じゃないよ)/.test(message);
}

module.exports = {
  cleanChatPunctuation,
  isGreetingOnly,
  looksLikeCorrection,
  recentlyUsedUserName
};
