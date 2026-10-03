'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');
const names=['quoteFreshnessTime','isWebSocketQuote','isFugleQuote','isFreshWebSocketQuote','effectiveQuoteAgeSeconds','ageSeconds'];
const functions=names.map(name=>{const m=source.match(new RegExp('function '+name+'\\([^]*?\\n}'));assert.ok(m,name);return m[0]}).join('\n');
const now=Date.parse('2026-10-02T04:00:00Z');let checks=0;
for(const transportHealthy of [true,false]){
const ctx={Date:class extends Date{static now(){return now}},WINDOW_SECONDS:120,taipeiDate:()=> '2026-10-02',fugleTransportHealthy:()=>transportHealthy};vm.createContext(ctx);vm.runInContext(functions,ctx);
for(const source of ['fugle-ws','fugle-rest-collector']){
const base={source,trade_date:'2026-10-02',quote_seen_at:'2026-10-02T04:00:00Z',updated_at:'2026-10-02T04:00:00Z'};
for(const [seconds,expected] of [[0,true],[120,true],[121,false],[10800,false]]){const q={...base,last_trade_time:new Date(now-seconds*1000).toISOString()};assert.equal(ctx.effectiveQuoteAgeSeconds(q),seconds);assert.equal(ctx.isFreshWebSocketQuote(q),expected);checks++}
for(const value of [null,'bad','2026-10-02T04:00:01Z','2026-10-01T04:00:00Z']){assert.equal(ctx.isFreshWebSocketQuote({...base,last_trade_time:value}),false);checks++}
assert.equal(ctx.isFreshWebSocketQuote({...base,trade_date:'2026-10-01',last_trade_time:'2026-10-02T03:59:00Z'}),false);checks++;
assert.equal(ctx.isFreshWebSocketQuote({...base,trade_date:null,last_trade_time:'2026-10-02T03:59:00Z'}),false);checks++;
}
}
console.log(JSON.stringify({ok:true,checks,scope:'native event age; healthy transport cannot renew stale quote; receipt and publication time cannot replace event time; missing/future/cross-date rejected; 120s unchanged'}));

// Exercise the actual Writer cache and REST mappings, including a previously
// valid quote followed by a new row without native trade-time evidence.
const pick=name=>{const m=source.match(new RegExp('function '+name+'\\([^]*?\\n}'));assert.ok(m,name);return m[0]};
const mapCtx={Date,WINDOW_SECONDS:120,nowIso:()=> '2026-10-02T04:00:00Z',normalizeCode:v=>String(v||''),numberValue:(v,d=0)=>v===null||v===undefined||v===''?d:Number.isFinite(Number(v))?Number(v):d,isFinMindDiagnosticQuote:()=>false,taipeiDateFrom:v=>new Date(Date.parse(v)+28800000).toISOString().slice(0,10),nativeVolume:()=>({}),typedCollectorVolume:()=>null,require:()=>({nativeTradeValue:()=>({})})};
vm.createContext(mapCtx);vm.runInContext(['normalizeTimestamp','mergeWebSocketQuoteCache','normalizeQuote','toLots'].map(pick).join('\n'),mapCtx);
const native='2026-10-02T03:58:00Z';
for(const lastTradeTime of [undefined,native]){
const quotes=new Map([['3163',{symbol:'3163',last_trade_time:'2026-10-02T03:59:59Z',trade_date:'2026-10-02'}]]);
mapCtx.mergeWebSocketQuoteCache(quotes,{quotes:new Map([['3163',{close:713,lastTradeTime,quoteSeenAt:'2026-10-02T04:00:00Z',updatedAt:'2026-10-02T04:00:00Z',exchangeTime:'2026-10-02T04:00:00Z',time:'2026-10-02T04:00:00Z'}]]),payload:{updatedAt:'2026-10-02T04:00:00Z'}});
assert.equal(quotes.get('3163').last_trade_time,lastTradeTime?new Date(native).toISOString():null);
assert.equal(quotes.get('3163').trade_date,lastTradeTime?'2026-10-02':null);
const q=mapCtx.normalizeQuote({symbol:'3163',date:'2026-10-02',lastPrice:713,lastUpdated:Date.parse('2026-10-02T04:00:00Z')*1000,lastTrade:lastTradeTime?{time:Date.parse(native)*1000}:undefined},'3163');
assert.equal(q.last_trade_time,lastTradeTime?new Date(native).toISOString():null);
}
assert.equal((source.match(/last_trade_time: normalizeTimestamp\(quote\.last_trade_time, null\)/g)||[]).length,2);
assert.ok(!source.includes('last_trade_time: normalizeTimestamp(quote.last_trade_time || quote.quote_seen_at'));
console.log(JSON.stringify({ok:true,scope:'cache merge, REST mapping and two publication mappings preserve missing native trade time'}));
