'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {validIndustrySource}=require('../lib/mother-pool-morning-industry-source');
const p={industry:'test',bias:'neutral_mixed',overseas_return_1d_pct:0.26,overseas_leader_detection:{industry:'test',leader_count:2,valid_count:2,unavailable_count:0,average_percent:0.26,leaders:[{yahoo_symbol:'TSM',ok:true,percent:1,source:'fixture',source_time:'2026-09-29T00:00:00Z'},{yahoo_symbol:'AMAT',ok:true,percent:-0.48,source:'fixture',source_time:'2026-09-29T00:00:00Z'}]}};
const options={stage:'us_0820',checked:Date.parse('2026-09-29T00:20:14Z')};
assert(validIndustrySource(p,options));
for(const mutate of [p=>p.overseas_return_1d_pct=1,p=>p.overseas_leader_detection.average_percent=1,p=>p.overseas_leader_detection.valid_count=1,p=>p.overseas_leader_detection.leaders[0].source_time='2026-09-30T00:00:00Z',p=>p.overseas_leader_detection.leaders[0].percent=null,p=>p.overseas_leader_detection.leaders[0].source_gap=true,p=>p.overseas_leader_detection.leaders[0].yahoo_symbol='7203.T',p=>p.overseas_leader_detection.leaders[1].yahoo_symbol='TSM']){const bad=structuredClone(p);mutate(bad);assert.equal(validIndustrySource(bad,options),false);}
const file=process.argv[2];if(file){const actual=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));assert(validIndustrySource(actual,options));console.log('PASS existing raw runtime industry source; scope=source_only, not A11 complete');}
console.log('PASS positive industry average including negative constituents, neutral bias, corrupt averages/counts/time/market/gaps rejected');
