'use strict';
const {inspectParent}=require('./mother-pool-discovery-union-producer');
const {isDeepStrictEqual}=require('node:util');
const IDS=['A15','A16','A17'];
const CONTRACT='preopen_a18_branch_quality_v1';
function collect({identity,symbols,parents,asOf}){
 if(!Number.isFinite(Date.parse(asOf))||!Array.isArray(symbols)||!symbols.length||new Set(symbols).size!==symbols.length)throw Error('A18_SCOPE_INVALID');
 const inspected={};
 for(const id of IDS){try{
  const rows=inspectParent(parents?.[id],id,identity,asOf);
  if(rows.size!==symbols.length||symbols.some(s=>!rows.has(s)))throw Error('A18_PARENT_SET:'+id);
  inspected[id]={rows};
 }catch(error){inspected[id]={error:String(error.message)};}}
 return {...identity,module_id:'A18',created_at:asOf,requested_symbols:[...symbols],source_evidence:{parents:Object.fromEntries(IDS.filter(id=>parents?.[id]).map(id=>[id,parents[id]]))},rows:symbols.map(symbol=>{
  const branches=Object.fromEntries(IDS.map(id=>{const p=inspected[id],r=p.rows?.get(symbol);return [id,{status:r?.status==='READY'?'READY':'DATA_GAP',reason:p.error||r?.data_gap_reason||(r?.status==='READY'?null:'PARENT_SOURCE_MISSING'),plan_hash:p.rows?parents[id].plan_hash:null}];}));
  const failed=IDS.filter(id=>branches[id].status!=='READY');
  return {symbol,status:failed.length?'DATA_GAP':'READY',data_gap_reason:failed.length?failed.map(id=>id+':'+branches[id].reason).join('|'):null,branches,first_blocker:failed[0]||null,ready_branches:IDS.length-failed.length,gap_branches:failed.length,source:'MotherPool.A15+A16+A17.committed_writer_plans',source_contract:CONTRACT,source_updated_at:asOf,event_time:asOf,is_synthetic:false,replay:false,look_ahead:false,formal_candidate_allowed:false,publish_allowed:false};
 })};
}
function verify(rows,round){try{
 const plan=round.writer_write_set.plan,expected=collect({identity:round,symbols:plan.requested_symbols,parents:plan.source_evidence?.parents,asOf:round.observed_at});
 if(rows.length!==expected.rows.length||new Set(rows.map(r=>r.symbol)).size!==rows.length)return false;
 return expected.rows.every(e=>{const row=rows.find(r=>r.symbol===e.symbol);return e.status==='READY'&&row&&Object.entries(e).every(([k,v])=>isDeepStrictEqual(row[k],v));});
}catch{return false;}}
module.exports={collect,verify};
