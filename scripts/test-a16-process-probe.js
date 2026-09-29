'use strict';
const assert=require('node:assert/strict'),{probe}=require('../lib/a16-process-probe');
assert.equal(probe(123,()=>{}).state,'running');
for(const code of ['EPERM','EACCES','EIO'])assert.equal(probe(123,()=>{throw Object.assign(new Error(),{code});}).state,'unknown');
assert.equal(probe(123,()=>{throw Object.assign(new Error(),{code:'ESRCH'});}).state,'absent');
assert.equal(probe(-1,()=>{throw Error('must not call');}).state,'unknown');
console.log('PASS A16 process uncertainty never authorizes duplicate warmup');
