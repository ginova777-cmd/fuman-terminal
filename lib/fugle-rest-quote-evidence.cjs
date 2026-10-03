'use strict';
const crypto=require('node:crypto');
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const positive=v=>number(v)!==null&&v>0?v:null;
const nonnegative=v=>number(v)!==null&&v>=0?v:null;
const dateOf=ms=>new Date(ms+28800000).toISOString().slice(0,10);
function normalize(data,requestedCode,{nowMs=Date.now(),tradeDate=dateOf(nowMs)}={}) {
 if(!data||typeof data!=='object'||Array.isArray(data)||!/^\d{4}$/.test(requestedCode)||data.symbol!==requestedCode||data.date!==tradeDate)return null;
 const event=v=>Number.isSafeInteger(v)&&v>0&&Number.isFinite(new Date(v/1000).getTime())&&v/1000<=nowMs&&dateOf(v/1000)===tradeDate?new Date(Math.floor(v/1000)).toISOString():null;
 const isTrial=typeof data.isTrial==='boolean'?data.isTrial:null;
 const tradeAt=event(data.lastTrade?.time),trialAt=event(data.lastTrial?.time);
 const actual=positive(data.lastTrade?.price),trial=positive(data.lastTrial?.price);
 const close=isTrial===true?trial:actual,priceAt=isTrial===true?trialAt:tradeAt;
 const reference=positive(data.previousClose)??positive(data.referencePrice);
 if(close===null||!priceAt||reference===null)return null;
 const totalAt=event(data.total?.time),volume=nonnegative(data.total?.tradeVolume),value=nonnegative(data.total?.tradeValue);
 const unit=data.intradayOddLot===true||data.market==='ESB'?'shares':['TSE','OTC','TIB'].includes(data.market)?'lots':null;
 const synthetic=typeof data.isSynthetic==='boolean'?data.isSynthetic:false;
 const volumeAvailable=volume!==null&&unit!==null&&totalAt!==null&&!synthetic;
 const valueAvailable=value!==null&&totalAt!==null&&!synthetic;
 const receivedAt=new Date(nowMs).toISOString(),updated=event(data.lastUpdated);
 const levels=xs=>Array.isArray(xs)?xs.slice(0,5).map(x=>({price:positive(x?.price),size:nonnegative(x?.size)})):[];
 const bids=levels(data.bids),asks=levels(data.asks),bidCum=nonnegative(data.total?.tradeVolumeAtBid),askCum=nonnegative(data.total?.tradeVolumeAtAsk);
 return {code:requestedCode,name:data.name||requestedCode,tradeDate,close,formalLastPrice:actual,prevClose:reference,
  change:close-reference,percent:(close-reference)/reference*100,open:positive(data.openPrice),openTime:event(data.openTime),high:positive(data.highPrice),low:positive(data.lowPrice),
  referencePrice:positive(data.referencePrice),trialPrice:trial,trialEventAt:trialAt,isTrial,
  isHalted:typeof data.tradingHalt?.isHalted==='boolean'?data.tradingHalt.isHalted:null,haltEventAt:event(data.tradingHalt?.time),
  tradeVolume:volume,tradeValue:value,totalVolumeUnit:unit,totalVolumeRawUnit:unit,totalVolumeSourceEventAt:totalAt,totalVolumeAvailable:volumeAvailable,
  turnoverVolumeEvidence:{value:volume,unit,event_at:totalAt,source:'fugle.intraday.quote.total.tradeVolume',is_synthetic:synthetic},
  tradeValueEvidence:{value,unit:'TWD',event_at:totalAt,source:'fugle.intraday.quote.total.tradeValue',is_synthetic:synthetic,calculation:'provider_reported_cumulative'},
  tradeValueUnit:'TWD',tradeValueAvailable:valueAvailable,tradeValueSourceEventAt:totalAt,isSynthetic:synthetic,
  bidPrice:bids[0]?.price??null,bidSize:bids[0]?.size??null,askPrice:asks[0]?.price??null,askSize:asks[0]?.size??null,bidLevels:bids,askLevels:asks,
  cumulativeBidVolume:bidCum,cumulativeAskVolume:askCum,cumulativeBidAskVolume:bidCum!==null&&askCum!==null?bidCum+askCum:null,
  market:data.market||data.exchange||'',time:priceAt,quoteTime:priceAt,quoteSeenAt:receivedAt,receivedAt,updatedAt:updated,exchangeTime:priceAt,lastTradeTime:tradeAt,priceEventAt:priceAt,aggregateLastUpdated:updated,
  quoteSource:'fugle-rest-collector',closeSource:'fugle-rest-collector',realtimeFallback:'fugle-rest-collector',recoveredFromRealtimeFallback:true,
  rawEvidence:{contract:'fugle-intraday-quote-raw-v1',received_at:receivedAt,sha256:crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'),payload:data}};
}
module.exports={normalize};
