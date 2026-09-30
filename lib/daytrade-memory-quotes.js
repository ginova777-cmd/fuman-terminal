'use strict';
// Preserve the established price/ranking conversion, but never manufacture
// source timestamps or volume provenance for the volatile consumer.
function dateOf(value) {
 const ms=Date.parse(value||'');
 return Number.isFinite(ms)?new Date(ms+8*3600000).toISOString().slice(0,10):null;
}
function iso(value){const ms=Date.parse(value||'');return Number.isFinite(ms)?new Date(ms).toISOString():null;}
function normalizeMemoryQuotes(rawRows,{tradeDate,mergeQuotes}){
 if(!Array.isArray(rawRows)||typeof mergeQuotes!=='function')throw Error('MEMORY_QUOTES_INPUT_INVALID');
 const source=new Map();
 for(const row of rawRows){
  const symbol=String(row.symbol||row.code||'');
  if(!/^\d{4}$/.test(symbol))throw Error('MEMORY_QUOTES_INVALID_SYMBOL');
  if(source.has(symbol))throw Error('MEMORY_QUOTES_DUPLICATE_SYMBOL');
  source.set(symbol,row);
 }
 const normalized=new Map();
 mergeQuotes(normalized,{quotes:source,payload:{}});
 for(const [symbol,row] of normalized){
  const raw=source.get(symbol);
  if(!raw)throw Error('MEMORY_QUOTES_UNEXPECTED_SYMBOL');
  const eventAt=iso(raw.exchangeTime||raw.quoteSeenAt);
  const evidence=raw.turnoverVolumeEvidence;
  const value=evidence?evidence.value:raw.tradeVolume;
  const available=evidence?value!==null&&value!==undefined&&value!=='':raw.totalVolumeAvailable===true;
  const numeric=available&&value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0;
  normalized.set(symbol,{
   ...row,trade_date:dateOf(eventAt),quote_seen_at:eventAt,
   last_trade_time:iso(raw.lastTradeTime),updated_at:iso(raw.receivedAt),
   total_volume:numeric?Number(value):null,
   total_volume_available:!!numeric,
   total_volume_unit:evidence?evidence.unit:raw.totalVolumeUnit,
   total_volume_source:evidence?evidence.source:raw.quoteSource,
   total_volume_source_event_at:iso(evidence?evidence.event_at:raw.totalVolumeSourceEventAt),
   is_synthetic:evidence?evidence.is_synthetic:raw.isSynthetic,
  });
  if(dateOf(eventAt)!==tradeDate)normalized.delete(symbol);
 }
 return normalized;
}
module.exports={normalizeMemoryQuotes};
