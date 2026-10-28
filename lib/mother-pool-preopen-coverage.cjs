'use strict';
const {isDeepStrictEqual}=require('node:util');
const ids=new Set(['A05','A07','A15']);
const hash=x=>require('node:crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex');
const unique=a=>Array.isArray(a)&&a.every(s=>typeof s==='string'&&s.length>0)&&new Set(a).size===a.length;
function prepare(input){
 if(!ids.has(input.module_id))return input;
 if(input.source_evidence?.coverage90)throw Error('COVERAGE_ALREADY_PREPARED');
 const eligible=input.requested_symbols,rows=input.rows;
 if(!unique(eligible)||!eligible.length||!Array.isArray(rows)||rows.length!==eligible.length||!unique(rows.map(r=>r.symbol))||rows.some(r=>!eligible.includes(r.symbol)||!['READY','DATA_GAP'].includes(r.status)||r.status==='DATA_GAP'&&!r.data_gap_reason))throw Error('COVERAGE_INPUT_INVALID');
 const ready=rows.filter(r=>r.status==='READY'),gaps=rows.filter(r=>r.status==='DATA_GAP');
 const coverage={contract:'preopen_coverage90_v1',module_id:input.module_id,eligible_symbols:[...eligible],eligible_count:eligible.length,complete_count:ready.length,missing_count:gaps.length,threshold_percent:90,coverage_percent:ready.length/eligible.length*100,source_rows_hash:hash(eligible.map(s=>rows.find(r=>r.symbol===s))),gap_rows:gaps,minimum_complete_count:Math.ceil(eligible.length*9/10)};
 if(ready.length*10<eligible.length*9)throw Error(`PREOPEN_COVERAGE_BELOW_90:${ready.length}/${eligible.length}`);
 return {...input,requested_symbols:ready.map(r=>r.symbol),rows:ready,source_evidence:{...input.source_evidence,coverage90:coverage}};
}
function verify(writeSet,moduleId){
 if(!ids.has(moduleId))return true;
 try{
  const p=writeSet.plan,c=p.source_evidence.coverage90,rows=p.rows,gaps=c.gap_rows,eligible=c.eligible_symbols;
  if(c.contract!=='preopen_coverage90_v1'||c.module_id!==moduleId||!unique(eligible)||!eligible.length||!Array.isArray(rows)||!Array.isArray(gaps)||!unique(rows.map(r=>r.symbol))||!unique(gaps.map(r=>r.symbol)))return false;
  const all=[...rows,...gaps];if(all.length!==eligible.length||!unique(all.map(r=>r.symbol))||all.some(r=>!eligible.includes(r.symbol)))return false;
  if(rows.some(r=>r.status!=='READY')||gaps.some(r=>r.status!=='DATA_GAP'||!r.data_gap_reason||r.is_synthetic!==false||r.replay!==false||r.look_ahead!==false))return false;
  if(!isDeepStrictEqual(p.requested_symbols,rows.map(r=>r.symbol))||p.data_gap_symbols.length)return false;
  if(c.threshold_percent!==90||c.eligible_count!==eligible.length||c.complete_count!==rows.length||c.missing_count!==gaps.length||c.minimum_complete_count!==Math.ceil(eligible.length*9/10)||c.coverage_percent!==rows.length/eligible.length*100||rows.length*10<eligible.length*9)return false;
  if(c.source_rows_hash!==hash(eligible.map(s=>all.find(r=>r.symbol===s))))return false;
  const volume=p.source_evidence.volume_eligibility;
  if(['A07','A15'].includes(moduleId)&&(!volume||!isDeepStrictEqual(volume.requested_symbols,eligible)))return false;
  return true;
 }catch{return false;}
}
// Strategies may consume only the fully reconciled READY subset. Missing source
// rows remain in the hash-bound coverage evidence and never become usable rows.
function usableRows({writeSet,db,anon,identity}){
 const id=writeSet?.module_id;if(!ids.has(id)||!verify(writeSet,id))throw Error('COVERAGE_EVIDENCE_INVALID');
 if(require('./mother-pool-stock-module-write-set').reconcile(writeSet,db,anon,identity,id).failed_checks.length)throw Error('COVERAGE_READBACK_FAILED');
 return structuredClone(db.filter(r=>r.status==='READY'));
}
module.exports={prepare,verify,usableRows};
