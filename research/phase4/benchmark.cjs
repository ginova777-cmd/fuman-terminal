'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {Consumer,frame}=require('./consumer.cjs'),fixtures=require('./fixtures.cjs');
const {strategy3,telegram,sha}=require('./original-adapters.cjs');
const date='2026-10-06',identity='BENCHMARK_FIXTURE',epoch='BENCHMARK_EPOCH',asOf=date+'T13:00:00+08:00';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phase4-capacity-'));
const memory=[];function sample(stage){memory.push({stage,...process.memoryUsage(),max_rss_kib:process.resourceUsage().maxRSS});}
async function measure(fn){const cpu=process.cpuUsage(),start=performance.now();const out=await fn();return {out,elapsed_ms:performance.now()-start,cpu_us:process.cpuUsage(cpu)};}
async function main(){
 const rows=[];
 for(const count of [1,128,500,2000]){
  sample('before_'+count);const symbols=Array.from({length:count},(_,i)=>String(1000+i));
  const c=new Consumer({directory:path.join(dir,String(count)),tradeDate:date,identity,epoch});
  const make=(sequence,events)=>frame({epoch,identity,trade_date:date,sequence,status:'DURABLE_COMMITTED',as_of:asOf,events});
  const gate=fixtures.gate(identity),backfill=s=>({symbol:s,identity,trade_date:date,complete:true,data:fixtures.data(s)});
  const initial=await measure(()=>c.process(make(1,symbols.map(symbol=>({kind:'ADMIT',symbol}))),{gate,backfill}));sample('admitted_'+count);
  const changed=symbols.slice(0,Math.min(10,count));
  const delta=await measure(()=>c.process(make(2,changed.map(symbol=>({kind:'CANDLE',symbol,payload:{...c.state.symbols[symbol].current.at(-1),volume_raw:100}}))),{gate}));sample('delta_'+count);
  const full=await measure(async()=>({s3:await strategy3(c.state,symbols,gate),tg:telegram(c.state,symbols,asOf)}));sample('full_'+count);
  assert.deepEqual(Object.values(c.state.strategy).sort((a,b)=>a.rank-b.rank),full.out.s3.results);
  for(const symbol of changed)assert.deepEqual(c.state.telegram[symbol],full.out.tg.filter(x=>x.symbol===symbol));
  rows.push({symbols:count,bars_per_symbol:22,stored_bars:22*count,changed_symbols:changed.length,initial_ms:initial.elapsed_ms,incremental_ms:delta.elapsed_ms,full_formula_ms:full.elapsed_ms,incremental_cpu_us:delta.cpu_us,full_formula_cpu_us:full.cpu_us,state_bytes:fs.statSync(c.file).size,delta_state_bytes_written:delta.out.state_bytes,formula_parity:'PASS'});
 }
 const receipt={status:'PASS_FOR_MEASURED_FIXTURES',fixture_only:true,rows,memory,peak_rss_kib:process.resourceUsage().maxRSS,heap_peak_sampled:Math.max(...memory.map(m=>m.heapUsed)),limitations:['full-formula baseline excludes persistence; incremental includes entire atomic state write, not like-for-like runtime benchmark','22 bars/symbol; no claim for 2500 symbols x 20-day history','no disk hardware I/O counters; exact state bytes written only','timings single samples; no natural production latency claim'],fixture_directory:dir};
 fs.writeFileSync(path.join(__dirname,'evidence/capacity.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:receipt.status,rows,peak_rss_kib:receipt.peak_rss_kib}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
