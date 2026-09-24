'use strict';
const fs=require('node:fs'),path=require('node:path');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const digest=x=>require('./mother-pool-module-write-set').hash(stable(x));
function urls(date){return {TWSE:`https://www.twse.com.tw/rwd/zh/dayTrading/TWTB4U?date=${date.replaceAll('-','')}&response=json`,TPEX:`https://www.tpex.org.tw/www/zh-tw/intraday/stat?date=${encodeURIComponent(date.replaceAll('-','/'))}&type=Daily&response=json`};}
async function read({tradeDate,calendar,runtime,request=fetch,clock=()=>new Date().toISOString()}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate))return {source_date:null,reports:{},error:'EXECUTION_DATE_INVALID'};
 let date;try{date=require('./mother-pool-daily-volume-baseline').datesFromCalendar(calendar,tradeDate).at(-1);}catch{return {source_date:null,reports:{},error:'OFFICIAL_PREVIOUS_SESSION_UNPROVEN'};}
 const dir=path.join(runtime,'data','mother-pool-official-daytrade',tradeDate);fs.mkdirSync(dir,{recursive:true});
 const reports={};
 await Promise.all(Object.entries(urls(date)).map(async([market,url])=>{
  const file=path.join(dir,market+'.json');
  try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(saved.source_date===date&&saved.source_url===url){reports[market]=saved;return;}reports[market]={error:'OFFICIAL_CACHE_IDENTITY_MISMATCH'};return;}catch(e){if(e.code!=='ENOENT'){reports[market]={error:'OFFICIAL_CACHE_UNREADABLE'};return;}}
  try{fs.writeFileSync(file+'.attempt',JSON.stringify({source_date:date,market,at:clock()}),{flag:'wx'});}catch{reports[market]={error:'OFFICIAL_DAILY_ATTEMPT_ALREADY_USED'};return;}
  let report={market,source_date:date,source_url:url};
  try{const response=await request(url,{signal:AbortSignal.timeout(30000)});report.http_status=response.status;if(response.status!==200)throw Error('OFFICIAL_HTTP_'+response.status);report.payload=await response.json();report.payload_sha256=digest(report.payload);}
  catch(error){report.error=String(error.message||error);}
  report.fetched_at=clock();reports[market]=report;fs.writeFileSync(file,JSON.stringify(report),{flag:'wx'});
 }));
 return {source_date:date,reports};
}
function parse(report,market,date,asOf){
 if(report?.market!==market||report.source_date!==date||report.source_url!==urls(date)[market]||report.http_status!==200||report.error||report.payload_sha256!==digest(report.payload)||!Number.isFinite(Date.parse(report.fetched_at))||Date.parse(report.fetched_at)>Date.parse(asOf)||Date.parse(report.fetched_at)<Date.parse(date+'T13:30:00+08:00'))throw Error('OFFICIAL_REPORT_PROVENANCE_INVALID');
 return require('./strategy5-ranking-bonuses').parseOfficial(report.payload,market,date,report.source_url);
}
module.exports={read,parse,urls,digest};
