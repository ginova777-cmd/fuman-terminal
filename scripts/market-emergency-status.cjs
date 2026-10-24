"use strict";
const crypto = require('crypto');
const { parseDgpaDailyHtml } = require('./update-market-calendar-auto-override');
const SOURCE_URL = 'https://www.dgpa.gov.tw/typh/daily/nds.html';
const RULE = 'https://www.twse.com.tw/zh/clearing/suspended.html';
function assess(html, requested) {
  const parsed = parseDgpaDailyHtml(html);
  const match = parsed.rawText.match(/(\d{3,4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*天然災害停止上班及上課情形/);
  if (!match) throw Error('EMERGENCY_ANNOUNCEMENT_DATE_MISSING');
  const year = Number(match[1]) + (match[1].length === 3 ? 1911 : 0);
  const announcementDate = `${year}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
  if (announcementDate !== requested) throw Error('EMERGENCY_ANNOUNCEMENT_DATE_MISMATCH');
  const rows = parsed.statuses.filter(r => r.county === '臺北市');
  if (rows.length !== 1) throw Error('EMERGENCY_TAIPEI_STATUS_AMBIGUOUS');
  const text = rows[0].statusText.split('明天')[0].trim();
  // Partial districts and ambiguous time windows require independent review.
  if (/區|里|部分|學校|除外/.test(text)) throw Error('EMERGENCY_PARTIAL_AREA_UNVERIFIED');
  const closed = /^今天(?:全天|上午)?停止上班/.test(text);
  const open = /^今天照常上班/.test(text);
  if (!closed && !open) throw Error('EMERGENCY_TAIPEI_STATUS_UNVERIFIED');
  return { isTradingDay: !closed, date: requested, source: 'dgpa_twse_rule', reason: closed ? 'typhoon_holiday' : 'official_normal_work',
    row: { sourceUrl: SOURCE_URL, ruleUrl: RULE, announcementDate, effectiveAt: `${requested}T00:00:00+08:00`, sourceSha256: crypto.createHash('sha256').update(html).digest('hex'), statusText: text, updateLine: parsed.updateLine } };
}
async function check(requested) {
  const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(10000), headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw Error(`EMERGENCY_SOURCE_HTTP_${response.status}`);
  if (new URL(response.url).hostname !== 'www.dgpa.gov.tw') throw Error('EMERGENCY_SOURCE_IDENTITY');
  return assess(await response.text(), requested);
}
module.exports = { assess, check };
