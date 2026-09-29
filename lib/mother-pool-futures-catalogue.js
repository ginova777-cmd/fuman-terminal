'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const mapping=require('./taifex-stock-future-mapping'),{hash}=require('./mother-pool-module-write-set'),{writeExclusive}=require('./daytrade-durable-json');
const FUGLE='https://api.fugle.tw/marketdata/v1.0/futopt/intraday/tickers?type=FUTURE';
const TAIFEX='https://www.taifex.com.tw/cht/2/stockLists';
const day=stamp=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
function inspect(snapshot,tradeDate,asOf){
 try{
  if(snapshot?.contract!=='mother_pool_futures_catalogue_v1'||snapshot.trade_date!==tradeDate||!snapshot.run_id||!Number.isFinite(Date.parse(snapshot.observed_at))||!Number.isFinite(Date.parse(asOf))||Date.parse(snapshot.observed_at)>Date.parse(asOf)||day(snapshot.observed_at)!==tradeDate)throw Error('FUTURES_CATALOGUE_IDENTITY_OR_TIME');
  if(snapshot.fugle_url!==FUGLE||snapshot.taifex_url!==TAIFEX||snapshot.source_hash!==hash({fugle:snapshot.raw_fugle,taifex:snapshot.raw_taifex_html}))throw Error('FUTURES_CATALOGUE_SOURCE_HASH');
  const result=mapping.map(snapshot.raw_fugle?.data,mapping.parse(snapshot.raw_taifex_html),tradeDate);
  return {...result,status:result.complete?'READY':'BLOCKED',source_date:tradeDate,run_id:snapshot.run_id,source_count:result.mapped.length+result.excluded.length+result.gaps.length,failed_checks:result.complete?[]:['FUTURES_CATALOGUE_MAPPING_GAP']};
 }catch(error){return {status:'BLOCKED',complete:false,symbols:[],mapped:[],excluded:[],gaps:[],source_count:null,source_date:snapshot?.trade_date||null,run_id:snapshot?.run_id||null,failed_checks:[error.message]};}
}
async function refresh({runtime,tradeDate,asOf,key,fetchImpl=fetch,now=()=>new Date().toISOString()}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)||!Number.isFinite(Date.parse(asOf))||day(asOf)!==tradeDate)throw Error('FUTURES_CATALOGUE_EXECUTION_DATE');
 const file=path.join(runtime,'data','futures-catalogue',tradeDate+'.json');
 let cached;try{cached=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('FUTURES_CATALOGUE_CACHE_UNREADABLE');}
 if(cached){if(inspect(cached,tradeDate,asOf).status!=='READY')throw Error('FUTURES_CATALOGUE_CACHE_INVALID');return cached;}
 if(!key)throw Error('FUGLE_CREDENTIAL_REQUIRED');
 const fugle=await fetchImpl(FUGLE,{headers:{'X-API-KEY':key},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(fugle.status!==200)throw Error('FUGLE_CATALOGUE_HTTP_'+fugle.status);
 const rawFugle=await fugle.json();
 const taifex=await fetchImpl(TAIFEX,{redirect:'error',signal:AbortSignal.timeout(15000)});
 if(taifex.status!==200)throw Error('TAIFEX_CATALOGUE_HTTP_'+taifex.status);
 const rawTaifex=await taifex.text();
 const observedAt=now();
 const snapshot={contract:'mother_pool_futures_catalogue_v1',trade_date:tradeDate,run_id:'futures-catalogue:'+tradeDate+':'+randomUUID(),observed_at:observedAt,fugle_url:FUGLE,taifex_url:TAIFEX,raw_fugle:rawFugle,raw_taifex_html:rawTaifex,source_hash:hash({fugle:rawFugle,taifex:rawTaifex})};
 const result=inspect(snapshot,tradeDate,observedAt);if(result.status!=='READY')throw Error(result.failed_checks.join('|'));
 fs.mkdirSync(path.dirname(file),{recursive:true});writeExclusive(file,snapshot);return snapshot;
}
module.exports={refresh,inspect,FUGLE,TAIFEX};
