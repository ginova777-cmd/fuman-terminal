'use strict';
const assert=require('node:assert/strict');
const {buildTimelineAudit:audit}=require('../lib/daytrade-intraday-1m-timeline');
const base={symbol:'3163',trade_date:'2026-10-02',candle_time:'2026-10-02T01:00:00Z',open:10,high:11,low:9,close:10,volume:1,source:'fugle:websocket',synthetic:false,volume_strategy_usable:true};
const run=rows=>audit({symbol:'3163',tradeDate:'2026-10-02',rows,expectedMinutes:['09:00'],nowMs:Date.parse('2026-10-02T02:00:00Z')});
assert.equal(run([base]).replay_allowed,true);
assert.equal(run([{...base,volume:0}]).replay_allowed,true);
const invalid=[{synthetic:undefined},{synthetic:'false'},{volume_strategy_usable:undefined},{volume_strategy_usable:'true'},{synthetic:true},{payload:{is_synthetic:true}},{payload:{volume_strategy_usable:false}},{symbol:'2330'},{trade_date:undefined},{trade_date:'2026-10-01'},{candle_time:'2026-10-01T01:00:00Z'},{candle_time:'invalid'},{candle_time:'2026-10-02T03:00:00Z'},{candle_time:'2026-10-02T01:00:01Z'},{volume:null},{volume:'1'},{volume:-1},{high:9},{low:11},{source:''},{source:'quote_derived'}];
for(const patch of invalid){const r=run([{...base,...patch}]);assert.equal(r.replay_allowed,false,JSON.stringify(patch));assert.deepEqual(r.missing_minutes,['09:00']);}
assert.equal(run([base,{...base}]).real_candles,1);
assert.equal(run([base,{...base,close:10.5}]).replay_allowed,false);
assert.equal(run([{...base,close:10.5},base]).replay_allowed,false);
assert.equal(run([{...base,synthetic:true},base]).replay_allowed,true);
assert.equal(audit({symbol:'3163',tradeDate:'2026-10-02',rows:[],expectedMinutes:[]}).replay_allowed,false);
console.log(JSON.stringify({ok:true,invalid_cases:invalid.length,scope:'explicit quality, symbol/date/native time, OHLCV, synthetic exclusion, duplicate conflict, natural zero and empty scope'}));
