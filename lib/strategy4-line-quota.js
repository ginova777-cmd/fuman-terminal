'use strict';
const contract=require('../data/contracts/strategy4_line_quota_exception_v1.json');
const STATUS='SKIPPED_QUOTA_EXHAUSTED';
function day(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(d).replace(/-/g,'');}
function validEvidence(e,date){
 if(!e||day(e.checked_at)!==String(date).replace(/-/g,''))return false;
 if(e.source==='line_quota_api')return e.quota?.type==='limited'&&Number.isInteger(e.quota.value)&&e.quota.value>=0&&Number.isInteger(e.consumption?.totalUsage)&&e.consumption.totalUsage>=e.quota.value;
 return e.source==='line_push_response'&&e.http_status===429&&e.message==='You have reached your monthly limit.';
}
function isQuotaException(r){return contract.completionAllowed===true&&r?.strategy==='strategy4'&&r.ok===true&&r.dry_run===false&&r.line_push_ok===false&&r.delivery_status===STATUS&&r.delivery_exception_contract===contract.contract&&!!r.runId&&r.dateAligned===true&&r.runId.startsWith('strategy4-'+String(r.dataDate).replace(/-/g,'')+'-')&&validEvidence(r.quota_evidence,r.dataDate);}
function applyQuotaException(r,e){if(!validEvidence(e,r.dataDate))throw Error('invalid_strategy4_quota_evidence');Object.assign(r,{delivery_status:STATUS,delivery_exception_contract:contract.contract,quota_evidence:e,line_push_ok:false,delivery_count:0,delivery_confirmed:false});return r;}
async function probeQuota(token,fetcher=fetch){
 const get=async suffix=>{const r=await fetcher('https://api.line.me/v2/bot/message/quota'+suffix,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('LINE quota probe HTTP '+r.status);return r.json();};
 const [quota,consumption]=await Promise.all([get(''),get('/consumption')]);
 const e={source:'line_quota_api',checked_at:new Date().toISOString(),quota,consumption};return validEvidence(e,day(e.checked_at))?e:null;
}
function evidenceFromError(error){const m=String(error?.message||error).match(/^LINE push failed (\d+): (.+)$/);if(!m)return null;let body;try{body=JSON.parse(m[2]);}catch{return null;}const e={source:'line_push_response',checked_at:new Date().toISOString(),http_status:Number(m[1]),message:body.message};return validEvidence(e,day(e.checked_at))?e:null;}
module.exports={STATUS,validEvidence,isQuotaException,applyQuotaException,probeQuota,evidenceFromError};
