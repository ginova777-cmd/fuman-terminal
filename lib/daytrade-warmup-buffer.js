'use strict';
function createWarmupBuffer({mergeQuote,maxSymbols=3000,maxChannels=8,maxCandles=900000}){
 const quotes=new Map(),candles=new Map();let rejected=0;
 function ingest(rows){for(const row of rows){
  const symbol=String(row.code||row.symbol||''),time=Date.parse(row.exchangeTime||row.quoteSeenAt||'');
  if(!/^\d{4}$/.test(symbol)||!Number.isFinite(time)){rejected++;continue;}
  if(!quotes.has(symbol)){if(quotes.size>=maxSymbols)throw Error('WARMUP_QUOTE_CAPACITY_EXCEEDED');quotes.set(symbol,new Map());}
  const channels=quotes.get(symbol),channel=String(row.quoteSource||row.sourceChannel||'unknown'),previous=channels.get(channel);
  if(!previous&&channels.size>=maxChannels)throw Error('WARMUP_CHANNEL_CAPACITY_EXCEEDED');
  if(previous&&time<previous.time){rejected++;continue;}
  channels.set(channel,{time,row:mergeQuote(previous?.row||{},row)});
 }}
 function ingestCandles(rows){for(const row of rows){
  const symbol=String(row.code||row.symbol||''),time=Date.parse(row.candleTime||row.candle_time||row.date||'');
  if(!/^\d{4}$/.test(symbol)||!Number.isFinite(time)){rejected++;continue;}
  const key=symbol+'|'+time;if(!candles.has(key)&&candles.size>=maxCandles)throw Error('WARMUP_CANDLE_CAPACITY_EXCEEDED');
  const previous=candles.get(key),seen=Date.parse(row.candleSeenAt||row.updated_at||row.updatedAt||'');
  if(previous&&Number.isFinite(seen)&&seen<previous.seen){rejected++;continue;}
  candles.set(key,{seen,row:structuredClone(row)});
 }}
 function drain({initialCandles=[]}={}){
  // A bootstrap disk snapshot may be newer than an event held during warmup.
  const buffered=[...candles.values()];candles.clear();ingestCandles(initialCandles);ingestCandles(buffered.map(r=>r.row));
  const result={quotes:[...quotes.values()].flatMap(ch=>[...ch.values()]).sort((a,b)=>a.time-b.time).map(x=>x.row),candles:[...candles.values()].map(x=>x.row)};
  quotes.clear();candles.clear();return result;
 }
 return {ingest,ingestCandles,drain,clear(){quotes.clear();candles.clear();},status:()=>({symbols:quotes.size,candles:candles.size,rejected})};
}
module.exports={createWarmupBuffer};
