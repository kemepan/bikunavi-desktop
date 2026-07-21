const assert = require("node:assert/strict");
const {
  normalizeDataEdit,
  normalizeDiaryLines,
  normalizeUserName
} = require("../data-edit-utils");

assert.equal(normalizeUserName("  「びくにたん」\n  "), "びくにたん");
assert.equal(normalizeUserName(""), "");
assert.deepEqual(normalizeDiaryLines("・一行目\r\n- 二行目\n\n三行目"), [
  "一行目",
  "二行目",
  "三行目"
]);
assert.equal(normalizeDiaryLines("1\n2\n3\n4\n5\n6").length, 5);

assert.deepEqual(normalizeDataEdit("userName", "『けいこ』"), { ok: true, value: "けいこ" });
assert.equal(normalizeDataEdit("learnedWord", "  好きな言葉  ").value, "好きな言葉");
assert.equal(normalizeDataEdit("sharedMemory", "\u0000思い出").value, "思い出");
assert.deepEqual(normalizeDataEdit("diary", "朝\n夜"), { ok: true, value: ["朝", "夜"] });
assert.equal(normalizeDataEdit("diary", "   ").ok, false);
assert.equal(normalizeDataEdit("history", "変更").ok, false);

console.log("data-edit-utils: OK");
