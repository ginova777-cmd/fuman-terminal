'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {extract}=require('../lib/mother-preopen.cjs'),{buildJournal}=require('../lib/mother-preopen-journal-build.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'preopen-bounded-journal-')),date='2026-10-02',asOf=date+'T09:10:00+08:00';
const calendar={trade_date:date,market:'TW',is_open:true,payload:{checked_at:asOf,calendar_decision:{date,isTradingDay:true,source:'cache',calendar_evidence:{source:'cache',source_url:'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',fetched_at:date+'T06:00:00+08:00',year:2026,rows:[{Date:'1150101',Name:'休市'}]}}}};
const names=[],symbols=[],padding='x'.repeat(1024*1024);
for(let i=0;i<65;i++){const stock_id=String(1000+i),name=stock_id+'.jsonl';symbols.push({stock_id});names.push(name);const p={event:'data',channel:'aggregates',data:{symbol:stock_id,date,isTrial:true,lastTrial:{price:100,time:Date.parse(date+'T08:55:30+08:00')*1000},padding}};fs.writeFileSync(path.join(dir,name),JSON.stringify(extract(p,asOf))+'\n');}
const options={candidateBytes:JSON.stringify({contract:'telegram_mother_preopen_candidates_v1',base_date:'2026-10-01',trade_date:date,symbols}),calendar,asOf,producerVersion:'isolated'};
const start=Date.now(),r=buildJournal(options,{rawDir:dir,names});assert.equal(r.snapshot.covered_count,65);assert.equal(r.snapshot.rows.length,65);assert.equal(new Set(r.snapshot.rows.map(x=>x.run_id)).size,1);
assert.throws(()=>buildJournal(options,{rawDir:dir,names,maxFileBytes:1024}),/RAW_SYMBOL_SIZE_LIMIT/);
fs.appendFileSync(path.join(dir,names[0]),'{');assert.throws(()=>buildJournal(options,{rawDir:dir,names}),/RAW_APPEND_IN_PROGRESS/);
console.log(JSON.stringify({ok:true,scope:'isolated_only',market_journal_bytes:65*1024*1024,covered:65,ms:Date.now()-start,max_rss_kb:process.resourceUsage().maxRSS,natural_verified:false}));
