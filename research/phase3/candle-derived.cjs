'use strict';
// Executes the original local buildGrouped function only, with an explicit offline clock.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const file=path.resolve(__dirname,'../../scripts/run-daytrade-source-writer.js'),source=fs.readFileSync(file,'utf8');
const start=source.indexOf('  const buildGrouped = (rows, tradeDate) => {',source.indexOf('async function fetchIntradayStatus('));
const end=source.indexOf('\n  const tradeDate = taipeiDateFrom(nowIso());',start);
if(start<0||end<start)throw Error('ORACLE_BOUNDARY');const code=source.slice(start,end);
const hash=crypto.createHash('sha256').update(code).digest('hex');
function derive(rows,tradeDate,asOf){
 const now=Date.parse(asOf);if(!Number.isFinite(now))throw Error('CLOCK');
 const context={normalizeCode:x=>String(x||'').trim(),normalizeTimestamp:x=>Number.isFinite(Date.parse(x))?new Date(x).toISOString():'',numberValue:(x,f=0)=>Number.isFinite(Number(x))?Number(x):f,taipeiDateFrom:x=>new Date(Date.parse(x)+28800000).toISOString().slice(0,10),ageSeconds:x=>(now-Date.parse(x))/1000,rows,tradeDate};
 vm.createContext(context);const r=vm.runInContext(code+'\n[...buildGrouped(rows,tradeDate)]',context,{timeout:5000});return JSON.parse(JSON.stringify(r));
}
function impacted({symbol,minute,historyRevision=false}){
 if(typeof symbol!=='string'||!Number.isFinite(Date.parse(minute)))throw Error('REVISION_IDENTITY');
 return {symbol,from:minute,scope:historyRevision?'ALL_CURRENT_AND_HISTORY_DEPENDENT_WINDOWS':'REVISED_MINUTE_THROUGH_CURRENT_END',resources:['intradayMap','rolling_volume','rolling_return','RSI','KD','MACD','strategy3','telegram','pending_confirmation'],historical_notification_replay:false};
}
module.exports={derive,impacted,source_hash:hash};
