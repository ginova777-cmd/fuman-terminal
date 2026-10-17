param([Parameter(Mandatory)][string]$Executable,[Parameter(Mandatory)][string]$ArgumentsBase64,[Parameter(Mandatory)][string]$WorkingDirectory,[Parameter(Mandatory)][int]$TimeoutMilliseconds,[Parameter(Mandatory)][string]$ResultFile,[long]$DeadlineEpochMilliseconds=0)
$ErrorActionPreference='Stop'
if($TimeoutMilliseconds -le 0){throw 'cleanup_deadline_expired'}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Threading;
public static class CleanupJob {
 [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO { public int cb; public IntPtr reserved,desktop,title; public int x,y,xSize,ySize,xChars,yChars,fill,flags; public short show,reserved2; public IntPtr reservedPtr,input,output,error; }
 [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public uint pid,tid; }
 [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long processTime,jobTime; public uint flags; public UIntPtr minWorking,maxWorking; public uint activeLimit; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
 [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
 [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING { public long user,kernel,periodUser,periodKernel; public uint faults,total,active,terminated; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attr,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int cls,ref EXTENDED_LIMIT info,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int cls,out ACCOUNTING info,uint size,IntPtr len);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFO si,out PROCESS_INFORMATION pi);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 public class Result { public uint pid; public bool timedOut; public bool treeStopped; public uint activeProcesses; public uint exitCode; public long elapsedMs; }
 static Exception Error(string step){return new Exception(step+":"+Marshal.GetLastWin32Error());}
 static string Quote(string s){var b=new StringBuilder("\"");int slashes=0;foreach(char c in s){if(c=='\\'){slashes++;continue;}if(c=='"'){b.Append('\\',slashes*2+1);b.Append(c);}else{b.Append('\\',slashes);b.Append(c);}slashes=0;}b.Append('\\',slashes*2);b.Append('"');return b.ToString();}
 static uint Active(IntPtr job){ACCOUNTING a;if(!QueryInformationJobObject(job,1,out a,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero))throw Error("query_job");return a.active;}
 public static Result Run(string executable,string[] args,string cwd,int timeout){
  IntPtr job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)throw Error("create_job");
  PROCESS_INFORMATION pi=new PROCESS_INFORMATION();bool assigned=false;var clock=Stopwatch.StartNew();
  try{
   var limits=new EXTENDED_LIMIT();limits.basic.flags=0x2000;
   if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))))throw Error("set_job_limits");
   var si=new STARTUPINFO();si.cb=Marshal.SizeOf(typeof(STARTUPINFO));si.flags=0x100;si.input=GetStdHandle(-10);si.output=GetStdHandle(-11);si.error=GetStdHandle(-12);
   var command=new StringBuilder(Quote(executable));foreach(string arg in args)command.Append(" ").Append(Quote(arg));
   if(!CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref si,out pi))throw Error("create_suspended");
   if(!AssignProcessToJobObject(job,pi.process))throw Error("assign_job");assigned=true;
   if(ResumeThread(pi.thread)==0xffffffff)throw Error("resume_process");
   bool timedOut=false;
   while(Active(job)>0){if(clock.ElapsedMilliseconds>=timeout){timedOut=true;if(!TerminateJobObject(job,124))throw Error("terminate_job");break;}Thread.Sleep(20);}
   long stopDeadline=clock.ElapsedMilliseconds+5000;while(Active(job)>0&&clock.ElapsedMilliseconds<stopDeadline)Thread.Sleep(20);
   uint active=Active(job),code;if(active!=0)throw new Exception("cleanup_tree_stop_unverified");if(!GetExitCodeProcess(pi.process,out code))throw Error("exit_code");
   return new Result{pid=pi.pid,timedOut=timedOut,treeStopped=true,activeProcesses=active,exitCode=timedOut?124:code,elapsedMs=clock.ElapsedMilliseconds};
  }finally{if(pi.process!=IntPtr.Zero&&!assigned)TerminateProcess(pi.process,125);CloseHandle(job);if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread);if(pi.process!=IntPtr.Zero)CloseHandle(pi.process);}
 }
}
'@
try {
 if($DeadlineEpochMilliseconds -gt 0){$TimeoutMilliseconds=[int][Math]::Min($TimeoutMilliseconds,$DeadlineEpochMilliseconds-[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds());if($TimeoutMilliseconds -le 0){throw 'cleanup_deadline_expired_before_spawn'}}
 $values=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ArgumentsBase64)) | ConvertFrom-Json
 $result=[CleanupJob]::Run($Executable,[string[]]@($values),$WorkingDirectory,$TimeoutMilliseconds)
 $result | ConvertTo-Json -Compress | Set-Content -LiteralPath $ResultFile -Encoding utf8
 exit ([int]$result.exitCode)
} catch {
 @{exitCode=125;treeStopped=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress | Set-Content -LiteralPath $ResultFile -Encoding utf8
 throw
}
