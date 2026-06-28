param(
  [switch]$Apply,
  [switch]$SkipSupabase,
  [switch]$SkipVercel,
  [string]$ExtraArgs = ""
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$node = "node"
$script = Join-Path $root "scripts\cleanup-supabase-vercel-history.js"
if (-not (Test-Path -LiteralPath $script)) {
  throw "history cleanup script missing: $script"
}

$argsList = @("--use-system-ca", $script)
if ($Apply) { $argsList += "--apply" } else { $argsList += "--dry-run" }
if ($SkipSupabase) { $argsList += "--skip-supabase" }
if ($SkipVercel) { $argsList += "--skip-vercel" }
if ($ExtraArgs) {
  $argsList += ($ExtraArgs -split "\s+" | Where-Object { $_ })
}

Write-Host "[history-cleanup] root=$root apply=$Apply skipSupabase=$SkipSupabase skipVercel=$SkipVercel"
& $node @argsList
if ($LASTEXITCODE -ne 0) {
  throw "history cleanup failed with exit code $LASTEXITCODE"
}
