const assert = require("node:assert/strict");
const {
  cleanChatPunctuation,
  isGreetingOnly,
  looksLikeCorrection,
  recentlyUsedUserName
} = require("../conversation-quality-utils");

assert.equal(
  cleanChatPunctuation("一緒に考えましょうか。」「何かあります？"),
  "一緒に考えましょうか。何かあります？"
);
assert.equal(cleanChatPunctuation("「うれしい！」と思いました。"), "「うれしい！」と思いました。");

assert.equal(isGreetingOnly("こんにちは。"), true);
assert.equal(isGreetingOnly("こんにちは。お腹すいた"), false);
assert.equal(looksLikeCorrection("びくたんを作るってことだよ"), true);
assert.equal(looksLikeCorrection("まだできない"), false);

const history = [
  { role: "assistant", text: "びくにたん、それいいですね。" },
  { role: "user", text: "そうかな" }
];
assert.equal(recentlyUsedUserName(history, "びくにたん"), true);
assert.equal(recentlyUsedUserName(history, "びくたん"), false);

console.log("conversation-quality-utils: OK");
