// ストリーミング受信中のチャット応答（JSON形式）から、answer本文だけを
// 逐次取り出すための処理。受信途中の不完全なJSONでも、確定した部分までの
// 本文を安全に復元する。

// raw: これまでに受信した生テキスト全体。
// 戻り値: { text: 復元済みのanswer本文, complete: 閉じ引用符まで到達したか }
function extractAnswerText(raw) {
  const source = String(raw || "");
  const key = source.match(/"answer"\s*:\s*"/);
  if (!key) return { text: "", complete: false };
  let index = key.index + key[0].length;
  let out = "";
  while (index < source.length) {
    const char = source[index];
    if (char === '"') return { text: out, complete: true };
    if (char === "\\") {
      if (index + 1 >= source.length) break; // エスケープがチャンク境界で分断
      const next = source[index + 1];
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "u") {
        if (index + 6 > source.length) break; // \uXXXX が途中
        const hex = source.slice(index + 2, index + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
        out += String.fromCharCode(parseInt(hex, 16));
        index += 6;
        continue;
      } else {
        out += next; // \" \\ \/ など
      }
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return { text: out, complete: false };
}

module.exports = { extractAnswerText };
