'use strict';
function allocate(rows,{identity,previous=null,asOf,limit=60}){
 if(!Array.isArray(rows)||new Set(rows.map(r=>r.symbol)).size!==rows.length||rows.some(r=>!/^\d{4}$/.test(r.symbol)))throw Error('ALLOCATION_UNIVERSE_INVALID');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(identity?.trade_date||'')||identity.canonical_run_id!==`fugle_daytrade_source:${identity.trade_date.replaceAll('-','')}:canonical`||!identity.writer_run_id||!identity.generation_id||!Number.isFinite(Date.parse(asOf)))throw Error('ALLOCATION_IDENTITY_INVALID');
 const capacity=Math.max(1,Math.min(60,Math.floor(Number(limit)||60)));
 const inputs=rows.map((r,i)=>({symbol:r.symbol,original_rank:i+1,formal_pool_eligible:r.payload?.formal_pool_eligible===true,warming_pending:r.payload?.warming_pending===true,event_priority:r.payload?.hot_burst_fast_path===true,score:Number.isFinite(r.payload?.upgrade_score)?r.payload.upgrade_score:null}));
 const ranked=inputs.filter(r=>r.formal_pool_eligible&&!r.warming_pending).sort((a,b)=>Number(b.event_priority)-Number(a.event_priority)||a.original_rank-b.original_rank);
 const size=Math.min(capacity,ranked.length),reserve=Math.ceil(size*0.1),priority=ranked.slice(0,size-reserve),prioritySet=new Set(priority.map(r=>r.symbol));
 const rotation=ranked.filter(r=>!prioritySet.has(r.symbol)).map(r=>r.symbol).sort();
 const sameDay=previous?.trade_date===identity.trade_date&&previous?.canonical_run_id===identity.canonical_run_id;
 const cursor=sameDay?(previous.writer_run_id===identity.writer_run_id?previous.cursor_before:previous.cursor_after)||'':'';
 const start=rotation.findIndex(s=>s>cursor),offset=start<0?0:start;
 const fair=Array.from({length:reserve},(_,i)=>rotation[(offset+i)%rotation.length]);
 const chosen=[...priority.map(r=>r.symbol),...fair],chosenSet=new Set(chosen),fairSet=new Set(fair),queue=ranked.filter(r=>!chosenSet.has(r.symbol)).map(r=>r.symbol);
 const eligibleSet=new Set(ranked.map(r=>r.symbol));
 const assignments=inputs.map(r=>({symbol:r.symbol,priority:r.original_rank,hot:r.event_priority,deep_scan:chosenSet.has(r.symbol),fair_scan:fairSet.has(r.symbol),allocation_bucket:fairSet.has(r.symbol)?'FAIR_ROTATION':chosenSet.has(r.symbol)?'EVENT_OR_STRENGTH':eligibleSet.has(r.symbol)?'QUEUED':'INELIGIBLE',queue_rank:queue.includes(r.symbol)?queue.indexOf(r.symbol)+1:null,selection_rank:chosen.includes(r.symbol)?chosen.indexOf(r.symbol)+1:null,reject_reason:eligibleSet.has(r.symbol)?null:r.warming_pending?'WARMING_PENDING':'FORMAL_POOL_INELIGIBLE'}));
 return {contract:'mother_pool_scan_allocation_v1',...identity,created_at:asOf,capacity,minimum_fair_fraction:0.1,cursor_before:cursor,cursor_after:fair.at(-1)||cursor,requested_symbols:inputs.map(r=>r.symbol),inputs,assignments,selected_symbols:chosen,queued_symbols:queue,fair_symbols:fair,fair_numerator:fair.length,fair_denominator:chosen.length};
}
function apply(rows,options){
 const receipt=allocate(rows,options),bySymbol=new Map(receipt.assignments.map(r=>[r.symbol,r]));
 for(const row of rows){const a=bySymbol.get(row.symbol);row.deepScanEligible=a.deep_scan;row.deep_scan_eligible=a.deep_scan;Object.assign(row.payload,{deep_scan_eligible:a.deep_scan,scan_allocation:a,canonical_pool_layer:a.deep_scan?'deep_scan_pool':row.payload.warming_pending?'warming_pending':'priority_pool'});}
 // The actual Writer's rank-based consumers must see the same selected set.
 const byRow=new Map(rows.map(r=>[r.symbol,r]));
 const order=[...receipt.selected_symbols,...receipt.queued_symbols,...receipt.assignments.filter(a=>a.allocation_bucket==='INELIGIBLE').map(a=>a.symbol)];
 rows.splice(0,rows.length,...order.map(s=>byRow.get(s)));
 rows.forEach((row,i)=>{row.priority_rank=i+1;row.payload.priority_rank=i+1;});
 rows.deepScanAllocation=receipt;return receipt;
}
module.exports={allocate,apply};
