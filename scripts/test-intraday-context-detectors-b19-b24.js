"use strict";
const assert=require("node:assert/strict"); const d=require("../lib/intraday-context-detectors-b19-b24");
assert.equal(d.b19({close:99,previous_close:100,timestamp:"2026-09-16T09:30:00+08:00"},[.1,.1,.1],[.1,.1]).b19_signal,"PRICE_SPIKE_DOWN");
assert.equal(d.b20({inside_1m:600,outside_1m:200}).b20_raw_strong,true);
assert.equal(d.b21({raw_turnover_value:100000,raw_turnover_unit:"TWD",raw_volume:1000,raw_volume_unit:"SHARES",current_price:110}).vwap_state,"ABOVE_VWAP");
assert.equal(d.b22({current_price:105,opening_range_bars:[0,1,2,3,4].map((_,i)=>({timestamp:`09:0${i}`,high:100,low:90,synthetic:false,complete:true}))}).break_direction,"UP"); assert.equal(d.b23({current_price:110,day_high_so_far:110,day_low_so_far:90,today_open:100}).new_high,true);
assert.equal(d.b24([{type:"VOLUME",event_id:"1",event_timestamp:"2026-09-16T09:31:00+08:00"},{type:"PRICE_UP",event_id:"2",event_timestamp:"2026-09-16T09:32:00+08:00"}])[0].formal_candidate_allowed,false);
console.log("6/6 B19-B24 isolated checks passed");
