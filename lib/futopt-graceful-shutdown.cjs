'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
function atomic(file,data){const b=Buffer.from(JSON.stringify(data,null,2)),tmp=file+'.tmp-'+crypto.randomUUID();fs.mkdirSync(path.dirname(file),{recursive:true});const fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);if(!fs.readFileSync(file).equals(b))throw Error('STOP_RECEIPT_READBACK_FAILED');}
function creationTime(){
 if(process.platform!=='win32')throw Error('WINDOWS_IDENTITY_REQUIRED');
 const r=cp.spawnSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoProfile','-Command',`(Get-Process -Id ${process.pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`],{encoding:'utf8',windowsHide:true,timeout:10000});
 if(r.status!==0||r.error||!Number.isFinite(Date.parse(r.stdout.trim())))throw Error('PROCESS_CREATION_TIME_UNVERIFIED');return r.stdout.trim();
}
function createControl({runtime,entry,quiesce,save,boundary,pending=()=>null,exit=code=>process.exit(code),identity,timeoutMs=30000,pollMs=1000}){
 const id=identity||{pid:process.pid,creation_time:creationTime(),epoch:crypto.randomUUID(),entry:path.resolve(entry),executable:process.execPath};
 const root=path.join(runtime,'state','futopt-shutdown',id.epoch);let timer,busy=false,lastBytesHash=null,quiescing=false,saveInFlight=null;
 const validate=req=>{
  if(!uuid(req?.request_id))throw Error('STOP_REQUEST_ID_INVALID');
  if(req.pid!==id.pid||req.creation_time!==id.creation_time||req.epoch!==id.epoch)throw Error('STOP_IDENTITY_MISMATCH');
  const age=Date.now()-Date.parse(req.requested_at);if(!Number.isFinite(age)||age<0||age>120000)throw Error('STOP_REQUEST_EXPIRED');
 };
 async function request(req){
  validate(req);if(busy||saveInFlight)throw Error('STOP_ALREADY_IN_PROGRESS');
  const dest=path.join(root,'receipts',req.request_id+'.json');if(fs.existsSync(dest))return JSON.parse(fs.readFileSync(dest));
  busy=true;quiescing=true;
  const r={contract:'futopt-safe-stop-v1',...id,request_id:req.request_id,requested_at:req.requested_at,started_at:new Date().toISOString(),safe_to_stop:false,status:'SAVING',boundary:null,pending:null,error:null};
  let deadline;const started=performance.now();
  try{
   quiesce();r.boundary=boundary();atomic(dest,r);
   const work=Promise.resolve().then(save);saveInFlight=work;work.then(()=>{saveInFlight=null;},()=>{saveInFlight=null;});
   const proof=await Promise.race([work,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('STOP_SAVE_TIMEOUT')),timeoutMs);})]);
   if(performance.now()-started>timeoutMs)throw Error('STOP_SAVE_TIMEOUT');
   if(proof.pending?.dirty_groups!==0||proof.pending?.pending_records!==0)throw Error('STOP_PENDING_NOT_EMPTY');
   r.proof=proof;r.pending=proof.pending;r.safe_to_stop=true;r.status='SAFE_STOP_SAVED';r.finished_at=new Date().toISOString();atomic(dest,r);
   clearInterval(timer);exit(0);return r;
  }catch(e){r.safe_to_stop=false;r.status='SAFE_STOP_FAILED';r.error=e.message;r.pending=e.pending||pending();r.finished_at=new Date().toISOString();try{atomic(dest,r);}catch(writeError){console.error('STOP_RECEIPT_WRITE_FAILED:'+writeError.code);}return r;}
  finally{clearTimeout(deadline);busy=false;}
 }
 function start(){
  fs.mkdirSync(root,{recursive:true});atomic(path.join(root,'identity.json'),id);
  atomic(path.join(runtime,'state','futopt-shutdown','owner.json'),{...id,control_root:root,contract:'futopt-stop-control-v1'});
  timer=setInterval(()=>{
   try{const file=path.join(root,'request.json');if(!fs.existsSync(file))return;if(fs.statSync(file).size>16384)throw Error('STOP_REQUEST_OVERSIZE');const bytes=fs.readFileSync(file),h=hash(bytes);if(h===lastBytesHash)return;lastBytesHash=h;void request(JSON.parse(bytes)).catch(e=>console.error('STOP_REQUEST_REJECTED:'+e.message));}catch(e){console.error('STOP_CONTROL_READ_FAILED:'+e.message);}
  },pollMs);return id;
 }
 return {start,request,identity:id,get quiescing(){return quiescing;},close:()=>clearInterval(timer)};
}
module.exports={createControl,creationTime,atomic,hash};
