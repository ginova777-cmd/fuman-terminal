'use strict';
const assert=require('node:assert/strict');
const {ensureHistory}=require('../lib/a04-calendar-history.cjs');
const {createCalendarIO}=require('../lib/a04-calendar-io.cjs');
const {isClosedRow,isExplicitTradingRow}=require('./twse-trading-day');
const day=86400000,now=Date.parse('2026-10-13T00:45:00Z');
function fixture(T='2026-10-13',closed=[]) {
 let time=Date.parse(T+'T00:45:00Z');const db=new Map(),writes=[],reads=[];
 const annual=[{Name:'元旦',Date:String(Number(T.slice(0,4))-1911)+'0101',Weekday:'四',Description:'休市'},...closed.map(d=>({Name:'假日',Date:String(Number(d.slice(0,4))-1911)+d.slice(5,7)+d.slice(8),Weekday:'',Description:'休市'}))];
 const options={tradeDate:T,clock:()=>time,deadlineMs:time+20000,cacheRows:[],
  readDays:async(from,to,n)=>{reads.push({from,to,n});return [...db.values()].filter(r=>r.trade_date>=from&&r.trade_date<=to);},
  resolveDay:async date=>{const k=new Date(date.getTime()+28800000).toISOString().slice(0,10),year=Number(k.slice(0,4));
   const rows=annual.filter(r=>r.Date.startsWith(String(year-1911)));if(!rows.length)rows.push({Name:'元旦',Date:String(year-1911)+'0101',Weekday:'',Description:'休市'});
   const match=rows.find(r=>r.Date===String(year-1911)+k.slice(5,7)+k.slice(8));
   return{date:k,isTradingDay:match&&isExplicitTradingRow(match)?true:match&&isClosedRow(match)?false:![0,6].includes(date.getUTCDay()),source:'cache',
    calendar_evidence:{source:'cache',source_url:'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',year,fetched_at:new Date(time-1000).toISOString(),rows}};},
  writeRows:async rows=>{writes.push(rows);for(const r of rows)db.set(r.trade_date,r);}};
 return{options,db,writes,reads,setTime:v=>{time=v;options.deadlineMs=v+20000;}};
}
async function main(){
 const results=[];const test=async(name,fn)=>{await fn();results.push({name,pass:true});};
 const f=fixture('2026-10-13',['2026-09-25','2026-09-28','2026-10-09']);let cold;
 await test('holiday coverage, early stop, acquisition time',async()=>{cold=await ensureHistory(f.options);assert.equal(cold.status,'SESSION_DATES_VERIFIED');assert.equal(cold.session_dates.length,15);assert.equal(cold.stats.days_checked,26);assert.equal(cold.session_dates[0],'2026-09-17');assert(cold.cache_rows.every(r=>r.payload.historical_publication_available_at==='2026-10-13T00:45:00.000Z'));assert(f.reads.every(r=>r.n<=15));});
 await test('valid cache no read/source/write',async()=>{const r=await ensureHistory({...f.options,cacheRows:cold.cache_rows,readDays:()=>{throw Error('unexpected');},resolveDay:()=>{throw Error('unexpected');},writeRows:()=>{throw Error('unexpected');}});assert.equal(r.status,'SESSION_DATES_VERIFIED');assert.equal(r.stats.cache_hits,26);assert.equal(r.stats.db_reads,0);assert.equal(r.stats.rows_written,0);});
 await test('process restart DB reuse no duplicate writes',async()=>{const r=await ensureHistory(f.options);assert.equal(r.status,'SESSION_DATES_VERIFIED');assert.equal(r.stats.gap_resolutions,0);assert.equal(r.stats.rows_written,0);});
 await test('next day only new completed day added',async()=>{const g=fixture('2026-10-14');const r=await ensureHistory({...g.options,cacheRows:cold.cache_rows});assert.equal(r.status,'SESSION_DATES_VERIFIED');assert.equal(r.stats.rows_written,1);assert.equal(r.stats.gap_resolutions,1);assert.equal(r.session_dates.at(-1),'2026-10-13');assert(!r.session_dates.includes('2026-10-14'));});
 await test('missing one day only repaired',async()=>{const rows=cold.cache_rows.filter(r=>r.trade_date!=='2026-10-08');f.db.delete('2026-10-08');const r=await ensureHistory({...f.options,cacheRows:rows});assert.equal(r.stats.gap_resolutions,1);assert.equal(r.stats.rows_written,1);assert.equal(f.reads.at(-1).n,1);assert.equal(r.stats.rows_read,0);});
 await test('duplicate cache and DB rejected',async()=>{assert.equal((await ensureHistory({...f.options,cacheRows:[cold.cache_rows[0],cold.cache_rows[0]]})).status,'BLOCKED');const r=await ensureHistory({...f.options,readDays:async()=>[cold.cache_rows[0],cold.cache_rows[0]]});assert.match(r.reason,/DUPLICATE/);});
 await test('40 days insufficient no partial writes',async()=>{const g=fixture('2026-10-13',Array.from({length:40},(_,i)=>new Date(Date.parse('2026-10-13')-(i+1)*day).toISOString().slice(0,10)));const r=await ensureHistory(g.options);assert.equal(r.stats.days_checked,40);assert.equal(r.status,'BLOCKED');assert.equal(g.writes.length,0);});
 await test('cross year evidence year changes',async()=>{const r=await ensureHistory(fixture('2027-01-05').options);assert.equal(r.status,'SESSION_DATES_VERIFIED');assert(r.session_dates[0].startsWith('2026'));});
 await test('stale cache and DB refresh, never backdate',async()=>{f.setTime(now+8*day);const r=await ensureHistory({...f.options,cacheRows:cold.cache_rows});assert.equal(r.status,'SESSION_DATES_VERIFIED');assert.equal(r.stats.gap_resolutions,26);assert(r.cache_rows.every(x=>Date.parse(x.payload.historical_publication_available_at)===now+8*day));f.setTime(now);});
 await test('invalid official source stays blocked',async()=>{for(const mutate of [d=>d.override=true,d=>d.calendar_evidence.fetched_at='2026-09-01',d=>d.calendar_evidence.source_url='fake',d=>d.isTradingDay=!d.isTradingDay]){const g=fixture(),resolve=g.options.resolveDay;const r=await ensureHistory({...g.options,resolveDay:async date=>{const d=await resolve(date);mutate(d);return d;}});assert.equal(r.status,'BLOCKED');assert.equal(g.writes.length,0);}});
 await test('budget failure and write failure never complete',async()=>{assert.equal((await ensureHistory({...f.options,deadlineMs:now})).reason,'CALENDAR_BUDGET_EXHAUSTED');const g=fixture();assert.equal((await ensureHistory({...g.options,writeRows:async()=>{throw Error('WRITE_FAILED');}})).reason,'WRITE_FAILED');});
 await test('HTTP IO range, bounded write batches, no retries',async()=>{const calls=[];const io=createCalendarIO({url:'https://offline.invalid',key:'TEST',deadlineMs:Date.now()+20000,fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(options.method==='GET'?'[]':null,{status:200});}});await io.readDays('2026-09-01','2026-09-15',15);await io.writeRows(cold.cache_rows);assert.equal(calls.length,4);assert(calls[0].url.endsWith('limit=16'));assert(calls.slice(1).every(c=>JSON.parse(c.options.body).length<=10));let n=0;const bad=createCalendarIO({url:'https://offline.invalid',key:'TEST',deadlineMs:Date.now()+20000,fetchImpl:async()=>{n++;return new Response(null,{status:503});}});await assert.rejects(()=>bad.readDays('x','y',1),/503/);assert.equal(n,1);});
 console.log(JSON.stringify({ok:true,results,cold_stats:cold.stats}));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={fixture};
