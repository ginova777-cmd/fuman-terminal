"use strict";
function valid(e, run, date) {
  const surfaces=e?.three_surface_readback;
  return e?.contract==='strategy3-recovery-publish-evidence-v1'
    && e.acceptance_scope==='after_close_three_surface_recovery'
    && e.ok===true && e.source_readback_complete===true && e.complete===false && e.status==='ready_to_publish'
    && e.run_id===run && e.trade_date===date && e.verifier_ok===true
    && Array.isArray(e.failed_checks) && e.failed_checks.length===0 && e.first_blocker===null
    && e.coverage_ratio>=0.9 && e.database_readback?.run_rows===1
    && e.database_readback.result_rows===e.result_count
    && ['api','desktop_terminal','mobile_fragment'].every(key=>surfaces?.[key]?.runId===run && surfaces[key].count===e.result_count);
}
module.exports={valid};
