'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const s=fs.readFileSync(require.resolve('./verify-daytrade-mother-pool-closed-loop.js'),'utf8');
const start=s.indexOf('  const industryReceiptsRequired ='),end=s.indexOf('  const staticChecks =',start);
assert.ok(start>0&&end>start);
function run(top3,inject){const checks={},failures=[],warnings=[];const context={clock:{minute:550},industryTop3:top3,industryFastInject:inject,checks,warnings,check:(k,ok,reason)=>{checks[k]=!!ok;if(!ok)failures.push(reason);}};vm.runInNewContext(s.slice(start,end),context);return {checks,failures,warnings};}
const good={complete:true,scan_executed:true,source_rows:3,injection_count:0,zero_event:true};
const missing=run(null,good);assert.equal(missing.failures.length,0);assert.equal(missing.checks.industry_top3_receipt_readable,false);assert.equal(missing.warnings.length,4);
const empty=run({...good,complete:false,source_rows:0},good);assert.equal(empty.failures.length,0);assert.equal(empty.checks.industry_top3_receipt_complete,false);assert.equal(empty.warnings.length,2);
assert.equal(run(good,good).warnings.length,0);
assert.ok(run(good,null).failures.includes('industry_fast_inject_receipt_missing'));
assert.match(s,/industry_top3: \{[\s\S]*?owner: "morning_report"[\s\S]*?required: false/);
console.log('PASS morning failures remain visible without blocking core water; independent injection requirements unchanged');
