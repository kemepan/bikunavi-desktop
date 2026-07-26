// びくたんが「？」で終わるセリフを言った時、キーボードを使わず
// ワンクリックで返せる選択肢を作る。
//
// 選択肢はAIに作らせず、ここでローカルに用意する。独り言の出力形式
// （種別|参照ID|セリフ）へ列を足すと、source-utils.js の列順回収パスと
// 衝突するため。質問の型は語尾から判定できるので、これで足りる。
(function exposeIdleChoiceUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviIdleChoice = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  // 疑問詞と同じ字を含むが、問いかけではない言い回し。先に取り除く。
  // 例:「いつの間にか減っていて焦りませんか？」の「いつ」を疑問詞と誤らない。
  const IDIOMS = /いつの間に|いつのまに|いつも|いつか|なんとなく|何となく|なんだか|何だか|なんとも|何とも|なんとか|何とか|何気|なにげ|どうにか|どうも|どうやら|どうせ|どんどん|どれだけ|いくらでも/g;

  // 疑問詞のある質問は、定型の相づちでは答えにならない。
  // 「いま何を作ってるところですか？」に「わかる」を返しても噛み合わない。
  const OPEN_QUESTION = /(?:何|なに|なん|どんな|どの|どこ|いつ|どう|どちら|どれ|なぜ|どうして|誰|だれ|いくつ|いくら)/;

  // 許可・提案。「お昼寝を挟んでもいいですか？」「休憩しましょうか？」
  const PERMISSION = /(?:ても|でも)(?:いい|良い|よい)(?:です)?(?:か|かな)[?？]\s*$|ましょうか[?？]\s*$/;
  // 素直なYes/No。長い語尾から先に見る（「ましたか」を「ます」で取りこぼさない）。
  const YES_NO = /(?:でしたか|ましたか|ですか|ますか)(?:ね)?[?？]\s*$/;

  // 共感を求める問いかけ。「焦りませんか？」「日が暮れていましたね？」
  //
  // 「〜ませんか？」は誘い（休憩しませんか）にも共感（焦りませんか）にもなり、
  // 語尾だけでは分けられない。びくたんには体がなく行動へ誘う独り言は出にくい
  // ので、共感を既定にする。誘いは「ましょうか」「てもいいですか」で拾う。
  const EMPATHY = /(?:ますよね|ですよね|でしょう|でしょ|よね|かも|ね)[?？]\s*$|ませんか[?？]\s*$/;

  function suggestReplyChoices(rawText) {
    const text = String(rawText || "").trim();
    if (!text) return [];
    if (!/[?？]\s*$/.test(text)) return [];
    if (OPEN_QUESTION.test(text.replace(IDIOMS, ""))) return [];

    // 順序が意味を持つ。「ですかね？」はYes/Noだが「ですね？」は共感なので、
    // 「か」を含む形を先に確定させてから、残りを共感として拾う。
    if (PERMISSION.test(text)) return ["いいね", "あとでね"];
    if (YES_NO.test(text)) return ["うん", "ううん"];
    if (EMPATHY.test(text)) return ["わかる", "そうかも", "うーん"];
    return [];
  }

  return { suggestReplyChoices };
});
