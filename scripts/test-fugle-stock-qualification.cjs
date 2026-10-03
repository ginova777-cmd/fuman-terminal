'use strict';
const assert=require('node:assert/strict');
const {mapFugleStockQualification:map}=require('../lib/fugle-stock-qualification.cjs');
const body={symbol:'3163',date:'2026-10-02',market:'OTC',exchange:'TPEx',type:'EQUITY',securityType:'01',securityStatus:'NORMAL',canDayTrade:true,canBuyDayTrade:true,isAttention:false,isDisposition:false};
const input={body,expectedSymbol:'3163',tradeDate:'2026-10-02',receivedAt:'2026-10-03T02:59:17.501Z',nowMs:Date.parse('2026-10-03T03:00:00Z')};
const baseline=map(input);assert.equal(baseline.is_common_stock,true);assert.equal(baseline.is_tradable,true);assert.equal(baseline.is_suspended,false);assert.equal(baseline.is_trial,null);assert.equal(baseline.is_halted,null);assert.equal(baseline.source_event_at,null);
for(const change of [{symbol:'2330'},{date:'2026-10-01'},{market:'TSE'},{exchange:'TWSE'}]){
 const r=map({...input,body:{...body,...change}});assert.equal(r.identity_valid,false);assert.ok(Object.values(r.fields).every(f=>f.value===null));
}
for(const change of [{receivedAt:'2026-10-03T03:01:00Z'},{receivedAt:'2026-10-03T03:00:00'},{tradeDate:'2026-02-30'},{nowMs:NaN}])assert.equal(map({...input,...change}).identity_valid,false);
for(const value of [undefined,null,'false','true',0,1])assert.equal(map({...input,body:{...body,isAttention:value}}).is_attention,null);
assert.equal(map({...input,body:{...body,canDayTrade:false,canBuyDayTrade:true}}).daytrade_allowed,false);
assert.equal(map({...input,body:{...body,securityType:'04'}}).is_common_stock,false);
assert.equal(map({...input,body:{...body,securityType:'00'}}).is_common_stock,null);
assert.equal(map({...input,body:{...body,type:'INDEX'}}).is_common_stock,null);
assert.equal(map({...input,body:{...body,securityStatus:'SUSPENDED'}}).is_suspended,true);
assert.equal(map({...input,body:{...body,securityStatus:'TERMINATED'}}).is_tradable,false);
assert.equal(map({...input,body:{...body,securityStatus:'OTHER'}}).is_tradable,null);
assert.equal(map({...input,body:{...body,isHalted:false,isTrial:false}}).is_halted,null,'ticker is not authoritative for undocumented live flags');
assert.equal(JSON.stringify(body),JSON.stringify(baseline.raw));
console.log('PASS: native qualification identity, booleans, security types/status, directional daytrade flags and unknown live status.');
