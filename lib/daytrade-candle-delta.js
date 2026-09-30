'use strict';
const crypto=require('crypto');
const CONTRACT='daytrade-candle-delta-v1';
function identity(row){return `${row.symbol}|${row.candle_time}`;}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
function fingerprint(row){
 const copy={...row,payload:{...row.payload}};
 delete copy.updated_at; delete copy.payload.cacheUpdatedAt;
 return crypto.createHash('sha256').update(JSON.stringify(stable(copy))).digest('hex');
}
function selectDelta(rows, checkpoint, {tradeDate,target,nowMs=Date.now()}){
 const previous=checkpoint?.contract===CONTRACT&&checkpoint.trade_date===tradeDate&&checkpoint.target===target ? checkpoint.hashes||{} : {};
 const unique=new Map();let notDue=0;
 for(const row of rows){
  const start=Date.parse(row.candle_time);
  if(row.trade_date!==tradeDate||!/^\d{4}$/.test(row.symbol)||!Number.isFinite(start))throw Error('CANDLE_DELTA_INVALID_IDENTITY');
  if(row.synthetic!==false)throw Error('CANDLE_DELTA_NOT_NATURAL');
  if(start+60000>nowMs){notDue++;continue;}
  const key=identity(row);
  if(unique.has(key)&&fingerprint(unique.get(key))!==fingerprint(row))throw Error('CANDLE_DELTA_CONFLICTING_DUPLICATE:'+key);
  unique.set(key,row);
 }
 const pending=[...unique.values()].filter(row=>previous[identity(row)]!==fingerprint(row));
 return {pending,not_due:notDue,unchanged:unique.size-pending.length,checkpoint:{contract:CONTRACT,trade_date:tradeDate,target,hashes:{...previous}}};
}
function acknowledge(checkpoint,rows){const next={...checkpoint,hashes:{...checkpoint.hashes}};for(const row of rows)next.hashes[identity(row)]=fingerprint(row);return next;}
module.exports={CONTRACT,selectDelta,acknowledge,fingerprint};
