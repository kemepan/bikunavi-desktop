// 「今日で何日目ですね」を、うるさくない頻度で言う。
//
// 毎回言うとくどいので、節目の日だけにする。節目でない日は黙る。
// 初回起動日を持っていないと数えられないが、途中から入れた機能なので、
// 既に使っている人には「いちばん古い記録」から遡って推定する。
(function exposeTogetherDaysUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviTogetherDays = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  // 日付だけで数える。時刻を含めると、同じ日の再起動で数が変わる。
  function toDayNumber(timestamp) {
    const value = Number(timestamp) || 0;
    if (!value) return 0;
    return Math.floor(value / DAY_MS);
  }

  // 出会ってから何日目か。初日を1日目とする。
  function countTogetherDays(firstLaunchAt, now = Date.now()) {
    const first = toDayNumber(firstLaunchAt);
    if (!first) return 0;
    const today = toDayNumber(now);
    // 時計が巻き戻っている時は数えない。
    if (today < first) return 0;
    return today - first + 1;
  }

  // 言う日かどうか。
  //
  // 毎日言われると「今日で何日目」が挨拶になってしまい、特別さが無くなる。
  // 最初の1週間は節目が多い方が嬉しいので細かく、あとは間隔を広げる。
  function isMilestone(days) {
    const count = Number(days) || 0;
    if (count < 2) return false;          // 初日は「はじめまして」の領分
    if (count === 3 || count === 7) return true;
    if (count < 30) return count % 10 === 0;   // 10, 20
    if (count < 365) return count % 30 === 0;  // 30, 60, 90…
    return count % 100 === 0;                  // 400, 500…（1年は下で拾う）
  }

  // 1年・2年はぴったり言いたい。日数の剰余では拾えないので別に見る。
  function isAnniversary(days) {
    const count = Number(days) || 0;
    return count >= 365 && count % 365 === 0;
  }

  function shouldMention(days, { lastMentionedDays = 0 } = {}) {
    const count = Number(days) || 0;
    if (!count) return false;
    // 同じ節目を二度言わない（同じ日に再起動した時など）。
    if (count <= Number(lastMentionedDays || 0)) return false;
    return isAnniversary(count) || isMilestone(count);
  }

  function describeTogetherDays(days) {
    const count = Number(days) || 0;
    if (!count) return "";
    if (isAnniversary(count)) {
      const years = count / 365;
      return `今日で、一緒に過ごして${years}年になります`;
    }
    if (count >= 365) return `今日で${count}日目です`;
    if (count >= 30 && count % 30 === 0) {
      return `今日で${count}日目、${count / 30}か月になります`;
    }
    return `今日で${count}日目です`;
  }

  // 初回起動日が無い人のために、手元の記録から「いちばん古い日」を拾う。
  // 途中から入れた機能なので、これが無いと既存の利用者が全員1日目に戻る。
  function estimateFirstLaunchAt(timestamps = [], now = Date.now()) {
    const valid = (Array.isArray(timestamps) ? timestamps : [])
      .map((value) => Number(value) || 0)
      .filter((value) => value > 0 && value <= now);
    if (!valid.length) return now;
    return Math.min(...valid);
  }

  return {
    DAY_MS,
    countTogetherDays,
    describeTogetherDays,
    estimateFirstLaunchAt,
    isAnniversary,
    isMilestone,
    shouldMention
  };
});
