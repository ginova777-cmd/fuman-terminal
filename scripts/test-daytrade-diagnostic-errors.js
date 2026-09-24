"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {encodeDiagnosticError}=require('../lib/daytrade-diagnostic-errors');
test('NUL diagnostic is JSONB-safe with exact original recoverable',()=>{
 const original={target:'optional_write',message:'failed:'+String.fromCharCode(0)+'錯誤'};
 const result=encodeDiagnosticError(original);
 assert(!result.message.includes(String.fromCharCode(0)));
 assert.equal(Buffer.from(result.original_message_base64,'base64').toString('utf8'),original.message);
 assert.equal(result.target,original.target);
 assert(original.message.includes(String.fromCharCode(0)));
 assert.deepEqual(encodeDiagnosticError(result),result);
});
test('ordinary error and failure metadata stay unchanged',()=>{const e={message:'HTTP 400',code:400,ok:false};assert.equal(encodeDiagnosticError(e),e);});
