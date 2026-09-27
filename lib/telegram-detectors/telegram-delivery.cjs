'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {CONTRACT}=require('./level-cross-gate.cjs');
const {withinWindow}=require('./level-cross-indicators.cjs');
const cooldown=require('./notification-cooldown.cjs');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function confirmationFailure(intent,now){
 const gate=intent.gate,confirmed=Date.parse(gate?.confirmed_at),local=new Date(now+28800000).toISOString();
 if(gate?.contract!==CONTRACT||gate.eligible!==true||gate.status!=='confirmed'||!Array.isArray(gate.matches)||!gate.matches.length||!gate.matches.every(m=>m&&withinWindow(intent.timestamp,m.touch_at)&&withinWindow(m.touch_at,m.cross_at)&&Date.parse(m.cross_at)===confirmed))return 'LEVEL_CROSS_NOT_PROVEN';
 if(!Number.isFinite(confirmed)||confirmed+60000>now)return 'CONFIRMATION_BAR_NOT_COMPLETE';
 if(intent.trade_date!==local.slice(0,10)||new Date(confirmed+28800000).toISOString().slice(0,10)!==intent.trade_date)return 'TRADE_DATE_MISMATCH';
 if(local.slice(11,16)<'09:00'||local.slice(11,16)>'12:30')return 'OUTSIDE_NOTIFICATION_WINDOW';
 if(now-confirmed>120000)return 'event-too-old';
 return null;
}
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
   const failure=confirmationFailure(intent,Date.now());
   if(failure){results.push({sent:false,previouslyDelivered:false,target_hash,message_id:null,reason:failure});continue;}
   const cooldownId=cooldown.identity(intent,target_hash),cooldownFile=path.join(runtimeRoot,'data/telegram-detectors/cooldown',cooldownId.key+'.json');
   let previousCooldown=null;
   try{previousCooldown=JSON.parse(fs.readFileSync(cooldownFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('COOLDOWN_STATE_UNREADABLE');}
   const cooldownDecision=cooldown.decide({intent,targetHash:target_hash,previous:previousCooldown,now:new Date(Date.now()).toISOString()});
   if(previousCooldown?.event_id===intent.event_id){results.push({sent:false,previouslyDelivered:true,target_hash,message_id:previousCooldown.message_id});continue;}
   if(!cooldownDecision.allowed){results.push({sent:false,previouslyDelivered:false,suppressed:true,target_hash,message_id:null,reason:cooldownDecision.reason,cooldown_evidence:{previous:previousCooldown,checked_at:new Date(Date.now()).toISOString()}});continue;}
   // Eligibility starts at the confirmed cross; identity remains the original detector event.
   const options={motherPoolIntradayBurstTelegram:true,dataConfirmed:true,eventTime:intent.gate.confirmed_at,maxEventAgeSec:120,idempotencyKey,dedupeScope:'three-detectors:'+intent.trade_date};
   try{
    const result=await guardedSend({channel:'telegram',target,payload:{text:intent.text},options,send:async()=>{
     const response=await fetchImpl('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:target,text:intent.text,disable_web_page_preview:true}),signal:AbortSignal.timeout(8000)});
     const body=await response.json();if(!response.ok||body.ok!==true||!Number.isInteger(body.result?.message_id)||body.result.message_id<=0)throw Error('TELEGRAM_DELIVERY_NOT_ACKNOWLEDGED');
     const proof={contract:'telegram_independent_event_delivery_v1',event_id:intent.event_id,target_hash,message_id:body.result.message_id,sent_at:new Date().toISOString(),status:'delivered'};
     // Only an acknowledged send updates the cooldown. Persist it first so a
     // crash before the event receipt can recover the acknowledgement on retry.
     const cooldownProof={...cooldownId,event_id:intent.event_id,status:'delivered',message_id:body.result.message_id,sent_at:new Date(Date.now()).toISOString()};
     fs.mkdirSync(path.dirname(cooldownFile),{recursive:true});fs.writeFileSync(cooldownFile+'.tmp-'+process.pid,JSON.stringify(cooldownProof));fs.renameSync(cooldownFile+'.tmp-'+process.pid,cooldownFile);
     fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp-'+process.pid,JSON.stringify(proof));fs.renameSync(file+'.tmp-'+process.pid,file);return proof;
    }});
    results.push({sent:result.sent===true,previouslyDelivered:false,target_hash,message_id:result.result?.message_id||null,reason:result.reason||null});
   }catch{results.push({sent:false,previouslyDelivered:false,target_hash,message_id:null,reason:'DELIVERY_FAILED_OR_UNCERTAIN'});}
  }
  return results;
 };
}
module.exports={createSender};
