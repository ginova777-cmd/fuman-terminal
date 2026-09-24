'use strict';
// Mother Pool final safeguard; does not alter shared Telegram detector logic.
function admit(row, {ratioField, directionValid=true}={}) {
 const reasons=[];
 if(!row||typeof row!=='object'||Array.isArray(row))return {allowed:false,reasons:['DETECTOR_ROW_MISSING']};
 const historical=row.primary_baseline_method==='SAME_MINUTE_HISTORICAL';
 const samples=historical?row.same_minute_sample_count:row.rolling20_sample_count;
 if(!Number.isInteger(samples)||samples<(historical?10:20))reasons.push('INSUFFICIENT_SAMPLE');
 if(historical&&(typeof row.same_minute_baseline!=='number'||!Number.isFinite(row.same_minute_baseline)||row.same_minute_baseline<=0))reasons.push('HISTORICAL_BASELINE_INVALID_OR_ZERO');
 if(!['SAME_MINUTE_HISTORICAL','ROLLING_20M_MEDIAN'].includes(row.primary_baseline_method))reasons.push('BASELINE_METHOD_INVALID');
 if(typeof row.primary_baseline!=='number'||!Number.isFinite(row.primary_baseline)||row.primary_baseline<=0)reasons.push('PRIMARY_BASELINE_INVALID_OR_ZERO');
 const ratio=row[ratioField];
 if(typeof ratio!=='number'||!Number.isFinite(ratio)||ratio<3)reasons.push('RATIO_BELOW_3_OR_INVALID');
 if(row.data_gap!==false||row.baseline_zero===true||!directionValid)reasons.push('INPUT_NOT_ELIGIBLE');
 return {allowed:reasons.length===0,reasons};
}
module.exports={admit};
