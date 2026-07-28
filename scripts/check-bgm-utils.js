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

// 朝・昼・夜の3枠に丸める。
{
  const { bgmDaypart, shouldSuggestBgm, markBgmSuggested } = require("../bgm-utils");
  assert.equal(bgmDaypart("早朝"), "朝");
  assert.equal(bgmDaypart("朝"), "朝");
  assert.equal(bgmDaypart("昼"), "昼");
  assert.equal(bgmDaypart("午後"), "昼");
  assert.equal(bgmDaypart("夕方"), "夜");
  assert.equal(bgmDaypart("夜"), "夜");
  assert.equal(bgmDaypart("深夜"), "夜");

  const today = "2026-07-28";
  // まだ何も薦めていない。
  assert.equal(shouldSuggestBgm(undefined, { date: today, daypart: "朝" }), true);

  // 朝に薦めたら、朝はもう出さない。
  let history = markBgmSuggested(undefined, { date: today, daypart: "朝" });
  assert.equal(shouldSuggestBgm(history, { date: today, daypart: "朝" }), false);
  // 昼になれば出す。
  assert.equal(shouldSuggestBgm(history, { date: today, daypart: "昼" }), true);

  history = markBgmSuggested(history, { date: today, daypart: "昼" });
  assert.deepEqual(history.dayparts, ["朝", "昼"]);

  // 日が変われば作り直す。
  assert.equal(shouldSuggestBgm(history, { date: "2026-07-29", daypart: "朝" }), true);
  const next = markBgmSuggested(history, { date: "2026-07-29", daypart: "朝" });
  assert.deepEqual(next, { date: "2026-07-29", dayparts: ["朝"] });

  // 同じ枠を二重に記録しない。
  const same = markBgmSuggested(next, { date: "2026-07-29", daypart: "朝" });
  assert.deepEqual(same.dayparts, ["朝"]);
}

console.log("bgm-utils（1日3回まで）: OK");
