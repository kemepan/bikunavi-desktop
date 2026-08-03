# 再生中のメディアがあるかを SMTC（システムのメディア再生情報）から読み、
# 約4秒ごとに1行ずつ標準出力へ返す常駐ヘルパー。
# macOS の native/now-playing（MediaRemote）の Windows 版にあたる。
# 出力の語彙も mac 版に合わせる: playing / stopped / unknown
#
# Spotify・ブラウザ・メディアプレイヤーなど、Windows のメディア
# コントロール（再生中に音量表示へ出るアレ）に載るものはすべて拾える。
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Runtime.WindowsRuntime

# WinRT の async メソッドを PowerShell 5.1 から待つための定番手順
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation``1"
})[0]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$asTask = $asTaskGeneric.MakeGenericMethod($managerType)

$manager = $null

function Get-PlaybackStatus {
  try {
    if (-not $script:manager) {
      $task = $script:asTask.Invoke($null, @($script:managerType::RequestAsync()))
      $null = $task.Wait(3000)
      $script:manager = $task.Result
    }
    if (-not $script:manager) { return "unknown" }
    $session = $script:manager.GetCurrentSession()
    # セッションが無い = どのアプリも再生情報を出していない
    if (-not $session) { return "stopped" }
    $info = $session.GetPlaybackInfo()
    if ($info.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing) {
      return "playing"
    }
    return "stopped"
  } catch {
    # 途中で読めなくなったら次の周回で作り直す
    $script:manager = $null
    return "unknown"
  }
}

while ($true) {
  $status = Get-PlaybackStatus
  try {
    [Console]::Out.WriteLine($status)
    [Console]::Out.Flush()
  } catch {
    # 親（びくたん）が居なくなってパイプが閉じたら、残らず終わる
    exit
  }
  Start-Sleep -Seconds 4
}
