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
  const nextDate = new Date(Date.parse(`${announcementDate}T00:00:00Z`) + 86400000).toISOString().slice(0,10);
  if (announcementDate !== requested && nextDate !== requested) throw Error('EMERGENCY_ANNOUNCEMENT_DATE_MISMATCH');
  // Official daily pages can explicitly announce no closures without city rows.
  // Accept only today's dated, unambiguous status table, never missing data.
  const tables = [...html.matchAll(/<table\b[^>]*\bid\s*=\s*["']Table["'][^>]*>[\s\S]*?<\/table>/gi)];
  const emptyRows = tables.length === 1 ? [...tables[0][0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].filter(m => /<td\b/i.test(m[1]) && m[1].replace(/<[^>]*>/g, '').trim() === '無停班停課訊息。') : [];
  if (emptyRows.length) {
    const updated = parsed.updateLine.match(/更新時間[：:]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+\d{2}:\d{2}:\d{2}/);
    const updatedDate = updated && `${updated[1]}-${updated[2].padStart(2,'0')}-${updated[3].padStart(2,'0')}`;
    if (emptyRows.length !== 1 || parsed.statuses.length !== 0 || announcementDate !== requested || updatedDate !== requested) throw Error('EMERGENCY_EMPTY_NOTICE_UNVERIFIED');
    return { isTradingDay: true, date: requested, source: 'dgpa_twse_rule', reason: 'official_no_closure_announcements',
      row: { evidenceContract: 'dgpa-market-evidence-v2', sourceUrl: SOURCE_URL, ruleUrl: RULE, announcementDate, effectiveAt: `${requested}T00:00:00+08:00`, sourceSha256: crypto.createHash('sha256').update(html).digest('hex'), statusText: '無停班停課訊息。', updateLine: parsed.updateLine, rawHtml: html } };
  }
  const rows = parsed.statuses.filter(r => r.county === '臺北市');
  if (rows.length !== 1) throw Error('EMERGENCY_TAIPEI_STATUS_AMBIGUOUS');
  const text = (announcementDate === requested ? rows[0].statusText.split('明天')[0] : (rows[0].statusText.includes('明天') ? '明天' + rows[0].statusText.split('明天')[1] : '')).trim();
  if (!text) throw Error('EMERGENCY_ANNOUNCEMENT_DATE_MISMATCH');
  // Partial districts and ambiguous time windows require independent review.
  if (/區|里|部分|學校|除外/.test(text)) throw Error('EMERGENCY_PARTIAL_AREA_UNVERIFIED');
  const closed = /^(?:今天|明天)(?:全天|上午)?停止上班(?:[、，及]|。|$)/.test(text) || /^(?:今天|明天)已達停止上班及上課標準[。.]?$/.test(text);
  const open = /^(?:今天|明天)照常上班(?:[、，及]|。|$)/.test(text) || /^(?:今天|明天)未達停止上班及上課標準[。.]?$/.test(text);
  if (!closed && !open) throw Error('EMERGENCY_TAIPEI_STATUS_UNVERIFIED');
  return { isTradingDay: !closed, date: requested, source: 'dgpa_twse_rule', reason: closed ? 'typhoon_holiday' : 'official_normal_work',
    row: { evidenceContract: 'dgpa-market-evidence-v2', sourceUrl: SOURCE_URL, ruleUrl: RULE, announcementDate, effectiveAt: `${requested}T00:00:00+08:00`, sourceSha256: crypto.createHash('sha256').update(html).digest('hex'), statusText: text, updateLine: parsed.updateLine, rawHtml: html } };
}
function verify(day) {
  const r = day?.row;
  if (!r || r.evidenceContract !== 'dgpa-market-evidence-v2' || r.sourceUrl !== SOURCE_URL || r.ruleUrl !== RULE || typeof r.rawHtml !== 'string') throw Error('EMERGENCY_EVIDENCE_MISSING');
  const actual = assess(r.rawHtml, day.date);
  for (const key of ['announcementDate','effectiveAt','sourceSha256','statusText','updateLine']) {
    if (r[key] !== actual.row[key]) throw Error(`EMERGENCY_EVIDENCE_MISMATCH:${key}`);
  }
  if (day.isTradingDay !== actual.isTradingDay) throw Error('EMERGENCY_DECISION_MISMATCH');
  return actual;
}
async function check(requested) {
  const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(10000), headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw Error(`EMERGENCY_SOURCE_HTTP_${response.status}`);
  if (new URL(response.url).hostname !== 'www.dgpa.gov.tw') throw Error('EMERGENCY_SOURCE_IDENTITY');
  return assess(await response.text(), requested);
}
module.exports = { assess, check, verify, SOURCE_URL };
