// びくたんが日本語以外で喋り出すのを止める。
//
// 話題は Google News（日本語指定）と Hacker News（英語）から集めていて、
// 日本語指定でも外国語の見出しが混ざることがある。プロンプトに言語の指定が
// 無かったため、AIが見出しの言語に引きずられて、そのまま外国語で独り言を
// 作ることがあった（2026-08-09にベトナム語で発生）。
//
// プロンプト側でも「日本語で」と言うが、指示は落ちることがあるので、
// 出てきた文の側でも確かめる。
(function exposeLanguageUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviLanguage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  // 日本語の文字。ひらがな・カタカナ・長音・漢字。
  const JAPANESE = /[ぁ-んァ-ヶー々一-龯]/g;

  // 記号・数字・空白を除いた「文字らしい部分」だけで割合を見る。
  // 「Figma」「UI」のような外来語が多い文でも、地の文が日本語なら通す。
  function japaneseRatio(rawText) {
    const text = String(rawText || "");
    let letters = 0;
    for (const char of text) {
      if (/[\s\d]/.test(char)) continue;
      // 句読点や記号は数えない（言語の判断材料にならない）。
      if (/[\p{P}\p{S}]/u.test(char)) continue;
      letters += 1;
    }
    if (!letters) return 0;
    const japanese = (text.match(JAPANESE) || []).length;
    return japanese / letters;
  }

  // 日本語の文として通すか。
  //
  // 0.3 にしているのは、「FigmaのUIアップデートが来ました」のように外来語が
  // 半分近くを占める文を落とさないため。外国語の文は日本語の文字を1つも
  // 含まないので、この線で十分に分かれる。
  function looksJapanese(rawText, minRatio = 0.3) {
    const text = String(rawText || "").trim();
    if (!text) return false;
    return japaneseRatio(text) >= minRatio;
  }

  return { looksJapanese, japaneseRatio };
});
