param(
  [string]$TaskName = "Fuman Deploy Worktree Clean Monitor 5m",
  [string]$ProjectRoot = "C:\fuman-terminal",
  [int]$IntervalMinutes = 5,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task: $TaskName"
  exit 0
}

$pwsh = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
if (-not $pwsh) {
  $pwsh = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
}

$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $node = "C:\Program Files\nodejs\node.exe"
}

$monitor = Join-Path $ProjectRoot "scripts\monitor-deploy-worktree-clean.js"
if (-not (Test-Path -LiteralPath $monitor)) {
  throw "Deploy worktree monitor not found: $monitor"
}

$command = @"
Set-Location -LiteralPath '$ProjectRoot'
& '$node' 'scripts\monitor-deploy-worktree-clean.js'
exit `$LASTEXITCODE
"@

$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$action = New-ScheduledTaskAction `
  -Execute $pwsh `
  -Argument "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"

$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes ([math]::Max(1, $IntervalMinutes))) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Checks C:\fuman-terminal for dirty/untracked generated static data artifacts and runs cleanup without committing." `
  -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName every $IntervalMinutes minute(s)"
