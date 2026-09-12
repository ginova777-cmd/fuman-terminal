"use strict";
const assert=require("assert/strict");
const {SYMBOLS,PROVIDER,pageState,parseQuote,receiptValid,snapshot}=require("../lib/opening-report-japan-realtime");
function fixture(symbol="4062.T",change={}) {
 const board={codeWithMarketExtension:symbol,price:{value:"1,010"},priceChangeRate:{value:"1.00"},japanUpdateTime:"09:30:00",delayMinutes:0,ptsPrice:"2000",ptsPriceChangeRate:"100",ptsUpdateTime:"23:55",...change};
 const state={priceBoard:{board}};
 const detail={indicators:{openPrice:{updateDateMeta:"2026-09-14T09:06:00+09:00"},previousPrice:{value:"1,000"}}};
 return `<script>self.__next_f.push(${JSON.stringify([1,'1:'+JSON.stringify({preloadedStore:state})+'\n2:'+JSON.stringify({detailData:detail})+'\n'])})</script>`;
}
const date="2026-09-14",at="2026-09-14T00:30:10.000Z";
for(const symbol of SYMBOLS){
 const q=parseQuote(fixture(symbol),symbol,date,at); assert.equal(q.ok,true); assert.equal(q.percent,1); assert.equal(q.close,1010); assert.equal(q.source_provider,PROVIDER);
 const row={...q,yahoo_symbol:symbol,source_time:q.selected_time}; assert.equal(receiptValid(row,date),true);
 for(const patch of [{percent:2},{close:1000},{source_time:"2026-09-14T00:19:00Z"},{source_url:"https://evil.invalid"},{source_fields:[]}]) assert.equal(receiptValid({...row,...patch},date),false);
}
for(const change of [{japanUpdateTime:"9/14"},{japanUpdateTime:"09:31:00"},{japanUpdateTime:"08:59:59"},{japanUpdateTime:"09:01:00"},{japanUpdateTime:"25:10:00"},{delayMinutes:20},{delayMinutes:null},{priceChangeRate:{value:""}},{priceChangeRate:{value:"2.00"}},{price:{value:null}},{codeWithMarketExtension:"5803.T"}]) assert.equal(parseQuote(fixture("4062.T",change),"4062.T",date,at).ok,false,JSON.stringify(change));
for(const capture of ["2026-09-14T00:31:00Z","2026-09-15T00:30:10Z","2026-09-14T00:19:00Z"]) assert.equal(parseQuote(fixture(),"4062.T",date,capture).ok,false);
assert.equal(parseQuote(fixture().replace("2026-09-14T09:06","2026-09-11T09:06"),"4062.T",date,at).ok,false);
assert.equal(parseQuote("<script>throw new Error('must not execute')</script>","4062.T",date,at).ok,false);
assert.equal(parseQuote(fixture()+fixture(),"4062.T",date,at).ok,false);
assert.equal(parseQuote(fixture("4062.T",{japanUpdateTime:"09:30:59"}),"4062.T",date,"2026-09-14T00:30:59.999Z").ok,true);
(async()=>{
 const detector=require("./run-opening-report-0830-overseas-leader-detector");
 const mapping=require("./opening-report-0830-industry-map-contract").OPENING_REPORT_0830_INDUSTRY_MAP;
 let calls=0; const originalFetch=global.fetch, originalNow=Date.now;
 try {
   global.fetch=async()=>{calls++; throw new Error("Unexpected network");};
   for(const symbol of ["5803.T","000725.SZ"]) {await assert.rejects(detector.detectLeader({industry:"test"},["retired",symbol],date,{}),/retired_morning_source/);await assert.rejects(snapshot({yahoo:symbol},date),/not_authorized/);}
   for(const symbol of SYMBOLS) assert.equal(mapping.flatMap(r=>r.overseas_leaders).find(r=>r.yahoo_symbol===symbol).source_provider,PROVIDER);
   Date.now=()=>Date.parse("2026-09-14T00:31:00Z");
   assert.equal((await snapshot({yahoo:"6273.T"},date)).ok,false);assert.equal(calls,0);
   Date.now=()=>Date.parse(at);
   global.fetch=async url=>{calls++; const symbol=url.split("/").pop(); return {ok:true,status:200,text:async()=>fixture(symbol)};};
   // Parsing uses actual completion time: an off-session test must not become real evidence.
   const replies=await Promise.all([snapshot({yahoo:"4062.T"},date),snapshot({yahoo:"4062.T"},date)]); assert.equal(calls,1);assert.deepEqual(replies[0],replies[1]);
 } finally {global.fetch=originalFetch;Date.now=originalNow;}
 console.log(JSON.stringify({ok:true,symbols:SYMBOLS.length,retired_network_calls:0,strict_freshness:true,pts_excluded:true,request_dedup:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={fixture};
