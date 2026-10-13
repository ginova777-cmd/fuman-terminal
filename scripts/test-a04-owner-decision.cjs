'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const {collect}=require('../lib/mother-pool-historical-volume-price');
const {select,recompute}=require('../lib/verify-a04-warmup.cjs');
const {hash}=require('../lib/a04-source-evidence.cjs');
const {datesFromCalendar}=require('../lib/mother-pool-daily-volume-baseline');
function fixture(){
 const tradeDate='2026-10-13',asOf=tradeDate+'T08:45:00+08:00',readAt=tradeDate+'T08:44:00+08:00',symbol='2330';
 const identity={trade_date:tradeDate,canonical_run_id:'fixture-canonical',writer_run_id:'fixture-writer',generation_id:'fixture-generation',mother_pool_run_id:'fixture-mother',snapshot_generation:'fixture-snapshot',snapshot_sequence:1};
 // Explicit artificial calendar and binding: not a formal market source approval.
 const checks=[];for(let n=1;n<=35;n++){const d=new Date(Date.parse(tradeDate+'T00:00:00Z')-n*86400000);checks.push({date:d.toISOString().slice(0,10),source:'cache',isTradingDay:![0,6].includes(d.getUTCDay())});}
 const calendar={trade_date:tradeDate,status:'SESSION_DATES_VERIFIED',checks};
 const dates=datesFromCalendar(calendar,tradeDate,15);
 const trustedBinding={contract:'a04_historical_source_binding_v1',status:'APPROVED',source:'strategy4_daily_ohlcv_view',source_contract:'ISOLATED_FIXTURE_ONLY',source_version:'f'.repeat(40),approval_reference:'ISOLATED_TEST_NOT_OWNER_APPROVAL',row_sources:['fixture.daily'],owner_decision:'MP-A04-OWNER-DECISION-20261013'};
 const raw={symbol,trade_date:tradeDate,source:'strategy4_daily_ohlcv_view',volume_unit:'LOTS',calendar,rows:dates.map(trade_date=>({symbol,trade_date,volume_lots:100,open:100,high:110,low:90,close:100,source:'fixture.daily',updated_at:trade_date+'T16:00:00+08:00',available_at:trade_date+'T16:01:00+08:00',is_synthetic:false,replay:false,look_ahead:false}))};
 const value={historical_daily_evidence:raw,daily_ohlcv_read_at:readAt};
 const f={identity,symbols:[symbol],dailyVolumeMap:new Map([[symbol,value]]),asOf,trustedBinding,raw,value,dates};refresh(f);return f;
}
function refresh(f){const raw=f.raw;f.value.historical_source_evidence={contract:'a04_historical_source_readback_v1',source:raw.source,symbol:raw.symbol,trade_date:raw.trade_date,source_contract:f.trustedBinding.source_contract,source_version:f.trustedBinding.source_version,source_run_id:'fixture-source-run',binding_sha256:hash(f.trustedBinding),requested_count:15,written_count:15,readback_count:15,rows_sha256:hash(raw.rows),calendar_sha256:hash(raw.calendar),readback_rows:structuredClone(raw.rows),available_at:f.identity.trade_date+'T06:00:00+08:00',read_at:f.value.daily_ohlcv_read_at,is_synthetic:false,replay:false,look_ahead:false};}
function run(f){const plan=collect(f,f.trustedBinding),result=select(plan,{identity:f.identity,asOf:f.asOf,trustedBinding:f.trustedBinding});return {plan,result};}
if(require.main===module){
const results=[];function test(name,fn){fn();results.push({name,status:'PASS'});}
test('2x/2.5x inclusive boundaries and 7pct boundary',()=>{
 for(const v of [199,200,249,250])for(const close of [106.99,107,107.01]){const f=fixture();f.raw.rows[14].volume_lots=v;f.raw.rows[14].close=close;refresh(f);const {plan,result}=run(f),c=plan.rows[0].a04_warmup.conditions;
  assert.equal(c.volume_2x.matched_dates.length,v>=200?1:0);assert.equal(c.volume_2_5x.matched_dates.length,v>=250?1:0);assert.equal(c.close_return_7pct.matched_dates.length,close>=107?1:0);assert.equal(result.symbols.length,v>=200||close>=107?1:0);
 }
});
test('OR union preserves independent conditions and all dates; dedupe symbols',()=>{
 const f=fixture();f.raw.rows[5].volume_lots=250;f.raw.rows[14].close=107;f.symbols=['2330','2330'];refresh(f);const {plan,result}=run(f);
 assert.deepEqual(plan.requested_symbols,['2330']);assert.deepEqual(result.symbols,['2330']);assert.deepEqual(result.candidates[0].hits,[{condition:'volume_2x',trade_date:f.dates[5]},{condition:'volume_2_5x',trade_date:f.dates[5]},{condition:'close_return_7pct',trade_date:f.dates[14]}]);
 assert.equal(plan.rows[0].a04_warmup.conditions.limit_up.state,'UNKNOWN');assert.equal(plan.rows[0].a04_warmup.conditions.near_limit_up.state,'UNKNOWN');assert.equal(plan.rows[0].a04_warmup.conditions.near_limit_up.max_legal_ticks,2);assert.equal(result.complete,false);assert.equal(plan.rows[0].status,'DATA_GAP');
});
test('recent ten days and prior five separated; pre-window spike does not match',()=>{
 const f=fixture();f.raw.rows[0].volume_lots=9999;f.raw.rows[0].close=9999;refresh(f);const {plan,result}=run(f);assert.deepEqual(result.symbols,[]);const days=plan.rows[0].volume_evidence.days;assert.equal(days.length,10);assert.deepEqual(days[0].baseline_dates,f.dates.slice(0,5));assert(days.every(d=>!d.baseline_dates.includes(d.source_date)));
});
test('volume-only and price-only remain eligible independently of unavailable branch',()=>{
 for(const mode of ['volume','price']){const f=fixture();if(mode==='volume'){f.raw.rows[14].volume_lots=250;f.raw.rows[7].close=null;}else{f.raw.rows[14].close=107;f.raw.rows[7].volume_lots=null;}refresh(f);const {result}=run(f);assert.deepEqual(result.symbols,['2330']);assert(result.candidates[0].hits.every(h=>mode==='volume'?h.condition.startsWith('volume'):h.condition==='close_return_7pct'));}
});
test('multiple-stock union is unique and retains each stock own provenance',()=>{
 const f=fixture(),g=fixture();f.raw.rows[14].volume_lots=250;refresh(f);g.raw.symbol='2317';g.raw.rows.forEach(r=>r.symbol='2317');g.raw.rows[14].close=107;refresh(g);
 f.symbols=['2330','2317','2330'];f.dailyVolumeMap.set('2317',g.value);const {result}=run(f);assert.deepEqual(result.symbols,['2330','2317']);assert.equal(result.candidates[0].hits.length,2);assert.equal(result.candidates[1].hits.length,1);assert.notEqual(result.candidates[0].source_hash,result.candidates[1].source_hash);
});
test('no hit and all-unverifiable sources never emit candidates; shipped binding UNBOUND',()=>{
 const f=fixture();assert.deepEqual(run(f).result.symbols,[]);f.raw.rows[14].volume_lots=250;refresh(f);
 assert.deepEqual(select(collect(f),{identity:f.identity,asOf:f.asOf}).symbols,[]);
 delete f.value.historical_source_evidence;assert.deepEqual(run(f).result.symbols,[]);
});
const defects={
 missing:f=>f.raw.rows.splice(0,1),duplicate:f=>f.raw.rows[0]={...f.raw.rows[1]},
 future_day:f=>f.raw.rows[0].trade_date=f.identity.trade_date,wrong_source:f=>f.raw.source='OTHER',
 wrong_row_source:f=>f.raw.rows[0].source='OTHER',future_available:f=>f.raw.rows[0].available_at='2099-01-01T00:00:00Z',
 replay:f=>f.raw.rows[0].replay=true,synthetic:f=>f.raw.rows[0].is_synthetic=true,look_ahead:f=>f.raw.rows[0].look_ahead=true,
 stale:f=>f.value.daily_ohlcv_read_at='2026-10-13T08:14:59+08:00',future_read:f=>f.value.daily_ohlcv_read_at='2026-10-13T08:46:00+08:00',wrong_read_date:f=>f.value.daily_ohlcv_read_at='2026-10-12T08:44:00+08:00',
 wrong_target:f=>f.raw.trade_date='2026-10-12',calendar_gap:f=>f.raw.calendar.checks.splice(2,1),
};
for(const [name,defect]of Object.entries(defects))test('reject '+name,()=>{const f=fixture();f.raw.rows[14].volume_lots=250;defect(f);refresh(f);assert.deepEqual(run(f).result.symbols,[]);});
test('unknown volume unit and zero denominator do not fabricate volume hit',()=>{
 for(const unit of ['SHARES','UNKNOWN']){const f=fixture();f.raw.rows[14].volume_lots=250;f.raw.volume_unit=unit;refresh(f);assert.deepEqual(run(f).result.symbols,[]);}
 const f=fixture();f.raw.rows.forEach(r=>r.volume_lots=0);refresh(f);assert.deepEqual(run(f).result.symbols,[]);
});
test('source proof hashes/count/version/readback mutation rejected',()=>{
 for(const change of [p=>p.rows_sha256='0'.repeat(64),p=>p.readback_rows[0].close=200,p=>p.readback_count=14,p=>p.source_version='0'.repeat(40),p=>p.source_run_id='',p=>p.binding_sha256='0'.repeat(64),p=>p.calendar_sha256='0'.repeat(64),p=>p.available_at='2099-01-01T00:00:00Z']){const f=fixture();f.raw.rows[14].volume_lots=250;refresh(f);change(f.value.historical_source_evidence);assert.deepEqual(run(f).result.symbols,[]);}
});
test('independent verifier rejects tampered ratios, pct, dates, flags and full-pass claims',()=>{
 const f=fixture();f.raw.rows[14].volume_lots=250;f.raw.rows[14].close=107;refresh(f);const good=run(f).plan;
 for(const change of [r=>r.volume_evidence.days[14-5].volume_ratio=3,r=>r.price_evidence.close_return.days[9].return_pct=8,r=>r.a04_warmup.hits[0].trade_date=f.identity.trade_date,r=>r.a04_warmup.conditions.near_limit_up.state='VERIFIED',r=>r.a04_warmup.complete=true,r=>r.status='READY',r=>r.publish_allowed=true,r=>r.formal_candidate_allowed=true,r=>r.price_evidence.near_limit_up=true]){const p=structuredClone(good);change(p.rows[0]);assert.deepEqual(select(p,{identity:f.identity,asOf:f.asOf,trustedBinding:f.trustedBinding}).symbols,[]);}
 for(const key of ['trade_date','canonical_run_id','writer_run_id','generation_id','mother_pool_run_id','snapshot_generation','snapshot_sequence']){const p=structuredClone(good);p[key]='wrong';assert.deepEqual(select(p,{identity:f.identity,asOf:f.asOf,trustedBinding:f.trustedBinding}).symbols,[]);}
});
test('actual Writer A04 call produces diagnostics with default missing source binding',()=>{
 const f=fixture(),text=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8');
 const line=text.split(/\r?\n/).find(x=>x.includes("inputs.push(require('../lib/mother-pool-historical-volume-price')"));assert(line);
 const context={inputs:[],require,identity:f.identity,snapshot:{symbols:f.symbols},dailyVolumeMap:f.dailyVolumeMap,nowIso:()=>f.asOf};vm.runInNewContext(line,context);
 assert.equal(context.inputs.length,1);assert.equal(context.inputs[0].rows[0].a04_warmup.warmup_eligible,false);assert.equal(context.inputs[0].rows[0].status,'DATA_GAP');
});
test('A04 full verifier and A14/A19 parent gates reject even forged complete receipts',()=>{
 const f=fixture();f.raw.rows[14].volume_lots=250;refresh(f);const {plan,result}=run(f);assert.equal(result.symbols.length,1);
 const registry=require('../lib/verify-mother-pool-module-round').createVerifier('A04');assert.equal(registry.validRound({...f.identity,complete:true,status:'verified'}),false);assert.equal(registry.verifyWarmup(plan,{identity:f.identity,asOf:f.asOf,trustedBinding:f.trustedBinding}).symbols.length,1);
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'a04-parent-')),dir=path.join(runtime,'data/scan-receipts/modules');fs.mkdirSync(dir,{recursive:true});
 const receipt={...f.identity,module_id:'A04',captured_at:f.asOf,status:'verified',complete:true,a04_warmup:result};const bytes=Buffer.from(JSON.stringify(receipt)),file=path.join(dir,'a04.json');fs.writeFileSync(file,bytes);
 for(const moduleId of ['A14','A19']){const checks=require('../lib/mother-pool-preopen-closure').inspect({moduleId,identity:f.identity,references:{A04:{file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}},asOf:f.asOf,runtime});assert.equal(checks.A04.reason,'PARENT_VERIFIER_FAILED');}
});
test('malformed plans fail closed without throwing',()=>{
 const f=fixture();const good=run(f).plan;
 for(const p of [null,{}, {...good,rows:[null]}, {...good,requested_symbols:['2330','2330']}])assert.deepEqual(select(p,{identity:f.identity,asOf:f.asOf,trustedBinding:f.trustedBinding}).symbols,[]);
});
test('Consumer validates actual persisted ACK and only exposes warmup scope',()=>{
 const f=fixture();f.raw.rows[14].volume_lots=250;refresh(f);const {plan}=run(f),wire=require('../lib/mother-pool-module-write-set');
 const p={created_at:plan.created_at,requested_symbols:plan.requested_symbols,rows:plan.rows};
 const w={contract:'mother_pool_module_write_set_v1',module_id:'A04',...f.identity,plan:p,plan_hash:wire.hash(p)};
 w.ack={...f.identity,module_id:'A04',committed:true,committed_at:f.asOf,plan_hash:w.plan_hash,written_symbols:['2330']};
 const payload={trade_date:f.identity.trade_date,canonical_run_id:f.identity.canonical_run_id,mother_pool_run_id:f.identity.mother_pool_run_id,mother_pool_snapshot_sequence:f.identity.snapshot_sequence,terminalPrioritySymbols:['2317'],openingPrioritySymbols:['2317'],daytradeCandlePrioritySymbols:['2317']};
 const consumer=require('../lib/a04-warmup-consumer.cjs'),options={now:f.asOf,trustedBinding:f.trustedBinding},next=consumer.attach(payload,w,options);
 assert.deepEqual(consumer.read(next,options).symbols,['2330']);assert.equal(consumer.read(next,options).complete,false);
 for(const key of Object.keys(payload))assert.deepEqual(next[key],payload[key]);
 assert.equal(consumer.attach(payload,w,{now:f.asOf}).a04WarmupEvidence,null);
 for(const now of ['2026-10-13T09:16:00+08:00','2026-10-14T08:45:00+08:00','2026-10-13T08:44:59+08:00'])assert.deepEqual(consumer.read(next,{...options,now}).symbols,[]);
 for(const change of [x=>x.mother_pool_snapshot_sequence++,x=>x.a04WarmupEvidence.complete=true,x=>x.a04WarmupEvidence.write_set.ack.committed=false,x=>delete x.a04WarmupEvidence.write_set.ack.committed_at,x=>x.a04WarmupEvidence.write_set.ack.committed_at='2026-10-14T00:00:00Z',x=>x.a04WarmupEvidence.write_set.ack.written_symbols=[],x=>x.a04WarmupEvidence.write_set.plan.rows[0].a04_warmup.hits=[],x=>x.a04WarmupEvidence.write_set.writer_run_id='other']){const bad=structuredClone(next);change(bad);assert.deepEqual(consumer.read(bad,options).symbols,[]);}
 assert.equal(consumer.attach(next,null,options).a04WarmupEvidence,null);
 const src=fs.readFileSync(require.resolve('./fugle-websocket-collector'),'utf8');const block=src.slice(src.indexOf('function readPrioritySymbols(symbols)'),src.indexOf('function currentTaipeiDate()'));
 const context={readJson:()=>next,PRIORITY_SYMBOLS_FILE:'fixture',COLLECTOR_ROLE:'daytrade',taipeiDate:()=>f.identity.trade_date,canonicalDaytradeRunId:()=>f.identity.canonical_run_id,normalizeCode:String,require:()=>({read:p=>consumer.read(p,options)})};
 vm.runInNewContext(block,context);const selected=context.readPrioritySymbols(['2330','2317']);assert.deepEqual(Array.from(selected.symbols),['2330','2317']);assert.equal(selected.a04WarmupOnly.scope,'WARMUP_ONLY');assert.equal(selected.counts.a04WarmupOnly,1);
 assert.equal(context.readPrioritySymbols(['2317']).a04WarmupOnly.symbols.length,0);
 context.COLLECTOR_ROLE='other';assert.equal(context.readPrioritySymbols(['2330','2317']).counts.a04WarmupOnly,0);
 context.COLLECTOR_ROLE='daytrade';context.require=()=>consumer;assert.equal(context.readPrioritySymbols(['2330','2317']).counts.a04WarmupOnly,0);
});
test('actual Writer subscription publication clears stale envelope without touching strategy arrays',()=>{
 const text=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8');const start=text.indexOf('  // Separate subscription-only evidence:');const end=text.indexOf('  writeModuleProducerReceipts',start);assert(start>0&&end>start);
 let stored={terminalPrioritySymbols:['2317'],a04WarmupEvidence:{stale:true}},writes=0;
 const context={moduleWorkIds:()=>['A04'],DRY_RUN:false,PRIORITY_SYMBOLS_FILE:'fixture',readJson:()=>stored,writeJson:(_,p)=>{stored=p;writes++;},require,nowIso:()=> '2026-10-13T08:45:00+08:00',result:{payload:{module_write_sets:{}}}};
 vm.runInNewContext(text.slice(start,end),context);assert.equal(stored.a04WarmupEvidence,null);assert.deepEqual(stored.terminalPrioritySymbols,['2317']);assert.equal(writes,1);
 vm.runInNewContext(text.slice(start,end),context);assert.equal(writes,1);
});
const report={status:'PASS',scope:'ISOLATED_ARTIFICIAL_FIXTURE_ONLY',cases:results.length,results,production_complete:false,price_tick_calculation_tested:false,source_binding_in_production:false};
console.log(JSON.stringify(report,null,2));
}
module.exports={fixture,refresh};
