$ErrorActionPreference='Stop'
. "$PSScriptRoot/ProductionRuntimePorts.ps1"
$nativeReader=${function:Get-RuntimeNativeProcessPresent}
if((& $nativeReader $PID) -cne $true){throw 'NATIVE_CURRENT_PROCESS_CHECK_FAILED'}
if((& $nativeReader 2147483647) -cne $false){throw 'NATIVE_ABSENT_PROCESS_CHECK_FAILED'}
# Captured exit-race shape; simulated process inventory only.
$caught=@{pid=24944;parent_pid=10196;created="2026-10-14T22:17:36.174679+08:00"}
function Get-CimInstance {
 param($ClassName,$Filter,$ErrorAction)
 if(!$Filter){return $script:rows}
 switch($script:case){
  'query_error'{throw 'SIMULATED_QUERY_ERROR'}
  'still_present'{return $script:rows[1]}
  'pid_reused'{return @{ProcessId=24944;CreationDate='2026-10-14T22:18:00+08:00';CommandLine='replacement';ExecutablePath='C:\replacement.exe'}}
  default{return @()}
 }
}
function Get-RuntimeNativeProcessPresent {
 param($ProcessId)
 if($script:case -eq 'native_error'){throw 'SIMULATED_ACCESS_ERROR'}
 return ($script:case -eq 'native_present')
}
function Get-Process {param($Id,$ErrorAction) return @{StartTime=[datetime]'2026-10-14T06:00:00Z'}}
$results=@()
foreach($script:case in @('captured_exited','still_present','pid_reused','query_error','native_present','native_error','other_parent_exited')){
 $script:rows=@(
  @{Name='node.exe';ProcessId=44008;ParentProcessId=32668;CreationDate='2026-10-14T06:00:00Z';ExecutablePath='C:\node.exe';CommandLine='node C:\fuman-release-owner\prod81\scripts\fugle-futopt-websocket-collector.js'},
  @{Name='pwsh.exe';ProcessId=[int]$caught.pid;ParentProcessId=[int]$caught.parent_pid;CreationDate=$caught.created;ExecutablePath=$null;CommandLine=$null}
 )
 if($script:case -eq 'other_parent_exited'){$script:rows[1].ParentProcessId=999}
 $err=$null;$value=@()
 try{$value=@(Get-RuntimeInventory @{prod='C:/fuman-release-owner/prod81'})}catch{$err=$_.Exception.Message}
 $expected=$script:case -in @('captured_exited','other_parent_exited')
 $pass=if($expected){!$err -and $value.Count -eq 1 -and $value[0].pid -eq 44008}else{$err -ceq 'PROCESS_INVENTORY_INCOMPLETE_ADMIN_REQUIRED'}
 $results+=@{case=$script:case;pass=[bool]$pass;error=$err}
}
$r=@{formal_execution=$false;native_current_and_absent_checks='PASS';passed=@($results|Where-Object pass).Count;failed=@($results|Where-Object {!$_.pass}).Count;cases=$results}
$r|ConvertTo-Json -Depth 6
if($r.failed){exit 1}
