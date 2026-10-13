'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const E=require('../lib/mother-pool-event-evidence.cjs'),{hash}=require('../lib/mother-pool-module-write-set');
const output=path.resolve(process.argv[2]||'event-test-results');fs.mkdirSync(output,{recursive:true});
async function fixture(name,short=false,crossRound=false){
 const root=path.join(output,name);fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'ISOLATED_ONLY'),'TEST_ONLY');
 const f=require('./test-combination-independent').fixture(),identity=f.identity;
 if(short){
  const r=f.parents.B22.plan.rows[0];
  r.trade_evidence[0].trade.price=105;r.trade_evidence[1].trade.price=103;
  r.tongzi=require('../lib/mother-pool-tongzi').evaluate({symbol:r.symbol,trade_date:identity.trade_date,bar:r.reference_bar,trades:r.trade_evidence,completedBars:r.completed_bars,asOf:f.asOf});
  const v=f.parents.B21.plan.rows[0];v.vwap=110;v.trade_value_evidence.value=11000000;v.trade_value_evidence.trade_value_twd=11000000;
  for(const id of ['B21','B22']){f.parents[id].plan_hash=hash(f.parents[id].plan);f.parents[id].ack.plan_hash=f.parents[id].plan_hash;}
 }
 const events=require('../lib/mother-pool-combination-producer').collect(f).rows[0].events.filter(e=>['B21','B22'].includes(e.module_id));
 const sources={},state={scope:'TEST_ONLY',epoch:'epoch1',generation_id:identity.generation_id,snapshot_generation:identity.snapshot_generation,sources:{}};
 for(const id of ['B21','B22','B23']){
  const original=f.parents[id],sourceIdentity={...identity,writer_run_id:crossRound&&id==='B22'?'previous-writer':identity.writer_run_id},input={...sourceIdentity,module_id:id,...original.plan};
  // Real persistence API with a TEST_ONLY disk sink. ACK follows fsync; readbacks reopen the sink file.
  let rowFile;
  const w=await require('../lib/persist-mother-pool-module-round').persistModuleRound(input,{
   savePlan:async p=>E.save(root,{scope:'TEST_ONLY',intent:p}),
   persist:async p=>{const doc=JSON.parse(p.p_document);rowFile=E.save(root,doc.plan.rows);return {...sourceIdentity,module_id:id,plan_hash:doc.plan_hash,committed:true,committed_at:f.asOf,written_symbols:doc.plan.requested_symbols};},
   saveEvidence:async w=>E.save(root,w)
  });
  const write_set=E.save(root,w),db=E.save(root,E.read(root,rowFile)),anon=E.save(root,E.read(root,rowFile));
  assert.deepEqual(E.read(root,db),w.plan.rows);assert.deepEqual(E.read(root,anon),w.plan.rows);
  const checkpoint=E.save(root,{...sourceIdentity,scope:'TEST_ONLY',contract:'b24_event_checkpoint_v1',epoch:'epoch1',symbol:'1101',module_id:id,plan_hash:w.plan_hash,write_set_sha256:write_set.sha256});
  const proof=E.save(root,{scope:'TEST_ONLY',contract:'b24_event_readback_proof_v1',checkpoint_sha256:checkpoint.sha256,db_sha256:db.sha256,anon_sha256:anon.sha256,row_hash:hash(E.read(root,db)[0]),plan_hash:w.plan_hash,verified_at:f.asOf});
  sources[id]={write_set,db,anon,checkpoint,proof,revision:1};state.sources[id+':1101']={revision:1,proof_sha256:proof.sha256,gap:false};
 }
 const b={...identity,contract:'b24_event_evidence_v1',scope:'TEST_ONLY',epoch:'epoch1',symbol:'1101',events,sources,received_at:f.asOf,sources_ready_at:f.asOf};
 const currentFile=path.join(root,'current.json');fs.writeFileSync(currentFile,JSON.stringify(state));
 return {root,b,state,currentFile,now:f.asOf,bundleRef:E.save(root,b),directory:path.join(root,'outbox'),clock:()=>f.asOf,testClock:true};
}
const results=[],measurements=[];
async function test(name,fn){const t=performance.now();try{await fn();results.push({name,pass:true,elapsed_ms:performance.now()-t});}catch(e){results.push({name,pass:false,error:e.stack});}}
const chain=require('../lib/run-b24-event-verification.cjs').run;
const sink={kind:'isolated',deliver:async i=>({confirmed:true,occurrence_id:i.occurrence_id,sink:'isolated'})};
(async()=>{
 await test('full_child_verifier_to_durable_outbox',async()=>{const f=await fixture('normal'),r=await chain({...f,sink});assert.equal(r.outbox.results[0].status,'ISOLATED_ACKED');measurements.push(r);fs.writeFileSync(path.join(f.root,'result.json'),JSON.stringify(r,null,2));});
 await test('short_pair',async()=>{const f=await fixture('short',true),r=await chain({...f,sink});assert.equal(r.outbox.results[0].status,'ISOLATED_ACKED');assert(f.b.events.every(e=>e.direction==='short'));});
 await test('cross_writer_round_same_epoch',async()=>{const f=await fixture('cross_round',false,true),r=await chain({...f,sink});assert.equal(r.outbox.results[0].status,'ISOLATED_ACKED');});
 await test('producer_projection_scopes_only_required_sources',async()=>{
  const f=await fixture('projection'),build=require('../lib/build-b24-event-bundles.cjs').build;
  const refs=Object.fromEntries(Object.entries(f.b.sources).map(([id,v])=>[id+':1101',v]));
  const input={root:f.root,currentFile:f.currentFile,writeSet:{...f.b,module_id:'B24',plan:{rows:[{symbol:'9999',status:'DATA_GAP',events:[]},{symbol:'1101',status:'DATA_GAP',events:f.b.events}]}},sourceReferences:refs,receivedAt:f.now,sourcesReadyAt:f.now};
  const p=build(input);assert.equal(p.jobs.length,1);assert.equal(p.blocked.length,0);assert.deepEqual(Object.keys(E.read(f.root,p.jobs[0].bundleRef).sources).sort(),['B21','B22','B23']);
  const r=await chain({...f,bundleRef:p.jobs[0].bundleRef,sink});assert.equal(r.outbox.results[0].status,'ISOLATED_ACKED');delete refs['B22:1101'];const missing=build(input);assert.equal(missing.jobs.length,0);assert.equal(missing.blocked[0].reason,'EVENT_SOURCE_PROOF_REFERENCES_REQUIRED');
 });
 await test('actual_writer_event_block_then_actual_runner_failure',async()=>{
  const f=await fixture('writer_block'),source=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');
  const start=source.indexOf('  // Event-local acceptance'),end=source.indexOf('  if(isolatedTradeJournal',start);assert(start>0&&end>start);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor,result={payload:{}};
  await new AsyncFunction('isolatedModules','result','require',source.slice(start,end))({root:f.root,outbox:{directory:f.directory,sink},eventVerification:{jobs:[{bundleRef:f.bundleRef}],currentFile:f.currentFile,testClock:f.clock}},result,require);
  assert.equal(result.payload.event_verification[0].outbox.results[0].status,'ISOLATED_ACKED');
  const p=require('node:child_process').spawnSync(process.execPath,[path.join(__dirname,'run-daytrade-module-verifiers.js'),'--modules=B01'],{encoding:'utf8',timeout:45000,env:{...process.env,FUMAN_RUNTIME:f.root,TRADE_DATE:f.b.trade_date,MOTHER_POOL_CANONICAL:f.b.canonical_run_id,MOTHER_POOL_REQUIRED_WRITER_RUN_ID:f.b.writer_run_id}});
  assert.equal(p.status,2);assert.equal(JSON.parse(p.stdout).selected_modules_passed,false);
  fs.writeFileSync(path.join(f.root,'writer-runner-separation.json'),JSON.stringify({scope:'TEST_ONLY',writer_event_block:result,runner:{exit:p.status,stdout:p.stdout,stderr:p.stderr},full_writer_process:'NOT_EXECUTED'},null,2));
 });
 for(const [name,change] of [
  ['conflict',f=>f.b.events[1].direction='short'],
  ['duplicate',f=>f.b.events[1]=f.b.events[0]],
  ['missing_proof',f=>delete f.b.sources.B22.proof],
  ['missing_checkpoint',f=>delete f.b.sources.B22.checkpoint],
  ['epoch_change',f=>f.state.epoch='epoch2'],
  ['generation_change',f=>f.state.generation_id='new'],
  ['revision_change',f=>f.state.sources['B22:1101'].revision++],
  ['reconnect_gap',f=>f.state.sources['B22:1101'].gap=true],
  ['forged_event_price',f=>f.b.events[0].event_price++],
  ['forged_calculation',f=>f.b.events[0].calculation_evidence.level=0],
  ['ack_missing',f=>{const r=f.b.sources.B22,w=E.read(f.root,r.write_set);delete w.ack;r.write_set=E.save(f.root,w);}],
  ['proof_wrong_hash',f=>{const r=f.b.sources.B22,p=E.read(f.root,r.proof);p.row_hash='bad';r.proof=E.save(f.root,p);f.state.sources['B22:1101'].proof_sha256=r.proof.sha256;}],
  ['parent_gap',f=>{const r=f.b.sources.B22,w=E.read(f.root,r.write_set);w.plan.rows[0].status='DATA_GAP';w.plan.rows[0].data_gap_reason='TEST_GAP';w.plan.data_gap_symbols=['1101'];w.plan_hash=hash(w.plan);w.ack.plan_hash=w.plan_hash;r.write_set=E.save(f.root,w);}],
  ['stale_at_verifier',f=>f.clock=()=>new Date(Date.parse(f.now)+120001).toISOString()],
 ])await test(name,async()=>{const f=await fixture(name);change(f);f.bundleRef=E.save(f.root,f.b);fs.writeFileSync(f.currentFile,JSON.stringify(f.state));await assert.rejects(()=>chain({...f,sink}));assert(!fs.existsSync(f.directory));});
 await test('enqueue_rechecks_clock',async()=>{const f=await fixture('stale_enqueue');let n=0;f.clock=()=>++n<=2?f.now:new Date(Date.parse(f.now)+120001).toISOString();await assert.rejects(()=>chain({...f,sink}));});
 await test('other_symbol_gap_unrelated_module_failure',async()=>{const f=await fixture('unrelated');f.state.sources['B22:9999']={gap:true};f.state.unrelated_runner={status:'FAIL',error:'ETIMEDOUT'};fs.writeFileSync(f.currentFile,JSON.stringify(f.state));const r=await chain({...f,sink});assert.equal(r.outbox.results[0].status,'ISOLATED_ACKED');assert.equal(E.live(f.root,f.currentFile).unrelated_runner.status,'FAIL');assert.equal(r.full_market_acceptance,'NOT_EVALUATED');});
 await test('replay_after_ack',async()=>{const f=await fixture('replay');await chain({...f,sink});const r=await chain({...f,sink});assert.equal(r.outbox.results[0].reason,'OLD_OCCURRENCE');});
 for(const fault of ['after_intent','after_attempt','after_delivery','after_ack'])await test('crash_'+fault,async()=>{const f=await fixture(fault);await assert.rejects(()=>chain({...f,sink,fault}));const r=await chain({...f,sink});assert.equal(r.outbox.results[0][fault==='after_intent'?'status':'reason'],fault==='after_intent'?'ISOLATED_ACKED':fault==='after_ack'?'OLD_OCCURRENCE':'DELIVERY_OUTCOME_UNKNOWN');});
 await test('unknown_delivery_no_retry',async()=>{const f=await fixture('unknown');let calls=0;const bad={kind:'isolated',deliver:async()=>{calls++;throw Error('UNKNOWN');}};await chain({...f,sink:bad});const r=await chain({...f,sink:bad});assert.equal(calls,1);assert.equal(r.outbox.results[0].reason,'DELIVERY_OUTCOME_UNKNOWN');});
 await test('hard_exit_after_attempt_retains_lock_and_blocks_replay',async()=>{
  const f=await fixture('hard_exit'),config=path.join(f.root,'child-config.json');fs.writeFileSync(config,JSON.stringify({...f,clock:undefined}));
  const code="const f=require(process.argv[1]);require(process.argv[2]).run({...f,clock:()=>f.now,sink:{kind:'isolated',deliver:async()=>process.exit(91)}}).catch(e=>{console.error(e);process.exitCode=1;});";
  const p=require('node:child_process').spawnSync(process.execPath,['-e',code,config,path.resolve(__dirname,'../lib/run-b24-event-verification.cjs')],{encoding:'utf8',timeout:30000});
  assert.equal(p.status,91);assert(fs.existsSync(path.join(f.directory,'round.lock')));await assert.rejects(()=>chain({...f,sink}),/OUTBOX_LOCK_REQUIRES_REVIEW/);
  const lock=path.join(f.directory,'round.lock'),lockHash=E.digest(fs.readFileSync(lock)),recover=require('../lib/recover-isolated-b24-lock.cjs').recover;
  assert.throws(()=>recover({root:f.root,directory:f.directory,expectedHash:'bad'}),/LOCK_CHANGED/);
  const recovered=recover({root:f.root,directory:f.directory,expectedHash:lockHash});assert.equal(recovered.status,'ISOLATED_DEAD_LOCK_ARCHIVED');
  let calls=0;const resumed=await chain({...f,sink:{kind:'isolated',deliver:async()=>{calls++;throw Error('MUST_NOT_RETRY');}}});assert.equal(calls,0);assert.equal(resumed.outbox.results[0].reason,'DELIVERY_OUTCOME_UNKNOWN');
  fs.writeFileSync(path.join(f.root,'hard-exit-result.json'),JSON.stringify({exit:p.status,stdout:p.stdout,stderr:p.stderr,restart:'LOCK_ARCHIVED_DELIVERY_UNKNOWN_NO_RETRY',automatic_retry:false}));
 });
 await test('receipt_tamper',async()=>{const f=await fixture('tamper'),r=await chain({...f,sink});fs.appendFileSync(r.receipt.file,' ');await assert.rejects(()=>require('../lib/mother-pool-isolated-outbox.cjs').run({...f,sink,eventReceipt:r.receipt,evidenceRoot:f.root,clock:f.clock}));});
 await test('window_boundaries_component',async()=>{const f=await fixture('windows'),combine=require('../lib/mother-pool-directional-combinations').combine;const t=Date.parse(f.now);for(const delta of [0,60000,180000,180001]){const events=structuredClone(f.b.events);events[0].event_timestamp=new Date(t-delta).toISOString();events[1].event_timestamp=new Date(t).toISOString();const c=combine(events,{asOf:f.now});assert.equal(c.length,delta<=180000?1:0);if(delta===60000)assert(c[0].matched_windows.includes(60));if(delta===180000)assert.deepEqual(c[0].matched_windows,[180]);}});
 await test('cooldown_boundaries_component',async()=>{const f=await fixture('cooldown'),policy=require('../lib/mother-pool-b24-cooldown'),base={events:f.b.events,now:f.now,qualityGate:true,notifierEligible:true,freshnessPassed:true},d=policy.decide(base);for(const dt of [179999,180000]){const now=new Date(Date.parse(f.now)+dt).toISOString(),events=structuredClone(f.b.events);events.forEach((e,i)=>{e.event_id+='new';e.event_timestamp=new Date(Date.parse(now)-i*100).toISOString();});const r=policy.decide({...base,events,now,previous:{key:d.key,status:'delivered',sent_at:f.now,event_ids:d.event_ids}});assert.equal(r.allowed,dt===180000);}});
 for(let i=0;i<10;i++)await test('latency_'+i,async()=>{const t=performance.now();const f=await fixture('latency_'+i);const sourcesReadyMs=performance.now()-t;const r=await chain({...f,sink});measurements.push({elapsed_ms:performance.now()-t,sources_ready_ms:sourcesReadyMs,verifier_ms:r.process.elapsed_ms,verifier_complete_ms:sourcesReadyMs+r.timing.verifier_complete_ms,enqueued_ms:sourcesReadyMs+r.timing.outbox[0].enqueued_ms,sink_ack_ms:sourcesReadyMs+r.timing.outbox[0].sink_ack_ms});});
 const receipt={scope:'TEST_ONLY',passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,results,measurements};fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exitCode=receipt.failed?1:0;
})();
