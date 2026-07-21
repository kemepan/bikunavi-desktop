const assert = require("node:assert/strict");
const { selectChatEmote } = require("../emote-utils");

assert.equal(selectChatEmote("normal", "調整できます。試してみましょう。"), "joy");
assert.equal(selectChatEmote("", "できました。これで大丈夫です。"), "proud");
assert.equal(selectChatEmote("normal", "削除すると元に戻せないので注意してください。"), "normal");
assert.equal(selectChatEmote("normal", "それはびっくりですね。"), "surprised");
assert.equal(selectChatEmote("normal", "ふふ、それはちょっと面白いです。"), "wink");
assert.equal(selectChatEmote("proud", "順番を説明します。"), "proud");
assert.equal(selectChatEmote("joy", "危険な操作なので注意してください。"), "normal");

// 謝罪・失敗は困り顔（f04）
assert.equal(selectChatEmote("", "ごめんなさい、うまくできませんでした。"), "troubled");
assert.equal(selectChatEmote("", "確認します。", "エラーが出て困っています"), "troubled");
assert.equal(selectChatEmote("troubled", "申し訳ないです、もう一度試しますね。"), "troubled");

// 悲しみ・喪失は泣き顔（f05）
assert.equal(selectChatEmote("", "それは悲しいですね。少しそばにいます。"), "sad");
assert.equal(selectChatEmote("sad", "寂しい夜は、あたたかい飲み物がいいですよ。"), "sad");
// 悲しみ系でもAIがtroubledを選んだら尊重する
assert.equal(selectChatEmote("troubled", "心配なことがあるんですね。"), "troubled");

// 危険・深刻はまじめな顔のまま
assert.equal(selectChatEmote("sad", "これはセキュリティ上の深刻な問題です。"), "normal");

assert.equal(selectChatEmote("", "冗談はさておき、進めましょう。"), "wink");

// 独り言にも同じローカル判定を使い、内容に反する喜び顔を避ける
assert.equal(selectChatEmote("", "わっ、これはびっくりです。"), "surprised");
assert.equal(selectChatEmote("", "ごめんなさい、今日はうまくできませんでした。"), "troubled");
assert.equal(selectChatEmote("", "ふふ、ちょっといいことを思いつきました。"), "wink");

console.log("emote-utils: OK");
