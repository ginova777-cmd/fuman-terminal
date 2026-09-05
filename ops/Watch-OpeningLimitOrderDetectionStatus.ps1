param(
  [string]$TradeDate = "",
  [int]$RefreshSeconds = 30,
  [int]$Top = 0,
  [string]$RuntimeDir = "C:\fuman-runtime",
  [switch]$SummaryOnly,
  [switch]$IncludeRejected,
  [switch]$NoClear
)

$ErrorActionPreference = "Stop"

$Viewer = Join-Path $PSScriptRoot "Show-OpeningLimitOrderDetectionStatus.ps1"
if (-not (Test-Path -LiteralPath $Viewer)) {
  throw "viewer_missing:$Viewer"
}

if ($RefreshSeconds -lt 5) {
  throw "RefreshSeconds must be >= 5"
}

function Invoke-OpeningLimitOrderStatusView {
  $params = @{
    RuntimeDir = $RuntimeDir
  }

  if (-not [string]::IsNullOrWhiteSpace($TradeDate)) {
    $params.TradeDate = $TradeDate
  }

  if ($Top -gt 0) {
    $params.Top = $Top
  } else {
    $params.All = $true
  }

  if (-not $SummaryOnly) {
    $params.Detail = $true
  }

  if ($IncludeRejected) {
    $params.IncludeRejected = $true
  }

  & $Viewer @params
}

Write-Host "Opening Limit Order watcher started. Press Ctrl+C to stop." -ForegroundColor Cyan
Write-Host "readonly=true  creates_order=false  formal_candidate=false  publish=false" -ForegroundColor DarkCyan

while ($true) {
  if (-not $NoClear) {
    Clear-Host
  }

  $now = (Get-Date).ToUniversalTime().AddHours(8).ToString("yyyy-MM-dd HH:mm:ss")
  Write-Host "開盤入自動監看 / Opening Limit Order Watcher" -ForegroundColor Cyan
  Write-Host "checked_at_taipei=$now  refresh_seconds=$RefreshSeconds  readonly=true" -ForegroundColor DarkCyan
  Write-Host ""

  try {
    Invoke-OpeningLimitOrderStatusView
  } catch {
    Write-Host ""
    Write-Host "watcher_read_failed:$($_.Exception.Message)" -ForegroundColor Red
  }

  Write-Host ""
  Write-Host "下一次刷新：$RefreshSeconds 秒後。按 Ctrl+C 停止。" -ForegroundColor DarkGray
  Start-Sleep -Seconds $RefreshSeconds
}
