'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function read(file){if(fs.statSync(file).size>262144)throw Error('event_too_large');return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function atomic(file,value){const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(value,null,2),{flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
function enqueue(dir,{task,date,runId,state,evidencePath}){
  if(!task||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!runId||!['COMPLETE','FAILED','BLOCKED','INCOMPLETE'].includes(state))throw Error('event_identity_invalid');
  fs.mkdirSync(dir,{recursive:true});
  const id=crypto.createHash('sha256').update(JSON.stringify([task,date,runId,state])).digest('hex'),file=path.join(dir,id+'.json');
  // Root mutex serializes production writers; wx also protects duplicate callers.
  const event={contract:'tom-business-event-v1',id,task,date,runId,state,evidencePath,createdAt:new Date().toISOString(),deliveryStatus:'PENDING_CHANNEL_APPROVAL',attempts:0,deliveredAt:null};
  try{fs.writeFileSync(file,JSON.stringify(event,null,2),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;const old=read(file);if(old.id!==id)throw Error('event_identity_conflict');}
  return file;
}
async function dispatch(file,{enabled=false,transport,timeoutMs=1000,maxAttempts=1,channel='UNCONFIGURED'}={}){
  if(!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>30000||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)throw Error('delivery_budget_invalid');
  const lock=file+'.lock';let fd;try{fd=fs.openSync(lock,'wx');}catch(e){if(e.code==='EEXIST')return {deliveryStatus:'LOCKED_NO_RETRY'};throw e;}
  try{
    const e=read(file);
    if(!enabled||typeof transport!=='function')return e;
    if(e.deliveryStatus==='ACKNOWLEDGED'||e.deliveryStatus==='IN_FLIGHT'||e.deliveryStatus==='TIMED_OUT_UNCERTAIN'||e.attempts>=maxAttempts)return e;
    e.attempts++;e.deliveryStatus='IN_FLIGHT';e.channel=channel;e.attemptedAt=new Date().toISOString();atomic(file,e);
    const controller=new AbortController();let timer;
    const timeout=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({timeout:true});},timeoutMs);});
    // Never persist arbitrary provider output, errors, headers or credentials.
    let result;try{result=await Promise.race([Promise.resolve().then(()=>transport({id:e.id,task:e.task,date:e.date,runId:e.runId,state:e.state},{signal:controller.signal})).catch(()=>({error:true})),timeout]);}finally{clearTimeout(timer);}
    if(result?.timeout)e.deliveryStatus='TIMED_OUT_UNCERTAIN';
    else if(result?.ack===true&&result.eventId===e.id){e.deliveryStatus='ACKNOWLEDGED';e.deliveredAt=new Date().toISOString();}
    else e.deliveryStatus=result?.error?'TRANSPORT_FAILED':'ACK_UNVERIFIED';
    atomic(file,e);return e;
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
module.exports={enqueue,dispatch,read};
