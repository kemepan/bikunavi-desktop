(function exposeVadUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviVad = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function calculateRms(samples) {
    if (!samples?.length) return 0;
    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Number(samples[index]) || 0;
      sum += sample * sample;
    }
    return Math.sqrt(sum / samples.length);
  }

  function createVoiceActivityDetector(options = {}) {
    const config = {
      minStartRms: Number(options.minStartRms) || 0.045,
      // 環境ノイズで押し上げられる開始しきい値の上限。
      // 実測では発話RMSの中央値が約0.107で、雑音時のしきい値が0.106まで
      // 上がっていた（＝普通の声がちょうど埋もれる高さ）。ここで頭を打たせる。
      maxStartRms: Number(options.maxStartRms) || 0.075,
      minContinueRms: Number(options.minContinueRms) || 0.018,
      // 雑音の中で声を拾えないより、たまに空振りする方がまし。
      // 空振りは「発話なし」判定と文字起こしの除外で落ちる。
      noiseMultiplier: Number(options.noiseMultiplier) || 3,
      continueNoiseMultiplier: Number(options.continueNoiseMultiplier) || 1.8,
      startMs: Number(options.startMs) || 360,
      minSpeechMs: Number(options.minSpeechMs) || 420,
      // 会話の「話し終わったのに待たされる」間を抑える。
      // 600ms以下だと文中の短い間で分割しやすかったため、700msを初期値にする。
      silenceMs: Number(options.silenceMs) || 700,
      maxSpeechMs: Number(options.maxSpeechMs) || 18000,
      initialNoiseFloor: Number(options.initialNoiseFloor) || 0.006
    };
    let noiseFloor = config.initialNoiseFloor;
    let active = false;
    let aboveMs = 0;
    let quietMs = 0;
    let speechMs = 0;

    const reset = ({ preserveNoise = true } = {}) => {
      active = false;
      aboveMs = 0;
      quietMs = 0;
      speechMs = 0;
      if (!preserveNoise) noiseFloor = config.initialNoiseFloor;
    };

    const process = (rawLevel, rawElapsedMs, overrides = {}) => {
      const level = Math.max(0, Number(rawLevel) || 0);
      const elapsedMs = Math.max(1, Math.min(500, Number(rawElapsedMs) || 0));
      const requestedStartThreshold = Number(overrides.minStartRms);
      const requestedStartMs = Number(overrides.startMs);
      const minStartRms = Number.isFinite(requestedStartThreshold)
        ? Math.max(config.minStartRms, requestedStartThreshold)
        : config.minStartRms;
      const startMs = Number.isFinite(requestedStartMs)
        ? Math.max(config.startMs, requestedStartMs)
        : config.startMs;
      // 上限は下限より下がらないようにする（読み上げ中など、呼び出し側が
      // わざと高いしきい値を指定してくる場合があるため）。
      const startThreshold = Math.min(
        Math.max(minStartRms, config.maxStartRms),
        Math.max(minStartRms, noiseFloor * config.noiseMultiplier)
      );
      const continueThreshold = Math.max(
        config.minContinueRms,
        noiseFloor * config.continueNoiseMultiplier
      );
      let started = false;
      let ended = false;
      let reason = "";
      // 声らしい大きさなのに開始に至らなかった音。拾えなかった時は今まで何も
      // 記録が残らず、しきい値の調整が勘になっていたので、惜しい音を数える。
      let nearMiss = false;

      if (!active) {
        // 発話候補より十分小さい音だけで環境ノイズをゆっくり追従する。
        // キーボード音など一時的な大音量で閾値が跳ね上がらないようにする。
        if (level < startThreshold * 0.72) {
          noiseFloor += (level - noiseFloor) * 0.035;
          noiseFloor = Math.max(0.0015, Math.min(0.04, noiseFloor));
        }
        if (level >= startThreshold) {
          aboveMs += elapsedMs;
        } else {
          // 下限は超えているのに、ノイズで上がったしきい値に届かなかった音。
          nearMiss = level >= config.minStartRms;
          aboveMs = Math.max(0, aboveMs - elapsedMs * 1.6);
        }
        if (aboveMs >= startMs) {
          active = true;
          started = true;
          speechMs = aboveMs;
          quietMs = 0;
        }
      } else {
        speechMs += elapsedMs;
        if (level >= continueThreshold) quietMs = 0;
        else quietMs += elapsedMs;

        if (speechMs >= config.maxSpeechMs) {
          ended = true;
          reason = "max-duration";
        } else if (speechMs >= config.minSpeechMs && quietMs >= config.silenceMs) {
          ended = true;
          reason = "silence";
        }
        if (ended) {
          active = false;
          aboveMs = 0;
          quietMs = 0;
          speechMs = 0;
        }
      }

      return {
        active,
        started,
        ended,
        reason,
        nearMiss,
        level,
        noiseFloor,
        startThreshold,
        continueThreshold
      };
    };

    return {
      process,
      reset,
      isActive: () => active,
      getNoiseFloor: () => noiseFloor
    };
  }

  function isUsableTranscript(rawText, options = {}) {
    const text = String(rawText || "").replace(/\s+/g, " ").trim();
    if (!text) return false;
    const compact = text.replace(/[。．.!！?？…・\s]/g, "").toLowerCase();
    if (!compact) return false;
    if ([
      "[blank_audio]",
      "(blank_audio)",
      "[無音]",
      "(無音)",
      "無音",
      "[音楽]",
      "(音楽)",
      "音楽",
      "ご視聴ありがとうございました",
      "ご清聴ありがとうございました",
      "チャンネル登録よろしくお願いします"
    ].includes(compact)) return false;

    // 短い環境音をWhisperが別れの挨拶として補うことがある。
    // 手動録音で本当に言った時は通し、常時待機の時だけ除外する。
    if (options.handsFree && [
      "バイバイ",
      "バイバーイ",
      "ばいばい",
      "ばいばーい",
      "bye",
      "byebye"
    ].includes(compact)) return false;
    return true;
  }

  return { calculateRms, createVoiceActivityDetector, isUsableTranscript };
});
