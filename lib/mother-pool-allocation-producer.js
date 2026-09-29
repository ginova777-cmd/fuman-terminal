'use strict';
function collect({identity,allocation,snapshot,asOf}){
 if(allocation?.contract!=='mother_pool_scan_allocation_v1'||['trade_date','canonical_run_id','writer_run_id','generation_id'].some(k=>allocation[k]!==identity[k]))throw Error('ALLOCATION_SOURCE_IDENTITY');
 if(!Array.isArray(snapshot?.symbols)||allocation.selected_symbols.some(s=>!snapshot.symbols.includes(s)))throw Error('ALLOCATION_SNAPSHOT_MEMBERSHIP');
 const rows=allocation.assignments.map(a=>({...a,status:'READY',data_gap_reason:null,source:'MotherPool.Writer.actual_scan_allocation',source_contract:'mother_pool_scan_allocation_v1',source_updated_at:allocation.created_at,event_time:allocation.created_at,is_synthetic:false,replay:false,look_ahead:false,formal_candidate_allowed:false}));
 return {...identity,module_id:'B10',created_at:asOf,requested_symbols:[...allocation.requested_symbols],rows,source_evidence:{allocation,snapshot_symbols:[...snapshot.symbols]}};
}
module.exports={collect};
