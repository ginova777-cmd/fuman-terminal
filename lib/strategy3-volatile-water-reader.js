'use strict';
const crypto=require('node:crypto');
const {CONTRACT}=require('./daytrade-volatile-snapshot');
const {CONTRACT:FIELD_CONTRACT,quoteEvidence,volumeEvidence}=require('./strategy3-source-field-contract');
function createReader({readSnapshot,readCandles,isTradingDay,now=Date.now}) {
 return async function readWater({tradeDate,minimumCandlesPerSymbol=20,barsPerSymbol=20,motherPoolSnapshotIdentity=null}={}){
  const poolBySymbol=new Map(),quoteBySymbol=new Map(),candleRowsBySymbol=new Map(),symbolDataGaps=new Map();
  const maps={poolBySymbol,quoteBySymbol,candleRowsBySymbol,symbolDataGaps,evidenceBySymbol:new Map()};
  try{
   if(!Number.isInteger(minimumCandlesPerSymbol)||minimumCandlesPerSymbol<20)throw Error('MINIMUM_CANDLES_BELOW_CONTRACT');
   if(!Number.isInteger(barsPerSymbol)||barsPerSymbol<minimumCandlesPerSymbol)throw Error('CANDLE_REQUEST_TOO_SMALL');
   if(await isTradingDay(tradeDate)!==true)throw Error('MARKET_CALENDAR_NOT_OPEN');
   const s=await readSnapshot({tradeDate,snapshotId:motherPoolSnapshotIdentity?.snapshot_id,leaseId:motherPoolSnapshotIdentity?.lease_id});
   if(s.contract!==CONTRACT||s.storage!=='volatile_memory'||s.trade_date!==tradeDate||!s.snapshot_id||!s.producer_epoch||!Number.isInteger(s.snapshot_sequence)||s.snapshot_sequence<1||!s.canonical_run_id)throw Error('VOLATILE_SNAPSHOT_IDENTITY_INVALID');
   const source=s.source_evidence;
   if(!source||source.contract!=='mother-pool-memory-readiness-v1'||source.trade_date!==tradeDate||source.canonical_run_id!==s.canonical_run_id)throw Error('VOLATILE_SOURCE_READINESS_IDENTITY_INVALID');
   if(source.formal_entry_allowed!==true||source.formal_ready!==true)throw Error('VOLATILE_SOURCE_NOT_READY');
   if(s.canonical_run_id!=='fugle_daytrade_source:'+tradeDate.replace(/-/g,'')+':canonical')throw Error('VOLATILE_CANONICAL_ID_INVALID');
   if(!Array.isArray(s.rows)||s.rows.length===0||s.count!==s.rows.length)throw Error('VOLATILE_SNAPSHOT_COUNT_INVALID');
   const at=Date.parse(s.observed_at);const lease=s.verification_lease;
   if(motherPoolSnapshotIdentity&&(!lease||lease.mode!=='pinned_verification_not_live'||lease.lease_id!==motherPoolSnapshotIdentity.lease_id||Date.parse(lease.expires_at)<=now()))throw Error('VOLATILE_VERIFICATION_LEASE_INVALID');
   if(!Number.isFinite(at)||now()-at<0||!motherPoolSnapshotIdentity&&now()-at>5000)throw Error('VOLATILE_SNAPSHOT_STALE');
   const identity={source_mode:'volatile_memory',trade_date:tradeDate,canonical_run_id:s.canonical_run_id,snapshot_id:s.snapshot_id,producer_epoch:s.producer_epoch,snapshot_sequence:s.snapshot_sequence,lease_id:lease?.lease_id||null,lease_expires_at:lease?.expires_at||null,symbols_sha256:crypto.createHash('sha256').update(JSON.stringify(s.rows.map(r=>r.symbol).sort())).digest('hex')};
   if(motherPoolSnapshotIdentity&&JSON.stringify(identity)!==JSON.stringify(motherPoolSnapshotIdentity))throw Error('VOLATILE_PINNED_IDENTITY_MISMATCH');
   for(const row of s.rows){if(!/^\d{4}$/.test(row.symbol)||poolBySymbol.has(row.symbol))throw Error('POOL_DUPLICATE_OR_INVALID');poolBySymbol.set(row.symbol,row);}
   for(const q of s.quotes||[]){if(!poolBySymbol.has(q.symbol)||quoteBySymbol.has(q.symbol)||q.trade_date!==tradeDate)throw Error('QUOTE_IDENTITY_INVALID');quoteBySymbol.set(q.symbol,q);}
   const rows=await readCandles({tradeDate,symbols:[...poolBySymbol.keys()],barsPerSymbol,asOf:s.observed_at});
   if(!Array.isArray(rows))throw Error('CANDLE_READBACK_INVALID');
   const seen=new Set();
   for(const c of rows){
    if(!poolBySymbol.has(c.symbol)||c.trade_date!==tradeDate)throw Error('CANDLE_READBACK_IDENTITY_INVALID');
    const key=c.symbol+'|'+c.candle_time;if(seen.has(key))throw Error('CANDLE_READBACK_DUPLICATE');seen.add(key);
    const start=Date.parse(c.candle_time);
    const candleDate=Number.isFinite(start)?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start)):'';
    const missing=candleDate!==tradeDate||c.volume_strategy_usable===false||c.synthetic!==false||!Number.isFinite(start)||start+60000>at||['open','high','low','close','volume'].some(k=>c[k]===null||c[k]===undefined||!Number.isFinite(Number(c[k])))||Number(c.volume)<0||['open','high','low','close'].some(k=>Number(c[k])<=0)||Number(c.high)<Math.max(Number(c.open),Number(c.close),Number(c.low))||Number(c.low)>Math.min(Number(c.open),Number(c.close),Number(c.high));
    if(missing){symbolDataGaps.set(c.symbol,['INVALID_OR_UNFINISHED_NATURAL_CANDLE']);continue;}
    if(!candleRowsBySymbol.has(c.symbol))candleRowsBySymbol.set(c.symbol,[]);candleRowsBySymbol.get(c.symbol).push(c);
   }
   let quoteValidRows=0;
   for(const symbol of poolBySymbol.keys()){
    const gaps=[...(symbolDataGaps.get(symbol)||[])];const q=quoteBySymbol.get(symbol),beforeQuoteGapCount=gaps.length;
    if(!q)gaps.push('QUOTE_MISSING');else {if(q.price===null||q.price===undefined||!Number.isFinite(Number(q.price))||Number(q.price)<=0)gaps.push('QUOTE_PRICE_INVALID');const qe=quoteEvidence(q,tradeDate),ve=volumeEvidence(q,tradeDate);gaps.push(...qe.gaps,...ve.gaps);quoteBySymbol.set(symbol,{...q,...qe,...ve});const age=at-Date.parse(q.quote_seen_at);if(!Number.isFinite(age)||age<0||age>120000)gaps.push('QUOTE_STALE');}
    if(q&&gaps.length===beforeQuoteGapCount)quoteValidRows++;
    const candles=candleRowsBySymbol.get(symbol)||[];candles.sort((a,b)=>Date.parse(a.candle_time)-Date.parse(b.candle_time));
    if(candles.some((c,i)=>i>0&&Date.parse(c.candle_time)-Date.parse(candles[i-1].candle_time)!==60000))gaps.push('CANDLE_MINUTE_GAP');
    if(candles.length<minimumCandlesPerSymbol)gaps.push('CANDLE_SAMPLE_INSUFFICIENT');
    const latest=Date.parse(candles.at(-1)?.candle_time||'');
    if(!Number.isFinite(latest)||at-(latest+60000)>120000)gaps.push('LATEST_CANDLE_STALE');
    if(gaps.length)symbolDataGaps.set(symbol,[...new Set(gaps)]);
   }
   const qualified=poolBySymbol.size-symbolDataGaps.size;
   const ok=qualified>=Math.ceil(poolBySymbol.size*0.9);
   const failures=ok?[]:['STRATEGY3_VOLATILE_COVERAGE_BELOW_90_PERCENT'];
   return {ok,skipped:false,...maps,failedChecks:failures,firstBlocker:failures[0]||null,receipt:{contract:'strategy3-volatile-water-v1',contract_version:'4.1.0',mother_pool_snapshot:{ok:true,identity,binding:'immutable_memory_snapshot'},mother_pool_http_status:null,mother_pool_transport:'local_named_pipe',mother_pool_pages:s.transport_readback?.page_count||null,quote_valid_rows:quoteValidRows,intraday_1m_valid_rows:qualified,receipt_incomplete:false,global_formal_gate_blocked:false,candle_readback:rows.readback||null,status:ok?'complete':'failed',complete:ok,source_field_contract:FIELD_CONTRACT,scanner_source:'memory:mother-pool-volatile-snapshot-v1+memory:quotes+table:fugle_daytrade_intraday_1m',source_mode:'volatile_pool_quote_and_persisted_1m',source_readiness:source,unique_symbols:poolBySymbol.size,symbol_data_gap_rows:symbolDataGaps.size,symbol_data_gaps:[...symbolDataGaps].map(([symbol,reasons])=>({symbol,reasons})),trade_date:tradeDate,canonical_run_id:s.canonical_run_id,snapshot_id:s.snapshot_id,producer_epoch:s.producer_epoch,snapshot_sequence:s.snapshot_sequence,mother_pool_rows:poolBySymbol.size,qualified_symbols:qualified,coverage_ratio:qualified/poolBySymbol.size,failed_checks:failures,first_blocker:failures[0]||null}};
  }catch(error){return {ok:false,skipped:false,...maps,failedChecks:[error.message],firstBlocker:error.message,receipt:{contract:'strategy3-volatile-water-v1',complete:false,first_blocker:error.message}};}
 };
}
module.exports={createReader};
