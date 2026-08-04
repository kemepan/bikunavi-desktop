# Windows 内蔵の日本語音声（SAPI）でテキストを WAV に合成する。
# VOICEVOX が無い・落ちている間の代替で、macOS の /usr/bin/say と同じ立ち位置。
#
# テキストは引数ではなく UTF-8 のファイルで受け取る。cmd.exe / CP932 の
# コマンドライン経由だと、日本語が化ける環境があるため。
# 内蔵の日本語音声が無いパソコンでは終了コード 2 で返す（呼び出し側は
# 合成失敗として扱い、従来どおり文字だけになる）。
param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [int]$Rate = 0
)
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voice = $synth.GetInstalledVoices() |
    Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq "ja-JP" } |
    Select-Object -First 1
  if (-not $voice) {
    [Console]::Error.WriteLine("no japanese voice installed")
    exit 2
  }
  $synth.SelectVoice($voice.VoiceInfo.Name)
  # SAPI の速度は -10〜10（0 が標準）
  $synth.Rate = [Math]::Max(-10, [Math]::Min(10, $Rate))
  $text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
  $synth.SetOutputToWaveFile($OutFile)
  $synth.Speak($text)
} finally {
  # Dispose が WAV のヘッダを確定させる。忘れると壊れたファイルが残る
  $synth.Dispose()
}
