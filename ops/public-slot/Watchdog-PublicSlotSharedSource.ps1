param(
  [string]$TaskName = "Fuman Public Slot Shared Source 0800",
  [string]$ProjectUrl = "https://cpmpfhbzutkiecccekfr.supabase.co",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$SourceName = "fugle_shared_source",
  [int]$MaxSourceAgeSeconds = 300,
  [double]$MinQuoteCoverage120 = 0.85,
  [int]$MinFreshQuoteCount120 = 1200,
  [int]$MaxQuoteAgeSeconds = 60,
  [int]$MaxIntraday1mStaleSeconds = 180,
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

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-WatchdogLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $LogFile -Value $line -Encoding utf8
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
    $matches = Get-CimInstance Win32_Process -Filter "Name = 'pwsh.exe' OR Name = 'powershell.exe'" |
      Where-Object { $_.CommandLine -match "Run-PublicSlotSharedSource\.ps1" }
    return (@($matches).Count -gt 0)
  } catch {
    return $false
  }
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
  param([string]$Reason, [switch]$Restart)
  Write-WatchdogLog "需要重啟 shared source：$Reason"
  try {
    if ($Restart) {
      schtasks /End /TN $TaskName | Out-String | ForEach-Object {
        if (-not [string]::IsNullOrWhiteSpace($_)) { Write-WatchdogLog $_.Trim() }
      }
      Start-Sleep -Seconds 2
    }
    schtasks /Run /TN $TaskName | Out-String | ForEach-Object {
      if (-not [string]::IsNullOrWhiteSpace($_)) { Write-WatchdogLog $_.Trim() }
    }
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
$collectorProcesses = @(Get-CollectorProcesses)
$collectorCache = Get-CollectorCacheHealth
$health = Get-SourceStatusAgeSeconds -AnonKey $anonKey
$quoteHealth = Get-QuoteLiveHealth -AnonKey $anonKey

Write-WatchdogLog "檢查結果：process_running=$isRunning；collector_count=$($collectorProcesses.Count)；$($collectorCache.Reason)；$($health.Reason)；$($quoteHealth.Reason)"

if ($collectorProcesses.Count -ne 1) {
  Restart-FugleQuoteCollector -Reason "collector_count=$($collectorProcesses.Count)，應為 1"
  exit 0
}

if (-not $quoteHealth.Ok -and -not $collectorCache.Ok) {
  Restart-FugleQuoteCollector -Reason $quoteHealth.Reason
  exit 0
}

if (-not $quoteHealth.Ok -and $collectorCache.Ok) {
  Write-WatchdogLog "quote health 尚未達標，但 collector cache 健康，暫不重啟 collector，讓 shared source 繼續寫入追平。"
}

if (-not $isRunning) {
  Start-SharedSourceTask -Reason "shared source 程序沒有在跑"
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

if ($health.Session -eq "regular" -and $null -ne $health.Intraday1mStaleSeconds -and $health.Intraday1mStaleSeconds -gt $MaxIntraday1mStaleSeconds) {
  Start-SharedSourceTask -Reason "intraday_1m_stale_seconds 超過 $MaxIntraday1mStaleSeconds 秒，目前 $($health.Intraday1mStaleSeconds) 秒" -Restart
  exit 0
}

Write-WatchdogLog "正常：shared source 有在跑，Supabase 也還新鮮。"


