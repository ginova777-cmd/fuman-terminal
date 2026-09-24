"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
test('writer restart retains the completed per-symbol seed checkpoint',()=>{
 const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8');
 const start=source.indexOf('function readWriterState()'),end=source.indexOf('function applyQuoteNotFoundState(',start);
 const mirror={tradeDate:'2026-09-24',symbols:{'2330':{seeded:true,lastCandleTime:'2026-09-24T05:24:00Z'}}};
 const context={readJson:()=>({cursor:2,daytradeMotherPoolCandleMirror:mirror}),STATE_FILE:'state',normalizeCode:x=>x,futureSeconds:()=>1};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 assert.equal(context.readWriterState().daytradeMotherPoolCandleMirror,mirror);
 context.readJson=()=>({});assert.equal(context.readWriterState().daytradeMotherPoolCandleMirror,null);
});
