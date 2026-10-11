'use strict';

const { createCatalogueRetry } = require('./futopt-catalogue-retry.cjs');
const taipeiDate = value => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value));

// Review-only adapter. The caller must supply an independently verified TAIFEX
// REGULAR-session calendar resolver. A TWSE row or weekday heuristic is not one.
function createCalendarCatalogueRetry({ resolveSession, refresh, readState, writeState, now = Date.now }) {
  if (typeof resolveSession !== 'function') throw new Error('TAIFEX_RESOLVER_REQUIRED');
  return async function attempt(options) {
    const instant = now();
    const checkedAt = new Date(instant).toISOString();
    const date = taipeiDate(instant);
    const blocked = reason => ({ status: 'blocked', receipt: {
      status: 'blocked', error: reason, checked_at: checkedAt,
      expected_trade_date: date, formal_ready: false,
    } });
    if (options.tradeDate !== date || !Number.isFinite(Date.parse(options.asOf)) ||
        Date.parse(options.asOf) > instant || taipeiDate(options.asOf) !== date) {
      return blocked('FUTURES_CALENDAR_EXECUTION_DATE');
    }
    let session;
    try { session = await resolveSession({ date, asOf: checkedAt, exchange: 'TAIFEX', session: 'REGULAR' }); }
    catch { return blocked('FUTURES_CALENDAR_UNVERIFIED'); }
    // Validity is supplied by the calendar owner, never invented here. Recheck
    // after asynchronous resolution so midnight/expiry cannot authorize a fetch.
    const current = now();
    if (taipeiDate(current) !== date) return blocked('FUTURES_CALENDAR_DAY_CHANGED');
    if (session?.verified !== true || session.exchange !== 'TAIFEX' || session.session !== 'REGULAR' ||
        session.date !== date || !['OPEN', 'CLOSED'].includes(session.state) ||
        !session.evidence_ref || !/^[a-f0-9]{64}$/i.test(session.evidence_sha256 || '') ||
        !Number.isFinite(Date.parse(session.verified_at)) || Date.parse(session.verified_at) > instant ||
        !Number.isFinite(Date.parse(session.valid_until)) || Date.parse(session.valid_until) <= current) {
      return blocked('FUTURES_CALENDAR_UNVERIFIED');
    }
    if (session.state === 'CLOSED') {
      return { status: 'market_closed', receipt: {
        status: 'market_closed', checked_at: checkedAt, calendar_date: date,
        expected_trade_date: null, formal_ready: false, subscriptions_ready: false,
        reason: 'TAIFEX_REGULAR_SESSION_CLOSED',
        calendar_evidence_ref: session.evidence_ref, calendar_evidence_sha256: session.evidence_sha256,
      } };
    }
    // Keep blocked provider receipts intact during closure. At a new trading
    // date, the previous day's retry deadline/failure count does not carry over.
    const retry = createCatalogueRetry({ refresh, writeState, now, readState: () => {
      const prior = readState();
      return prior?.expected_trade_date === date || prior?.trade_date === date ? prior : null;
    } });
    return retry(options);
  };
}

module.exports = { createCalendarCatalogueRetry };
