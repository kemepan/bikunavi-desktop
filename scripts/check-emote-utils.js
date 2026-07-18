const assert = require("node:assert/strict");
const { selectChatEmote } = require("../emote-utils");

assert.equal(selectChatEmote("normal", "調整できます。試してみましょう。"), "joy");
assert.equal(selectChatEmote("", "できました。これで大丈夫です。"), "proud");
assert.equal(selectChatEmote("normal", "削除すると元に戻せないので注意してください。"), "normal");
assert.equal(selectChatEmote("normal", "それはびっくりですね。"), "surprised");
assert.equal(selectChatEmote("normal", "ふふ、それはちょっと面白いです。"), "wink");
assert.equal(selectChatEmote("proud", "順番を説明します。"), "proud");
assert.equal(selectChatEmote("joy", "危険な操作なので注意してください。"), "normal");
assert.equal(selectChatEmote("", "確認します。", "エラーが出て困っています"), "normal");

console.log("emote-utils: OK");
