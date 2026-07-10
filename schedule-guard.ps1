$ErrorActionPreference = "Stop"

function Get-FumanTaipeiNow {
  try {
    $tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
    return [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz)
  } catch {
    return Get-Date
  }
}

function Get-FumanMarketHolidays {
  $runtimeDir = $env:FUMAN_RUNTIME_DIR
  if (-not $runtimeDir) { $runtimeDir = "C:\fuman-runtime" }
  $files = @(
    $env:FUMAN_MARKET_HOLIDAY_FILE,
    (Join-Path $runtimeDir "market-holidays.json"),
    (Join-Path $PSScriptRoot "twse-market-holidays.json")
  ) | Where-Object { $_ }

  foreach ($file in $files) {
    if (!(Test-Path -LiteralPath $file)) { continue }
    try {
      $raw = Get-Content -LiteralPath $file -Raw
      if ($file -match "\.json$") {
        $payload = $raw | ConvertFrom-Json
        return @($payload.holidays | ForEach-Object { [string]$_ })
      }
      return @($raw -split "\r?\n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match "^\d{4}-\d{2}-\d{2}$" })
    } catch {
      continue
    }
  }
  return @()
}

function Invoke-FumanWeekdayGuard {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [string]$LogPath
  )

  if ($env:FUMAN_FORCE_RUN -eq "1") {
    if ($LogPath) { "Weekday guard bypassed by FUMAN_FORCE_RUN=1 for $Label" >> $LogPath }
    return
  }

  Invoke-FumanMarketCalendarGuard -Label $Label -LogPath $LogPath

  $now = Get-FumanTaipeiNow
  if ($now.DayOfWeek -eq [DayOfWeek]::Saturday -or $now.DayOfWeek -eq [DayOfWeek]::Sunday) {
    $message = "$Label skipped on weekend: $($now.ToString('yyyy/MM/dd HH:mm:ss')) Taipei"
    if ($LogPath) {
      $message >> $LogPath
    } else {
      Write-Host $message
    }
    exit 0
  }

  $dateKey = $now.ToString("yyyy-MM-dd")
  if (@(Get-FumanMarketHolidays) -contains $dateKey) {
    $message = "$Label skipped on TWSE market holiday: $dateKey"
    if ($LogPath) {
      $message >> $LogPath
    } else {
      Write-Host $message
    }
    exit 0
  }
}


# FUMAN_MARKET_CLOSED_PROTECTION_V1
function Invoke-FumanMarketCalendarGuard {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [string]$LogPath
  )

  if ($env:FUMAN_FORCE_RUN -eq "1") {
    if ($LogPath) { "Market calendar guard bypassed by FUMAN_FORCE_RUN=1 for $Label" >> $LogPath }
    return
  }

  $nodeCandidates = @(
    "C:\Program Files\nodejs\node.exe",
    "node"
  )
  $nodeExe = $nodeCandidates | Where-Object { $_ -eq "node" -or (Test-Path -LiteralPath $_) } | Select-Object -First 1
  $scriptPath = Join-Path $PSScriptRoot "scripts\check-market-calendar-action.js"
  if (!(Test-Path -LiteralPath $scriptPath)) {
    $message = "market calendar guard missing script: $scriptPath; fail closed and preserve previous good"
    if ($LogPath) { $message >> $LogPath } else { Write-Host $message }
    exit 0
  }

  $output = & $nodeExe $scriptPath "--label=$Label" "--receipt=1" 2>&1
  $exitCode = $LASTEXITCODE
  if ($LogPath) { $output | ForEach-Object { "market-calendar-guard: $_" >> $LogPath } }

  if ($exitCode -eq 10) {
    $message = "$Label skipped on market_closed by market calendar contract; preserve previous good; do not write latest or empty result"
    if ($LogPath) { $message >> $LogPath } else { Write-Host $message }
    exit 0
  }
  if ($exitCode -ne 0) {
    $message = "$Label market calendar guard failed exit=$exitCode; fail closed and preserve previous good"
    if ($LogPath) { $message >> $LogPath } else { Write-Host $message }
    exit 0
  }
}
