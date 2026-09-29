'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {isCurrentComplete}=require('../lib/strategy4-mobile-rendered-status');
test('reads strategy hero instead of membership badge',()=>assert.equal(isCurrentComplete({statusText:'會員已開通',candidateTexts:['API-only complete run | display TODAY_COMPLETE']}),true));
test('rejects prior degraded authority and missing hero',()=>{assert.equal(isCurrentComplete({statusText:'會員已開通',candidateTexts:['display PREVIOUS_GOOD_DEGRADED | today-authority blocked']}),false);assert.equal(isCurrentComplete({statusText:'display TODAY_COMPLETE'}),false);});
test('zero result complete accepted; contradictory blocked hero rejected',()=>{assert.equal(isCurrentComplete({candidateTexts:['display TODAY_ZERO_RESULT_COMPLETE']}),true);assert.equal(isCurrentComplete({candidateTexts:['display TODAY_COMPLETE | today-authority blocked']}),false);});
