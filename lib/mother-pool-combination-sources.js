'use strict';
const {inspectParent}=require('./mother-pool-discovery-union-producer');
const {identityFields}=require('./mother-pool-module-write-set');
const MODULES=['B12','B13','B19','B21','B22','B23'];
function inspect({identity,symbols,parents,side,asOf}){
 if(!Array.isArray(symbols)||!symbols.length||symbols.some(s=>!/^\d{4}$/.test(s))||new Set(symbols).size!==symbols.length)throw Error('COMBINATION_REQUESTED_SET');
 const maps={},failures={};
 for(const id of MODULES.filter(x=>!['B14','B20'].includes(x))){
  try{maps[id]=inspectParent(parents?.[id],id,identity,asOf);}catch(e){failures[id]=String(e.message);}
 }
 const rows=symbols.map(symbol=>{
  const sources={},data_gaps=[];
  for(const id of MODULES){const row=maps[id]?.get(symbol);sources[id]=row||null;if(failures[id]||!row||row.status!=='READY')data_gaps.push({module_id:id,reason:failures[id]||row?.data_gap_reason||'UPSTREAM_SYMBOL_MISSING'});}
  return {symbol,status:data_gaps.length?'DATA_GAP':'SOURCE_ROWS_AVAILABLE',data_gaps,sources};
 });
 return {contract:'mother_pool_combination_source_coverage_v1',...identity,observed_at:asOf,requested_symbols:[...symbols],rows,source_failures:failures,complete:false};
}
module.exports={inspect,MODULES};
