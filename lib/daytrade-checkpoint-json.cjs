'use strict';
// Serialize the unchanged checkpoint contract. Cache only per-entry JSON within
// one invocation; every acknowledged batch still atomically replaces the file.
function create(checkpoint,evidence){
 const keys=Object.keys(checkpoint);
 if(JSON.stringify(keys)!==JSON.stringify(['contract','trade_date','target','hashes']))throw Error('CHECKPOINT_JSON_SHAPE');
 const hashes=new Map(Object.entries(checkpoint.hashes).map(([k,v])=>[k,JSON.stringify(k)+':'+JSON.stringify(v)]));
 const proofs=new Map(Object.entries(evidence).map(([k,v])=>[k,JSON.stringify(k)+':'+JSON.stringify(v)]));
 const prefix='{"contract":'+JSON.stringify(checkpoint.contract)+',"trade_date":'+JSON.stringify(checkpoint.trade_date)+',"target":'+JSON.stringify(checkpoint.target)+',"hashes":{';
 return changedKeys=>{
  for(const k of changedKeys){
   if(!Object.hasOwn(checkpoint.hashes,k)||!Object.hasOwn(evidence,k))throw Error('CHECKPOINT_JSON_ACK_MISSING');
   hashes.set(k,JSON.stringify(k)+':'+JSON.stringify(checkpoint.hashes[k]));
   proofs.set(k,JSON.stringify(k)+':'+JSON.stringify(evidence[k]));
  }
  return prefix+[...hashes.values()].join(',')+'},"save_evidence":{'+[...proofs.values()].join(',')+'}}';
 };
}
module.exports={create};
