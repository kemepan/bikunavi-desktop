// びくたんに「お願い」できる決まった仕事。
//
// 自由に動くエージェントにはしない。**設定フォルダの中に置かれたものだけ**を、
// 必ず確認を取ってから実行する。承認が2択で済むので小さな吹き出しにも収まるし、
// 危険な範囲が最初から限られる。
//
// ここは「どの仕事を頼まれたか」を決めるところだけ。実体の解決と実行は main 側。
(function exposeErrandUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviErrand = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  // 依頼の形かどうか。「Inboxどうなってる？」を実行と取らないため。
  const REQUEST_HINTS = [
    // 「〜しておいて」「〜してもらえますか」「〜してほしい」など。
    /て(?:おいて|もらえ|もらい|ください|くれ|ほしい|欲しい|ね|おこう)/,
    // 「作って」「整理して」のように、テ形で言い切る頼み方。
    /て[。．.！!]?\s*$/,
    /して/,
    /お願い/,
    /やって/,
    /頼(?:む|める|んだ)/
  ];

  // 設定に書かれた語を、そのまま正規表現にしない（記号で壊れる・意図せぬ一致を招く）。
  function includesWord(text, word) {
    const needle = String(word || "").trim().toLowerCase();
    if (!needle) return false;
    return text.toLowerCase().includes(needle);
  }

  // registry: [{ id, label, keywords: [], verbs: [] }]
  // keywords（対象）と verbs（動作）の両方が要る。「整理しておいて」だけでは
  // 部屋の片付けとも取れるので動かさない。
  function matchErrand(rawText, registry = []) {
    const text = String(rawText || "").trim();
    if (!text) return undefined;
    if (!Array.isArray(registry) || !registry.length) return undefined;
    const looksLikeRequest = REQUEST_HINTS.some((pattern) => pattern.test(text));
    // 疑問だけの文は依頼ではない。「Inbox整理した？」で動かさない。
    if (!looksLikeRequest) return undefined;
    for (const errand of registry) {
      const keywords = Array.isArray(errand?.keywords) ? errand.keywords : [];
      const verbs = Array.isArray(errand?.verbs) && errand.verbs.length
        ? errand.verbs
        : ["整理", "片付", "かたづ", "仕分", "作", "つく", "用意", "実行", "動かし"];
      if (!keywords.some((word) => includesWord(text, word))) continue;
      if (!verbs.some((word) => includesWord(text, word))) continue;
      return { id: errand.id, label: errand.label || errand.id };
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

  // 設定から読んだ1件を、使える形か検査する。
  //
  // **script はファイル名だけ。** パス区切りや `..` を許すと、設定ファイル1つで
  // どこの何でも実行できる箱になってしまう。実体は必ず設定フォルダの中に置く。
  function normalizeErrandEntry(rawEntry) {
    const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
    const label = String(entry.label || "").trim().slice(0, 40);
    const script = String(entry.script || "").trim();
    const keywords = (Array.isArray(entry.keywords) ? entry.keywords : [])
      .map((word) => String(word || "").trim())
      .filter(Boolean)
      .slice(0, 8);
    const verbs = (Array.isArray(entry.verbs) ? entry.verbs : [])
      .map((word) => String(word || "").trim())
      .filter(Boolean)
      .slice(0, 8);
    if (!label || !script || !keywords.length) return undefined;
    if (/[\\/]/.test(script) || script.includes("..")) return undefined;
    return { id: script, label, script, keywords, verbs };
  }

  function normalizeErrandRegistry(rawList) {
    if (!Array.isArray(rawList)) return [];
    const seen = new Set();
    const registry = [];
    for (const raw of rawList) {
      const entry = normalizeErrandEntry(raw);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      registry.push(entry);
      // 一度にたくさん登録されても扱いきれない。
      if (registry.length >= 12) break;
    }
    return registry;
  }

  return {
    matchErrand,
    classifyConfirmation,
    normalizeErrandEntry,
    normalizeErrandRegistry,
    CONFIRM_CHOICES: ["お願い", "やめておく"]
  };
});
