'use strict';
// Read the existing committed phase ports. ACK means isolated readback, never delivery.
const fs=require('fs'),path=require('path');
const {Coordinator,digest}=require('../integration/coordinator.cjs');
const {ContinuousPorts}=require('./continuous-ports.cjs');
const {algorithmIdentity}=require('./algorithm-identity.cjs');
const {local}=require('./producer-handoff.cjs');
const {atomic,load}=require('./technical-control.cjs');
const {flags}=require('./wiring.cjs');
const phases={writer:2,membership:3,strategy3:4,telegram:4};
function separate(a,b){a=local(a).toLowerCase();b=local(b).toLowerCase();if(a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep))throw Error('STATE_DIRECTORIES_OVERLAP');}
class ConsumerReader {
 constructor({scope,directory,cursorDirectory,id,role,epoch,trade_date,sourceBinding,env={},stop=()=>false}){
  if(scope!=='ISOLATED_REVIEW')throw Error('FORMAL_ENTRY_NOT_APPROVED');
  if(!/^[a-z0-9_-]{1,64}$/.test(id||'')||!phases[role]||!epoch||!trade_date||!sourceBinding?.quote||!sourceBinding?.candle)throw Error('CONSUMER_BINDING_REQUIRED');
  separate(directory,cursorDirectory);this.directory=local(directory);this.dir=local(cursorDirectory);this.enabled=flags(env);this.stop=stop;
  this.binding={contract:'phase-consumer-binding-v1',id,role,epoch,trade_date,sourceBinding,directory:this.directory};
  this.file=path.join(this.dir,id+'.json');this.phase=phases[role];
 }
 cursor(){if(!fs.existsSync(this.file))return null;const a=load(this.file);if(digest(a.binding)!==digest(this.binding))throw Error('CONSUMER_REBASE_REQUIRED');return a;}
 read(){
  if(!this.enabled[this.phase-2])return {status:'OFF',formal_connected:false};
  if(this.stop())return {status:'STOPPED',formal_connected:false};
  const c=new Coordinator(this.directory),root=c.store.root();if(!root)throw Error('ROOT_REQUIRED');
  const config=JSON.parse(fs.readFileSync(path.join(this.directory,'adapter-config.json')));
  if(digest(config.flags)!==digest(this.enabled)||config.execution_mode!=='CONTINUOUS_INCREMENTAL')throw Error('CONSUMER_CONFIG_DRIFT');
  const phase=this.enabled[2]?4:this.enabled[1]?3:2;
  const meta=new ContinuousPorts({coordinator:c,phase,sourceVersion:algorithmIdentity(),port:config.port}).verify(root);
  for(const ref of new Set([...Object.values(c.baseline().symbols),...Object.values(root.symbols)]))c.store.verifiedBytes(ref);
  const frame=c.store.get(root.sourceCursor.intent_hash),b=this.binding;
  if(frame.epoch!==b.epoch||frame.trade_date!==b.trade_date||frame.sequence!==root.sequence||digest(frame.dual?.binding)!==digest(b.sourceBinding))throw Error('CONSUMER_SOURCE_IDENTITY');
  for(const kind of ['quote','candle']){const cur=frame.dual?.cursors?.[kind];if(!cur||!Number.isSafeInteger(cur.sequence)||cur.sequence<0||cur.sequence>0&&!/^[a-f0-9]{64}$/.test(cur.commit_hash))throw Error('DUAL_CURSOR_REQUIRED');}
  const prior=this.cursor(),root_hash=digest(root);
  if(prior&&(root.sequence<prior.sequence||root.sequence===prior.sequence&&root_hash!==prior.root_hash))throw Error('CONSUMER_ROOT_CONFLICT');
  if(root.sequence!==(prior?.sequence||0)+1&&root.sequence!==prior?.sequence)throw Error('CONSUMER_GAP_REBASE_REQUIRED');
  const port=c.store.get(meta.receipts[this.phase]);
  const projection=b.role==='strategy3'?root.strategy:b.role==='telegram'?{telegram:root.telegram,pending:root.pending,outbox:root.outbox}:port.payload;
  const proof={contract:'phase-consumer-readback-v1',binding:b,sequence:root.sequence,root_hash,frame_hash:root.sourceCursor.intent_hash,phase_receipt:meta.receipts[this.phase],cursors:frame.dual.cursors,projection_hash:digest(projection)};
  return {status:prior?.sequence===root.sequence?'REPLAY_DEDUP':'READY',proof,projection,formal_connected:false,notifications_sent:0};
 }
 ack(proof,{fault}={}){
  if(this.stop())throw Error('STOPPED');fs.mkdirSync(this.dir,{recursive:true});local(this.file);
  const lock=this.file+'.lock',fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));
  try{const current=this.read();if(!current.proof||digest(current.proof)!==digest(proof))throw Error('ACK_READBACK_CONFLICT');
   if(current.status==='REPLAY_DEDUP')return this.cursor();
   if(fault==='BEFORE_ACK')throw Error('CRASH_BEFORE_ACK');
   return atomic(this.file,{...proof,ack_scope:'ISOLATED_READBACK_ONLY'},fault);
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
 }
 rollback(){this.enabled=[false,false,false];return {status:'BYPASSED',route:'LEGACY_READER',formal_connected:false};}
 readerFor(legacyReader){return this.enabled[this.phase-2]?this:legacyReader;}
}
// Explicit isolated recovery, after the operator identifies the stopped process.
function recoverConsumerLock(directory,name,expectedPid){
 if(!/^(consumer-entry|[a-z0-9_-]{1,64}\.json)\.lock$/.test(name)||!Number.isSafeInteger(expectedPid)||expectedPid<=0)throw Error('LOCK_IDENTITY');
 const file=path.join(local(directory),name),raw=fs.readFileSync(file,'utf8');
 if(JSON.parse(raw).pid!==expectedPid)throw Error('LOCK_OWNER_CHANGED');
 try{process.kill(expectedPid,0);throw Error('OWNER_ALIVE');}catch(e){if(e.code!=='ESRCH')throw e;}
 if(fs.readFileSync(file,'utf8')!==raw)throw Error('LOCK_CHANGED');
 const archived=file+'.dead-'+expectedPid+'-'+Date.now();fs.renameSync(file,archived);return {status:'DEAD_OWNER_ARCHIVED',archived};
}
module.exports={ConsumerReader,separate,phases,recoverConsumerLock};
