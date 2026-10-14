'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {prepare}=require('../lib/daytrade-selective-probe-stop.cjs');
const {checks}=require('../lib/daytrade-module-recovery-policy.cjs');
const registry=require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json');
const identity={release_sha:'a'.repeat(40),trade_date:'2026-10-15'};
const receipt=id=>({...identity,module_id:id,receipt_sha256:'b'.repeat(64),checks:Object.fromEntries(checks.map(k=>[k,true]))});
const base={contract:'daytrade_module_recovery_policy_v1',...identity,restored:['A02'],probe:'A01',acceptance:{A02:receipt('A02')}};
const args=p=>{const before=Buffer.from(JSON.stringify(p,null,2));return {before,expectedHash:crypto.createHash('sha256').update(before).digest('hex'),identity,registry,target:'A01'};};
let cases=0;function test(name,fn){fn();cases++;console.log('PASS '+name);}
test('A01 cleared; exact retained bytes preserved',()=>{
 const a=args(base),r=prepare(a);assert.deepEqual(r.retained,['A02']);
 assert.equal(r.after.toString(),a.before.toString().replace('"probe": "A01"','"probe": null'));
 assert.deepEqual(JSON.parse(r.after),{...base,probe:null});
});
test('original empty restored shape supported',()=>assert.deepEqual(prepare(args({...base,restored:[],acceptance:{}})).retained,[]));
test('wrong hash rejected',()=>assert.throws(()=>prepare({...args(base),expectedHash:'0'.repeat(64)}),/HASH/));
test('wrong release/date rejected',()=>{for(const key of ['release_sha','trade_date'])assert.throws(()=>prepare({...args(base),identity:{...identity,[key]:'wrong'}}),/ACCEPTANCE/);});
test('invalid retained evidence rejected',()=>assert.throws(()=>prepare(args({...base,acceptance:{}})),/ACCEPTANCE/));
test('dependent retained scope rejected',()=>assert.throws(()=>prepare(args({...base,restored:['A18'],acceptance:{A18:receipt('A18')}})),/DEPENDENCY/));
test('another target rejected',()=>assert.throws(()=>prepare({...args(base),target:'A02'}),/TARGET/));
test('already cleared rejected',()=>assert.throws(()=>prepare(args({...base,probe:null})),/IDENTITY/));
test('ambiguous duplicate probe rejected',()=>{
 const before=Buffer.from(JSON.stringify(base).replace('"probe":"A01"','"probe":"A01","probe":"A01"'));
 assert.throws(()=>prepare({...args(base),before,expectedHash:crypto.createHash('sha256').update(before).digest('hex')}),/AMBIGUOUS/);
});
console.log(JSON.stringify({status:'SELECTIVE_STOP_PREPARATION_PASS',cases,formal_execution:false,scope:'Pure bytes preparation; Owner CAS/lifecycle not yet integrated'}));
