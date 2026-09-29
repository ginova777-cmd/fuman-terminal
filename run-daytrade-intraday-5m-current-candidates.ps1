param(
  [string]$PoolPath = "C:\fuman-runtime\cache\intraday\fugle-daytrade-ws-priority-symbols.json"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeRoot = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { 'C:\fuman-runtime' }
$snapshotPath = Join-Path $runtimeRoot 'state\daytrade-mother-pool-snapshot-latest.json'
$mutex = [System.Threading.Mutex]::new($false, 'Local\FumanDaytradeIntraday5mCanonicalWriter')
$acquired = $mutex.WaitOne(0)
if (-not $acquired) { $mutex.Dispose(); exit 0 }
try {
$candidateSource = ''
if (Test-Path -LiteralPath $snapshotPath) {
  $snapshot = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json
  if ($snapshot.contract -ne 'daytrade_mother_pool_snapshot_v1' -or $snapshot.contract_version -ne '4.1.0' -or $snapshot.trade_date -ne (Get-Date -Format 'yyyy-MM-dd') -or $snapshot.complete -ne $true) { throw '5m snapshot contract/date not ready' }
  $candidateSource = 'snapshot.symbols'
  $candidateSymbols = @($snapshot.symbols)
} else {
  if (-not (Test-Path -LiteralPath $PoolPath)) { throw "5m candidate pool missing: $PoolPath" }
  $pool = Get-Content -LiteralPath $PoolPath -Raw | ConvertFrom-Json
  if (@($pool.daytradeMotherPoolSymbols).Count -gt 0) { $candidateSource='daytradeMotherPoolSymbols'; $candidateSymbols=@($pool.daytradeMotherPoolSymbols) }
  else { $candidateSource='terminalPrioritySymbols'; $candidateSymbols=@($pool.terminalPrioritySymbols) }
}
$candidateSymbols = @($candidateSymbols | Where-Object { $_ -match '^\d{4}$' } | Select-Object -Unique)
if ($candidateSymbols.Count -eq 0) { throw "5m candidate pool contains zero symbols" }
Write-Output "5m candidates source=$candidateSource count=$($candidateSymbols.Count)"
& (Join-Path $root "run-daytrade-intraday-5m-complete.ps1") -Symbols ($candidateSymbols -join ',')
if ($LASTEXITCODE -ne 0) { throw "5m current-candidate closure failed (exit=$LASTEXITCODE)" }
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
