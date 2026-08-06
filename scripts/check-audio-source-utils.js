const assert = require("node:assert/strict");
const { classifyAudioAssertions, classifyProcessName } = require("../audio-source-utils");

// --- アプリ名からの分類 ---
{
  // 音楽を鳴らすためのアプリ。
  for (const name of ["Music", "Spotify", "iTunes", "Amazon Music"]) {
    assert.equal(classifyProcessName(name), "music", name);
  }
  // 音楽ではないと分かるもの。通話・会議・自分の声。
  for (const name of ["zoom.us", "Microsoft Teams", "Discord", "FaceTime", "Podcasts", "VOICEVOX"]) {
    assert.equal(classifyProcessName(name), "", name);
  }
  // ブラウザは、音楽も動画も通話も同じ顔で鳴らす。決めつけない。
  for (const name of ["Google Chrome", "Safari", "firefox"]) {
    assert.equal(classifyProcessName(name), "audio", name);
  }
  // 知らないアプリも決めつけない。
  assert.equal(classifyProcessName("なにかのアプリ"), "audio");
  assert.equal(classifyProcessName(""), "audio");
  assert.equal(classifyProcessName(null), "audio");
}

// --- pmset の出力から ---
{
  const chrome = `
Assertion status system-wide:
   PreventUserIdleSystemSleep     1
   pid 700(Google Chrome): [0x00008519000182e2] 00:05:36 NoIdleSleepAssertion named: "Playing audio"
   pid 416(bluetoothd): [0x0000866700018365] 00:00:02 PreventUserIdleSystemSleep named: "com.apple.BTStack"
`;
  // 実機（macOS 26.4.1）で実際に出た形。曲だと決めつけない。
  assert.equal(classifyAudioAssertions(chrome), "audio");

  const spotify = `   pid 921(Spotify): [0x0001] 00:01:00 NoIdleSleepAssertion named: "Playing audio"`;
  assert.equal(classifyAudioAssertions(spotify), "music");

  const zoom = `   pid 512(zoom.us): [0x0002] 00:20:00 NoIdleSleepAssertion named: "Playing audio"`;
  assert.equal(classifyAudioAssertions(zoom), "");

  // 鳴っていない。
  assert.equal(classifyAudioAssertions("   pid 365(powerd): … named: \"Powerd\""), "");
  assert.equal(classifyAudioAssertions(""), "");
  assert.equal(classifyAudioAssertions(null), "");
}

// --- 複数鳴っている時 ---
{
  // 通話しながら音楽をかけている。音楽の話をされて困ることはない。
  const both = `
   pid 512(zoom.us): [0x1] 00:20:00 NoIdleSleepAssertion named: "Playing audio"
   pid 921(Spotify): [0x2] 00:01:00 NoIdleSleepAssertion named: "Playing audio"
`;
  assert.equal(classifyAudioAssertions(both), "music");

  // 通話とブラウザだけなら、音楽とは言わない。
  const callAndBrowser = `
   pid 512(zoom.us): [0x1] 00:20:00 NoIdleSleepAssertion named: "Playing audio"
   pid 700(Google Chrome): [0x2] 00:01:00 NoIdleSleepAssertion named: "Playing audio"
`;
  assert.equal(classifyAudioAssertions(callAndBrowser), "audio");
}

// --- びくたん自身の声を音楽と思わない ---
{
  const own = `   pid 999(VOICEVOX): [0x3] 00:00:05 NoIdleSleepAssertion named: "Playing audio"`;
  assert.equal(classifyAudioAssertions(own), "");
}

console.log("audio-source-utils: OK");
