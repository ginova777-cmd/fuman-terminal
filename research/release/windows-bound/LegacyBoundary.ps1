Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Write-CutoverReceipt($Path,$Value){
 $tmp=$Path+'.tmp-'+[guid]::NewGuid().ToString('N')
 $bytes=[Text.Encoding]::UTF8.GetBytes(($Value|ConvertTo-Json -Depth 20))
 $f=[IO.File]::Open($tmp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
 [IO.File]::Move($tmp,$Path,$true)
}
function Get-BoundProcess($Expected){
 $p=Get-Process -Id $Expected.pid -ErrorAction Stop
 # Hold this handle through checks and termination; never reopen a recycled numeric PID.
 $null=$p.Handle
 if($p.StartTime.ToUniversalTime().Ticks -ne [long]$Expected.creation_ticks){$p.Dispose();throw 'CREATION_MISMATCH'}
 if($p.MainModule.FileName -ne $Expected.exe){$p.Dispose();throw 'EXECUTABLE_MISMATCH'}
 $c=Get-CimInstance Win32_Process -Filter ('ProcessId='+$Expected.pid)
 if(!$c.CommandLine -or $c.CommandLine -notmatch [regex]::Escape($Expected.entry)){$p.Dispose();throw 'ENTRYPOINT_UNVERIFIED'}
 return $p
}
function Save-LegacyBoundary($Paths,$Destination){
 if(Test-Path -LiteralPath $Destination){throw 'ARCHIVE_DESTINATION_EXISTS'}
 New-Item -ItemType Directory -Path $Destination|Out-Null
 $r=[ordered]@{status='ARCHIVE_INCOMPLETE';started_at=[DateTimeOffset]::UtcNow.ToString('o');tail='LEGACY_TAIL_PERSISTENCE_UNKNOWN';consistent_cross_file_snapshot=$false;files=@();error=$null}
 try{
  if(@($Paths).Count -eq 0){throw 'ARCHIVE_SOURCE_LIST_EMPTY'}
  $index=0
  foreach($path in $Paths){
   $item=Get-Item -LiteralPath $path
   if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'ARCHIVE_SOURCE_TYPE_INVALID'}
   $dest=Join-Path $Destination (($index++).ToString('D6')+'-'+$item.Name)
   $input=[IO.File]::Open($item.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
   $output=[IO.File]::Open($dest,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
   $hasher=[Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
   $at=[DateTimeOffset]::UtcNow.ToString('o');$count=0L;$limit=$input.Length;$buf=New-Object byte[] 65536
   try{while($count -lt $limit -and ($n=$input.Read($buf,0,[int][Math]::Min($buf.Length,$limit-$count))) -gt 0){$output.Write($buf,0,$n);$hasher.AppendData($buf,0,$n);$count+=$n};if($count -ne $limit){throw 'ARCHIVE_SOURCE_TRUNCATED'};$output.Flush($true);$hash=[Convert]::ToHexString($hasher.GetHashAndReset()).ToLower()}finally{$input.Dispose();$output.Dispose();$hasher.Dispose()}
   if((Get-Item -LiteralPath $dest).Length -ne $count -or (Get-FileHash -LiteralPath $dest).Hash.ToLower() -ne $hash){throw 'ARCHIVE_READBACK_MISMATCH'}
   $r.files+=@{source=$item.FullName;copy=$dest;bytes=$count;sha256=$hash;read_started_at=$at;read_finished_at=[DateTimeOffset]::UtcNow.ToString('o')}
  }
  $r.status='COPIED_BYTES_VERIFIED'
 }catch{$r.error=$_.Exception.Message;throw}finally{$r.finished_at=[DateTimeOffset]::UtcNow.ToString('o');Write-CutoverReceipt (Join-Path $Destination 'archive-receipt.json') $r}
 return $r
}
function Stop-LegacyBoundProcess($Expected,$ArchiveReceipt,$ReceiptPath,[switch]$OwnerStopAuthorized){
 if(!$OwnerStopAuthorized){throw 'OWNER_STOP_NOT_AUTHORIZED'}
 $archive=Get-Content -LiteralPath $ArchiveReceipt -Raw|ConvertFrom-Json -DateKind String
 if($archive.status -ne 'COPIED_BYTES_VERIFIED' -or @($archive.files).Count -eq 0){throw 'ARCHIVE_NOT_VERIFIED'}
 foreach($f in $archive.files){if((Get-Item -LiteralPath $f.copy).Length -ne $f.bytes -or (Get-FileHash -LiteralPath $f.copy).Hash.ToLower() -ne $f.sha256){throw 'ARCHIVE_DRIFT'}}
 $p=Get-BoundProcess $Expected
 $r=[ordered]@{request_id=[guid]::NewGuid().ToString();identity=$Expected;status='STOP_REQUESTED';method='WINDOWS_PROCESS_HANDLE_TERMINATE';graceful_stop=$false;safe_to_stop_proven=$false;tail='LEGACY_TAIL_PERSISTENCE_UNKNOWN';archive_receipt=$ArchiveReceipt;error=$null;started_at=[DateTimeOffset]::UtcNow.ToString('o')}
 try{Write-CutoverReceipt $ReceiptPath $r;$p.Kill();if(!$p.WaitForExit(10000)){throw 'LEGACY_EXIT_TIMEOUT'};$r.status='EXIT_CONFIRMED_TAIL_UNKNOWN';$r.exit_code=$p.ExitCode}catch{$r.status='STOP_FAILED';$r.error=$_.Exception.Message;throw}finally{$r.finished_at=[DateTimeOffset]::UtcNow.ToString('o');Write-CutoverReceipt $ReceiptPath $r;$p.Dispose()}
 return $r
}