'use strict';
const assert=require('node:assert/strict'),{inspect}=require('../lib/mother-pool-native-side-subscription-coverage');
const s={allSymbols:['1101','1102','2330'],quoteRadarChannel:'trades',quoteRadarSymbols:['1101'],aggregateRadarChannel:'aggregates',aggregateRadarSymbols:['1101','1102']};
let r=inspect(s);assert.equal(r.paired_count,1);assert.deepEqual(r.missing_trade_symbols,['1102','2330']);assert.deepEqual(r.missing_aggregate_symbols,['2330']);assert.equal(r.planned_full_coverage,false);
r=inspect({...s,quoteRadarSymbols:s.allSymbols,aggregateRadarSymbols:s.allSymbols});assert.equal(r.planned_full_coverage,true);assert.equal(r.complete,false);
assert.equal(inspect({...s,quoteRadarChannel:'aggregates'}).paired_count,0);assert.equal(inspect({}).planned_full_coverage,false);
console.log('PASS planned paired-channel coverage: exact missing sets; full plan never proves ACK or historical readiness');
