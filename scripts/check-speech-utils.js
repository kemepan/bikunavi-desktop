const assert = require("node:assert/strict");
const { splitIntoSpeechChunks } = require("../speech-utils");

// 空・短文はそのまま
assert.deepEqual(splitIntoSpeechChunks(""), []);
assert.deepEqual(splitIntoSpeechChunks("   "), []);
assert.deepEqual(splitIntoSpeechChunks("こんにちは。"), ["こんにちは。"]);

// 2文はそれぞれ独立した塊になる（1文目が先に再生開始できる）
assert.deepEqual(
  splitIntoSpeechChunks("今日はいい天気ですね。散歩に行きたくなります。"),
  ["今日はいい天気ですね。", "散歩に行きたくなります。"]
);

// 短い文（12文字未満）は次の文と束ねる
assert.deepEqual(
  splitIntoSpeechChunks("うん！それはですね、こういう理由があるからなんです。"),
  ["うん！それはですね、こういう理由があるからなんです。"]
);

// 末尾の極端に短い残り（6文字未満）は前の塊へ吸収する
assert.deepEqual(
  splitIntoSpeechChunks("これが今日のおすすめの過ごし方です。ぜひ！"),
  ["これが今日のおすすめの過ごし方です。ぜひ！"]
);

// 句点なしの長文も1塊として扱える
assert.equal(
  splitIntoSpeechChunks("句読点のない長いテキストでも動作します").length,
  1
);

// 改行区切りにも対応（占いなど複数行のセリフ）
{
  const chunks = splitIntoSpeechChunks(
    "今日のびくたん占いです！\nラッキーカラーは水色。ハンカチに取り入れるのがおすすめです。\n午後は散歩に出かけると良いことがあるかも。"
  );
  assert.ok(chunks.length >= 3, `expected >=3 chunks, got ${JSON.stringify(chunks)}`);
  assert.ok(chunks[0].includes("占い"));
}

// 全文を繋げると元テキストの内容が失われていない（空白正規化のみ許容）
{
  const source = "一文目です。二文目はもう少し長い文章になっています。三文目！";
  const joined = splitIntoSpeechChunks(source).join("");
  assert.equal(joined.replace(/\s+/g, ""), source.replace(/\s+/g, ""));
}

console.log("speech-utils: OK");
