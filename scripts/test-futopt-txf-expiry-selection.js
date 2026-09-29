'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(require.resolve('./fugle-futopt-websocket-collector'),'utf8').replace(/\r\n/g,'\n');
function body(name){const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}\n',start)+2;assert(start>=0&&end>start);return source.slice(start,end);}
const today=new Date();today.setHours(0,0,0,0);const end=days=>new Date(today.getTime()+days*86400000).toISOString();
const row=(symbol,days,product='TXF',underlying='TXF')=>({future_symbol:symbol,end_date:end(days),product,underlying_symbol:underlying});
const rows=[row('TXF_OLD1',-30),row('TXF_OLD2',-1),row('TXF_NEAR',1),row('TXF_NEXT',30),row('TXF_LATER',60),row('TXF_BAD-F',0),row('STOCK_OLD',-1,'STOCK_FUTURE','2330'),row('STOCK_NEAR',2,'STOCK_FUTURE','2330')];
const context={Date,buildTickerRows:()=>rows,normalizeCode:v=>/^\d{4}$/.test(v)?v:'',STREAMING_MAX_TOTAL_SUBSCRIPTIONS:1800,STREAMING_CHANNELS:['trades','aggregates','candles'],STREAMING_MAX_SYMBOLS:600};
vm.createContext(context);vm.runInContext(body('futureEndTime')+'\n'+body('selectStreamingTickers'),context);
assert.deepEqual(Array.from(context.selectStreamingTickers().selectedSymbols),['TXF_NEAR','TXF_NEXT','STOCK_NEAR']);
context.STREAMING_MAX_TOTAL_SUBSCRIPTIONS=3;assert.deepEqual(Array.from(context.selectStreamingTickers().selectedSymbols),['TXF_NEAR']);
context.buildTickerRows=()=>[row('TXF_OLD1',-1)];assert.equal(context.selectStreamingTickers().selectedSymbols.length,0);
console.log('PASS actual futures selector: expired TXF cannot consume nearest-two slots; stock nearest, suffix exclusion and quota preserved');
