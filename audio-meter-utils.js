// ScriptProcessorNode の取りこぼし計測。
//
// ScriptProcessorNode のコールバックはレンダラーのメインスレッドで走るため、
// Live2D描画やDOM更新でスレッドが詰まると、その間の入力バッファは
// キューに溜まらず上書きで捨てられる。一方 AudioContext.currentTime は
// 音声クロックで進み続けるので、コールバック間隔が1バッファ分より
// 明らかに長ければ、その差がそのまま捨てられた音になる。
//
// AudioWorkletNode へ移行すべきかを、体感ではなく実測で決めるための計測。
(function exposeAudioMeterUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviAudioMeter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function createAudioDropMeter({
    sampleRate,
    bufferSize,
    // 1バッファ分の間隔にはジッタが乗るため、この倍率を超えた時だけ
    // 取りこぼしとして数える。1.75なら2バッファ分近く空いた時に1個。
    dropRatioThreshold = 1.75
  } = {}) {
    const rate = Number(sampleRate) || 0;
    const size = Number(bufferSize) || 0;
    return {
      sampleRate: rate,
      bufferSize: size,
      expectedGapMs: rate > 0 ? size / rate * 1000 : 0,
      dropRatioThreshold,
      started: false,
      lastAudioTime: 0,
      callbacks: 0,
      droppedBuffers: 0,
      worstGapMs: 0,
      worstGapLabel: "",
      processingMsTotal: 0,
      worstProcessingMs: 0,
      worstProcessingLabel: ""
    };
  }

  // audioTime には AudioContext.currentTime（秒）を渡す。
  function measureAudioGap(meter, rawAudioTime, label = "") {
    if (!meter || meter.expectedGapMs <= 0) return { droppedBuffers: 0, gapMs: 0 };
    const audioTime = Number(rawAudioTime);
    if (!Number.isFinite(audioTime)) return { droppedBuffers: 0, gapMs: 0 };

    meter.callbacks += 1;
    if (!meter.started) {
      meter.started = true;
      meter.lastAudioTime = audioTime;
      return { droppedBuffers: 0, gapMs: 0 };
    }

    const gapMs = Math.max(0, (audioTime - meter.lastAudioTime) * 1000);
    meter.lastAudioTime = audioTime;

    const ratio = gapMs / meter.expectedGapMs;
    const droppedBuffers = ratio >= meter.dropRatioThreshold
      ? Math.max(0, Math.round(ratio) - 1)
      : 0;
    meter.droppedBuffers += droppedBuffers;
    if (gapMs > meter.worstGapMs) {
      meter.worstGapMs = gapMs;
      meter.worstGapLabel = String(label || "");
    }
    return { droppedBuffers, gapMs };
  }

  function recordProcessingTime(meter, rawMs, label = "") {
    if (!meter) return;
    const ms = Number(rawMs);
    if (!Number.isFinite(ms) || ms < 0) return;
    meter.processingMsTotal += ms;
    if (ms > meter.worstProcessingMs) {
      meter.worstProcessingMs = ms;
      meter.worstProcessingLabel = String(label || "");
    }
  }

  function droppedMs(meter) {
    if (!meter) return 0;
    return meter.droppedBuffers * meter.expectedGapMs;
  }

  function formatDropSummary(meter) {
    if (!meter || !meter.callbacks) return "音声バッファの計測データがありません。";
    const dropRate = meter.droppedBuffers / (meter.callbacks + meter.droppedBuffers) * 100;
    const averageProcessingMs = meter.processingMsTotal / meter.callbacks;
    return [
      `callbacks ${meter.callbacks}`,
      `dropped ${meter.droppedBuffers} buffers (${dropRate.toFixed(2)}%, ${Math.round(droppedMs(meter))}ms)`,
      `worst gap ${Math.round(meter.worstGapMs)}ms` +
        (meter.worstGapLabel ? ` during ${meter.worstGapLabel}` : ""),
      `callback avg ${averageProcessingMs.toFixed(2)}ms`,
      `worst ${meter.worstProcessingMs.toFixed(1)}ms` +
        (meter.worstProcessingLabel ? ` during ${meter.worstProcessingLabel}` : "")
    ].join(", ");
  }

  return {
    createAudioDropMeter,
    measureAudioGap,
    recordProcessingTime,
    droppedMs,
    formatDropSummary
  };
});
