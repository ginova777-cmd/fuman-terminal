'use strict';
const assert = require('node:assert/strict');
const {buildTickerRows} = require('../lib/stock-master-sync');
const official = [{symbol:'3163',name:'sample',market:'TPEX',industry:'通信網路',industry_code:'27',source_date:'2026-10-02',listing_date:'2004-01-01',issued_common_shares:1000}];
const at='2026-10-03T03:00:00.000Z';
function row(prior){return buildTickerRows(official,prior===undefined?[]:[{symbol:'3163',...prior}],'test-master',at)[0];}
for(const prior of [undefined,{}, {is_suspended:null},{is_suspended:'false'},{is_suspended:'true'},{is_suspended:0},{is_suspended:1}]){
  const result=row(prior);
  assert.equal(result.is_suspended,null,'missing or non-boolean state must not certify normal trading');
  assert.equal(JSON.parse(JSON.stringify(result)).is_suspended,null,'null must survive the upsert JSON');
  assert.equal(result.stock_type,'COMMONSTOCK');
}
for(const value of [true,false]) assert.equal(row({is_suspended:value}).is_suspended,value);
const payload={source_evidence:{original:true},is_suspended:true};
const prior={symbol:'3163',is_suspended:null,payload};
const copy=JSON.stringify(prior);
const result=row(prior);
assert.equal(result.is_suspended,null,'unverified payload alias must not override the typed field');
assert.deepEqual(result.payload.source_evidence,payload.source_evidence);
assert.equal(JSON.stringify(prior),copy,'must not mutate source evidence');
assert.equal(result.payload.scanner_eligibility_separate_from_master,true);
console.log('PASS: missing/invalid suspension stays unknown; explicit booleans and source evidence preserved.');
