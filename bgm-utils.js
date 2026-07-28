// 作業用BGMのおすすめ。
//
// これまでは占いの中にしか無く、BGMだけ知りたい時も占いを一式聞く必要があった。
// よく使う機能なので、今の状況から1つ選んですぐ出せるようにする。
//
// 曲名は出さない（実在を確認できないため）。雰囲気とジャンルだけを言い、
// 検索はYouTubeに任せる。
(function exposeBgmUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviBgm = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  // 時間帯に合うもの。slots を持たない行はいつでも出せる。
  const BGM_CANDIDATES = [
    // 朝
    { name: "軽やかなアコースティックギター", slots: ["早朝", "朝"] },
    { name: "朝に合うやさしいフォーク", slots: ["早朝", "朝"] },
    { name: "目覚めのボサノヴァ", slots: ["早朝", "朝"] },
    // 昼〜午後
    { name: "明るいシティポップ", slots: ["昼", "午後"] },
    { name: "テンポのいいアップテンポなポップ", slots: ["昼", "午後"] },
    { name: "軽快なファンク", slots: ["昼", "午後"] },
    // 夕方
    { name: "夕暮れに合うメロウなソウル", slots: ["夕方"] },
    { name: "落ち着いたネオソウル", slots: ["夕方"] },
    // 夜
    { name: "落ち着いたローファイ・ヒップホップ", slots: ["夜"] },
    { name: "ゆったりしたジャズ", slots: ["夜"] },
    { name: "低音の心地よいチルアウト", slots: ["夜"] },
    // 深夜
    { name: "さらさら流れるアンビエント", slots: ["深夜"] },
    { name: "雨音まじりのローファイ", slots: ["深夜"] },
    { name: "眠りを邪魔しない静かなピアノ", slots: ["深夜"] },
    // 集中したい時（ポモドーロ中）
    { name: "集中用のミニマルなピアノ", focus: true },
    { name: "研ぎ澄ますようなアンビエント・テクノ", focus: true },
    { name: "歌のないポストロック", focus: true },
    { name: "静かなクラシック", focus: true },
    // いつでも。ただし静かにしたい時間帯・集中中は、うるさいものを混ぜない。
    { name: "静かな作業用のチル" },
    { name: "自然音まじりのアンビエント" },
    { name: "ゆるいボサノヴァ", exclude: ["深夜"] },
    { name: "作業がはかどるハウス", exclude: ["深夜"], noFocus: true }
  ];

  function matches(candidate, context = {}) {
    if (candidate.focus) return Boolean(context.focus);
    // 集中したい時は、集中向けと静かなものだけにする。
    if (context.focus && candidate.noFocus) return false;
    if (Array.isArray(candidate.exclude) && candidate.exclude.includes(context.slot)) {
      return false;
    }
    if (Array.isArray(candidate.slots)) return candidate.slots.includes(context.slot);
    return true;
  }

  // 今の状況に合うものを優先しつつ、直前に出したものは避ける。
  // 押すたびに同じものが出ると、選んでもらっている感じがしないため。
  function pickBgm(context = {}, recentNames = [], random = Math.random) {
    const recent = new Set((Array.isArray(recentNames) ? recentNames : []).map(String));
    // 集中中は時間帯の曲を混ぜない（作業用として選び直したいため）。
    const fitting = BGM_CANDIDATES.filter((item) => (
      matches(item, context) && !(context.focus && Array.isArray(item.slots))
    ));
    const fresh = fitting.filter((item) => !recent.has(item.name));
    // 状況に合うものを出し切ったら、いつでも出せるものから拾う。
    const anytime = BGM_CANDIDATES.filter((item) => (
      !item.slots && !item.focus && matches(item, context)
    ));
    const pool = fresh.length
      ? fresh
      : (fitting.length ? fitting : anytime);
    if (!pool.length) return "";
    return pool[Math.floor(random() * pool.length)].name;
  }

  // 好みを教わっている時は、それを手がかりに一言添える。
  function describeBgmSuggestion(name, { preference = "", slot = "", focus = false } = {}) {
    if (!name) return "";
    if (focus) return `集中したい時は${name}が合いそうです。`;
    if (preference) {
      return `${preference.slice(0, 20)}が好きと聞いたので、${name}はどうでしょう。`;
    }
    if (slot === "深夜") return `この時間なら${name}くらいが心地よさそうです。`;
    if (slot === "早朝" || slot === "朝") return `朝は${name}から始めるのもいいですね。`;
    return `${name}はどうでしょう。`;
  }

  // AIが挙げたアーティスト名を受け取れるか判断する。
  //
  // 実在しない名前を作られるのが最大のリスクなので、疑わしいものは通さない。
  // 通した名前はYouTube検索リンクにするので、実在しなければ利用者側で分かる。
  function isUsableArtistName(rawName) {
    const name = String(rawName || "").replace(/\s+/g, " ").trim();
    if (!name) return false;
    // 名前だけを期待している。説明文が返ってきたら使わない。
    if (name.length > 40) return false;
    if (/[。、！？\n]/.test(name)) return false;
    // 「〜だと思います」「わかりません」のような返答は名前ではない。
    if (/(思います|でしょう|かもしれ|わかりません|不明|存在しな)/.test(name)) return false;
    // 前置きが付いたまま返ってくることがある。
    if (/^(はい|例えば|たとえば|おすすめ|回答)/.test(name)) return false;
    return true;
  }

  // 朝・昼・夜の3枠に丸める。1日に何度も薦めないための単位。
  function bgmDaypart(slot) {
    if (slot === "早朝" || slot === "朝") return "朝";
    if (slot === "昼" || slot === "午後") return "昼";
    return "夜";
  }

  // その日その時間帯で、まだ薦めていなければ true。
  function shouldSuggestBgm(history, { date, daypart } = {}) {
    if (!date || !daypart) return false;
    if (history?.date !== date) return true;
    return !(Array.isArray(history?.dayparts) ? history.dayparts : []).includes(daypart);
  }

  // 薦めた記録を更新する。日が変わったら作り直す。
  function markBgmSuggested(history, { date, daypart } = {}) {
    if (!date || !daypart) return history || { date: "", dayparts: [] };
    if (history?.date !== date) return { date, dayparts: [daypart] };
    const dayparts = Array.isArray(history.dayparts) ? history.dayparts : [];
    return dayparts.includes(daypart)
      ? history
      : { date, dayparts: [...dayparts, daypart] };
  }

  return {
    BGM_CANDIDATES,
    matches,
    pickBgm,
    describeBgmSuggestion,
    isUsableArtistName,
    bgmDaypart,
    shouldSuggestBgm,
    markBgmSuggested
  };
});
