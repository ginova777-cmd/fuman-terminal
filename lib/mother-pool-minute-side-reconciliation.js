'use strict';
const {identityFields,validateIdentity}=require('./mother-pool-minute-side-persistence');
const fields=[...identityFields,'symbol','event_time','source_hash','inside_1m','outside_1m','unknown_1m','total_1m','volume_unit','aggregation','side_volume_timestamp','source','start_boundary_identity','end_boundary_identity','is_synthetic','baseline_method','baseline_sample_count','baseline_value','raw_outside_ratio','outside_strength','raw_inside_ratio','inside_strength','dynamic_ratio','side_state','written','requested','first_blocker'];
const sorted=a=>[...new Set(a)].sort();
const difference=(a,b)=>a.filter(x=>!b.includes(x));
function reconcile(writeSet,dbRows,anonRows,identity){
 const failed=[],issues=[];
 try{validateIdentity(identity);}catch(e){failed.push(e.message);}
 for(const k of identityFields)if(writeSet?.[k]!==identity[k])failed.push('WRITE_SET_IDENTITY:'+k);
 const names=['requested_symbols','written_symbols','data_gap_symbols','round_written_symbols'];
 for(const n of names)if(!Array.isArray(writeSet?.[n])||writeSet[n].some(x=>typeof x!=='string'||!/^\d{4}$/.test(x))||new Set(writeSet[n]).size!==writeSet[n].length)failed.push('WRITE_SET_ARRAY:'+n);
 const req=writeSet?.requested_symbols||[],written=writeSet?.written_symbols||[],gaps=writeSet?.data_gap_symbols||[];
 if(writeSet?.contract!=='minute_side_write_plan_v1'||writeSet.status!=='written')failed.push('WRITE_SET_NOT_COMMITTED');
 if(difference(written,req).length||difference(gaps,req).length||difference(req,sorted([...written,...gaps])).length||difference(req,writeSet?.round_written_symbols||[]).length)failed.push('WRITE_SET_PARTITION');
 const sourceRows=writeSet?.source_rows,roundRows=writeSet?.round_rows;
 if(!Array.isArray(sourceRows)||new Set(sourceRows.map(x=>x.symbol)).size!==sourceRows.length||sourceRows.length!==written.length||sourceRows.some(x=>!written.includes(x.symbol)))failed.push('WRITE_SOURCE_SET_MISMATCH');
 if(!Array.isArray(roundRows)||new Set(roundRows.map(x=>x.symbol)).size!==roundRows.length||roundRows.length!==req.length||roundRows.some(x=>!req.includes(x.symbol)))failed.push('WRITE_ROUND_SET_MISMATCH');
 const sourceMap=new Map((Array.isArray(sourceRows)?sourceRows:[]).map(x=>[x.symbol,x]));
 const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
 const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
 const sourceFields=['inside_1m','outside_1m','unknown_1m','total_1m','volume_unit','aggregation','source','start_boundary_identity','end_boundary_identity','is_synthetic','source_hash','baseline_method','raw_outside_ratio','outside_strength','raw_inside_ratio','inside_strength'];
 const sets={};let duplicates=[];
 for(const [role,rows] of [['db',dbRows],['anon',anonRows]]){
  const syms=rows.map(r=>r.symbol);sets[role]=sorted(syms);duplicates.push(...syms.filter((s,i)=>syms.indexOf(s)!==i));
  for(const r of rows){
   for(const k of identityFields)if(r[k]!==identity[k])failed.push(role+':ROW_IDENTITY:'+k);
   if(!req.includes(r.symbol))failed.push(role+':EXTRA_SYMBOL');
   if(written.includes(r.symbol)&&r.written!==true)failed.push(role+':WRITTEN_FLAG');
   const expected=(writeSet?.round_rows||[]).find(x=>x.symbol===r.symbol);
   if(!expected||r.source_hash!==expected.source_hash||Date.parse(r.event_time)!==Date.parse(expected.minute_start))failed.push(role+':ROUND_SOURCE_BINDING');
   const source=sourceMap.get(r.symbol),direction=r.module_id==='B14'?'outside':r.module_id==='B20'?'inside':null;
   if(!direction||(identity.module_id&&r.module_id!==identity.module_id))failed.push(role+':MODULE_IDENTITY');
   if(written.includes(r.symbol)){
    if(!source)failed.push(role+':WRITER_SOURCE_MISSING');
    else {
     for(const field of sourceFields)if(!same(r[field],source[field]))failed.push(role+':WRITER_VALUE_MISMATCH:'+r.symbol+':'+field);
     for(const [field,original] of [['baseline_sample_count',direction+'_baseline_sample_count'],['baseline_value',direction+'_baseline_value'],['dynamic_ratio',direction+'_dynamic_ratio'],['side_state',direction+'_side_state']])if(!same(r[field],source[original]))failed.push(role+':WRITER_VALUE_MISMATCH:'+r.symbol+':'+field);
     for(const [field,original] of [['event_time','minute_start'],['side_volume_timestamp','side_volume_timestamp']])if(!Number.isFinite(Date.parse(source[original]))||Date.parse(r[field])!==Date.parse(source[original]))failed.push(role+':WRITER_VALUE_MISMATCH:'+r.symbol+':'+field);
    }
   }
   if(r.first_blocker)failed.push(role+':DATA_GAP:'+r.symbol);
  }
 }
 const missing=sorted([...difference(req,sets.db),...difference(req,sets.anon)]),extra=sorted([...difference(sets.db,req),...difference(sets.anon,req)]);
 const dm=new Map(dbRows.map(r=>[r.symbol,r])),am=new Map(anonRows.map(r=>[r.symbol,r]));
 for(const symbol of sorted([...sets.db,...sets.anon]))for(const field of fields)if(JSON.stringify(dm.get(symbol)?.[field])!==JSON.stringify(am.get(symbol)?.[field]))issues.push({symbol,field,db:dm.get(symbol)?.[field],anon:am.get(symbol)?.[field]});
 if(missing.length)failed.push('MISSING_SYMBOLS');if(extra.length)failed.push('EXTRA_SYMBOLS');if(duplicates.length)failed.push('DUPLICATE_SYMBOLS');if(issues.length)failed.push('DB_ANON_FIELD_DIFFERENCES');
 if(gaps.length||difference(req,written).length)failed.push('SOURCE_DATA_GAP_OR_WRITE_FAILED');
 return {requested_symbols:req,written_symbols:written,data_gap_symbols:gaps,readback_symbols:sets.db,anon_readback_symbols:sets.anon,missing_symbols:missing,extra_symbols:extra,duplicate_symbols:sorted(duplicates),requested_not_written:difference(req,written),written_not_readback:difference(written,sets.db),db_anon_differences:issues,failed_checks:sorted(failed)};
}
module.exports={reconcile,fields};
