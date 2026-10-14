'use strict';
const assert=require('node:assert/strict');
const {evaluate,checks}=require('../lib/daytrade-module-recovery-policy.cjs');
const route=require('../lib/daytrade-formal-module-route.cjs');
const session=require('../lib/daytrade-module-session.cjs');
const registry=require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json');
const identity={trade_date:'2026-10-15',release_sha:'a'.repeat(40)};
const receipt=id=>({...identity,module_id:id,receipt_sha256:'b'.repeat(64),checks:Object.fromEntries(checks.map(k=>[k,true]))});
const base={contract:'daytrade_module_recovery_policy_v1',...identity,restored:['A01'],acceptance:{A01:receipt('A01')},probe:null};
let cases=0;
function test(name,fn){fn();cases++;console.log('PASS '+name);}
for(const key of checks)test('missing '+key+' rejects A02 only',()=>{
 const p={...base,restored:['A01','A02'],acceptance:{...base.acceptance,A02:{...receipt('A02'),checks:{...receipt('A02').checks,[key]:false}}}};
 const r=evaluate(p,registry,identity);assert.deepEqual(r.enabled,['A01']);assert.equal(r.rejected.A02,'RESTORE_EVIDENCE_INCOMPLETE');
});
test('receipt identity/hash rejection remains local',()=>{
 for(const value of [{module_id:'A03'},{trade_date:'2026-10-14'},{release_sha:'c'.repeat(40)},{receipt_sha256:3},{receipt_sha256:'wrong'}]){
  const r=evaluate({...base,restored:['A01','A02'],acceptance:{...base.acceptance,A02:{...receipt('A02'),...value}}},registry,identity);
  assert.deepEqual(r.enabled,['A01']);assert(r.rejected.A02);
 }
});
test('shared policy identity failure remains global',()=>{
 for(const p of [{...base,release_sha:'wrong'},{...base,trade_date:'wrong'},null,{...base,restored:['A01','A01']},{...base,restored:['A01','UNKNOWN']}])assert.equal(evaluate(p,registry,identity).status,'PAUSED');
});
test('unknown dependency survivors remain globally blocked',()=>{
 const r=evaluate({...base,restored:['A15','A18'],acceptance:{A18:receipt('A18')}},registry,identity);
 assert.equal(r.status,'PAUSED');assert.deepEqual(r.enabled,[]);
});
test('unsupported probe preserves accepted independent module',()=>{
 const r=route.restrict(evaluate({...base,probe:'A14'},registry,identity),registry,'2026-10-15T00:50:00Z');
 assert.deepEqual(r.enabled,['A01']);assert.equal(r.probe,null);assert.equal(r.rejected.A14,'MODULE_ISOLATION_NOT_IMPLEMENTED');
});
test('unsupported deferred route cannot activate later',()=>{
 const r=route.restrict(evaluate({...base,restored:['A01','B01'],acceptance:{...base.acceptance,B01:receipt('B01')}},registry,identity),registry,'2026-10-15T00:50:00Z');
 assert.deepEqual(r.enabled,['A01']);assert.deepEqual(session.select(r,'2026-10-15T01:01:00Z').enabled,[]);
});
test('A01 original single probe semantics preserved',()=>{
 const r=route.restrict(evaluate({...base,restored:[],acceptance:{},probe:'A01'},registry,identity),registry);
 assert.equal(session.select(r,'2026-10-14T22:00:00Z').probe,'A01');assert.equal(session.select(r,'2026-10-15T01:00:00Z').probe,null);
});
test('no invalid restored item promoted through probe',()=>assert.equal(evaluate({...base,restored:['A01','A02'],probe:'A02'},registry,identity).status,'PAUSED'));
console.log(JSON.stringify({status:'SCOPED_INCREMENTAL_POLICY_PASS',cases,scope:'Known independent preopen routes only; no full Writer or formal acceptance'}));
