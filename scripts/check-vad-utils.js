const assert = require("node:assert/strict");
const {
  calculateRms,
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
