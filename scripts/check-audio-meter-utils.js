const assert = require("node:assert/strict");
const {
  createAudioDropMeter,
  measureAudioGap,
  recordProcessingTime,
  droppedMs,
  formatDropSummary
} = require("../audio-meter-utils");

// 48kHz・4096サンプルなら1コールバックあたり約85.33ms。
const meterOptions = { sampleRate: 48000, bufferSize: 4096 };
{
  const meter = createAudioDropMeter(meterOptions);
  assert.ok(Math.abs(meter.expectedGapMs - 85.333) < 0.01);
}

// 定間隔で届いている間は取りこぼし0。最初のコールバックは基準なので0。
{
  const meter = createAudioDropMeter(meterOptions);
  let audioTime = 12.5;
  assert.deepEqual(measureAudioGap(meter, audioTime), { droppedBuffers: 0, gapMs: 0 });
  for (let index = 0; index < 50; index += 1) {
    audioTime += 4096 / 48000;
    assert.equal(measureAudioGap(meter, audioTime).droppedBuffers, 0);
  }
  assert.equal(meter.droppedBuffers, 0);
  assert.equal(meter.callbacks, 51);
}

// 多少のジッタ（1.5倍まで）は取りこぼしとして数えない。
{
  const meter = createAudioDropMeter(meterOptions);
  measureAudioGap(meter, 0);
  assert.equal(measureAudioGap(meter, 0.128).droppedBuffers, 0);
  assert.equal(meter.droppedBuffers, 0);
}

// メインスレッドが約250ms詰まると、その間の2バッファ分が落ちる。
{
  const meter = createAudioDropMeter(meterOptions);
  measureAudioGap(meter, 0);
  const result = measureAudioGap(meter, 0.256, "speaking+capturing");
  assert.equal(result.droppedBuffers, 2);
  assert.ok(Math.abs(result.gapMs - 256) < 0.001);
  assert.equal(meter.droppedBuffers, 2);
  assert.equal(meter.worstGapLabel, "speaking+capturing");
  assert.ok(Math.abs(droppedMs(meter) - 170.67) < 0.01);
}

// 最悪ギャップは更新された時だけラベルを差し替える。
{
  const meter = createAudioDropMeter(meterOptions);
  measureAudioGap(meter, 0);
  measureAudioGap(meter, 0.4, "thinking");
  measureAudioGap(meter, 0.5, "idle");
  assert.equal(meter.worstGapLabel, "thinking");
  assert.ok(Math.abs(meter.worstGapMs - 400) < 0.001);
}

// 時計が巻き戻る・壊れた値が来ても計測を壊さない。
{
  const meter = createAudioDropMeter(meterOptions);
  measureAudioGap(meter, 5);
  assert.equal(measureAudioGap(meter, 4).gapMs, 0);
  assert.equal(measureAudioGap(meter, NaN).droppedBuffers, 0);
  assert.equal(measureAudioGap(meter, undefined).droppedBuffers, 0);
  assert.equal(meter.droppedBuffers, 0);
}

// sampleRate不明の環境では計測せず、素通しする。
{
  const meter = createAudioDropMeter({});
  assert.deepEqual(measureAudioGap(meter, 1), { droppedBuffers: 0, gapMs: 0 });
  assert.equal(formatDropSummary(meter), "音声バッファの計測データがありません。");
}

{
  const meter = createAudioDropMeter(meterOptions);
  recordProcessingTime(meter, 0.4, "idle");
  recordProcessingTime(meter, 18.2, "streaming");
  recordProcessingTime(meter, -1, "壊れた値");
  recordProcessingTime(meter, NaN, "壊れた値");
  assert.ok(Math.abs(meter.processingMsTotal - 18.6) < 0.001);
  assert.equal(meter.worstProcessingMs, 18.2);
  assert.equal(meter.worstProcessingLabel, "streaming");
}

{
  const meter = createAudioDropMeter(meterOptions);
  measureAudioGap(meter, 0);
  measureAudioGap(meter, 0.256, "speaking");
  recordProcessingTime(meter, 1.5, "speaking");
  const summary = formatDropSummary(meter);
  assert.ok(summary.includes("callbacks 2"));
  assert.ok(summary.includes("dropped 2 buffers"));
  assert.ok(summary.includes("during speaking"));
}

console.log("audio-meter-utils: OK");
