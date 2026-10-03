'use strict';
const assert=require('node:assert/strict'),{inspect}=require('../lib/collector-channel-coverage.cjs');
const s={allSymbols:['1101','1102','2330','2330'],candleChannel:'candles',candleRadarSymbols:['1101','1102','2330'],quoteRadarChannel:'trades',quoteRadarSymbols:['1101'],aggregateRadarChannel:'aggregates',aggregateRadarSymbols:['1101','1102','9999']};
let r=inspect(s);assert.equal(r.rotation_coverage_seconds,null);assert.equal(r.rotation_coverage_reason,'NO_PERIODIC_ROTATION');assert.equal(r.channels.candles.planned_full_coverage,true);assert.deepEqual(r.channels.trades.missing_symbols,['1102','2330']);assert.deepEqual(r.channels.aggregates.missing_symbols,['2330']);assert.equal(r.channels.aggregates.planned_requested_count,2);assert.equal(r.complete,false);
r=inspect({...s,quoteRadarChannel:'aggregates'});assert.equal(r.channels.trades.planned_requested_count,0);
r=inspect({}, {mode:'periodic'});assert.equal(r.rotation_coverage_reason,'CHANNEL_SWEEP_NOT_VERIFIED');assert.equal(r.channels.candles.planned_full_coverage,false);
assert.equal(inspect(s).natural_event_coverage_verified,false);
console.log('PASS: channel-specific requested coverage, disabled channels, duplicates, foreign symbols, empty universe and no invented sweep/event proof.');
