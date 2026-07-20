const assert = require("node:assert/strict");
const { getJapaneseHoliday } = require("../holiday-utils");

// 2026年の固定祝日
assert.equal(getJapaneseHoliday(2026, 1, 1), "元日");
assert.equal(getJapaneseHoliday(2026, 2, 11), "建国記念の日");
assert.equal(getJapaneseHoliday(2026, 2, 23), "天皇誕生日");
assert.equal(getJapaneseHoliday(2026, 4, 29), "昭和の日");
assert.equal(getJapaneseHoliday(2026, 8, 11), "山の日");
assert.equal(getJapaneseHoliday(2026, 11, 3), "文化の日");
assert.equal(getJapaneseHoliday(2026, 11, 23), "勤労感謝の日");

// ハッピーマンデー（2026年: 成人1/12・海7/20・敬老9/21・スポーツ10/12）
assert.equal(getJapaneseHoliday(2026, 1, 12), "成人の日");
assert.equal(getJapaneseHoliday(2026, 7, 20), "海の日");
assert.equal(getJapaneseHoliday(2026, 9, 21), "敬老の日");
assert.equal(getJapaneseHoliday(2026, 10, 12), "スポーツの日");

// 春分・秋分（2026年: 3/20・9/23）
assert.equal(getJapaneseHoliday(2026, 3, 20), "春分の日");
assert.equal(getJapaneseHoliday(2026, 9, 23), "秋分の日");

// 振替休日: 2026年は5/3憲法記念日が日曜 → 5/4・5/5は祝日なので5/6が振替
assert.equal(getJapaneseHoliday(2026, 5, 3), "憲法記念日");
assert.equal(getJapaneseHoliday(2026, 5, 4), "みどりの日");
assert.equal(getJapaneseHoliday(2026, 5, 5), "こどもの日");
assert.equal(getJapaneseHoliday(2026, 5, 6), "振替休日");
// 2025年11/23勤労感謝の日が日曜 → 11/24が振替
assert.equal(getJapaneseHoliday(2025, 11, 24), "振替休日");

// 国民の休日: 2026年は敬老の日9/21と秋分の日9/23に挟まれた9/22
assert.equal(getJapaneseHoliday(2026, 9, 22), "国民の休日");

// 平日は undefined
assert.equal(getJapaneseHoliday(2026, 7, 21), undefined);
assert.equal(getJapaneseHoliday(2026, 6, 15), undefined);
assert.equal(getJapaneseHoliday(2026, 12, 25), undefined);

console.log("holiday-utils: OK");
