param(
  [string]$TaskName = "Fuman Public Slot Shared Source 0800",
  [string]$ProjectUrl = "https://cpmpfhbzutkiecccekfr.supabase.co",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$SourceName = "fugle_shared_source",
  [int]$MaxSourceAgeSeconds = 120,
  [string]$ActiveStart = "08:00",
  [string]$ActiveEnd = "14:10"
)

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $ScriptDir "runtime"
$LogFile = Join-Path $LogDir ("public-slot-watchdog-{0}.log" -f (Get-Date -Format "yyyyMMdd"))
$AnonKeyFile = Join-Path $RuntimeDir "secrets\supabase-anon-key.txt"

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
    return [pscustomobject]@{
      Ok = $true
      Reason = "status=$($row.status); source_age=${age}s; quote_age=${quoteAge}s"
      AgeSeconds = $age
      QuoteAgeSeconds = $quoteAge
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

function Start-SharedSourceTask {
  param([string]$Reason)
  Write-WatchdogLog "需要重啟 shared source：$Reason"
  try {
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
$health = Get-SourceStatusAgeSeconds -AnonKey $anonKey

Write-WatchdogLog "檢查結果：process_running=$isRunning；$($health.Reason)"

if (-not $isRunning) {
  Start-SharedSourceTask -Reason "shared source 程序沒有在跑"
  exit 0
}

if (-not $health.Ok) {
  Start-SharedSourceTask -Reason $health.Reason
  exit 0
}

if ($health.Status -ne "ok") {
  Start-SharedSourceTask -Reason "source_status 狀態不是 ok：$($health.Status)"
  exit 0
}

if ($health.AgeSeconds -gt $MaxSourceAgeSeconds) {
  Start-SharedSourceTask -Reason "source_status 超過 $MaxSourceAgeSeconds 秒未更新，目前 $($health.AgeSeconds) 秒"
  exit 0
}

Write-WatchdogLog "正常：shared source 有在跑，Supabase 也還新鮮。"
