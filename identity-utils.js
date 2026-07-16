// Geminiがユーザーの呼び名をびくたんの一人称へ誤用した場合の安全網。

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SELF_REFERENCE_MARKERS = /(?:好き|苦手|弱い|得意|気にな|思(?:う|い|っ)|感じ|したい|していました|していた|やっていました|眺めていました|見ていました|調べていました|覚えて|憧れ|嬉しい|楽しい|眠い|休んでいました|片づけていました)/;

function repairBikutanSelfReferences(rawText, rawUserName) {
  const text = String(rawText || "");
  const userName = String(rawUserName || "").trim();
  if (!text || !userName) return text;

  const pattern = new RegExp(
    `(^|[\\n。！？!?]\\s*)${escapeRegExp(userName)}は([^\\n。！？!?]{0,160})([。！？!?]|$)`,
    "g"
  );
  return text.replace(pattern, (match, prefix, body, ending) => {
    if (["?", "？"].includes(ending) || !SELF_REFERENCE_MARKERS.test(body)) return match;
    return `${prefix}びくたんは${body}${ending}`;
  });
}

function isSafeIdleUserNameUsage(rawText, rawUserName) {
  const text = String(rawText || "");
  const userName = String(rawUserName || "").trim();
  if (!text || !userName || !text.includes(userName)) return true;

  // 自動セリフで許可するのは呼びかけと「今何してますか？」の質問だけ。
  // 所有・気分・行動を名前付きで断定する文は、誤生成の可能性があるため使わない。
  const allowedUsage = new RegExp(
    `${escapeRegExp(userName)}(?:[、,]|は(?:、\\s*)?今(?:、\\s*)?何(?:を)?して(?:い)?ますか[？?]?)`,
    "g"
  );
  return !text.replace(allowedUsage, "").includes(userName);
}

module.exports = {
  isSafeIdleUserNameUsage,
  repairBikutanSelfReferences
};
