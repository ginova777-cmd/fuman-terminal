$ErrorActionPreference='Stop'
$wrapper=Join-Path $PSScriptRoot '..\ops\public-slot\Run-DaytradeSourceWriter.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($wrapper,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'WRAPPER_SYNTAX_FAILED'}
foreach($name in @('Get-IsoAgeSeconds','Test-FutoptCollectorHealthy','Invoke-FugleFutoptCollectorReleaseReconcile')){
 $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 if(-not $fn){throw "MISSING_FUNCTION $name"};Invoke-Expression $fn.Extent.Text
}
$good=@{ok=$true;websocketConnected=$true;websocketAuthenticated=$true;formalReady=$true;updatedAt=[DateTimeOffset]::UtcNow.AddSeconds(-5).ToString('o');error=''}
if(-not(Test-FutoptCollectorHealthy $good)){throw 'HEALTHY_REJECTED'}
foreach($field in @('ok','websocketConnected','websocketAuthenticated','formalReady')){
 foreach($value in @($false,$null,'true',1)){
  $bad=$good.Clone();$bad[$field]=$value;if(Test-FutoptCollectorHealthy $bad){throw "INVALID_FLAG_ACCEPTED $field"}
 }
}
foreach($value in @('invalid',[DateTimeOffset]::UtcNow.AddSeconds(30).ToString('o'),[DateTimeOffset]::UtcNow.AddSeconds(-100).ToString('o'))){
 $bad=$good.Clone();$bad.updatedAt=$value;if(Test-FutoptCollectorHealthy $bad){throw 'INVALID_TIME_ACCEPTED'}
}
$StateDir=Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $StateDir|Out-Null
$FutoptCollectorRelease='test';$TradeDate='2026-10-03'
function Get-Process {param($Id,$ErrorAction) return @{Id=$Id}}
function Stop-Process {throw 'UNEXPECTED_STOP'}
function Start-Process {throw 'UNEXPECTED_START'}
$broken=@{pid=123;collector_release='test';ok=$false;formalReady=$false;error='FUTURES_CATALOGUE_PROVIDER_IDENTITY';updatedAt=[DateTimeOffset]::UtcNow.ToString('o')}
$broken|ConvertTo-Json|Set-Content (Join-Path $StateDir 'fugle-futopt-websocket-status.json')
if(Invoke-FugleFutoptCollectorReleaseReconcile){throw 'ACTUAL_RECONCILE_FALSE_SUCCESS'}
$receipt=Get-Content (Join-Path $StateDir 'fugle-daytrade-futopt-collector-rotation.json') -Raw|ConvertFrom-Json
if($receipt.reason -ne 'collector_alive_but_health_unverified'){throw 'MISSING_BLOCKER'}
$good.pid=123;$good.collector_release='test';$good.lastMessageAt=[DateTimeOffset]::UtcNow.AddSeconds(-5).ToString('o')
$good|ConvertTo-Json|Set-Content (Join-Path $StateDir 'fugle-futopt-websocket-status.json')
if(-not(Invoke-FugleFutoptCollectorReleaseReconcile)){throw 'HEALTHY_RECONCILE_REJECTED'}
Write-Output 'PASS actual reconcile rejects alive-but-failed collector, unknown/string flags, future/stale status; healthy case passes without stop/start'
