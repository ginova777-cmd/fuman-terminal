'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const realIo=require('../lib/mother-pool-a16-io');
const script=fs.readFileSync(path.join(__dirname,'warm-mother-pool-a16.js'),'utf8');
const date='2026-09-29',canonical='fugle_daytrade_source:20260929:canonical';
async function scenario(mode){
 const memory=new Map(),runtime='C:/isolated-a16-test',universe={trade_date:date,canonical_run_id:canonical,symbols:['1301','1303']};
 const dir=path.join(runtime,'data','mother-pool-a16',date),planFile=path.join(dir,'session-plan.json');
 const raw='calendar',digest=x=>crypto.createHash('sha256').update(x).digest('hex');
 const plan={status:'SESSION_DATES_VERIFIED',trade_date:date,sources:[{file:'calendar',sha256:digest(raw)}],checks:[],session_dates:[],checked_at:'2026-09-29T00:00:00Z'};
 memory.set(planFile,JSON.stringify(plan));memory.set('calendar',raw);memory.set('universe',universe);
 for(const symbol of universe.symbols)memory.set(path.join(runtime,'data','mother-pool-historical-minutes',date,symbol+'.json'),{calendar:{sha256:digest(JSON.stringify(plan))},symbol,trade_date:date,result:{status:'HISTORY_FETCHED'}});
 let writes=0,reads=0,clock='2026-09-29T00:00:00Z';
 const io={...realIo,read:f=>{if(!memory.has(f))throw Error('missing');const x=memory.get(f);return typeof x==='string'?JSON.parse(x):structuredClone(x);},atomic:(f,x)=>memory.set(f,structuredClone(x)),readSide:(_r,s)=>{if(mode==='corrupt'&&s==='1301')throw Error('A16_JOURNAL_JSON_INVALID:1301:line=2');return {};},client:()=>({writeReadback:async r=>{writes++;if(mode==='timeout')throw Error('timeout');return {db_readback_ok:true,anon_readback_ok:mode!=='missing-anon',written_count:mode==='partial-count'?1083:r.rows.length,readback_count:r.rows.length,payload_sha256:realIo.hash(realIo.compact(r)),readback_contract:'a16_db_anon_v2'};},verifyReadback:async r=>{reads++;return {db_readback_ok:true,anon_readback_ok:mode!=='missing-anon',written_count:mode==='partial-count'?1083:r.rows.length,readback_count:r.rows.length,payload_sha256:realIo.hash(realIo.compact(r)),readback_contract:'a16_db_anon_v2'};}})};
 const fakeFs={mkdirSync(){},existsSync:f=>memory.has(f),readFileSync:f=>f.includes('secrets')?'fake-key':memory.get(f),openSync:f=>{if(memory.has(f))throw Error('locked');memory.set(f,'lock');return f;},writeFileSync:(f,x)=>memory.set(f,x),closeSync(){},unlinkSync:f=>memory.delete(f)};
 const deps={
  'node:fs':fakeFs,'node:path':path,'node:crypto':crypto,'node:child_process':{spawnSync:()=>({status:0})},
  '../lib/mother-pool-a16-io':io,
  '../lib/fetch-mother-pool-historical-minutes':{fetchHistory:async()=>{throw Error('unexpected refetch');}},
  '../lib/mother-pool-historical-sessions':{selectSessions:async()=>({status:'SESSION_DATES_VERIFIED',session_dates:[]})},
  './twse-trading-day':{isTwseTradingDay:async()=>({isTradingDay:true,source:'cache'})},
  '../lib/mother-pool-a16-baseline':{build:i=>({symbol:i.symbol,trade_date:date,canonical_run_id:canonical,calculated_at:i.asOf,rows:Array.from({length:1084},()=>({value:1})),requested_count:1084,complete:mode!=='sample-gap',first_blocker:mode==='sample-gap'?'INSUFFICIENT_SAMPLE':null})},
  '../lib/verify-mother-pool-a16':{verify:()=>({verification_passed:true,failed_checks:[]})},
 };
 async function run(){class Clock extends Date{constructor(...a){super(...(a.length?a:[clock]));}static now(){return Date.parse(clock);}}
  const proc={argv:['node','runner','--apply','--scheduled','--universe=universe'],env:{FUMAN_RUNTIME_DIR:runtime},execPath:'node',exitCode:0};
  await vm.runInNewContext(script,{require:n=>{if(!(n in deps))throw Error('Unexpected module '+n);return deps[n];},__dirname,process:proc,Date:Clock,console:{log(){},error(e){throw Error(e);}},setTimeout:f=>f()});
  return io.read(path.join(dir,'writer-summary.json'));
 }
 let result=await run();
 if(mode==='corrupt'){assert.equal(result.attempted_count,2);assert.equal(result.rows[0].db_readback_ok,false);assert.equal(result.rows[1].db_readback_ok,true);assert.equal(result.complete,false);}
 if(mode==='timeout'){assert.equal(result.attempted_count,1);assert.equal(result.complete,false);}
 if(['sample-gap','missing-anon','partial-count'].includes(mode)){assert.equal(result.attempted_count,2);assert.equal(result.complete,false);}
 if(mode==='ok'){assert.equal(result.complete,true);assert.equal(writes,2);clock='2026-09-29T00:01:00Z';result=await run();assert.equal(result.complete,true);assert.equal(writes,2);assert.equal(reads,2);}
}
(async()=>{for(const m of ['ok','corrupt','timeout','sample-gap','missing-anon','partial-count'])await scenario(m);console.log('PASS: actual A16 runner resume without rewrite, corrupt-symbol isolation, timeout stop, sample gaps retained');})().catch(e=>{console.error(e);process.exitCode=1;});
