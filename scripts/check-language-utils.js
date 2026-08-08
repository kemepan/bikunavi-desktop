const assert = require("node:assert/strict");
const { looksJapanese, japaneseRatio } = require("../language-utils");

// --- 日本語として通すもの ---
{
  for (const text of [
    "今日はいい天気ですね。",
    "ことば帳を読み返しています。",
    // 外来語が多い文も通す。落とすと普段のセリフが消える。
    "FigmaのUIアップデートが来ました。",
    "VOICEVOXを入れると声が出ます。",
    "AIの話題を3件ほど集めました。"
  ]) {
    assert.equal(looksJapanese(text), true, text);
  }
}

// --- 落とすもの ---
{
  // 実際に出てしまったベトナム語のセリフ。
  const vietnamese =
    "Thông tấn xã Việt Nam đưa tin, cuộc thi thiết kế logo chính thức cho APEC 2027 " +
    "đã bắt đầu nhận bài dự thi rồi。";
  assert.equal(looksJapanese(vietnamese), false);
  assert.equal(japaneseRatio(vietnamese), 0);

  for (const text of [
    "The design contest has started.",
    "Hacker News: Show HN: a tiny database",
    "안녕하세요"
  ]) {
    assert.equal(looksJapanese(text), false, text);
  }
}

// --- 空・壊れた入力 ---
{
  assert.equal(looksJapanese(""), false);
  assert.equal(looksJapanese("   "), false);
  assert.equal(looksJapanese(null), false);
  // 記号と数字だけでは判断できないので通さない。
  assert.equal(looksJapanese("2026/08/09 — !!!"), false);
  assert.equal(japaneseRatio(""), 0);
}

// --- 割合の目安 ---
{
  // 漢字だけの短い文も日本語。
  assert.equal(looksJapanese("休憩時間"), true);
  // 日本語が1文字混ざるだけの外国語は通さない。
  assert.equal(looksJapanese("This is a very long English sentence about design の"), false);
}

console.log("language-utils: OK");
