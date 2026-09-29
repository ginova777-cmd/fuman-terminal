'use strict';
const URL = 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule';
const closed = /市場無交易|停止交易|休市|放假|暫停交易/;
const special = /開始交易|最後交易|補行交易|恢復交易/;
function previousSession(calendar, tradeDate, asOf) {
  const decision = calendar?.payload?.calendar_decision;
  const evidence = decision?.calendar_evidence;
  const now = Date.parse(asOf), fetched = Date.parse(evidence?.fetched_at);
  const checked = Date.parse(calendar?.payload?.checked_at);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || !Number.isFinite(now)
      || new Date(now + 28800000).toISOString().slice(0,10) !== tradeDate)
    throw Error('PREOPEN_CALENDAR_OBSERVATION_INVALID');
  if (calendar?.trade_date !== tradeDate || calendar?.market !== 'TW' || calendar?.is_open !== true
      || decision?.date !== tradeDate || decision?.isTradingDay !== true
      || decision?.override === true || decision?.error
      || !['twse','cache'].includes(decision?.source) || evidence?.source !== decision.source
      || evidence?.source_url !== URL || !Number.isFinite(fetched) || !Number.isFinite(checked)
      || fetched > checked || checked > now || now - fetched > 7*86400000)
    throw Error('PREOPEN_CALENDAR_EVIDENCE_INVALID');
  const year = Number(tradeDate.slice(0,4)), rows = evidence?.rows;
  if (evidence?.year !== year || !Array.isArray(rows) || !rows.length
      || !rows.some(r => String(r.Date || '').startsWith(String(year-1911))))
    throw Error('PREOPEN_CALENDAR_YEAR_MISSING');
  function isOpen(date) {
    if (Number(date.slice(0,4)) !== year) throw Error('PREOPEN_PRIOR_YEAR_CALENDAR_REQUIRED');
    const roc = String(year-1911) + date.slice(5,7) + date.slice(8,10);
    const entries = rows.filter(r => String(r.Date || '') === roc);
    if (entries.length > 1) throw Error('PREOPEN_CALENDAR_DUPLICATE_DATE');
    const text = entries.map(r => String(r.Name || '')+' '+String(r.Description || '').replace(/<[^>]*>/g,' ')).join(' ');
    const weekend = [0,6].includes(new Date(date+'T12:00:00+08:00').getUTCDay());
    return !closed.test(text) && (!weekend || special.test(text));
  }
  if (!isOpen(tradeDate)) throw Error('PREOPEN_OBSERVATION_NOT_TRADING_DAY');
  let cursor = Date.parse(tradeDate+'T00:00:00Z');
  for (let i=0;i<31;i++) {
    cursor -= 86400000;
    const date = new Date(cursor).toISOString().slice(0,10);
    if (isOpen(date)) return date;
  }
  throw Error('PREOPEN_PREVIOUS_SESSION_NOT_FOUND');
}
module.exports = {previousSession};
