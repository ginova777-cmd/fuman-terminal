'use strict';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function verify(rows,receipt){
 try{
 const evidence=receipt.writer_write_set.plan.source_evidence,a=evidence.allocation;
 if(a.contract!=='mother_pool_scan_allocation_v1'||['trade_date','canonical_run_id','writer_run_id','generation_id'].some(k=>a[k]!==receipt[k])||!Number.isFinite(Date.parse(a.created_at))||Date.parse(a.created_at)>Date.parse(receipt.observed_at))return false;
 if(!Number.isInteger(a.capacity)||a.capacity<1||a.capacity>60||a.minimum_fair_fraction!==0.1||!Array.isArray(a.inputs)||!a.inputs.length||new Set(a.inputs.map(r=>r.symbol)).size!==a.inputs.length)return false;
 if(a.inputs.some((r,i)=>r.original_rank!==i+1||!/^\d{4}$/.test(r.symbol)||typeof r.formal_pool_eligible!=='boolean'||typeof r.warming_pending!=='boolean'||typeof r.event_priority!=='boolean'))return false;
 if(!equal(a.requested_symbols,a.inputs.map(r=>r.symbol))||rows.length!==a.inputs.length||new Set(rows.map(r=>r.symbol)).size!==rows.length)return false;
 const eligible=a.inputs.filter(r=>r.formal_pool_eligible&&!r.warming_pending).sort((x,y)=>Number(y.event_priority)-Number(x.event_priority)||x.original_rank-y.original_rank);
 const n=Math.min(a.capacity,eligible.length),fairCount=Math.ceil(n/10),priority=eligible.slice(0,n-fairCount).map(r=>r.symbol),rotation=eligible.map(r=>r.symbol).filter(s=>!priority.includes(s)).sort();
 if(typeof a.cursor_before!=='string')return false;
 const split=rotation.findIndex(s=>s>a.cursor_before),cycle=split<0?rotation:[...rotation.slice(split),...rotation.slice(0,split)];
 const fair=cycle.slice(0,fairCount),selected=[...priority,...fair],queued=eligible.map(r=>r.symbol).filter(s=>!selected.includes(s));
 if(!equal(a.fair_symbols,fair)||!equal(a.selected_symbols,selected)||!equal(a.queued_symbols,queued)||a.cursor_after!==(fair.at(-1)||a.cursor_before)||a.fair_numerator!==fairCount||a.fair_denominator!==n||!Array.isArray(evidence.snapshot_symbols)||selected.some(s=>!evidence.snapshot_symbols.includes(s)))return false;
 for(const input of a.inputs){
 const row=rows.find(r=>r.symbol===input.symbol),qualifies=input.formal_pool_eligible&&!input.warming_pending;
 if(!row||row.status!=='READY'||row.formal_candidate_allowed!==false||row.priority!==input.original_rank||row.hot!==input.event_priority||row.deep_scan!==selected.includes(input.symbol)||row.fair_scan!==fair.includes(input.symbol))return false;
 if(row.allocation_bucket!==(fair.includes(input.symbol)?'FAIR_ROTATION':selected.includes(input.symbol)?'EVENT_OR_STRENGTH':qualifies?'QUEUED':'INELIGIBLE'))return false;
 if(row.queue_rank!==(queued.includes(input.symbol)?queued.indexOf(input.symbol)+1:null)||row.selection_rank!==(selected.includes(input.symbol)?selected.indexOf(input.symbol)+1:null)||row.reject_reason!==(qualifies?null:input.warming_pending?'WARMING_PENDING':'FORMAL_POOL_INELIGIBLE'))return false;
 }
 return true;
 }catch{return false;}
}
module.exports={verify};
