"use strict";
const assert = require('assert/strict');
const {bridgeMatches} = require('../lib/strategy3-recovery-bridge');
const runner={trade_date:'2026-09-18',run_id:'strategy3v2-recovery-replay-20260918-20260919004245',result_count:61};
const bridge={complete:true,failed_checks:[],first_blocker:null,requested_trade_date:'2026-09-19',authority_trade_date:'2026-09-18',writer_bridge_canonical_run_id:'fugle_daytrade_source:20260919:canonical',authority_run_id:runner.run_id,authority_result_count:61};
assert.equal(bridgeMatches(bridge,runner,'2026-09-19'),true);
for(const change of [{requested_trade_date:'2026-09-18'},{authority_trade_date:'2026-09-19'},{writer_bridge_canonical_run_id:'fugle_daytrade_source:20260918:canonical'},{authority_run_id:'old-run'},{authority_result_count:60},{failed_checks:['source_gap']},{first_blocker:'source_gap'},{complete:false}]) assert.equal(bridgeMatches({...bridge,...change},runner,'2026-09-19'),false);
console.log('PASS: historical source/current bridge dates and 8 rejected mismatches');
