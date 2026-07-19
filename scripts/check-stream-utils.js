const assert = require("node:assert/strict");
const { extractAnswerText } = require("../stream-utils");

// answerキーが来るまでは空
assert.deepEqual(extractAnswerText(""), { text: "", complete: false });
assert.deepEqual(extractAnswerText('{"ans'), { text: "", complete: false });

// 受信途中の本文を復元できる
assert.deepEqual(
  extractAnswerText('{"answer":"こんにちは、今日は'),
  { text: "こんにちは、今日は", complete: false }
);

// 完結した本文
assert.deepEqual(
  extractAnswerText('{"answer":"やってみましょう！","emote":"joy"}'),
  { text: "やってみましょう！", complete: true }
);

// エスケープの復元（改行・引用符・バックスラッシュ）
assert.deepEqual(
  extractAnswerText('{"answer":"1行目\\n\\"引用\\"と\\\\記号","emote":"joy"}'),
  { text: '1行目\n"引用"と\\記号', complete: true }
);

// \uXXXX の復元
assert.deepEqual(
  extractAnswerText('{"answer":"\\u3073\\u304f\\u305f\\u3093"}'),
  { text: "びくたん", complete: true }
);

// チャンク境界でエスケープが分断されても、手前までを返して壊れない
assert.deepEqual(
  extractAnswerText('{"answer":"ここまで\\'),
  { text: "ここまで", complete: false }
);
assert.deepEqual(
  extractAnswerText('{"answer":"ここまで\\u30'),
  { text: "ここまで", complete: false }
);

// コードフェンス付きの出力でも動く
assert.deepEqual(
  extractAnswerText('```json\n{"answer":"フェンス付きでも大丈夫。","emote":"joy"}\n```'),
  { text: "フェンス付きでも大丈夫。", complete: true }
);

// 空白入りキー
assert.deepEqual(
  extractAnswerText('{ "answer" : "空白入りでもOK'),
  { text: "空白入りでもOK", complete: false }
);

console.log("stream-utils: OK");
