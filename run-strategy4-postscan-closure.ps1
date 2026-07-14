param(
  [string]$ProjectRoot = "C:\fuman-terminal",
  [string]$RuntimeRoot = "C:\fuman-runtime",
  [string]$ProductionUrl = "https://fuman-terminal.vercel.app",
  [int]$WaitSeconds = 0,
  [int]$PollSeconds = 0
)

$ErrorActionPreference = "Stop"

function Write-JsonFile($Path, $Payload) {
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $Payload | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Get-TaipeiStamp() {
  try {
    $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
    return [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz)
  } catch {
    return Get-Date
  }
}

$startedAt = (Get-Date).ToString("o")
$taipeiNow = Get-TaipeiStamp
$stamp = $taipeiNow.ToString("yyyyMMdd-HHmmss")
$logDir = Join-Path $RuntimeRoot "logs"
$receiptDir = Join-Path $RuntimeRoot "data\scan-receipts"
New-Item -ItemType Directory -Force -Path $logDir, $receiptDir | Out-Null
$log = Join-Path $logDir ("strategy4-postscan-closure-retired-{0}.log" -f $stamp)
$receiptFile = Join-Path $receiptDir "strategy4-postscan-closure-latest.json"
$datedReceiptFile = Join-Path $receiptDir ("strategy4-postscan-closure-retired-{0}.json" -f $stamp)
$message = "Strategy4 standalone postscan closure retired; terminal chain verification now runs inline inside run-strategy4.ps1 after successful publish."
"[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $message | Set-Content -LiteralPath $log -Encoding utf8
$receipt = [ordered]@{
  ok = $true
  status = "retired"
  source = "strategy4-postscan-closure"
  startedAt = $startedAt
  finishedAt = (Get-Date).ToString("o")
  projectRoot = $ProjectRoot
  runtimeRoot = $RuntimeRoot
  productionUrl = $ProductionUrl
  log = $log
  retired = $true
  replacement = "run-strategy4.ps1 Invoke-Strategy4InlineTerminalVerify"
  latestPointerUpdated = $false
  emptyResultWritten = $false
  message = $message
}
Write-JsonFile $receiptFile $receipt
Write-JsonFile $datedReceiptFile $receipt
Write-Host $message
exit 0