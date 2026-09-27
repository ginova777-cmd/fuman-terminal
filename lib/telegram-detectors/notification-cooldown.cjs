'use strict';
const crypto=require('node:crypto');
const tier=ratio=>Number.isFinite(ratio)&&ratio>=8?8:Number.isFinite(ratio)&&ratio>=5?5:Number.isFinite(ratio)&&ratio>=3?3:null;
function identity(intent,targetHash){
 const directions=[...new Set((intent.gate?.matches||[]).map(m=>m.direction))];
 if(!/^\d{4}$/.test(intent.symbol||'')||!['VOLUME_ANOMALY_EVENT','PRICE_UP_ANOMALY_EVENT'].includes(intent.event_type)||directions.length!==1||!['long','short'].includes(directions[0])||tier(intent.ratio)===null)throw Error('COOLDOWN_IDENTITY_INVALID');
 return {key:crypto.createHash('sha256').update([intent.trade_date,intent.symbol,intent.event_type,directions[0],targetHash].join(':')).digest('hex'),direction:directions[0],tier:tier(intent.ratio)};
}
function decide({intent,targetHash,previous,now}){
 const id=identity(intent,targetHash),ms=Date.parse(now);
 if(!Number.isFinite(ms))throw Error('COOLDOWN_CLOCK_INVALID');
 if(!previous)return {...id,allowed:true,reason:'NO_PREVIOUS_DELIVERY'};
 if(previous.key!==id.key||previous.status!=='delivered'||!Number.isInteger(previous.message_id)||previous.message_id<=0||!Number.isFinite(Date.parse(previous.sent_at))||![3,5,8].includes(previous.tier))throw Error('COOLDOWN_STATE_INVALID');
 const elapsed=ms-Date.parse(previous.sent_at);if(elapsed<0)throw Error('COOLDOWN_CLOCK_REGRESSION');
 return {...id,allowed:elapsed>=180000||id.tier>previous.tier,reason:elapsed>=180000?'COOLDOWN_ELAPSED':id.tier>previous.tier?'TIER_UPGRADE':'COOLDOWN_SAME_OR_LOWER_TIER',previous_message_id:previous.message_id,previous_sent_at:previous.sent_at};
}
module.exports={identity,decide,tier};
