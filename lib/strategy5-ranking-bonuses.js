'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const volume=require('./strategy4-recent-volume-bonus');
const CONTRACT='strategy5-volume10d-prior5-2_5x-daytrade50-bonus-v1';
const numeric=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(String(v).replaceAll(',','')))?Number(String(v).replaceAll(',','')):null;
function normalizeDate(v){const s=String(v||'').replace(/\D/g,'');return s.length===7?`${Number(s.slice(0,3))+1911}-${s.slice(3,5)}-${s.slice(5)}`:s.length===8?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`:'';}
function parseOfficial(payload,market,target,url){
 if(normalizeDate(payload.date)!==target||!/^ok$/i.test(payload.stat||''))throw Error(market+'_official_date_or_status_mismatch');
 const table=(payload.tables||[]).find(t=>(t.fields||[]).includes('證券代號')&&(t.fields||[]).includes('當日沖銷交易成交股數'));
 if(!table||!Array.isArray(table.data)||!table.data.length)throw Error(market+'_official_stock_rows_missing');
 const codeIndex=table.fields.indexOf('證券代號'),volumeIndex=table.fields.indexOf('當日沖銷交易成交股數');
 const hash=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 const rows={};
 for(const row of table.data){const symbol=String(row[codeIndex]||'').trim();if(!/^\d{4}$/.test(symbol))continue;if(rows[symbol])throw Error(market+'_duplicate_symbol:'+symbol);rows[symbol]={symbol,market,tradeDate:target,daytradeShares:numeric(row[volumeIndex]),unit:'shares',source:url,sourceHash:hash,fetchedAt:new Date().toISOString()};}
 return rows;
}
function calculate(input,target){
 const raw=input?.recentVolume||{};
 const recentVolume=volume.calculate(raw.rows||[],raw.expectedDates||[],target);
 const d=input?.daytrade||{};
 const daytrade={source:d.source||null,sourceHash:d.sourceHash||null,tradeDate:d.tradeDate||null,symbol:d.symbol||null,market:d.market||null,
   daytradeShares:d.daytradeShares??null,totalVolumeShares:d.totalVolumeShares??null,totalVolumeSource:'stock_daily_volume',totalVolumeDate:d.totalVolumeDate||null,
   unit:d.unit||null,ratioPct:null,points:0,status:'unavailable',reasons:[]};
 if(!d.source||!d.sourceHash)daytrade.reasons.push('OFFICIAL_SOURCE_MISSING');
 if(d.tradeDate!==target||d.totalVolumeDate!==target)daytrade.reasons.push('SOURCE_DATE_MISMATCH');
 if(d.symbol!==input?.symbol)daytrade.reasons.push('SYMBOL_MISMATCH');
 if(d.unit!=='shares')daytrade.reasons.push('UNKNOWN_VOLUME_UNIT');
 const n=numeric(d.daytradeShares),den=numeric(d.totalVolumeShares);
 if(n===null||n<0)daytrade.reasons.push('INVALID_DAYTRADE_VOLUME');
 if(den===null||den<=0)daytrade.reasons.push('INVALID_TOTAL_VOLUME');
 if(n!==null&&den>0&&n>den)daytrade.reasons.push('DAYTRADE_EXCEEDS_TOTAL');
 if(!daytrade.reasons.length){daytrade.ratioPct=n/den*100;daytrade.points=daytrade.ratioPct>=50?5:0;daytrade.status=daytrade.points?'awarded':'not_awarded';}
 return {contract:CONTRACT,tradeDate:target,role:'bonus_only',recentVolume,daytrade,totalPoints:recentVolume.points+daytrade.points,sourceErrors:input?.errors||[]};
}
async function read(candidates,target){
 const urls={TWSE:`https://www.twse.com.tw/rwd/zh/dayTrading/TWTB4U?date=${target.replaceAll('-','')}&response=json`,TPEX:`https://www.tpex.org.tw/www/zh-tw/intraday/stat?date=${encodeURIComponent(target.replaceAll('-','/'))}&type=Daily&response=json`};
 const official={},errors=[];
 for(const [market,url] of Object.entries(urls)){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('HTTP_'+r.status);official[market]=parseOfficial(await r.json(),market,target,url);}
  catch(e){official[market]={};errors.push(market+':'+e.message);}
 }
 const result={};
 for(const row of candidates){
  const recentVolume=await volume.forSymbol(row.code,target);
  const market=/^(上市|TWSE|TSE)$/i.test(row.market)?'TWSE':/^(上櫃|TPEX|OTC)$/i.test(row.market)?'TPEX':null;
  const matched=market?official[market][row.code]:null;
  const today=recentVolume.rows.find(r=>r.date===target);
  result[row.code]={symbol:row.code,recentVolume,daytrade:matched?{...matched,totalVolumeShares:today?today.volume_lots*1000:null,totalVolumeDate:today?.date||null}:null,errors:[...errors,...(recentVolume.sourceError?[recentVolume.sourceError]:[]),...(!market?['UNKNOWN_MARKET']:[])]};
 }
 return result;
}
module.exports={CONTRACT,numeric,normalizeDate,parseOfficial,calculate,read};
