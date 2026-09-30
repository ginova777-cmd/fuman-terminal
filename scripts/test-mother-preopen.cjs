'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { extract, createJournal, build, publish } = require('../lib/mother-preopen.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mother-preopen-test-'));
const date = '2026-09-30', asOf = date+'T09:10:00+08:00';
const calendar = { trade_date: date, market: 'TW', is_open: true, payload: { checked_at: asOf,
  calendar_decision: { date, isTradingDay: true, source: 'cache', calendar_evidence: { source: 'cache',
    source_url: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule', fetched_at: date+'T06:00:00+08:00', year: 2026,
    rows: [{ Date: '1150101', Name: '休市' }] } } } };
const candidateBytes = JSON.stringify({ contract: 'telegram_mother_preopen_candidates_v1', base_date: '2026-09-29', trade_date: date,
  symbols: [{stock_id:'6531'}, {stock_id:'2330'}, {stock_id:'6531'}] });
function raw(clock, price, extra = {}) {
  const p = { event: 'data', channel: 'aggregates', data: { symbol:'6531', date, isTrial:true,
    lastTrial:{price,time:Date.parse(date+'T'+clock+'+08:00')*1000}, ...extra } };
  return { ...extract(p, asOf), raw_evidence_ref:'isolated-fixture' };
}
const run = records => build({ candidateBytes, candidateSource:'isolated-fixture', calendar, records, asOf, producerVersion:'test' });
async function main() {
  let r = run([raw('08:55:00',900),raw('08:55:59',901),raw('08:56:00',902),raw('13:29:00',927)]);
  assert.equal(r.rows.find(x=>x.stock_id==='6531').trial_0855.price,901); assert.equal(r.requested_count,2); assert.equal(r.covered_count,1);
  r=run([raw('08:55:01',900),raw('08:55:01',901),raw('08:55:59',902)]);
  assert.equal(r.rows.find(x=>x.stock_id==='6531').trial_0855.status,'CONFLICT');
  r=run([raw('08:54:59',900),raw('08:59:00',902)]); assert.equal(r.covered_count,0);
  r=run([raw('08:55:01',900,{isSynthetic:true})]); assert.equal(r.covered_count,0);
  r=run([raw('08:55:01',900,{date:'2026-09-29'})]); assert.equal(r.covered_count,0);
  r=run([raw('08:55:01',900,{isTrial:false,openPrice:943})]); assert.equal(r.actual_open_covered_count,0);
  r=run([raw('08:59:00',900,{isTrial:false,openPrice:943,openTime:Date.parse(date+'T09:00:13+08:00')*1000})]);
  const s=r.rows.find(x=>x.stock_id==='6531'); assert.equal(s.trial_0855.status,'MISSING'); assert.equal(s.selected_price_kind,'actual_open'); assert.equal(s.selected_price,943);
  const receipt=publish(root,r); assert.equal(receipt.complete,false);
  const {read}=require('./read-mother-preopen.cjs');
  assert.equal(read(path.join(root,date,'receipt.json'),date,'2026-09-29').receipt.run_id,r.run_id);
  assert.throws(()=>read(path.join(root,date,'receipt.json'),'2026-10-01','2026-09-30'),/DATE_MISMATCH/);
  assert.throws(()=>publish(root,r),/REVISION_REASON/);
  const revised=publish(root,r,{revisionReason:'LATE_NATIVE_EVENT'}); assert.equal(revised.previous_revision,receipt.revision);
  assert.ok(fs.existsSync(receipt.files['trial-0855.json'].path));
  assert.throws(()=>build({candidateBytes,calendar,records:[],asOf:'2026-10-01T09:10:00+08:00'}),/CALENDAR/);
  const j=createJournal(path.join(root,'raw')); const row=raw('08:55:00',900);
  j.capture(row.payload,row.received_at); j.capture(row.payload,row.received_at); await j.drain();
  assert.equal(fs.readFileSync(path.join(root,'raw',date,'6531.jsonl'),'utf8').trim().split('\n').length,1);
  assert.equal(j.health().ok,true);
  const {produce}=require('../lib/mother-preopen-service.cjs');
  const runtimeRoot=path.join(root,'runtime');
  const rawDir=path.join(runtimeRoot,'data','mother-pool','preopen-raw',date);fs.mkdirSync(rawDir,{recursive:true});
  fs.writeFileSync(path.join(rawDir,'6531.jsonl'),JSON.stringify(row)+'\n');
  const options={runtimeRoot,calendar,asOf,health:{ok:true},producerVersion:'test',actualStart:date+'T06:00:00+08:00'};
  let service=produce(options);assert.equal(service.candidate_request_status,'NOT_SUPPLIED');assert.equal(service.requested_count,null);
  const same=produce(options);assert.equal(service.revision,same.revision);
  const requestDir=path.join(runtimeRoot,'data','mother-pool','preopen-requests');fs.mkdirSync(requestDir,{recursive:true});
  fs.writeFileSync(path.join(requestDir,date+'.json'),candidateBytes);
  service=produce(options);assert.equal(service.requested_count,2);assert.notEqual(service.revision,same.revision);
  const shared=read(path.join(runtimeRoot,'data','mother-pool','preopen',date,'receipt.json'),date,'2026-09-29');
  assert.equal(shared.receipt.covered_count,1);assert.equal(shared.receipt.missing_count,1);
  assert.throws(()=>produce({...options,health:{ok:false}}),/JOURNAL_UNHEALTHY/);
  fs.appendFileSync(path.join(rawDir,'6531.jsonl'),'{');
  assert.throws(()=>produce(options),/APPEND_IN_PROGRESS/);
  console.log(JSON.stringify({ok:true,scope:'isolated_only',natural_0855_verified:false,notifications_sent:0,orders_sent:0,artifact_root:root}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
