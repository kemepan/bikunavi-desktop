// 読み上げテキストの文単位分割。
// 長文を1回で合成すると話し始めまでの無音が長いので、文単位に区切って
// 「1文目を合成したら即再生、再生中に次の文を先行合成」で繋ぐための下ごしらえ。

function splitIntoSpeechChunks(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return [];
  const parts = text.match(/[^。！？!?\n]+[。！？!?]*\n?/g) || [text];
  const chunks = [];
  let buffer = "";
  for (const part of parts) {
    buffer += part;
    // 短すぎる文（相槌など）は次と束ねて、合成リクエスト回数と文間の間延びを減らす
    if (buffer.trim().length >= 8) {
      chunks.push(buffer.trim());
      buffer = "";
    }
  }
  const rest = buffer.trim();
  if (rest) {
    if (chunks.length && rest.length < 6) chunks[chunks.length - 1] += rest;
    else chunks.push(rest);
  }
  return chunks;
}

module.exports = { splitIntoSpeechChunks };
