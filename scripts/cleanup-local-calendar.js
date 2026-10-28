'use strict';
// Local retention only; cloud and deferred C16 policies are separate.
const DAY = 86400000;
function cutoff(now = Date.now(), keepDays = 7) {
  if (!Number.isFinite(now) || !Number.isSafeInteger(keepDays) || keepDays < 1) throw Error('invalid_local_retention_clock');
  return Math.floor((now + 8 * 3600000) / DAY) * DAY - 8 * 3600000 - (keepDays - 1) * DAY;
}
function expired(value, now = Date.now(), keepDays = 7) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) && time < cutoff(now, keepDays);
}
function describe(now = Date.now()) {
  return { contract: 'cleanup-local-calendar-v1', timeZone: 'Asia/Taipei', keepCalendarDays: 7, retainFrom: new Date(cutoff(now) + 8 * 3600000).toISOString().slice(0, 10), cutoffUtc: new Date(cutoff(now)).toISOString() };
}
module.exports = { cutoff, expired, describe };
