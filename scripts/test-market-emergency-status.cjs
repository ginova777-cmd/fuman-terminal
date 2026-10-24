const assert = require('node:assert/strict');
const { assess } = require('./market-emergency-status.cjs');
const html = status => `<html><body>115年 10月 23日 天然災害停止上班及上課情形<br>更新時間：2026/10/23 05:00:00<br>臺北市 ${status}</body></html>`;
assert.equal(assess(html('今天停止上班、停止上課。'), '2026-10-23').isTradingDay, false);
assert.equal(assess(html('今天照常上班、照常上課。'), '2026-10-23').isTradingDay, true);
assert.throws(() => assess(html('今天停止上班。'), '2026-10-24'), /DATE_MISMATCH/);
assert.throws(() => assess(html('士林區今天停止上班。'), '2026-10-23'), /PARTIAL_AREA/);
assert.throws(() => assess('<html>unavailable</html>', '2026-10-23'), /DATE_MISSING/);
console.log('PASS emergency source date, full-city closure, normal day, partial-area and malformed rejection');
