'use strict';
const DAY=86400000;
// Explicit per-file review evidence is required; a filename/mtime is never permission.
function classifyEvidence(row, now, sha256) {
 const protect=reason=>({eligible:false,reason});
 if(!row||row.sha256!==sha256||row.referenceScanComplete!==true||!Array.isArray(row.references)||!Array.isArray(row.holds))return protect('protection_evidence_missing_or_stale');
 const reviewed=Date.parse(row.reviewedAt);
 if(!Number.isFinite(reviewed)||reviewed>now||now-reviewed>DAY)return protect('reference_review_not_current');
 if(typeof row.formalAcceptance!=='boolean'||typeof row.rollback!=='boolean')return protect('formal_or_rollback_policy_unknown');
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

async function buildEvidenceReview(items,{runtime,referenceInventory,now=Date.now()}) {
 const fs=require('fs'),path=require('path'),crypto=require('crypto');
 const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 const manifest=path.join(runtime,'config','cleanup-evidence-protection.json');
 const refs=await referenceInventory(false,[manifest]);
 const incidentFiles=new Set(refs.files.filter(f=>/incident.*\.json$/i.test(path.basename(f.file))).map(f=>f.file));
 incidentFiles.add(path.join(runtime,'locks','supabase-rest-pool-incident.json'));
 const incidents=[],sourceErrors=[];
 for(const file of incidentFiles){try{const bytes=fs.readFileSync(file);incidents.push({file,sha256:hash(bytes),payload:JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))});}catch(e){sourceErrors.push({file,error:e.code||e.name});}}
 const entries=[];
 for(const item of items){
  const bytes=fs.readFileSync(item.path),sha256=hash(bytes);let p;try{p=JSON.parse(bytes);}catch{p={};}
  const referenced=refs.contains(item.path)||refs.contains(path.basename(item.path))||refs.contains(sha256);
  const related=incidents.filter(i=>p.incidentId && [i.payload.id,i.payload.incidentId].includes(p.incidentId));
  const active=incidents.filter(i=>!['resolved','closed'].includes(i.payload.status));
  const closed=related.filter(i=>['resolved','closed'].includes(i.payload.status));
  const closedAt=closed.map(i=>i.payload.closedAt||i.payload.resolvedAt).sort().at(-1);
  const row={path:item.path,sha256,referenceScanComplete:sourceErrors.length===0,references:referenced?['existing_runtime_reference_inventory']:[],holds:active.map(i=>i.file),reviewedAt:new Date(now).toISOString(),formalAcceptance:p.formalAcceptance,rollback:p.rollbackRequired,incidentState:related.some(i=>active.includes(i))?'open':closed.length?'closed':p.ok===true&&!p.incidentId?'none':'unknown',closedAt,success:p.ok===true,completedAt:p.finishedAt||p.checkedAt};
  entries.push(row);
 }
 return {contract:'cleanup-evidence-protection-v1',entries,sourceErrors,sourceFiles:[...refs.files,...incidents.map(({file,sha256})=>({file,sha256}))],generatedAt:new Date(now).toISOString()};
}
module.exports.buildEvidenceReview=buildEvidenceReview;
