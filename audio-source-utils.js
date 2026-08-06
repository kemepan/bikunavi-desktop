// 鳴っている音が「音楽」か「それ以外」かを見分ける。
//
// これまでは「鳴っているか / いないか」しか見ておらず、動画でもポッドキャストでも
// 通話でも「このBGM、テンポいいですね」と言っていた。
//
// macOS 26.4.1 で確かめたところ、MediaRemote のメタデータ（曲名・MediaType）は
// 署名・entitlement の無いプロセスからは取れない（空の辞書が返る）。
// IsPlaying 自体も、Chrome が鳴らしている最中に stopped を返した。
// つまり macOS で使える材料は `pmset -g assertions` のプロセス名だけ。
//
// 出力の語彙は Windows 側（native/now-playing.ps1）とそろえる:
//   "music" … 音楽だと分かっている
//   "audio" … 何か鳴っているが、音楽かどうか分からない
//   ""      … 鳴っていない
(function exposeAudioSourceUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BikunaviAudioSource = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  // 音楽を鳴らすためのアプリ。これが鳴らしているなら音楽と見てよい。
  const MUSIC_APPS = [
    "music",            // Apple Music
    "itunes",
    "spotify",
    "amazon music",
    "youtube music",
    "audirvana",
    "vox",
    "foobar",
    "vlc"               // 動画も再生するが、鳴らす目的で開くことが多い
  ];

  // 音楽ではないと分かるアプリ。通話・会議・画面共有など。
  const NOT_MUSIC_APPS = [
    "zoom",
    "teams",
    "discord",
    "slack",
    "facetime",
    "skype",
    "webex",
    "quicktime",
    "podcasts",
    "obs",
    "voicevox"          // びくたん自身の声。音楽ではない
  ];

  // どちらとも言えないアプリ。音楽も動画も通話も同じ顔で鳴らす。
  const AMBIGUOUS_APPS = ["chrome", "safari", "firefox", "edge", "brave", "arc"];

  function classifyProcessName(rawName) {
    const name = String(rawName || "").trim().toLowerCase();
    if (!name) return "audio";
    if (NOT_MUSIC_APPS.some((app) => name.includes(app))) return "";
    if (MUSIC_APPS.some((app) => name.includes(app))) return "music";
    if (AMBIGUOUS_APPS.some((app) => name.includes(app))) return "audio";
    // 知らないアプリ。鳴ってはいるが音楽とは限らない。
    return "audio";
  }

  // `pmset -g assertions` の出力から、音を鳴らしているアプリを見て分類する。
  //
  //   pid 700(Google Chrome): [0x...] 00:05:36 NoIdleSleepAssertion named: "Playing audio"
  //
  // 複数鳴っている時は「音楽と分かるもの」を優先する。通話しながら音楽を
  // かけている場合、音楽の話をされて困ることはない。
  function classifyAudioAssertions(rawOutput) {
    const lines = String(rawOutput || "").split(/\r?\n/);
    let result = "";
    for (const line of lines) {
      if (!/named:\s*"Playing audio"/i.test(line)) continue;
      const matched = line.match(/pid\s+\d+\(([^)]*)\)/i);
      const kind = classifyProcessName(matched ? matched[1] : "");
      if (kind === "music") return "music";
      if (kind === "audio") result = "audio";
    }
    return result;
  }

  return { classifyAudioAssertions, classifyProcessName };
});
