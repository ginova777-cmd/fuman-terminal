'use strict';
const assert=require('node:assert/strict');
const {fixture}=require('./test-mother-eligibility-source');
const {collect,verify}=require('../lib/mother-pool-eligibility-source');
let checks=0;
function test(name,change,pass){const f=fixture();change(f);const row=collect(f).rows.find(r=>r.symbol==='2330');const ok=verify(row,{trade_date:f.identity.trade_date,observed_at:f.asOf});assert.equal(row.eligible,pass,name);assert.equal(ok,pass,name);checks++;}
test('prior publication retained',f=>{f.evidence.stock_tickers[0].payload.stock_master_source_date='2026-09-17';},true);
test('same publication',()=>{},true);
test('UTC previous date is Taipei today',f=>{f.evidence.stock_tickers[0].payload.stock_master_synced_at='2026-09-17T22:00:00Z';},true);
test('future publication',f=>{f.evidence.stock_tickers[0].payload.stock_master_source_date='2026-09-19';},false);
test('invalid calendar date',f=>{f.evidence.stock_tickers[0].payload.stock_master_source_date='2026-02-30';},false);
test('missing publication',f=>{delete f.evidence.stock_tickers[0].payload.stock_master_source_date;},false);
test('previous Taipei day even within 24h',f=>{f.evidence.stock_tickers[0].payload.stock_master_synced_at='2026-09-17T23:59:00+08:00';},false);
test('future sync',f=>{f.evidence.stock_tickers[0].payload.stock_master_synced_at='2026-09-18T06:02:00+08:00';},false);
test('wrong source',f=>{f.evidence.stock_tickers[0].payload.stock_master_source='other';},false);
test('wrong observation day',f=>{f.asOf='2026-09-19T00:00:00+08:00';},false);
const f=fixture();f.evidence.stock_tickers[0].payload.stock_master_source_date='2026-09-17';const row=collect(f).rows.find(r=>r.symbol==='2330');assert.equal(row.raw_ticker.payload.stock_master_source_date,'2026-09-17');row.raw_ticker.payload.stock_master_source_date='2026-09-16';assert.equal(verify(row,{trade_date:f.identity.trade_date,observed_at:f.asOf}),false);checks++;
console.log(JSON.stringify({status:'PASS',checks,scope:'isolated_A02_date_and_hash',formal_recovery:false}));
