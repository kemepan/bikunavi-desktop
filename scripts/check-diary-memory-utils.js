const assert = require("node:assert/strict");
const {
  formatDiaryMemoryLine,
  markDiaryMemoryMention,
  normalizeGeneratedDiary,
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
  slot: "",
  key: "yesterday:2026-07-21:2026-07-20:0"
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
  keys: ["yesterday:2026-07-21:2026-07-20:0"]
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

const afternoonTimestamp = Date.parse("2026-07-20T14:00:00+09:00");
const generated = normalizeGeneratedDiary([
  { text: "午後に話した内容", sourceId: "C1" },
  { text: "時刻の根拠がない内容", sourceId: "X9" },
  "文字列形式も残す"
], new Map([
  ["C1", { occurredAt: afternoonTimestamp, slot: "午後" }]
]));
assert.deepEqual(generated, {
  lines: ["午後に話した内容", "時刻の根拠がない内容", "文字列形式も残す"],
  moments: [{ lineIndex: 0, occurredAt: afternoonTimestamp, slot: "午後" }]
});

const sameTime = selectDiaryMemory({
  diaries: [{
    date: "2026-07-20",
    lines: generated.lines,
    moments: generated.moments
  }],
  today: "2026-07-21",
  slot: "午後",
  mentionState: {}
});
assert.deepEqual(sameTime, {
  kind: "same-time",
  sourceDate: "2026-07-20",
  line: "午後に話した内容",
  slot: "午後",
  key: "same-time:2026-07-21:2026-07-20:0"
});
assert.equal(
  formatDiaryMemoryLine(sameTime),
  "昨日の午後ごろの日記に、「午後に話した内容」って残っていました。この時間になると、少し続きが気になります。"
);
assert.equal(selectDiaryMemory({
  diaries: [{ date: "2026-07-20", lines: ["根拠なし"], moments: [] }],
  today: "2026-07-21",
  slot: "午後",
  mentionState: {}
}), undefined);

console.log("diary-memory-utils: OK");
