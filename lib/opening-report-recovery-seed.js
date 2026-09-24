"use strict";
function isAuthorizedMorningRecovery(payload, preflight) {
 const r=preflight?.recovery;
 if(!r || preflight.ok!==true || preflight.execution_mode!=="authorized_same_day_recovery" || r.contract!=="opening-morning-authorized-recovery-v1" || !r.authorization || r.trade_date!==payload?.date) return false;
 const start=Date.parse(r.started_at),end=Date.parse(r.cutoff_at);
 return Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=600000 && typeof r.run_id==="string" && r.run_id.startsWith("opening-report-recovery-"+payload.date.replace(/-/g,"")+"-") && payload.run_id===r.run_id+"-"+payload.industry;
}
module.exports={isAuthorizedMorningRecovery};
