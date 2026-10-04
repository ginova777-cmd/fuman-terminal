$ErrorActionPreference = 'Stop'
$RuntimeDir = 'C:\fuman-runtime'
$TerminalDir = 'C:\fuman-release-owner\prod81'
$Node = 'C:\Program Files\nodejs\node.exe'
. (Join-Path $TerminalDir 'ops\public-slot\FutoptRecoveryDecision.ps1')
$tradeDate = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow,'Taipei Standard Time').ToString('yyyy-MM-dd')
$receiptPath = Join-Path $RuntimeDir ('data\scan-receipts\daytrade-futopt-collector-recovery-'+$tradeDate.Replace('-','')+'.json')
$result = [ordered]@{contract='daytrade_futopt_collector_recovery_0835_v2';trade_date=$tradeDate;checked_at=[DateTimeOffset]::UtcNow.ToString('o');ok=$false;complete=$false;action='blocked';first_blocker=$null;writer_force_stopped=$false;collector_force_stopped=$false;publish_allowed=$false}
try {
  $calendarText = & $Node (Join-Path $TerminalDir 'scripts\check-market-calendar-action.js') "--date=$tradeDate" '--label=DaytradeFutoptCollector0835'
  if ($LASTEXITCODE -ne 0) { throw 'MARKET_CALENDAR_CHECK_FAILED' }
  $calendar = ($calendarText -join "`n") | ConvertFrom-Json
  if ($calendar.marketDate -ne $tradeDate -or $calendar.marketOpen -isnot [bool]) { throw 'MARKET_CALENDAR_UNVERIFIED' }
  if (-not $calendar.marketOpen) { $result.action='skip_verified_closed_day'; $result.ok=$true }
  else {
    $status=$null
    try { $status=Get-Content (Join-Path $RuntimeDir 'state\fugle-futopt-websocket-status.json') -Raw|ConvertFrom-Json -DateKind String } catch {}
    $producer=$null
    if ($null -ne $status -and [int]$status.pid -gt 0) { $producer=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$status.pid) }
    $allCollectors=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -match 'fugle-futopt-websocket-collector\.js'})
    if ($allCollectors.Count -gt 1 -or ($allCollectors.Count -eq 1 -and ($null -eq $producer -or $allCollectors[0].ProcessId -ne $producer.ProcessId))) { throw 'COLLECTOR_PROCESS_STATUS_MISMATCH' }
    $decision=Get-FutoptRecoveryDecision -Status $status -Process $producer -TradeDate $tradeDate
    $result.action=$decision
    switch ($decision) {
      'HEALTHY' { $result.ok=$true }
      'WAITING_FORMAL_EVIDENCE' { $result.first_blocker='formal_evidence_pending_transport_preserved' }
      'BLOCKED_PROCESS_IDENTITY' { $result.first_blocker='collector_process_identity_unverified' }
      'REQUEST_WRITER_RECONCILE' {
        $task=Get-ScheduledTask -TaskName 'Fuman Daytrade Source Writer 0600-1330'
        if ([string]$task.State -eq 'Running') { $result.action='writer_already_running'; $result.first_blocker='await_existing_writer' }
        elseif ([string]$task.State -ne 'Ready' -or $task.Actions.Count -ne 1 -or $task.Actions[0].Arguments -notlike '*C:\fuman-runtime\ops\Run-DaytradeSourceWriter.ps1*' -or $task.Actions[0].Arguments -notlike '*-FumanRoot "C:\fuman-release-owner\prod81"*') { throw 'WRITER_TASK_DRIFT' }
        else {
          # Existing wrapper owns locks, database backoff and collector reconciliation.
          # Never terminate Writer, force-stop a PID, or open another WS here.
          Start-ScheduledTask -InputObject $task
          $result.action='writer_reconcile_requested';$result.first_blocker='await_writer_readback'
        }
      }
    }
  }
} catch { $result.first_blocker=$_.Exception.Message }
New-Item -ItemType Directory -Force -Path (Split-Path $receiptPath)|Out-Null
$tmp=$receiptPath+'.tmp'
$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $tmp -Encoding utf8
[IO.File]::Move($tmp,$receiptPath,$true)
if (-not $result.ok) { exit 1 }

