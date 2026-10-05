'use strict';
process.env.FUMAN_MORNING_STAGE='asia_0850';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const jp=require('../lib/opening-report-japan-realtime');
const src=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'fixtures/morning-japan-20261005.json'),'utf8').replace(/^\uFEFF/,''));
const rows=src.industries.flatMap(x=>x.leaders).filter(x=>jp.SYMBOLS.includes(x.yahoo_symbol));
assert.equal(rows.length,5);
for(const row of rows){
 const e=row.source_evidence;
 assert.equal(jp.evidenceCheck(e,row.yahoo_symbol,src.date),null,row.yahoo_symbol);
 for(const clock of ['09:49','9:49:00'])assert.equal(jp.evidenceCheck({...e,quote_clock:clock},row.yahoo_symbol,src.date),null);
 for(const clock of ['8:59','9:51','24:00','9:99'])assert.notEqual(jp.evidenceCheck({...e,quote_clock:clock},row.yahoo_symbol,src.date),null);
 assert.notEqual(jp.evidenceCheck({...e,open_time:'2026-10-02T09:00:00+09:00'},row.yahoo_symbol,src.date),null);
 assert.notEqual(jp.evidenceCheck({...e,delay_minutes:15},row.yahoo_symbol,src.date),null);
 assert.notEqual(jp.evidenceCheck({...e,response_sha256:''},row.yahoo_symbol,src.date),null);
}
console.log('PASS: five original source evidence records; equivalent clocks and timezone; reject stale, delayed, missing digest and out-of-window. Offline only; no receipt rewritten.');

