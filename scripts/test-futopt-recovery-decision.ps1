$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\ops\public-slot\FutoptRecoveryDecision.ps1')
$now=[DateTimeOffset]'2026-10-05T00:35:00Z'
$proc=[pscustomobject]@{ProcessId=123;Name='node.exe';CommandLine='node.exe C:\fuman-release-owner\prod81\scripts\fugle-futopt-websocket-collector.js'}
$good=@{pid=123;updatedAt=$now.AddSeconds(-5).ToString('o');websocketConnected=$true;websocketAuthenticated=$true;formalReady=$true;catalogueTradeDate='2026-10-05';transportHealth=@{last_transport_at=$now.AddSeconds(-20).ToString('o');protocol_error=$null}}
function Check($status,$process,$expected) { $actual=Get-FutoptRecoveryDecision -Status $status -Process $process -TradeDate '2026-10-05' -Now $now;if($actual -ne $expected){throw "expected=$expected actual=$actual"} }
Check $good $proc 'HEALTHY'
$pending=$good.Clone();$pending.formalReady=$false;Check $pending $proc 'WAITING_FORMAL_EVIDENCE'
$oldDay=$good.Clone();$oldDay.catalogueTradeDate='2026-10-02';Check $oldDay $proc 'WAITING_FORMAL_EVIDENCE'
foreach($field in @('websocketConnected','websocketAuthenticated')){$bad=$good.Clone();$bad[$field]='true';Check $bad $proc 'REQUEST_WRITER_RECONCILE'}
foreach($time in @('invalid',$now.AddSeconds(10).ToString('o'),$now.AddSeconds(-301).ToString('o'))){$bad=$good.Clone();$bad.transportHealth=@{last_transport_at=$time};Check $bad $proc 'REQUEST_WRITER_RECONCILE'}
$bad=$good.Clone();$bad.updatedAt=$now.AddSeconds(-120).ToString('o');Check $bad $proc 'REQUEST_WRITER_RECONCILE'
Check $good ([pscustomobject]@{ProcessId=123;Name='node.exe';CommandLine='node.exe C:\unrelated.js'}) 'BLOCKED_PROCESS_IDENTITY'
Check $good $null 'REQUEST_WRITER_RECONCILE'
Check $null $null 'REQUEST_WRITER_RECONCILE'
$path=Join-Path $PSScriptRoot '..\ops\public-slot\Ensure-DaytradeFutoptCollector0835.ps1'
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'SYNTAX_ERROR'}
$commands=$ast.FindAll({param($n)$n -is [Management.Automation.Language.CommandAst]},$true)|ForEach-Object {$_.GetCommandName()}
foreach($forbidden in @('Stop-Process','Stop-ScheduledTask','schtasks.exe','Start-Process')){if($commands -contains $forbidden){throw "FORBIDDEN_COMMAND $forbidden"}}
Write-Output 'PASS: quiet healthy, pending catalogue, wrong date, stale/future/invalid transport, strict flags, wrong process; recovery contains no force-stop or additional WS launch'
