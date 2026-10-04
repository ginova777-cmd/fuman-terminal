'use strict';
const assert=require('assert/strict'),crypto=require('crypto');const {normalize}=require('../lib/txf-candle-evidence.cjs');
const raw={symbol:'TXFJ6',date:'2026-10-02T08:45:00+08:00',open:123.5,high:124,low:122,close:123,volume:9,label:'原生事件',extra:{z:1,a:2}};
const r=normalize(raw,{symbol:'TXFJ6',tradeDate:'2026-10-02',source:'Fugle:WS:candles',receivedAt:'2026-10-02T00:46:00Z',nowMs:Date.parse('2026-10-02T00:46:01Z')});
assert.equal(r.raw_serialization,'ecmascript-json-stringify-utf8-v1');assert.equal(r.raw_evidence_json,JSON.stringify(raw));assert.equal(crypto.createHash('sha256').update(r.raw_evidence_json,'utf8').digest('hex'),r.raw_sha256);assert.deepEqual(JSON.parse(r.raw_evidence_json),r.raw_evidence);
const reordered=Object.fromEntries(Object.entries(raw).reverse());assert.notEqual(crypto.createHash('sha256').update(JSON.stringify(reordered)).digest('hex'),r.raw_sha256);assert.deepEqual(reordered,r.raw_evidence);
assert.notEqual(crypto.createHash('sha256').update(r.raw_evidence_json+' ').digest('hex'),r.raw_sha256);
console.log('PASS raw evidence exact UTF8 bytes, Unicode/decimal/nesting, reordered object and tampered string detection');
