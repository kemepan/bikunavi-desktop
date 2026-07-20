// 日本の祝日をオフラインで判定する（祝日法ベースのルール計算）。
// 春分・秋分は1980〜2099年で有効な近似式を使う。

function nthMondayOfMonth(year, month, n) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=日
  const offsetToMonday = (8 - firstWeekday) % 7;
  return 1 + offsetToMonday + (n - 1) * 7;
}

function springEquinoxDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
}

function autumnEquinoxDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
}

// 振替休日・国民の休日を除いた「本来の祝日」
function baseHolidayName(year, month, day) {
  if (month === 1 && day === 1) return "元日";
  if (month === 1 && day === nthMondayOfMonth(year, 1, 2)) return "成人の日";
  if (month === 2 && day === 11) return "建国記念の日";
  if (month === 2 && day === 23) return "天皇誕生日";
  if (month === 3 && day === springEquinoxDay(year)) return "春分の日";
  if (month === 4 && day === 29) return "昭和の日";
  if (month === 5 && day === 3) return "憲法記念日";
  if (month === 5 && day === 4) return "みどりの日";
  if (month === 5 && day === 5) return "こどもの日";
  if (month === 7 && day === nthMondayOfMonth(year, 7, 3)) return "海の日";
  if (month === 8 && day === 11) return "山の日";
  if (month === 9 && day === nthMondayOfMonth(year, 9, 3)) return "敬老の日";
  if (month === 9 && day === autumnEquinoxDay(year)) return "秋分の日";
  if (month === 10 && day === nthMondayOfMonth(year, 10, 2)) return "スポーツの日";
  if (month === 11 && day === 3) return "文化の日";
  if (month === 11 && day === 23) return "勤労感謝の日";
  return undefined;
}

// その日の祝日名を返す。祝日でなければ undefined。
// 振替休日: 祝日が日曜に当たったとき、その後の最初の平日（祝日でない日）が休日になる。
// 国民の休日: 前日と翌日が祝日に挟まれた平日は休日になる（敬老の日と秋分の日の間など）。
function getJapaneseHoliday(year, month, day) {
  const base = baseHolidayName(year, month, day);
  if (base) return base;

  const date = new Date(Date.UTC(year, month - 1, day));

  // 振替休日: 直前に連続する祝日列をさかのぼり、その起点が日曜なら当日が振替
  const cursor = new Date(date);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (baseHolidayName(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate())) {
    if (cursor.getUTCDay() === 0) return "振替休日";
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  // 国民の休日
  if (date.getUTCDay() !== 0) {
    const prev = new Date(date);
    prev.setUTCDate(prev.getUTCDate() - 1);
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 1);
    const prevHoliday = baseHolidayName(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate());
    const nextHoliday = baseHolidayName(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
    if (prevHoliday && nextHoliday) return "国民の休日";
  }

  return undefined;
}

module.exports = { getJapaneseHoliday };
