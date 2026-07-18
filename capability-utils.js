// びくたんが実際にはできない観察や操作を、生成後にも止める安全網。

const UNSUPPORTED_CAPABILITY_PATTERNS = [
  // 物理的な代行。休憩を提案すること自体は許可する。
  /(?:コーヒー|珈琲|お茶|紅茶|飲み物|水).{0,12}(?:淹れ|入れ|用意し|作っ|持ってき)(?:ておき|ましょう|ます|ました|てき|ますね|るね)/,
  /(?:掃除|片付け|洗濯|皿洗い|買い物|料理).{0,16}(?:しておき|やっておき|代わりに|任せて)/,
  /(?:持ってき|運んでおき|窓を開け|窓を閉め|電気をつけ|電気を消し)(?:ましょう|ます|ました|ておき)/,

  // 画面や部屋などを実際に観察したという主張。
  /(?:画面|手元|作業内容|成果物|机(?:の上)?|部屋|窓の外|表情|顔色).{0,18}(?:見えています|見えてます|見えました|見ています|見ていました|眺めています|確認しました|気づきました)/,
  /(?:いい香り|匂い|味|部屋の音).{0,12}(?:感じます|わかります|聞こえます|嗅ぎました|味わいました)/,

  // Macや外部サービスを操作したという主張。
  /(?:保存|送信|予約|注文|購入|アプリを起動|アプリを終了|ファイルを削除|ファイルを移動|ファイルをコピー).{0,16}(?:しました|しておきます|やっておきます|任せてください)/
];

const SAFE_CAPABILITY_FALLBACK =
  "それはびくたんには直接できませんが、手順を一緒に考えたり、声をかけたりすることならできます。";

const UNSUPPORTED_IDLE_OBSERVATION_PATTERNS = [
  /窓の外/,
  /(?:部屋|机の上|手元).{0,16}(?:明る|暗く|散らか|片付|見え|あります|ですね)/
];

function isCapabilitySafeLine(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return false;
  return !UNSUPPORTED_CAPABILITY_PATTERNS.some((pattern) => pattern.test(text));
}

function isIdleCapabilitySafeLine(rawText) {
  const text = String(rawText || "").trim();
  return isCapabilitySafeLine(text) &&
    !UNSUPPORTED_IDLE_OBSERVATION_PATTERNS.some((pattern) => pattern.test(text));
}

function sanitizeCapabilityResponse(rawText) {
  const original = String(rawText || "").trim();
  if (!original) return original;

  // よく出やすい飲み物の代行は、実際にできる「休憩の提案」へ直す。
  const rewritten = original.replace(
    /(コーヒー|珈琲|お茶|紅茶|飲み物)(?:を)?(?:淹れ|入れ|用意し|作っ|持ってき)(?:て)?(?:ましょうか|ますか)([？?。！!]*)/g,
    "$1休憩にしますか$2"
  );
  if (isCapabilitySafeLine(rewritten)) return rewritten;

  // 回答全体を捨てず、問題のある文だけを取り除く。
  // （例:「紅茶の入れ方」の説明中の一文が代行表現に一致しても、残りの説明は届ける）
  const sentences = rewritten.match(/[^。！？!?\n]+[。！？!?]?\n?/g) || [rewritten];
  const safeSentences = sentences.filter((sentence) => isCapabilitySafeLine(sentence));
  const salvaged = safeSentences.join("").replace(/\s+$/g, "").trim();
  return salvaged || SAFE_CAPABILITY_FALLBACK;
}

module.exports = {
  SAFE_CAPABILITY_FALLBACK,
  isCapabilitySafeLine,
  isIdleCapabilitySafeLine,
  sanitizeCapabilityResponse
};
