// AIが無難な normal に偏っても、会話の温度に合う表情へ補正する。

const CHAT_EMOTES = new Set(["joy", "wink", "proud", "surprised", "normal"]);

const SERIOUS_PATTERNS = [
  /申し訳|ごめん|すみません|謝/,
  /危険|注意|警告|深刻|緊急|セキュリティ/,
  /失敗|エラー|壊れ|消え|復旧|できません/,
  /つらい|苦しい|痛い|病気|不安|心配|亡く|死に|死ん|自殺/
];

const SURPRISED_PATTERN = /えっ|わっ|びっくり|驚き|まさか|本当ですか/;
const PROUD_PATTERN = /できました|完了|成功|解決|いけます|うまくいきました/;
const WINK_PATTERN = /ふふ|冥談|つっこみ|ツッコミ|こっそり|内緒/;

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function selectChatEmote(requestedEmote, answerText, userMessage = "") {
  const requested = CHAT_EMOTES.has(requestedEmote) ? requestedEmote : "";
  const text = `${String(userMessage || "")}\n${String(answerText || "")}`;

  if (matchesAny(text, SERIOUS_PATTERNS)) return "normal";
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
