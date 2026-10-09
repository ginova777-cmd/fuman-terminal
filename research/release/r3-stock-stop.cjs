'use strict';
const fs=require('fs'),crypto=require('crypto'),{digest}=require('./snapshot-digest.cjs');
function install({identity,freeze,exit=()=>process.exit(0),receiptFile}){
 let stopping=false;let challenge=crypto.randomUUID(),issued=performance.now();
 process.on('message',async request=>{
  if(!['PREPARE_STOP','GRACEFUL_STOP'].includes(request?.command))return;
  const reply=m=>process.send?.({...m,request_id:request.request_id});
  try{
   for(const k of ['pid','creation_date','epoch','entry_sha'])if(request.identity?.[k]!==identity[k])throw Error('STOP_IDENTITY');
   if(request.command==='PREPARE_STOP'){if(stopping)throw Error('STOP_IN_PROGRESS');challenge=crypto.randomUUID();issued=performance.now();reply({status:'STOP_CHALLENGE',identity,stop_challenge:challenge});return;}
   if(!/^[a-f0-9-]{36}$/.test(request.request_id||'')||!Number.isFinite(Date.parse(request.at))||request.stop_challenge!==challenge||performance.now()-issued>15000)throw Error('STOP_CHALLENGE_INVALID_OR_EXPIRED');
   if(stopping)throw Error('STOP_IN_PROGRESS');stopping=true;
   const ack=await freeze(request.request_id,{epoch:identity.epoch});
   if(ack.producer_pid!==identity.pid||ack.epoch!==identity.epoch||ack.challenge!==request.request_id)throw Error('SAVE_ACK_IDENTITY');
   if(!ack.frozen||ack.pendingRows!==0||ack.queuedFiles!==0||ack.original_ack?.ok!==true||!Number.isSafeInteger(ack.original_ack.sequence))throw Error('SAVE_ACK_NOT_VERIFIED');
   for(const kind of ['quote','candle'])if(digest(ack[kind]).sha256!==ack.hashes[kind])throw Error('SAVE_HASH_MISMATCH');
   const result={status:'STOCK_SAVED',identity,request_id:request.request_id,ack,at:new Date().toISOString()};
   const bytes=Buffer.from(JSON.stringify(result)),tmp=receiptFile+'.'+crypto.randomUUID();const fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,receiptFile);if(!fs.readFileSync(receiptFile).equals(bytes))throw Error('RECEIPT_READBACK');
   process.send?.(result,()=>exit());
  }catch(e){reply({status:'BLOCKED',error:e.message});}
 });
 return {challenge,status:()=>({stopping})};
}
module.exports={install};
