'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const E=require('../lib/mother-pool-event-evidence.cjs'),D=require('../lib/daytrade-candle-delta'),P=require('../lib/mother-pool-receipt-current.cjs');
const output=path.resolve(process.argv[2]);fs.mkdirSync(output,{recursive:true});
const results=[];
async function fixture(name){
 const root=path.join(output,name);fs.mkdirSync(root);fs.writeFileSync(path.join(root,'ISOLATED_ONLY'),'TEST_ONLY');
 const f=require('./test-combination-independent').fixture(),identity={...f.identity,epoch:'epoch1'},now=f.asOf;
 const current=structuredClone(f.parents.B13.plan.rows[0].current);current.at(-1).close=110;current.at(-1).high=111;
 const input={stock_id:'1101',trade_date:identity.trade_date,current,history:[],as_of:now};
 const volume=require('../lib/telegram-detectors/volume-detector.cjs').detect(input).rows.at(-1),price=require('../lib/telegram-detectors/price-detector.cjs').detect(input).rows.at(-1);
 const plans=require('../lib/mother-pool-anomaly-module-producer').collect({identity,symbols:['1101'],asOf:now,evidence:{...identity,details:[{symbol:'1101',current,history:[],volume,price,failed_checks:[]}]}});
 f.parents.B13.plan.rows=plans.find(p=>p.module_id==='B13').rows;
 const tongzi=f.parents.B22.plan.rows[0];tongzi.completed_bars=current;tongzi.tongzi=require('../lib/mother-pool-tongzi').evaluate({symbol:'1101',trade_date:identity.trade_date,bar:tongzi.reference_bar,trades:tongzi.trade_evidence,completedBars:current,asOf:now});
 for(const id of ['B13','B22']){const w=f.parents[id];w.plan_hash=require('../lib/mother-pool-module-write-set').hash(w.plan);w.ack.plan_hash=w.plan_hash;}
 const sources={},state={scope:'TEST_ONLY',epoch:'epoch1',generation_id:identity.generation_id,snapshot_generation:identity.snapshot_generation,sources:{}};
 for(const id of ['B13','B22']){
  const w=f.parents[id],write_set=E.save(root,w),db=E.save(root,w.plan.rows),anon=E.save(root,w.plan.rows);
  const checkpoint=E.save(root,{...identity,scope:'TEST_ONLY',contract:'b24_event_checkpoint_v1',symbol:'1101',module_id:id,plan_hash:w.plan_hash,write_set_sha256:write_set.sha256});
  const proof=E.save(root,{scope:'TEST_ONLY',contract:'b24_event_readback_proof_v1',checkpoint_sha256:checkpoint.sha256,db_sha256:db.sha256,anon_sha256:anon.sha256,row_hash:require('../lib/mother-pool-module-write-set').hash(w.plan.rows[0]),plan_hash:w.plan_hash,verified_at:now});
  sources[id]={write_set,db,anon,checkpoint,proof,revision:1};state.sources[id+':1101']={revision:1,proof_sha256:proof.sha256,gap:false};
 }
 const bars=f.parents.B22.plan.rows[0].completed_bars;
 const rows=bars.map(b=>require('../lib/daytrade-fast-candle-row').mapNaturalCandle({symbol:'1101',market:'TSE',tradeDate:identity.trade_date,source:'fugle-ws-candles',sourceChannel:'candles',candleOrigin:'websocket_candle',synthetic:false,intradayOddLot:false,volumeStrategyUsable:true,candleTime:b.timestamp,candleSeenAt:b.available_at,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume_raw},{tradeDate:identity.trade_date,nowMs:Date.parse(now),maxSeenAgeMs:Infinity}));assert(rows.every(Boolean));
 // TEST_ONLY disk persistence. These ACK fixtures are never formal HTTP evidence.
 const rowsRef=E.save(root,rows),saved=E.read(root,rowsRef),target='isolated.invalid/candles',round='wrapper-isolated',sync='sync-isolated';
 assert.deepEqual(saved,rows);
 const evidence=Object.fromEntries(rows.map(r=>[r.symbol+'|'+r.candle_time,{hash:D.fingerprint(r),trade_date:identity.trade_date,target,sync_id:sync,wrapper_run_id:round,acknowledged_at:now,status:'HTTP_ACKNOWLEDGED'}]));
 const snapshot={complete:true,trade_date:identity.trade_date,canonical_run_id:identity.canonical_run_id,mother_pool_run_id:identity.mother_pool_run_id,generation:identity.snapshot_generation,snapshot_sequence:identity.snapshot_sequence};
 const snapshotRef=E.save(root,snapshot),proof=P.makeCandleProof({rows,evidence,tradeDate:identity.trade_date,target,snapshotRaw:E.raw(root,snapshotRef).toString(),roundId:round,syncId:sync,pending:0,deferred:0,now:Date.parse(now)});assert.equal(proof.status,'SAVED_CONTENT_BOUND');
 const proofRef=E.save(root,proof),receipt=E.save(root,{ok:true,mode:'apply',trade_date:identity.trade_date,wrapper_run_id:round,sync_id:sync,completed_at:now,candle_pending_after:0,candle_deferred:0,candle_backfill_complete:true,final_content_readback_verified:true,candle_save_proof:{sha256:proofRef.sha256}});
 const checkpoint=E.save(root,{contract:D.CONTRACT,trade_date:identity.trade_date,target,hashes:Object.fromEntries(rows.map(r=>[r.symbol+'|'+r.candle_time,D.fingerprint(r)])),save_evidence:evidence});
 const trades=f.parents.B22.plan.rows[0].trade_evidence,bytes=Buffer.from(trades.map(t=>JSON.stringify(t)+'\n').join('')),bytesFile=path.join(root,'segment.jsonl');fs.writeFileSync(bytesFile,bytes);
 const start=identity.trade_date+'T09:02:00+08:00',connection_id='connection1';
 const builder=require('../lib/trade-segment-evidence.cjs').create({epoch:identity.epoch,connection_id,symbol:'1101',trade_date:identity.trade_date,start_offset:0,opened_at:start});trades.forEach(t=>assert(builder.capture(t)));
 assert(builder.acknowledge({epoch:identity.epoch,connection_id,symbol:'1101',start_offset:0,end_offset:bytes.length,rows:trades.length,sha256:E.digest(bytes),status:'STORED'}));let segmentRef;await builder.seal({closed_at:now,persist:async p=>{segmentRef=E.save(root,p);}});
 const writer_provenance={wrapper_run_id:round,rows:rowsRef,snapshot:snapshotRef,proof:proofRef,receipt,checkpoint,segments:{1101:{proof:segmentRef,bytes:E.reference(bytesFile),connection_id,start_offset:0,window:{from:start,to:now}}}};
 const events=require('../lib/mother-pool-combination-producer').collect(f).rows[0].events.filter(e=>['B13','B22'].includes(e.module_id));
 const b={...identity,contract:'b24_event_evidence_v1',scope:'TEST_ONLY',symbol:'1101',events,sources,provenance_mode:'ORIGINAL_WRITER',writer_provenance,received_at:now,sources_ready_at:now};
 const currentFile=path.join(root,'current.json');fs.writeFileSync(currentFile,JSON.stringify(state));
 return {root,b,currentFile,now,directory:path.join(root,'outbox'),testClock:true,clock:()=>now};
}
const sink={kind:'isolated',deliver:async i=>({confirmed:true,sink:'isolated',occurrence_id:i.occurrence_id})};
(async()=>{
 for(const [name,mutate,pass] of [
  ['original_formats_to_child_verifier_outbox',()=>{},true],
  ['missing_final_proof',f=>delete f.b.writer_provenance.proof,false],
  ['missing_ack_checkpoint',f=>{const refs=f.b.writer_provenance,c=E.read(f.root,refs.checkpoint);c.save_evidence={};refs.checkpoint=E.save(f.root,c);},false],
  ['wrong_snapshot',f=>{const refs=f.b.writer_provenance,s=E.read(f.root,refs.snapshot);s.generation='wrong';refs.snapshot=E.save(f.root,s);},false],
  ['segment_byte_drift',f=>fs.appendFileSync(f.b.writer_provenance.segments['1101'].bytes.file,'x'),false],
  ['segment_wrong_epoch',f=>{const s=f.b.writer_provenance.segments['1101'],p=E.read(f.root,s.proof);p.epoch='wrong';s.proof=E.save(f.root,p);},false],
  ['window_gap',f=>f.b.writer_provenance.segments['1101'].window.to=new Date(Date.parse(f.now)+1).toISOString(),false],
  ['segment_omitted_trade',f=>{f.b.writer_provenance.segments['1101'].window.from=f.now;},false],
  ['stale_final_proof',f=>{const refs=f.b.writer_provenance,r=E.read(f.root,refs.receipt);r.completed_at=new Date(Date.parse(f.now)-120001).toISOString();refs.receipt=E.save(f.root,r);},false]
 ]){const f=await fixture(name);mutate(f);let result,error;try{result=await require('../lib/run-b24-event-verification.cjs').run({...f,bundleRef:E.save(f.root,f.b),sink});}catch(e){error=e.message;}const ok=pass?result?.outbox.results[0]?.status==='ISOLATED_ACKED':Boolean(error)&&!fs.existsSync(f.directory);results.push({name,pass:ok,error:error||null});E.save(f.root,{scope:'TEST_ONLY',result:result||null,error:error||null});}
 const report={scope:'TEST_ONLY',full_writer_process_test:false,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results};fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=report.failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
