'use strict';
const SCOPE='accepted local cache and TXF archive; not DB mirror acceptance';
function validateAck(a,q,i){
 const fail=s=>{throw Error(s)};
 for(const k of ['pid','creation_time','epoch','entry','executable'])if(i[k]==null||a[k]!==i[k])fail('ACK_IDENTITY:'+k);
 for(const k of ['pid','creation_time','epoch'])if(q[k]!==i[k])fail('REQUEST_IDENTITY:'+k);
 if(!/^[a-f0-9-]{36}$/i.test(q.request_id||'')||a.request_id!==q.request_id||a.contract!=='futopt-safe-stop-v1'||a.status!=='SAFE_STOP_SAVED'||a.safe_to_stop!==true||a.error)fail('ACK_TERMINAL');
 const times=[i.creation_time,q.requested_at,a.started_at,a.finished_at].map(Date.parse);
 if(times.some(t=>!Number.isFinite(t))||times.some((t,n)=>n&&t<times[n-1]))fail('ACK_TIME_ORDER');
 if(a.requested_at!==q.requested_at)fail('ACK_REQUEST_TIME');
 if(!a.proof||a.proof.preservation_scope!==SCOPE||a.proof.prior_error)fail('ACK_SAVE_SCOPE');
 for(const obj of [a.pending,a.proof.pending]){
  if(!Number.isSafeInteger(obj?.groups)||obj.groups<0)fail('ACK_GROUPS');
  for(const k of ['dirty_groups','pending_records'])if(!Number.isSafeInteger(obj?.[k])||obj[k]!==0)fail('ACK_PENDING');
 }
 if(!Array.isArray(a.proof.files)||!Array.isArray(a.proof.caches))fail('ACK_ARTIFACT_ARRAYS');
 const artifacts=[...a.proof.files,...a.proof.caches];
 if(!artifacts.length){
  if(a.pending.groups!==0||a.proof.pending.groups!==0)fail('ZERO_GROUPS_UNPROVEN');
  for(const v of [a.boundary?.events,a.boundary?.quotes,a.boundary?.candles,a.proof.accepted,a.proof.rejected,a.proof.conflicts,a.proof.publication?.files_written,a.proof.publication?.bars_published,a.proof.publication?.bytes_written])if(!Number.isSafeInteger(v)||v!==0)fail('ZERO_COUNTS_UNPROVEN');
  if(a.boundary.last_event!==null)fail('ZERO_HISTORY_CONFLICT');
  return {kind:'ZERO_ACCEPTED_IN_BOUND_EPOCH',scope:SCOPE,artifacts:0,all_historical_cache_verified:false};
 }
 for(const f of artifacts)if(typeof f.file!=='string'||!Number.isSafeInteger(f.bytes)||f.bytes<0||!/^[a-f0-9]{64}$/i.test(f.sha256||''))fail('ACK_ARTIFACT_SHAPE');
 return {kind:'SAVED_ARTIFACTS_REQUIRE_READBACK',scope:SCOPE,artifacts:artifacts.length,all_historical_cache_verified:false};
}
module.exports={validateAck};
if(require.main===module){try{const x=JSON.parse(require('fs').readFileSync(0,'utf8').replace(/^\uFEFF/,''));process.stdout.write(JSON.stringify(validateAck(x.ack,x.request,x.identity)));}catch(e){process.stderr.write(e.message);process.exitCode=1;}}
