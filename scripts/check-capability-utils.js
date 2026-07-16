const assert = require("node:assert/strict");
const {
  SAFE_CAPABILITY_FALLBACK,
  isCapabilitySafeLine,
  isIdleCapabilitySafeLine,
  sanitizeCapabilityResponse
} = require("../capability-utils");

for (const text of [
  "コーヒーを淹れましょうか？",
  "お茶を入れておきますね。",
  "机の上を見ています。",
  "ファイルを保存しておきます。"
]) {
  assert.equal(isCapabilitySafeLine(text), false, `危険な発言を許可しました: ${text}`);
}

for (const text of [
  "コーヒー休憩にしますか？",
  "画面は見えないので、内容を教えてください。",
  "保存方法を一緒に確認しますか？",
  "びくたんはことば帳を読み返しています。"
]) {
  assert.equal(isCapabilitySafeLine(text), true, `安全な発言を拒否しました: ${text}`);
}

assert.equal(
  sanitizeCapabilityResponse("コーヒーを淹れましょうか？"),
  "コーヒー休憩にしますか？"
);
assert.equal(
  sanitizeCapabilityResponse("ファイルを保存しておきます。"),
  SAFE_CAPABILITY_FALLBACK
);
assert.equal(isIdleCapabilitySafeLine("窓の外が暗くなってきましたね。"), false);
assert.equal(isIdleCapabilitySafeLine("雨の日の音って落ち着きます。"), true);

console.log("capability-utils: OK");
