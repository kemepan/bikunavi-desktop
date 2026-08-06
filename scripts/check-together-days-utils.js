const assert = require("node:assert/strict");
const {
  DAY_MS,
  countTogetherDays,
  describeTogetherDays,
  estimateFirstLaunchAt,
  isAnniversary,
  isMilestone,
  shouldMention
} = require("../together-days-utils");

const day = (n) => n * DAY_MS;

// --- 日数の数え方 ---
{
  // 初日は1日目。
  assert.equal(countTogetherDays(day(100), day(100)), 1);
  assert.equal(countTogetherDays(day(100), day(101)), 2);
  assert.equal(countTogetherDays(day(100), day(109)), 10);

  // 同じ日のうちは、何時でも同じ数（再起動で数が変わらない）。
  assert.equal(countTogetherDays(day(100), day(100) + 1000), 1);
  assert.equal(countTogetherDays(day(100), day(101) - 1), 1);

  // 記録が無ければ数えない。
  assert.equal(countTogetherDays(0, day(100)), 0);
  assert.equal(countTogetherDays(null, day(100)), 0);
  // 時計が巻き戻っている時も数えない。
  assert.equal(countTogetherDays(day(100), day(99)), 0);
}

// --- 言う日かどうか ---
{
  // 初日は「はじめまして」の領分。
  assert.equal(isMilestone(1), false);
  assert.equal(isMilestone(2), false);
  // 最初の1週間は細かく。
  assert.equal(isMilestone(3), true);
  assert.equal(isMilestone(7), true);
  // そのあとは10日ごと。
  assert.equal(isMilestone(10), true);
  assert.equal(isMilestone(20), true);
  assert.equal(isMilestone(15), false);
  // 1か月を越えたら30日ごと。
  assert.equal(isMilestone(30), true);
  assert.equal(isMilestone(60), true);
  assert.equal(isMilestone(40), false);
  assert.equal(isMilestone(50), false);

  // 1年はぴったり言う。
  assert.equal(isAnniversary(365), true);
  assert.equal(isAnniversary(730), true);
  assert.equal(isAnniversary(364), false);
  assert.equal(isAnniversary(100), false);
}

// --- 同じ節目を二度言わない ---
{
  assert.equal(shouldMention(10), true);
  assert.equal(shouldMention(10, { lastMentionedDays: 10 }), false);
  assert.equal(shouldMention(10, { lastMentionedDays: 7 }), true);
  // 節目でない日は黙る。
  assert.equal(shouldMention(11), false);
  assert.equal(shouldMention(0), false);
  // 1年は節目の剰余では拾えないが、記念日として拾う。
  assert.equal(shouldMention(365), true);
}

// --- 言い方 ---
{
  assert.equal(describeTogetherDays(10), "今日で10日目です");
  assert.equal(describeTogetherDays(30), "今日で30日目、1か月になります");
  assert.equal(describeTogetherDays(90), "今日で90日目、3か月になります");
  assert.equal(describeTogetherDays(365), "今日で、一緒に過ごして1年になります");
  assert.equal(describeTogetherDays(730), "今日で、一緒に過ごして2年になります");
  assert.equal(describeTogetherDays(0), "");
}

// --- 初回起動日が無い人の推定 ---
{
  const now = day(200);
  // 手元の記録のうち、いちばん古いものを起点にする。
  assert.equal(estimateFirstLaunchAt([day(150), day(120), day(180)], now), day(120));
  // 記録が無ければ今日から。既存利用者が全員1日目に戻るのを避けるための機能なので、
  // 何も無いなら素直に今日でよい。
  assert.equal(estimateFirstLaunchAt([], now), now);
  assert.equal(estimateFirstLaunchAt(null, now), now);
  // 壊れた値や未来の日付は使わない。
  assert.equal(estimateFirstLaunchAt([0, -5, day(999), day(140)], now), day(140));
}

console.log("together-days-utils: OK");
