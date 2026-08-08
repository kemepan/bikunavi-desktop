// びくたんに「お願い」できる決まった仕事。
//
// 自由に動くエージェントにはしない。**名前のついた仕事だけ**を、必ず確認を
// 取ってから実行する。承認が「お願い / やめておく」の2択で済むので、小さな
// 吹き出しにも収まるし、危険な範囲が最初から限られる。
//
// ここは「どの仕事を頼まれたか」を決めるところだけ。実際に何を動かすかは
// main 側が持つ（実行できるものは環境によって違うため）。
(function exposeErrandUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviErrand = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  // 頼み方の揺れを拾う。AIに判定させると、雑談を仕事の依頼と取り違えた時に
  // 黙って実行してしまう。**確実に言葉で示された時だけ**動かす。
  const ERRANDS = [
    {
      id: "organize-inbox",
      label: "Inboxの整理",
      // 「整理して」だけでは部屋の片付けとも取れるので、対象を必ず伴わせる。
      subjects: [/inbox/i, /インボックス/, /受信箱/],
      verbs: [/整理/, /片付け/, /かたづけ/, /仕分け/]
    },
    {
      id: "daily-memo",
      label: "今日のデイリーメモを作る",
      subjects: [/デイリーメモ/, /日次メモ/, /今日のメモ/],
      verbs: [/作/, /つく/, /用意/, /開/]
    },
    {
      id: "work-summary",
      label: "今日の作業サマリを作る",
      subjects: [/作業サマリ/, /作業まとめ/, /サマリ/],
      verbs: [/作/, /つく/, /用意/, /開/]
    }
  ];

  // 依頼の形かどうか。「Inboxどうなってる？」を実行と取らないため。
  const REQUEST_HINTS = [
    // 「〜しておいて」「〜してもらえますか」「〜してほしい」など。
    // 動詞は仕事ごとに違うので、活用語尾の側で拾う。
    /て(?:おいて|もらえ|もらい|ください|くれ|ほしい|欲しい|ね|おこう)/,
    // 「作って」「整理して」のように、テ形で言い切る頼み方。
    /て[。．.！!]?\s*$/,
    /して/,
    /お願い/,
    /やって/,
    /頼(?:む|める|んだ)/
  ];

  function matchErrand(rawText) {
    const text = String(rawText || "").trim();
    if (!text) return undefined;
    // 疑問だけの文は依頼ではない。「Inbox整理した？」で動かさない。
    if (/[?？]\s*$/.test(text) && !REQUEST_HINTS.some((p) => p.test(text))) return undefined;
    if (!REQUEST_HINTS.some((pattern) => pattern.test(text))) return undefined;
    for (const errand of ERRANDS) {
      const hasSubject = errand.subjects.some((pattern) => pattern.test(text));
      if (!hasSubject) continue;
      const hasVerb = errand.verbs.some((pattern) => pattern.test(text));
      if (hasVerb) return { id: errand.id, label: errand.label };
    }
    return undefined;
  }

  // 確認への返事。選択肢ボタンの文言と、口で言われた時の揺れの両方を見る。
  const AFFIRMATIVE = [/^お願い/, /^おねがい/, /^うん/, /^はい/, /^やって/, /^いいよ/, /^どうぞ/, /^頼/];
  const NEGATIVE = [/^やめ/, /^いい(?:です)?[。.]?$/, /^やらな/, /^いらな/, /^ううん/, /^いえ/, /^キャンセル/];

  function classifyConfirmation(rawText) {
    const text = String(rawText || "").trim();
    if (!text) return "unclear";
    if (NEGATIVE.some((pattern) => pattern.test(text))) return "no";
    if (AFFIRMATIVE.some((pattern) => pattern.test(text))) return "yes";
    return "unclear";
  }

  function listErrandIds() {
    return ERRANDS.map((errand) => errand.id);
  }

  return { matchErrand, classifyConfirmation, listErrandIds, CONFIRM_CHOICES: ["お願い", "やめておく"] };
});
