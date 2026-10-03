'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const {nativeEventAt,nativePrice,nativeQuoteFields}=require('../lib/futopt-native-event-time.cjs');
const {normalizeFutoptQuote}=require('../lib/fugle-futopt-websocket');
for(const raw of [{previousClose:100,change:0},{previousClose:100,change:2},{lastPrice:null},{lastPrice:'100'},{lastPrice:0},{lastPrice:Infinity},{close:100}]){assert.equal(nativePrice(raw),null);assert.equal(normalizeFutoptQuote({symbol:'LWFJ6',...raw}),null);}
for(const raw of [{lastPrice:100},{closePrice:100},{price:100},{lastTrade:{price:100}}])assert.equal(normalizeFutoptQuote({symbol:'LWFJ6',...raw}).last_price,100);
const now=Date.parse('2026-10-02T05:44:59Z'),base={future_symbol:'LWFJ6',last_price:100,quoteSeenAt:new Date(now).toISOString(),payload:{symbol:'LWFJ6',lastUpdated:now*1000,previousClose:100,change:0}};
let rows=[base];const src=fs.readFileSync(require.resolve('./fugle-futopt-websocket-collector.js'),'utf8');const f=src.match(/function freshFormalFutoptRows\([^]*?\n}/)[0];const ctx={readTxfReference:()=>({txf_reference:null,txf_reference_status:"CATALOGUE_UNVERIFIED"}),Date:class extends Date{static now(){return now}},nativeEventAt,nativePrice,nativeQuoteFields,readJson:()=>({quotes:rows}),FUGLE_FUTOPT_WS_QUOTES_FILE:'unused',normalizeFutureSymbol:v=>v,finiteNumber:v=>Number(v)||0};vm.createContext(ctx);vm.runInContext(f,ctx);
assert.equal(ctx.freshFormalFutoptRows(new Date(now).toISOString()).length,0);
rows=[{...base,payload:{...base.payload,lastPrice:99}}];assert.equal(ctx.freshFormalFutoptRows(new Date(now).toISOString()).length,0);
rows=[{...base,payload:{...base.payload,lastPrice:100}}];assert.equal(ctx.freshFormalFutoptRows(new Date(now).toISOString()).length,1);
console.log('PASS no previous-close synthesis, numeric native prices, candle-close exclusion, cache/raw price mismatch rejection');
