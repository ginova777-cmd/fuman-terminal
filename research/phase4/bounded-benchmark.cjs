'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {Consumer,frame}=require('./consumer.cjs'),fixtures=require('./fixtures.cjs');
const {strategy3,telegram,sha}=require('./original-adapters.cjs');
async function main(){
 const date='2026-10-06',identity='BOUNDED_BENCH_FIXTURE',epoch='fixture',asOf=date+'T13:00:00+08:00',symbols=Array.from({length:256},(_,i)=>String(1000+i));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'phase4-bounded-'));
 const c=new Consumer({directory,tradeDate:date,identity,epoch}),gate=fixtures.gate(identity);
 const f=(sequence,events)=>frame({epoch,identity,trade_date:date,sequence,status:'DURABLE_COMMITTED',as_of:asOf,events});
 const initial=performance.now();await c.process(f(1,symbols.map(symbol=>({kind:'ADMIT',symbol}))),{gate,backfill:s=>({symbol:s,trade_date:date,identity,complete:true,data:fixtures.data(s)})});const initial_ms=performance.now()-initial;
 const cpu=process.cpuUsage(),start=performance.now();const delta=await c.process(f(2,symbols.slice(0,10).map(symbol=>({kind:'CANDLE',symbol,payload:{...c.state.symbols[symbol].current.at(-1),volume_raw:100}}))),{gate});const incremental_ms=performance.now()-start,incremental_cpu_us=process.cpuUsage(cpu);
 const startFull=performance.now();const full=await strategy3(c.state,symbols,gate),tg=telegram(c.state,symbols,asOf);const full_formula_ms=performance.now()-startFull;
 assert.deepEqual(Object.values(c.state.strategy).sort((a,b)=>a.rank-b.rank),full.results);for(const s of symbols.slice(0,10))assert.deepEqual(c.state.telegram[s],tg.filter(x=>x.symbol===s));
 const receipt={status:'BOUNDED_FIXTURE_PASS',symbols:256,bars:5632,changed_symbols:10,initial_ms,incremental_ms,incremental_cpu_us,full_formula_ms,state_bytes:delta.state_bytes,memory:process.memoryUsage(),peak_rss_kib:process.resourceUsage().maxRSS,memoized_formatter:true,adapter_sha256:sha(fs.readFileSync(path.join(__dirname,'original-adapters.cjs'))),native_unmemoized_baseline:'capacity.json',measurement_scope:'256-symbol isolated fixture; no 2000-symbol optimized capacity claim',natural:false,production:false};
 fs.writeFileSync(path.join(__dirname,'evidence/bounded-capacity.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
