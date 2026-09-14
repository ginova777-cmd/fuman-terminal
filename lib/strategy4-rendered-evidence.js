'use strict';
const norm=a=>JSON.stringify([...new Set(a||[])].sort());
function validateRendered(r,run,s,now=Date.now()) {
 const issues=[],day=String(s.tradeDate||'').replace(/-/g,'');
 if(!r||r.contract!=='strategy4_rendered_complete_v1'||r.ok!==true||r.runId!==run||r.tradeDate!==day) return ['rendered_missing_or_wrong_identity'];
 const age=now-Date.parse(r.checkedAt);
 if(!Number.isFinite(age)||age< -60000||age>1800000)issues.push('rendered_stale');
 if(!Array.isArray(r.symbols)||r.symbols.length!==s.matches||new Set(r.symbols).size!==s.matches||r.resultCount!==s.matches)issues.push('rendered_count_mismatch');
 if(!/^[a-f0-9]{64}$/.test(r.reportSha256||''))issues.push('rendered_report_hash_missing');
 const surfaces=r.surfaces||[];
 if(surfaces.length!==3||norm(surfaces.map(x=>x.kind))!==norm(['desktop','mobile','scorecard']))issues.push('rendered_surfaces_missing_or_duplicate');
 for(const x of surfaces)if(x.ok!==true||x.runId!==run||norm(x.symbols)!==norm(r.symbols)||!/^[a-f0-9]{64}$/.test(x.screenshotSha256||''))issues.push('rendered_surface_evidence_invalid');
 return issues;
}
module.exports={validateRendered};
