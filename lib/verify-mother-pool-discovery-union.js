'use strict';
const {inspectParent}=require('./mother-pool-discovery-union-producer');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
function verify(rows,artifact){try{
 const parents=artifact.writer_write_set.plan.source_evidence.parents;
 const price=inspectParent(parents.B04,'B04',artifact,artifact.observed_at),industry=inspectParent(parents.B08,'B08',artifact,artifact.observed_at);
 const requested=[...new Set([...parents.B04.plan.requested_symbols,...parents.B08.plan.requested_symbols])].sort();
 if(!same([...artifact.requested_symbols].sort(),requested)||rows.length!==requested.length||new Set(rows.map(r=>r.symbol)).size!==requested.length||requested.some(s=>!rows.some(r=>r.symbol===s)))return false;
 const parentArtifact=ws=>({...ws,observed_at:ws.plan.created_at,requested_symbols:ws.plan.requested_symbols,writer_write_set:ws});
 if(!require('./verify-mother-pool-discovery').verify(parents.B04.plan.rows.filter(r=>r.status==='READY'),parentArtifact(parents.B04)))return false;
 if(parents.B08.plan.rows.filter(r=>r.status==='READY').some(r=>!require('./verify-mother-pool-industry-flow').verify('B08',r,parentArtifact(parents.B08))))return false;
 const expectedCandidates=[];let sourceCount=0,overlaps=0;
 for(const row of rows){
  const a=price.get(row.symbol),b=industry.get(row.symbol);
  // Absence outside a parent's requested scope differs from a requested gap.
  if([a,b].filter(Boolean).some(r=>r.status!=='READY')||row.status!=='READY'||row.data_gap_reason!==null)return false;
  const flags={bullish_gain_volume:a?.discovery_flags?.bullish_gain_volume===true,
   volume_surge_top100:a?.discovery_flags?.volume_surge_top100===true,
   persistent_industry_inflow:b?.persistent_inflow===true,sudden_industry_inflow:b?.sudden_inflow===true};
  const sources=[];if(flags.bullish_gain_volume||flags.volume_surge_top100)sources.push('B04');if(flags.persistent_industry_inflow||flags.sudden_industry_inflow)sources.push('B08');
  const included=sources.length>0;sourceCount+=sources.length;if(sources.length===2)overlaps++;if(included)expectedCandidates.push(row.symbol);
  if(!same(row.source_flags,flags)||!same(row.candidate_sources,sources)||row.included!==included||row.reject_reason!==(included?null:'NO_DISCOVERY_SIGNAL')||row.formal_candidate_allowed!==false)return false;
  if(!same(row.source_scope,{B04:price.has(row.symbol),B08:industry.has(row.symbol)})||!same(row.parent_plan_hashes,{B04:parents.B04.plan_hash,B08:parents.B08.plan_hash}))return false;
  if(row.dedupe_key!==[artifact.trade_date,artifact.canonical_run_id,artifact.writer_run_id,row.symbol].join('|'))return false;
 }
 const summary=artifact.writer_write_set.plan.special_evidence.union_summary;
 return same(summary,{requested_count:requested.length,candidate_count:expectedCandidates.length,source_candidate_count:sourceCount,overlap_count:overlaps,unique_candidates:expectedCandidates.sort(),data_gap_symbols:[]});
}catch{return false;}}
module.exports={verify};
