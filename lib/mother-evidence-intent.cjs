'use strict';
// C2: bounded in-memory capture only. No filesystem or cache reconstruction.
const crypto=require('node:crypto');
const {sha,keyOf,difference}=require('./mother-change-evidence.cjs');
const C2='mother-change-evidence-v2-c2';
function capture(json,{epoch,kind,producerVersion,token,sequence}){
 const changes=JSON.parse(json);
 const intent={contract:C2,state:'PRE_CACHE_INTENT_VOLATILE',intent_id:crypto.randomUUID(),token,collector_epoch:epoch,kind,producer_version:producerVersion,intent_sequence:sequence,captured_at:new Date().toISOString(),entries:changes.map(({previous,merged})=>({event_id:crypto.randomUUID(),identity:keyOf(merged,kind),difference:difference(previous,merged,kind),previous,merged}))};
 intent.frozen_ns=process.hrtime.bigint().toString();
 return JSON.stringify(intent);
}
function validate(intent,{epoch,kind,token}={}){
 if(intent?.contract!==C2||intent.state!=='PRE_CACHE_INTENT_VOLATILE'||!intent.intent_id||!Number.isSafeInteger(intent.intent_sequence)||intent.intent_sequence<1||!/^\d+$/.test(intent.frozen_ns)||!Array.isArray(intent.entries)||!intent.entries.length)throw Error('INTENT_INVALID');
 if(epoch&&intent.collector_epoch!==epoch||kind&&intent.kind!==kind||token&&intent.token!==token)throw Error('INTENT_IDENTITY_MISMATCH');
 if(intent.token!==intent.collector_epoch+':'+intent.intent_sequence)throw Error('INTENT_SEQUENCE_IDENTITY_MISMATCH');
 const ids=new Set();
 for(const entry of intent.entries){
  if(!entry.event_id||ids.has(entry.event_id)||sha(keyOf(entry.merged,intent.kind))!==sha(entry.identity)||sha(difference(entry.previous,entry.merged,intent.kind))!==sha(entry.difference))throw Error('INTENT_CONTENT_MISMATCH');
  ids.add(entry.event_id);
 }
 return intent;
}
module.exports={C2,capture,validate};
