param(
  [string]$FumanRoot = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [switch]$Apply,
  [switch]$Fetch,
  [switch]$Once,
  [switch]$LocalCheck
)

# Run-DaytradeSourceWriter.ps1 is a release-owner wrapper.
# Default mode is dry-run/no-fetch/once. Use -Apply only in an approved writer window.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$WriterScript = Join-Path $RepoRoot "scripts\run-daytrade-source-writer.js"

if (-not (Test-Path -LiteralPath $WriterScript)) {
  throw "Missing writer script: $WriterScript"
}

$env:FUMAN_RUNTIME_DIR = $RuntimeDir

$node = "node"
$args = @("--use-system-ca", $WriterScript)

if ($LocalCheck) {
  $args += "--local-check"
} elseif ($Apply) {
  $args += "--apply"
  if ($Once) { $args += "--once" }
} else {
  $args += "--dry-run"
  $args += "--no-fetch"
  $args += "--once"
}

if ($Fetch -and -not $Apply) {
  $args = @("--use-system-ca", $WriterScript, "--dry-run", "--fetch")
  if ($Once) { $args += "--once" }
}

& $node @args
exit $LASTEXITCODE
