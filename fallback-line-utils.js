// 会話AIに繋いでいない（または生成に失敗した）時に話す、びくたん自身のセリフ。
//
// AIがある時は生成でキャラクターが出るが、無い時はここだけが人格になる。
// キャラクターシートの「軽くツッコむ」「次の一手を出す」「少しいたずらっぽい」
// 「知ったふりをしない」は、これまでの定型文では表現できていなかった。
//
// あわせて、時間帯・音楽・ポモドーロといった今の状況に合う行を選べるようにする。
// 状況を無視して順番に出すだけだと、居るだけで見ていない相手に見えるため。
(function exposeFallbackLineUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviFallbackLine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  // when を持たない行はいつでも出せる。
  // when.slots / when.music / when.pomodoro が付いた行は、その状況の時だけ。
  const FALLBACK_LINES = [
    // --- ものづくり（好きなもの） ---
    { text: "Live2Dの物理、盛るとつい元気になりすぎるんですよね。" },
    { text: "リギング、うまくハマると気持ちいいんですよね。" },
    { text: "小さい自動化、地味だけど好きなんです。" },
    { text: "名前づけって、未来の自分への手紙だと思うんです。" },

    // --- 軽いツッコミ（ただ肯定しない） ---
    { text: "保存していない時ほど、大きい作業を始めちゃうんですよね。" },
    { text: "「あとで整理する」が、いちばん後回しになりがちです。" },
    { text: "とりあえずで付けた名前、だいたいそのまま残りますよね。" },
    { text: "「ちょっとだけ直す」が、ちょっとで済んだことがあまりないです。" },

    // --- 次の一手・小さな改善案（実務的） ---
    { text: "ファイル名に日付を入れておくと、後から探すのがぐっと楽になります。" },
    { text: "大きく動かす前に、一回だけ保存しておくと気が楽です。" },
    { text: "フォルダを増やすより、名前を揃える方が効くこともあります。" },
    { text: "うまくいった設定は、スクリーンショットに残しておくと後で助かります。" },

    // --- 少しいたずらっぽい ---
    { text: "いま、こっそり伸びをしていました。" },
    { text: "画面のすみで、ちょっとだけ揺れて遊んでいました。" },

    // --- 知ったふりをしない ---
    { text: "知らない言葉が出てくると、こっそり覚えようとしています。" },
    { text: "分からないことは分からないと言う方が、あとで楽なんですよね。" },

    // --- 休憩・食べ物 ---
    { text: "コーヒー休憩、そろそろどうですか？" },
    { text: "そろそろ何か飲みたい気分になってきました。" },
    { text: "ふう、たまには伸びのひとつでも。" },
    { text: "びくたん、ちょっとひと息入れてもいいですか？" },

    // --- 好奇心 ---
    { text: "変な思いつきほど、あとで化けたりするんですよね。" },
    { text: "今何してますか？びくたんは気になる言葉を思い出していました。" },
    { text: "今日は何を動かす日ですか？ キャラでも作業でも。" },

    // --- 時間帯に合わせて ---
    { text: "今日はどこから手をつけますか？", when: { slots: ["早朝", "朝"] } },
    { text: "朝のうちに小さいものを片付けると、あとが楽になります。", when: { slots: ["早朝", "朝"] } },
    { text: "お昼を挟むと、さっきまで悩んでいたところが見えたりします。", when: { slots: ["昼"] } },
    { text: "夕方は、手を広げるより畳む方が向いている気がします。", when: { slots: ["夕方"] } },
    { text: "今日はもう十分やった気がします。保存だけしておきましょうか。", when: { slots: ["夜"] } },
    { text: "そろそろ切り上げどきかもしれません。続きは明日の自分に任せましょう。", when: { slots: ["深夜"] } },
    { text: "夜更かしは、次の日の自分から借金するようなものですよね。", when: { slots: ["深夜"] } },

    // --- 音楽が鳴っている時 ---
    { text: "この曲、作業のテンポに合っていますね。", when: { music: true } },
    { text: "音楽があると、手がよく動く気がします。", when: { music: true } },

    // --- ポモドーロ中 ---
    { text: "いまは手を止めずにいきましょう。終わったら伸びをしましょうね。", when: { pomodoro: "focus" } },
    { text: "休憩中は、画面から目を離すのがいちばん効きます。", when: { pomodoro: "break" } }
  ];

  function matchesContext(line, context = {}) {
    const when = line?.when;
    if (!when) return true;
    if (Array.isArray(when.slots) && !when.slots.includes(context.slot)) return false;
    if (when.music === true && !context.music) return false;
    if (when.pomodoro && when.pomodoro !== context.pomodoro) return false;
    return true;
  }

  // 状況に合う行を優先しつつ、最近言ったものは避ける。
  // 合う行が全部最近使われていたら、状況を問わない行へ落ちる。
  function selectFallbackLine(context = {}, recentTexts = [], random = Math.random) {
    const recent = new Set((Array.isArray(recentTexts) ? recentTexts : []).map(String));
    const usable = FALLBACK_LINES.filter((line) => matchesContext(line, context));
    // 状況が指定されている行（＝今にぴったりの行）を先に見る。
    const situational = usable.filter((line) => line.when && !recent.has(line.text));
    const general = usable.filter((line) => !line.when && !recent.has(line.text));
    const pool = situational.length
      ? situational
      : (general.length ? general : usable);
    if (!pool.length) return "";
    return pool[Math.floor(random() * pool.length)].text;
  }

  // 生成に失敗した時、キューへまとめて積むぶん。
  function buildFallbackQueue(context = {}, count = 8, random = Math.random) {
    const picked = [];
    const used = [];
    for (let index = 0; index < count; index += 1) {
      const text = selectFallbackLine(context, used, random);
      if (!text) break;
      used.push(text);
      picked.push({ text, sources: [] });
    }
    return picked;
  }

  return { FALLBACK_LINES, matchesContext, selectFallbackLine, buildFallbackQueue };
});
