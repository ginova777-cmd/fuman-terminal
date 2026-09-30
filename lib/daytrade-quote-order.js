'use strict';
const ms=value=>Date.parse(value||'');
const day=value=>Number.isFinite(value)?new Date(value+28800000).toISOString().slice(0,10):null;
const PRICE=['close','closeSource','formalLastPrice','change','percent','lastTradeTime','priceEventAt','isTrial','trialPrice','trialEventAt'];
const VOLUME=['tradeVolume','totalVolumeUnit','totalVolumeRawUnit','totalVolumeSourceEventAt','totalVolumeAvailable','turnoverVolumeEvidence'];
const EVENT=['exchangeTime','quoteSeenAt','time','quoteTime'];
function priceTime(row){return ms(row.priceEventAt||(row.isTrial===true?row.trialEventAt:row.lastTradeTime)||(row.quoteSource==='fugle-ws-trades'?row.exchangeTime:''));}
function order(previous,incoming){
 const eventMs=ms(incoming.exchangeTime||incoming.quoteSeenAt);
 const previousMs=ms(previous.exchangeTime||previous.quoteSeenAt);
 const trade=incoming.quoteSource==='fugle-ws-trades';
 const aggregate=incoming.quoteSource==='fugle-ws'||incoming.quoteSource==='fugle-ws-aggregates';
 if(!trade&&!aggregate)return {accept:true,preserve:[]};
 if(!Number.isFinite(eventMs))return {accept:false,reason:'QUOTE_EVENT_TIME_MISSING'};
 if(Number.isFinite(previousMs)&&day(eventMs)<day(previousMs))return {accept:false,reason:'QUOTE_PREVIOUS_DAY'};
 const reset=Number.isFinite(previousMs)&&day(eventMs)>day(previousMs);
 const prior=reset?{}:previous;
 const legacySerial=Number(prior.tradeSerial);
 const legacyTime=ms(prior.exchangeTime||prior.quoteSeenAt);
 const legacy=prior.quoteSource==='fugle-ws-trades'&&Number.isSafeInteger(legacySerial)&&legacySerial>0?{day:day(legacyTime),serial:legacySerial,eventMs:legacyTime}:null;
 const watermark=prior.tradeOrder||legacy;
 const serial=Number(incoming.tradeSerial);
 if(trade&&watermark?.day===day(eventMs)){
  if(Number.isSafeInteger(serial)&&serial>0&&serial<=watermark.serial)return {accept:false,reason:'TRADE_DUPLICATE_OR_OUT_OF_ORDER'};
  if(Number.isFinite(watermark.eventMs)&&eventMs<watermark.eventMs)return {accept:false,reason:'TRADE_EVENT_TIME_REGRESSION'};
 }
 const aggregateMs=ms(prior.aggregateLastUpdated);
 if(aggregate&&Number.isFinite(aggregateMs)&&eventMs<aggregateMs)return {accept:false,reason:'AGGREGATE_EVENT_TIME_REGRESSION'};
 const preserve=[];
 // A later aggregate can describe an older last trade. Retain its independent
 // context, but never replace a newer price with that older last trade.
 const incomingPrice=priceTime(incoming),previousPrice=priceTime(prior);
 if(Number.isFinite(previousPrice)&&(!Number.isFinite(incomingPrice)||incomingPrice<previousPrice))preserve.push(...PRICE);
 const incomingVolume=ms(incoming.totalVolumeSourceEventAt),previousVolume=ms(prior.totalVolumeSourceEventAt);
 if(Number.isFinite(previousVolume)&&(!Number.isFinite(incomingVolume)||incomingVolume<previousVolume))preserve.push(...VOLUME);
 if(Number.isFinite(previousMs)&&!reset&&eventMs<previousMs)preserve.push(...EVENT);
 return {accept:true,reset,preserve,tradeOrder:trade&&Number.isSafeInteger(serial)&&serial>0?{day:day(eventMs),serial,eventMs}:watermark};
}
function preserveFields(merged,previous,fields){
 for(const field of fields||[]){if(Object.prototype.hasOwnProperty.call(previous,field))merged[field]=previous[field];else delete merged[field];}
 return merged;
}
function preserveTradeContext(merged,previous,incoming){
 if(incoming.quoteSource!=='fugle-ws-trades')return merged;
 // trades has no daily OHLC or traded-value fields. Keep aggregate context;
 // the actual new trade can extend an existing high/low, never shrink it.
 for(const field of ['open','prevClose','tradeValue'])if(!(Number(incoming[field])>0)&&Number(previous[field])>0)merged[field]=previous[field];
 if(!incoming.market&&previous.market)merged.market=previous.market;
 if(Number(previous.high)>0&&Number(merged.high)>0)merged.high=Math.max(previous.high,merged.high);
 if(Number(previous.low)>0&&Number(merged.low)>0)merged.low=Math.min(previous.low,merged.low);
 if(Number(merged.prevClose)>0&&Number(merged.close)>0){
  if(incoming.change==null)merged.change=merged.close-merged.prevClose;
  if(incoming.percent==null)merged.percent=(merged.close-merged.prevClose)/merged.prevClose*100;
 }
 return merged;
}
module.exports={order,preserveFields,preserveTradeContext};
