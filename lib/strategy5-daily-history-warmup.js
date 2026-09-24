'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {MIN_BARS}=require('./technical-indicators');
const CONTRACT='strategy5-daily-history-warmup-v1';
const startDate=date=>new Date(Date.parse(date+'T00:00:00Z')-60*86400000).toISOString().slice(0,10);
function normalize(payload,code,date){
 if(payload?.symbol!==code||payload?.timeframe!=='D'||!Array.isArray(payload.data)||payload.adjusted===true)throw Error('HISTORY_IDENTITY_MISMATCH');
 const from=startDate(date),seen=new Set();
 return payload.data.map(b=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||b.date<from||b.date>date||seen.has(b.date))throw Error('HISTORY_DATE_INVALID');seen.add(b.date);
  if(!['open','high','low','close'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||typeof b.volume!=='number'||!Number.isFinite(b.volume)||b.volume<0)throw Error('HISTORY_FIELDS_INVALID');
  return {...b,volume_lots:b.volume/1000};
 }).sort((a,b)=>a.date.localeCompare(b.date));
}
async function warm(candidates,date,{runtime=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime',dailyTable=process.env.STRATEGY4_DAILY_VIEW||'stock_daily_volume'}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('INVALID_TRADE_DATE');
 const secret=n=>fs.readFileSync(path.join(runtime,'secrets',n),'utf8').trim();
 const url=secret('supabase-url.txt'),key=secret('supabase-service-role-key.txt'),fugle=secret('fugle-api-key.txt');
 const headers={apikey:key,Authorization:'Bearer '+key};
 const dir=path.join(runtime,'data/strategy5-history-warmup',date,new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true});
 async function get(table,code,extraHeaders=headers){const u=new URL(url+'/rest/v1/'+table);for(const[k,v]of Object.entries({select:'symbol,trade_date,open,high,low,close',symbol:'eq.'+code,and:'(trade_date.gte.'+startDate(date)+',trade_date.lte.'+date+')',order:'trade_date.asc',limit:'1000'}))u.searchParams.set(k,v);const r=await fetch(u,{headers:extraHeaders,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('DAILY_READ_HTTP_'+r.status);return r.json();}
 const report={contract:CONTRACT,trade_date:date,started_at:new Date().toISOString(),candidate_count:candidates.length,attempted:0,written:0,rows:[],issues:[],creates_formal_result:false};
 let anon='';for(const name of ['supabase-anon-key.txt','supabase-publishable-key.txt']){try{anon=secret(name);if(anon)break;}catch{}}
 if(!anon)throw Error('ANON_READBACK_KEY_MISSING');
 let nextFetch=0;
 try{for(const candidate of candidates){const code=String(candidate.code);if(!/^\d{4}$/.test(code))throw Error('INVALID_CANDIDATE_SYMBOL');const existing=await get(dailyTable,code);
  if(existing.length>=MIN_BARS)continue;
  report.attempted++;const evidence={code,before:existing.length,status:'blocked',written:0};report.rows.push(evidence);
  try{
   await new Promise(r=>setTimeout(r,Math.max(0,nextFetch-Date.now())));nextFetch=Date.now()+1200;
   const u=new URL('https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/'+code);for(const[k,v]of Object.entries({timeframe:'D',from:startDate(date),to:date,sort:'asc',adjusted:'false',fields:'open,high,low,close,volume'}))u.searchParams.set(k,v);
   const response=await fetch(u,{headers:{'X-API-KEY':fugle},signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('FUGLE_HISTORY_HTTP_'+response.status);
   const raw=await response.text(),payload=JSON.parse(raw),bars=normalize(payload,code,date);fs.writeFileSync(path.join(dir,code+'-source.json'),raw);evidence.source_sha256=crypto.createHash('sha256').update(raw).digest('hex');
   const present=new Set(existing.map(b=>b.trade_date));const missing=bars.filter(b=>b.date<date&&!present.has(b.date));
   const inserted=[];
   for(const table of ['fugle_daily_ohlcv','fugle_daily_volume']){
    const rows=missing.map(b=>({symbol:code,trade_date:b.date,market:candidate.market||'',volume:b.volume_lots,updated_at:new Date().toISOString(),payload:{source:'fugle:historical/candles:D',volume_unit:'lots',raw_volume:b.volume,raw_volume_unit:'shares',source_sha256:evidence.source_sha256,warmup_contract:CONTRACT},...(table==='fugle_daily_ohlcv'?{open:b.open,high:b.high,low:b.low,close:b.close,source:'fugle:historical/candles:D',name:candidate.name||code}:{})}));
    if(!rows.length)continue;const r=await fetch(url+'/rest/v1/'+table+'?on_conflict=symbol,trade_date',{method:'POST',headers:{...headers,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(rows),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('HISTORY_WRITE_'+table+'_HTTP_'+r.status);const written=await r.json();if(table==='fugle_daily_ohlcv')inserted.push(...written);
   }
   const readback=await get(dailyTable,code,{apikey:anon,Authorization:'Bearer '+anon});
   for(const b of inserted){const found=readback.find(r=>r.trade_date===b.trade_date);if(!found||!['open','high','low','close'].every(k=>Number(found[k])===Number(b[k])))throw Error('HISTORY_ANON_READBACK_MISMATCH');}
   evidence.written=inserted.length;report.written+=inserted.length;evidence.after=readback.length;evidence.status=readback.length>=MIN_BARS?'ready':'data_gap';evidence.reason=readback.length>=MIN_BARS?null:'INSUFFICIENT_PROVIDER_HISTORY';
  }catch(e){evidence.reason=e.message;report.issues.push({code,reason:e.message});if(e.message.includes('HTTP_429'))break;}
  console.log('strategy5 history warmup '+JSON.stringify(evidence));
 }}finally{report.finished_at=new Date().toISOString();report.ok=report.issues.length===0;fs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(report,null,2));}
 return report;
}
module.exports={warm,normalize,CONTRACT};
