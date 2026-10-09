'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const {createOracle}=require('./original-oracle.cjs'),{IncrementalDiscovery}=require('./incremental-discovery.cjs'),{fixture,quote,asOf}=require('./fixture.cjs');
if(process.argv[2]==='--child') {
 const mode=process.argv[3],count=Number(process.argv[4]),oracle=createOracle({memoize:mode!=='full'}),engine=new IncrementalDiscovery({oracle});
 const baseline=fixture(count),baselineBytes=Buffer.byteLength(JSON.stringify(baseline));engine.baseline(baseline);
 const cpu=process.cpuUsage(),r0=process.resourceUsage(),samples=[],latency=[],metricCalls=[],eventBytes=[];
 for(let i=0;i<8;i++) {
  const time=mode==='clock-change'?new Date(Date.parse(asOf)+i*1000).toISOString():asOf;
  const batch={epoch:baseline.epoch,tradeDate:baseline.tradeDate,sequence:i+1,continuity:'CONTIGUOUS',asOf:time,events:i?[{resource:'quoteMap',symbol:'1000',value:quote('1000',100+i,10000+i,time)}]:[]};
  eventBytes.push(Buffer.byteLength(JSON.stringify(batch)));
  const start=performance.now(),result=engine.process(batch);latency.push(performance.now()-start);
  if(result.status!=='OFFLINE_EVALUATED')throw Error(result.reason);
  metricCalls.push(result.output.metrics.metric_calls);samples.push(process.memoryUsage());
 }
 const resource=process.resourceUsage(),cpuUsed=process.cpuUsage(cpu),sorted=latency.slice(1).sort((a,b)=>a-b),q=p=>sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)];
 console.log(JSON.stringify({mode,count,iterations:8,warmup_ms:latency[0],latency_ms:{n:sorted.length,p50:q(.5),p95:q(.95),p99:q(.99),max:sorted.at(-1)},metric_calls:metricCalls,cpu_ms:{user:cpuUsed.user/1000,system:cpuUsed.system/1000},rss_peak_MiB:resource.maxRSS/1024,sampled_heap_peak_MiB:Math.max(...samples.map(s=>s.heapUsed))/1048576,sampled_heap_total_peak_MiB:Math.max(...samples.map(s=>s.heapTotal))/1048576,heap_peak_scope:'post-evaluation samples; not continuous heap high-water',filesystem_blocks_read:resource.fsRead-r0.fsRead,filesystem_blocks_written:resource.fsWrite-r0.fsWrite,baseline_bytes:baselineBytes,update_bytes:eventBytes,oracle_source_bytes_read:oracle.audit.source_bytes_read,limits:engine.limits,production_data:false}));
} else {
 const results=[];
 for(const count of [2000,5000])for(const mode of ['full','same-asof-memo','clock-change']) {
  const child=spawnSync(process.execPath,[__filename,'--child',mode,String(count)],{encoding:'utf8',timeout:120000,windowsHide:true,maxBuffer:1024*1024});
  if(child.status!==0)throw Error(child.stderr||child.error?.message||'benchmark failed');results.push(JSON.parse(child.stdout));
 }
 const report={generated_at:new Date().toISOString(),scope:'synthetic isolated full-universe process comparison',results,limitations:['Every update still clones full input state and rebuilds global rank/allocation.','Time change invalidates every quoteMetrics result; not a claimed every-minute speedup.','No production I/O or network measured. Filesystem counters are OS blocks, not bytes.','This is not the formal Collector/Writer performance profile.']};
 fs.mkdirSync(path.join(__dirname,'receipts'),{recursive:true});fs.writeFileSync(path.join(__dirname,'receipts/capacity.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
