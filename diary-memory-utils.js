const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MORNING_SLOTS = new Set(["早朝", "朝"]);
const WEEKLY_SLOTS = new Set(["早朝", "朝", "昼", "午後"]);

function parseDateKey(rawDateKey) {
  const match = DATE_KEY_PATTERN.exec(String(rawDateKey || ""));
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return undefined;
  return date;
}

function dateKeyFromUtc(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function shiftDateKey(rawDateKey, days) {
  const date = parseDateKey(rawDateKey);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return dateKeyFromUtc(date);
}

function normalizeMentionState(rawState) {
  const state = rawState && typeof rawState === "object" ? rawState : {};
  return {
    lastMentionDate: parseDateKey(state.lastMentionDate) ? state.lastMentionDate : "",
    keys: Array.isArray(state.keys)
      ? [...new Set(state.keys.map((key) => String(key || "").trim()).filter(Boolean))].slice(-30)
      : []
  };
}

function normalizeDiaries(rawDiaries) {
  return (Array.isArray(rawDiaries) ? rawDiaries : [])
    .filter((entry) => parseDateKey(entry?.date) && Array.isArray(entry?.lines))
    .map((entry) => ({
      date: String(entry.date),
      lines: entry.lines
        .map((line) => String(line || "").replace(/\s+/g, " ").trim().slice(0, 180))
        .filter(Boolean)
        .slice(0, 5)
    }))
    .filter((entry) => entry.lines.length)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function memoryFromDiary(kind, today, diary) {
  const line = diary?.lines?.[0];
  if (!line) return undefined;
  return {
    kind,
    sourceDate: diary.date,
    line,
    key: `${kind}:${today}:${diary.date}`
  };
}

function selectWeeklyMemory(diaries, today) {
  const todayDate = parseDateKey(today);
  if (!todayDate || todayDate.getUTCDay() !== 1) return undefined;
  const previousMonday = shiftDateKey(today, -7);
  const previousSunday = shiftDateKey(today, -1);
  const diary = diaries
    .filter((entry) => entry.date >= previousMonday && entry.date <= previousSunday)
    .at(-1);
  return memoryFromDiary("weekly", today, diary);
}

function selectYesterdayMemory(diaries, today) {
  const yesterday = shiftDateKey(today, -1);
  return memoryFromDiary(
    "yesterday",
    today,
    diaries.find((entry) => entry.date === yesterday)
  );
}

function selectDiaryMemory({ diaries, today, slot, mentionState } = {}) {
  if (!parseDateKey(today)) return undefined;
  const state = normalizeMentionState(mentionState);
  if (state.lastMentionDate === today) return undefined;
  const normalizedDiaries = normalizeDiaries(diaries);
  if (!normalizedDiaries.length) return undefined;

  let memory;
  const todayDate = parseDateKey(today);
  if (todayDate.getUTCDay() === 1 && WEEKLY_SLOTS.has(String(slot || ""))) {
    memory = selectWeeklyMemory(normalizedDiaries, today);
  }
  if (!memory && MORNING_SLOTS.has(String(slot || ""))) {
    memory = selectYesterdayMemory(normalizedDiaries, today);
  }
  if (!memory || state.keys.includes(memory.key)) return undefined;
  return memory;
}

function markDiaryMemoryMention(rawState, memory, today) {
  const state = normalizeMentionState(rawState);
  const key = String(memory?.key || "").trim();
  if (!key || !parseDateKey(today)) return state;
  return {
    lastMentionDate: today,
    keys: [...state.keys.filter((entry) => entry !== key), key].slice(-30)
  };
}

function formatDiaryMemoryLine(memory, rawUserName = "") {
  const line = String(memory?.line || "").replace(/\s+/g, " ").trim().slice(0, 180);
  if (!line) return "";
  const userName = String(rawUserName || "").replace(/\s+/g, " ").trim().slice(0, 30);
  const prefix = userName ? `${userName}、` : "";
  if (memory?.kind === "weekly") {
    return `${prefix}先週の日記を見返すと、「${line}」が残っていました。今週も、ここから少しずつ続きを育てましょう。`;
  }
  return `${prefix}昨日の日記に「${line}」って残っていました。今日も地続きで覚えておきますね。`;
}

module.exports = {
  formatDiaryMemoryLine,
  markDiaryMemoryMention,
  normalizeMentionState,
  selectDiaryMemory,
  shiftDateKey
};
