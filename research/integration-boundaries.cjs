'use strict';
// Cross-phase OFFLINE boundary checks. No claim of a production feed adapter.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const p2=require('./phase2/incremental-writer.cjs');
const {IncrementalDiscovery}=require('./phase3/incremental-discovery.cjs');
const {createOracle}=require('./phase3/original-oracle.cjs');
const {fixture}=require('./phase3/fixture.cjs');
const {Consumer,frame}=require('./phase4/consumer.cjs');
const fx=require('./phase4/fixtures.cjs');
async function main(){
 const inputs=JSON.parse(fs.readFileSync(path.join(__dirname,'phase2/evidence/integration-fixtures.json'))),q=inputs.find(x=>x.kind==='quote');
 const tests=[],dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-crossphase-'));
 const snap=JSON.parse(JSON.stringify(fixture(2000)).replaceAll('2026-10-08',q.tradeDate).replaceAll('20261008',q.tradeDate.replaceAll('-','')));
 const discovery=new IncrementalDiscovery({oracle:createOracle()});discovery.baseline(snap);
 const denied=p2.safeRead({...q,continuityProof:null});assert.equal(denied.mode,'BLOCKED');assert.equal(discovery.state.sequence,0);
 tests.push({name:'missing C2 continuity stops before discovery',status:'PASS'});
 const plan=p2.readCommittedSegment(q);assert(plan.changedSymbols.includes('2330'));
 // Synthetic join is explicitly NOT an operational raw-quote mapping.
 const old=new Map(snap.quoteMap).get('2330'),raw=plan.rows[0],asOf=q.tradeDate+'T13:00:00+08:00';
 const value={...old,price:raw.close,quote_seen_at:raw.quoteSeenAt,last_trade_time:raw.exchangeTime};
 const batch={epoch:snap.epoch,tradeDate:q.tradeDate,sequence:1,continuity:'CONTIGUOUS',asOf,events:[{resource:'quoteMap',symbol:'2330',value}]};
 const first=discovery.process(batch);assert.equal(first.status,'OFFLINE_EVALUATED',JSON.stringify(first));assert.equal(first.all_market_observed,2000);
 assert.equal(discovery.process(batch).status,'REPLAY_DEDUP');
 tests.push({name:'actual isolated C2 quote changed symbol reaches all-market discovery with replay dedup',status:'PASS',mapping:'SYNTHETIC_JOIN_NOT_FORMAL_ADAPTER'});
 const consumer=new Consumer({directory:dir,tradeDate:q.tradeDate,identity:'offline-cross-phase',epoch:'offline-consumer'});
 const g=fx.gate('offline-cross-phase',{date:q.tradeDate,asOf});
 const admit=frame({epoch:'offline-consumer',identity:'offline-cross-phase',trade_date:q.tradeDate,sequence:1,status:'DURABLE_COMMITTED',as_of:asOf,events:[{kind:'ADMIT',symbol:'2330'}]});
 await consumer.process(admit,{gate:g,backfill:()=>({symbol:'2330',trade_date:q.tradeDate,identity:'offline-cross-phase',complete:true,data:fx.data('2330',{date:q.tradeDate})})});
 assert.equal((await consumer.process(admit,{gate:g})).status,'REPLAY_DEDUP');
 tests.push({name:'explicit offline admission backfill and consumer replay retain one checkpoint',status:'PASS',admission_source:'EXPLICIT_FIXTURE_NOT_DISCOVERY_OUTPUT'});
 const gap=frame({...admit,sequence:2,status:'GAP',payload_sha256:undefined});
 await assert.rejects(consumer.process(gap,{gate:g}),/GAP_FULL_RECOVERY/);assert.equal(consumer.state.seq,1);
 const wrong=discovery.process({...batch,sequence:2,epoch:'wrong'});assert.equal(wrong.status,'BLOCKED');assert.equal(discovery.state.sequence,1);
 tests.push({name:'consumer GAP and discovery epoch mismatch preserve both checkpoints',status:'PASS'});
 const result={status:'OFFLINE_BOUNDARY_TESTS_PASS',count:tests.length,tests,production_connected:false,notifications_sent:0,integrated_pipeline_complete:false,blockers:['C2 real continuity resolver unavailable','Raw quote/K to discovery resources mapping unapproved','Discovery admission to Strategy3 and whole-market Telegram consumer scopes require explicit routing'],fixture_directory:dir};
 fs.writeFileSync(path.join(__dirname,'integration-boundaries-receipt.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,count:tests.length}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});


