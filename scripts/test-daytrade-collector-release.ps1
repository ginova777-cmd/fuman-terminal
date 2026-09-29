$ErrorActionPreference = 'Stop'
$file = Join-Path $PSScriptRoot '..\ops\public-slot\Run-DaytradeWebSocketCollector.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Resolve-CollectorRelease' }, $true)
Invoke-Expression $fn.Extent.Text
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('collector-release-test-' + [guid]::NewGuid())
$FumanRoot = Join-Path $testRoot 'source'
$production = Join-Path $testRoot 'production'
New-Item -ItemType Directory -Force (Join-Path $FumanRoot 'data\contracts'), (Join-Path $production 'scripts') | Out-Null
@{ sourceRoot = $FumanRoot } | ConvertTo-Json | Set-Content (Join-Path $FumanRoot 'data\contracts\release_root_authority_v1.json')
Set-Content (Join-Path $production 'scripts\fugle-websocket-collector.js') '// isolated file only'
$node = 'Invoke-TestVerifier'
$script:verifierExit = 0
$script:report = @{ok=$true;productionClean=$true;productionRootPresent=$true;productionRoot=$production;productionHead=('a'*40);approvedProductionSha=('a'*40)}
function Invoke-TestVerifier {
  param($entry,$required)
  if ($entry -ne (Join-Path $FumanRoot 'scripts\verify-release-root-authority.js') -or $required -ne '--require-production-root') { throw 'wrong verifier invocation' }
  $global:LASTEXITCODE = $script:verifierExit
  $script:report | ConvertTo-Json
}
function Must-Reject {
  $rejected=$false
  try { Resolve-CollectorRelease | Out-Null } catch { $rejected=$true }
  if (-not $rejected) { throw 'invalid authority accepted' }
}
$result = Resolve-CollectorRelease
if ($result.entry -ne (Join-Path $production 'scripts\fugle-websocket-collector.js') -or $result.root -eq $FumanRoot) { throw 'source selected instead of production' }
$script:report.productionClean=$false; Must-Reject; $script:report.productionClean=$true
$script:report.productionRootPresent=$false; Must-Reject; $script:report.productionRootPresent=$true
$script:report.productionHead=('b'*40); Must-Reject; $script:report.productionHead=('a'*40)
$script:verifierExit=1; Must-Reject; $script:verifierExit=0
$script:report.productionRoot=Join-Path $testRoot 'missing'; Must-Reject
# No supervisor, collector, task, network, or production state is started/modified.
Write-Output 'PASS collector release selection, dirty/missing/mismatch/failing verifier rejection (6 cases)'
