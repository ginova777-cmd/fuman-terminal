'use strict';
const {createHash}=require('node:crypto');
// One copy on the wire; the DB reconstructs exactly the existing immutable
// document. Plan hash, saved intent, ACK and all readback contracts are unchanged.
function compact(body) {
 const document=JSON.parse(body.p_document),plan=JSON.parse(body.p_plan);
 if(JSON.stringify(document.plan)!==JSON.stringify(plan) || document.plan_hash!==createHash('sha256').update(body.p_plan).digest('hex'))throw Error('COMPACT_MODULE_PLAN_MISMATCH');
 const {plan:ignored,...metadata}=document;
 return {p_metadata:JSON.stringify(metadata),p_plan:body.p_plan};
}
module.exports={compact};
