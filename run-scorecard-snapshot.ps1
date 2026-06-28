param(
  [string]$ProjectRoot = "C:\fuman-terminal",
  [string]$ScorecardRoot = "C:\Users\ginov\Documents\Codex\2026-06-22\new-chat-7\outputs\backtest-scorecard",
  [string]$Python = "",
  [switch]$AllowDuckDbFallback,
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
$duckDbFallbackAllowed = $AllowDuckDbFallback -or $env:FUMAN_SCORECARD_ALLOW_DUCKDB_FALLBACK -eq "1"
if ($duckDbFallbackAllowed -and -not (Test-Path -LiteralPath $duckdb)) {
  throw "scorecard duckdb fallback was requested but duckdb is missing: $duckdb"
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
$runtimeRoot = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$terminalSourceFile = Join-Path $runtimeRoot "data\scorecard-terminal-current.json"

Write-Step "generate terminal scorecard source"
& node --use-system-ca "scripts\generate-terminal-scorecard-source.js" "--out=$terminalSourceFile"
if ($LASTEXITCODE -ne 0) { throw "terminal scorecard source generation failed with exit code $LASTEXITCODE" }

Write-Step "upsert terminal scorecard source to Supabase"
& node --use-system-ca "scripts\scorecard-source-supabase-ops.js" "backfill" "--source-file=$terminalSourceFile"
if ($LASTEXITCODE -ne 0) { throw "scorecard Supabase source backfill failed with exit code $LASTEXITCODE" }

Write-Step "export Supabase scorecard source"
& node --use-system-ca "scripts\export-scorecard-supabase-source.js" "--out=$outFile"
if ($LASTEXITCODE -ne 0) {
  if (-not $duckDbFallbackAllowed) {
    throw "scorecard Supabase source export failed with exit code $LASTEXITCODE; refusing to republish stale DuckDB fallback"
  }
  Write-Step "Supabase source unavailable; export DuckDB fallback because fallback was explicitly allowed"
  & $Python "scripts\export-scorecard-snapshot.py" --db $duckdb --out $outFile
  if ($LASTEXITCODE -ne 0) { throw "scorecard DuckDB fallback export failed with exit code $LASTEXITCODE" }
}

Write-Step "publish Supabase snapshot"
& node --use-system-ca "scripts\publish-scorecard-snapshot.js" "--file=$outFile"
if ($LASTEXITCODE -ne 0) { throw "scorecard publish failed with exit code $LASTEXITCODE" }

Write-Step "verify scorecard"
$verifyArgs = @("--use-system-ca", "scripts\verify-scorecard-snapshot.js")
if ($NoLiveVerify) { $verifyArgs += "--no-live" }
& node @verifyArgs
if ($LASTEXITCODE -ne 0) { throw "scorecard verify failed with exit code $LASTEXITCODE" }

Write-Step "ok"
