'use strict';
const E=require('./mother-pool-event-evidence.cjs');
const {identityFields}=require('./mother-pool-module-write-set');
// Projection only. It cannot manufacture missing ACK/checkpoint/proof/readbacks.
function build({root,writeSet,currentFile,sourceReferences,receivedAt,sourcesReadyAt,writerProvenance=null,requireOriginalWriter=false}){
 E.need(writeSet?.module_id==='B24','B24_WRITE_SET_REQUIRED');
 const current=E.live(root,currentFile),jobs=[],blocked=[];
 for(const row of writeSet.plan.rows){
  for(const pair of require('./mother-pool-directional-combinations').combine(row.events||[],{asOf:sourcesReadyAt})){
   if(!pair.eligible_for_notifier)continue;
   const events=pair.event_sequence.map(x=>row.events.find(e=>e.event_id===x.event_id));
   const required=[...new Set(events.flatMap(e=>e.module_id==='B21'?['B21','B23']:[e.module_id]))];
   const sources=Object.fromEntries(required.map(id=>[id,sourceReferences?.[id+':'+row.symbol]]));
   const provenance=writerProvenance?.[row.symbol];
   if(requireOriginalWriter&&!provenance){blocked.push({symbol:row.symbol,event_ids:events.map(e=>e.event_id),reason:'ORIGINAL_WRITER_PROVENANCE_REQUIRED'});continue;}
   if(Object.values(sources).some(x=>!x)){blocked.push({symbol:row.symbol,event_ids:events.map(e=>e.event_id),reason:'EVENT_SOURCE_PROOF_REFERENCES_REQUIRED'});continue;}
   const bundle={...Object.fromEntries(identityFields.map(k=>[k,writeSet[k]])),contract:'b24_event_evidence_v1',scope:'TEST_ONLY',epoch:current.epoch,symbol:row.symbol,events,sources,received_at:receivedAt,sources_ready_at:sourcesReadyAt};
   if(provenance){bundle.provenance_mode='ORIGINAL_WRITER';bundle.writer_provenance=provenance;}
   jobs.push({bundleRef:E.save(root,bundle)});
  }
 }
 return {scope:'TEST_ONLY',jobs,blocked,full_market_acceptance:'NOT_EVALUATED'};
}
module.exports={build};
