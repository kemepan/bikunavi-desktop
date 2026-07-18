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
    // 「〜ですね」「〜ますね」等で終わる文はユーザーへの相槌（相手の話の反映）なので
    // 主語を書き換えない。書き換えるのは、びくたんの一人称誤用らしい断定文だけ。
    if (/(?:です|ます|でした|ました|ん)ね$/.test(body)) return match;
    return `${prefix}びくたんは${body}${ending}`;
  });
}

// 2026-07-16の開発途中版で「びくにたん」を一律「びくたん」へ変換した履歴だけを修復する。
// 自分について述べる「びくたんは〜」は残し、ユーザーへ尋ねる呼びかけだけを戻す。
function restoreLegacyUserVocatives(rawText, rawUserName) {
  const text = String(rawText || "");
  const userName = String(rawUserName || "").trim();
  if (!text || userName !== "びくにたん") return text;

  return text
    .replace(
      /(^|[\n。！？!?]\s*)びくたん([、,])(?=[^\n。！？!?]{0,120}(?:ますか|ですか|ましょうか|どう|どっち|何|一緒))/g,
      `$1${userName}$2`
    )
    .replace(
      /(^|[\n。！？!?]\s*)びくたん(は|も)([^\n。！？!?]{0,120}(?:ますか|ですか|でしょうか|みますか|みます|どうしますか)[？?])/g,
      `$1${userName}$2$3`
    );
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
  repairBikutanSelfReferences,
  restoreLegacyUserVocatives
};
