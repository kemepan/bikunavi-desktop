const TEXT_LIMITS = Object.freeze({
  characterAnswer: 1000,
  growthAnswer: 1000,
  learnedWord: 1000,
  sharedMemory: 1000
});

function cleanText(rawValue, limit) {
  return String(rawValue ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, limit)
    .trim();
}

function normalizeUserName(rawValue) {
  return String(rawValue ?? "")
    .replace(/\u0000/g, "")
    .replace(/[「」『』]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30)
    .trim();
}

function normalizeDiaryLines(rawValue) {
  return String(rawValue ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/^[-*・]\s*/, "").slice(0, 180).trim())
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeDataEdit(rawCategory, rawValue) {
  const category = String(rawCategory || "");
  if (category === "userName") {
    const value = normalizeUserName(rawValue);
    return value
      ? { ok: true, value }
      : { ok: false, error: "呼び名を入力してください。" };
  }
  if (category === "diary") {
    const value = normalizeDiaryLines(rawValue);
    return value.length
      ? { ok: true, value }
      : { ok: false, error: "日記を1行以上入力してください。" };
  }
  const limit = TEXT_LIMITS[category];
  if (!limit) return { ok: false, error: "この項目は編集できません。" };
  const value = cleanText(rawValue, limit);
  return value
    ? { ok: true, value }
    : { ok: false, error: "内容を入力してください。" };
}

module.exports = {
  normalizeDataEdit,
  normalizeDiaryLines,
  normalizeUserName
};
