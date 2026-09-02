param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [string]$TaskName = "Fuman Daytrade Near-One Natural Source"
)

$ErrorActionPreference = "Stop"
$runner = Join-Path $ProjectRoot "scripts\run-daytrade-near-one-source.js"
if (-not (Test-Path -LiteralPath $runner)) { throw "near-one source worker missing: $runner" }

$node = (Get-Command node.exe -ErrorAction SilentlyContinue)
if (-not $node) { throw "node.exe not found on the source host" }

$taskCommand = ('"{0}" --use-system-ca "{1}" --apply --once' -f $node.Source, $runner)
$schtasks = Join-Path $env:SystemRoot "System32\schtasks.exe"
if (-not (Test-Path -LiteralPath $schtasks)) { throw "schtasks.exe not found" }

& $schtasks /Create `
  /TN $TaskName `
  /TR $taskCommand `
  /SC MINUTE `
  /MO 1 `
  /ST 08:45 `
  /ET 08:59 `
  /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw "schtasks create failed exit=$LASTEXITCODE" }

Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
Write-Host ("[daytrade-near-one-source-task] installed task={0} root={1} window=08:45-08:59 interval=1m" -f $TaskName, $ProjectRoot)
