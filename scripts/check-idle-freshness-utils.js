const assert = require("node:assert/strict");
const { isTimeSensitiveLine, isStaleIdleLine } = require("../idle-freshness-utils");

assert.equal(isTimeSensitiveLine("深夜0時を過ぎて静かになってきましたね。"), true);
assert.equal(isTimeSensitiveLine("早朝から起きてるんですか？"), true);
assert.equal(isTimeSensitiveLine("おはようございます。"), true);
assert.equal(isTimeSensitiveLine("そろそろ6時ですね。"), true);
assert.equal(isTimeSensitiveLine("リギングのボーン名、毎回迷います。"), false);
// 「時間」「時々」を時刻と誤判定しない。
assert.equal(isTimeSensitiveLine("時間があったら試したいことがあります。"), false);
assert.equal(isTimeSensitiveLine("時々、道具の名前を忘れます。"), false);

const now = Date.UTC(2026, 6, 23, 0, 0, 0);

// 同じ時間帯に作った行は、時間に触れていてもそのまま話してよい。
assert.equal(
  isStaleIdleLine({ text: "深夜0時を過ぎましたね。", slot: "深夜", generatedAt: now - 60000 }, { now, slot: "深夜" }),
  false
);

// 時間帯がまたいだら、時間に触れる行だけ捨てる。
assert.equal(
  isStaleIdleLine({ text: "深夜0時を過ぎましたね。", slot: "深夜", generatedAt: now - 60000 }, { now, slot: "早朝" }),
  true
);
assert.equal(
  isStaleIdleLine({ text: "ボーンの名前で毎回迷います。", slot: "深夜", generatedAt: now - 60000 }, { now, slot: "早朝" }),
  false
);

// 生成時の時間帯が分からない行（定型文など）は判定しない。
assert.equal(isStaleIdleLine({ text: "深夜ですね。" }, { now, slot: "朝" }), false);
assert.equal(isStaleIdleLine({ text: "深夜ですね。", slot: "深夜" }, { now, slot: "" }), false);

// 作ってから経ちすぎた行は、時間帯が同じでも捨てる。
assert.equal(
  isStaleIdleLine(
    { text: "ボーンの名前で毎回迷います。", slot: "深夜", generatedAt: now - 7 * 60 * 60 * 1000 },
    { now, slot: "深夜" }
  ),
  true
);
assert.equal(
  isStaleIdleLine(
    { text: "ボーンの名前で毎回迷います。", slot: "深夜", generatedAt: now - 5 * 60 * 60 * 1000 },
    { now, slot: "深夜" }
  ),
  false
);

assert.equal(isStaleIdleLine(undefined, { now, slot: "朝" }), false);

console.log("idle-freshness-utils: OK");
