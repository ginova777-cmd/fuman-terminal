'use strict';
const E=require('./mother-pool-event-evidence.cjs');
const delta=require('./daytrade-candle-delta');
const proofStore=require('./mother-pool-receipt-current.cjs');
// Read the original Writer formats; never translate a missing Final Proof into event success.
function verify({root,refs,identity,rowsByModule,now}){
 E.need(refs,'WRITER_PROVENANCE_REQUIRED');
 E.need(typeof refs.wrapper_run_id==='string'&&refs.wrapper_run_id.length>0,'WRAPPER_ID_REQUIRED');
 const proofRaw=E.raw(root,refs.proof).toString('utf8'),snapshotRaw=E.raw(root,refs.snapshot).toString('utf8');
 const receipt=E.read(root,refs.receipt),proof=JSON.parse(proofRaw),snapshot=JSON.parse(snapshotRaw),rows=E.read(root,refs.rows),checkpoint=E.read(root,refs.checkpoint);
 E.need(Array.isArray(rows)&&rows.length>0&&new Set(rows.map(r=>r.symbol+'|'+r.candle_time)).size===rows.length,'WRITER_ROWS_REQUIRED');
 E.need(snapshot.generation===identity.snapshot_generation&&snapshot.mother_pool_run_id===identity.mother_pool_run_id&&snapshot.snapshot_sequence===identity.snapshot_sequence,'WRITER_SNAPSHOT_IDENTITY');
 const result=proofStore.verifyCandleProof({receipt,proofRaw,snapshotRaw,rows,tradeDate:identity.trade_date,target:proof.target,roundId:refs.wrapper_run_id,now:E.clock(now)});
 E.need(result.ok,'WRITER_FINAL_PROOF:'+result.reason);
 E.need(checkpoint.contract===delta.CONTRACT&&checkpoint.trade_date===identity.trade_date&&checkpoint.target===proof.target,'WRITER_CHECKPOINT_IDENTITY');
 const entries=new Map(proof.entries.map(e=>[e.key,e]));
 for(const row of rows){const k=row.symbol+'|'+row.candle_time,h=delta.fingerprint(row),entry=entries.get(k);E.need(entry&&entry.hash===h&&checkpoint.hashes?.[k]===h&&JSON.stringify(checkpoint.save_evidence?.[k])===JSON.stringify(entry.ack),'WRITER_ACK_CHECKPOINT_MISMATCH');}
 const indexed=new Map(rows.map(r=>[r.symbol+'|'+new Date(r.candle_time).toISOString(),r]));
 for(const r of Object.values(rowsByModule)){
  E.need(!r.volume_evidence&&!r.trade_value_evidence,'AGGREGATE_PROVENANCE_REQUIRED');
  const bars=[...(r.current||[]),...(r.bars_through_event||[]),...(r.completed_bars||[]),...(r.reference_bar?[r.reference_bar]:[])];
  for(const b of bars){const row=indexed.get(b.stock_id+'|'+new Date(b.timestamp).toISOString());E.need(row&&row.synthetic===false&&['open','high','low','close'].every(k=>row[k]===b[k])&&Date.parse(row.updated_at)===Date.parse(b.available_at)&&row.volume===b.volume_raw&&String(row.payload?.volume_unit).toUpperCase()===b.volume_raw_unit,'EVENT_CANDLE_NOT_IN_WRITER_PROOF');}
  // Prior-day baselines require their own provenance; today's Proof cannot certify them.
  E.need(!(r.history||[]).length,'HISTORICAL_PROOF_MAPPING_REQUIRED');
  if((r.trade_evidence||[]).length){
   const segment=refs.segments?.[r.symbol];E.need(segment,'TRADE_SEGMENT_REQUIRED');
   const p=E.read(root,segment.proof),bytes=E.raw(root,segment.bytes);
   E.need(p.epoch===identity.epoch&&p.symbol===r.symbol&&p.trade_date===identity.trade_date,'SEGMENT_EVENT_IDENTITY');
   const checked=require('./verify-trade-segment.cjs').verify({proof:p,bytes,expected:{epoch:identity.epoch,connection_id:segment.connection_id,symbol:r.symbol,trade_date:identity.trade_date,start_offset:segment.start_offset},asOf:now});
   E.need(checked.ok,'SEGMENT:'+checked.reason);
   const from=E.clock(segment.window?.from),to=E.clock(segment.window?.to);
   E.need(from<=to&&E.clock(p.opened_at)<=from&&E.clock(p.closed_at)>=to&&to<=E.clock(now),'SEGMENT_WINDOW_GAP');
   const trades=bytes.toString('utf8').trimEnd().split('\n').filter(Boolean).map(JSON.parse).filter(t=>E.clock(t.received_at)>=from&&E.clock(t.received_at)<=to);
   E.need(JSON.stringify(trades)===JSON.stringify(r.trade_evidence),'EVENT_TRADES_NOT_EXACT_SEGMENT_BYTES');
  }
 }
 return {status:'ORIGINAL_WRITER_PROVENANCE_VERIFIED',proof_sha256:refs.proof.sha256,checkpoint_sha256:refs.checkpoint.sha256};
}
module.exports={verify};
