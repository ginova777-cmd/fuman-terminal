param(
  [string]$CommitMessage = "",
  [switch]$SkipDeploy,
  [switch]$ForceBump
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$root = $PSScriptRoot
$terminalRoot = if ($env:FUMAN_MAIN_DEPLOY_REPO) { $env:FUMAN_MAIN_DEPLOY_REPO } else { "C:\fuman-terminal" }
$gitExe = "C:\Program Files\Git\cmd\git.exe"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$versionFiles = @(
  "index.html",
  "index.github.html",
  "terminal-core.js",
  "terminal.js",
  "terminal-modules.js",
  "fuman-sw.js",
  "refresh.html",
  "version.json"
)

# Release invariant checked by scripts/verify-publish-gate.js:
# git fetch origin main -> git pull --ff-only origin main -> npm run verify:bump
# -> npm run sync:source -> npm run deploy -> npm run verify:live-version
# -> npm run verify:warrant-freshness:live -> git push origin HEAD:main.
# Frontend version bumps are manual only: pass -ForceBump with ALLOW_VERSION_BUMP=1.

function Write-ReleaseLog($message) {
  Write-Host ("[main-release] {0}" -f $message)
}

function Invoke-ReleaseCommand($label, [scriptblock]$command) {
  Write-ReleaseLog "START $label"
  & $command
  $exitCode = $LASTEXITCODE
  Write-ReleaseLog "END $label exit=$exitCode"
  if ($exitCode -ne 0) {
    throw "$label failed with exit code $exitCode"
  }
}

function Invoke-ReleaseCheck($label, [scriptblock]$command) {
  Write-ReleaseLog "CHECK $label"
  & $command | ForEach-Object { Write-Host $_ }
  $exitCode = $LASTEXITCODE
  Write-ReleaseLog "CHECK $label exit=$exitCode"
  return [int]$exitCode
}

function Invoke-Npm($scriptName) {
  Invoke-ReleaseCommand "npm run $scriptName" { npm run $scriptName }
}

function Invoke-NpmAt($workingRoot, $scriptName) {
  Push-Location $workingRoot
  try {
    $previousAllowDeployRoot = $env:FUMAN_ALLOW_DEPLOY_ROOT
    try {
      if ($scriptName -eq "deploy" -and ([System.IO.Path]::GetFullPath($workingRoot).TrimEnd('\') -ieq [System.IO.Path]::GetFullPath($terminalRoot).TrimEnd('\'))) {
        $env:FUMAN_ALLOW_DEPLOY_ROOT = "1"
      }
      Invoke-ReleaseCommand "npm run $scriptName ($workingRoot)" { npm run $scriptName }
    } finally {
      if ($null -eq $previousAllowDeployRoot) {
        Remove-Item Env:FUMAN_ALLOW_DEPLOY_ROOT -ErrorAction SilentlyContinue
      } else {
        $env:FUMAN_ALLOW_DEPLOY_ROOT = $previousAllowDeployRoot
      }
    }
  } finally {
    Pop-Location
  }
}

function Get-GitLines($arguments) {
  $output = & $gitExe -C $root @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($arguments -join ' ') failed"
  }
  return @($output | Where-Object { [string]$_ -ne "" })
}

function Assert-CleanTree($context) {
  $dirty = Get-GitLines @("status", "--porcelain=v1")
  if ($dirty.Count -gt 0) {
    throw "$context requires a clean working tree. Commit or clear changes first: $($dirty -join '; ')"
  }
}

function Get-Version {
  $core = Get-Content -LiteralPath (Join-Path $root "terminal-core.js") -Raw
  $match = [regex]::Match($core, 'const\s+version\s*=\s*["'']([^"'']+)["'']')
  if (-not $match.Success) {
    throw "Unable to detect version from terminal-core.js"
  }
  return $match.Groups[1].Value
}

Set-Location -LiteralPath $root
Assert-CleanTree "main release pipeline"

Invoke-ReleaseCommand "git fetch origin main" { & $gitExe -C $root fetch --quiet origin main }
Invoke-ReleaseCommand "git pull --ff-only origin main" { & $gitExe -C $root pull --ff-only origin main }
Assert-CleanTree "post-pull main release pipeline"

$beforeVersion = Get-Version
Invoke-Npm "verify:bump"
if ($ForceBump) {
  if ($env:ALLOW_VERSION_BUMP -ne "1") {
    throw "ForceBump requires ALLOW_VERSION_BUMP=1. Do not bump frontend version for strategy/data fixes."
  }
  Write-ReleaseLog "ForceBump selected and approved; bumping terminal version."
  Invoke-Npm "bump:version"
}
$afterVersion = Get-Version

$changedAfterBump = Get-GitLines @("diff", "--name-only")
if ($changedAfterBump.Count -gt 0) {
  $unexpected = @($changedAfterBump | Where-Object { $versionFiles -notcontains $_ })
  if ($unexpected.Count -gt 0) {
    throw "bump produced unexpected dirty files: $($unexpected -join ', ')"
  }
}

Invoke-Npm "sync:source"
Invoke-Npm "verify:version"
Invoke-Npm "verify:sw"
Invoke-Npm "verify:warrant-freshness"
Invoke-Npm "verify:source-sync"

if (-not $SkipDeploy) {
  Invoke-NpmAt $terminalRoot "deploy"
} else {
  Write-ReleaseLog "SkipDeploy selected; deploy command was not run."
}

Invoke-Npm "verify:live-version"
Invoke-Npm "verify:warrant-freshness:live"

$versionChanged = $beforeVersion -ne $afterVersion
if ($versionChanged) {
  foreach ($file in $versionFiles) {
    & $gitExe -C $root add -- $file
    if ($LASTEXITCODE -ne 0) { throw "git add failed for $file" }
  }
  $staged = Get-GitLines @("diff", "--cached", "--name-only")
  if ($staged.Count -gt 0) {
    $message = if ($CommitMessage) { $CommitMessage } else { "Bump terminal version to $afterVersion" }
    Invoke-ReleaseCommand "git commit version bump" { & $gitExe -C $root commit -m $message }
  }
}

Invoke-ReleaseCommand "git push origin HEAD:main" { & $gitExe -C $root push origin HEAD:main }
Write-ReleaseLog "ok version=$afterVersion pushed=origin/main deploySkipped=$([bool]$SkipDeploy) forceBump=$([bool]$ForceBump)"
