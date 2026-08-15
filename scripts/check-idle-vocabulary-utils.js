const assert = require("node:assert/strict");
const { learnedMentionLimits,
  extractLearnedTerm,
  extractLearnedTerms,
  createLearnedTermLimiter
} = require("../idle-vocabulary-utils");

// ことば帳は「語＋説明」で書かれる。先頭の語だけを取る。
assert.equal(extractLearnedTerm("お昼寝　眠たい時に使う"), "お昼寝");
assert.equal(extractLearnedTerm("エモい 良い感じという意味"), "エモい");
assert.equal(extractLearnedTerm("リギング：ボーンを入れる作業"), "リギング");
assert.equal(extractLearnedTerm("推し、応援している人"), "推し");
assert.equal(extractLearnedTerm("ぴえん"), "ぴえん");

// 1文字は助詞や感嘆と紛れるので使わない。
assert.equal(extractLearnedTerm("あ　驚いた時"), "");
assert.equal(extractLearnedTerm(""), "");
assert.equal(extractLearnedTerm(undefined), "");

{
  const terms = extractLearnedTerms([
    { text: "お昼寝　眠たい時に使う" },
    { text: "エモい 良い感じ" },
    { text: "お昼寝　重複しても一度だけ" },
    { text: "あ　1文字は無視" },
    { text: "" }
  ]);
  assert.deepEqual(terms, ["お昼寝", "エモい"]);
}
assert.deepEqual(extractLearnedTerms(), []);
assert.deepEqual(extractLearnedTerms(undefined), []);

// 同じ語を使う話題は上限までしか通さない。
{
  const limiter = createLearnedTermLimiter(["お昼寝", "エモい"], { maxPerTerm: 2 });
  assert.equal(limiter.accept("そろそろお昼寝したいです。"), true);
  assert.equal(limiter.accept("お昼寝の前にお茶を飲みます。"), true);
  // 3つ目は落とす。
  assert.equal(limiter.accept("お昼寝は短いほうが好きです。"), false);
  // 別の語はまだ通る。
  assert.equal(limiter.accept("この配色エモいですね。"), true);
  // ことば帳と関係ない話題は常に通る。
  assert.equal(limiter.accept("リギングのボーン名で迷います。"), true);
  assert.equal(limiter.accept("コーヒーを淹れ直しました。"), true);

  assert.deepEqual(limiter.getUsage(), { "お昼寝": 2, "エモい": 1 });
  assert.equal(limiter.describeUsage(), "お昼寝×2, エモい×1");
}

// ことば帳が空なら何も制限しない。
{
  const limiter = createLearnedTermLimiter([]);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(limiter.accept("お昼寝したいです。"), true);
  }
  assert.equal(limiter.describeUsage(), "");
}

// 上限は変えられる。
{
  const limiter = createLearnedTermLimiter(["お昼寝"], { maxPerTerm: 1 });
  assert.equal(limiter.accept("お昼寝したい。"), true);
  assert.equal(limiter.accept("お昼寝の話。"), false);
}

console.log("idle-vocabulary-utils: OK");

// 教わった語を2つ選んで、組み合わせのお題にする。
{
  const { pickTermPair } = require("../idle-vocabulary-utils");

  // 語が足りなければ何も返さない。
  assert.deepEqual(pickTermPair([]), []);
  assert.deepEqual(pickTermPair(["お昼寝"]), []);
  assert.deepEqual(pickTermPair(undefined), []);

  // 同じ語のペアは作らない。乱数がどう転んでも2つは異なる。
  const terms = ["お昼寝", "カフェラテ", "エモい"];
  for (const value of [0, 0.34, 0.5, 0.67, 0.99]) {
    const pair = pickTermPair(terms, () => value);
    assert.equal(pair.length, 2, `value=${value}`);
    assert.notEqual(pair[0], pair[1], `value=${value}`);
    assert.ok(terms.includes(pair[0]) && terms.includes(pair[1]));
  }

  // 重複を渡しても、同じ語同士にならない。
  assert.deepEqual(pickTermPair(["お昼寝", "お昼寝"]), []);
  const dup = pickTermPair(["お昼寝", "お昼寝", "カフェラテ"], () => 0);
  assert.notEqual(dup[0], dup[1]);
}

// --- 手持ちの数に合わせて、触れる回数を絞る ---
{
  // 手持ちが3語しか無い状態で「同じ言葉ばかり出る」と指摘を受けた。
  // 絶対数の上限（20個中2個）だと、少ないほど同じ語が何度も回ってくる。
  assert.deepEqual(learnedMentionLimits(0), { mentions: 0, maxPerTerm: 1 });
  assert.deepEqual(learnedMentionLimits(3), { mentions: 1, maxPerTerm: 1 });
  assert.deepEqual(learnedMentionLimits(5), { mentions: 1, maxPerTerm: 1 });
  assert.deepEqual(learnedMentionLimits(6), { mentions: 2, maxPerTerm: 1 });

  // **同じ語の重複は、ことば帳の語数だけで決める。**
  // 指摘を受けた時の実際の状態: ことば帳3語・思い出帳11件。合計14件で判断すると
  // 「たくさんある」ことになり、3語をぐるぐる回す元の状態のままになってしまう。
  assert.deepEqual(learnedMentionLimits(14, 3), { mentions: 2, maxPerTerm: 1 });
  assert.deepEqual(learnedMentionLimits(30, 9), { mentions: 2, maxPerTerm: 1 });
  // ことば帳が10語そろえば散らばる。
  assert.deepEqual(learnedMentionLimits(30, 10), { mentions: 2, maxPerTerm: 2 });

  // 壊れた入力でも落ちない。
  assert.deepEqual(learnedMentionLimits(), { mentions: 0, maxPerTerm: 1 });
  assert.deepEqual(learnedMentionLimits(-5), { mentions: 0, maxPerTerm: 1 });
  assert.deepEqual(learnedMentionLimits(NaN), { mentions: 0, maxPerTerm: 1 });
  assert.deepEqual(learnedMentionLimits(14, NaN), { mentions: 2, maxPerTerm: 1 });
}

// --- 上限が limiter へ実際に効くか ---
{
  const limiter = createLearnedTermLimiter(["お昼寝"], { maxPerTerm: 1 });
  assert.equal(limiter.accept("お昼寝したいです"), true);
  assert.equal(limiter.accept("お昼寝の時間ですね"), false, "同じ語の2回目は落とす");
  assert.equal(limiter.accept("今日はいい天気です"), true, "関係ない行は通す");
}

console.log("idle-vocabulary-utils（組み合わせのお題）: OK");
