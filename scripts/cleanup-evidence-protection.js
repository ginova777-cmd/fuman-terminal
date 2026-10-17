'use strict';
const DAY=86400000;
// Explicit per-file review evidence is required; a filename/mtime is never permission.
function classifyEvidence(row, now, sha256) {
 const protect=reason=>({eligible:false,reason});
 if(!row||row.sha256!==sha256||row.referenceScanComplete!==true||!Array.isArray(row.references)||!Array.isArray(row.holds))return protect('protection_evidence_missing_or_stale');
 const reviewed=Date.parse(row.reviewedAt);
 if(!Number.isFinite(reviewed)||reviewed>now||now-reviewed>DAY)return protect('reference_review_not_current');
 if(row.references.length||row.holds.length||row.formalAcceptance!==false||row.rollback!==false)return protect('referenced_or_formal_hold');
 let since;
 if(row.incidentState==='open')return protect('incident_open');
 if(row.incidentState==='closed')since=Date.parse(row.closedAt);
 else if(row.incidentState==='none'&&row.success===true)since=Date.parse(row.completedAt);
 else return protect('incident_or_success_unknown');
 if(!Number.isFinite(since)||since>now)return protect('retention_start_invalid');
 return now-since>15*DAY?{eligible:true,reason:'retention_elapsed'}:protect('retention_not_elapsed');
}
module.exports={classifyEvidence};
