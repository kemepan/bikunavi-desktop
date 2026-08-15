// ことば帳で教わった語が、独り言に出すぎないようにする。
//
// ことば帳は毎回プロンプトへ入るうえ、独り言は20行をまとめて作るので、
// 一度使うと同じバッチ内で繰り返されやすい。既存の重複排除は文の類似度を
// 見るため、「お昼寝したい」「お昼寝の時間」のように文が違えば素通りする。
// ここでは語そのものの出現回数で頭を打たせる。
(function exposeIdleVocabularyUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviIdleVocabulary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  // ことば帳は「語＋説明」で書かれることが多い（例:「お昼寝　眠たい時に使う」）。
  // 先頭の語だけを取り出す。説明文まで含めると本文と一致しなくなる。
  function extractLearnedTerm(rawText) {
    const text = String(rawText || "").trim();
    if (!text) return "";
    const head = text.split(/[\s　、,。．:：=＝\-—–「」『』（）()]+/).filter(Boolean)[0] || "";
    // 1文字の語は助詞や感嘆と紛れて誤爆するので使わない。
    return head.length >= 2 ? head.slice(0, 24) : "";
  }

  function extractLearnedTerms(learnedWords = []) {
    const terms = [];
    for (const item of Array.isArray(learnedWords) ? learnedWords : []) {
      const term = extractLearnedTerm(item?.text ?? item);
      if (term && !terms.includes(term)) terms.push(term);
    }
    return terms;
  }

  // 1バッチの中で、同じ語を使う話題をいくつまで通すかを数える。
  //
  // 判定は話題のまとまり単位で行う想定。続きものを途中で落とすと話が
  // 宙に浮くので、頭の行ではなくまとまり全体のテキストを渡すこと。
  // 「20個のうち最大2個」は絶対数だったので、**手持ちが少ないほど同じ語が
  // 何度も回ってくる。** 実際、ことば帳3語の状態で「同じ言葉ばかり出る」と
  // 指摘を受けた。3語しか無ければ、2個使うたびにそのどれかになる。
  // 手持ちの数に合わせて、触れる回数と、1バッチで同じ語を使える回数を絞る。
  //
  // **2つを別々に数える。** 触れてよい回数は、ことば帳と思い出帳を合わせた数で
  // 決めてよい。だが同じ語の重複は **ことば帳の語数だけ** で決める。重複を数える
  // 仕組み（createLearnedTermLimiter）が見ているのは learnedWords だけなので、
  // 思い出帳の件数を足して判断すると、ことば帳が3語でも「たくさんある」ことに
  // なってしまう。
  function learnedMentionLimits(total = 0, wordCount = total) {
    const count = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
    const words = Number.isFinite(wordCount) ? Math.max(0, Math.trunc(wordCount)) : 0;
    // ことば帳が10語そろえば散らばるので、同じ語が2回出ても目立たない。
    const maxPerTerm = words >= 10 ? 2 : 1;
    if (count === 0) return { mentions: 0, maxPerTerm };
    // 5件以下: 1バッチ(20個)に1回まで。
    if (count < 6) return { mentions: 1, maxPerTerm };
    return { mentions: 2, maxPerTerm };
  }

  function createLearnedTermLimiter(terms, { maxPerTerm = 2 } = {}) {
    const termList = (Array.isArray(terms) ? terms : []).filter(Boolean);
    const used = {};
    return {
      // 通してよければ true（同時に使用回数を数える）。上限超過なら false。
      accept(rawText) {
        if (!termList.length) return true;
        const text = String(rawText || "");
        const hit = termList.find((term) => text.includes(term));
        if (!hit) return true;
        const next = (used[hit] || 0) + 1;
        if (next > maxPerTerm) return false;
        used[hit] = next;
        return true;
      },
      getUsage: () => ({ ...used }),
      // ログ用。「お昼寝×2」のような並びにする。
      describeUsage() {
        const entries = Object.entries(used).filter(([, count]) => count > 0);
        return entries.map(([term, count]) => `${term}×${count}`).join(", ");
      }
    };
  }

  // 教わった語を2つ選ぶ。組み合わせて話してもらうためのお題。
  // 選ぶだけで、どのくらいの頻度で使うかは呼び出し側が決める。
  function pickTermPair(terms, random = Math.random) {
    const list = [...new Set((Array.isArray(terms) ? terms : []).filter(Boolean))];
    if (list.length < 2) return [];
    const first = Math.floor(random() * list.length);
    // 2つ目は1つ目を除いた中から選ぶ。同じ語のペアにしない。
    let second = Math.floor(random() * (list.length - 1));
    if (second >= first) second += 1;
    return [list[first], list[second]];
  }

  return {
    extractLearnedTerm,
    extractLearnedTerms,
    createLearnedTermLimiter,
    learnedMentionLimits,
    pickTermPair
  };
});
