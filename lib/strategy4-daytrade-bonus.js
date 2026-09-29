'use strict';
const {isDeepStrictEqual}=require('node:util');
const official={urls:date=>({TWSE:`https://www.twse.com.tw/rwd/zh/dayTrading/TWTB4U?date=${date.replaceAll("-","")}&response=json`,TPEX:`https://www.tpex.org.tw/www/zh-tw/intraday/stat?date=${encodeURIComponent(date.replaceAll("-","/"))}&type=Daily&response=json`})};
const parser=require('./strategy5-ranking-bonuses').parseOfficial;
const CONTRACT='strategy4_same_day_daytrade_gt50_bonus_v1';
const cache=new Map();
function calculate(input={},target){
 const e={contract:CONTRACT,targetDate:target,role:'bonus_only',thresholdPct:50,comparison:'>',input,ratioPct:null,points:0,status:'unavailable',reasons:[]};
 const d=input.official||{},total=input.totalVolumeShares;
 if(!/^[0-9]{4}$/.test(input.symbol||'')||d.symbol!==input.symbol)e.reasons.push('SYMBOL_MISMATCH');
 if(d.tradeDate!==target||input.totalVolumeDate!==target)e.reasons.push('SOURCE_DATE_MISMATCH');
 if(!['TWSE','TPEX'].includes(d.market)||d.source!==official.urls(target)[d.market]||!d.sourceHash)e.reasons.push('OFFICIAL_SOURCE_MISSING');
 if(d.unit!=='shares'||input.totalVolumeSource!=='stock_daily_volume')e.reasons.push('SOURCE_UNIT_INVALID');
 if(!Number.isFinite(d.daytradeShares)||d.daytradeShares<0||!Number.isFinite(total)||total<=0||d.daytradeShares>total)e.reasons.push('VOLUME_INVALID');
 if(!e.reasons.length){e.ratioPct=d.daytradeShares/total*100;e.points=d.daytradeShares>total/2?5:0;e.status=e.points?'awarded':'not_awarded';}
 return e;
}
function valid(e){try{return !!e&&isDeepStrictEqual(calculate(e.input,e.targetDate),e);}catch{return false;}}
async function reports(target){
 if(!cache.has(target))cache.set(target,(async()=>{const result={};for(const [market,url] of Object.entries(official.urls(target))){try{const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('HTTP_'+response.status);result[market]={rows:parser(await response.json(),market,target,url)};}catch(error){result[market]={rows:{},error:String(error.message)};}}return result;})());
 return cache.get(target);
}
async function forSymbol(symbol,market,target){
 const m=/^(上市|TWSE|TSE)$/i.test(market)?'TWSE':/^(上櫃|TPEX|OTC)$/i.test(market)?'TPEX':null;
 const source=await reports(target),volume=await require('./strategy4-recent-volume-bonus').forSymbol(symbol,target);
 const rows=(volume.rows||[]).filter(r=>r.date===target),row=rows.length===1?rows[0]:null;
 return calculate({symbol,official:source[m]?.rows[symbol]||null,totalVolumeShares:row?row.volume_lots*1000:null,totalVolumeDate:row?.date||null,totalVolumeSource:'stock_daily_volume',sourceError:source[m]?.error||volume.sourceError||null},target);
}
module.exports={CONTRACT,calculate,valid,forSymbol,reports};
