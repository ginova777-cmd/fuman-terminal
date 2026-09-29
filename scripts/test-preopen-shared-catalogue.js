'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const text=fs.readFileSync(require.resolve('./run-daytrade-near-one-source'),'utf8').replace(/\r\n/g,'\n');const start=text.indexOf('async function readTickerMap('),end=text.indexOf('\n}\n',start)+2;
const snapshot={run_id:'isolated-catalogue',source_hash:'a'.repeat(64)};
const rows=[{future_symbol:'CAFC7',underlying_symbol:'1303',end_date:'2027-03-17',product:'STOCK_FUTURE'},{future_symbol:'CAFJ6',underlying_symbol:'1303',end_date:'2026-10-21',product:'STOCK_FUTURE'},{future_symbol:'TXFJ6',underlying_symbol:'TXF',end_date:'2026-10-21',product:'TXF'}];
let refreshes=0;
const c={Date,RUNTIME_DIR:'isolated',readSecret:()=>'',normalizeFutureSymbol:String,normalizeCode:v=>/^\d{4}$/.test(v)?v:'',tickerUnderlying:r=>/^\d{4}$/.test(r.underlying_symbol)?r.underlying_symbol:'',tickerExpiry:r=>r.end_date,contractMonth:(v,e)=>v||e.slice(0,7),require:id=>id==='../lib/mother-pool-futures-catalogue'?{refresh:async()=>{refreshes++;return snapshot;}}:id==='../lib/futopt-collector-catalogue'?{build:(s,d)=>{assert.equal(s,snapshot);assert.equal(d,'2026-09-29');return rows;}}:require(id)};
vm.createContext(c);vm.runInContext(text.slice(start,end),c);
(async()=>{const r=await c.readTickerMap('2026-09-29');assert.equal(refreshes,1);assert.equal(r.rows.length,1);assert.equal(r.rows[0].fut_contract,'CAFJ6');assert.equal(r.rows[0].payload.catalogue_run_id,snapshot.run_id);assert.equal(r.rows[0].payload.catalogue_source_hash,snapshot.source_hash);console.log('PASS actual preopen producer uses shared catalogue, nearest valid stock contract and provenance without legacy DB mapping');})().catch(e=>{console.error(e);process.exitCode=1;});
