"use strict";
const crypto=require('crypto');
const policy=require('../data/contracts/strategy3_line_exception_20260915.json');
const policyHash=crypto.createHash('sha256').update(JSON.stringify(policy)).digest('hex');
function allowed(date,recovery){return recovery===true&&policy.strategy==='strategy3'&&policy.tradeDate===date&&policy.deliveryRequired===false&&policy.userAuthorized===true&&policy.scope==='recovery_replay';}
const quotaPolicy=require('../data/contracts/strategy3_line_quota_policy_v2.json');
const quotaPolicyHash=crypto.createHash('sha256').update(JSON.stringify(quotaPolicy)).digest('hex');
function valid(line,scan,date){
 const replay=String(scan?.run_id||'').startsWith('strategy3v2-recovery-replay-');
 const q=line?.quota_evidence,t=Date.parse(q?.checked_at),now=Date.now();
 const quotaOk=replay&&date>=quotaPolicy.effectiveFrom&&quotaPolicy.userAuthorized===true&&line?.authorization_sha256===quotaPolicyHash&&q?.source==='LINE Messaging API quota and consumption'&&q.quota_type==='limited'&&q.delivered===false&&Number.isFinite(q.quota_limit)&&q.quota_limit>0&&Number.isFinite(q.total_usage)&&q.total_usage>=q.quota_limit&&Number.isFinite(t)&&t<=now+60000&&now-t<=86400000;
 return ((allowed(date,replay)&&line?.authorization_sha256===policyHash)||quotaOk)&&line?.status==='SKIPPED_QUOTA_EXHAUSTED'&&line.ok===false&&line.run_id===scan?.run_id&&line.date===date&&line.count===scan?.result_count&&line.line_push_personal_ok===false&&line.line_push_group_ok===false&&Array.isArray(line.delivery_evidence)&&line.delivery_evidence.length===0;
}
module.exports={allowed,valid,policyHash,quotaPolicyHash};
