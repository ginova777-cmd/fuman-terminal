'use strict';
// Derived from the existing persisted cache, never an additional source.
// Preserve original rows and quality fields. Historical repair stays on the
// full-cache path; this window is explicitly not a completeness receipt.
function buildRecent(cache,{barsPerSymbol=3,maxSymbols=2000,maxBytes=16*1024*1024}={}){
 if(!Array.isArray(cache?.candles)||!Number.isFinite(Date.parse(cache.updatedAt))||!Number.isInteger(barsPerSymbol)||barsPerSymbol<2||barsPerSymbol>3)throw Error('RECENT_CANDLE_CACHE_INVALID');
 const groups=new Map();
 for(const row of cache.candles){
  const symbol=String(row?.code||row?.symbol||''),time=Date.parse(row?.candleTime||row?.date||'');
  if(!/^\d{4}$/.test(symbol)||!Number.isFinite(time))throw Error('RECENT_CANDLE_IDENTITY_INVALID');
  if(!groups.has(symbol)){if(groups.size>=maxSymbols)throw Error('RECENT_CANDLE_SYMBOL_LIMIT');groups.set(symbol,[]);}
  const group=groups.get(symbol);
  if(group.some(x=>x.time===time))throw Error('RECENT_CANDLE_DUPLICATE_TIME');
  group.push({time,row});group.sort((a,b)=>b.time-a.time);if(group.length>barsPerSymbol)group.pop();
 }
 const candles=[...groups].sort(([a],[b])=>a<b?-1:a>b?1:0).flatMap(([,rows])=>rows.map(x=>x.row));
 const value={contract:'daytrade-recent-candle-cache-v1',source:cache.source,channel:cache.channel,updatedAt:cache.updatedAt,bars_per_symbol:barsPerSymbol,symbol_count:groups.size,count:candles.length,full_history_complete:false,historical_revisions_included:false,candles};
 const text=JSON.stringify(value);if(Buffer.byteLength(text)>maxBytes)throw Error('RECENT_CANDLE_BYTE_LIMIT');
 return JSON.parse(text);
}
module.exports={buildRecent};
