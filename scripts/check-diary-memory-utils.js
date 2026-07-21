const assert = require("node:assert/strict");
const {
  formatDiaryMemoryLine,
  markDiaryMemoryMention,
  normalizeMentionState,
  selectDiaryMemory,
  shiftDateKey
} = require("../diary-memory-utils");

assert.equal(shiftDateKey("2026-07-21", -1), "2026-07-20");
assert.equal(shiftDateKey("2026-03-01", -1), "2026-02-28");
assert.equal(shiftDateKey("invalid", -1), "");

const diaries = [
  { date: "2026-07-19", lines: ["日曜に残したこと"] },
  { date: "2026-07-20", lines: ["月曜に残したこと", "二行目"] }
];

const yesterday = selectDiaryMemory({
  diaries,
  today: "2026-07-21",
  slot: "朝",
  mentionState: {}
});
assert.deepEqual(yesterday, {
  kind: "yesterday",
  sourceDate: "2026-07-20",
  line: "月曜に残したこと",
  key: "yesterday:2026-07-21:2026-07-20"
});
assert.equal(selectDiaryMemory({
  diaries,
  today: "2026-07-21",
  slot: "午後",
  mentionState: {}
}), undefined);

const weekly = selectDiaryMemory({
  diaries: [
    { date: "2026-07-12", lines: ["対象外の日曜"] },
    { date: "2026-07-16", lines: ["先週の木曜"] },
    { date: "2026-07-19", lines: ["先週の最新記録"] }
  ],
  today: "2026-07-20",
  slot: "午後",
  mentionState: {}
});
assert.equal(weekly.kind, "weekly");
assert.equal(weekly.sourceDate, "2026-07-19");
assert.equal(weekly.line, "先週の最新記録");

const marked = markDiaryMemoryMention({}, yesterday, "2026-07-21");
assert.deepEqual(marked, {
  lastMentionDate: "2026-07-21",
  keys: ["yesterday:2026-07-21:2026-07-20"]
});
assert.equal(Object.prototype.hasOwnProperty.call(marked, "line"), false);
assert.equal(selectDiaryMemory({
  diaries,
  today: "2026-07-21",
  slot: "朝",
  mentionState: marked
}), undefined);
assert.equal(selectDiaryMemory({
  diaries: diaries.filter((entry) => entry.date !== "2026-07-20"),
  today: "2026-07-21",
  slot: "朝",
  mentionState: {}
}), undefined);

assert.equal(
  formatDiaryMemoryLine(yesterday, "びくにたん"),
  "びくにたん、昨日の日記に「月曜に残したこと」って残っていました。今日も地続きで覚えておきますね。"
);
assert.equal(normalizeMentionState({ keys: ["a", "a", "b"], line: "保存しない" }).keys.length, 2);

console.log("diary-memory-utils: OK");
