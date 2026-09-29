'use strict';
const assert=require('node:assert/strict'),{collect,verify}=require('../lib/mother-pool-previous-ohlc');
function fixture(){
 const date='2026-09-18',checks=[];
 for(let i=1;i<=20;i++){const d=new Date(Date.parse(date)-i*86400000);checks.push({date:d.toISOString().slice(0,10),source:'cache',isTradingDay:![0,6].includes(d.getUTCDay())});}
 const calendar={trade_date:date,status:'SESSION_DATES_VERIFIED',checks};
 const symbols=['2330','2317'],dailyVolumeMap=new Map(symbols.map(symbol=>[symbol,{daily_ohlcv_read_at:date+'T06:00:00+08:00',daily_volume_evidence:{symbol,trade_date:date,source:'strategy4_daily_ohlcv_view',calendar,rows:[{symbol,trade_date:'2026-09-17',open:100,high:110,low:90,close:105,volume_lots:1000}]}}]));
 return {identity:{trade_date:date,canonical_run_id:'fugle_daytrade_source:20260918:canonical'},symbols,dailyVolumeMap,lockDirectory:require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'a15-lock-test-')),asOf:date+'T06:01:00+08:00'};
}
if(require.main===module){let checks=0;const test=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
 test('previous completed day and range verified',()=>{const f=fixture(),p=collect(f);assert(p.rows.every(row=>verify(row,{...f.identity,observed_at:f.asOf})));assert.equal(p.rows[0].prev_range,20);assert.equal(p.rows[0].prev_range_pct,20/105*100);assert.equal(p.rows[0].prev_vwap,null);});
 for(const [name,change] of [
 ['missing OHLC',v=>delete v.daily_volume_evidence.rows[0].open],['wrong date',v=>v.daily_volume_evidence.rows[0].trade_date='2026-09-16'],
 ['future read',v=>v.daily_ohlcv_read_at='2026-09-18T07:00:00+08:00'],['duplicate row',v=>v.daily_volume_evidence.rows.push(v.daily_volume_evidence.rows[0])],
 ['invalid high low',v=>v.daily_volume_evidence.rows[0].high=80],['open outside range',v=>v.daily_volume_evidence.rows[0].open=120],
 ['zero close',v=>v.daily_volume_evidence.rows[0].close=0],['synthetic',v=>v.daily_volume_evidence.rows[0].synthetic=true],
 ['guessed calendar',v=>v.daily_volume_evidence.calendar.checks[0].source='weekday_guess']
 ])test(name+' rejected',()=>{const f=fixture();change(f.dailyVolumeMap.get('2330'));const row=collect(f).rows[0];assert.equal(row.status,'DATA_GAP');assert(!verify(row,{...f.identity,observed_at:f.asOf}));});
 test('formula corruption rejected',()=>{const f=fixture(),row=collect(f).rows[0];row.prev_range_pct=99;assert(!verify(row,{...f.identity,observed_at:f.asOf}));});
 test('JSONB key order preserved semantically',()=>{const f=fixture(),row=collect(f).rows[0];row.raw_daily_evidence=Object.fromEntries(Object.entries(row.raw_daily_evidence).reverse());assert(verify(row,{...f.identity,observed_at:f.asOf}));});
 test('later round keeps first lock time',()=>{const f=fixture(),first=collect(f).rows[0];f.asOf='2026-09-18T07:00:00+08:00';const next=collect(f).rows[0];assert.equal(next.locked_at,first.locked_at);assert(verify(next,{...f.identity,observed_at:f.asOf}));});
 test('changed source rejected without overwriting lock',()=>{const f=fixture();collect(f);const fs=require('node:fs'),file=require('node:path').join(f.lockDirectory,'2330.json'),before=fs.readFileSync(file,'utf8');f.dailyVolumeMap.get('2330').daily_volume_evidence.rows[0].close=104;const row=collect(f).rows[0];assert.equal(row.data_gap_reason,'A15_IMMUTABLE_SOURCE_CONFLICT');assert.equal(fs.readFileSync(file,'utf8'),before);assert(!verify(row,{...f.identity,observed_at:f.asOf}));});
 test('missing day lock rejected by verifier',()=>{const f=fixture(),row=collect({...f,lockDirectory:null}).rows[0];assert(!verify(row,{...f.identity,observed_at:f.asOf}));});
 console.log(JSON.stringify({checks,scope:'isolated_A15_previous_session_ohlc',production_complete:false}));
}
module.exports={fixture};
