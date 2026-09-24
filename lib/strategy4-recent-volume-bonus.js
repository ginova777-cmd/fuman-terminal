"use strict";
const fs=require('fs'),path=require('path');
const CONTRACT='strategy4_recent_volume_10d_prior5_bonus_v1';
const memo=new Map();
async function tradingDates(target){
 const {isTwseTradingDay}=require('../scripts/twse-trading-day'); const dates=[];
 for(let n=0;n<75&&dates.length<15;n++){const d=new Date(target+'T12:00:00+08:00');d.setUTCDate(d.getUTCDate()-n);const r=await isTwseTradingDay(d,{stateDir:path.join(process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime','state')});if(r.error||r.reason==='weekday_fallback')throw Error('recent_volume_calendar_unverified');if(r.isTradingDay)dates.unshift(r.date);}
 if(dates.length!==15||dates.at(-1)!==target)throw Error('recent_volume_trading_dates_incomplete'); return dates;
}
function calculate(rows,dates,target){
 const base={contract:CONTRACT,targetDate:target,source:'stock_daily_volume',unit:'lots',expectedDates:dates,rows:[],evaluations:[],gaps:[],points:0,matchedDates:[],maxRatio:null,status:'unavailable'};
 if(dates.length!==15||new Set(dates).size!==15||dates.at(-1)!==target||dates.some((d,i)=>i&&d<=dates[i-1])){base.gaps.push('calendar_unavailable');return base;}
 const by=new Map();
 for(const date of dates){const matches=rows.filter(r=>String(r.trade_date||r.date).slice(0,10)===date);let value=null;if(matches.length===1){const r=matches[0],valid=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0;value=valid(r.volume_lots)?Number(r.volume_lots):valid(r.volume_shares)?Number(r.volume_shares)/1000:null;if(value!==null&&valid(r.volume_shares)&&Math.abs(Number(r.volume_shares)-value*1000)>1)value=null;}if(value===null)base.gaps.push('missing_or_invalid_volume:'+date);else{by.set(date,value);base.rows.push({date,volume_lots:value});}}
 for(let i=5;i<15;i++){const date=dates[i],priorDates=dates.slice(i-5,i);if(!by.has(date)||priorDates.some(d=>!by.has(d)))continue;const avg=priorDates.reduce((s,d)=>s+by.get(d),0)/5;if(avg<=0){base.gaps.push('zero_baseline:'+date);continue;}const ratio=by.get(date)/avg;base.evaluations.push({date,volume_lots:by.get(date),priorDates,priorAverageLots:avg,ratio,matched:ratio>=2.5});}
 base.matchedDates=base.evaluations.filter(e=>e.matched).map(e=>e.date);base.maxRatio=base.evaluations.length?Math.max(...base.evaluations.map(e=>e.ratio)):null;base.points=base.matchedDates.length?5:0;base.status=base.points?'awarded':base.gaps.length?'unavailable':'not_awarded';return base;
}
function valid(e){if(!e||e.contract!==CONTRACT)return false;const x=calculate(e.rows||[],e.expectedDates||[],e.targetDate);return ['source','unit','rows','evaluations','gaps','points','matchedDates','maxRatio','status'].every(k=>require('node:util').isDeepStrictEqual(x[k],e[k]));}
async function load(target){
 if(memo.has(target))return memo.get(target);
 const promise=(async()=>{const dates=await tradingDates(target);return require('./shared-recent-volume-water').create().get({target,dates,calculate});})();
 memo.set(target,promise);return promise;
}
async function forSymbol(symbol,target){
 try{const shared=await load(target);const snapshot=shared.snapshot;const evidence=snapshot.evidenceBySymbol[symbol]||calculate([],snapshot.dates,target);return {...evidence,sharedSource:{contract:snapshot.contract,generation:snapshot.generation,sourceVersion:snapshot.sourceVersion,path:shared.file,cacheHit:shared.cacheHit}};}
 catch(error){return {...calculate([],[],target),sourceError:error.message};}
}
module.exports={CONTRACT,calculate,valid,tradingDates,forSymbol};
