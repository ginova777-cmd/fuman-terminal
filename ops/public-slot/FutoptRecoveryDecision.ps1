$ErrorActionPreference = 'Stop'
function Get-FutoptRecoveryDecision {
  param($Status, $Process, [string]$TradeDate, [DateTimeOffset]$Now = [DateTimeOffset]::UtcNow)
  function Age($Value) {
    if ($null -eq $Value) { return [double]::PositiveInfinity }
    try {
      $instant = if ($Value -is [DateTimeOffset]) { $Value } elseif ($Value -is [DateTime]) { [DateTimeOffset]$Value } else { [DateTimeOffset]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture) }
      $seconds = ($Now - $instant.ToUniversalTime()).TotalSeconds
      if ($seconds -lt 0) { return [double]::PositiveInfinity }
      return $seconds
    } catch { return [double]::PositiveInfinity }
  }
  if ($null -ne $Process) {
    if ($null -eq $Status -or $Process.ProcessId -ne $Status.pid -or $Process.Name -ine 'node.exe' -or $Process.CommandLine -notmatch '(?i)C:[\\/]fuman-release-owner[\\/](prod81|fuman-terminal-production-20260924-repair)[\\/]scripts[\\/]fugle-futopt-websocket-collector\.js(?:\s|"|$)') {
      return 'BLOCKED_PROCESS_IDENTITY'
    }
    $updatedAge = Age $Status.updatedAt
    $transportAge = Age $Status.transportHealth.last_transport_at
    $connected = $Status.websocketConnected -is [bool] -and $Status.websocketConnected
    $authenticated = $Status.websocketAuthenticated -is [bool] -and $Status.websocketAuthenticated
    if ($updatedAge -le 90 -and $transportAge -le 90 -and $connected -and $authenticated -and -not $Status.transportHealth.protocol_error) {
      if ($Status.formalReady -is [bool] -and $Status.formalReady -and $Status.catalogueTradeDate -eq $TradeDate) { return 'HEALTHY' }
      return 'WAITING_FORMAL_EVIDENCE'
    }
  }
  return 'REQUEST_WRITER_RECONCILE'
}

