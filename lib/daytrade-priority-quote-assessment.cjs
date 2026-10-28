'use strict';
const crypto=require('node:crypto');
// Evidence records the existing predicate's outcome. It never grants entry.
function item(symbol,quote,{tradeDate,checkedAt,accepted,ageSeconds}){
 const now=Date.parse(checkedAt),event=Date.parse(quote?.last_trade_time||''),source=String(quote?.source||quote?.payload?.source||quote?.payload?.quoteSource||'');
 const date=String(quote?.trade_date||quote?.payload?.tradeDate||quote?.payload?.trade_date||'').slice(0,10);
 const eventDate=Number.isFinite(event)?new Date(event+28800000).toISOString().slice(0,10):null,reasons=[];
 if(!quote)reasons.push('NOT_RETURNED');
 else {
  if(!source.toLowerCase().includes('fugle'))reasons.push('SOURCE_NOT_FUGLE');
  if(date!==tradeDate)reasons.push('TRADE_DATE_MISMATCH');
  if(!Number.isFinite(event))reasons.push('NATIVE_TRADE_EVENT_MISSING');
  else {if(eventDate!==tradeDate)reasons.push('EVENT_TRADE_DATE_MISMATCH');if(event>now)reasons.push('FUTURE_EVENT');else if(Math.floor((now-event)/1000)>120)reasons.push('QUOTE_STALE_120S');}
 }
 if(!accepted&&!reasons.length)reasons.push('EXISTING_PREDICATE_REJECTED_REQUIRES_RECONCILIATION');
 return {symbol,checked_at:checkedAt,accepted_by_existing_predicate:accepted===true,reasons:accepted?[]:reasons,
  diagnostic_disagreement:accepted&&reasons.length>0,diagnostic_reasons:reasons,age_seconds:ageSeconds,
  trade_date:date||null,event_trade_date:eventDate,last_trade_time:quote?.last_trade_time||null,
  quote_seen_at:quote?.quote_seen_at||null,received_at:quote?.updated_at||null,source:source||null,
  quote_payload_canonical_run_id:quote?.payload?.canonical_run_id||quote?.payload?.canonicalRunId||null,
  quote_sha256:quote?crypto.createHash('sha256').update(JSON.stringify(quote)).digest('hex'):null};
}
function build(items,{tradeDate,canonicalRunId}){
 const requested=new Set(items.map(r=>r.symbol)),fresh=items.filter(r=>r.accepted_by_existing_predicate).length;
 if(requested.size!==items.length)throw Error('QUOTE_ASSESSMENT_DUPLICATE_SYMBOL');
 return {contract:'daytrade_priority_quote_assessment_v1',trade_date:tradeDate,canonical_run_id:canonicalRunId,
  requested_count:items.length,fresh_count:fresh,coverage:items.length?fresh/items.length:null,
  required_count:Math.ceil(items.length*.95),threshold:.95,window_seconds:120,
  missing_symbols:items.filter(r=>!r.accepted_by_existing_predicate).map(r=>r.symbol),items,
  scope:'existing_priority_gate_predicate_at_each_symbol_assessment',complete:false,other_gates_verified:false};
}
// Copy the actual latest merged observation even when it fails freshness.
// Otherwise filtering before replacement silently retains an older good quote.
function reconcile(target,latest,symbols){for(const symbol of symbols)if(latest.has(symbol))target.set(symbol,latest.get(symbol));}
module.exports={item,build,reconcile};
