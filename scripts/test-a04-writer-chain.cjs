'use strict';
// Artificial fixture; disk-backed RPC boundary. Never a formal DB receipt.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {fixture,refresh}=require('./test-a04-owner-decision.cjs');
const consumer=require('../lib/a04-warmup-consumer.cjs');
const ackVerifier=require('../lib/daytrade-module-write-ack');
const mode=process.argv[2]||'normal',root=process.env.A04_TEST_WRITE_ROOT;
if(!root)throw Error('ISOLATED_ROOT_REQUIRED');
fs.mkdirSync(root,{recursive:true});
const put=(file,value)=>{const dest=path.join(root,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(value));};
const get=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const f=fixture();f.identity.canonical_run_id='fugle_daytrade_source:20261013:canonical';f.raw.rows[14].volume_lots=250;f.raw.rows[14].close=107;refresh(f);
const options={now:f.asOf,trustedBinding:f.trustedBinding};
function collector(payload,now=f.asOf){
 const src=fs.readFileSync(require.resolve('./fugle-websocket-collector'),'utf8');
 const code=src.slice(src.indexOf('function readPrioritySymbols(symbols)'),src.indexOf('function currentTaipeiDate()'));
 const RealDate=Date;class Clock extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return RealDate.parse(now);}}
 const ctx={Date:Clock,readJson:()=>payload,PRIORITY_SYMBOLS_FILE:'priority',COLLECTOR_ROLE:'daytrade',taipeiDate:()=>new Clock().toISOString().slice(0,10),canonicalDaytradeRunId:()=>f.identity.canonical_run_id,normalizeCode:String,require:name=>{assert.equal(name,'../lib/a04-warmup-consumer.cjs');return {read:(p,o)=>consumer.read(p,{...o,trustedBinding:f.trustedBinding})};}};
 vm.runInNewContext(code,ctx);return ctx.readPrioritySymbols(['2330','2317']);
}
function readback(){const doc=get('db/document.json'),rounds=get('db/rounds.json'),rows=get('db/rows.json');return ackVerifier.verify(doc,rounds,rows);}
async function main(){
 if(mode==='restart-read'){
  const proof=readback();assert(proof.committed);const payload=get('priority.json');assert.deepEqual(Array.from(collector(payload).a04WarmupOnly.symbols),['2330']);
  assert.equal(collector(payload,'2026-10-13T09:16:00+08:00').a04WarmupOnly.symbols.length,0);
  payload.mother_pool_snapshot_sequence++;assert.equal(collector(payload).a04WarmupOnly.symbols.length,0);
  console.log(JSON.stringify({mode,status:'PASS',proof:'disk_readback',process_id:process.pid,production_complete:false}));return;
 }
 if(mode==='crash-read'){
  assert.equal(readback().committed,true);assert(!get('priority.json').a04WarmupEvidence);assert(!fs.existsSync(path.join(root,'writer-result.json')));
  console.log(JSON.stringify({mode,status:'PASS',reason:'DB saved but no ACK publication after hard exit',process_id:process.pid,production_complete:false}));return;
 }
 const original={trade_date:f.identity.trade_date,canonical_run_id:f.identity.canonical_run_id,mother_pool_run_id:f.identity.mother_pool_run_id,mother_pool_snapshot_sequence:f.identity.snapshot_sequence,terminalPrioritySymbols:['2317'],openingPrioritySymbols:['2317'],daytradeCandlePrioritySymbols:['2317']};put('priority.json',original);
 if(mode==='missing-day')f.raw.rows.pop();
 if(mode==='wrong-day')f.raw.trade_date='2026-10-12';
 if(mode==='source-revision')f.value.historical_source_evidence.source_version='a'.repeat(40);
 if(mode==='expired')f.value.daily_ohlcv_read_at='2026-10-13T08:00:00+08:00';
 const inputSource=require('./test-mother-identity-source').fixture();
 const text=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8');
 const start=text.indexOf('  let initialSourcePublication = null;'),end=text.indexOf('  writeModuleProducerReceipts',start);assert(start>0&&end>start);
 let rpcCalls=0,sourceCalls=0;
 const result={payload:{writer_run_id:f.identity.writer_run_id,generation_id:f.identity.generation_id}};
 const ctx={Buffer,console,AbortSignal,moduleWorkIds:()=>['A04'],isolatedModules:null,isolatedTradeJournal:null,result,sideMinutes:525,sideAsOf:f.asOf,
  sideSnapshot:require('./test-mother-ma20').snapshot(f.identity,f.symbols,f.asOf),marketCalendarEvidence:inputSource.calendar,writerLease:inputSource.lease,
  quoteMap:new Map(),intradayMap:new Map(),preopenTrialHistory:{rows:[],readback:null},dailyVolumeMap:f.dailyVolumeMap,
  activeSymbols:Object.assign(require('./test-mother-daytrade-ratio').fixture().activeSymbols,{sourceEvidence:require('./test-mother-eligibility-source').fixture().evidence}),officialDaytradeSource:require('./test-mother-daytrade-ratio').fixture().officialSource,
  taipeiDate:()=>f.identity.trade_date,nowIso:()=>f.asOf,fs,path,runtimePath:(...a)=>path.join(root,...a),DRY_RUN:false,
  STRATEGY_PRIORITY_BRIDGE_CACHE_FILE:'bridge',FUGLE_WS_STATUS_FILE:'websocket',PRIORITY_SYMBOLS_FILE:path.join(root,'priority.json'),SUPABASE_URL:'http://isolated.invalid',headers:()=>({}),requireSupabaseKey:()=> 'TEST_ONLY',SUPABASE_WRITE_TIMEOUT_MS:1000,
  readJson:(file,fallback)=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback,
  writeJson:(file,value)=>fs.writeFileSync(file,JSON.stringify(value)),readFugleWebSocketCandles:()=>assert.fail('preopen must not read live candles'),
  writeStatusAndScorecard:async()=>{sourceCalls++;assert(result.payload.module_input_checkpoint);assert.equal(rpcCalls,0);},
  require:name=>{
   if(name==='../lib/mother-pool-historical-volume-price')return {collect:i=>require(name).collect(i,mode==='unbound'?undefined:f.trustedBinding)};
   if(name==='../lib/a04-warmup-consumer.cjs')return {attach:(p,w,o)=>consumer.attach(p,w,{...o,trustedBinding:mode==='unbound'?undefined:f.trustedBinding})};
   return require(name);
  },
  fetch:async(url,request)=>{
   assert(new URL(url).hostname==='isolated.invalid');rpcCalls++;
   const body=JSON.parse(request.body),plan=JSON.parse(body.p_plan??body.p_pieces.map(x=>typeof x==='number'?body.p_dictionary[x]:x).join('')),doc={...JSON.parse(body.p_metadata),plan};
   assert.equal(doc.module_id,'A04');const id={module_id:doc.module_id,trade_date:doc.trade_date,writer_run_id:doc.writer_run_id};
   put('db/document.json',doc);put('db/rounds.json',[{...id,document:doc,committed_at:f.asOf}]);put('db/rows.json',plan.rows.map(evidence=>({...id,symbol:evidence.symbol,evidence})));
   if(mode==='crash-after-db')process.exit(73);
   const ack=readback();put('db/readback-ack.json',ack);
   if(mode==='bad-ack')ack.plan_hash='wrong';
   return {ok:true,status:200,json:async()=>ack};
  }
 };
 let error=null;try{await vm.runInNewContext('(async()=>{'+text.slice(start,end)+'})()',ctx);}catch(e){error=e.message;}
 put('writer-result.json',{...result,error});assert.equal(sourceCalls,1);assert.equal(rpcCalls,1);
 const payload=get('priority.json'),selection=collector(payload);put('collector-result.json',selection);
 for(const key of Object.keys(original))assert.deepEqual(payload[key],original[key]);
 if(mode==='normal'){
  assert.equal(error,null);assert.equal(result.payload.a04_warmup_publication_error,undefined);assert.equal(result.payload.module_persistence_errors.length,1); // unrelated missing A08/A09 preopen evidence
  assert.deepEqual(Array.from(selection.a04WarmupOnly.symbols),['2330']);assert.equal(selection.a04WarmupOnly.candidates[0].hits.length,3);
  assert.equal(require('../lib/verify-mother-pool-module-round').createVerifier('A04').validRound(result.payload.module_write_sets.A04),false);
  const bad=structuredClone(payload);bad.a04WarmupEvidence.write_set.plan.rows[0].raw_daily_evidence.rows[14].volume_lots++;
  assert.equal(collector(bad).a04WarmupOnly.symbols.length,0);
  const savedRows=get('db/rows.json');savedRows[0].evidence.source='drift';put('db/rows.json',savedRows);assert.throws(readback,/CONTENT/);
  savedRows[0].evidence.source='strategy4_daily_ohlcv_view';put('db/rows.json',savedRows);
 }else assert.equal(selection.a04WarmupOnly.symbols.length,0);
 console.log(JSON.stringify({mode,status:'PASS',scope:'REAL_WRITER_MODULE_PHASE_TO_DISK_RPC_TO_PRIORITY_TO_REAL_COLLECTOR_TO_VERIFIER',rpcCalls,sourceCalls,process_id:process.pid,production_complete:false}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
