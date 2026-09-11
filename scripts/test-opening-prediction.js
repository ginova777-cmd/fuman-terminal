"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {VERSION,indicators,completeHours,predict}=require('../lib/opening-prediction');
const {verify}=require('./verify-opening-prediction');
const ind={version:VERSION,available:true,k:70,d:65,rsi:60,previous_k:65,previous_d:60,previous_rsi:55,kd_rsi_up:true};
const source={daily_indicators:ind,hourly_indicators:ind};
const slots=['0845','0850'].map(s=>({capture_slot:s,present:true,is_trial:true,natural_schedule_evidence:true,trial_price_source:'fugle_native_trial',has_trial_price:true,trial_price:103,trial_change_pct:3,trial_event_at:`2026-09-11T00:${s.slice(2)}:00Z`}));
test('long requires strategies, two indicator periods and both native trials',()=>{
 assert.equal(predict(source,{slots},null,['strategy2']).direction,'多');
 assert.equal(predict(source,{slots},null,[]).direction,'');
 assert.equal(predict({...source,hourly_indicators:{...ind,kd_rsi_up:false}},{slots},null,['strategy2']).direction,'');
 for(const field of ['is_trial','natural_schedule_evidence','has_trial_price'])assert.equal(predict(source,{slots:slots.map(x=>({...x,[field]:false}))},null,['strategy2']).direction,'');
 assert.equal(predict(source,{slots:[slots[1]]},null,['strategy2']).direction,'');
});
test('short independent gate; flat trial is observation, not long',()=>{
 const short={matched:true,checks:{kgi_chengzhong_present:true}};
 assert.equal(predict({}, {slots},short).direction,'空');
 assert.equal(predict({}, {slots:slots.map(x=>({...x,trial_change_pct:0}))},short).direction,'');
 assert.equal(predict({}, {slots}, {matched:true,checks:{kgi_chengzhong_present:false}}).direction,'');
});
test('missing indicator differs from a non-up indicator',()=>{
 const gap=predict({...source,hourly_indicators:{available:false}},{slots},null,['s']);
 assert.ok(gap.data_gaps.includes('DATA_GAP_T_MINUS_1_60M_KD_RSI_UP'));
 const down=predict({...source,hourly_indicators:{...ind,kd_rsi_up:false}},{slots},null,['s']);
 assert.equal(down.data_gaps.length,0);assert.equal(down.rejections.length,1);
});
test('KD uses OHLC range, Wilder RSI and rejects insufficient warmup',()=>{
 assert.equal(indicators(Array(15).fill({high:11,low:9,close:10})).available,false);
 const i=indicators(Array(30).fill({high:12,low:8,close:10}));
 assert.equal(i.k,50);assert.equal(i.d,50);assert.equal(i.rsi,50);assert.equal(i.kd_rsi_up,false);
 assert.equal(indicators(Array(30).fill({high:null,low:8,close:10})).available,false);
});
test('hour aggregation excludes partial, synthetic, post-signal and 13h tail',()=>{
 const rows=Array.from({length:60},(_,m)=>({candle_time:`2026-09-10T01:${String(m).padStart(2,'0')}:00Z`,open:10,high:12,low:9,close:11}));
 assert.equal(completeHours(rows,'2026-09-10').length,1);
 assert.equal(completeHours(rows.slice(1),'2026-09-10').length,0);
 assert.equal(completeHours(rows.map(x=>({...x,synthetic:true})),'2026-09-10').length,0);
 assert.equal(completeHours(rows,'2026-09-09').length,0);
 assert.equal(completeHours(rows.map(x=>({...x,candle_time:x.candle_time.replace('T01','T05')})),'2026-09-10').length,0);
});
test('independent canonical verifier rejects tampering, late freeze and false up flags',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opening-prediction-'));const file=path.join(dir,'freeze.json');
 const row={symbol:'2330',prediction:'多',prediction_version:VERSION,tomorrow_prediction_reason:'test',tomorrow_prediction_pattern:'long',matched_strategy_numbers:[2],evidence:{daily_signal_date:'2026-09-10',daily_indicators:ind,hourly_indicators:ind,preopen_slots:slots}};
 const p={ok:true,trade_date:'2026-09-11',run_id:'test',immutable_after_publish:true,allowed_after_0850:'monitor_and_rank_only',frozen_at:'2026-09-11T00:50:10Z',prediction_count:1,predictions:[row]};
 const run=()=>{fs.writeFileSync(file,JSON.stringify(p));return verify(file,'2026-09-11','test');};
 try {
  const original=run();assert.equal(original.ok,true);
  p.frozen_at='2026-09-11T01:00:00Z';assert.equal(run().ok,false);
  p.frozen_at='2026-09-11T00:50:10Z';row.evidence.hourly_indicators={...ind,k:20};assert.equal(run().ok,false);
  row.evidence.hourly_indicators=ind;row.prediction='空';assert.equal(run().ok,false);
  row.prediction='不交易';assert.equal(run().ok,true);assert.notEqual(run().canonical_sha256,original.canonical_sha256);
 }finally{fs.unlinkSync(file);fs.rmdirSync(dir);}
});
