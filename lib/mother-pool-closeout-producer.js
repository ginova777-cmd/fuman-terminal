'use strict';
const {hash}=require('./mother-pool-module-write-set');
const localDate=ms=>new Date(ms+28800000).toISOString().slice(0,10);
// Closeout references already persisted natural rounds; it creates no market event.
async function buildCloseout({identity,rounds,closeoutAt},adapter){
 const end=Date.parse(closeoutAt),date=identity.trade_date;
 if(!Number.isFinite(end)||localDate(end)!==date||end<Date.parse(date+'T13:30:00+08:00'))throw Error('CLOSEOUT_NOT_DUE');
 if(!Array.isArray(rounds)||rounds.length!==2)throw Error('TWO_NATURAL_ROUNDS_REQUIRED');
 const ordered=rounds.slice().sort((a,b)=>Date.parse(a.observed_at)-Date.parse(b.observed_at));
 for(const r of ordered){
  if(r.module_id!=='B01'||r.trade_date!==date||r.canonical_run_id!==identity.canonical_run_id||r.natural_evidence!==true||r.replay!==false||r.synthetic!==false||r.look_ahead!==false)throw Error('NATURAL_ROUND_IDENTITY_REQUIRED');
  const time=Date.parse(r.observed_at);
  if(!Number.isFinite(time)||time>=end)throw Error('CLOSEOUT_ROUND_TIME_ORDER');
 }
 for(const field of ['writer_run_id','generation_id','snapshot_generation','mother_pool_run_id'])if(new Set(ordered.map(r=>r[field])).size!==2||ordered.some(r=>!r[field]))throw Error('CLOSEOUT_ROUNDS_NOT_DISTINCT:'+field);
 if(!(Date.parse(ordered[1].observed_at)>Date.parse(ordered[0].observed_at)))throw Error('CLOSEOUT_ROUND_TIME_ORDER');
 // The adapter executes the existing independent module verifier, including DB/anon pages.
 const verification=await adapter.verifyRounds(ordered);
 if(verification?.verified_by!=='verify-daytrade-module-receipt.js'||verification.module_id!=='B01'||verification.complete!==true||verification.exit_code!==0||verification.first_blocker!==null||verification.failed_checks?.length!==0)throw Error('CLOSEOUT_NATURAL_ROUNDS_NOT_VERIFIED');
 if(hash(verification.rounds_verified)!==hash(ordered))throw Error('CLOSEOUT_VERIFIER_INPUT_MISMATCH');
 const symbols=[...new Set(ordered.flatMap(r=>r.requested_symbols||[]))].sort();
 if(!symbols.length)throw Error('CLOSEOUT_EMPTY_UNIVERSE');
 const events=ordered.flatMap(r=>r.db_readback.pages.flatMap(p=>p.rows.map(row=>Date.parse(row.event_time))));
 if(!events.length||events.some(t=>!Number.isFinite(t)||localDate(t)!==date||t>=end||t>Date.parse(date+'T13:30:00+08:00')))throw Error('CLOSEOUT_EVENT_TIME_INVALID');
 const lastEvent=new Date(Math.max(...events)).toISOString();
 const references=ordered.map(r=>({writer_run_id:r.writer_run_id,generation_id:r.generation_id,mother_pool_run_id:r.mother_pool_run_id,snapshot_generation:r.snapshot_generation,snapshot_sequence:r.snapshot_sequence,observed_at:r.observed_at,artifact_hash:hash(r)}));
 return {...identity,module_id:'B18',created_at:closeoutAt,requested_symbols:symbols,
  special_evidence:{closeout:true,closeout_at:closeoutAt,last_event_at:lastEvent,natural_rounds:references,round_verification_hash:hash(verification)},
  rows:symbols.map(symbol=>({symbol,status:'READY',data_gap_reason:null,source:'verified_natural_writer_rounds',source_contract:'mother_pool_closeout_from_verified_rounds_v1',
   source_updated_at:ordered[1].observed_at,event_time:lastEvent,is_synthetic:false,replay:false,look_ahead:false,
   closeout:true,closeout_at:closeoutAt,last_event_at:lastEvent,off_session:true,pending_gaps:[],natural_rounds:references}))};
}
module.exports={buildCloseout};
