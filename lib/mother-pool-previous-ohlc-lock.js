'use strict';
const fs=require('node:fs'),path=require('node:path');
function content(row,identity){return {contract:'mother_pool_a15_day_lock_v1',trade_date:identity.trade_date,canonical_run_id:identity.canonical_run_id,symbol:row.symbol,source_date:row.source_date,source_hash:row.source_hash};}
function apply(plan,directory){
 fs.mkdirSync(directory,{recursive:true});
 for(const row of plan.rows){
  if(row.status!=='READY')continue;
  if(!/^\d{4}$/.test(row.symbol))throw Error('A15_LOCK_SYMBOL_INVALID');
  const expected=content(row,plan),file=path.join(directory,row.symbol+'.json');
  const initial={...expected,locked_at:plan.created_at};
  let lock;
  try{fs.writeFileSync(file,JSON.stringify(initial),{flag:'wx'});lock=initial;}
  catch(error){if(error.code!=='EEXIST')throw error;try{lock=JSON.parse(fs.readFileSync(file,'utf8'));}catch{lock=null;}}
  if(!valid(lock,row,plan,plan.created_at)){
   row.status='DATA_GAP';row.data_gap_reason='A15_IMMUTABLE_SOURCE_CONFLICT';row.source_lock=lock;continue;
  }
  row.locked_at=lock.locked_at;row.source_lock=lock;
 }
 return plan;
}
function valid(lock,row,identity,asOf){
 const expected=content(row,identity),time=Date.parse(lock?.locked_at),now=Date.parse(asOf);
 return Boolean(lock)&&Object.entries(expected).every(([k,v])=>lock[k]===v)&&Number.isFinite(time)&&Number.isFinite(now)&&time<=now&&new Date(time+28800000).toISOString().slice(0,10)===identity.trade_date;
}
module.exports={apply,valid};
