const assert = require("node:assert/strict");
const { matchErrand, classifyConfirmation, listErrandIds } = require("../errand-utils");

// --- 頼まれた時だけ拾う ---
{
  assert.equal(matchErrand("Inbox整理しておいて")?.id, "organize-inbox");
  assert.equal(matchErrand("インボックスの仕分けお願い")?.id, "organize-inbox");
  assert.equal(matchErrand("受信箱を片付けてもらえますか")?.id, "organize-inbox");
  assert.equal(matchErrand("今日のデイリーメモ作って")?.id, "daily-memo");
  assert.equal(matchErrand("作業サマリを用意してほしい")?.id, "work-summary");
}

// --- 雑談や質問で動かさない ---
{
  // 依頼の形をしていない。
  assert.equal(matchErrand("Inboxが散らかってる"), undefined);
  assert.equal(matchErrand("デイリーメモって便利だよね"), undefined);
  // 質問。状況を聞いているだけで、やってほしいとは言っていない。
  assert.equal(matchErrand("Inbox整理した？"), undefined);
  assert.equal(matchErrand("作業サマリある？"), undefined);
  // 対象が無い。「整理して」だけでは部屋の片付けとも取れる。
  assert.equal(matchErrand("整理しておいて"), undefined);
  assert.equal(matchErrand("片付けてお願い"), undefined);
  // 対象はあるが、何をするか言っていない。
  assert.equal(matchErrand("Inboxお願い"), undefined);
  // 空。
  assert.equal(matchErrand(""), undefined);
  assert.equal(matchErrand(null), undefined);
}

// --- 依頼の形をした質問は拾う ---
{
  // 「〜してもらえますか？」は疑問符が付くが依頼。
  assert.equal(matchErrand("Inboxを整理してもらえますか？")?.id, "organize-inbox");
}

// --- 確認への返事 ---
{
  // 選択肢ボタンの文言。
  assert.equal(classifyConfirmation("お願い"), "yes");
  assert.equal(classifyConfirmation("やめておく"), "no");
  // 口で言われた時の揺れ。
  for (const text of ["うん", "はい", "やって", "いいよ", "どうぞ", "頼むね"]) {
    assert.equal(classifyConfirmation(text), "yes", text);
  }
  for (const text of ["やめて", "やらないで", "いらない", "ううん", "キャンセル"]) {
    assert.equal(classifyConfirmation(text), "no", text);
  }
  // どちらとも取れないものは実行しない。**曖昧なら動かさないのが安全側。**
  for (const text of ["ところで今日は何日？", "ありがとう", "うーん", ""]) {
    assert.equal(classifyConfirmation(text), "unclear", text);
  }
  // 「いいです」は断りの意味で使われることが多い。
  assert.equal(classifyConfirmation("いいです"), "no");
}

// --- 仕事の一覧 ---
{
  assert.deepEqual(listErrandIds(), ["organize-inbox", "daily-memo", "work-summary"]);
}

console.log("errand-utils: OK");
