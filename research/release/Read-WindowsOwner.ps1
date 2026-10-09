param([Parameter(Mandatory=$true)][int]$TargetPid)
$ErrorActionPreference='Stop'
try {
 $p=Get-CimInstance Win32_Process -Filter "ProcessId=$TargetPid"
 $r=@{contract='windows-owner-probe-v1';query_ok=$true;host=$env:COMPUTERNAME;checked_at=[DateTimeOffset]::UtcNow.ToString('o');pid=$TargetPid;exists=($null -ne $p);creation_time=$null;executable=$null;entrypoint=$null}
 if($p){$r.creation_time=([DateTimeOffset]$p.CreationDate).ToUniversalTime().ToString('o');$r.executable=$p.ExecutablePath
 # Extract an absolute script path only. Never emit the full command line or keys.
 $m=[regex]::Match([string]$p.CommandLine,'(?i)([A-Z]:[\\/][^"\r\n]*?\.(?:cjs|js|ps1))(?=["\s]|$)');if($m.Success){$r.entrypoint=$m.Groups[1].Value}
 }
 $r|ConvertTo-Json -Compress
} catch { @{contract='windows-owner-probe-v1';query_ok=$false;host=$env:COMPUTERNAME;checked_at=[DateTimeOffset]::UtcNow.ToString('o');pid=$TargetPid;reason='PROCESS_QUERY_FAILED'}|ConvertTo-Json -Compress;exit 1 }
