const assert = require("node:assert/strict");
const {
  parsePickups,
  selectPickups,
  normalizeText,
  isSensitive,
  isDuplicate
} = require("../conversation-pickup-utils");

// --- AIの返答から候補を取り出す ---
{
  const answer = `わかりました。
[{"kind":"word","text":"ぬくぬく"},{"kind":"music","text":"シティポップ"}]`;
  assert.deepEqual(parsePickups(answer), [
    { kind: "word", text: "ぬくぬく" },
    { kind: "music", text: "シティポップ" }
  ]);

  // 形が違っても落ちない。拾えなければ空でよい。
  assert.deepEqual(parsePickups(""), []);
  assert.deepEqual(parsePickups("覚えることはありません"), []);
  assert.deepEqual(parsePickups("[壊れたJSON"), []);
  assert.deepEqual(parsePickups('{"kind":"word"}'), []);
  assert.deepEqual(parsePickups('[{"kind":"unknown","text":"x"}]'), []);
  assert.deepEqual(parsePickups('[{"kind":"word","text":""}]'), []);
  // 1文字の語は助詞や相づちと紛れるので使わない。
  assert.deepEqual(parsePickups('[{"kind":"word","text":"あ"}]'), []);
}

// --- 覚えてはいけないものを落とす ---
{
  for (const text of [
    "1990年5月3日",
    "090-1234-5678",
    "test@example.com",
    "https://example.com/a",
    "パスワードは1234",
    "APIキーを教える",
    "住所は東京",
    "持病がある"
  ]) {
    assert.equal(isSensitive(text), true, `落とせていない: ${text}`);
  }
  // ふつうの会話は通る。
  for (const text of ["シティポップ", "ぬくぬく", "夕方の散歩が好き"]) {
    assert.equal(isSensitive(text), false, `落としすぎ: ${text}`);
  }
  // 解析の時点で除外される。
  assert.deepEqual(parsePickups('[{"kind":"memory","text":"電話は090-1234-5678"}]'), []);
}

// --- 整形 ---
{
  assert.equal(normalizeText("  ぬく  ぬく \n した "), "ぬく ぬく した");
  assert.equal(normalizeText("あ".repeat(100)).length, 60);
  assert.equal(normalizeText(null), "");
}

// --- 既に覚えているものと重ねない ---
{
  assert.equal(isDuplicate("ぬくぬく", ["ぬくぬく"]), true);
  // 表記ゆれ程度は同じ扱い。
  assert.equal(isDuplicate("ぬくぬく", ["ぬく ぬく"]), true);
  assert.equal(isDuplicate("散歩", ["夕方の散歩が好き"]), true);
  assert.equal(isDuplicate("ぬくぬく", ["おひるね"]), false);
  assert.equal(isDuplicate("", []), true);
}

// --- 一度に覚える数を抑える ---
{
  const pickups = [
    { kind: "word", text: "ぬくぬく" },
    { kind: "word", text: "まったり" },
    { kind: "word", text: "のんびり" }
  ];
  assert.equal(selectPickups(pickups, {}, 2).length, 2);

  // 既に持っている語は選ばない。
  const selected = selectPickups(pickups, { words: ["ぬくぬく"] }, 2);
  assert.deepEqual(selected.map((entry) => entry.text), ["まったり", "のんびり"]);

  // 同じバッチ内での重複も弾く。
  assert.equal(
    selectPickups([
      { kind: "word", text: "ぬくぬく" },
      { kind: "word", text: "ぬく ぬく" }
    ], {}, 2).length,
    1
  );
}

// --- 音楽の好みは、自分で答えたものを会話の切れ端で潰さない ---
{
  const pickups = [{ kind: "music", text: "シティポップ" }];
  assert.equal(selectPickups(pickups, {}, 2).length, 1);
  assert.equal(selectPickups(pickups, { music: "ジャズ" }, 2).length, 0);
  // 同じ会話で2つ拾っても、入るのは1つだけ。
  assert.equal(
    selectPickups([
      { kind: "music", text: "シティポップ" },
      { kind: "music", text: "ジャズ" }
    ], {}, 2).length,
    1
  );
}

console.log("conversation-pickup-utils: OK");
