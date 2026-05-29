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
