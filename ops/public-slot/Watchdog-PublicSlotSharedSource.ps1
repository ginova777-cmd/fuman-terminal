param(
  [string]$TaskName = "Fuman Public Slot Shared Source 0800",
  [string]$ProjectUrl = "https://cpmpfhbzutkiecccekfr.supabase.co",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$SourceName = "fugle_shared_source",
  [int]$MaxSourceAgeSeconds = 300,
  [double]$MinQuoteCoverage120 = 0.9,
  [int]$MinFreshQuoteCount120 = 1500,
  [int]$MaxQuoteAgeSeconds = 90,
  [int]$MaxIntraday1mStaleSeconds = 180,
  [double]$MinIntraday1mCoverage = 0.95,
  [double]$MinReadyGe35Coverage = 0.95,
  [string]$CoverageHardGateStart = "09:05",
  [int]$WriterCatchupGraceSeconds = 180,
  [int]$RestartCooldownSeconds = 300,
  [string]$ActiveStart = "08:00",
  [string]$ActiveEnd = "14:10"
)

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FumanRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$LogDir = Join-Path $ScriptDir "runtime"
$LogFile = Join-Path $LogDir ("public-slot-watchdog-{0}.log" -f (Get-Date -Format "yyyyMMdd"))
$AnonKeyFile = Join-Path $RuntimeDir "secrets\supabase-anon-key.txt"
$CollectorScript = Join-Path $FumanRoot "scripts\fugle-websocket-collector.js"
$NodeExe = "C:\Program Files\nodejs\node.exe"
$AlertReceiptDir = Join-Path $RuntimeDir "data\scan-receipts"
$AlertReceiptFile = Join-Path $AlertReceiptDir "public-slot-shared-source-watchdog-alert.json"
$RestartStateFile = Join-Path $LogDir "public-slot-watchdog-restart-state.json"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $AlertReceiptDir | Out-Null

function Write-WatchdogLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $LogFile -Value $line -Encoding utf8
}

function Invoke-PublicSlotWatchdogAlert {
  param(
    [string]$Reason,
    [switch]$Restart
  )

  $node = $NodeExe
  if (-not (Test-Path -LiteralPath $node)) { $node = "node" }
  $tail = ""
  try { $tail = (Get-Content -LiteralPath $LogFile -Tail 60 -ErrorAction SilentlyContinue) -join "`n" } catch {}

  $env:FUMAN_RUNTIME_DIR = $RuntimeDir
  $env:FUMAN_ALERT_KIND = "public-slot-shared-source-watchdog"
  $env:FUMAN_ALERT_SOURCE = "Fuman Public Slot Shared Source Watchdog"
  $env:FUMAN_ALERT_SUBJECT = "Fuman shared source 1m writer self-heal watchdog"
  $env:FUMAN_ALERT_RECEIPT_FILE = $AlertReceiptFile
  $env:FUMAN_ALERT_TEXT = @"
Fuman shared source watchdog triggered

source: Fuman Public Slot Shared Source Watchdog
task: $TaskName
restart: $([bool]$Restart)
reason: $Reason
log: $LogFile
receipt: $AlertReceiptFile
checkedAt: $((Get-Date).ToUniversalTime().ToString("o"))

tail:
$tail
"@

  Push-Location $FumanRoot
  try {
    & $node "--use-system-ca" "scripts\send-workflow-alert.js" "--kind=public-slot-shared-source-watchdog" "--receipt=$AlertReceiptFile" *>&1 | ForEach-Object {
      Write-WatchdogLog "[alert] $([string]$_)"
    }
    if ($LASTEXITCODE -ne 0) {
      Write-WatchdogLog "[alert] failed exit=$LASTEXITCODE receipt=$AlertReceiptFile"
    } else {
      Write-WatchdogLog "[alert] sent receipt=$AlertReceiptFile"
    }
  } catch {
    Write-WatchdogLog "[alert] EXCEPTION $($_.Exception.Message)"
  } finally {
    Pop-Location
  }
}

function Convert-HHmmToTimeSpan {
  param([string]$Value)
  try {
    $parts = $Value.Split(":")
    return New-TimeSpan -Hours ([int]$parts[0]) -Minutes ([int]$parts[1])
  } catch {
    return New-TimeSpan -Hours 0
  }
}

function Test-InActiveWindow {
  $now = (Get-Date).TimeOfDay
  $start = Convert-HHmmToTimeSpan $ActiveStart
  $end = Convert-HHmmToTimeSpan $ActiveEnd
  return ($now -ge $start -and $now -le $end)
}

function Test-AfterHHmm {
  param([string]$Value)
  $now = (Get-Date).TimeOfDay
  $gate = Convert-HHmmToTimeSpan $Value
  return ($now -ge $gate)
}

function Read-TextSecret {
  param([string]$Path)
  try {
    if (Test-Path -LiteralPath $Path) {
      $value = (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop).Trim()
      if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
    }
  } catch {}
  return ""
}

function Get-SourceStatusAgeSeconds {
  param([string]$AnonKey)
  try {
    $headers = @{
      apikey = $AnonKey
      Authorization = "Bearer $AnonKey"
    }
    $encodedName = [uri]::EscapeDataString($SourceName)
    $uri = "$($ProjectUrl.TrimEnd('/'))/rest/v1/source_status?source_name=eq.$encodedName&select=source_name,status,updated_at,payload,message&limit=1"
    $rows = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 12 -ErrorAction Stop
    if (-not $rows -or $rows.Count -lt 1) {
      return [pscustomobject]@{
        Ok = $false
        Reason = "source_status 找不到 $SourceName"
        AgeSeconds = 999999
        Status = "missing"
      }
    }
    $row = @($rows)[0]
    $age = [int]([math]::Max(0, ((Get-Date).ToUniversalTime() - ([datetimeoffset]::Parse([string]$row.updated_at).ToUniversalTime()).UtcDateTime).TotalSeconds))
    $quoteAge = $null
    try {
      if ($row.payload -and $null -ne $row.payload.quote_age_seconds) {
        $quoteAge = [int]$row.payload.quote_age_seconds
      }
    } catch {}
    $intraday1mStale = $null
    try {
      if ($row.payload -and $null -ne $row.payload.intraday_1m_stale_seconds) {
        $intraday1mStale = [int]$row.payload.intraday_1m_stale_seconds
      }
    } catch {}
    $session = ""
    try {
      if ($row.payload -and $null -ne $row.payload.session) {
        $session = [string]$row.payload.session
      }
    } catch {}
    $activeSymbols = 0
    $today1mSymbols = 0
    $readyGe35Symbols = 0
    try {
      if ($row.payload -and $null -ne $row.payload.active_symbols) {
        $activeSymbols = [int]$row.payload.active_symbols
      } elseif ($row.payload -and $null -ne $row.payload.seeded_symbols) {
        $activeSymbols = [int]$row.payload.seeded_symbols
      }
    } catch {}
    try {
      if ($row.payload -and $null -ne $row.payload.today_1m_symbols) {
        $today1mSymbols = [int]$row.payload.today_1m_symbols
      } elseif ($row.payload -and $null -ne $row.payload.intraday_1m_symbols_today) {
        $today1mSymbols = [int]$row.payload.intraday_1m_symbols_today
      }
    } catch {}
    try {
      if ($row.payload -and $null -ne $row.payload.ready_ge_35_symbols) {
        $readyGe35Symbols = [int]$row.payload.ready_ge_35_symbols
      } elseif ($row.payload -and $null -ne $row.payload.ready_ge_35) {
        $readyGe35Symbols = [int]$row.payload.ready_ge_35
      } elseif ($row.payload -and $null -ne $row.payload.ready_ma35_continuous_symbols) {
        $readyGe35Symbols = [int]$row.payload.ready_ma35_continuous_symbols
      }
    } catch {}
    $today1mCoverage = if ($activeSymbols -gt 0) { [math]::Round($today1mSymbols / [double]$activeSymbols, 4) } else { 0 }
    $readyGe35Coverage = if ($activeSymbols -gt 0) { [math]::Round($readyGe35Symbols / [double]$activeSymbols, 4) } else { 0 }
    $usableForIntraday = $false
    try {
      if ($row.payload -and $null -ne $row.payload.degraded_but_usable_for_intraday) {
        $usableForIntraday = [bool]$row.payload.degraded_but_usable_for_intraday
      }
    } catch {}
    return [pscustomobject]@{
      Ok = $true
      Reason = "status=$($row.status); source_age=${age}s; quote_age=${quoteAge}s"
      AgeSeconds = $age
      QuoteAgeSeconds = $quoteAge
      Intraday1mStaleSeconds = $intraday1mStale
      ActiveSymbols = $activeSymbols
      Today1mSymbols = $today1mSymbols
      ReadyGe35Symbols = $readyGe35Symbols
      Today1mCoverage = $today1mCoverage
      ReadyGe35Coverage = $readyGe35Coverage
      Session = $session
      DegradedUsableForIntraday = $usableForIntraday
      Status = [string]$row.status
    }
  } catch {
    return [pscustomobject]@{
      Ok = $false
      Reason = "讀取 Supabase source_status 失敗：$($_.Exception.Message)"
      AgeSeconds = 999999
      Status = "error"
    }
  }
}

function Test-SharedSourceProcessRunning {
  try {
    return (@(Get-SharedSourceProcesses).Count -gt 0)
  } catch {
    return $false
  }
}

function Get-SharedSourceProcesses {
  try {
    return @(Get-CimInstance Win32_Process -Filter "Name = 'pwsh.exe' OR Name = 'powershell.exe'" |
      Where-Object { $_.CommandLine -match "Run-PublicSlotSharedSource\.ps1" })
  } catch {
    return @()
  }
}

function Stop-SharedSourceProcesses {
  param([switch]$KeepNewest)
  $processes = @(Get-SharedSourceProcesses)
  if ($KeepNewest -and $processes.Count -le 1) { return }
  $targets = $processes
  if ($KeepNewest) {
    $targets = @($processes | Sort-Object CreationDate -Descending | Select-Object -Skip 1)
  }
  foreach ($proc in $targets) {
    try {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
      Write-WatchdogLog "已停止 shared source pid=$($proc.ProcessId)"
    } catch {
      Write-WatchdogLog "停止 shared source pid=$($proc.ProcessId) 失敗：$($_.Exception.Message)"
    }
  }
}

function Get-LastWatchdogRestartUtc {
  try {
    if (-not (Test-Path -LiteralPath $RestartStateFile)) { return $null }
    $state = Get-Content -LiteralPath $RestartStateFile -Raw -ErrorAction Stop | ConvertFrom-Json
    $raw = [string]$state.last_restart_at
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    return ([datetime]::Parse($raw)).ToUniversalTime()
  } catch {
    return $null
  }
}

function Test-WatchdogRestartCooldown {
  param([string]$Reason)
  if ($RestartCooldownSeconds -le 0) { return $true }
  $lastRestart = Get-LastWatchdogRestartUtc
  if ($null -eq $lastRestart) { return $true }
  $elapsed = [int](((Get-Date).ToUniversalTime() - $lastRestart).TotalSeconds)
  if ($elapsed -lt $RestartCooldownSeconds) {
    Write-WatchdogLog "restart cooldown active elapsed=${elapsed}s cooldown=${RestartCooldownSeconds}s；略過重啟。reason=$Reason"
    return $false
  }
  return $true
}

function Write-WatchdogRestartState {
  param([string]$Reason)
  try {
    [ordered]@{
      last_restart_at = (Get-Date).ToUniversalTime().ToString("o")
      reason = $Reason
      cooldown_seconds = $RestartCooldownSeconds
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $RestartStateFile -Encoding utf8
  } catch {
    Write-WatchdogLog "WARN unable to write restart cooldown state: $($_.Exception.Message)"
  }
}

function Get-NewestSharedSourceAgeSeconds {
  param([object[]]$Processes)
  try {
    if ($Processes.Count -le 0) { return 999999 }
    $newest = @($Processes | Sort-Object CreationDate -Descending | Select-Object -First 1)[0]
    $created = $newest.CreationDate
    if (-not ($created -is [datetime])) {
      try {
        $created = [System.Management.ManagementDateTimeConverter]::ToDateTime([string]$newest.CreationDate)
      } catch {
        $created = [datetime]::Parse([string]$newest.CreationDate)
      }
    }
    return [int]([math]::Max(0, ((Get-Date) - $created).TotalSeconds))
  } catch {
    return 999999
  }
}

function Test-WriterCatchupGrace {
  param(
    [int]$WriterAgeSeconds,
    [object]$CollectorCache,
    [object]$QuoteHealth
  )
  $collectorHasEnoughQuotes = $false
  try { $collectorHasEnoughQuotes = ([int]$CollectorCache.Quotes -ge $MinFreshQuoteCount120) } catch {}
  return ($WriterAgeSeconds -lt $WriterCatchupGraceSeconds -and ($CollectorCache.Ok -or $collectorHasEnoughQuotes -or $QuoteHealth.Ok))
}

function Get-QuoteLiveHealth {
  param([string]$AnonKey)
  try {
    $headers = @{
      apikey = $AnonKey
      Authorization = "Bearer $AnonKey"
    }
    $uri = "$($ProjectUrl.TrimEnd('/'))/rest/v1/v_fugle_quotes_live_health?select=*&limit=1"
    $rows = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 12 -ErrorAction Stop
    if (-not $rows -or $rows.Count -lt 1) {
      return [pscustomobject]@{
        Ok = $false
        Reason = "v_fugle_quotes_live_health 無資料"
      }
    }
    $row = @($rows)[0]
    $coverage120 = [double]$row.coverage_120s
    $fresh120 = [int]$row.fresh_quote_count_120s
    $quoteAge = [int]$row.quote_age_seconds
    $ok = ($coverage120 -ge $MinQuoteCoverage120 -and $fresh120 -ge $MinFreshQuoteCount120 -and $quoteAge -le $MaxQuoteAgeSeconds)
    return [pscustomobject]@{
      Ok = $ok
      Reason = "quote_health coverage_120s=$coverage120 fresh_120s=$fresh120 quote_age=${quoteAge}s latest=$($row.latest_quote_time)"
      Coverage120 = $coverage120
      Fresh120 = $fresh120
      QuoteAgeSeconds = $quoteAge
    }
  } catch {
    return [pscustomobject]@{
      Ok = $false
      Reason = "讀取 quote health 失敗：$($_.Exception.Message)"
    }
  }
}

function Get-CollectorProcesses {
  try {
    return @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
      Where-Object { $_.CommandLine -match "fugle-websocket-collector\.js" })
  } catch {
    return @()
  }
}

function Stop-ExtraCollectorProcesses {
  param(
    [object[]]$CollectorProcesses,
    [object[]]$SharedSourceProcesses
  )
  if ($CollectorProcesses.Count -le 1) { return }
  $sharedPids = @($SharedSourceProcesses | ForEach-Object { [int]$_.ProcessId })
  $keeper = $null
  foreach ($proc in $CollectorProcesses) {
    if ($sharedPids -contains [int]$proc.ParentProcessId) {
      $keeper = $proc
      break
    }
  }
  if (-not $keeper) {
    $keeper = @($CollectorProcesses | Sort-Object CreationDate -Descending | Select-Object -First 1)[0]
  }
  foreach ($proc in $CollectorProcesses) {
    if ([int]$proc.ProcessId -eq [int]$keeper.ProcessId) { continue }
    try {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
      Write-WatchdogLog "已停止額外 collector pid=$($proc.ProcessId)"
    } catch {
      Write-WatchdogLog "停止額外 collector pid=$($proc.ProcessId) 失敗：$($_.Exception.Message)"
    }
  }
  Write-WatchdogLog "保留 collector pid=$($keeper.ProcessId)"
}

function Get-CollectorCacheHealth {
  $statusFile = Join-Path $RuntimeDir "state\fugle-websocket-status.json"
  try {
    if (-not (Test-Path -LiteralPath $statusFile)) {
      return [pscustomobject]@{
        Ok = $false
        Reason = "collector status file missing"
      }
    }
    $rawStatus = Get-Content -LiteralPath $statusFile -Raw -ErrorAction Stop
    $status = $rawStatus | ConvertFrom-Json
    $updatedAtText = [string]$status.updatedAt
    if ($rawStatus -match '"updatedAt"\s*:\s*"([^"]+)"') { $updatedAtText = $Matches[1] }
    $updatedAt = [datetimeoffset]::Parse($updatedAtText).ToUniversalTime()
    $ageSeconds = [int]([math]::Max(0, ([datetimeoffset]::UtcNow - $updatedAt).TotalSeconds))
    $quotes = [int]$status.quotes
    $pending = [int]$status.pending
    $ok = ([bool]$status.ok -and (($quotes -ge $MinFreshQuoteCount120) -or (($quotes + $pending) -ge $MinFreshQuoteCount120)) -and $ageSeconds -le 90)
    return [pscustomobject]@{
      Ok = $ok
      Reason = "collector_cache ok=$($status.ok) quotes=$quotes pending=$pending age=${ageSeconds}s pid=$($status.pid)"
      Quotes = $quotes
      AgeSeconds = $ageSeconds
    }
  } catch {
    return [pscustomobject]@{
      Ok = $false
      Reason = "collector status read failed: $($_.Exception.Message)"
    }
  }
}

function Restart-FugleQuoteCollector {
  param([string]$Reason)
  Write-WatchdogLog "需要重啟 Fugle quote collector：$Reason"
  try {
    $collectors = @(Get-CollectorProcesses)
    foreach ($proc in $collectors) {
      try {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
        Write-WatchdogLog "已停止 collector pid=$($proc.ProcessId)"
      } catch {
        Write-WatchdogLog "停止 collector pid=$($proc.ProcessId) 失敗：$($_.Exception.Message)"
      }
    }
    Start-Sleep -Seconds 2
    if (-not (Test-Path -LiteralPath $NodeExe)) {
      Write-WatchdogLog "找不到 node.exe：$NodeExe"
      return
    }
    if (-not (Test-Path -LiteralPath $CollectorScript)) {
      Write-WatchdogLog "找不到 collector script：$CollectorScript"
      return
    }
    Start-Process -FilePath $NodeExe -ArgumentList "`"$CollectorScript`"" -WindowStyle Hidden | Out-Null
    Write-WatchdogLog "已啟動 collector：$CollectorScript"
  } catch {
    Write-WatchdogLog "重啟 collector 失敗：$($_.Exception.Message)"
  }
}

function Start-SharedSourceTask {
  param([string]$Reason, [switch]$Restart, [switch]$Alert)
  Write-WatchdogLog "需要重啟 shared source：$Reason"
  if ($Restart -and -not (Test-WatchdogRestartCooldown -Reason $Reason)) {
    return
  }
  if ($Alert) {
    Invoke-PublicSlotWatchdogAlert -Reason $Reason -Restart:$Restart
  }
  try {
    if ($Restart) {
      schtasks /End /TN $TaskName | Out-String | ForEach-Object {
        if (-not [string]::IsNullOrWhiteSpace($_)) { Write-WatchdogLog $_.Trim() }
      }
      Start-Sleep -Seconds 2
      Stop-SharedSourceProcesses
      Start-Sleep -Seconds 2
    }
    schtasks /Run /TN $TaskName | Out-String | ForEach-Object {
      if (-not [string]::IsNullOrWhiteSpace($_)) { Write-WatchdogLog $_.Trim() }
    }
    if ($Restart) { Write-WatchdogRestartState -Reason $Reason }
  } catch {
    Write-WatchdogLog "啟動排程失敗：$($_.Exception.Message)"
  }
}

if (-not (Test-InActiveWindow)) {
  Write-WatchdogLog "目前不在監控時段 $ActiveStart-$ActiveEnd，略過。"
  exit 0
}

$anonKey = Read-TextSecret -Path $AnonKeyFile
if ([string]::IsNullOrWhiteSpace($anonKey)) {
  Write-WatchdogLog "找不到 Supabase anon key：$AnonKeyFile"
  exit 1
}

$isRunning = Test-SharedSourceProcessRunning
$sharedSourceProcesses = @(Get-SharedSourceProcesses)
$collectorProcesses = @(Get-CollectorProcesses)
$collectorCache = Get-CollectorCacheHealth
$health = Get-SourceStatusAgeSeconds -AnonKey $anonKey
$quoteHealth = Get-QuoteLiveHealth -AnonKey $anonKey
$writerAgeSeconds = Get-NewestSharedSourceAgeSeconds -Processes $sharedSourceProcesses

Write-WatchdogLog "檢查結果：process_running=$isRunning；shared_source_count=$($sharedSourceProcesses.Count)；writer_age=${writerAgeSeconds}s；collector_count=$($collectorProcesses.Count)；$($collectorCache.Reason)；$($health.Reason)；$($quoteHealth.Reason)"

if ($sharedSourceProcesses.Count -gt 1) {
  Write-WatchdogLog "偵測到多個 shared source writer，保留最新一個並停止其餘程序，避免 source_status 互相覆蓋。"
  Stop-SharedSourceProcesses -KeepNewest
  exit 0
}

if (-not $isRunning) {
  Start-SharedSourceTask -Reason "shared source 程序沒有在跑"
  exit 0
}

if ($isRunning -and $collectorProcesses.Count -gt 1) {
  Write-WatchdogLog "偵測到多個 collector，但 shared source 正在跑；保留 runner 管理的 collector，避免 watchdog 額外製造 API 壓力。"
  Stop-ExtraCollectorProcesses -CollectorProcesses $collectorProcesses -SharedSourceProcesses $sharedSourceProcesses
  exit 0
}

if ($collectorProcesses.Count -ne 1) {
  Restart-FugleQuoteCollector -Reason "collector_count=$($collectorProcesses.Count)，應為 1"
  exit 0
}

if ($isRunning -and -not $quoteHealth.Ok) {
  $quoteCoverageHardFailed = ($null -ne $quoteHealth.Coverage120 -and $quoteHealth.Coverage120 -lt $MinQuoteCoverage120 -and $null -ne $quoteHealth.Fresh120 -and $quoteHealth.Fresh120 -lt $MinFreshQuoteCount120)
  $quoteAgeHardFailed = ($null -ne $quoteHealth.QuoteAgeSeconds -and $quoteHealth.QuoteAgeSeconds -gt ([math]::Max(120, $MaxQuoteAgeSeconds * 2)))
  $sourceAgeHardFailed = ($null -ne $health.AgeSeconds -and $health.AgeSeconds -gt $MaxSourceAgeSeconds)
  $sourceQuoteAgeHardFailed = ($null -ne $health.QuoteAgeSeconds -and $health.QuoteAgeSeconds -gt ([math]::Max(120, $MaxQuoteAgeSeconds * 2)))
  if ((Test-AfterHHmm $CoverageHardGateStart) -and ($quoteCoverageHardFailed -or $quoteAgeHardFailed) -and ($sourceAgeHardFailed -or $sourceQuoteAgeHardFailed -or $quoteAgeHardFailed)) {
    if (Test-WriterCatchupGrace -WriterAgeSeconds $writerAgeSeconds -CollectorCache $collectorCache -QuoteHealth $quoteHealth) {
      Write-WatchdogLog "quote health hard-stall candidate，但 writer 剛啟動 ${writerAgeSeconds}s 且 collector 有活資料；給 $WriterCatchupGraceSeconds 秒 catch-up grace，不重啟。"
      exit 0
    }
    Start-SharedSourceTask -Reason "quote health hard-stall after $CoverageHardGateStart；coverage_120s=$($quoteHealth.Coverage120) fresh_120s=$($quoteHealth.Fresh120) quote_age=$($quoteHealth.QuoteAgeSeconds)s source_age=$($health.AgeSeconds)s source_quote_age=$($health.QuoteAgeSeconds)s；process alive 不可遮蔽 Fugle live 寫入失速" -Restart -Alert
    exit 0
  }
  Write-WatchdogLog "quote health 尚未達標，但 shared source 與 collector 都在跑；尚未達 hard-stall 門檻，讓漸進補滿機制追平。"
  exit 0
}

if (-not $quoteHealth.Ok -and -not $collectorCache.Ok) {
  Restart-FugleQuoteCollector -Reason $quoteHealth.Reason
  exit 0
}

if (-not $quoteHealth.Ok -and $collectorCache.Ok) {
  Write-WatchdogLog "quote health 尚未達標，但 collector cache 健康，暫不重啟 collector，讓 shared source 繼續寫入追平。"
}

if ($health.Session -eq "regular" -and $null -ne $health.Intraday1mStaleSeconds -and $health.Intraday1mStaleSeconds -gt $MaxIntraday1mStaleSeconds) {
  if (Test-WriterCatchupGrace -WriterAgeSeconds $writerAgeSeconds -CollectorCache $collectorCache -QuoteHealth $quoteHealth) {
    Write-WatchdogLog "intraday_1m stale，但 writer 剛啟動 ${writerAgeSeconds}s 且 quote/collector 有活資料；給 $WriterCatchupGraceSeconds 秒 catch-up grace，不重啟。"
    exit 0
  }
  Start-SharedSourceTask -Reason "intraday_1m_stale_seconds 超過 $MaxIntraday1mStaleSeconds 秒，目前 $($health.Intraday1mStaleSeconds) 秒；quote/collector 健康不可遮蔽 1m writer 失速" -Restart -Alert
  exit 0
}

if ($health.Session -eq "regular" -and (Test-AfterHHmm $CoverageHardGateStart) -and $health.ActiveSymbols -ge 1000) {
  if ($health.Today1mCoverage -lt $MinIntraday1mCoverage) {
    if (Test-WriterCatchupGrace -WriterAgeSeconds $writerAgeSeconds -CollectorCache $collectorCache -QuoteHealth $quoteHealth) {
      Write-WatchdogLog "today_1m coverage 尚未達標，但 writer 剛啟動 ${writerAgeSeconds}s 且 quote/collector 有活資料；給 $WriterCatchupGraceSeconds 秒 catch-up grace，不重啟。"
      exit 0
    }
    Start-SharedSourceTask -Reason "today_1m_symbols coverage 低於 $MinIntraday1mCoverage，目前 $($health.Today1mSymbols)/$($health.ActiveSymbols)=$($health.Today1mCoverage)；觸發 shared source 自修復重啟" -Restart -Alert
    exit 0
  }
  if ($health.ReadyGe35Coverage -lt $MinReadyGe35Coverage) {
    if (Test-WriterCatchupGrace -WriterAgeSeconds $writerAgeSeconds -CollectorCache $collectorCache -QuoteHealth $quoteHealth) {
      Write-WatchdogLog "ready_ge35 coverage 尚未達標，但 writer 剛啟動 ${writerAgeSeconds}s 且 quote/collector 有活資料；給 $WriterCatchupGraceSeconds 秒 catch-up grace，不重啟。"
      exit 0
    }
    Start-SharedSourceTask -Reason "ready_ge35 coverage 低於 $MinReadyGe35Coverage，目前 $($health.ReadyGe35Symbols)/$($health.ActiveSymbols)=$($health.ReadyGe35Coverage)；觸發 shared source 自修復重啟" -Restart -Alert
    exit 0
  }
}

if (($collectorCache.Ok -or $quoteHealth.Ok) -and ((-not $health.Ok) -or $health.Status -ne "ok" -or $health.AgeSeconds -gt $MaxSourceAgeSeconds)) {
  Write-WatchdogLog "shared source 程序仍在跑，且 live collector/quote 有活資料；不因 source_status 落後而重啟，避免多 writer。$($health.Reason)"
  exit 0
}

if (-not $health.Ok) {
  Start-SharedSourceTask -Reason $health.Reason -Restart
  exit 0
}

if ($health.Status -eq "degraded" -and $health.DegradedUsableForIntraday -and $null -ne $health.QuoteAgeSeconds -and $health.QuoteAgeSeconds -le $MaxSourceAgeSeconds) {
  Write-WatchdogLog "正常：shared source 為 degraded 但 intraday 可用，quote_age=$($health.QuoteAgeSeconds)s。"
  exit 0
}

if ($health.Status -ne "ok") {
  Start-SharedSourceTask -Reason "source_status 狀態不是 ok：$($health.Status)" -Restart
  exit 0
}

if ($health.AgeSeconds -gt $MaxSourceAgeSeconds) {
  Start-SharedSourceTask -Reason "source_status 超過 $MaxSourceAgeSeconds 秒未更新，目前 $($health.AgeSeconds) 秒" -Restart
  exit 0
}

Write-WatchdogLog "正常：shared source 有在跑，Supabase 也還新鮮。"


