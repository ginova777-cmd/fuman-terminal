'use strict';
// Isolated compatibility proposal. No production caller or source approval.
const crypto = require('node:crypto');
const {validateDecision} = require('./daytrade-calendar-publication.cjs');
const legacyKeys = ['Name', 'Date', 'Weekday', 'Description'];
function verifyCalendarReadback(row, date, nowMs, {allowLegacySerialization = false} = {}) {
  if (!Number.isFinite(nowMs)) throw Error('CALENDAR_NOW_INVALID');
  const p = row?.payload, d = p?.calendar_decision;
  if (row?.market !== 'TW' || row.trade_date !== date || p?.override !== false ||
      p?.calendar_contract !== 'market-calendar-contract-v1' ||
      p?.calendar_publication_contract !== 'calendar-horizon-v1' ||
      p?.source !== 'daytrade-source-writer:twse-trading-day' ||
      row.is_open !== d?.isTradingDay || !Number.isFinite(Date.parse(row.updated_at)) ||
      Date.parse(row.updated_at) > nowMs || !/^[a-f0-9]{64}$/.test(p?.calendar_source_sha256 || '')) {
    throw Error('CALENDAR_PROVENANCE_MISMATCH');
  }
  const actual = validateDecision(d, date, nowMs);
  if (actual === p.calendar_source_sha256) return {mode: 'exact', sha256: actual};
  if (allowLegacySerialization !== true) throw Error('CALENDAR_HASH_MISMATCH');
  const rows = d.calendar_evidence.rows.map(r => {
    if (!r || Object.getPrototypeOf(r) !== Object.prototype || Object.keys(r).length !== 4 ||
        !legacyKeys.every(k => Object.hasOwn(r, k) && typeof r[k] === 'string')) {
      throw Error('CALENDAR_LEGACY_SHAPE_UNSUPPORTED');
    }
    return Object.fromEntries(legacyKeys.map(k => [k, r[k]]));
  });
  const legacy = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  if (legacy !== p.calendar_source_sha256) throw Error('CALENDAR_HASH_MISMATCH');
  return {mode: 'legacy-name-date-weekday-description', sha256: legacy};
}
module.exports = {verifyCalendarReadback};
