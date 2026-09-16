'use strict';
// Capture provider totals before the existing latest-quote cache overwrites them.
// This is evidence collection only. It never infers minute side volume or publishes events.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function createJournal(root){
 const last=new Map();let error=null;
 return {
  capture(data,receivedAt=new Date().toISOString()){
   if(!data||data.isTrial===true||!/^\d{4}$/.test(String(data.symbol||'')))return {stored:false,reason:'NOT_FORMAL_STOCK_AGGREGATE'};
   const total=data.total;if(!total)return {stored:false,reason:'MISSING_PROVIDER_TOTAL'};
   const values=['tradeVolume','tradeVolumeAtBid','tradeVolumeAtAsk'];if(!values.every(k=>typeof total[k]==='number'&&Number.isFinite(total[k])&&total[k]>=0))return {stored:false,reason:'INVALID_PROVIDER_TOTAL'};
   if(total.tradeVolumeAtBid+total.tradeVolumeAtAsk>total.tradeVolume)return {stored:false,reason:'SIDE_TOTAL_EXCEEDS_VOLUME'};
   // Fugle total.time is microseconds since Unix epoch; never replace it with receivedAt.
   if(typeof total.time!=='number'||!Number.isSafeInteger(total.time)||total.time<1e15)return {stored:false,reason:'INVALID_PROVIDER_EVENT_TIME'};
   const eventMs=total.time/1000,receivedMs=Date.parse(receivedAt),local=new Date(eventMs+28800000).toISOString(),date=local.slice(0,10),minute=local.slice(11,16);
   if(!Number.isFinite(receivedMs)||eventMs>receivedMs||date!==data.date||minute<'09:00'||minute>'13:30')return {stored:false,reason:'DATE_OR_WINDOW_MISMATCH'};
   const record={contract:'fugle_provider_side_cumulative_journal_v1',trade_date:date,stock_id:data.symbol,event_at:new Date(eventMs).toISOString(),event_time_microseconds:total.time,received_at:receivedAt,volume_unit:'LOTS',aggregation:'DAY_CUMULATIVE',provider_source:'Fugle.aggregates.total',is_synthetic:false,is_trial:false,total:{tradeVolume:total.tradeVolume,tradeVolumeAtBid:total.tradeVolumeAtBid,tradeVolumeAtAsk:total.tradeVolumeAtAsk}};
   const identity=crypto.createHash('sha256').update(JSON.stringify({...record,received_at:null})).digest('hex'),key=date+':'+data.symbol;if(last.get(key)===identity)return {stored:false,reason:'DUPLICATE'};
   try{const dir=path.join(root,date);fs.mkdirSync(dir,{recursive:true});fs.appendFileSync(path.join(dir,data.symbol+'.jsonl'),JSON.stringify({...record,identity})+'\n');last.set(key,identity);error=null;return {stored:true,identity};}
   catch(e){error={at:receivedAt,code:e.code||'JOURNAL_WRITE_FAILED'};return {stored:false,reason:'JOURNAL_WRITE_FAILED'};}
  },health(){return {ok:error===null,last_error:error};}
 };
}
module.exports={createJournal};
