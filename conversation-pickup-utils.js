// 会話から「覚えておきたいこと」を拾う。
//
// これまでは、専用の質問に答えた時か「教える」メニューから入れた時しか
// 覚えなかった。ふつうに喋った内容は会話履歴（直近12件）に残るだけで、
// 押し出されたら消える。だから好きな音楽の話をしても
// 「好きな音楽の話も、いつか聞いてみたいです」と言い続けていた。
//
// AIに拾わせた結果を受け取り、既存の器（ことば帳・思い出帳・自己回答）へ
// 入れられる形に整える。**新しい保管場所は作らない。** データ管理画面で
// 確認・削除できるのは既存の器だけなので、そこへ寄せないと
// 「勝手に覚えられて消せない」ものが生まれてしまう。
(function exposeConversationPickupUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviConversationPickup = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const KINDS = new Set(["word", "memory", "music"]);
  const MAX_TEXT = 60;

  // 拾ってはいけないもの。覚えられると気持ち悪い・害があるもの。
  // 会話AIの判断だけに任せず、こちらでも落とす。
  const SENSITIVE = [
    /\d{2,4}[-/年]\d{1,2}[-/月]\d{1,2}/,          // 生年月日など
    /\d{3}-?\d{4}-?\d{4}/,                          // 電話番号
    /〒?\d{3}-?\d{4}/,                              // 郵便番号
    /[\w.+-]+@[\w-]+\.[\w.-]+/,                     // メールアドレス
    /https?:\/\//,                                  // URL
    /(パスワード|password|APIキー|api[_ ]?key|token|クレジット|カード番号|口座|マイナンバー)/i,
    /(住所|本名|実名|勤務先|通院|持病|病名|薬|診断)/
  ];

  function normalizeText(rawText) {
    // 改行と連続空白をつぶす。ことば帳は一覧で見るので、1行に収める。
    return String(rawText || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TEXT);
  }

  function isSensitive(text) {
    return SENSITIVE.some((pattern) => pattern.test(text));
  }

  // 既に覚えているものと同じか。表記ゆれ程度は同じ扱いにする。
  function isDuplicate(text, existingTexts) {
    const key = text.replace(/[\s　・、,。.]/g, "").toLowerCase();
    if (!key) return true;
    return existingTexts.some((existing) => {
      const other = String(existing || "").replace(/[\s　・、,。.]/g, "").toLowerCase();
      if (!other) return false;
      return other === key || other.includes(key) || key.includes(other);
    });
  }

  // AIの返答（JSON配列を期待）から、使える候補だけを取り出す。
  // 形が違っても落ちないようにする。拾えなければ空で返せばよい。
  function parsePickups(rawAnswer) {
    const text = String(rawAnswer || "").trim();
    if (!text) return [];
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) return [];
    let parsed;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch (_error) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const pickups = [];
    for (const item of parsed) {
      const kind = String(item?.kind || "").trim();
      const value = normalizeText(item?.text);
      if (!KINDS.has(kind) || !value) continue;
      // 短すぎる語は助詞や相づちと紛れる。
      if (kind === "word" && value.length < 2) continue;
      if (isSensitive(value)) continue;
      pickups.push({ kind, text: value });
    }
    return pickups;
  }

  // 一度の会話で覚えるのは最大2件まで。拾いすぎると気持ち悪いし、
  // ことば帳が会話の切れ端で埋まって、教えた言葉が押し出される。
  function selectPickups(pickups, existing = {}, limit = 2) {
    const words = (existing.words || []).slice();
    const memories = (existing.memories || []).slice();
    const selected = [];
    for (const pickup of pickups) {
      if (selected.length >= limit) break;
      if (pickup.kind === "music") {
        // 音楽の好みは1つしか持てない。既にあれば上書きしない
        //（利用者が自分で答えたものを、会話の切れ端で潰さない）。
        if (existing.music) continue;
        if (selected.some((entry) => entry.kind === "music")) continue;
        selected.push(pickup);
        continue;
      }
      const pool = pickup.kind === "word" ? words : memories;
      if (isDuplicate(pickup.text, pool)) continue;
      pool.push(pickup.text);
      selected.push(pickup);
    }
    return selected;
  }

  return { parsePickups, selectPickups, normalizeText, isSensitive, isDuplicate };
});
