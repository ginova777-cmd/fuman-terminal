'use strict';
const fs=require('node:fs'),readline=require('node:readline');
function distribution(a){a=[...a].sort((x,y)=>x-y);const q=p=>a.length?a[Math.ceil(a.length*p)-1]:null;return {n:a.length,p50:q(.5),p95:q(.95),p99:q(.99),max:a.length?a.at(-1):null};}
async function summarize(file){
 if(fs.statSync(file).size>64*1048576)throw Error('MONITOR_FILE_LIMIT');
 const parents=new Map(),gaps=[];let expected=1,ended=false;
 for await(const line of readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity})){
  let r;try{if(Buffer.byteLength(line)>32768)throw Error('LINE_LIMIT');r=JSON.parse(line);}catch{gaps.push('INVALID_OR_TRUNCATED_LINE');continue;}
  if(r.telemetry_sequence!==expected)gaps.push('TELEMETRY_SEQUENCE_GAP');expected=r.telemetry_sequence+1;
  if(r.event==='MONITOR_SESSION_END'){ended=true;continue;}if(ended)gaps.push('RECORD_AFTER_SESSION_END');if(r.event==='MONITOR_GAP'){gaps.push(r.reason);continue;}if(!r.parent_id)continue;
  if(!parents.has(r.parent_id)){if(parents.size>=20000)throw Error('MONITOR_PARENT_LIMIT');parents.set(r.parent_id,{});}
  const p=parents.get(r.parent_id);if(r.event==='DISPATCH'&&p.dispatched)gaps.push('DUPLICATE_DISPATCH');
  if(r.event==='DISPATCH')p.dispatched=true;
  // Final Evidence updates must not erase original cache ACK or change counts.
  for(const [k,v] of Object.entries(r)){if(v===null&&['ack_at','ack_latency_ms','cache_write_started_at','cache_write_finished_at','cache_write_duration_ms'].includes(k)&&p[k]!=null)continue;p[k]=v;}
 }
 if(!ended)gaps.push('MONITOR_SESSION_END_MISSING');
 const all=[...parents.values()],dispatched=all.filter(p=>p.dispatched),rows=dispatched.map(p=>p.row_count),full=dispatched.filter(p=>p.capture_completed===true),partial=dispatched.filter(p=>p.capture_completed!==true);
 for(const p of all){if(!p.dispatched)gaps.push('ORPHAN_PARENT');if(!p.finished_at)gaps.push('UNFINISHED_PARENT');if(p.evidence_terminal_status==='PENDING_COMMIT')gaps.push('EVIDENCE_TERMINAL_UNOBSERVED');}
 const ack={};for(const mode of ['OFF','ON','BYPASSED','BLOCKED'])ack[mode]=distribution(dispatched.filter(p=>p.evidence_mode===mode&&p.save_ok===true&&Number.isFinite(p.ack_latency_ms)).map(p=>p.ack_latency_ms));
 const ackDispatch={};for(const mode of ['OFF','ON'])ackDispatch[mode]=distribution(dispatched.filter(p=>(p.dispatch_evidence_mode||p.evidence_mode)===mode&&p.save_ok===true&&Number.isFinite(p.ack_latency_ms)).map(p=>p.ack_latency_ms));
 const reasons={};for(const p of dispatched)if(p.block_gap_reason)reasons[p.block_gap_reason]=(reasons[p.block_gap_reason]||0)+1;
 return {contract:'mother-shadow-summary-v1',monitor_gap:gaps.length>0,gaps:[...new Set(gaps)],durability:'OS_APPEND_NOT_FSYNC; abrupt process loss requires external monitor gap declaration',parent_rows:{...distribution(rows),gt5000:rows.filter(x=>x>5000).length,gt10000:rows.filter(x=>x>10000).length,ge19000:rows.filter(x=>x>=19000).length,eq20000:rows.filter(x=>x===20000).length},changed_events_complete:distribution(full.map(p=>p.changed_events_observed)),changed_partial_parent_count:partial.length,partial_counts:partial.map(p=>({parent_id:p.parent_id,known:p.changed_events_observed??null,unknown_remaining:true,reason:p.capture_stop_reason||p.block_gap_reason||'NOT_OBSERVED'})),ack_latency_ms:ack,ack_dispatch_cohorts_ms:ackDispatch,reasons,parents:all};
}
if(require.main===module)summarize(process.argv[2]).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={summarize,distribution};
