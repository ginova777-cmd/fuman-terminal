'use strict';
const crypto=require('node:crypto'),assert=require('node:assert/strict');
const {evaluate}=require('./daytrade-module-recovery-policy.cjs');
const independent=require('./daytrade-independent-preopen-modules.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
// Pure preparation/validation only. The Owner retains responsibility for
// authority, window, locking, ACL-preserving CAS, and independent readback.
function prepare({before,expectedHash,identity,registry,target}){
 if(!Buffer.isBuffer(before)||hash(before)!==expectedHash)throw Error('POLICY_HASH_MISMATCH');
 if(target!=='A01')throw Error('SELECTIVE_STOP_TARGET_UNSUPPORTED');
 const text=before.toString('utf8');if(!Buffer.from(text,'utf8').equals(before))throw Error('POLICY_ENCODING_INVALID');
 const policy=JSON.parse(text);
 if(policy.probe!==target)throw Error('PROBE_IDENTITY_MISMATCH');
 const validated=evaluate(policy,registry,identity);
 if(validated.status!=='STAGED_RECOVERY'||validated.rejected||validated.probe!==target||validated.enabled.length!==policy.restored.length)throw Error('RETAINED_ACCEPTANCE_INVALID');
 if(validated.enabled.some(id=>!independent.includes(id)))throw Error('RETAINED_DEPENDENCY_UNVERIFIED');
 // Exactly one token changes. Retained entries, hashes and original formatting
 // remain byte-for-byte unchanged, including acceptance payloads.
 const tokens=[...text.matchAll(/"probe"\s*:\s*"A01"/g)];
 if(tokens.length!==1||(text.match(/"probe"\s*:/g)||[]).length!==1)throw Error('AMBIGUOUS_PROBE_FIELD');
 const token=tokens[0],offset=token.index+token[0].lastIndexOf('"A01"');
 const after=Buffer.from(text.slice(0,offset)+'null'+text.slice(offset+5),'utf8');
 const expected={...policy,probe:null};assert.deepEqual(JSON.parse(after.toString('utf8')),expected);
 return {after,before_sha256:expectedHash,after_sha256:hash(after),retained:[...policy.restored],removed_probe:target};
}
module.exports={prepare};
