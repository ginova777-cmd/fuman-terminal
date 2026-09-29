'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
function reader(fetch) {
  const file = path.resolve(__dirname, '../lib/strategy3-canonical-water-reader.js');
  const context = { require: createRequire(file), module: { exports: {} }, __dirname: path.dirname(file),
    process, console, URL, URLSearchParams, AbortSignal, setTimeout, fetch };
  vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports.testRequests={readRows,readRpc};', context);
  return context.module.exports.testRequests;
}
test('GET timeout identifies page and bounded attempts without credentials', async () => {
  let calls = 0;
  const r = reader(async () => { calls++; throw new DOMException('timed out', 'TimeoutError'); });
  await assert.rejects(r.readRows('SECRET', 'mother_view', {offset:200,limit:200,secret:'PRIVATE'}, {timeout:7}), e => {
    assert.equal(calls, 2); assert.equal(e.requestFailure.endpoint, 'mother_view');
    assert.equal(e.requestFailure.offset, 200); assert.equal(e.requestFailure.attempt, 2);
    assert.equal(e.requestFailure.error_kind, 'timeout');
    assert(!JSON.stringify(e.requestFailure).match(/SECRET|PRIVATE|apikey|Authorization/)); return true;
  });
});
test('RPC permission failure is not retried and identifies chunk shape', async () => {
  let calls=0;
  const r=reader(async()=>{calls++;return {ok:false,status:403,text:async()=>''};});
  await assert.rejects(r.readRpc('SECRET','candles',{symbols:['1101','1102'],bars_per_symbol:40}),e=>{
    assert.equal(calls,1); assert.equal(e.requestFailure.endpoint,'rpc/candles');
    assert.equal(e.requestFailure.symbol_count,2); assert.equal(e.requestFailure.http_status,403);
    assert.equal(e.requestFailure.bars_per_symbol,40); return true;
  });
});
test('transient read recovers with unchanged rows and no extra attempts',async()=>{
  let calls=0; const r=reader(async()=>{if(++calls===1)throw new DOMException('aborted','AbortError');return {ok:true,json:async()=>[{symbol:'1101'}]};});
  const result=await r.readRows('SECRET','quotes'); assert.equal(result[0].symbol,'1101');assert.equal(calls,2);
});
