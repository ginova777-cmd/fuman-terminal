"use strict";
const assert=require("node:assert/strict"); const d=require("../lib/intraday-context-detectors-b19-b24");
assert.equal(d.b19({close:99,previous_close:100,timestamp:"2026-09-16T09:30:00+08:00"},[.1,.1,.1],[.1,.1]).b19_signal,"PRICE_SPIKE_DOWN");
assert.equal(d.b20({inside_1m:600,outside_1m:200}).b20_raw_strong,true);
assert.equal(d.b21({cumulative_turnover:100000,cumulative_shares:1000,current_price:110}).vwap_state,"ABOVE_VWAP");
assert.equal(d.b22({current_price:105,orh:100,orl:90}).break_direction,"UP"); assert.equal(d.b23({current_price:110,day_high_so_far:110,day_low_so_far:90,today_open:100}).new_high,true);
assert.equal(d.b24([{type:"VOLUME",event_id:"1",event_timestamp:"2026-09-16T09:31:00+08:00"},{type:"PRICE_UP",event_id:"2",event_timestamp:"2026-09-16T09:32:00+08:00"}])[0].formal_candidate_allowed,false);
console.log("6/6 B19-B24 isolated checks passed");
