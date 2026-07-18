const assert = require("node:assert/strict");
const {
  isSafeIdleUserNameUsage,
  repairBikutanSelfReferences,
  restoreLegacyUserVocatives
} = require("../identity-utils");

assert.equal(
  repairBikutanSelfReferences("びくにたんも試してみたいです。", ""),
  "びくにたんも試してみたいです。"
);
assert.equal(
  repairBikutanSelfReferences("びくにたん、一緒に試しますか？", "びくにたん"),
  "びくにたん、一緒に試しますか？"
);
assert.equal(
  repairBikutanSelfReferences("けいこは雨音が好きです。", "けいこ"),
  "びくたんは雨音が好きです。"
);
assert.equal(
  restoreLegacyUserVocatives(
    "びくたんは、この前の設定を調べてみようかな。びくたんは何から始めますか？",
    "びくにたん"
  ),
  "びくたんは、この前の設定を調べてみようかな。びくにたんは何から始めますか？"
);
assert.equal(
  restoreLegacyUserVocatives("びくたん、一緒に検証してみますか？", "びくにたん"),
  "びくにたん、一緒に検証してみますか？"
);
assert.equal(
  restoreLegacyUserVocatives("びくたんも、一度試してみます？", "びくにたん"),
  "びくにたんも、一度試してみます？"
);
assert.equal(isSafeIdleUserNameUsage("けいこは今何してますか？", "けいこ"), true);
assert.equal(isSafeIdleUserNameUsage("けいこは雨音が好きです。", "けいこ"), false);

console.log("identity-utils: OK");
