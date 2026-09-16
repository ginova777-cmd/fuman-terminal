"use strict";
const {randomUUID}=require("crypto");
function newIdentity(source,writer,tradeDate){
  if(!source||!writer||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate))throw Error("writer_identity_invalid_input");
  const generation=randomUUID();
  return Object.freeze({trade_date:tradeDate,source_trade_date:tradeDate,source_name:source,
    canonical_run_id:`${source}:${tradeDate.replace(/-/g,"")}:canonical`,
    writer_run_id:`${writer}:${tradeDate.replace(/-/g,"")}:${generation}`,generation_id:generation});
}
function requireIdentity(identity,tradeDate){
  if(!identity||identity.trade_date!==tradeDate||!identity.writer_run_id||!identity.generation_id)throw Error("writer_tick_identity_missing_or_cross_day");
  return identity;
}
function verifyRows(rows,expected){
  const failures=[];
  if(!rows.length)failures.push("writer_readback_empty");
  for(const field of ["trade_date","canonical_run_id","writer_run_id","generation_id"]){
    const values=new Set(rows.map(r=>r[field]));
    if(values.size!==1||!rows[0]?.[field])failures.push(`${field}_missing_or_mixed`);
    if(expected?.[field]&&rows.some(r=>r[field]!==expected[field]))failures.push(`${field}_readback_mismatch`);
  }
  if(new Set(rows.map(r=>r.symbol)).size!==rows.length)failures.push("writer_readback_duplicate_symbols");
  return {ok:failures.length===0,failed_checks:failures};
}
module.exports={newIdentity,requireIdentity,verifyRows};
