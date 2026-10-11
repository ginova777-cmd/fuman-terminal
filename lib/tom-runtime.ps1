if (-not ('TomBoundedCopy' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Threading.Tasks;
public static class TomBoundedCopy {
 public static async Task Copy(Stream source, Stream target, long maximum) {
  byte[] buffer=new byte[8192]; long total=0; int count;
  while((count=await source.ReadAsync(buffer,0,buffer.Length))>0) {
   total+=count; if(total>maximum) throw new IOException("TOM_OUTPUT_LIMIT");
   await target.WriteAsync(buffer,0,count); await target.FlushAsync();
  }
 }
}
'@
}
function Write-TomJournal([string]$State,[string]$Step,[int]$Code=0,$Detail=$null) {
  $entry=[ordered]@{contract='tom-root-journal-v1';trade_date=$script:TomDate;runId=$script:TomRun;at=[DateTimeOffset]::Now.ToString('o');pid=$PID;state=$State;step=$Step;exitCode=$Code}
  $entry.detail=$Detail
  $entry|ConvertTo-Json -Depth 5 -Compress|Add-Content -LiteralPath $script:TomJournal -Encoding utf8
}
function Initialize-TomTakeover {
  $pointer=Join-Path $receiptDir 'tom-active-run.json'
  if(Test-Path -LiteralPath $pointer){
    if((Get-Item -LiteralPath $pointer).Length -gt 65536){throw 'TOM_ACTIVE_POINTER_TOO_LARGE'}
    $previous=Get-Content -LiteralPath $pointer -Raw|ConvertFrom-Json
    $oldJournal=[IO.Path]::GetFullPath([string]$previous.journal)
    if([IO.Path]::GetDirectoryName($oldJournal) -ne [IO.Path]::GetFullPath($receiptDir)){throw 'TOM_ACTIVE_POINTER_PATH_INVALID'}
    if(!(Test-Path -LiteralPath $oldJournal)){throw 'TOM_PREVIOUS_JOURNAL_MISSING'}
    if((Get-Item -LiteralPath $oldJournal).Length -gt 4194304){throw 'TOM_PREVIOUS_JOURNAL_TOO_LARGE'}
    $entries=@();$malformed=$false
    foreach($line in Get-Content -LiteralPath $oldJournal){if($line.Trim()){try{$entries+=($line|ConvertFrom-Json)}catch{$malformed=$true}}}
    $last=if($entries.Count){$entries[-1]}else{$null}
    $children=@($entries|Where-Object {$_.state -eq 'CHILD_STARTED'})
    foreach($child in $children){
      $live=Get-Process -Id $child.detail.childPid -ErrorAction SilentlyContinue
      if($live -and $live.StartTime.ToUniversalTime().ToString('o') -eq $child.detail.childStartedAt){
        Write-TomJournal 'BLOCKED_ORPHAN_CHILD' $child.step 2 $child.detail
        throw 'TOM_PREVIOUS_CHILD_STILL_ACTIVE'
      }
    }
    if($malformed -or !$last -or $last.state -ne 'ENDED'){
      Write-TomJournal 'PREVIOUS_RUN_INTERRUPTED' 'takeover' 1 @{previousRunId=$previous.runId;previousJournal=$oldJournal;lastState=$last.state;lastStep=$last.step;malformed=$malformed}
    }
  }
  $temp=$pointer+'.'+$script:TomRun+'.tmp'
  @{runId=$script:TomRun;journal=$script:TomJournal;pid=$PID}|ConvertTo-Json|Set-Content -LiteralPath $temp -Encoding utf8
  Move-Item -LiteralPath $temp -Destination $pointer -Force
}
function Invoke-TomNode {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$NodeArgs)
  $step=($NodeArgs|Where-Object {$_ -like '*.js' -or $_ -like '*.cjs'}|Select-Object -First 1)
  $stepBudget=$script:TomTimeoutMs
  if($script:TomDeadline){
    $remaining=($script:TomDeadline-[DateTimeOffset]::UtcNow).TotalMilliseconds
    if($remaining -le 0){Write-TomJournal 'TIMED_OUT' 'root_budget' 124;throw 'TOM_ROOT_BUDGET_EXHAUSTED'}
    $stepBudget=[math]::Min($stepBudget,$remaining)
  }
  Write-TomJournal 'STEP_STARTED' $step
  $psi=[System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName=(Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $psi.WorkingDirectory=$ProjectRoot
  $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true
  $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true
  foreach($arg in $NodeArgs){$psi.ArgumentList.Add($arg)}
  $p=[System.Diagnostics.Process]::new();$p.StartInfo=$psi
  try {
    if(-not $p.Start()){throw 'child_start_failed'}
    Write-TomJournal 'CHILD_STARTED' $step 0 @{childPid=$p.Id;childStartedAt=$p.StartTime.ToUniversalTime().ToString('o')}
    $outputBase=$script:TomJournal+'.'+$p.Id
    $outFile=[System.IO.File]::Create($outputBase+'.stdout.log')
    $errFile=[System.IO.File]::Create($outputBase+'.stderr.log')
    $stdout=[TomBoundedCopy]::Copy($p.StandardOutput.BaseStream,$outFile,4194304)
    $stderr=[TomBoundedCopy]::Copy($p.StandardError.BaseStream,$errFile,4194304)
    $clock=[System.Diagnostics.Stopwatch]::StartNew()
    while(-not $p.WaitForExit(100)) {
      if($stdout.IsFaulted -or $stderr.IsFaulted -or $clock.ElapsedMilliseconds -ge $stepBudget){break}
    }
    if($stdout.IsFaulted -or $stderr.IsFaulted){
      if(-not $p.HasExited){$p.Kill($true);$script:TomKilledChild=$true;[void]$p.WaitForExit(5000)}
      Write-TomJournal 'OUTPUT_LIMIT_OR_IO_ERROR' $step 125
      throw "TOM_OUTPUT_LIMIT_OR_IO_ERROR: $step"
    }
    if(-not $p.HasExited){
      $p.Kill($true);$script:TomKilledChild=$true;[void]$p.WaitForExit(5000)
      $global:LASTEXITCODE=124;Write-TomJournal 'TIMED_OUT' $step 124
      throw "TOM_STEP_TIMEOUT: $step"
    }
    $global:LASTEXITCODE=$p.ExitCode
    if(-not [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($stdout,$stderr),5000)){
      Write-TomJournal 'OUTPUT_DRAIN_TIMEOUT' $step 124
      throw "TOM_OUTPUT_DRAIN_TIMEOUT: $step"
    }
    [void]$stdout.GetAwaiter().GetResult();[void]$stderr.GetAwaiter().GetResult()
    $outFile.Dispose();$errFile.Dispose()
    Write-TomJournal 'STEP_FINISHED' $step $p.ExitCode
    [System.IO.File]::ReadAllText($outputBase+'.stdout.log')
    $err=[System.IO.File]::ReadAllText($outputBase+'.stderr.log');if($err){[Console]::Error.WriteLine($err)}
  } finally {if($outFile){$outFile.Dispose()};if($errFile){$errFile.Dispose()};$p.Dispose()}
}
function Write-TomEvent([string]$State) {
  # Durable handoff only. No external channel is enabled and no delivery is claimed.
  $dir=Join-Path $RuntimeRoot 'data/tom-events';New-Item -ItemType Directory -Force $dir|Out-Null
  $event=[ordered]@{contract='tom-event-v1';task='root';trade_date=$script:TomDate;runId=$script:TomRun;state=$State;deliveryStatus='PENDING_CHANNEL_APPROVAL';deliveredAt=$null;journal=$script:TomJournal}
  $file=Join-Path $dir ($script:TomRun+'-'+$State+'.json')
  try {$stream=[System.IO.File]::Open($file,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write,[System.IO.FileShare]::None)}
  catch [System.IO.IOException] {if(Test-Path -LiteralPath $file){return};throw}
  try {$bytes=[System.Text.Encoding]::UTF8.GetBytes(($event|ConvertTo-Json));$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)} finally {$stream.Dispose()}
}


