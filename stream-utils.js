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

// ストリーミング中の本文から「確定した文」だけを取り出す。
// 文末記号のあとに次の文字が届いて初めて確定とみなす（「！」の直後は「！？」と
// 続くかもしれないため）。短すぎる文（6文字未満）は次の文と束ねる。
// offset は text の先頭からの消費済み文字数。emitした分だけ進む。
function takeCompletedSentences(text, offset = 0) {
  const rest = String(text || "").slice(offset);
  const sentences = [];
  let buffer = "";
  let consumed = 0;
  const pattern = /[^。！？!?\n]*[。！？!?\n]+/g;
  let match;
  while ((match = pattern.exec(rest))) {
    // 文末記号で入力が終わっている場合は、まだ記号が続く可能性があるので保留
    if (pattern.lastIndex >= rest.length) break;
    buffer += match[0];
    if (buffer.trim().length >= 6) {
      sentences.push(buffer.trim());
      consumed = pattern.lastIndex;
      buffer = "";
    }
  }
  return { sentences, offset: offset + consumed };
}

module.exports = { extractAnswerText, takeCompletedSentences };
