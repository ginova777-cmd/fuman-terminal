param(
  [string]$PoolPath = "C:\fuman-runtime\cache\intraday\fugle-daytrade-ws-priority-symbols.json"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path -LiteralPath $PoolPath)) { throw "5m candidate pool missing: $PoolPath" }
$pool = Get-Content -LiteralPath $PoolPath -Raw | ConvertFrom-Json
$candidateSymbols = @($pool.terminalPrioritySymbols | Where-Object { $_ -match '^\d{4}$' } | Select-Object -Unique)
if ($candidateSymbols.Count -eq 0) { throw "5m candidate pool contains zero symbols" }
& (Join-Path $root "run-daytrade-intraday-5m-complete.ps1") -Symbols ($candidateSymbols -join ',')
if ($LASTEXITCODE -ne 0) { throw "5m current-candidate closure failed (exit=$LASTEXITCODE)" }
