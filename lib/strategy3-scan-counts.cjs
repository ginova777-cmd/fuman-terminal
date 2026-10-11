'use strict';
const dateKey=x=>String(x||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
function validate(c,runId,tradeDate){
 const bad=reason=>({...c,valid:false,reason});
 if(!c||c.contract!=='strategy3-scan-counts-v1'||!runId||c.runId!==runId||c.tradeDate!==dateKey(tradeDate))return bad('strategy3_scan_counts_identity_missing_or_mismatched');
 if(!['universe','visited','qualified'].every(k=>Number.isSafeInteger(c[k])&&c[k]>=0)||c.universe<=0||c.qualified>c.visited||c.visited>c.universe)return bad('strategy3_scan_counts_invalid');
 if(!Number.isFinite(c.requiredRatio)||c.requiredRatio<0.9||c.requiredRatio>1)return bad('strategy3_data_threshold_invalid');
 if(c.visited!==c.universe)return bad('strategy3_traversal_incomplete');
 if(c.qualified<c.universe*c.requiredRatio)return bad('strategy3_required_data_below_threshold');
 return {...c,valid:true,reason:null};
}
function fromScan(scan){
 const s=scan?.scanner_summary;
 return validate({contract:'strategy3-scan-counts-v1',runId:scan?.run_id,tradeDate:dateKey(scan?.trade_date),universe:s?.formal_ready_target,visited:s?.visited_symbols,qualified:s?.ready_20_candle_symbols,requiredRatio:s?.minimum_mother_pool_coverage_ratio},scan?.run_id,scan?.trade_date);
}
module.exports={validate,fromScan};
