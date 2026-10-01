'use strict';
const {createHash}=require('node:crypto');
const CONTRACT='daytrade_daily_mirror_dedup_v1';
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
 return value;
}
function fingerprint(rows){
 // Publication time is not a change to historical daily volume.
 const normalized=rows.map(({updated_at,...row})=>row).sort((a,b)=>a.symbol.localeCompare(b.symbol));
 return createHash('sha256').update(JSON.stringify(canonical(normalized))).digest('hex');
}
function reusable(previous,{tradeDate,hash,count,now}){
 const age=now-Date.parse(previous?.saved_at);
 return previous?.contract===CONTRACT&&previous.trade_date===tradeDate&&previous.sha256===hash&&previous.rows===count&&age>=0&&age<30*60*1000;
}
function receipt({tradeDate,hash,count,now}){return {contract:CONTRACT,trade_date:tradeDate,sha256:hash,rows:count,saved_at:new Date(now).toISOString(),evidence:'successful_upsert_response',independent_readback_verified:false};}
module.exports={fingerprint,reusable,receipt};
