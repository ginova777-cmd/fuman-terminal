'use strict';
// Additive official disposition evidence. No blacklist, order or notification side effects.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
const dateOf=x=>Number.isFinite(Date.parse(x))?new Date(Date.parse(x)+28800000).toISOString().slice(0,10):null;
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const marketOf=m=>/^(TWSE|TSE|上市)$/i.test(m||'')?'TWSE':/^(TPEX|OTC|上櫃)$/i.test(m||'')?'TPEX':null;
function urls(m,date){if(!['TWSE','TPEX'].includes(m)||!validDate(date))throw Error('DISPOSITION_QUERY_IDENTITY');const d=date.replaceAll('-',''),s=encodeURIComponent(date.replaceAll('-','/'));return m==='TWSE'?{disposal:`https://www.twse.com.tw/announcement/punish?response=json&startDate=${d}&endDate=${d}`,eligibility:`https://www.twse.com.tw/rwd/zh/dayTrading/TWTB4U?date=${d}&response=json`}:{disposal:`https://www.tpex.org.tw/www/zh-tw/bulletin/disposal?startDate=${s}&endDate=${s}&type=all&response=json`,eligibility:`https://www.tpex.org.tw/www/zh-tw/intraday/list?date=${s}&response=json`};}
function datesIn(text){return [...String(text||'').matchAll(/(\d{3,4})\/(\d{1,2})\/(\d{1,2})/g)].map(m=>`${Number(m[1])<1911?Number(m[1])+1911:Number(m[1])}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);}
function parse(report,market,date,kind,observedDate,asOf){
 if(report?.market!==market||report.target_date!==date||report.kind!==kind||report.observed_date!==observedDate||report.url!==urls(market,date)[kind]||report.http_status!==200||report.error||report.payload_sha256!==hash(report.payload)||dateOf(report.fetched_at)!==observedDate||Date.parse(report.fetched_at)>Date.parse(asOf)||dateOf(asOf)!==observedDate)throw Error('DISPOSITION_PROVENANCE_INVALID');
 const p=report.payload;if(!/^ok$/i.test(p?.stat||''))throw Error('DISPOSITION_SOURCE_STATUS');
 if(kind==='eligibility'){
  if(String(p.date)!==date.replaceAll('-',''))throw Error('ELIGIBILITY_DATE_MISMATCH');
  const t=p.tables?.find(t=>t.fields?.includes('證券代號'));
  if(!t||!Array.isArray(t.data)||!t.data.length)throw Error('ELIGIBILITY_INCOMPLETE');
  const i=t.fields.indexOf('證券代號'),symbols=t.data.map(r=>String(r[i]||'').trim());
  if(symbols.some(s=>!s)||new Set(symbols).size!==symbols.length)throw Error('ELIGIBILITY_ROWS_INVALID');return symbols;
 }
 const t=market==='TWSE'?p:p.tables?.find(t=>t.fields?.includes('處置起訖時間'));
 if(!t||!Array.isArray(t.data))throw Error('DISPOSAL_TABLE_MISSING');
 if(market==='TWSE'?!datesIn(t.title).every(d=>d===date)||datesIn(t.title).length!==2:p.date!==`${date.replaceAll('-','')}~${date.replaceAll('-','')}`||!String(t.subtitle2).includes('全部'))throw Error('DISPOSAL_DATE_OR_SCOPE_MISMATCH');
 const f=t.fields||[],code=f.indexOf('證券代號'),period=f.indexOf(market==='TWSE'?'處置起迄時間':'處置起訖時間'),reason=f.indexOf(market==='TWSE'?'處置條件':'處置原因'),measures=f.indexOf('處置措施'),content=f.indexOf('處置內容');
 if([code,period,reason,measures,content].some(i=>i<0))throw Error('DISPOSAL_SCHEMA_MISMATCH');
 return t.data.map(row=>{const dates=datesIn(row[period]);if(dates.length!==2||!dates.every(validDate)||dates[0]>dates[1]||!String(row[code]||'').trim())throw Error('DISPOSAL_ROW_INVALID');return {symbol:String(row[code]).trim(),start_date:dates[0],announced_end_date:dates[1],reason:String(row[reason]||''),measures:String(row[measures]||''),details:String(row[content]||''),source_url:report.url,source_hash:report.payload_sha256};});
}
function evaluate({symbol,market,date,bundle,asOf}){
 market=marketOf(market);const out={contract:'mother_pool_disposition_v1',symbol,market,applicable_date:date,observed_date:dateOf(asOf),status:'UNKNOWN',is_disposition:null,reasons:[],notices:[],source_hashes:{},checked_at:null};
 if(!market||!validDate(date)||date>dateOf(asOf)||bundle?.target_date!==date||bundle?.observed_date!==dateOf(asOf)){out.reasons=['DISPOSITION_INPUT_MISSING_OR_STALE'];return out;}
 const reports=bundle.reports?.[market]||{};let notices=null,eligible=null;
 try{notices=parse(reports.disposal,market,date,'disposal',bundle.observed_date,asOf);out.source_hashes.disposal=reports.disposal.payload_sha256;}catch(e){out.reasons.push(e.message);}
 try{eligible=parse(reports.eligibility,market,date,'eligibility',bundle.observed_date,asOf);out.source_hashes.eligibility=reports.eligibility.payload_sha256;}catch(e){out.reasons.push(e.message);}
 const matched=notices?.filter(r=>r.symbol===symbol)||[];out.notices=matched;
 const active=matched.filter(r=>r.start_date<=date&&date<=r.announced_end_date);
 if(active.length&&eligible?.includes(symbol)){out.reasons.push('OFFICIAL_DISPOSITION_ELIGIBILITY_CONFLICT');}
 else if(active.length){out.status='DISPOSED';out.is_disposition=true;out.reasons=['OFFICIAL_DISPOSAL_PERIOD'];}
 else if(notices&&eligible?.includes(symbol)){out.status='NOT_DISPOSED';out.is_disposition=false;out.reasons=['OFFICIAL_SAME_DATE_DAYTRADE_ELIGIBLE'];}
 else out.reasons.push(matched.length?'DISPOSAL_EXTENSION_OR_RELEASE_UNPROVEN':'OFFICIAL_DISPOSITION_ABSENCE_NOT_SUFFICIENT');
 out.checked_at=Object.values(reports).map(r=>r.fetched_at).filter(t=>dateOf(t)===bundle.observed_date).sort().at(-1)||null;return out;
}
function directory(runtime,observedDate,date){if(!validDate(observedDate)||!validDate(date))throw Error('DISPOSITION_DATE_INVALID');return path.join(runtime,'data','mother-pool-disposition',observedDate,date);}
async function read({runtime,date,observedDate,request=fetch,clock=()=>new Date().toISOString()}){
 const dir=directory(runtime,observedDate,date);fs.mkdirSync(dir,{recursive:true});const bundle={contract:'official_disposition_bundle_v1',target_date:date,observed_date:observedDate,reports:{}};
 for(const market of ['TWSE','TPEX']){bundle.reports[market]={};for(const [kind,url] of Object.entries(urls(market,date))){
  const file=path.join(dir,`${market}-${kind}.json`);let report;
  try{report=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT'){bundle.reports[market][kind]={error:'DISPOSITION_CACHE_UNREADABLE'};continue;}
   try{fs.writeFileSync(file+'.attempt',JSON.stringify({url,at:clock()}),{flag:'wx'});}catch{bundle.reports[market][kind]={error:'DISPOSITION_ATTEMPT_IN_PROGRESS_OR_USED'};continue;}
   report={market,kind,url,target_date:date,observed_date:observedDate};
   try{const response=await request(url,{signal:AbortSignal.timeout(5000)});report.http_status=response.status;if(response.status!==200)throw Error('OFFICIAL_HTTP_'+response.status);report.payload=await response.json();report.payload_sha256=hash(report.payload);}catch(e){report.error=String(e.message||e);}
   report.fetched_at=clock();require('./daytrade-durable-json').writeExclusive(file,report);
  }bundle.reports[market][kind]=report;
 }}return bundle;
}
function readSymbol({runtime,symbol,market,date,asOf=new Date().toISOString()}){
 const observedDate=dateOf(asOf),bundle={target_date:date,observed_date:observedDate,reports:{}};
 try{const dir=directory(runtime,observedDate,date);market=marketOf(market);bundle.reports[market]={};for(const kind of ['disposal','eligibility']){try{bundle.reports[market][kind]=JSON.parse(fs.readFileSync(path.join(dir,`${market}-${kind}.json`),'utf8'));}catch{}}}catch{}
 return evaluate({symbol,market,date,bundle,asOf});
}
module.exports={read,readSymbol,evaluate,parse,urls,hash,marketOf};
