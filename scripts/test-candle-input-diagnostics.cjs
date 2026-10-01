'use strict';
const assert=require('node:assert/strict');const {create}=require('../lib/daytrade-candle-input-diagnostics.cjs');
const d=create(),at='2026-10-01T05:29:00Z';
d.observe({event:'snapshot',data:[]},[],at);
d.observe({event:'data',data:{symbol:'2330',date:at,close:100}},[{candleTime:at}],at);
for(let i=0;i<10000;i++)d.observe({event:'data',data:{symbol:'2330',date:at,close:null,token:'secret'}},[],at);
d.observe({event:'snapshot',data:{data:[{date:at,close:100}]}},[],at);
const s=d.snapshot();assert.equal(s.empty_messages,1);assert.equal(s.invalid_close,10000);assert.equal(s.missing_symbol,1);assert.equal(s.accepted_rows,1);assert.equal(s.last_accepted_event_at,'2026-10-01T05:29:00.000Z');assert(JSON.stringify(s).length<1000);assert(!JSON.stringify(s).includes('secret'));s.rejected_shapes[0].fields.push('mutated');assert(!JSON.stringify(d.snapshot()).includes('mutated'));
console.log('PASS bounded input reasons, source event time, no payload secrets and immutable snapshots');
