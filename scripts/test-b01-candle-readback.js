'use strict';
const assert=require('node:assert/strict');
const {verifyCandleReadback:verify}=require('../lib/verify-b01-candle-readback');
const row={symbol:'2330',trade_date:'2026-09-17',candle_time:'2026-09-17T02:00:00Z',open:100,high:102,low:99,close:101,volume:12,source:'fugle_daytrade_writer:websocket_candles',synthetic:false,volume_strategy_usable:true};
const expected={checked_at:'2026-09-17T02:01:30Z',requested_count:1,ready_count:1,items:[{...row,bar_start:row.candle_time,status:'READY'}]};
const ctx={read_role:'anon',db_readback_ok:true};
assert.equal(verify(expected,[row],ctx).candle_readback_verified,true);
assert.equal(verify(expected,[row],ctx).complete,false);
for(const patch of [{volume:13},{close:102},{source:'synthetic'},{synthetic:true},{volume_strategy_usable:'true'},{trade_date:'2026-09-16'},{candle_time:'2026-09-17T02:01:00Z'}])assert.equal(verify(expected,[{...row,...patch}],ctx).exit_code,1);
assert.equal(verify(expected,[],ctx).exit_code,1);
assert.equal(verify(expected,[row,row],ctx).exit_code,1);
assert.equal(verify(expected,[row],{...ctx,read_role:'owner'}).exit_code,1);
assert.equal(verify({...expected,checked_at:'2026-09-17T02:02:00.001Z'},[row],ctx).exit_code,1);
for (const invalid of [null, [], {}, {symbol:2330}, {symbol:'invalid'}]) {
  const result = verify({...expected,items:[invalid]},[row],ctx);
  assert.equal(result.first_blocker,'INVALID_EXPECTED_ITEM');
  assert.equal(result.complete,false);
}
assert.equal(verify(expected,[row,{...row,symbol:'2317'}],ctx).exit_code,1);
assert.equal(verify(expected,[row,{...row,candle_time:'invalid'}],ctx).exit_code,1);
assert.equal(verify(expected,[row,null],ctx).exit_code,1);
console.log('PASS B01 independent exact candle readback: fields, date, quality, identity, role, freshness; no overall COMPLETE');
