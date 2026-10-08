'use strict';
// Production-bound contract, exclusively an isolated file port until release approval.
const fs=require('fs'),path=require('path');
const {flags}=require('./wiring.cjs');
const {Coordinator,digest}=require('../integration/coordinator.cjs');
const {hash,bytes,OfflineStore}=require('../integration/offline-store.cjs');
class ProductionAdapter {
 constructor({directory,env={},port,stop=()=>false}){
  this.enabled=flags(env);this.directory=directory;this.port=port;this.stop=stop;
 }
 async runIncremental(frame){
  if(!this.enabled.some(Boolean))return {status:'OFF',formal_connected:false};
  if(!this.enabled.every(Boolean))throw Error('PARTIAL_PHASE_INCREMENTAL_PORT_NOT_WIRED');
  if(this.stop())return {status:'STOPPED',formal_connected:false};
  if(this.port?.scope!=='ISOLATED'||this.port?.contract!=='phase234-file-port-v1'||!this.port.version)throw Error('PORT_NOT_VERIFIED');
  const c=new Coordinator(this.directory),config={flags:this.enabled,port:this.port},file=path.join(c.directory,'adapter-config.json'),b=bytes(config);
  if(fs.existsSync(file)){if(hash(fs.readFileSync(file))!==hash(b))throw Error('ADAPTER_REBASE_REQUIRED');}
  else{const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  const transaction=c.store.transaction.bind(c.store);
  c.store.transaction=(build,options)=>{if(this.stop())throw Error('ADAPTER_STOP_BEFORE_PUBLISH');return transaction(build,options);};
  try{
   // Normal incremental path does not enter R0-R6 or rebuild the whole history index.
   const result=await c.run(frame),root=new OfflineStore(this.directory).root();
   if(digest(root)!==digest(result.root))throw Error('PORT_ROOT_READBACK');
   return {...result,execution_mode:'INCREMENTAL',readback_sha256:digest(root),formal_connected:false};
  }catch(e){if(e.message==='ADAPTER_STOP_BEFORE_PUBLISH')return {status:'STOPPED',published:false,formal_connected:false};throw e;}
 }
 async run(frame,{maxSteps=64}={}){
  if(!this.enabled.some(Boolean))return {status:'OFF',formal_connected:false};
  if(this.stop())return {status:'STOPPED',formal_connected:false};
  if(this.port?.scope!=='ISOLATED'||this.port?.contract!=='phase234-file-port-v1'||!this.port.version)throw Error('PORT_NOT_VERIFIED');
  const store=new OfflineStore(this.directory),config={flags:this.enabled,port:this.port},file=path.join(store.directory,'adapter-config.json');
  const b=bytes(config);if(fs.existsSync(file)){if(hash(fs.readFileSync(file))!==hash(b))throw Error('ADAPTER_REBASE_REQUIRED');}
  else{const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  const c=new Coordinator(this.directory),target=this.enabled[2]?null:this.enabled[1]?'R2:discovery':'R2';
  const cpFile=path.join(c.directory,'recovery',digest(frame)+'.json');
  // Partial-phase ports resume through the same hash checks. They never publish a Phase4 root.
  const result=await c.run(frame,{recovery:{maxSteps,stop:this.stop,phaseLimit:target,fault:key=>{
   if(key===target){const e=Error('RECOVERY_YIELD');e.code='RECOVERY_YIELD';e.stage=key;throw e;}
  }}});
  if(target&&result.status==='RECOVERY_PAUSED'&&result.stage===target){
   const raw=JSON.parse(fs.readFileSync(cpFile));if(hash(bytes(raw.payload))!==raw.sha256)throw Error('PORT_READBACK_HASH');
   const h=raw.payload.steps[target],record=store.get(h);for(const dep of record.dependencies)store.verifiedBytes(dep);
   return {status:'ISOLATED_PHASE_READBACK_VERIFIED',phase:this.enabled[1]?3:2,sha256:h,payload:record.value,formal_connected:false};
  }
  if(['OFFLINE_COMMITTED','REPLAY_DEDUP'].includes(result.status)){
   const independent=new OfflineStore(this.directory).root();if(digest(independent)!==digest(result.root))throw Error('PORT_ROOT_READBACK');
   return {...result,readback_sha256:digest(independent),formal_connected:false};
  }
  return {...result,formal_connected:false};
 }
 rollback(){return {status:'BYPASSED',adapter:new ProductionAdapter({directory:this.directory,port:this.port,env:{}}),preserved_directory:this.directory,formal_connected:false};}
}
module.exports={ProductionAdapter};
