param([ValidateSet('us_0820','asia_0850')][string]$Stage,[string]$EvidenceRoot)
$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $PSScriptRoot
$EvidenceRoot=[IO.Path]::GetFullPath($EvidenceRoot)
if(-not $EvidenceRoot.StartsWith((Join-Path $Root 'outputs\morning-contract-20261018'),[StringComparison]::OrdinalIgnoreCase)){throw 'ISOLATED_PATH_REQUIRED'}
Set-Location $Root
$RuntimeDir=Join-Path $EvidenceRoot 'runtime'
$env:FUMAN_RUNTIME_DIR=$RuntimeDir
$env:FUMAN_STATE_DIR=Join-Path $RuntimeDir 'state'
$env:FUMAN_MORNING_STAGE=$Stage
$env:NODE_OPTIONS='--require="'+(Join-Path $Root 'scripts\morning-isolated-transport.cjs').Replace('\','/')+'"'
$tradeDate='2026-10-16';$today='20261016';$stamp=Get-Date -Format yyyyMMdd-HHmmss
$receiptDir=Join-Path $RuntimeDir "data/opening-report-stages/$Stage"
$source=Get-Content -LiteralPath "$receiptDir/opening-report-0830-overseas-leaders-$today.json" -Raw|ConvertFrom-Json
$runId=$source.run_id
$wrapperReceipt=Join-Path $receiptDir "opening-report-0830-wrapper-receipt-$today.json"
$logDir=Join-Path $EvidenceRoot "wrapper-$Stage";New-Item -ItemType Directory -Force $logDir|Out-Null
$releaseSha=(& git rev-parse HEAD|Out-String).Trim()
$IsolatedBacktest=[switch]$false;$ReuseLineReceipt=[switch]$false;$FinalizeExisting=[switch]$false;$ResumeEvidence=[switch]$false;$RecoveryContext=$null
function Invoke-MorningAggregate { & node scripts/verify-opening-report-two-stage.js "--date=$tradeDate" --if-ready > (Join-Path $logDir 'aggregate.json') }
function Invoke-NodeStep {
  param([string[]]$NodeArgs,[string]$Label)
  $stdout=Join-Path $logDir "$Label.stdout.json";$stderr=Join-Path $logDir "$Label.stderr.txt"
  if($Label -eq 'source-freeze-0830') { return [pscustomobject]@{label=$Label;exitCode=0;fixture='existing immutable historical source';stdout='';stderr=''} }
  if($Label -eq 'rendered-delivery') {
    $rendered=Get-Content -Raw "$receiptDir/rendered/$today/opening-report-rendered.json"|ConvertFrom-Json
    if($rendered.run_id -ne $runId -or $rendered.complete -ne $true){throw 'RENDERED_FIXTURE_IDENTITY'}
    return [pscustomobject]@{label=$Label;exitCode=0;fixture='actual loopback routes and rendered CLI receipt';stdout='';stderr=''}
  }
  if($Label -eq 'mother-pool-persistence-ack' -and $env:FUMAN_ISOLATED_MOTHER -eq 'ready') {
    & node scripts/morning-mother-receipt-fixture.cjs 1> $stdout 2> $stderr
    return [pscustomobject]@{label=$Label;exitCode=$LASTEXITCODE;fixture='upstream response fixture, not Mother Pool acceptance';stdout=$stdout;stderr=$stderr}
  }
  & node @NodeArgs 1> $stdout 2> $stderr
  return [pscustomobject]@{label=$Label;exitCode=$LASTEXITCODE;stdout=$stdout;stderr=$stderr}
}
# Execute the exact candidate wrapper body. Only external entry guards and
# source/render transports are supplied above; formal files are never written.
$file=Join-Path $Root 'run-opening-report-0830-production-wrapper.ps1'
$text=[IO.File]::ReadAllText($file)
$body=$text.Substring($text.IndexOf('# Formal contract: runner ->'))
$body=$body.Replace('mode = if ($IsolatedBacktest) { "isolated_backtest" } else { "production" }','mode = "isolated_e2e"')
[ordered]@{scope='isolated_wrapper_body';source=$file;sha256=(Get-FileHash $file -Algorithm SHA256).Hash;excluded='formal calendar/release/incident entry guards';source_transport='historical frozen';render_transport='real loopback route receipt';mother_transport='timeout failure fixture'}|ConvertTo-Json|Set-Content (Join-Path $logDir 'test-boundary.json')
& ([ScriptBlock]::Create($body))
