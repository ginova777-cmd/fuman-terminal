'use strict';
const assert=require('node:assert/strict');const {retainQuote}=require('../lib/mother-shared-water-quote-retention.cjs');
const opts={tradeDate:'2026-10-06',nowMs:Date.parse('2026-10-06T05:00:00Z'),includeSameDayIdle:true};
const q={quoteSeenAt:'2026-10-06T01:00:00Z',quoteSource:'fugle-ws-trades'};
assert.equal(retainQuote(q,opts),true);assert.equal(retainQuote(q,{...opts,includeSameDayIdle:false}),false);
for(const change of [{quoteSeenAt:'2026-10-05T01:00:00Z'},{quoteSeenAt:'2026-10-06T06:00:00Z'},{quoteSource:'REST'},{isSynthetic:true},{isTrial:true},{quoteSeenAt:'invalid'}])assert.equal(retainQuote({...q,...change},opts),false);
assert.equal(q.quoteSeenAt,'2026-10-06T01:00:00Z');
console.log(JSON.stringify({ok:true,cases:8,mode:'same_day_idle_retention_not_freshness'}));
