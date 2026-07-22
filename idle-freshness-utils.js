// 独り言は20行まとめて作り置きしてキューへ入れるため、話される頃には
// 生成時と時間帯がずれていることがある。深夜に作った「深夜0時を過ぎましたね」を
// 朝に話すと会話が噛み合わなくなるので、時間に触れる行だけ捨てる。
(function exposeIdleFreshnessUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviIdleFreshness = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  // 時間帯・時刻・時間帯に紐づく挨拶に触れている行。
  // 「時間」「時々」を拾わないよう、時は数字が前に付く場合だけ見る。
  const TIME_SENSITIVE = /(深夜|未明|早朝|朝|昼|正午|午後|夕方|夕暮|夜|おはよう|こんにちは|こんばんは|おやすみ|\d{1,2}\s*時)/;

  function isTimeSensitiveLine(rawText) {
    return TIME_SENSITIVE.test(String(rawText || ""));
  }

  function isStaleIdleLine(item, { now = Date.now(), slot = "", maxAgeMs = 6 * 60 * 60 * 1000 } = {}) {
    if (!item) return false;
    // 作ってから経ちすぎた行は、時間に触れていなくても話の鮮度が落ちている。
    const generatedAt = Number(item.generatedAt) || 0;
    if (generatedAt && now - generatedAt > maxAgeMs) return true;

    const generatedSlot = String(item.slot || "");
    const currentSlot = String(slot || "");
    // 生成時の時間帯が分からない行（定型文など）は判定しない。
    if (!generatedSlot || !currentSlot || generatedSlot === currentSlot) return false;
    return isTimeSensitiveLine(item.text);
  }

  return { isTimeSensitiveLine, isStaleIdleLine };
});
