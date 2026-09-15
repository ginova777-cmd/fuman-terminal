"use strict";
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {evaluateVolumeWindow}=require('./strategy4-volume-window');
function normalizeHistory(payload,symbol,dates){
  if(payload?.symbol && String(payload.symbol)!==symbol)throw Error('history_symbol_mismatch');
  const rows=[];const seen=new Set();
  for(const r of payload?.data||[]){
    const date=String(r.date||'').slice(0,10);if(!dates.includes(date))continue;
    if(seen.has(date))throw Error('duplicate_history_date');seen.add(date);
    if(r.volume==null||r.volume===''||!Number.isFinite(Number(r.volume))||Number(r.volume)<0||!['open','high','low','close'].every(k=>Number.isFinite(Number(r[k]))&&Number(r[k])>0))continue;
    if(Number(r.high)<Math.max(Number(r.open),Number(r.close))||Number(r.low)>Math.min(Number(r.open),Number(r.close)))continue;
    rows.push({date,open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume_lots:Number(r.volume)/1000,volume_shares:Number(r.volume)});
  }
  return rows;
}
async function repairVolumeGaps(stocks,cache,dates,runtime){
  const missing=stocks.filter(s=>!evaluateVolumeWindow(cache.byCode?.[s.code]||[],dates).ok);
  const result={contract:'strategy4-volume-window-repair-v1',tradeDate:dates.at(-1),startedAt:new Date().toISOString(),expectedDates:dates,candidates:missing.length,appliedRows:0,items:[],source:'fugle-historical-candles',stoppedReason:''};
  if(missing.length>200)throw Error('strategy4_volume_repair_scope_over_200');
  const secret=n=>{try{return fs.readFileSync(path.join(runtime,'secrets',n),'utf8').trim()}catch{return ''}};
  const fugle=process.env.FUGLE_API_KEY||secret('fugle-api-key.txt');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||secret('supabase-service-role-key.txt');
  const url=process.env.SUPABASE_URL||secret('supabase-url.txt');
  if(!fugle||!key||!url)throw Error('volume_repair_missing_credentials');
  async function upsert(table,rows){if(!rows.length)return;const r=await fetch(url.replace(/\/$/,'')+'/rest/v1/'+table+'?on_conflict=symbol,trade_date',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('volume_repair_db_http_'+r.status);}
  for(const stock of missing){
    const code=stock.code;
    const response=await fetch('https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/'+code+'?'+new URLSearchParams({from:dates[0],to:dates.at(-1)}),{headers:{'X-API-KEY':fugle},signal:AbortSignal.timeout(20000)}).catch(()=>null);
    if(!response || [401,403,429].includes(response.status)){result.stoppedReason=response?'fugle_http_'+response.status:'fugle_network_error';break;}
    if(!response.ok){result.items.push({code,status:'unavailable',httpStatus:response.status});continue;}
    const raw=await response.text(),payload=JSON.parse(raw),hash=crypto.createHash('sha256').update(raw).digest('hex');
    const got=normalizeHistory(payload,code,dates);
    const existing=new Set((cache.byCode?.[code]||[]).map(r=>r.date));
    const rows=got.filter(r=>!existing.has(r.date));
    const updated_at=new Date().toISOString();
    const evidence={source:'fugle-historical-candles',volume_unit:'lots',raw_volume_unit:'shares',response_sha256:hash,repair_contract:result.contract};
    await upsert('fugle_daily_ohlcv',rows.map(r=>({symbol:code,trade_date:r.date,open:r.open,high:r.high,low:r.low,close:r.close,volume:r.volume_lots,source:evidence.source,updated_at,payload:evidence})));
    await upsert('fugle_daily_volume',rows.map(r=>({symbol:code,trade_date:r.date,volume:r.volume_lots,updated_at,payload:evidence})));
    result.appliedRows+=rows.length;result.items.push({code,status:rows.length?'applied':'no_missing_dates_returned',dates:rows.map(r=>r.date),response_sha256:hash});
    await new Promise(resolve=>setTimeout(resolve,1100));
  }
  result.finishedAt=new Date().toISOString();const dest=path.join(runtime,'data','scan-receipts','strategy4-volume-repair-'+dates.at(-1).replace(/-/g,'')+'.json');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(result,null,2)+'\n');return result;
}
module.exports={normalizeHistory,repairVolumeGaps};
