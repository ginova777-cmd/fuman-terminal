'use strict';
const crypto=require('crypto');
// No network side effects. Produces immutable per-event notification intents only.
// Existing notification-guard must own claiming, cooldown, sends and delivery receipts.
function prepare({batch,events,now}){
 const reasons=[],stamp=Date.parse(now),local=Number.isFinite(stamp)?new Date(stamp+28800000).toISOString():'',date=local.slice(0,10),minute=local.slice(11,16);
 if(!Number.isFinite(stamp))reasons.push('INVALID_CLOCK');
 if(batch?.mode!=='live'||batch?.live_point_in_time_proven!==true)reasons.push('REPLAY_NOT_PUBLISHABLE');
 if(batch?.complete!==true||batch?.verifier_complete!==true||!batch?.run_id||!batch?.source_run_id)reasons.push('BATCH_NOT_VERIFIED');
 if(batch?.trade_date!==date)reasons.push('TRADE_DATE_MISMATCH');
 if(minute<'09:00'||minute>'12:30')reasons.push('OUTSIDE_NOTIFICATION_WINDOW');
 if(!Array.isArray(events))reasons.push('INVALID_EVENTS');
 if(reasons.length)return {status:'blocked',publish_allowed:false,failed_checks:reasons,intents:[]};
 const intents=[],skipped=[],seen=new Set();
 for(const e of events){const type=e.event_type,t=Date.parse(e.timestamp),symbol=e.stock_id||e.symbol,age=(stamp-Date.parse(e.source_event_at||e.side_volume_timestamp||e.timestamp))/1000;
  const allowed=['VOLUME_ANOMALY_EVENT','PRICE_UP_ANOMALY_EVENT','RAW_OUTSIDE_STRENGTH_EVENT','DYNAMIC_OUTSIDE_STRENGTH_EVENT'];
  if(!allowed.includes(type)||e.trade_date!==date||!/^\d{4}$/.test(symbol||'')||e.data_gap===true||!Number.isFinite(t)||t+60000>stamp||!Number.isFinite(age)||age<0||age>120){skipped.push({event_id:e.event_id||null,reason:'INVALID_OR_STALE_EVENT'});continue;}
  const ratio=type==='VOLUME_ANOMALY_EVENT'?e.primary_ratio:type==='PRICE_UP_ANOMALY_EVENT'?e.primary_price_spike_ratio:type==='RAW_OUTSIDE_STRENGTH_EVENT'?e.raw_outside_strength:e.primary_dynamic_ratio;
  const threshold=type.includes('OUTSIDE')?2:3;if(typeof ratio!=='number'||!Number.isFinite(ratio)||ratio<threshold){skipped.push({event_id:e.event_id||null,reason:'EVENT_THRESHOLD_MISMATCH'});continue;}
  const id=`${date}:${symbol}:${new Date(t).toISOString()}:${type}`;if(seen.has(id))continue;seen.add(id);
  const label={VOLUME_ANOMALY_EVENT:'瞬間巨量',PRICE_UP_ANOMALY_EVENT:'瞬間拉抬',RAW_OUTSIDE_STRENGTH_EVENT:'外盤強勢 RAW',DYNAMIC_OUTSIDE_STRENGTH_EVENT:'動態外盤強度'}[type];
  intents.push({event_id:id,dedup_key:crypto.createHash('sha256').update(id).digest('hex'),run_id:batch.run_id,source_run_id:batch.source_run_id,trade_date:date,symbol,event_type:type,timestamp:e.timestamp,ratio,primary_baseline_method:e.primary_baseline_method||null,text:`【${label}】${symbol}\n倍率 ${ratio.toFixed(2)}×\n資料分鐘 ${new Date(t+28800000).toISOString().slice(11,16)}\n僅為異常偵測紀錄`,candle_timeframe:'1m'});
 }
 return {status:'ready',publish_allowed:true,intents,skipped,failed_checks:[],notifications_sent:0};
}
module.exports={prepare};
