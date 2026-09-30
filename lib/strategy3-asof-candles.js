'use strict';
const crypto=require('node:crypto');
function createAsOfCandleReader({url,key,fetchImpl=fetch}){
 return async function({tradeDate,symbols,barsPerSymbol,asOf}){
  const at=Date.parse(asOf);
  if(!url||!key)throw Error('CANDLE_READ_CREDENTIAL_MISSING');
  if(!Number.isFinite(at)||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)||!Array.isArray(symbols)||!symbols.length||new Set(symbols).size!==symbols.length||symbols.some(s=>!/^\d{4}$/.test(s))||!Number.isInteger(barsPerSymbol)||barsPerSymbol<20||barsPerSymbol>500)throw Error('CANDLE_ASOF_SCOPE_INVALID');
  const upper=Math.floor(at/60000)*60000,lower=upper-barsPerSymbol*60000,rows=[],pages=[];
  const size=Math.max(1,Math.floor(500/barsPerSymbol));
  for(let offset=0;offset<symbols.length;offset+=size){
   const group=symbols.slice(offset,offset+size);
   const query=new URLSearchParams({select:'symbol,trade_date,candle_time,open,high,low,close,volume,synthetic,volume_strategy_usable',symbol:'in.('+group.join(',')+')',trade_date:'eq.'+tradeDate,and:'(candle_time.gte.'+new Date(lower).toISOString()+',candle_time.lt.'+new Date(upper).toISOString()+')',order:'symbol.asc,candle_time.asc'});
   const response=await fetchImpl(url.replace(/\/+$/,'')+'/rest/v1/fugle_daytrade_intraday_1m?'+query,{headers:{apikey:key,Authorization:'Bearer '+key,Prefer:'count=exact','Range-Unit':'items',Range:'0-499'},signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('CANDLE_READBACK_HTTP_'+response.status);
   const batch=await response.json(),range=response.headers.get('content-range')||'',match=range.match(/^(?:0-(\d+)|\*)\/(\d+)$/);
   if(!Array.isArray(batch)||batch.length>500||!match||Number(match[2])!==batch.length||batch.length>0&&Number(match[1])+1!==batch.length)throw Error('CANDLE_READBACK_TRUNCATED_OR_UNPROVEN');
   const seen=new Set();for(const row of batch){const time=Date.parse(row.candle_time),identity=row.symbol+'|'+row.candle_time;if(!group.includes(row.symbol)||row.trade_date!==tradeDate||!Number.isFinite(time)||time<lower||time>=upper||seen.has(identity))throw Error('CANDLE_READBACK_IDENTITY_INVALID');seen.add(identity);}
   pages.push({batch_index:pages.length,requested_symbols:group.length,requested_bars_per_symbol:barsPerSymbol,readback:batch.length,http:response.status,content_range:range});rows.push(...batch);
  }
  rows.readback={source:'fugle_daytrade_intraday_1m',as_of:asOf,lower:new Date(lower).toISOString(),upper_exclusive:new Date(upper).toISOString(),pages,rows:rows.length,sha256:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
  return rows;
 };
}
module.exports={createAsOfCandleReader};
