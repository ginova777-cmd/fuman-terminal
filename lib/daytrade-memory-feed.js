'use strict';
// Apply every event with the Collector's merge semantics. Coalesce only the
// resulting state delivered to detection, never the raw event calculation.
function createMemoryFeed({mergeQuote,now=Date.now,maxSymbols=3000}) {
 if(typeof mergeQuote!=='function')throw Error('QUOTE_MERGER_REQUIRED');
 let date=null,universe=new Set(),quotes=new Map(),dirty=new Set(),revision=0;
 const stats={events:0,rejected:0,out_of_order:0};
 function configure({tradeDate,symbols}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)||!Array.isArray(symbols)||!symbols.length||symbols.length>maxSymbols)throw Error('FEED_UNIVERSE_INVALID');
  const next=new Set(symbols);
  if(next.size!==symbols.length||symbols.some(s=>!/^\d{4}$/.test(s)))throw Error('FEED_UNIVERSE_INVALID');
  if(date!==tradeDate){quotes=new Map();dirty=new Set();}
  else for(const symbol of quotes.keys())if(!next.has(symbol)){quotes.delete(symbol);dirty.delete(symbol);}
  date=tradeDate;universe=next;revision++;
 }
 function ingest(row){
  const symbol=String(row.code||row.symbol||'');
  const ms=Date.parse(row.exchangeTime||row.quoteSeenAt||'');
  if(!universe.has(symbol)||!Number.isFinite(ms)||ms>now()||new Date(ms+8*3600000).toISOString().slice(0,10)!==date){stats.rejected++;return false;}
  const previous=quotes.get(symbol);
  // Ordering is per channel: a delayed trade must not be discarded merely
  // because an aggregate arrived later on a different channel.
  const channel=String(row.quoteSource||row.sourceChannel||'unknown');
  const times=previous?.times||new Map();
  if(ms<(times.get(channel)??-Infinity)){stats.out_of_order++;return false;}
  const merged=mergeQuote(previous?.row||{},row);
  times.set(channel,ms);quotes.set(symbol,{row:merged,times});dirty.add(symbol);stats.events++;return true;
 }
 function snapshot(){return {tradeDate:date,revision,rows:structuredClone([...quotes.values()].map(x=>x.row)),universe:[...universe]};}
 function drain(){const rows=structuredClone([...dirty].map(s=>quotes.get(s).row));dirty.clear();return {tradeDate:date,revision,rows};}
 return {configure,ingest,snapshot,drain,status:()=>({...stats,tradeDate:date,revision,symbols:quotes.size,pending:dirty.size})};
}
module.exports={createMemoryFeed};
