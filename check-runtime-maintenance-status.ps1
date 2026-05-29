$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$git = "C:\Program Files\Git\cmd\git.exe"

function Invoke-GitLines([string[]]$ArgsList) {
  & $git -C $repo @ArgsList
}

$statusLines = @(Invoke-GitLines @("status", "--porcelain"))
$stashLines = @(Invoke-GitLines @("stash", "list"))
$generatedPatterns = @(
  "^data/open-buy-.*\.json$",
  "^data/strategy\d?-.*latest.*\.json$",
  "^data/.*-scorecard-source\.json$",
  "^cache/",
  "^logs/"
)

$generated = New-Object System.Collections.Generic.List[string]
$manual = New-Object System.Collections.Generic.List[string]

foreach ($line in $statusLines) {
  if (-not $line) { continue }
  $path = $line.Substring(3).Replace("\", "/")
  $isGenerated = $false
  foreach ($pattern in $generatedPatterns) {
    if ($path -match $pattern) {
      $isGenerated = $true
      break
    }
  }
  if ($isGenerated) {
    $generated.Add($line)
  } else {
    $manual.Add($line)
  }
}

Write-Host "Runtime maintenance status"
Write-Host "repo=$repo"
Write-Host ""

if ($manual.Count) {
  Write-Host "Manual/code changes:"
  $manual | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Host "Manual/code changes: none"
}

Write-Host ""
if ($generated.Count) {
  Write-Host "Generated cache/data changes:"
  $generated | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Host "Generated cache/data changes: none"
}

Write-Host ""
if ($stashLines.Count) {
  Write-Host "Stashes:"
  $stashLines | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Host "Stashes: none"
}

if ($manual.Count -or $stashLines.Count) {
  exit 1
}
