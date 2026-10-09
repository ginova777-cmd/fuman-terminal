'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const I=require('./incremental-writer.cjs'),{fingerprint}=require('../../lib/daytrade-candle-delta.js'),{sha}=require('../../lib/mother-change-evidence.cjs');
const tradeDate='2026-10-06',nowMs=Date.parse(tradeDate+'T05:30:00Z'),options={tradeDate,nowMs,cacheUpdatedAt:new Date(nowMs).toISOString()};
const row=i=>({symbol:String(1000+i%1000),market:'TSE',tradeDate,candleTime:new Date(Date.parse(tradeDate+'T01:00:00Z')+Math.floor(i/1000)*60000).toISOString(),candleSeenAt:options.cacheUpdatedAt,open:100,high:102,low:99,close:101,volume:10,source:'fugle-ws-candles',sourceChannel:'candles',candleOrigin:'websocket_candle',intradayOddLot:false,restRepairRow:false,synthetic:false,volumeStrategyUsable:true});
if(process.argv[2]==='child'){
 const [mode,file]=process.argv.slice(3),cpu=process.cpuUsage(),t=performance.now(),bytes=fs.readFileSync(file),parsed=JSON.parse(bytes),rows=I.writerRows(parsed,options),elapsed=performance.now()-t;
 console.log(JSON.stringify({mode,rows:rows.length,input_bytes:bytes.length,output_bytes:Buffer.byteLength(JSON.stringify(rows)),elapsed_ms:elapsed,cpu_us:process.cpuUsage(cpu),peak_rss_bytes:process.resourceUsage().maxRSS*1024,heap_used_bytes:process.memoryUsage().heapUsed,heap_peak:'UNAVAILABLE',physical_io:'UNAVAILABLE',output_fingerprint:sha(rows.map(fingerprint))}));
}else{
 const out=path.resolve(process.argv[2]||path.join(__dirname,'evidence')),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mp-phase2-bench-')),results=[];fs.mkdirSync(out,{recursive:true});
 for(const count of [5000,20000]){
 const original=Array.from({length:count},(_,i)=>row(i)),changes=original.slice(0,32).map(r=>({...r,volume:20})),updated=[...changes,...original.slice(32)];
 const full=path.join(tmp,count+'-full.json'),inc=path.join(tmp,count+'-delta.json');fs.writeFileSync(full,JSON.stringify(updated));fs.writeFileSync(inc,JSON.stringify(changes));
 const base=new Map(I.writerRows(original,options).map(r=>[r.symbol+'|'+r.candle_time,r]));for(const r of I.writerRows(changes,options))base.set(r.symbol+'|'+r.candle_time,r);const target=new Map(I.writerRows(updated,options).map(r=>[r.symbol+'|'+r.candle_time,r]));assert.deepEqual([...base].sort().map(([k,r])=>[k,fingerprint(r)]),[...target].sort().map(([k,r])=>[k,fingerprint(r)]));
 const runs=[];for(const [mode,file]of [['full',full],['incremental',inc]]){const c=spawnSync(process.execPath,['--max-old-space-size=128',__filename,'child',mode,file],{encoding:'utf8',timeout:30000});if(c.status!==0)throw Error(c.stderr||'BENCH_FAILED');runs.push(JSON.parse(c.stdout));}results.push({full_cache_rows:count,changed_rows:32,materialized_content_parity:true,runs});}
 fs.writeFileSync(path.join(out,'capacity.json'),JSON.stringify({status:'PASS_ISOLATED_MAPPING_ONLY',results,scope:'real mapNaturalCandle + writer row wrapper; generated fixtures; not full Writer or natural throughput',limits:{child_heap_mb:128,child_timeout_ms:30000},excluded_costs:['retained evidence independent audit','baseline recovery','DB','priority/source_status/futopt','checkpoint fsync','production cache size 188541'],fixture_dir:tmp},null,2));console.log(JSON.stringify(results));
}
