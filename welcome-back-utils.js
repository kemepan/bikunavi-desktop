// しばらく起動していなかった後の「おかえり」。
//
// 毎回言うと軽くなるので、間が空いた時だけにする。
// 判定は前回の起動時刻との差だけで、何をしていたかは見ない。
(function exposeWelcomeBackUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviWelcomeBack = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  // これ未満は「いつもどおり」。3日空いてはじめて久しぶりとする。
  const DEFAULT_MIN_AWAY_MS = 3 * DAY_MS;

  function awayDuration(lastLaunchAt, now = Date.now()) {
    const last = Number(lastLaunchAt) || 0;
    if (!last) return 0;
    const away = now - last;
    // 時計が巻き戻っている時は判定しない。
    return away > 0 ? away : 0;
  }

  function shouldWelcomeBack(lastLaunchAt, { now = Date.now(), minAwayMs = DEFAULT_MIN_AWAY_MS } = {}) {
    // 初回起動（記録なし）では言わない。「久しぶり」になる相手がいないため。
    if (!Number(lastLaunchAt)) return false;
    return awayDuration(lastLaunchAt, now) >= minAwayMs;
  }

  // 「3日ぶり」「2週間ぶり」のような言い方にする。
  function describeAway(awayMs) {
    const days = Math.floor((Number(awayMs) || 0) / DAY_MS);
    if (days < 1) return "";
    if (days < 14) return `${days}日ぶり`;
    if (days < 60) return `${Math.floor(days / 7)}週間ぶり`;
    return `${Math.floor(days / 30)}か月ぶり`;
  }

  return { DAY_MS, DEFAULT_MIN_AWAY_MS, awayDuration, describeAway, shouldWelcomeBack };
});
