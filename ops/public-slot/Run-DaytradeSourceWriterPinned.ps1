param(
  [string]$FumanRoot,
  [string]$RuntimeDir = "C:\fuman-runtime",
  [switch]$Apply,
  [switch]$Fetch,
  [switch]$Once,
  [switch]$Continuous,
  [switch]$LocalCheck
)

# Stable task entrypoint. Ignore legacy scheduled-task root arguments so an old
# task registration cannot redirect the formal writer away from release-owner.
$ApprovedRoot = if ([string]::IsNullOrWhiteSpace($FumanRoot)) { throw "approved_writer_root_required" } else { [IO.Path]::GetFullPath($FumanRoot) }
$Target = Join-Path $ApprovedRoot "ops\public-slot\Run-DaytradeSourceWriter.ps1"
if (-not (Test-Path -LiteralPath $Target)) { throw "approved_writer_wrapper_missing:$Target" }

$TargetText = Get-Content -LiteralPath $Target -Raw
if ($TargetText -notmatch 'FutoptCollectorRelease\s*=\s*"futopt-formal-live-mirror-v5"') {
  throw "approved_writer_futopt_release_mismatch:expected_v5:$Target"
}

& $Target -FumanRoot $ApprovedRoot -RuntimeDir $RuntimeDir -Apply:$Apply -Fetch:$Fetch -Once:$Once -Continuous:$Continuous -LocalCheck:$LocalCheck
exit $LASTEXITCODE
