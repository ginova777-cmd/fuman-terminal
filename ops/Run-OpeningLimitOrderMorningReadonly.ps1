param(
  [string]$TradeDate = "",
  [int]$Limit = 1600,
  [string]$TerminalDir = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime"
)

$ErrorActionPreference = "Stop"

function Get-TaipeiDate {
  $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
  return [System.TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), $tz).ToString("yyyy-MM-dd")
}

if (!$TradeDate) { $TradeDate = Get-TaipeiDate }
if ($Limit -lt 1600) { $Limit = 1600 }

$progressive = Join-Path $TerminalDir "ops\Run-OpeningLimitOrder0840ProgressiveReadonly.ps1"
if (!(Test-Path -LiteralPath $progressive)) { throw "opening_limit_order_0840_progressive_script_missing:$progressive" }

Write-Host ("[morning] 開盤入 read-only 08:40 progressive 總入口 trade_date={0}" -f $TradeDate)
Write-Host "[morning] 08:40 靜態條件與日報族群先排序；08:45-08:50 接股期/試撮；08:55 產出加權排名。"

& "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -File $progressive -TradeDate $TradeDate -Limit $Limit -WaitUntil0840 -TerminalDir $TerminalDir -RuntimeDir $RuntimeDir
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  Write-Host ("[morning] 08:40 progressive 開盤入未通過；exit_code={0}" -f $exitCode)
  exit $exitCode
}
Write-Host "[morning] 08:40 progressive 開盤入完成；僅觀察，不掛單、不 publish。"
exit 0
