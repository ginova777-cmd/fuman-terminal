'use strict';
const {inspectParent}=require('./mother-pool-discovery-union-producer');
const {identityFields}=require('./mother-pool-module-write-set');
const MODULES=['B12','B13','B14','B19','B20','B21','B22','B23'];
function inspect({identity,symbols,parents,side,asOf}){
 if(!Array.isArray(symbols)||!symbols.length||symbols.some(s=>!/^\d{4}$/.test(s))||new Set(symbols).size!==symbols.length)throw Error('COMBINATION_REQUESTED_SET');
 const maps={},failures={};
 for(const id of MODULES.filter(x=>!['B14','B20'].includes(x))){
  try{maps[id]=inspectParent(parents?.[id],id,identity,asOf);}catch(e){failures[id]=String(e.message);}
 }
 try{
  if(side?.contract!=='minute_side_write_plan_v1'||side.status!=='written'||identityFields.some(k=>side[k]!==identity[k]))throw Error('SIDE_COMMITTED_IDENTITY_REQUIRED');
  for(const key of ['requested_symbols','written_symbols','data_gap_symbols','round_written_symbols'])if(!Array.isArray(side[key])||new Set(side[key]).size!==side[key].length)throw Error('SIDE_SET_INVALID:'+key);
  const req=side.requested_symbols,wr=side.written_symbols,gap=side.data_gap_symbols;
  if(req.some(s=>!side.round_written_symbols.includes(s)||(!wr.includes(s)&&!gap.includes(s)))||side.round_written_symbols.some(s=>!req.includes(s))||[...wr,...gap].some(s=>!req.includes(s)))throw Error('SIDE_WRITE_PARTITION');
  if(!Array.isArray(side.source_rows)||!Array.isArray(side.round_rows)||side.source_rows.length!==wr.length||new Set(side.source_rows.map(r=>r.symbol)).size!==wr.length||wr.some(s=>!side.source_rows.some(r=>r.symbol===s))||side.round_rows.length!==req.length||new Set(side.round_rows.map(r=>r.symbol)).size!==req.length)throw Error('SIDE_ROW_SET');
  const time=Date.parse(side.observed_at),now=Date.parse(asOf);
  if(!Number.isFinite(time)||!Number.isFinite(now)||time>now)throw Error('SIDE_TIME');
  for(const id of ['B14','B20'])maps[id]=new Map(side.round_rows.map(round=>{
   const source=side.source_rows.find(r=>r.symbol===round.symbol);
   const bound=source&&wr.includes(round.symbol)&&source.source_hash===round.source_hash&&Date.parse(source.minute_start)===Date.parse(round.minute_start);
   return [round.symbol,{status:bound&&!gap.includes(round.symbol)&&!round.first_blocker?'READY':'DATA_GAP',data_gap_reason:round.first_blocker||(!bound?'SIDE_SOURCE_BINDING':null),source:source||null,round}];
  }));
 }catch(e){failures.B14=failures.B20=String(e.message);}
 const rows=symbols.map(symbol=>{
  const sources={},data_gaps=[];
  for(const id of MODULES){const row=maps[id]?.get(symbol);sources[id]=row||null;if(failures[id]||!row||row.status!=='READY')data_gaps.push({module_id:id,reason:failures[id]||row?.data_gap_reason||'UPSTREAM_SYMBOL_MISSING'});}
  return {symbol,status:data_gaps.length?'DATA_GAP':'SOURCE_ROWS_AVAILABLE',data_gaps,sources};
 });
 return {contract:'mother_pool_combination_source_coverage_v1',...identity,observed_at:asOf,requested_symbols:[...symbols],rows,source_failures:failures,complete:false};
}
module.exports={inspect,MODULES};
