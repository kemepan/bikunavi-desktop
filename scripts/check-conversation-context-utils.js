const assert = require("node:assert/strict");
const { pickConversationContext } = require("../conversation-context-utils");

const now = 1_000_000;

{
  const displayed = { text: "いま表示しているニュース", kind: "news" };
  const result = pickConversationContext({
    displayedLineItem: displayed,
    lastAmbientLine: { text: "新しい独り言", time: now - 1000 },
    latestChatEntry: { answer: "直前の回答", time: now - 500 },
    now
  });
  assert.equal(result.item, displayed);
  assert.equal(result.direct, true);
}

{
  const result = pickConversationContext({
    lastAmbientLine: { text: "少し前の独り言", time: now - 30000 },
    latestChatEntry: { answer: "いちばん新しい回答", time: now - 1000 },
    now
  });
  assert.equal(result.item.text, "いちばん新しい回答");
  assert.equal(result.item.kind, "recent-answer");
  assert.equal(result.direct, false);
}

{
  const result = pickConversationContext({
    lastAmbientLine: { text: "いちばん新しい独り言", time: now - 500 },
    latestChatEntry: { answer: "前の回答", time: now - 5000 },
    now
  });
  assert.equal(result.item.text, "いちばん新しい独り言");
}

{
  const result = pickConversationContext({
    lastAmbientLine: { text: "古い独り言", time: now - 100000 },
    latestChatEntry: { answer: "古い回答", time: now - 400000 },
    now
  });
  assert.equal(result.item, undefined);
  assert.equal(result.direct, false);
}

{
  const result = pickConversationContext({
    latestChatEntry: {
      answer: "うまく考えられませんでした。トレイメニューの「会話AI」設定を確認してください。",
      time: now - 1000
    },
    now
  });
  assert.equal(result.item, undefined);
}

console.log("conversation-context-utils: OK");

// 表示しっぱなしの独り言を、何時間も経ってから「返信先」として使わない。
{
  const now = Date.UTC(2026, 6, 23, 6, 0, 0);
  const stale = {
    text: "ふと気になってことば帳を開いてみたんですが。",
    time: now - 6 * 60 * 60 * 1000
  };
  const picked = pickConversationContext({ displayedLineItem: stale, now });
  assert.equal(picked.direct, false);
  assert.equal(picked.item, undefined);

  const fresh = { text: "ことば帳を開いてみたんですが。", time: now - 30000 };
  const pickedFresh = pickConversationContext({ displayedLineItem: fresh, now });
  assert.equal(pickedFresh.direct, true);
  assert.equal(pickedFresh.item, fresh);

  // 表示時刻を持たない項目は、これまでどおり直接返信として扱う。
  const untimed = { text: "時刻を持たないセリフ。" };
  assert.equal(pickConversationContext({ displayedLineItem: untimed, now }).direct, true);
}

console.log("conversation-context-utils（返信先の鮮度）: OK");
