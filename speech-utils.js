// 読み上げテキストの分割。
// 「意味が通る単位＝1文」ごとに完結して合成し、1文目ができた時点で話し始める。
// 各文は丸ごと合成してから再生するので、文の途中で音が途切れることはない。
// 文間に間が入る場合も、文の境目（自然な息継ぎ位置）に限られる。
// 相槌などの極端に短い文（6文字未満）だけは次の文と束ねて、間延びを防ぐ。

function splitIntoSpeechChunks(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return [];
  const parts = text.match(/[^。！？!?\n]+[。！？!?]*\n?/g) || [text];
  const chunks = [];
  let buffer = "";
  for (const part of parts) {
    buffer += part;
    if (buffer.trim().length >= 6) {
      chunks.push(buffer.trim());
      buffer = "";
    }
  }
  const rest = buffer.trim();
  if (rest) {
    if (chunks.length) chunks[chunks.length - 1] += rest;
    else chunks.push(rest);
  }
  return chunks;
}

module.exports = { splitIntoSpeechChunks };
