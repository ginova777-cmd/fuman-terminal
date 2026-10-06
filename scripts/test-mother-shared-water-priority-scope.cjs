'use strict';
const assert=require('node:assert/strict'),{freezeScope,readScope}=require('../lib/mother-shared-water-priority-scope.cjs');
const identity={tradeDate:'2026-10-06',writerRunId:'w'},scope=freezeScope(['2330','1216','3163'],{...identity,freshSymbols:['2330']});
assert.deepEqual(readScope(scope,{...identity,expectedCount:3}),['1216','2330','3163']);assert.equal(scope.legacy_fresh_coverage,1/3);
for(const change of [{symbols:['1216','2330']},{symbols:['1216','2330','9999']},{writer_run_id:'another'},{trade_date:'2026-10-05'},{symbols_sha256:'0'.repeat(64)}])assert.throws(()=>readScope({...scope,...change},{...identity,expectedCount:3}));
assert.throws(()=>freezeScope(['1216'],{...identity,freshSymbols:['2330']}),/OUTSIDE_SCOPE/);
assert.throws(()=>readScope(scope,{...identity,expectedCount:2}),/CONTENT_MISMATCH/);
console.log(JSON.stringify({ok:true,cases:8,mode:'isolated',deployed:false}));
