param(
  [string]$ProjectRoot = "C:\fuman-terminal",
  [string]$ScorecardRoot = "C:\Users\ginov\Documents\Codex\2026-06-22\new-chat-7\outputs\backtest-scorecard",
  [string]$Python = "",
  [switch]$NoLiveVerify
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host ("[scorecard-snapshot] {0}" -f $Message)
}

if (-not (Test-Path -LiteralPath $ProjectRoot)) {
  throw "project root missing: $ProjectRoot"
}

$duckdb = Join-Path $ScorecardRoot "scorecard.duckdb"
if (-not (Test-Path -LiteralPath $duckdb)) {
  throw "scorecard duckdb missing: $duckdb"
}

if (-not $Python) {
  $venvPython = Join-Path $ScorecardRoot ".venv\Scripts\python.exe"
  if (Test-Path -LiteralPath $venvPython) {
    $Python = $venvPython
  } else {
    $Python = "python"
  }
}

Set-Location -LiteralPath $ProjectRoot
$outFile = Join-Path $ProjectRoot "data\scorecard-latest.json"

Write-Step "export DuckDB snapshot"
& $Python "scripts\export-scorecard-snapshot.py" --db $duckdb --out $outFile
if ($LASTEXITCODE -ne 0) { throw "scorecard export failed with exit code $LASTEXITCODE" }

Write-Step "publish Supabase snapshot"
& node --use-system-ca "scripts\publish-scorecard-snapshot.js" "--file=$outFile"
if ($LASTEXITCODE -ne 0) { throw "scorecard publish failed with exit code $LASTEXITCODE" }

Write-Step "verify scorecard"
$verifyArgs = @("--use-system-ca", "scripts\verify-scorecard-snapshot.js")
if ($NoLiveVerify) { $verifyArgs += "--no-live" }
& node @verifyArgs
if ($LASTEXITCODE -ne 0) { throw "scorecard verify failed with exit code $LASTEXITCODE" }

Write-Step "ok"
