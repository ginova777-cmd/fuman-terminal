"use strict";
const crypto=require('crypto');
const policy=require('../data/contracts/strategy3_line_exception_20260915.json');
const policyHash=crypto.createHash('sha256').update(JSON.stringify(policy)).digest('hex');
function allowed(date,recovery){return recovery===true&&policy.strategy==='strategy3'&&policy.tradeDate===date&&policy.deliveryRequired===false&&policy.userAuthorized===true&&policy.scope==='recovery_replay';}
function valid(line,scan,date){return allowed(date,String(scan?.run_id||'').startsWith('strategy3v2-recovery-replay-'))&&line?.status==='SKIPPED_QUOTA_EXHAUSTED'&&line.ok===false&&line.run_id===scan?.run_id&&line.date===date&&line.count===scan?.result_count&&line.authorization_sha256===policyHash&&line.line_push_personal_ok===false&&line.line_push_group_ok===false&&Array.isArray(line.delivery_evidence)&&line.delivery_evidence.length===0;}
module.exports={allowed,valid,policyHash};
