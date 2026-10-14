param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference='Stop'
# No named job, no PID-based termination, no lock removal, no breakaway flags.
# Join before starting any verifier. Setup failure must never fall back to an
# uncontained process. Windows 8+/Server 2012+ supports the required nested jobs.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class VerifierJob {
 [StructLayout(LayoutKind.Sequential)] struct Basic { public long a,b; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
 [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic basic; public IO io; public UIntPtr a,b,c,d; }
 [StructLayout(LayoutKind.Sequential)] struct Accounting { public long a,b,c,d; public uint faults,total,active,terminated; }
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr security,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int cls,ref Extended info,uint bytes);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int cls,out Accounting info,uint bytes,IntPtr length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 // Intentionally held until host exit. Closing a self-containing kill-on-close
 // job earlier would terminate this host before it can propagate the exit code.
 static IntPtr handle;
 public static void Enter(){
  handle=CreateJobObject(IntPtr.Zero,null);if(handle==IntPtr.Zero)throw new Win32Exception();
  var info=new Extended();info.basic.flags=0x2000;
  if(!SetInformationJobObject(handle,9,ref info,(uint)Marshal.SizeOf(info)))throw new Win32Exception();
  if(!AssignProcessToJobObject(handle,GetCurrentProcess()))throw new Win32Exception();
 }
 public static uint Active(){Accounting a;if(!QueryInformationJobObject(handle,1,out a,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero))throw new Win32Exception();return a.active;}
 [DllImport("kernel32.dll",EntryPoint="QueryInformationJobObject",SetLastError=true)] static extern bool QueryIds(IntPtr job,int cls,IntPtr info,uint bytes,IntPtr length);
 public static long[] Members(){IntPtr b=Marshal.AllocHGlobal(8192);try{if(!QueryIds(handle,3,b,8192,IntPtr.Zero))throw new Win32Exception();int assigned=Marshal.ReadInt32(b,0),n=Marshal.ReadInt32(b,4);if(n<0||n>1023||assigned!=n)throw new InvalidOperationException("JOB_MEMBERS_INCOMPLETE");var ids=new long[n];for(int i=0;i<n;i++)ids[i]=Marshal.ReadIntPtr(b,8+i*IntPtr.Size).ToInt64();return ids;}finally{Marshal.FreeHGlobal(b);}}
 public static void Abort(){if(!TerminateJobObject(handle,125))throw new Win32Exception();}
}
'@
try {
 [VerifierJob]::Enter()
 $inputSpec=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))|ConvertFrom-Json
 if(-not [IO.Path]::IsPathRooted([string]$inputSpec.executable)){throw 'ABSOLUTE_EXECUTABLE_REQUIRED'}
 $info=[Diagnostics.ProcessStartInfo]::new([string]$inputSpec.executable)
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 foreach($argument in $inputSpec.args){$info.ArgumentList.Add([string]$argument)}
 $child=[Diagnostics.Process]::Start($info)
 $stdoutCopy=$child.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
 $stderrCopy=$child.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
 $null=$child.Handle
 $started=$child.StartTime.ToUniversalTime().ToString('o')
 $child.WaitForExit();$code=$child.ExitCode
 # WaitForExit may precede Job accounting removal of that same child.
 # Reconcile only the known exited child; unknown descendants never get grace.
 # This bound is inside the caller's unchanged 30-second process timeout.
 $accounting=[Diagnostics.Stopwatch]::StartNew();$samples=@();$settled=$false
 do {
  $active=[VerifierJob]::Active();$members=@([VerifierJob]::Members())
  $samples+=@{active=$active;members=$members;child_exited=$child.HasExited}
  $unknown=@($members|Where-Object {$_ -ne $PID -and $_ -ne $child.Id})
  if($unknown.Count -gt 0){break}
  if($active -eq 1 -and $members.Count -eq 1 -and $members[0] -eq $PID -and $child.HasExited){$settled=$true;break}
  if(-not $child.HasExited -or $accounting.ElapsedMilliseconds -ge 100){break}
  [Threading.Thread]::Sleep(5)
 } while($true)
 [Console]::Error.WriteLine(('WINDOWS_VERIFIER_JOB_ACCOUNTING '+(@{samples=$samples;settled=$settled;elapsed_ms=$accounting.ElapsedMilliseconds}|ConvertTo-Json -Depth 5 -Compress)))
 [Console]::Error.WriteLine(('WINDOWS_VERIFIER_JOB '+(@{host_pid=$PID;child_pid=$child.Id;child_started_at=$started;finished_at=[DateTimeOffset]::UtcNow.ToString('o');child_exit=$code;active_processes=$active}|ConvertTo-Json -Compress)))
 if(-not $settled){[Console]::Error.WriteLine('VERIFIER_DESCENDANTS_REMAIN');[VerifierJob]::Abort();exit 125}
 [Threading.Tasks.Task]::WhenAll([Threading.Tasks.Task[]]@($stdoutCopy,$stderrCopy)).GetAwaiter().GetResult()
 $child.Dispose()
 exit $code
} catch {
 [Console]::Error.WriteLine(('WINDOWS_VERIFIER_JOB_FAILED: '+$_.Exception.Message))
 exit 125
}
