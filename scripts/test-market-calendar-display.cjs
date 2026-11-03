'use strict';
const test=require('node:test'),a=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {seal,validate,publicPayload}=require('../lib/market-calendar-display.cjs');
const now=new Date('2026-10-24T15:00:00+08:00');
function fixture(){return seal({ok:true,requestedDate:'2026-10-24',marketOpen:false,previousTradingDate:'2026-10-22',displayTradeDate:'2026-10-22',closedReasonText:'週末休市'},[
 {date:'2026-10-24',isTradingDay:false,source:'cache'},
 {date:'2026-10-23',isTradingDay:false,source:'dgpa_auto_update'},
 {date:'2026-10-22',isTradingDay:true,source:'cache'}],now);}
test('weekend after emergency closure preserves 10/22, JSONB key order stable',()=>{
 const p=fixture();a.equal(publicPayload(p,now).displayTradeDate,'2026-10-22');
 const reordered=JSON.parse(JSON.stringify(p));reordered.decisions[0]={source:'cache',isTradingDay:false,date:'2026-10-24'};a.doesNotThrow(()=>validate(reordered,now));
 a.doesNotThrow(()=>seal(p.calendar,p.decisions.map(d=>({...d,error:undefined})),now));
});
test('tamper, stale, future, missing and next-day evidence fail closed',()=>{
 const p=fixture();a.throws(()=>validate({...p,sha256:'x'},now));a.throws(()=>validate(p,new Date('2026-10-25T08:00:00+08:00')));a.throws(()=>validate(p,new Date('2026-10-24T14:59:00+08:00')));a.throws(()=>validate(null,now));
 a.throws(()=>seal({...p.calendar,displayTradeDate:'2026-10-23'},p.decisions,now));
 a.throws(()=>seal(p.calendar,p.decisions.map((d,i)=>i===1?{...d,source:'weekend_fallback'}:d),now));
 a.throws(()=>seal(p.calendar,p.decisions.filter((d,i)=>i!==1),now));
});
test('resumed open date recalculates session using request time',()=>{
 const at=new Date('2026-10-26T08:00:00+08:00'),p=seal({ok:true,requestedDate:'2026-10-26',marketOpen:true,previousTradingDate:'2026-10-22',displayTradeDate:'2026-10-22'},[
 {date:'2026-10-26',isTradingDay:true,source:'cache'},{date:'2026-10-25',isTradingDay:false,source:'cache'},...fixture().decisions],at);
 const live=publicPayload(p,new Date('2026-10-26T10:00:00+08:00'));a.equal(live.marketOpen,true);a.equal(live.displayTradeDate,'2026-10-26');a.equal(live.sourceFreshnessRequired,true);
});
async function render(p,fail=false){
 let banner;const body={dataset:{},prepend:n=>banner=n},document={body,documentElement:{dataset:{}},querySelector:()=>null,getElementById:()=>banner,createElement:()=>({dataset:{},setAttribute(){},style:{},remove(){banner=null;}})};
 const window={dispatchEvent(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../market-calendar-banner.js'),'utf8'),{window,document,CustomEvent:function(){},setTimeout:()=>{},fetch:async()=>{if(fail)throw Error('offline');return{ok:true,json:async()=>p};},Date});
 await new Promise(r=>setImmediate(r));return {banner,document};
}
test('desktop/mobile shared renderer: closure, unavailable, open',async()=>{
 const p=publicPayload(fixture(),now);a.match((await render(p)).banner.textContent,/2026-10-22/);
 a.doesNotMatch((await render(p)).banner.textContent,/2026-10-23/);
 a.match((await render(null,true)).banner.textContent,/待確認/);
 a.equal((await render({...p,marketOpen:true})).banner,undefined);
 for(const f of ['index.html','mobile.html','88.html']){const s=fs.readFileSync(path.join(__dirname,'..',f),'utf8');a.match(s,/market-calendar-banner.js/);a.doesNotMatch(s,/顯示最後交易日/);}
});
