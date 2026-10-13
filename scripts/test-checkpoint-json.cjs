'use strict';
const assert=require('node:assert/strict'),{create}=require('../lib/daytrade-checkpoint-json.cjs');
const checkpoint={contract:'daytrade-candle-delta-v1',trade_date:'2026-10-12',target:'TEST_ONLY',hashes:{'2330|09:00':'old'}},evidence={'2330|09:00':{hash:'old',text:'臺灣"\\\n'}};
const encode=create(checkpoint,evidence);checkpoint.save_evidence=evidence;
assert.equal(encode([]),JSON.stringify(checkpoint));
for(const [key,value] of [['2330|09:01','new'],['2330|09:00','revised'],['2308|09:02','next']]){checkpoint.hashes[key]=value;evidence[key]={hash:value,acknowledged_at:'TEST_ONLY'};assert.equal(encode([key]),JSON.stringify(checkpoint));}
assert.throws(()=>encode(['missing']),/ACK_MISSING/);
assert.throws(()=>create({...checkpoint,unknown:true},evidence),/SHAPE/);
console.log('PASS checkpoint bytes identical for empty delta, new ACK, correction, escaped text; missing ACK rejected');
