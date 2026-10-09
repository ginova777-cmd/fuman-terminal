$ErrorActionPreference='Stop'
$pinfo=[Diagnostics.ProcessStartInfo]::new();$pinfo.FileName=(Get-Command node).Source;$pinfo.UseShellExecute=$false;$pinfo.CreateNoWindow=$true
$pinfo.ArgumentList.Add('--max-old-space-size=128');$pinfo.ArgumentList.Add((Join-Path $PSScriptRoot 'benchmark-coordinator.cjs'))
$p=[Diagnostics.Process]::Start($pinfo);$w=[Diagnostics.Stopwatch]::StartNew();$peak=0L;$reason=$null
while(!$p.HasExited){$p.Refresh();$peak=[Math]::Max($peak,$p.WorkingSet64);if($peak -gt 512MB){$reason='OWNED_TEST_RSS'};if($w.Elapsed.TotalSeconds -gt 120){$reason='OWNED_TEST_TIMEOUT'};if($reason){$p.Kill();$p.WaitForExit();break};Start-Sleep -Milliseconds 250}
$p.WaitForExit();$r=@{status=if($reason){'BLOCKED'}elseif($p.ExitCode -eq 0){'PASS'}else{'FAILED'};reason=$reason;exit_code=$p.ExitCode;sampled_peak_rss_bytes=$peak;elapsed_ms=$w.ElapsedMilliseconds;only_owned_test_process=$true;old_generation_mb=128;rss_limit_mb=512;timeout_seconds=120}
$r|ConvertTo-Json|Set-Content (Join-Path $PSScriptRoot 'coordinator-resource-guard.json');$r|ConvertTo-Json -Compress

