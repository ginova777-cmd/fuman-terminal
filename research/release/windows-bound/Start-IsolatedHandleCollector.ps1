param([Parameter(Mandatory)][string]$Spec,[Parameter(Mandatory)][string]$SpecHash)
$ErrorActionPreference='Stop'
if((Get-FileHash -LiteralPath $Spec).Hash -ne $SpecHash){throw 'LAUNCH_SPEC_DRIFT'}
$x=Get-Content -LiteralPath $Spec -Raw|ConvertFrom-Json
if($env:NODE_OPTIONS){throw 'NODE_OPTIONS_REQUIRE_REVIEW'}
if((Get-FileHash -LiteralPath $x.entry).Hash -ne $x.entry_hash){throw 'LAUNCH_ENTRY_DRIFT'}
if(Test-Path -LiteralPath $x.receipt){throw 'LAUNCH_RECEIPT_EXISTS'}
foreach($p in $x.environment.PSObject.Properties){[Environment]::SetEnvironmentVariable($p.Name,[string]$p.Value,'Process')}
$s=[Diagnostics.ProcessStartInfo]::new()
$s.FileName=$x.exe;$s.WorkingDirectory=Split-Path $x.entry
$s.UseShellExecute=$false;$s.CreateNoWindow=$true
$s.ArgumentList.Add('--use-system-ca');$s.ArgumentList.Add($x.entry)
$p=[Diagnostics.Process]::Start($s)
$r=@{pid=$p.Id;creation_ticks=[string]$p.StartTime.ToUniversalTime().Ticks;exe=$x.exe;entry=$x.entry;entry_hash=$x.entry_hash;spec_hash=$SpecHash;launcher_pid=$PID}
$bytes=[Text.Encoding]::UTF8.GetBytes(($r|ConvertTo-Json))
$tmp=$x.receipt+'.tmp'
$f=[IO.File]::Open($tmp,'CreateNew','Write','None')
try{$f.Write($bytes);$f.Flush($true)}finally{$f.Dispose()}
[IO.File]::Move($tmp,$x.receipt,$false)
