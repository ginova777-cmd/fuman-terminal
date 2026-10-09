$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ProductionMaintenanceBinding.ps1')
$stock='Fuman Fugle Daytrade WebSocket Collector 0600-1330'
$writer='Fuman Daytrade Source Writer 0600-1330'
$results=[Collections.Generic.List[object]]::new()
function Assert($ok,$name){if(!$ok){throw $name};$results.Add(@{name=$name;status='PASS'})}
function MakeBinding($names){@{tasks=@($names|ForEach-Object{@{binding=@{name=$_;path='\';definition_sha256=('a'*64);enabled=if($_ -eq 'disabled-aux'){'false'}else{'true'}}}})}}
# Every OS mutation port is intercepted. No formal or test mutex is acquired.
function Restore-BoundTask($Expected){$script:restored.Add($Expected)}
function Exit-BoundMutexes($Held){$script:events.Add('release-'+$Held)}
function Write-OwnerState($Owner,$Stage){$script:events.Add($Stage)}
function Suspend-BoundTask($Expected){throw 'UNEXPECTED_SCHEDULER_MUTATION'}
function Enter-BoundMutexes($Names){throw 'UNEXPECTED_MUTEX_ACQUISITION'}
foreach($names in @(
 @('Fuman Daytrade Closing Water 1333',$writer,'disabled-aux',$stock),
 @($stock,'disabled-aux',$writer,'Fuman Daytrade Closing Water 1333'),
 @($writer,$stock,'Fuman Daytrade Closing Water 1333','disabled-aux')
)){
 $b=MakeBinding $names
 $script:restored=[Collections.Generic.List[object]]::new();$script:events=[Collections.Generic.List[string]]::new()
 $db=[pscustomobject]@{disposed=$false};$db|Add-Member ScriptMethod Dispose {$this.disposed=$true}
 $o=@{binding=$b;stock='stock';writer='writer';db=$db;stock_handed_back=$false;writer_handed_back=$false}
 Release-StockBinding $o
 Assert ($restored.Count -eq 1 -and $restored[0].name -eq $stock -and !$db.disposed -and $o.writer -eq 'writer') 'stock-only-before-writer'
 Restore-WriterBinding $o @{transport_identity_pass=$true}
 Assert ($restored.Count -eq 4 -and @($restored|Where-Object name -eq $stock).Count -eq 1 -and $db.disposed) 'remaining-restored-once'
 Assert (@($restored|Where-Object name -eq 'disabled-aux')[0].enabled -eq 'false') 'disabled-state-preserved'
}
foreach($case in @('missing-stock','missing-writer','duplicate-stock','duplicate-aux','wrong-path','missing-hash')){
 $b=MakeBinding @($stock,$writer,'aux')
 switch($case){
  'missing-stock' {$b.tasks=@($b.tasks|Where-Object{$_.binding.name -ne $stock})}
  'missing-writer' {$b.tasks=@($b.tasks|Where-Object{$_.binding.name -ne $writer})}
  'duplicate-stock' {$b.tasks+=@{binding=$b.tasks[0].binding.Clone()}}
  'duplicate-aux' {$b.tasks+=@{binding=$b.tasks[2].binding.Clone()}}
  'wrong-path' {$b.tasks[0].binding.path='\other\'}
  'missing-hash' {$b.tasks[0].binding.definition_sha256=''}
 }
 $script:restored=[Collections.Generic.List[object]]::new();$script:events=[Collections.Generic.List[string]]::new()
 $o=@{binding=$b;stock='stock';writer='writer';db=$true;stock_handed_back=$false}
 $blocked=$false;try{Release-StockBinding $o}catch{$blocked=$true}
 Assert ($blocked -and $restored.Count -eq 0 -and $events.Count -eq 0) ($case+'-before-release')
}
$results|ConvertTo-Json -Depth 5
