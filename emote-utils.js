// AIが無難な normal に偏っても、会話の温度に合う表情へ補正する。

// renderer.js の ANSWER_EMOTES と同一内容を保つこと（rendererはブラウザ文脈のため
// requireで共有できない）。表情を追加・削除するときは両方を更新する。
const CHAT_EMOTES = new Set(["joy", "wink", "proud", "surprised", "troubled", "sad", "normal"]);

// 謝罪・失敗は困り顔（troubled）、喪失や悲しみは泣き顔（sad）、
// 危険・注意はまじめな顔（normal）に振り分ける。
const TROUBLED_PATTERNS = [
  /申し訳|ごめん|すみません|謝/,
  /失敗|エラー|壊れ|消え|復旧|できません|うまくできませんでした/
];
const SAD_PATTERNS = [
  /悲し|寂し|さみし|切ない|泣け|涙/,
  /つらい|苦しい|痛い|病気|不安|心配|亡く|死に|死ん|お別れ/
];
const SERIOUS_PATTERNS = [
  /危険|注意|警告|深刻|緊急|セキュリティ|自殺/
];

const SURPRISED_PATTERN = /えっ|わっ|びっくり|驚き|まさか|本当ですか/;
const PROUD_PATTERN = /できました|完了|成功|解決|いけます|うまくいきました/;
const WINK_PATTERN = /ふふ|冗談|つっこみ|ツッコミ|こっそり|内緒/;

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function selectChatEmote(requestedEmote, answerText, userMessage = "") {
  const requested = CHAT_EMOTES.has(requestedEmote) ? requestedEmote : "";
  const text = `${String(userMessage || "")}\n${String(answerText || "")}`;

  if (matchesAny(text, SERIOUS_PATTERNS)) return "normal";
  if (matchesAny(text, SAD_PATTERNS)) {
    // 悲しみ系でもAIがtroubled/normalを選んだ場合はそちらを尊重
    return requested === "troubled" || requested === "normal" ? requested : "sad";
  }
  if (matchesAny(text, TROUBLED_PATTERNS)) {
    return requested === "sad" || requested === "normal" ? requested : "troubled";
  }
  // 深刻な内容でなければ、AIが明確に選んだ表情を尊重する。
  if (requested && requested !== "normal") return requested;
  if (SURPRISED_PATTERN.test(text)) return "surprised";
  if (PROUD_PATTERN.test(text)) return "proud";
  if (WINK_PATTERN.test(text)) return "wink";
  return "joy";
}

module.exports = {
  selectChatEmote
};
