'use strict';
const {hash,identityFields}=require('./mother-pool-module-write-set');
const registry=require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json');
function inspectParent(writeSet,moduleId,identity,asOf){
 if(writeSet?.contract!=='mother_pool_module_write_set_v1'||writeSet.module_id!==moduleId||writeSet.module_contract!==registry.modules[moduleId])throw Error('UNION_PARENT_CONTRACT:'+moduleId);
 if(identityFields.some(k=>writeSet[k]!==identity[k]||writeSet.ack?.[k]!==identity[k]))throw Error('UNION_PARENT_IDENTITY:'+moduleId);
 const plan=writeSet.plan,ack=writeSet.ack,requested=plan?.requested_symbols,rows=plan?.rows;
 if(!Array.isArray(requested)||!requested.length||requested.some(s=>typeof s!=='string'||!/^\d{4}$/.test(s))||new Set(requested).size!==requested.length||!Array.isArray(rows)||rows.length!==requested.length||new Set(rows.map(r=>r.symbol)).size!==requested.length||rows.some(r=>!requested.includes(r.symbol)))throw Error('UNION_PARENT_REQUESTED_SET:'+moduleId);
 if(writeSet.plan_hash!==hash(plan)||ack?.committed!==true||ack.module_id!==moduleId||ack.plan_hash!==writeSet.plan_hash||!Array.isArray(ack.written_symbols)||ack.written_symbols.length!==requested.length||new Set(ack.written_symbols).size!==requested.length||requested.some(s=>!ack.written_symbols.includes(s)))throw Error('UNION_PARENT_WRITE_ACK:'+moduleId);
 const created=Date.parse(plan.created_at),committed=Date.parse(ack.committed_at),end=Date.parse(asOf);
 if(![created,committed,end].every(Number.isFinite)||created>committed||committed>end)throw Error('UNION_PARENT_TIME:'+moduleId);
 if(rows.some(r=>!['READY','DATA_GAP'].includes(r.status)||r.is_synthetic!==false||r.replay!==false||r.look_ahead!==false||(r.status==='DATA_GAP'&&!r.data_gap_reason)))throw Error('UNION_PARENT_SOURCE_STATUS:'+moduleId);
 const gaps=rows.filter(r=>r.status==='DATA_GAP').map(r=>r.symbol);
 if(!Array.isArray(plan.data_gap_symbols)||plan.data_gap_symbols.length!==gaps.length||new Set(plan.data_gap_symbols).size!==gaps.length||gaps.some(s=>!plan.data_gap_symbols.includes(s)))throw Error('UNION_PARENT_GAP_SET:'+moduleId);
 return new Map(rows.map(r=>[r.symbol,r]));
}
function collect({identity,parents,asOf}){
 const price=inspectParent(parents?.B04,'B04',identity,asOf),industry=inspectParent(parents?.B08,'B08',identity,asOf);
 const requested=[...new Set([...parents.B04.plan.requested_symbols,...parents.B08.plan.requested_symbols])].sort();
 const rows=requested.map(symbol=>{
  const a=price.get(symbol),b=industry.get(symbol),gaps=[a,b].filter(Boolean).filter(r=>r.status!=='READY');
  const source_flags={bullish_gain_volume:a?.status==='READY'&&a.discovery_flags?.bullish_gain_volume===true,
   volume_surge_top100:a?.status==='READY'&&a.discovery_flags?.volume_surge_top100===true,
   persistent_industry_inflow:b?.status==='READY'&&b.persistent_inflow===true,
   sudden_industry_inflow:b?.status==='READY'&&b.sudden_inflow===true};
  const candidate_sources=[];
  if(source_flags.bullish_gain_volume||source_flags.volume_surge_top100)candidate_sources.push('B04');
  if(source_flags.persistent_industry_inflow||source_flags.sudden_industry_inflow)candidate_sources.push('B08');
  const included=gaps.length===0&&candidate_sources.length>0;
  return {symbol,status:gaps.length?'DATA_GAP':'READY',data_gap_reason:gaps.length?'UPSTREAM_DATA_GAP':null,
   source:'MotherPool.B04+B08.committed_writer_plans',source_contract:'daytrade_discovery_union_v1',source_updated_at:asOf,event_time:asOf,
   is_synthetic:false,replay:false,look_ahead:false,source_flags,candidate_sources,
   source_scope:{B04:price.has(symbol),B08:industry.has(symbol)},parent_plan_hashes:{B04:parents.B04.plan_hash,B08:parents.B08.plan_hash},
   dedupe_key:[identity.trade_date,identity.canonical_run_id,identity.writer_run_id,symbol].join('|'),
   included,reject_reason:gaps.length?'UPSTREAM_DATA_GAP':included?null:'NO_DISCOVERY_SIGNAL',formal_candidate_allowed:false};
 });
 const candidates=rows.filter(r=>r.included);
 return {...identity,module_id:'B09',created_at:asOf,requested_symbols:requested,rows,
  source_evidence:{parents},special_evidence:{union_summary:{requested_count:requested.length,candidate_count:candidates.length,
   source_candidate_count:rows.reduce((n,r)=>n+r.candidate_sources.length,0),overlap_count:rows.filter(r=>r.candidate_sources.length===2).length,
   unique_candidates:candidates.map(r=>r.symbol),data_gap_symbols:rows.filter(r=>r.status==='DATA_GAP').map(r=>r.symbol)}}};
}
module.exports={collect,inspectParent};
