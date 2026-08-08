const assert = require("node:assert/strict");
const {
  matchErrand,
  classifyConfirmation,
  normalizeErrandEntry,
  normalizeErrandRegistry
} = require("../errand-utils");

// 設定から読んだ想定の登録リスト。
const registry = normalizeErrandRegistry([
  { label: "Inboxの整理", script: "organize-inbox.sh", keywords: ["inbox", "インボックス", "受信箱"] },
  { label: "今日のメモを作る", script: "daily-memo.sh", keywords: ["デイリーメモ", "今日のメモ"] }
]);

// --- 設定の検査 ---
{
  assert.equal(registry.length, 2);
  assert.equal(registry[0].script, "organize-inbox.sh");

  // **実体はファイル名だけ。** パスを書けると、設定ファイル1つでどこの何でも
  // 実行できる箱になってしまう。
  assert.equal(normalizeErrandEntry({ label: "x", script: "/bin/sh", keywords: ["x"] }), undefined);
  assert.equal(normalizeErrandEntry({ label: "x", script: "../evil.sh", keywords: ["x"] }), undefined);
  assert.equal(normalizeErrandEntry({ label: "x", script: "a/b.sh", keywords: ["x"] }), undefined);
  assert.equal(normalizeErrandEntry({ label: "x", script: "a\\b.sh", keywords: ["x"] }), undefined);

  // 足りない項目は使わない。
  assert.equal(normalizeErrandEntry({ script: "a.sh", keywords: ["x"] }), undefined);
  assert.equal(normalizeErrandEntry({ label: "x", keywords: ["x"] }), undefined);
  assert.equal(normalizeErrandEntry({ label: "x", script: "a.sh" }), undefined);
  assert.equal(normalizeErrandEntry(null), undefined);

  // 壊れた設定でも落ちない。
  assert.deepEqual(normalizeErrandRegistry(null), []);
  assert.deepEqual(normalizeErrandRegistry("なにか"), []);
  assert.deepEqual(normalizeErrandRegistry([null, 1, "x"]), []);

  // 同じ実体は一度だけ。
  assert.equal(normalizeErrandRegistry([
    { label: "A", script: "a.sh", keywords: ["a"] },
    { label: "B", script: "a.sh", keywords: ["b"] }
  ]).length, 1);
}

// --- 頼まれた時だけ拾う ---
{
  assert.equal(matchErrand("Inbox整理しておいて", registry)?.label, "Inboxの整理");
  assert.equal(matchErrand("インボックスの仕分けお願い", registry)?.label, "Inboxの整理");
  assert.equal(matchErrand("受信箱を片付けてもらえますか", registry)?.label, "Inboxの整理");
  assert.equal(matchErrand("今日のデイリーメモ作って", registry)?.label, "今日のメモを作る");
}

// --- 雑談や質問で動かさない ---
{
  assert.equal(matchErrand("Inboxが散らかってる", registry), undefined);
  assert.equal(matchErrand("Inbox整理した？", registry), undefined);
  // 対象が無い。「整理して」だけでは部屋の片付けとも取れる。
  assert.equal(matchErrand("整理しておいて", registry), undefined);
  // 対象はあるが、何をするか言っていない。
  assert.equal(matchErrand("Inboxお願い", registry), undefined);
  assert.equal(matchErrand("", registry), undefined);
  assert.equal(matchErrand(null, registry), undefined);
}

// --- 登録が無ければ、機能ごと眠る ---
{
  // 設定していない人には、この機能は存在しないのと同じ。
  assert.equal(matchErrand("Inbox整理しておいて", []), undefined);
  assert.equal(matchErrand("Inbox整理しておいて"), undefined);
}

// --- 語はそのまま含まれるかで見る（正規表現として解釈しない）---
{
  const odd = normalizeErrandRegistry([
    { label: "変な名前", script: "odd.sh", keywords: ["a.b(c)"] }
  ]);
  assert.equal(matchErrand("a.b(c) を実行して", odd)?.label, "変な名前");
  // ドットが任意の1文字として効いてしまうと、これも一致してしまう。
  assert.equal(matchErrand("axb(c) を実行して", odd), undefined);
}

// --- 確認への返事 ---
{
  assert.equal(classifyConfirmation("お願い"), "yes");
  assert.equal(classifyConfirmation("やめておく"), "no");
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
  assert.equal(classifyConfirmation("いいです"), "no");
}

console.log("errand-utils: OK");
