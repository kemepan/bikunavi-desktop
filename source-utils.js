// AI向けの参照IDを、吹き出し本文や読み上げへ漏らさないための処理。

const SOURCE_ID = "[ADLGT]\\d{1,3}";

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseSourceIdField(rawValue) {
  const value = String(rawValue || "")
    .replace(/[\[\]]/g, "")
    .trim();
  if (!value) return [];
  if (!new RegExp(`^(?:${SOURCE_ID})(?:\\s*,\\s*(?:${SOURCE_ID}))*$`, "i").test(value)) {
    return [];
  }
  return value.split(",").map((id) => id.trim().toUpperCase()).slice(0, 2);
}

function sourceLabel(source) {
  const label = String(source?.source || "").trim();
  return label || "参考見出し";
}

function sanitizeSpokenSourceIds(rawText, rawSourceIds = [], sourceMap = new Map()) {
  let text = String(rawText || "").trim();
  const sourceIds = [...new Set(
    rawSourceIds.flatMap((value) => parseSourceIdField(value) || [])
  )];

  // Geminiが `本文|A3|` のように列を逆転した場合、末尾の管理IDは話さない。
  text = text.replace(
    new RegExp(`\\s*\\|\\s*(?:${SOURCE_ID})(?:\\s*,\\s*(?:${SOURCE_ID}))*\\s*\\|?\\s*$`, "i"),
    ""
  );

  for (const id of sourceIds) {
    const replacement = sourceLabel(sourceMap.get(id));
    const escapedId = escapeRegExp(id);
    text = text
      .replace(new RegExp(`(?:参照(?:ID|番号)[:：]?\\s*)?[\\[|]${escapedId}[\\]|]`, "gi"), replacement)
      .replace(new RegExp(`(?:参照(?:ID|番号)[:：]?\\s*)?${escapedId}(?=によると|の記事|の見出し|では)`, "gi"), replacement);
  }

  // JSON形式が崩れ、明示的な「参照ID A3」だけが残った場合の最終安全網。
  text = text.replace(
    new RegExp(`参照(?:ID|番号)[:：]?\\s*(?:${SOURCE_ID})`, "gi"),
    "参考見出し"
  );
  return text.replace(/\s{2,}/g, " ").trim();
}

function parseGeneratedIdleLine(rawLine, sourceMap = new Map()) {
  const line = String(rawLine || "").trim();
  const parts = line.split("|").map((part) => part.trim());
  let kind = "normal";
  let text = line;
  let sourceIds = [];

  if (parts.length >= 3 && /^(?:normal|news|life)$/i.test(parts[0])) {
    kind = parts[0].toLowerCase();
    const secondFieldIds = parseSourceIdField(parts[1]);
    const lastFieldIds = parseSourceIdField(parts[parts.length - 1]);
    if (secondFieldIds.length || !parts[1]) {
      sourceIds = secondFieldIds;
      text = parts.slice(2).join("|").trim();
    } else if (lastFieldIds.length) {
      // `news|本文|A3` のように本文とIDを逆にした出力も回収する。
      sourceIds = lastFieldIds;
      text = parts.slice(1, -1).join("|").trim();
    }
  } else {
    const trailing = line.match(
      new RegExp(`\\|\\s*((?:${SOURCE_ID})(?:\\s*,\\s*(?:${SOURCE_ID}))*)\\s*\\|?\\s*$`, "i")
    );
    if (trailing) {
      sourceIds = parseSourceIdField(trailing[1]);
      text = line.slice(0, trailing.index).trim();
      kind = sourceIds[0]?.startsWith("L") ? "life" : "news";
    }
  }

  const invalidSourceIds = sourceIds.filter((id) => !sourceMap.has(id));
  const sources = sourceIds
    .map((id) => sourceMap.get(id))
    .filter(Boolean)
    .map((source) => ({
      title: source.title,
      url: source.url,
      source: source.source
    }));

  return {
    text: sanitizeSpokenSourceIds(text, sourceIds, sourceMap),
    sources,
    sourceIds,
    invalidSourceIds,
    kind
  };
}

module.exports = {
  parseGeneratedIdleLine,
  parseSourceIdField,
  sanitizeSpokenSourceIds
};
