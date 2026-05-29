$ErrorActionPreference = "Stop"

function Get-FumanTaipeiNow {
  try {
    $tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
    return [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz)
  } catch {
    return Get-Date
  }
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
}
