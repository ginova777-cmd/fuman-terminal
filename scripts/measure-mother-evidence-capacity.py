import ctypes, json, os, pathlib, subprocess, time, sys
from ctypes import wintypes
OUT=pathlib.Path(sys.argv[1]).resolve(); OUT.mkdir(parents=True, exist_ok=False)
INPUT=pathlib.Path(sys.argv[2]).resolve()
ROOT=pathlib.Path(__file__).resolve().parent.parent
SHA=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
SOURCE_HASHES={str(f.relative_to(ROOT)):__import__('hashlib').sha256(f.read_bytes()).hexdigest() for folder in ('lib','scripts') for f in (ROOT/folder).glob('*evidence*.cjs')}
(OUT/'source-hashes.json').write_text(json.dumps(SOURCE_HASHES,indent=2))
MIB=1024*1024
class Memory(ctypes.Structure):
    _fields_=[('length',wintypes.DWORD),('load',wintypes.DWORD)]+[(n,ctypes.c_ulonglong) for n in ('total','available','page_total','page_available','virtual_total','virtual_available','extended')]
def free_memory():
    m=Memory();m.length=ctypes.sizeof(m);ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m));return m.available
class Counters(ctypes.Structure):
    _fields_=[('cb',wintypes.DWORD),('faults',wintypes.DWORD)]+[(n,ctypes.c_size_t) for n in ('peak_working','working','peak_paged','paged','peak_nonpaged','nonpaged','page','peak_page','private')]
k=ctypes.windll.kernel32;k.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];k.OpenProcess.restype=wintypes.HANDLE
k.CloseHandle.argtypes=[wintypes.HANDLE]
papi=ctypes.windll.psapi;papi.GetProcessMemoryInfo.argtypes=[wintypes.HANDLE,ctypes.POINTER(Counters),wintypes.DWORD]
def rss(handle):
    c=Counters();c.cb=ctypes.sizeof(c)
    return (c.working,c.peak_working) if papi.GetProcessMemoryInfo(handle,ctypes.byref(c),c.cb) else (0,0)
limits=dict(maxEvents=1024,maxBytes=4194304,maxBatchEvents=128,maxBatchBytes=524288,maxAgeMs=15000,minFreeBytes=1048576,maxDiskBytes=67108864)
cases=[dict(name='quote-recovery',mode='recovery',kind='quote',input=str(INPUT/'quote-cache.json')),dict(name='candle-recovery',mode='recovery',kind='candle',input=str(INPUT/'candle-cache.json'))]
for n in (0,1,32,128,129,1024,4900,5000):cases.append(dict(name=f'recent-{n}',mode='batch',kind='candle',input=str(INPUT/'batch-recent.json'),rows=n))
for cohort in ('first','largest'):cases.append(dict(name=f'{cohort}-5000',mode='batch',kind='candle',input=str(INPUT/f'batch-{cohort}.json'),rows=5000))
summary=[]
for case in cases:
    case.update(root=str(ROOT),sha=SHA,limits=limits)
    dest=OUT/case['name'];dest.mkdir(exist_ok=False);case['dir']=str(dest)
    conf=dest/'config.json';conf.write_text(json.dumps(case,indent=2),encoding='utf-8')
    free=free_memory();record=dict(name=case['name'],available_before=free,process_rss_guard=512*MIB,host_reserve=256*MIB)
    if free<768*MIB:
        record.update(status='BLOCKED',reason='HOST_MEMORY_HEADROOM',peak_rss_bytes=None,elapsed_ms=0)
    else:
        start=time.monotonic();peak=0;reason=None
        with (dest/'stdout.log').open('wb') as stdout,(dest/'stderr.log').open('wb') as stderr:
            proc=subprocess.Popen(['node','--trace-gc-nvp',str(ROOT/'scripts/measure-mother-evidence-capacity.cjs'),str(conf)],stdout=stdout,stderr=stderr,creationflags=subprocess.CREATE_NO_WINDOW)
            handle=k.OpenProcess(0x410,False,proc.pid)
            while proc.poll() is None:
                working,maximum=rss(handle);peak=max(peak,maximum)
                if working>512*MIB:reason='ISOLATED_PROCESS_RSS_GUARD'
                elif free_memory()<256*MIB:reason='HOST_RESERVE_GUARD'
                elif time.monotonic()-start>45:reason='ISOLATED_TIMEOUT'
                if reason:
                    proc.terminate();proc.wait(timeout=5);break
                time.sleep(.01)
            peak=max(peak,rss(handle)[1]);k.CloseHandle(handle)
        record.update(process_exit_code=proc.returncode,elapsed_ms=(time.monotonic()-start)*1000,peak_rss_bytes=peak,peak_rss_scope='Windows PeakWorkingSetSize: isolated runner and all its threads')
        result=dest/'result.json'
        if result.exists():
            r=json.loads(result.read_text());record.update(status=r['status'],worker_error=r.get('error'),peak_heap_observed_bytes=r['peak_heap_observed_bytes'])
            record['peak_rss_bytes']=max(peak,r['process_peak_rss_bytes'])
            final=next((e for e in reversed(r['events']) if e['stage'] in ('complete','error')),None)
            record['result']=final
        else:record.update(status='BLOCKED',reason=reason or 'ISOLATED_PROCESS_EXIT_NO_RECEIPT',peak_heap_observed_bytes=None)
        if reason:record.update(status='BLOCKED',reason=reason)
    (dest/'os-monitor.json').write_text(json.dumps(record,indent=2),encoding='utf-8');summary.append(record)
    print(json.dumps({k:record.get(k) for k in ('name','status','reason','worker_error','peak_rss_bytes','peak_heap_observed_bytes','elapsed_ms')}),flush=True)
(OUT/'capacity-results.json').write_text(json.dumps(dict(rc_sha=SHA,mode='READ_ONLY_COPIES_ISOLATED_WORKERS',limits_scope='RC has no approved activation limits; unchanged offline reference limits used',reference_limits=limits,natural_shadow='NO_GO',phase2='NOT_AUTHORIZED',cases=summary),indent=2),encoding='utf-8')
