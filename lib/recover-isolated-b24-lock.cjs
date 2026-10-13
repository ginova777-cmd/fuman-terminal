'use strict';
const fs=require('node:fs'),path=require('node:path');
const E=require('./mother-pool-event-evidence.cjs');
// Lock recovery never resolves an uncertain delivery or changes intents/ACKs.
function recover({root,directory,expectedHash}){
 const r=fs.realpathSync(root),d=fs.realpathSync(directory);
 E.need(fs.readFileSync(path.join(r,'ISOLATED_ONLY'),'utf8').trim()==='TEST_ONLY'&&d.startsWith(r+path.sep),'ISOLATED_ROOT_REQUIRED');
 const guard=path.join(d,'recovery.lock'),fd=fs.openSync(guard,'wx');
 try{
  const file=path.join(d,'round.lock'),raw=fs.readFileSync(file);E.need(E.digest(raw)===expectedHash,'LOCK_CHANGED');
  const owner=JSON.parse(raw);E.need(owner.contract==='isolated_outbox_lock_v1'&&owner.scope==='TEST_ONLY'&&Number.isSafeInteger(owner.pid)&&owner.pid>0&&/^[a-f0-9-]{36}$/.test(owner.token)&&Number.isFinite(Date.parse(owner.created_at)),'LOCK_OWNER_UNKNOWN');
  let dead=false;try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')dead=true;else throw Error('LOCK_OWNER_VISIBILITY_UNKNOWN');}
  E.need(dead,'LOCK_OWNER_ALIVE_OR_PID_REUSED');
  E.need(E.digest(fs.readFileSync(file))===expectedHash,'LOCK_CHANGED');
  const archive=path.join(d,'recovered-lock-'+owner.token+'.json');E.need(!fs.existsSync(archive),'RECOVERY_ALREADY_RECORDED');
  fs.renameSync(file,archive);
  return {status:'ISOLATED_DEAD_LOCK_ARCHIVED',owner,archive,sha256:expectedHash,delivery_reconciliation:'UNCHANGED',formal_execution:false};
 }finally{fs.closeSync(fd);fs.unlinkSync(guard);}
}
module.exports={recover};
