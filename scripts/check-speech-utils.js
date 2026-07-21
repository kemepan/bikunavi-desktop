const assert = require("node:assert/strict");
const { normalizeSpeechVolume, splitIntoSpeechChunks } = require("../speech-utils");

assert.equal(normalizeSpeechVolume(53), 55);
assert.equal(normalizeSpeechVolume(0), 10);
assert.equal(normalizeSpeechVolume(120), 100);
assert.equal(normalizeSpeechVolume("75"), 75);
assert.equal(normalizeSpeechVolume("invalid", 50), 50);

// 空・短文はそのまま
assert.deepEqual(splitIntoSpeechChunks(""), []);
assert.deepEqual(splitIntoSpeechChunks("   "), []);
assert.deepEqual(splitIntoSpeechChunks("こんにちは。"), ["こんにちは。"]);

// 意味が通る単位＝1文ずつに分ける
assert.deepEqual(
  splitIntoSpeechChunks("今日はいい天気ですね。散歩に行きたくなります。"),
  ["今日はいい天気ですね。", "散歩に行きたくなります。"]
);
assert.deepEqual(
  splitIntoSpeechChunks(
    "一文目です。二文目はもう少し長い文章になっています。三文目もあります。"
  ),
  ["一文目です。", "二文目はもう少し長い文章になっています。", "三文目もあります。"]
);

// どの塊も文の区切りで終わる（文の途中でぶつ切りにしない）
{
  const chunks = splitIntoSpeechChunks(
    "まず朝のうちに一番重い作業を片付けます。次に昼休みは画面から離れます。最後に夜は早めに切り上げましょう。"
  );
  assert.equal(chunks.length, 3);
  for (const chunk of chunks) {
    assert.ok(/[。！？!?]$/.test(chunk), `not sentence-aligned: ${chunk}`);
  }
}

// 相槌などの極端に短い文（6文字未満）は次の文と束ねる
assert.deepEqual(
  splitIntoSpeechChunks("うん！それはですね、こういう理由があるからなんです。"),
  ["うん！それはですね、こういう理由があるからなんです。"]
);

// 末尾の極端に短い残りは前の文へ吸収する
assert.deepEqual(
  splitIntoSpeechChunks("これが今日のおすすめの過ごし方です。ぜひ！"),
  ["これが今日のおすすめの過ごし方です。ぜひ！"]
);

// 改行区切り（占いなど複数行のセリフ）も行＝文単位になる
{
  const chunks = splitIntoSpeechChunks(
    "今日のびくたん占いです！\nラッキーカラーは水色。ハンカチに取り入れるのがおすすめです。\n午後は散歩に出かけると良いことがあるかも。"
  );
  assert.ok(chunks.length >= 3);
  assert.ok(chunks[0].includes("占い"));
}

// 句読点なしの長文でも壊れない・内容が失われない
{
  const source = "あ".repeat(100);
  assert.equal(splitIntoSpeechChunks(source).join(""), source);
}
{
  const source = "一文目です。二文目はもう少し長い文章になっています。三文目！";
  const joined = splitIntoSpeechChunks(source).join("");
  assert.equal(joined.replace(/\s+/g, ""), source.replace(/\s+/g, ""));
}

console.log("speech-utils: OK");
