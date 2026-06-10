$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:GOOGLE_SHEET_ID = "1UCpEBXmOWNA57eLXH62WffnPrflly6OwmDm242JYhp8"
$env:NODE_OPTIONS = "--use-system-ca"
$env:SCORECARD_NOTIFY = "0"
$env:DISABLE_SCORECARD_NOTIFY = "1"
$env:ALLOW_SCORECARD_ONLY_WITHOUT_BACKTEST = "1"

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$nodeExe = "C:\Program Files\nodejs\node.exe"
$logDir = "C:\fuman-runtime\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("preopen-strategy-scorecard-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))

function Write-PreopenLog($message) {
  $message | Add-Content -LiteralPath $log -Encoding utf8
}

function Invoke-LoggedStep($label, [scriptblock]$command) {
  Write-PreopenLog "=== $label start $(Get-Date) ==="
  & $command *>&1 | ForEach-Object {
    [string]$_ | Add-Content -LiteralPath $log -Encoding utf8
  }
  $exitCode = $LASTEXITCODE
  if ($null -eq $exitCode) { $exitCode = 0 }
  if ($exitCode -ne 0) {
    Write-PreopenLog "$label failed with exit code $exitCode"
    exit $exitCode
  }
  Write-PreopenLog "=== $label end $(Get-Date) ==="
}

function Assert-CacheFile($relativePath) {
  $runtimePath = Join-Path $env:FUMAN_DATA_DIR $relativePath
  $repoPath = Join-Path "${PSScriptRoot}\data" $relativePath
  if (Test-Path -LiteralPath $runtimePath) {
    Write-PreopenLog "cache ready: $runtimePath"
    return
  }
  if (Test-Path -LiteralPath $repoPath) {
    Write-PreopenLog "cache ready: $repoPath"
    return
  }
  Write-PreopenLog "required cache missing: $relativePath"
  exit 1
}

"=== Preopen strategy scorecard start $(Get-Date) ===" | Out-File $log -Encoding utf8
"Scorecard notifications disabled; Google Sheet upload only." | Add-Content -LiteralPath $log -Encoding utf8
"Preopen uses existing strategy caches; full strategy scans stay on their own schedules." | Add-Content -LiteralPath $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Preopen strategy scorecard" -LogPath $log

Assert-CacheFile "strategy3-scorecard-source.json"
Assert-CacheFile "strategy4-latest.json"
Assert-CacheFile "strategy5-latest.json"

$stamp = Get-Date -Format yyyyMMdd
foreach ($sheet in @("策略3成績單", "策略4成績單", "策略5成績單")) {
  $env:GOOGLE_SHEET_ONLY = $sheet
  Invoke-LoggedStep "Google Sheet upload $sheet" {
    & $nodeExe "scripts\upload-backtest-to-google-sheet.js" $stamp
  }
}
Remove-Item Env:GOOGLE_SHEET_ONLY -ErrorAction SilentlyContinue

Write-PreopenLog "=== Preopen strategy scorecard end $(Get-Date) ==="