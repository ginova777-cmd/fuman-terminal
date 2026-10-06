'use strict';
const assert=require('node:assert/strict'),{build}=require('../lib/strategy3-source-coverage-contract.cjs');
const base={priority_pool_symbols:365,priority_fresh_quotes_120s:315,formal_daytrade_priority_symbols:60,formal_deep_scan_fresh_quotes_120s:59,formal_deep_scan_fresh_quote_coverage_120s:0.9833,priority_fresh_quote_coverage_target_120s:0.90};
const original=JSON.stringify(base);let r=build(base);assert.equal(r.strategy3_priority.status,'BLOCKED');assert.equal(r.strategy3_priority.coverage,315/365);assert.equal(r.producer_formal_subset.requested_count,60);assert.equal(JSON.stringify(base),original);
assert.equal(build({...base,priority_pool_symbols:100,priority_fresh_quotes_120s:95}).strategy3_priority.status,'PASS');
assert.equal(build({...base,priority_pool_symbols:100,priority_fresh_quotes_120s:94}).strategy3_priority.status,'BLOCKED');
for(const pair of [[0,0],[null,0],[100,101],[100,-1],['100',95]])assert.equal(build({...base,priority_pool_symbols:pair[0],priority_fresh_quotes_120s:pair[1]}).strategy3_priority.status,'UNKNOWN');
assert.equal(r.formal_entry_authorization,false);console.log('PASS coverage denominator separation, exact 95% boundary, invalid data fail closed, no Gate mutation');
