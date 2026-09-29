'use strict';
const assert=require('node:assert/strict'),{evaluate}=require('./short-position-priority.cjs'),c=require('./short-position-priority.config.json');
const b=v=>({boll_position_raw:v,parameters:{weak_threshold:8},ma20_trend:'DOWN',ma20_slope_1d:-1,ma20_slope_5d:-1});
for(const [v,g,score] of [[-20,'P6',40],[3,'P4',70],[4,'P2',90],[5,'P1',100],[6,'P3',85],[7,'P5',60],[7.8,'P5',60],[8,'EXCLUDE',0]]){const x=evaluate(b(v),'BEARISH','TURNING_BEARISH','UNKNOWN',[],c);assert.equal(x.position_group,g);assert.equal(x.priority_score,score);assert.equal(x.main_list,v<8);}
assert.equal(evaluate(b(5.6),'BEARISH','UNKNOWN','UNKNOWN',[],c).candidate_tier,'B');
assert.equal(evaluate({...b(5.6),ma20_trend:'UP'},'BEARISH','BEARISH','UNKNOWN',[],c).candidate_tier,'C');
assert.equal(evaluate(b(5.6),'BEARISH','TURNING_BEARISH','UNKNOWN',[3],c).final_short_score,166);
assert.equal(evaluate(b(null),'UNKNOWN','UNKNOWN','UNKNOWN',[],c).candidate_tier,'UNKNOWN');
console.log('PASS: P1-P6 boundaries, exclusion, missing sources, A/B/C tiers and score breakdown');
