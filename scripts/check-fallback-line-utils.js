const assert = require("node:assert/strict");
const {
  FALLBACK_LINES,
  matchesContext,
  selectFallbackLine,
  buildFallbackQueue
} = require("../fallback-line-utils");

// 状況の指定がない行は、いつでも出せる。
assert.equal(matchesContext({ text: "x" }, {}), true);
assert.equal(matchesContext({ text: "x" }, { slot: "深夜", music: true }), true);

// 時間帯の指定。
{
  const line = { text: "朝の話", when: { slots: ["早朝", "朝"] } };
  assert.equal(matchesContext(line, { slot: "朝" }), true);
  assert.equal(matchesContext(line, { slot: "深夜" }), false);
  assert.equal(matchesContext(line, {}), false);
}

// 音楽・ポモドーロの指定。
{
  const music = { text: "曲の話", when: { music: true } };
  assert.equal(matchesContext(music, { music: true }), true);
  assert.equal(matchesContext(music, { music: false }), false);

  const focus = { text: "集中の話", when: { pomodoro: "focus" } };
  assert.equal(matchesContext(focus, { pomodoro: "focus" }), true);
  assert.equal(matchesContext(focus, { pomodoro: "break" }), false);
  assert.equal(matchesContext(focus, {}), false);
}

// 状況に合う行があれば、そちらを優先して出す。
{
  const text = selectFallbackLine({ slot: "深夜" }, [], () => 0);
  const line = FALLBACK_LINES.find((item) => item.text === text);
  assert.ok(line.when?.slots?.includes("深夜"), text);
}
{
  const text = selectFallbackLine({ music: true }, [], () => 0);
  const line = FALLBACK_LINES.find((item) => item.text === text);
  assert.equal(line.when?.music, true, text);
}

// 状況の行を言い尽くしたら、いつでも言える行へ落ちる（無言にならない）。
{
  const nightLines = FALLBACK_LINES
    .filter((line) => line.when?.slots?.includes("深夜"))
    .map((line) => line.text);
  const text = selectFallbackLine({ slot: "深夜" }, nightLines, () => 0);
  assert.ok(text, "何か言えるはず");
  assert.equal(nightLines.includes(text), false);
}

// 最近言った行は避ける。
{
  const first = selectFallbackLine({}, [], () => 0);
  const second = selectFallbackLine({}, [first], () => 0);
  assert.notEqual(first, second);
}

// 状況に合う行が無い時でも、必ず何か返す。
{
  assert.ok(selectFallbackLine({ slot: "存在しない時間帯" }, [], () => 0));
}

// まとめて積む時、同じ行が並ばない。
{
  const queue = buildFallbackQueue({ slot: "朝" }, 6, () => 0.5);
  assert.equal(queue.length, 6);
  const texts = queue.map((item) => item.text);
  assert.equal(new Set(texts).size, texts.length, "重複あり: " + texts.join(" / "));
  // 会話の見た目に合わせて sources を持つ。
  assert.ok(queue.every((item) => Array.isArray(item.sources)));
}

// キャラクターシートの軸が、それぞれ1つ以上ある。
{
  const all = FALLBACK_LINES.map((line) => line.text).join("\n");
  const axes = {
    "軽いツッコミ": /あとで整理|そのまま残り|ちょっとで済んだ|保存していない時ほど/,
    "次の一手": /日付を入れて|一回だけ保存|名前を揃える|スクリーンショットに残して/,
    "いたずら": /こっそり伸び|揺れて遊んで/,
    "知ったふりをしない": /こっそり覚えよう|分からないと言う方が/
  };
  for (const [name, pattern] of Object.entries(axes)) {
    assert.ok(pattern.test(all), `${name} のセリフが無い`);
  }
}

console.log("fallback-line-utils: OK");
