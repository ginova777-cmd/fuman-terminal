'use strict';
const crypto=require('node:crypto');
const identityFields=['trade_date','canonical_run_id','writer_run_id','generation_id','mother_pool_run_id','snapshot_generation','snapshot_sequence'];
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x ?? null)).digest('hex');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const syms=rows=>rows.map(x=>String(x.symbol||''));
const unique=a=>Array.isArray(a)&&a.every(x=>typeof x==='string'&&x.length>0)&&new Set(a).size===a.length;
function reconcile(writeSet,db,anon,identity,moduleId){
 const failed=[]; const need=(v,c)=>{if(!v)failed.push(c);};
 need(writeSet?.contract==='mother_pool_module_write_set_v1'&&writeSet.module_id===moduleId,'MODULE_WRITE_SET_REQUIRED');
 for(const k of identityFields)need(writeSet?.[k]===identity[k],'WRITE_SET_IDENTITY:'+k);
 const req=writeSet?.plan?.requested_symbols||[],written=writeSet?.ack?.written_symbols||[],gaps=writeSet?.plan?.data_gap_symbols||[];
 for(const [k,a] of Object.entries({requested:req,written,data_gap:gaps}))need(unique(a),'INVALID_SET:'+k);
 need(writeSet?.plan_hash===hash(writeSet?.plan),'PLAN_HASH_MISMATCH');
 need(writeSet?.ack?.plan_hash===writeSet?.plan_hash&&writeSet?.ack?.committed===true,'WRITE_ACK_REQUIRED');
 need(Number.isFinite(Date.parse(writeSet?.plan?.created_at))&&Number.isFinite(Date.parse(writeSet?.ack?.committed_at))&&Date.parse(writeSet.ack.committed_at)>=Date.parse(writeSet.plan.created_at),'WRITE_TIME_ORDER');
 need(written.every(x=>req.includes(x))&&gaps.every(x=>req.includes(x)),'WRITE_SET_OUTSIDE_PLAN');
 const sets=[syms(db),syms(anon)]; const missing=[...new Set(sets.flatMap(a=>req.filter(x=>!a.includes(x))))];
 const extra=[...new Set(sets.flatMap(a=>a.filter(x=>!req.includes(x))))];
 const dup=[...new Set(sets.flatMap(a=>a.filter((x,i)=>a.indexOf(x)!==i)))];
 need(!missing.length,'MISSING_SYMBOLS');need(!extra.length,'EXTRA_SYMBOLS');need(!dup.length,'DUPLICATE_SYMBOLS');
 need(req.every(x=>written.includes(x))&&!gaps.length,'SOURCE_GAP_OR_WRITE_MISSING');
 for(const rows of [db,anon])for(const row of rows)for(const k of identityFields)need(row[k]===identity[k],'ROW_IDENTITY:'+k);
 const plannedRows=writeSet?.plan?.rows;
 need(Array.isArray(plannedRows)&&plannedRows.length===req.length&&unique((plannedRows||[]).map(r=>r.symbol))&&req.every(s=>(plannedRows||[]).some(r=>r.symbol===s)),'PRODUCER_ROWS_SET_MISMATCH');
 const plannedBySymbol=new Map((Array.isArray(plannedRows)?plannedRows:[]).map(r=>[r.symbol,r]));
 for(const [role,rows] of [['db',db],['anon',anon]])for(const row of rows){
  const expected=plannedBySymbol.get(row.symbol);
  need(Boolean(expected),'PRODUCER_ROW_MISSING:'+row.symbol);
  if(expected)for(const [field,value] of Object.entries(expected))if(value!==undefined)
   need(JSON.stringify(stable(row[field]))===JSON.stringify(stable(value)),'PRODUCER_VALUE_MISMATCH:'+role+':'+row.symbol+':'+field);
 }
 const special=structuredClone(writeSet?.plan?.special_evidence||{});
 // Transport only producer-owned evidence. Never synthesize success from a clock.
 const specialFields=moduleId==='B18'?['closeout','closeout_at']:[];
 for(const k of specialFields){need(special[k]!=null,'SPECIAL_EVIDENCE_MISSING:'+k);for(const rows of [db,anon])need(rows.length>0&&rows.every(r=>JSON.stringify(stable(r[k]))===JSON.stringify(stable(special[k]))),'SPECIAL_EVIDENCE_READBACK:'+k);}
 if(moduleId==='B22'){
  const sourceRows=writeSet?.plan?.rows||[];
  special.opening_range={by_symbol:Object.fromEntries(sourceRows.map(r=>[r.symbol,r.opening_range]))};
  need(sourceRows.length===req.length&&req.every(s=>special.opening_range.by_symbol[s]),'OPENING_RANGE_PRODUCER_REQUIRED');
  for(const rows of [db,anon])need(rows.every(r=>JSON.stringify(stable(r.opening_range))===JSON.stringify(stable(special.opening_range.by_symbol[r.symbol]))),'OPENING_RANGE_READBACK_MISMATCH');
  specialFields.push('opening_range');
 }
 return {requested_symbols:req,written_symbols:written,data_gap_symbols:gaps,readback_symbols:[...new Set(sets[0])],missing_symbols:missing,extra_symbols:extra,duplicate_symbols:dup,failed_checks:[...new Set(failed)],special_evidence:Object.fromEntries(specialFields.filter(k=>special[k]!=null).map(k=>[k,special[k]]))};
}
module.exports={reconcile,hash,identityFields};

