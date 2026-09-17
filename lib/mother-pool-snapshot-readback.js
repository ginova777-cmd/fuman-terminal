'use strict';
const {inspectSnapshot}=require('./daytrade-mother-pool-snapshot');
function verifySnapshotReadback(snapshot,rows,context={}) {
  const failed=[...inspectSnapshot(snapshot,snapshot.trade_date).failedChecks];
  if(context.role!=='anon')failed.push('anon_role_required');
  if(!Array.isArray(rows)) {failed.push('rows_not_array');rows=[];}
  const members=new Map((snapshot.symbol_membership||[]).map(x=>[x.symbol,x]));
  const seen=new Set();
  const scalar=['contract','contract_version','trade_date','canonical_run_id','snapshot_sequence','snapshot_type','status','complete','symbol_count','exit_code'];
  const times=['generated_at','effective_at','source_max_updated_at'];
  const sameTime=(a,b)=>a==null&&b==null || Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b);
  const nullable=x=>x==null||x===''?null:x;
  for(const row of rows){
    if(!row || typeof row!=='object'){failed.push('invalid_row');continue;}
    if(row.mother_pool_run_id!==snapshot.run_id)failed.push('run_id_mismatch');
    for(const field of scalar)if(row[field]!==snapshot[field])failed.push('header_'+field);
    for(const field of times)if(!sameTime(nullable(row[field]),nullable(snapshot[field])))failed.push('header_'+field);
    for(const field of ['first_blocker','previous_run_id'])if(nullable(row[field])!==nullable(snapshot[field]))failed.push('header_'+field);
    for(const field of ['symbols','added_symbols','removed_symbols'])
      if(!Array.isArray(row[field])||JSON.stringify([...row[field]].sort())!==JSON.stringify([...(snapshot[field]||[])].sort()))failed.push('header_'+field);
    if(row.symbol==null){if(members.size!==0)failed.push('unexpected_empty_member');continue;}
    if(seen.has(row.symbol))failed.push('duplicate_member');seen.add(row.symbol);
    const expected=members.get(row.symbol);
    if(!expected){failed.push('unexpected_member');continue;}
    for(const field of ['membership_status','source_reason'])if(row[field]!==expected[field])failed.push('member_'+field);
    for(const field of ['membership_effective_at','added_at','removed_at','source_updated_at'])
      if(!sameTime(nullable(row[field]),nullable(expected[field])))failed.push('member_'+field);
  }
  if(rows.length!==Math.max(1,members.size)||seen.size!==members.size)failed.push('member_count_mismatch');
  for(const symbol of members.keys())if(!seen.has(symbol))failed.push('missing_member:'+symbol);
  const checks=[...new Set(failed)];
  return {contract:'mother_pool_snapshot_anon_readback_v1',trade_date:snapshot.trade_date,
    canonical_run_id:snapshot.canonical_run_id,mother_pool_run_id:snapshot.run_id,snapshot_sequence:snapshot.snapshot_sequence,
    status:checks.length?'blocked':'complete',complete:checks.length===0,exit_code:checks.length?1:0,
    failed_checks:checks,first_blocker:checks[0]||null,read_role:context.role,
    requested_members:members.size,readback_rows:rows.length,unique_symbols:seen.size,
    active_symbol_count:snapshot.symbol_count,pages:context.pages||[],verified_at:new Date().toISOString()};
}
module.exports={verifySnapshotReadback};
