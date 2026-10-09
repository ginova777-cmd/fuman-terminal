'use strict';
// OFFLINE adapter evaluates exact existing Writer functions/expression in VM.
// Neither the Writer module top level nor any filesystem/network function runs.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {sha}=require('../../lib/mother-change-evidence.cjs');
const writer=fs.readFileSync(path.resolve(__dirname,'../../scripts/run-daytrade-source-writer.js'),'utf8');
function fn(name){const start=writer.indexOf('function '+name+'(');if(start<0)throw Error('QUOTE_SOURCE_BOUNDARY');const tail=writer.slice(start),m=/\n(?:async )?function /.exec(tail);if(!m)throw Error('QUOTE_SOURCE_END');return tail.slice(0,m.index);}
const names=['numberValue','normalizeCode','nowIso','normalizeTimestamp','taipeiDate','taipeiDateFrom','quoteTradeDateForWrite','quoteFreshnessTime','isFugleQuote','effectiveQuoteAgeSeconds','isFinMindDiagnosticQuote','mergeWebSocketQuoteCache'];
const functions=names.map(fn).join('\n');
const start=writer.indexOf('const websocketQuoteRows = priorityRows'),end=writer.indexOf('\n    if (websocketQuoteRows.length)',start);if(start<0||end<start)throw Error('QUOTE_MAPPING_BOUNDARY');const expression=writer.slice(start,end);
const source_hash=sha(functions+'\n'+expression);
function mapQuotes({rawRows,previousRows=[],prioritySymbols,nowMs,cacheUpdatedAt,changedSymbols=null}){
 if(!Array.isArray(rawRows)||!Array.isArray(previousRows)||!Array.isArray(prioritySymbols)||!Number.isFinite(nowMs))throw Error('QUOTE_INPUT');
 const ids=new Set();for(const r of rawRows){const id=String(r.code||r.symbol);if(!/^\d{4}$/.test(id)||ids.has(id))throw Error('QUOTE_IDENTITY');ids.add(id);}
 const allow=changedSymbols===null?null:new Set(changedSymbols),raw=allow?rawRows.filter(r=>allow.has(String(r.code||r.symbol))):rawRows;
 const Clock=class extends Date{constructor(...a){super(...(a.length?a:[nowMs]));}static now(){return nowMs;}};
 const quoteMap=new Map(previousRows.map(r=>[r.symbol,structuredClone(r)]));
 const context={Date:Clock,Map,Set,Number,String,Math,Array,WINDOW_SECONDS:120,cachedMotherDateTimeFormat:(l,o)=>new Intl.DateTimeFormat(l,o),typedCollectorVolume:require('../../lib/daytrade-intraday-turnover').typedCollectorVolume,quoteMap,cache:{quotes:new Map(raw.map(r=>[String(r.code||r.symbol),r])),payload:{updatedAt:cacheUpdatedAt}},priorityRows:prioritySymbols.filter(s=>!allow||allow.has(s)).map(symbol=>({symbol}))};
 vm.createContext(context);vm.runInContext(functions+'\nmergeWebSocketQuoteCache(quoteMap,cache);const writebackQuoteMap=quoteMap;'+expression+';this.result=websocketQuoteRows;',context,{timeout:5000});
 return {rows:JSON.parse(JSON.stringify(context.result)).map(require('../../lib/daytrade-quote-liquidity-contract').normalizeQuoteLiquidity),mergedRows:[...quoteMap.values()].map(r=>JSON.parse(JSON.stringify(r))),source_hash,scope:'existing priority-filtered fresh quote readthrough; no universe/Gate change'};
}
module.exports={mapQuotes,source_hash};
