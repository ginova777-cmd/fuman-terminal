const assert=require('node:assert/strict');const {session}=require('./scan-telegram-previous-session.cjs');const runtimeRoot='C:/fuman-runtime';
for(const [now,base,trade] of [['2026-09-28T10:00:00+08:00','2026-09-24','2026-09-29'],['2026-09-29T08:00:00+08:00','2026-09-24','2026-09-29'],['2026-09-24T08:00:00+08:00','2026-09-23','2026-09-24']]){const r=session({runtimeRoot,now});assert.equal(r.base_date,base);assert.equal(r.trade_date,trade);}
assert.throws(()=>session({runtimeRoot:'Z:/missing-calendar',now:'2026-09-28T10:00:00+08:00'}),/CALENDAR_UNVERIFIED/);
console.log('PASS holiday, trading day, preceding session and missing-calendar rejection');
