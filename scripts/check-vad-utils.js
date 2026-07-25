const assert = require("node:assert/strict");
const {
  calculateRms,
  classifyTranscriptConfidence,
  createVoiceActivityDetector,
  isUsableTranscript
} = require("../vad-utils");

assert.equal(calculateRms(new Float32Array()), 0);
assert.ok(Math.abs(calculateRms(new Float32Array([0.5, -0.5])) - 0.5) < 0.0001);

{
  const vad = createVoiceActivityDetector({ startMs: 300, silenceMs: 800 });
  for (let index = 0; index < 20; index += 1) {
    const state = vad.process(0.006, 60);
    assert.equal(state.started, false);
  }
  assert.equal(vad.isActive(), false);

  assert.equal(vad.process(0.06, 60).started, false);
  assert.equal(vad.process(0.06, 60).started, false);
  assert.equal(vad.process(0.06, 60).started, false);
  assert.equal(vad.process(0.06, 60).started, false);
  assert.equal(vad.process(0.06, 60).started, true);
  assert.equal(vad.isActive(), true);

  for (let index = 0; index < 10; index += 1) {
    assert.equal(vad.process(0.005, 60).ended, false);
  }
  assert.equal(vad.process(0.005, 200).ended, true);
  assert.equal(vad.isActive(), false);
}

// 机を一度叩く・キーを一度押すような短い突発音では開始しない。
{
  const vad = createVoiceActivityDetector();
  assert.equal(vad.process(0.14, 85).started, false);
  assert.equal(vad.process(0.008, 85).started, false);
  assert.equal(vad.process(0.008, 85).started, false);
  assert.equal(vad.isActive(), false);
}

{
  const vad = createVoiceActivityDetector({ startMs: 120, maxSpeechMs: 500 });
  assert.equal(vad.process(0.08, 60).started, false);
  assert.equal(vad.process(0.08, 60).started, true);
  assert.equal(vad.process(0.08, 300).ended, false);
  const ended = vad.process(0.08, 100);
  assert.equal(ended.ended, true);
  assert.equal(ended.reason, "max-duration");
}

{
  const vad = createVoiceActivityDetector({ startMs: 180 });
  assert.equal(vad.process(0.05, 100, { minStartRms: 0.075, startMs: 280 }).started, false);
  assert.equal(vad.process(0.05, 200, { minStartRms: 0.075, startMs: 280 }).started, false);
  assert.equal(vad.isActive(), false);
}

assert.equal(isUsableTranscript("今日は何をしようか"), true);
assert.equal(isUsableTranscript("ご視聴ありがとうございました。"), false);
assert.equal(isUsableTranscript("[BLANK_AUDIO]"), false);
assert.equal(isUsableTranscript("[音楽]"), false);
assert.equal(isUsableTranscript("……"), false);
assert.equal(isUsableTranscript("バイバーイ！"), true);
assert.equal(isUsableTranscript("バイバーイ！", { handsFree: true }), false);
assert.equal(isUsableTranscript("Bye bye!", { handsFree: true }), false);

console.log("vad-utils: OK");

// 環境ノイズで開始しきい値が青天井に上がらない（雑音の中で声を拾えなくなる）。
{
  const vad = createVoiceActivityDetector({ maxStartRms: 0.075 });
  // 大きめの環境ノイズを流し込んでノイズ推定を上げる。
  for (let index = 0; index < 400; index += 1) vad.process(0.03, 85);
  const state = vad.process(0.03, 85);
  assert.ok(state.noiseFloor > 0.02, `noiseFloor=${state.noiseFloor}`);
  // 3倍なら0.06超だが、上限0.075で頭打ちになる。
  assert.ok(state.startThreshold <= 0.0751, `startThreshold=${state.startThreshold}`);
}

// 上限は、呼び出し側が指定した高いしきい値（読み上げ中の自己音声よけ）を下げない。
{
  const vad = createVoiceActivityDetector({ maxStartRms: 0.075 });
  const state = vad.process(0.01, 85, { minStartRms: 0.09 });
  assert.ok(state.startThreshold >= 0.09, `startThreshold=${state.startThreshold}`);
}

// 下限は超えたのにしきい値へ届かなかった音を nearMiss として数える。
{
  const vad = createVoiceActivityDetector();
  for (let index = 0; index < 400; index += 1) vad.process(0.02, 85);
  const missed = vad.process(0.05, 85);
  assert.equal(missed.started, false);
  assert.equal(missed.nearMiss, true);
  // 静かすぎる音は nearMiss にしない（ただの環境音）。
  assert.equal(vad.process(0.004, 85).nearMiss, false);
}

console.log("vad-utils（ノイズ耐性）: OK");

// 聞き取りの確信度は3段階。極端に低いものは環境音とみなして会話へ送らない。
{
  // 確信度を返さない経路（Whisper）を巻き込まない。0を「低い」とみなすと全損する。
  assert.equal(classifyTranscriptConfidence(0), "trusted");
  assert.equal(classifyTranscriptConfidence(undefined), "trusted");
  assert.equal(classifyTranscriptConfidence(null), "trusted");
  assert.equal(classifyTranscriptConfidence(NaN), "trusted");
  assert.equal(classifyTranscriptConfidence("なし"), "trusted");
  assert.equal(classifyTranscriptConfidence(-1), "trusted");

  // 2026-07-25の実測。環境音の誤認識で、文字数は信頼の根拠にならない。
  for (const value of [0.003, 0.004, 0.005, 0.021, 0.035, 0.056, 0.068, 0.092, 0.129]) {
    assert.equal(classifyTranscriptConfidence(value), "ignore", `confidence=${value}`);
  }
  // 同じく実測。ここは聞き返して確かめる帯。
  for (const value of [0.283, 0.3, 0.334, 0.362, 0.408, 0.418]) {
    assert.equal(classifyTranscriptConfidence(value), "confirm", `confidence=${value}`);
  }
  for (const value of [0.45, 0.573, 0.918, 0.982, 1]) {
    assert.equal(classifyTranscriptConfidence(value), "trusted", `confidence=${value}`);
  }

  // 境界はしきい値そのものを含まない側で切り替わる。
  assert.equal(classifyTranscriptConfidence(0.149), "ignore");
  assert.equal(classifyTranscriptConfidence(0.15), "confirm");
  assert.equal(classifyTranscriptConfidence(0.449), "confirm");

  // しきい値は較正できる。
  assert.equal(classifyTranscriptConfidence(0.2, { ignoreBelow: 0.3 }), "ignore");
  assert.equal(classifyTranscriptConfidence(0.5, { confirmBelow: 0.6 }), "confirm");
  // 逆転した指定でも、確実な帯を巻き込まない（ignoreは常にconfirm以下から）。
  assert.equal(classifyTranscriptConfidence(0.5, { ignoreBelow: 0.9, confirmBelow: 0.2 }), "trusted");
}

console.log("vad-utils（確信度の3段階）: OK");
