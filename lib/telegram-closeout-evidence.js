'use strict';
const {inspectSnapshot}=require('./daytrade-mother-pool-snapshot');
function preserveCloseout(receipt, previous) {
 if(receipt.first_blocker!=='outside_trading_window')return;
 const p=previous||{}, snapshot=inspectSnapshot(p.mother_pool_snapshot_evidence,receipt.trade_date);
 const valid=p.trade_date===receipt.trade_date&&p.ok===true&&p.complete===true&&p.v4_contract_validated===true&&snapshot.ok&&p.mother_pool_run_id===snapshot.runId&&p.snapshot_sequence===snapshot.snapshot.snapshot_sequence&&p.five_minute_role==='diagnostic_bonus_not_hard_gate'&&p.conditions?.five_minute_confirmation_required===false;
 receipt.closeout={checked_at:receipt.checked_at,source_evidence_preserved:valid,in_session_checked_at:p.closeout?.in_session_checked_at||p.checked_at||null};
 if(!valid){receipt.ok=false;receipt.failed_checks=['telegram_closeout_in_session_evidence_missing'];receipt.first_blocker='telegram_closeout_in_session_evidence_missing';return;}
 // Preserve the actual in-session identity, never substitute the later Mother Pool.
 for(const key of ['mother_pool_snapshot_evidence','canonical_water','source_status_at_run','canonical_gate_at_run','unattended_gate_at_run','mother_pool_read_rows','mother_pool_snapshot_contract','mother_pool_run_id','mother_pool_snapshot_sequence','snapshot_sequence','v4_contract_validated','mother_pool_snapshot_type','mother_pool_effective_at','mother_pool_symbol_count','accepted_mother_pool_symbols','requested_symbols','five_minute_role'])receipt[key]=p[key];
}
module.exports={preserveCloseout};
