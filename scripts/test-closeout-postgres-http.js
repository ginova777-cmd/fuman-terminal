'use strict';
// Actual isolated PostgreSQL, HTTP test adapter (not hosted PostgREST).
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {spawnSync,spawn}=require('node:child_process');
const {collect}=require('../lib/mother-pool-candle-module-producer');
const {persistModuleRound}=require('../lib/persist-mother-pool-module-round');
const {buildCloseout}=require('../lib/mother-pool-closeout-producer');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'mp-closeout-pg-'));
const psql='C:/Program Files/PostgreSQL/17/bin/psql.exe';
const lit=s=>"'"+String(s).replace(/'/g,"''")+"'";
function sql(query,role='service_role'){
 const p=spawnSync(psql,['-X','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55439','-U','mp_test','-d','postgres'],{input:'SET ROLE '+role+';\n'+query,encoding:'utf8',windowsHide:true,timeout:10000});
 if(p.status)throw Error(p.stderr);return JSON.parse(p.stdout.split(/\r?\n/).filter(x=>x&&x!=='SET').join('\n'));
}
const adapter={savePlan:async p=>fs.writeFileSync(path.join(runtime,p.module_id+'-'+p.writer_run_id.replace(/:/g,'_')+'-plan.json'),JSON.stringify(p),{flag:'wx'}),
 persist:async p=>sql(`SELECT public.persist_daytrade_module_round_v2(${lit(p.p_document)},${lit(p.p_plan)});`),saveEvidence:async()=>{}};
let injectGap=false;
const server=http.createServer((req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  assert.equal(url.pathname,'/rest/v1/v_daytrade_module_readback_v2');
  const role=req.headers.apikey==='test-anon'?'anon':req.headers.apikey==='test-service'?'service_role':null;if(!role){res.writeHead(401).end();return;}
  const fields=['module_id','trade_date','canonical_run_id','writer_run_id','generation_id','mother_pool_run_id','snapshot_generation','snapshot_sequence'];
  const where=fields.map(k=>{const v=url.searchParams.get(k);assert(v?.startsWith('eq.'));return k+'='+lit(v.slice(3));}).join(' AND ');
  let rows=sql(`SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY symbol),'[]'::jsonb) FROM public.v_daytrade_module_readback_v2 v WHERE ${where};`,role);
  if(injectGap)rows=rows.filter(r=>r.symbol!=='2330');
  const count=rows.length,offset=Number(url.searchParams.get('offset')),size=Number(url.searchParams.get('limit'));rows=rows.slice(offset,offset+size);
  res.writeHead(200,{'Content-Type':'application/json','Content-Range':rows.length?`${offset}-${offset+rows.length-1}/${count}`:`*/${count}`});res.end(JSON.stringify(rows));
 }catch(e){res.writeHead(500).end(JSON.stringify({error:e.message}));}
});
function run(script,args,env){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(__dirname,script),...args],{env:{...process.env,...env},windowsHide:true});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));});}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const env={FUMAN_RUNTIME:runtime,SUPABASE_URL:`http://127.0.0.1:${server.address().port}`,SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'test-service'};
 const date='2026-09-18',canonical='fugle_daytrade_source:20260918:canonical',suffix=Date.now();
 const capture=async (input,expectedExit=0)=>{
  const saved=await persistModuleRound(input,adapter),index=path.join(runtime,input.writer_run_id.replace(/:/g,'_')+'-index.json');
  fs.writeFileSync(index,JSON.stringify({modules:{[input.module_id]:saved}}));
  const args=['--modules='+input.module_id,'--write-set-index='+index,'--trade-date='+date,'--canonical='+canonical,'--writer-run-id='+input.writer_run_id,'--writer-generation-id='+input.generation_id,'--mother-pool-run-id='+input.mother_pool_run_id,'--snapshot-generation='+input.snapshot_generation,'--snapshot-sequence='+input.snapshot_sequence];
  const p=await run('capture-daytrade-module-readbacks.js',args,env);assert.equal(p.code,expectedExit,p.stderr+p.stdout);return {file:JSON.parse(p.stdout).results[0].file,args};
 };
 const captured=[],mappingCaptured=[],discoveryCaptured=[],unionCaptured=[],openingCaptured=[],allocationCaptured=[],fiveMinuteCaptured=[],combinationCaptured=[],identityCaptured=[],eligibilityCaptured=[],previousOhlcCaptured=[];
 let previousAllocation=null;
 const ma20Captured={A08:[],A09:[]};
 const priority5mCaptured=[];
 const websocketCaptured=[];
 const daytradeRatioCaptured=[],historicalGapCaptured=[];
 for(let i=1;i<=2;i++){
  const identity={trade_date:date,canonical_run_id:canonical,writer_run_id:`test:${suffix}:${i}`,generation_id:'g'+i,mother_pool_run_id:'s'+i,snapshot_generation:'s'+i,snapshot_sequence:i};
  const identityFixture=require('./test-mother-identity-source').fixture();
  Object.assign(identityFixture.identity,{generation_id:'a01g'+i,writer_run_id:`instance:20260918:a01g${i}`,mother_pool_run_id:'a01s'+i,snapshot_generation:'a01s'+i,snapshot_sequence:i});
  identityFixture.identity.writer_run_id=`instance-${suffix}:20260918:a01g${i}`;
  identityFixture.lease.instanceId=`instance-${suffix}`;identityFixture.lease.rpcEvidence.writer_instance_id=`instance-${suffix}`;
  identityFixture.asOf=date+`T06:0${i}:00+08:00`;
  identityCaptured.push(await capture(require('../lib/mother-pool-identity-source').collect(identityFixture)));
  const eligibilityFixture=require('./test-mother-eligibility-source').fixture();
  eligibilityFixture.identity={...identityFixture.identity};
  eligibilityFixture.asOf=identityFixture.asOf;
  eligibilityFixture.evidence.observed_at=identityFixture.asOf;
  eligibilityCaptured.push(await capture(require('../lib/mother-pool-eligibility-source').collect(eligibilityFixture)));
  const previousFixture=require('./test-mother-previous-ohlc').fixture();previousFixture.lockDirectory=path.join(runtime,'a15-day-lock');previousFixture.identity={...identityFixture.identity};previousFixture.asOf=identityFixture.asOf;
  previousOhlcCaptured.push(await capture(require('../lib/mother-pool-previous-ohlc').collect(previousFixture)));
  const websocketFixture=require('./test-mother-websocket-source').fixture();websocketFixture.identity={...identityFixture.identity};websocketFixture.asOf=identityFixture.asOf;websocketFixture.status.updatedAt=identityFixture.asOf;websocketFixture.status.websocketLastMessageAt=identityFixture.asOf;
  websocketCaptured.push(await capture(require('../lib/mother-pool-websocket-source').collect(websocketFixture)));
  const ratioFixture=require('./test-mother-daytrade-ratio').fixture();ratioFixture.identity={...identityFixture.identity};ratioFixture.asOf=identityFixture.asOf;
  daytradeRatioCaptured.push(await capture(require('../lib/mother-pool-daytrade-ratio').collect(ratioFixture)));
  historicalGapCaptured.push(await capture(require('../lib/mother-pool-historical-volume-price').collect(ratioFixture),1));
  const minute=26+i,asOf=`${date}T13:${minute+1}:01+08:00`;
  const candles=['1101','2330'].map(symbol=>({symbol,tradeDate:date,market:'TSE',source:'fugle-ws-candles',sourceChannel:'candles',candleOrigin:'websocket_candle',synthetic:false,volumeStrategyUsable:true,candleTime:`${date}T13:${minute}:00+08:00`,candleSeenAt:`${date}T13:${minute+1}:00+08:00`,open:100,high:102,low:99,close:101,volume:100}));
  const input=collect({candles,identity,symbols:['1101','2330'],asOf}).find(x=>x.module_id==='B01');captured.push(await capture(input));
  const openingBars=['1101','2330'].flatMap(symbol=>Array.from({length:5},(_,n)=>({...candles.find(x=>x.symbol===symbol),candleTime:`${date}T09:0${n}:00+08:00`,candleSeenAt:`${date}T09:0${n+1}:00+08:00`,high:102+n,low:99-n})));
  const openingPlan=collect({candles:[...openingBars,...candles],identity,symbols:['1101','2330'],asOf}).find(x=>x.module_id==='B22');
  openingCaptured.push(await capture(openingPlan));
  const allocationRows=Array.from({length:100},(_,n)=>({symbol:String(1000+n),payload:{formal_pool_eligible:true,warming_pending:false,hot_burst_fast_path:n===99,upgrade_score:100-n}}));
  const allocation=require('../lib/mother-pool-scan-allocation').apply(allocationRows,{identity,previous:previousAllocation,asOf});previousAllocation=allocation;
  const allocationPlan=require('../lib/mother-pool-allocation-producer').collect({identity,allocation,snapshot:{symbols:allocationRows.map(r=>r.symbol)},asOf});
  allocationCaptured.push(await capture(allocationPlan));
  const combinationFixture=require('./test-combination-independent').fixture(identity,i);
  combinationCaptured.push(await capture(require('../lib/mother-pool-combination-producer').collect(combinationFixture)));
  const fiveMinuteFixture=require('./test-five-minute-module').fixture(identity,45+i);
  fiveMinuteCaptured.push(await capture(require('../lib/mother-pool-five-minute-producer').collect(fiveMinuteFixture)));
  priority5mCaptured.push(await capture(require('../lib/mother-pool-five-minute-priority').collect(require('./test-five-minute-priority').fixture(identity,45+i))));
  const mappingPlan=require('../lib/mother-pool-industry-mapping-producer').collect({identity,asOf,discovery:{...identity,requested_symbols:['2454','3443'],mapping_rows:['2454','3443'].map(symbol=>({symbol,classification:require('./test-industry-mapping-module').classification(symbol)}))}});mappingCaptured.push(await capture(mappingPlan));
  const source=structuredClone(require('./test-discovery-source').row);source.source_evidence.quote_event_at=asOf;source.source_evidence.quote.payload.turnoverVolumeEvidence.event_at=asOf;
  const priorAt=new Date(Date.parse(asOf)-60000).toISOString(),priorIdentity={...identity,writer_run_id:identity.writer_run_id+':prior',generation_id:identity.generation_id+':prior'};
  const previous=await persistModuleRound({...priorIdentity,module_id:'B02',created_at:priorAt,requested_symbols:['2330'],rows:[{symbol:'2330',status:'READY',data_gap_reason:null,source:'Fugle.provider_reported_cumulative',source_contract:'daytrade_intraday_volume_value_v1',source_updated_at:priorAt,is_synthetic:false,replay:false,look_ahead:false,volume_evidence:{...source.source_evidence.quote.payload.turnoverVolumeEvidence,value:200000,event_at:priorAt}}]},adapter);
  const bars=Array.from({length:20},(_,n)=>{const start=Math.floor(Date.parse(asOf)/60000)*60000-(20-n)*60000;return {symbol:'2330',tradeDate:date,market:'TSE',source:'fugle-ws-candles',sourceChannel:'candles',candleOrigin:'websocket_candle',synthetic:false,volumeStrategyUsable:true,candleTime:new Date(start).toISOString(),candleSeenAt:new Date(start+60000).toISOString(),open:80+n,high:82+n,low:79+n,close:81+n,volume:100+n};});
  for(const plan of require('../lib/mother-pool-ma20-producer').collect({identity,snapshot:require('./test-mother-ma20').snapshot(identity,['2330'],asOf),symbols:['2330'],candles:bars,asOf}))ma20Captured[plan.module_id].push(await capture(plan));
  const discoveryPlan=require('../lib/mother-pool-discovery-producer').collect({identity,symbols:['2330'],sources:[source],candles:bars,previous,asOf});discoveryCaptured.push(await capture(discoveryPlan));

 }
 const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),rounds=captured.map(x=>read(x.file)),naturalFile=path.join(runtime,'natural-verified.json');
 const historicalGapResult=await run('verify-daytrade-module-receipt.js',['--module=A04','--round1='+historicalGapCaptured[0].file,'--round2='+historicalGapCaptured[1].file,'--out='+path.join(runtime,'A04-blocked.json')],env);
 assert.notEqual(historicalGapResult.code,0);assert.notEqual(JSON.parse(fs.readFileSync(path.join(runtime,'A04-blocked.json'),'utf8')).complete,true);
 console.log(JSON.stringify({check:'A04_two_round_persisted_gap_rejected',status:'passed',production_complete:false}));
 const ratioResult=await run('verify-daytrade-module-receipt.js',['--module=A05','--round1='+daytradeRatioCaptured[0].file,'--round2='+daytradeRatioCaptured[1].file,'--out='+path.join(runtime,'A05-verified.json')],env);
 assert.equal(ratioResult.code,0,ratioResult.stderr+ratioResult.stdout);
 console.log(JSON.stringify({check:'A05_two_round_RPC_DB_anon_verifier',status:'passed',production_complete:false}));
 const websocketResult=await run('verify-daytrade-module-receipt.js',['--module=A06','--round1='+websocketCaptured[0].file,'--round2='+websocketCaptured[1].file,'--out='+path.join(runtime,'A06-verified.json')],env);
 assert.equal(websocketResult.code,0,websocketResult.stderr+websocketResult.stdout);
 console.log(JSON.stringify({check:'A06_two_round_RPC_DB_anon_verifier',status:'passed',production_complete:false}));
 const priority5mResult=await run('verify-daytrade-module-receipt.js',['--module=A10','--round1='+priority5mCaptured[0].file,'--round2='+priority5mCaptured[1].file,'--out='+path.join(runtime,'A10-verified.json')],env);
 assert.equal(priority5mResult.code,0,priority5mResult.stderr+priority5mResult.stdout);
 console.log(JSON.stringify({check:'A10_two_round_RPC_DB_anon_verifier',status:'passed',production_complete:false}));
 for(const id of ['A08','A09']){
  const result=await run('verify-daytrade-module-receipt.js',['--module='+id,'--round1='+ma20Captured[id][0].file,'--round2='+ma20Captured[id][1].file,'--out='+path.join(runtime,id+'-verified.json')],env);
  assert.equal(result.code,0,result.stderr+result.stdout);
  console.log(JSON.stringify({check:id+'_two_round_RPC_DB_anon_verifier',status:'passed',production_complete:false}));
 }
 const natural=await run('verify-daytrade-module-receipt.js',['--module=B01','--round1='+captured[0].file,'--round2='+captured[1].file,'--out='+naturalFile],env);assert.equal(natural.code,0,natural.stderr+natural.stdout);
 const {validRound}=require('../lib/verify-mother-pool-module-round').createVerifier('B01');
 assert.equal(validRound(rounds[0]),true);
 for(const mutate of [r=>{delete r.db_readback.pages[0].content_range;},r=>{r.anon_readback.pages[0].content_range='0-1/3';},r=>{r.db_readback.pages[0].offset=1;},r=>{r.db_readback.query_identity.generation_id='wrong';},r=>{r.anon_readback.query_identity.writer_run_id='wrong';}]){const bad=structuredClone(rounds[0]);mutate(bad);assert.equal(validRound(bad),false);}
 const openingOut=path.join(runtime,'opening-verified.json');
 const openingResult=await run('verify-daytrade-module-receipt.js',['--module=B22','--round1='+openingCaptured[0].file,'--round2='+openingCaptured[1].file,'--out='+openingOut],env);
 assert.equal(openingResult.code,0,openingResult.stderr+openingResult.stdout);
 assert.deepEqual(Object.keys(read(openingOut).opening_range.by_symbol).sort(),['1101','2330']);
 const missingOpening=read(openingCaptured[1].file);delete missingOpening.opening_range;
 const missingOpeningFile=path.join(runtime,'missing-opening.json');fs.writeFileSync(missingOpeningFile,JSON.stringify(missingOpening));
 const missingOpeningResult=await run('verify-daytrade-module-receipt.js',['--module=B22','--round1='+openingCaptured[0].file,'--round2='+missingOpeningFile,'--out='+path.join(runtime,'missing-opening-rejected.json')],env);
 assert.notEqual(missingOpeningResult.code,0);
 assert(read(path.join(runtime,'missing-opening-rejected.json')).failed_checks.includes('B22_OPENING_RANGE_INVALID'));
 const allocationResult=await run('verify-daytrade-module-receipt.js',['--module=B10','--round1='+allocationCaptured[0].file,'--round2='+allocationCaptured[1].file,'--out='+path.join(runtime,'allocation-verified.json')],env);
 assert.equal(allocationResult.code,0,allocationResult.stderr+allocationResult.stdout);
 const fiveMinuteResult=await run('verify-daytrade-module-receipt.js',['--module=B15','--round1='+fiveMinuteCaptured[0].file,'--round2='+fiveMinuteCaptured[1].file,'--out='+path.join(runtime,'five-minute-verified.json')],env);
 assert.equal(fiveMinuteResult.code,0,fiveMinuteResult.stderr+fiveMinuteResult.stdout);
 const combinationResult=await run('verify-daytrade-module-receipt.js',['--module=B24','--round1='+combinationCaptured[0].file,'--round2='+combinationCaptured[1].file,'--out='+path.join(runtime,'combination-verified.json')],env);
 assert.equal(combinationResult.code,0,combinationResult.stderr+combinationResult.stdout);
 const identityResult=await run('verify-daytrade-module-receipt.js',['--module=A01','--round1='+identityCaptured[0].file,'--round2='+identityCaptured[1].file,'--out='+path.join(runtime,'identity-verified.json')],env);
 assert.equal(identityResult.code,0,identityResult.stderr+identityResult.stdout);
 const eligibilityResult=await run('verify-daytrade-module-receipt.js',['--module=A02','--round1='+eligibilityCaptured[0].file,'--round2='+eligibilityCaptured[1].file,'--out='+path.join(runtime,'eligibility-verified.json')],env);
 assert.equal(eligibilityResult.code,0,eligibilityResult.stderr+eligibilityResult.stdout);
 const previousOhlcResult=await run('verify-daytrade-module-receipt.js',['--module=A15','--round1='+previousOhlcCaptured[0].file,'--round2='+previousOhlcCaptured[1].file,'--out='+path.join(runtime,'previous-ohlc-verified.json')],env);
 assert.equal(previousOhlcResult.code,0,previousOhlcResult.stderr+previousOhlcResult.stdout);
 console.log(JSON.stringify({check:'A15_preopen_two_round_RPC_DB_anon_verifier',status:'passed',production_complete:false}));
 console.log(JSON.stringify({check:'A02_preopen_two_round_RPC_DB_anon_verifier',status:'passed',production_complete:false}));
 const mappingResult=await run('verify-daytrade-module-receipt.js',['--module=B05','--round1='+mappingCaptured[0].file,'--round2='+mappingCaptured[1].file,'--out='+path.join(runtime,'mapping-verified.json')],env);assert.equal(mappingResult.code,0,mappingResult.stderr+mappingResult.stdout);
 const discoveryResult=await run('verify-daytrade-module-receipt.js',['--module=B04','--round1='+discoveryCaptured[0].file,'--round2='+discoveryCaptured[1].file,'--out='+path.join(runtime,'discovery-verified.json')],env);assert.equal(discoveryResult.code,0,discoveryResult.stderr+discoveryResult.stdout);
 // B09 round-trip tests use explicitly isolated upstream plan/ACK fixtures.
 // They prove B09 persistence/capture/verification, not real upstream writes.
 for(let i=1;i<=2;i++){
  const id={trade_date:date,canonical_run_id:canonical,writer_run_id:`union:${suffix}:${i}`,generation_id:'ug'+i,mother_pool_run_id:'us'+i,snapshot_generation:'us'+i,snapshot_sequence:i};
  const fixture=require('./test-discovery-union-module'),f=fixture.fixture(id);
  const input=require('../lib/mother-pool-discovery-union-producer').collect({identity:id,parents:{B04:fixture.writeSet(f.price),B08:fixture.writeSet(f.industry)},asOf:date+`T10:01:0${i+2}+08:00`});
  unionCaptured.push(await capture(input));
 }
 const unionResult=await run('verify-daytrade-module-receipt.js',['--module=B09','--round1='+unionCaptured[0].file,'--round2='+unionCaptured[1].file,'--out='+path.join(runtime,'union-verified.json')],env);assert.equal(unionResult.code,0,unionResult.stderr+unionResult.stdout);
 const last=rounds[1],identity=Object.fromEntries(['trade_date','canonical_run_id','writer_run_id','generation_id','mother_pool_run_id','snapshot_generation','snapshot_sequence'].map(k=>[k,last[k]]));identity.writer_run_id+=':closeout';identity.generation_id+=':closeout';
 const closeoutInput=await buildCloseout({identity,rounds,closeoutAt:date+'T13:30:01+08:00'},{verifyRounds:async()=>read(naturalFile)});
 const closed=await capture(closeoutInput),out=path.join(runtime,'closed-verified.json');
 const result=await run('verify-mother-pool-closeout.js',['--closeout='+closed.file,'--round1='+captured[0].file,'--round2='+captured[1].file,'--natural-verification='+naturalFile,'--out='+out],env);assert.equal(result.code,0,result.stderr+result.stdout);assert.equal(read(out).complete,true);
 injectGap=true;const bad=await run('capture-daytrade-module-readbacks.js',closed.args,env);assert.notEqual(bad.code,0);const badArtifact=read(JSON.parse(bad.stdout).results[0].file);assert(badArtifact.failed_checks.includes('MISSING_SYMBOLS'));
 console.log(JSON.stringify({status:'passed',scope:'isolated_postgres_http_adapter',hosted_postgrest_tested:false,production_complete:false,runtime,checks:['two_natural_shape_rounds','real_rpc_rows','DB_and_anon_HTTP_capture','independent_B01_verifier','closeout_RPC_and_capture','independent_closeout_verifier','both_roles_omit_same_stock_rejected','generic_content_range_offset_and_query_identity_rejected','B05_two_round_RPC_DB_anon_independent_verifier','B04_two_round_RPC_DB_anon_independent_verifier','B09_RPC_DB_anon_with_isolated_parent_ACK_fixtures','B22_two_round_RPC_DB_anon_top_level_evidence','B22_missing_top_level_evidence_rejected','B10_actual_allocation_two_round_RPC_DB_anon_verifier','B15_two_round_RPC_DB_anon_independent_math_verifier','B24_two_round_RPC_DB_anon_with_isolated_parent_ACKs','A01_preopen_two_round_RPC_DB_anon_verifier']}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());



