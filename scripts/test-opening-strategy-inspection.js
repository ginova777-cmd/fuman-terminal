"use strict";
const assert = require('node:assert/strict');
const {inspect} = require('./build-opening-strategy-inspection');
const raw = {ok:true, trade_date:'2026-09-11', symbols_requested:['2330'],
 rule_definitions:Object.fromEntries(Array.from({length:10},(_,i)=>[i+1,{no:i+1,label:`策略${i+1}`} ])),
 rows:[{symbol:'2330',matched_strategy_numbers:[2,6],evidence:{close:100,previous_close:98}}]};
const result = inspect(raw);
assert.equal(result.summary.length,10);
assert.equal(result.rows[0].strategies[1].status,'MATCHED');
assert.equal(result.rows[0].strategies[5].status,'DATA_GAP');
assert.equal(result.inspection_only,true);
assert.equal(result.rows[0].prediction,undefined);
assert(result.summary.every(s=>s.checked===s.matched+s.not_matched+s.data_gap));
assert.throws(()=>inspect({...raw,symbols_requested:['2330','3374']}),/coverage/);
assert.throws(()=>inspect({...raw,rows:[raw.rows[0],raw.rows[0]]}),/coverage/);
assert.throws(()=>inspect({...raw,rule_definitions:{}}),/Ten rule/);
console.log('PASS: ten-rule coverage, missing trial rejection, no prediction, invalid input rejection');
