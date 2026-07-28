const assert = require("node:assert/strict");
const { BGM_CANDIDATES, matches, pickBgm, describeBgmSuggestion } = require("../bgm-utils");

// 時間帯の指定。
{
  const morning = { name: "朝の曲", slots: ["早朝", "朝"] };
  assert.equal(matches(morning, { slot: "朝" }), true);
  assert.equal(matches(morning, { slot: "深夜" }), false);
  assert.equal(matches(morning, {}), false);
}

// 集中用はポモドーロ中だけ。時間帯では出さない。
{
  const focus = { name: "集中の曲", focus: true };
  assert.equal(matches(focus, { focus: true }), true);
  assert.equal(matches(focus, { slot: "朝" }), false);
  assert.equal(matches(focus, {}), false);
}

// 指定のないものはいつでも出せる。
assert.equal(matches({ name: "いつでも" }, {}), true);
assert.equal(matches({ name: "いつでも" }, { slot: "深夜", focus: true }), true);

// 時間帯に合うものが選ばれる。
{
  const name = pickBgm({ slot: "深夜" }, [], () => 0);
  const item = BGM_CANDIDATES.find((x) => x.name === name);
  assert.ok(item.slots?.includes("深夜") || !item.slots, name);
}

// ポモドーロ中は集中用が出る。
{
  const name = pickBgm({ focus: true }, [], () => 0);
  const item = BGM_CANDIDATES.find((x) => x.name === name);
  assert.ok(item.focus || !item.slots, name);
}

// 続けて押しても同じものを返さない。
{
  const first = pickBgm({ slot: "夜" }, [], () => 0);
  const second = pickBgm({ slot: "夜" }, [first], () => 0);
  assert.notEqual(first, second);
}

// 出し切っても、必ず何か返す（無言にならない）。
{
  const all = BGM_CANDIDATES.map((x) => x.name);
  assert.ok(pickBgm({ slot: "夜" }, all, () => 0));
  assert.ok(pickBgm({ slot: "存在しない時間帯" }, all, () => 0));
}

// 言い方。好みを聞けていればそれを添える。
{
  assert.match(describeBgmSuggestion("ジャズ", { preference: "静かなピアノ" }), /静かなピアノ/);
  assert.match(describeBgmSuggestion("ミニマル", { focus: true }), /集中/);
  assert.match(describeBgmSuggestion("アンビエント", { slot: "深夜" }), /この時間/);
  assert.equal(describeBgmSuggestion(""), "");
}

// 全候補に名前がある。
assert.ok(BGM_CANDIDATES.every((x) => typeof x.name === "string" && x.name.length > 0));

console.log("bgm-utils: OK");
