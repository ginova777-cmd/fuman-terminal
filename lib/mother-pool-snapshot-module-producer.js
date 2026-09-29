'use strict';
const {verifySnapshotReadback}=require('./mother-pool-snapshot-readback');
function verifySource(snapshot,receipt){
 if(receipt?.read_role!=='anon'||!Array.isArray(receipt.pages)||!receipt.pages.length)throw Error('SNAPSHOT_RAW_PAGES_REQUIRED');
 const identity={trade_date:snapshot.trade_date,canonical_run_id:snapshot.canonical_run_id,mother_pool_run_id:snapshot.run_id,generation:snapshot.generation,snapshot_sequence:snapshot.snapshot_sequence};
 for(const [key,value] of Object.entries(identity))if(receipt.query_identity?.[key]!==value)throw Error('SNAPSHOT_QUERY_IDENTITY');
 const rows=[];let total=null;
 for(const page of receipt.pages){
  const match=/^(\d+)-(\d+)\/(\d+)$/.exec(page.content_range||'');
  if(page.http_status!==200||!Array.isArray(page.row_data)||page.rows!==page.row_data.length||page.offset!==rows.length||!match||Number(match[1])!==rows.length||Number(match[2])!==rows.length+page.row_data.length-1)throw Error('SNAPSHOT_PAGE_INVALID');
  if(total!==null&&total!==Number(match[3]))throw Error('SNAPSHOT_PAGE_TOTAL_CHANGED');total=Number(match[3]);rows.push(...page.row_data);
 }
 if(total!==rows.length)throw Error('SNAPSHOT_PAGE_MISSING');
 const verified=verifySnapshotReadback(snapshot,rows,{role:'anon',pages:receipt.pages});
 if(!verified.complete)throw Error('SNAPSHOT_SOURCE_READBACK_INVALID:'+verified.failed_checks.join(','));
 return rows;
}
function collect({identity,snapshot,receipt,asOf}){
 const rows=verifySource(snapshot,receipt);
 for(const [k,v] of Object.entries({trade_date:snapshot.trade_date,canonical_run_id:snapshot.canonical_run_id,mother_pool_run_id:snapshot.run_id,snapshot_generation:snapshot.generation,snapshot_sequence:snapshot.snapshot_sequence}))if(identity[k]!==v)throw Error('SNAPSHOT_WRITER_IDENTITY');
 if(!rows.length||rows.some(r=>!r.symbol))throw Error('EMPTY_SNAPSHOT_NEEDS_SEPARATE_CONTRACT');
 return {...identity,module_id:'B11',created_at:asOf,requested_symbols:snapshot.symbol_membership.map(r=>r.symbol),source_evidence:{snapshot,receipt},
  rows:rows.map(r=>({symbol:r.symbol,status:'READY',data_gap_reason:null,source:'v_fugle_daytrade_mother_pool_snapshot_v4_1',source_contract:'daytrade_mother_pool_snapshot_v1',
   source_updated_at:snapshot.effective_at,event_time:snapshot.effective_at,is_synthetic:false,replay:false,look_ahead:false,
   membership_status:r.membership_status,source_reason:r.source_reason,membership_effective_at:r.membership_effective_at,added_at:r.added_at,removed_at:r.removed_at,source_updated_at_member:r.source_updated_at}))};
}
module.exports={collect,verifySource};
