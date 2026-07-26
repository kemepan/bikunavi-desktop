const assert = require("node:assert/strict");
const { suggestReplyChoices } = require("../idle-choice-utils");

// 質問でないセリフには出さない。
assert.deepEqual(suggestReplyChoices("リギングのボーン名、毎回迷います。"), []);
assert.deepEqual(suggestReplyChoices(""), []);
assert.deepEqual(suggestReplyChoices(undefined), []);

// 疑問詞のある質問は、定型の相づちでは答えにならないので出さない。
for (const text of [
  "いま何を作ってるところですか？",
  "どんな音楽が好きですか？",
  "次はどこへ行きますか？",
  "調子はどうですか？",
  "なぜそう思うんですか？",
  "誰と作業してるんですか？"
]) {
  assert.deepEqual(suggestReplyChoices(text), [], text);
}

// 共感を求める問いかけ（2026-07-25の実測セリフ）。
for (const text of [
  "タロットや占いの結果って、次に進むときの道しるべになりませんか？",
  "ペンタブの替え芯、いつの間にか減っていて焦りませんか？",
  "この配色、少し眠たく見えますよね？",
  "そういうこと、ありませんか？"
]) {
  assert.deepEqual(suggestReplyChoices(text), ["わかる", "そうかも", "うーん"], text);
}

// 許可・提案（同じく実測）。
for (const text of [
  "びくたんはお昼寝を少しだけ挟んでもいいですか？",
  "そろそろ休憩しましょうか？"
]) {
  assert.deepEqual(suggestReplyChoices(text), ["いいね", "あとでね"], text);
}

// 素直なYes/No。
assert.deepEqual(suggestReplyChoices("もう夕ごはんは食べましたか？"), ["うん", "ううん"]);

// 「？」で終わらない質問形は対象外（読み上げの途中など）。
assert.deepEqual(suggestReplyChoices("焦りませんか"), []);

// 全角・半角どちらの疑問符でも、末尾に空白があっても効く。
assert.deepEqual(suggestReplyChoices("焦りませんか? "), ["わかる", "そうかも", "うーん"]);

// 選択肢は吹き出しへ並べるので、増やしすぎない。
for (const text of ["焦りませんか？", "休憩しましょうか？", "食べましたか？"]) {
  assert.ok(suggestReplyChoices(text).length <= 3, text);
}

console.log("idle-choice-utils: OK");

// 疑問詞と同じ字を含む慣用句を、問いかけと誤判定しない。
{
  // 「〜ましたね？」は同意を求める形なので共感で拾う。
  assert.deepEqual(
    suggestReplyChoices("いつの間にか日が暮れていましたね？"),
    ["わかる", "そうかも", "うーん"]
  );
  assert.deepEqual(
    suggestReplyChoices("なんとなく気分が乗らない日ってありませんか？"),
    ["わかる", "そうかも", "うーん"]
  );
  assert.deepEqual(
    suggestReplyChoices("どうも肩がこりますよね？"),
    ["わかる", "そうかも", "うーん"]
  );
  // 慣用句を除いても本物の疑問詞が残るものは、これまでどおり対象外。
  assert.deepEqual(suggestReplyChoices("いつも何を聴いていますか？"), []);
}

// gフラグ付き正規表現のlastIndexが持ち越されない（2回目以降も同じ結果）。
{
  const text = "いつの間にか減っていて焦りませんか？";
  const first = suggestReplyChoices(text);
  assert.deepEqual(suggestReplyChoices(text), first);
  assert.deepEqual(suggestReplyChoices(text), first);
}

console.log("idle-choice-utils（慣用句の除外）: OK");

// 既知の限界: 「〜しませんか？」の誘いも共感として扱う。
// 語尾だけでは誘いと共感を分けられないため。将来分けるならここが変わる。
assert.deepEqual(
  suggestReplyChoices("そろそろ休憩しませんか？"),
  ["わかる", "そうかも", "うーん"]
);

console.log("idle-choice-utils（既知の限界）: OK");

// 「か」の有無でYes/Noと共感を分ける。順序を崩すとここが壊れる。
assert.deepEqual(suggestReplyChoices("これで合っていますかね？"), ["うん", "ううん"]);
assert.deepEqual(suggestReplyChoices("これで合っていますね？"), ["わかる", "そうかも", "うーん"]);
// 許可はYes/Noより先に確定する（「てもいいですか」が「ですか」に流れない）。
assert.deepEqual(suggestReplyChoices("少し休んでもいいですか？"), ["いいね", "あとでね"]);

console.log("idle-choice-utils（語尾の優先順位）: OK");
