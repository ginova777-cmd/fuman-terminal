'use strict';
// Isolated durable checkpoints. The published root is never a checkpoint.
const fs=require('fs'),path=require('path');
const {hash,bytes}=require('../integration/offline-store.cjs');
class RecoveryCheckpoint {
 constructor(store,identity,{maxSteps=64,stop=()=>false,fault=()=>{},phaseLimit=null}={}) {
  if(!Number.isSafeInteger(maxSteps)||maxSteps<1||maxSteps>5000)throw Error('RECOVERY_STEP_LIMIT');
  this.phaseLimit=phaseLimit;this.store=store;this.identity=identity;this.maxSteps=maxSteps;this.stop=stop;this.fault=fault;this.steps=0;
  this.file=path.join(store.directory,'recovery',identity.intentHash+'.json');
  fs.mkdirSync(path.dirname(this.file),{recursive:true});
  this.state={contract:'offline-recovery-checkpoint-v1',identity,steps:{},dependencies:[]};
  if(fs.existsSync(this.file)){
   const raw=fs.readFileSync(this.file);if(raw.length>4*1048576)throw Error('CHECKPOINT_LIMIT');
   const envelope=JSON.parse(raw);if(hash(bytes(envelope.payload))!==envelope.sha256)throw Error('CHECKPOINT_HASH');
   this.state=envelope.payload;if(hash(bytes(this.state.identity))!==hash(bytes(identity)))throw Error('RECOVERY_SOURCE_DRIFT');
  }
  this.dependencies=new Set();
  // Re-hash immutable bytes, including frozen input and completed work, on restart.
  const checked=new Set();
  for(const h of Object.values(this.state.steps)){const record=store.get(h);for(const dep of record.dependencies){if(!checked.has(dep)){store.verifiedBytes(dep);checked.add(dep);}}}
  this.original=store.verifiedBytes.bind(store);
  this.originalPut=store.put.bind(store);
  store.verifiedBytes=h=>{const b=this.original(h);this.dependencies.add(h);return b;};
  store.put=value=>{const h=this.originalPut(value);this.dependencies.add(h);return h;};
 }
 get(key){const h=this.state.steps[key];return h?this.store.get(h).value:null;}
 save(key,value){
  const h=this.store.put({value,dependencies:[...this.dependencies].sort()});
  if(this.state.steps[key]&&this.state.steps[key]!==h)throw Error('CHECKPOINT_CONFLICT');
  this.state.steps[key]=h;
  const b=bytes({payload:this.state,sha256:hash(bytes(this.state))});if(b.length>4*1048576)throw Error('CHECKPOINT_LIMIT');
  const tmp=this.file+'.'+process.pid+'.tmp',fd=fs.openSync(tmp,'w');
  try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,this.file);
  this.dependencies.clear();this.fault(key);this.steps++;
  if(this.stop()||this.steps>=this.maxSteps){const e=Error('RECOVERY_YIELD');e.code='RECOVERY_YIELD';e.stage=key;throw e;}
  return value;
 }
 close(){this.store.verifiedBytes=this.original;this.store.put=this.originalPut;}
}
module.exports={RecoveryCheckpoint};
