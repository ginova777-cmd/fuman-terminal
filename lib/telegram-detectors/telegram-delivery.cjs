'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function createSender({targets,token,runtimeRoot,guardedSend,fetchImpl=fetch}){
 const unique=[...new Set(targets.map(x=>String(x).trim()).filter(Boolean))];
 return async intent=>{
  if(!token||!unique.length)throw Error('TELEGRAM_CONFIGURATION_MISSING');
  const results=[];
  for(const target of unique){
   const target_hash=hash(target),idempotencyKey='three-detectors:'+intent.dedup_key+':'+target_hash;
   const file=path.join(runtimeRoot,'data/telegram-detectors/delivery',hash(idempotencyKey)+'.json');
   let old;try{old=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
   if(old?.event_id===intent.event_id&&old?.target_hash===target_hash&&old?.status==='delivered'&&Number.isInteger(old.message_id)&&old.message_id>0){results.push({sent:false,previouslyDelivered:true,target_hash,message_id:old.message_id});continue;}
   const options={motherPoolIntradayBurstTelegram:true,dataConfirmed:true,eventTime:intent.timestamp,maxEventAgeSec:120,idempotencyKey,dedupeScope:'three-detectors:'+intent.trade_date};
   try{
    const result=await guardedSend({channel:'telegram',target,payload:{text:intent.text},options,send:async()=>{
     const response=await fetchImpl('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:target,text:intent.text,disable_web_page_preview:true}),signal:AbortSignal.timeout(8000)});
     const body=await response.json();if(!response.ok||body.ok!==true||!Number.isInteger(body.result?.message_id)||body.result.message_id<=0)throw Error('TELEGRAM_DELIVERY_NOT_ACKNOWLEDGED');
     const proof={contract:'telegram_independent_event_delivery_v1',event_id:intent.event_id,target_hash,message_id:body.result.message_id,sent_at:new Date().toISOString(),status:'delivered'};
     fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp-'+process.pid,JSON.stringify(proof));fs.renameSync(file+'.tmp-'+process.pid,file);return proof;
    }});
    results.push({sent:result.sent===true,previouslyDelivered:false,target_hash,message_id:result.result?.message_id||null,reason:result.reason||null});
   }catch{results.push({sent:false,previouslyDelivered:false,target_hash,message_id:null,reason:'DELIVERY_FAILED_OR_UNCERTAIN'});}
  }
  return results;
 };
}
module.exports={createSender};
