const assert = require("node:assert/strict");
const {
  DAY_MS,
  awayDuration,
  describeAway,
  shouldWelcomeBack
} = require("../welcome-back-utils");

const now = Date.UTC(2026, 6, 28, 12, 0, 0);

// 初回起動（記録なし）では言わない。久しぶりになる相手がいない。
assert.equal(shouldWelcomeBack(0, { now }), false);
assert.equal(shouldWelcomeBack(undefined, { now }), false);
assert.equal(shouldWelcomeBack(null, { now }), false);

// 毎日使っている間は言わない。
assert.equal(shouldWelcomeBack(now - DAY_MS, { now }), false);
assert.equal(shouldWelcomeBack(now - DAY_MS * 2.9, { now }), false);

// 3日空いたら言う。
assert.equal(shouldWelcomeBack(now - DAY_MS * 3, { now }), true);
assert.equal(shouldWelcomeBack(now - DAY_MS * 30, { now }), true);

// しきい値は変えられる。
assert.equal(shouldWelcomeBack(now - DAY_MS * 2, { now, minAwayMs: DAY_MS }), true);

// 時計が巻き戻っていても誤作動しない。
assert.equal(shouldWelcomeBack(now + DAY_MS * 5, { now }), false);
assert.equal(awayDuration(now + DAY_MS, now), 0);

// 言い方。
assert.equal(describeAway(DAY_MS * 3), "3日ぶり");
assert.equal(describeAway(DAY_MS * 13), "13日ぶり");
assert.equal(describeAway(DAY_MS * 14), "2週間ぶり");
assert.equal(describeAway(DAY_MS * 21), "3週間ぶり");
assert.equal(describeAway(DAY_MS * 60), "2か月ぶり");
assert.equal(describeAway(DAY_MS * 0.5), "");
assert.equal(describeAway(0), "");
assert.equal(describeAway(undefined), "");

console.log("welcome-back-utils: OK");
