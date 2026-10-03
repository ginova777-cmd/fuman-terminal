'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../lib/supabase-public-slot.js'),'utf8');
const a=source.indexOf('async function fetchStarPreopenReadback('),b=source.indexOf('async function fetchPreopenFinalBlindBuyReady(',a);assert.ok(a>=0&&b>a);
let calls=[],returned=[];const scope={taipeiTodayKey:()=> '2026-10-03',fetchRows:async(...args)=>{calls.push(args);return returned;}};
vm.createContext(scope);vm.runInContext(source.slice(a,b)+'\nthis.run=fetchStarPreopenReadback;',scope);
(async()=>{await scope.run();assert.equal(calls.at(-1)[1].trade_date,'eq.2026-10-03');returned=[{trade_date:'2026-10-02',symbol:'3163'}];await scope.run({tradeDate:'2026-10-02'});assert.equal(calls.at(-1)[1].trade_date,'eq.2026-10-02');await assert.rejects(scope.run(),/STAR_READBACK_DATE_MISMATCH/);const n=calls.length;for(const tradeDate of ['2026-02-30','2026-10-02&limit=9999','bad'])await assert.rejects(scope.run({tradeDate}),/STAR_TRADE_DATE_INVALID/);assert.equal(calls.length,n);console.log('PASS: STAR default/explicit date filtering, invalid date rejection before request and mismatched readback rejection.');})().catch(e=>{console.error(e);process.exitCode=1;});
