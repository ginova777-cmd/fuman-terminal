'use strict';
const {evaluate,SOURCE}=require('./mother-pool-ma20-producer');
function verify(moduleId,rows,r){try{
 const symbols=r.writer_write_set.plan.requested_symbols;
 require('./mother-pool-ma20-producer').validateSnapshot(r.writer_write_set.plan.source_evidence?.snapshot,r,symbols,r.observed_at);
 if(!Array.isArray(rows)||rows.length!==symbols.length||new Set(rows.map(x=>x.symbol)).size!==symbols.length||rows.some(x=>!symbols.includes(x.symbol)))return false;
 const ready=[];
 for(const row of rows){
  if(!Array.isArray(row.natural_bars)||row.natural_bars.length>20||!Array.isArray(row.rejected_inputs)||row.source!==SOURCE||row.source_contract!==`preopen_${moduleId.toLowerCase()}_${moduleId==='A08'?'ma20':'ma20_coverage'}_receipt_v1`||row.event_time!==r.observed_at)return false;
  const e=evaluate(row.natural_bars,row.symbol,r.trade_date,r.observed_at,row.rejected_inputs.length>0);
  if(Object.keys(e).some(k=>JSON.stringify(e[k])!==JSON.stringify(row[k])))return false;
  if(row.source_updated_at!==(row.natural_bars.at(-1)?.available_at||r.observed_at))return false;
  if(e.ready)ready.push(row.symbol);
  if(moduleId==='A08'&&(!e.ready||row.status!=='READY'||row.data_gap_reason!==null))return false;
 }
 if(moduleId==='A09'){
  const missing=symbols.filter(x=>!ready.includes(x)),pct=ready.length/symbols.length*100;
  if(pct<90)return false;
  if(rows.some(x=>x.status!=='READY'||x.data_gap_reason!==null||x.ready_count!==ready.length||x.checked_count!==symbols.length||x.coverage_pct!==pct||x.threshold_pct!==90||JSON.stringify(x.not_ready_symbols)!==JSON.stringify(missing)))return false;
 }
 return true;
}catch{return false;}}
module.exports={verify};
