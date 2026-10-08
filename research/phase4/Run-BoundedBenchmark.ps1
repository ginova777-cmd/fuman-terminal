$ErrorActionPreference='Stop'
# Only the process started by this script can be terminated. No runtime inventory or service action.
$info=[Diagnostics.ProcessStartInfo]::new()
$info.FileName=(Get-Command node).Source
$info.UseShellExecute=$false
$info.CreateNoWindow=$true
$info.ArgumentList.Add('--max-old-space-size=128')
$info.ArgumentList.Add((Join-Path $PSScriptRoot 'bounded-benchmark.cjs'))
$process=[Diagnostics.Process]::Start($info)
$watch=[Diagnostics.Stopwatch]::StartNew()
$peak=0L;$reason=$null
while(-not $process.HasExited){
 $process.Refresh()
 $peak=[Math]::Max($peak,$process.WorkingSet64)
 if($process.WorkingSet64 -gt 512MB){$reason='OWNED_TEST_RSS_512MIB'}
 if($watch.Elapsed.TotalSeconds -gt 60){$reason='OWNED_TEST_TIMEOUT_60S'}
 if($reason){$process.Kill();$process.WaitForExit();break}
 Start-Sleep -Milliseconds 200
}
$process.WaitForExit()
$receipt=@{status=if($reason){'BLOCKED'}elseif($process.ExitCode -eq 0){'PASS'}else{'FAILED'};pid=$process.Id;only_owned_test_process=$true;exit_code=$process.ExitCode;trigger_reason=$reason;sampled_peak_rss_bytes=$peak;elapsed_ms=$watch.ElapsedMilliseconds;rss_limit_bytes=512MB;worker_old_generation_mb=128;sampling_ms=200}
$receipt|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'evidence/bounded-resource-guard.json') -Encoding utf8
$receipt|ConvertTo-Json -Compress
if($receipt.status -ne 'PASS'){exit 1}
