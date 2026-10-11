'use strict';
const crypto = require('node:crypto');
const policy = require('../data/contracts/taifex-regular-calendar-2026.json');
const ANNOUNCEMENTS = 'https://www.taifex.com.tw/cht/11/announcement';
const INDEX = 'https://www.taifex.com.tw/cht/4/calendar';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const day = n => new Date(n + 28800000).toISOString().slice(0, 10);
const relevant = text => /休市|颱風|天然災害|停止交易|恢復交易|正常交易|暫停交易/.test(text);
function parseAnnouncements(html) {
  const table = html.match(/<table\b[^>]*class="table_c table-fixed td-wrap"[^>]*>([\s\S]*?)<\/table>/i);
  if (!table || !/日期/.test(table[1]) || !/標題/.test(table[1])) throw Error('TAIFEX_ANNOUNCEMENT_SCHEMA');
  const rows = [];
  for (const match of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1];
    if (/<th\b/i.test(row)) continue;
    const date = row.match(/>(\d{4}\/\d{2}\/\d{2})<\/td>/);
    const link = row.match(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!date || !link) throw Error('TAIFEX_ANNOUNCEMENT_ROW');
    const title = link[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    rows.push({ date: date[1].replaceAll('/', '-'), title, hash: sha(title), href: link[1].replace('&amp;', '&') });
  }
  if (!rows.length) throw Error('TAIFEX_ANNOUNCEMENT_EMPTY');
  return rows;
}

function classify(date, rows) {
  if (!/^2026-\d{2}-\d{2}$/.test(date) || day(Date.parse(date + 'T00:00:00+08:00')) !== date) throw Error('TAIFEX_CALENDAR_YEAR_UNREVIEWED');
  let emergencyClosed = policy.reviewed_announcements.some(r => r.closed_dates.includes(date));
  for (const row of rows.filter(r => relevant(r.title))) {
    if (new URL(row.href, ANNOUNCEMENTS).origin !== 'https://www.taifex.com.tw') throw Error('TAIFEX_NOTICE_SOURCE');
    const reviewed = policy.reviewed_announcements.find(r => r.hash === row.hash && r.href === row.href);
    if (reviewed) { if (reviewed.closed_dates.includes(date)) emergencyClosed = true; continue; }
    // Only an unambiguous single-date, whole-market, all-day emergency closure
    // can be accepted automatically. Reopening/ranges/partial sessions need review.
    const dates = [...row.title.matchAll(/(\d{3,4})年\s*(\d{1,2})月\s*(\d{1,2})日/g)].map(m =>
      `${Number(m[1]) < 1911 ? Number(m[1]) + 1911 : m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);
    if (/集中交易市場休市1日\(包含一般交易時段及盤後交易時段\)/.test(row.title) &&
        !/恢復|取消|更正|至|起|延後/.test(row.title) && dates.length === 1 && dates[0] === date) {
      emergencyClosed = true;
    } else throw Error('TAIFEX_MARKET_NOTICE_REVIEW_REQUIRED');
  }
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  return emergencyClosed || weekday === 0 || weekday === 6 || policy.closed_weekdays.includes(date) ? 'CLOSED' : 'OPEN';
}

function createResolver({ fetchImpl = fetch, now = Date.now, saveEvidence = () => {} } = {}) {
  let cached = null, inFlight = null, retryAt = 0;
  async function get(url, limit) {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Cache-Control': 'no-cache' } });
    if (response.status !== 200 || (response.url && response.url !== url)) throw Error('TAIFEX_CALENDAR_HTTP');
    const parts = []; let length = 0;
    for await (const chunk of response.body) { length += chunk.length; if (length > limit) throw Error('TAIFEX_CALENDAR_SIZE'); parts.push(Buffer.from(chunk)); }
    return Buffer.concat(parts);
  }
  return async function resolve({ date, asOf, exchange, session }) {
    const started = now();
    if (date !== day(started) || exchange !== 'TAIFEX' || session !== 'REGULAR' ||
        !Number.isFinite(Date.parse(asOf)) || day(Date.parse(asOf)) !== date || Date.parse(asOf) > started) throw Error('TAIFEX_CALENDAR_REQUEST');
    if (cached?.date === date && Date.parse(cached.valid_until) > started) return cached;
    if (inFlight) return inFlight;
    if (started < retryAt) throw Error('TAIFEX_CALENDAR_BACKOFF');
    inFlight = (async () => {
      const index = await get(INDEX, 1024 * 1024);
      if (!index.toString('utf8').includes('/file/taifex/CHINESE/4/2026Calendar.pdf')) throw Error('TAIFEX_CALENDAR_VERSION');
      const pdf = await get(policy.source_url, 2 * 1024 * 1024);
      if (sha(pdf) !== policy.source_sha256) throw Error('TAIFEX_CALENDAR_HASH');
      const notices = await get(ANNOUNCEMENTS, 2 * 1024 * 1024);
      const rows = parseAnnouncements(notices.toString('utf8'));
      if (rows.some(r => r.date > date)) throw Error('TAIFEX_NOTICE_FUTURE_DATE');
      const state = classify(date, rows), finished = now();
      const until = Math.min(started + policy.refresh_ms, Date.parse(date + 'T23:59:59.999+08:00'));
      if (day(finished) !== date || finished >= until) throw Error('TAIFEX_CALENDAR_EXPIRED_DURING_FETCH');
      const evidence = { contract: 'taifex-regular-calendar-evidence-v1', date, state, fetched_at: new Date(started).toISOString(),
        valid_until: new Date(until).toISOString(), sources: [INDEX, policy.source_url, ANNOUNCEMENTS],
        hashes: [sha(index), sha(pdf), sha(notices)], policy_sha256: sha(JSON.stringify(policy)) };
      const evidenceHash = sha(JSON.stringify(evidence));
      await saveEvidence(evidenceHash, evidence, [index, pdf, notices]);
      if (now() >= until) throw Error('TAIFEX_CALENDAR_EXPIRED_DURING_SAVE');
      cached = { verified: true, exchange, session, date, state, verified_at: new Date(started).toISOString(),
        valid_until: evidence.valid_until, evidence_sha256: evidenceHash, evidence_ref: 'taifex-regular-calendar/' + evidenceHash + '.json' };
      return cached;
    })();
    try { return await inFlight; }
    catch (error) { cached = null; retryAt = now() + policy.failure_backoff_ms; throw error; }
    finally { inFlight = null; }
  };
}
module.exports = { createResolver, parseAnnouncements, classify, sha, INDEX, ANNOUNCEMENTS };
