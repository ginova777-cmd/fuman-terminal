"use strict";
const fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto'), cp = require('child_process');
const technical = require('../lib/strategy5-technical-selection');
const api = require('../api/strategy5-latest')._test;
const root = path.resolve(__dirname, '..'), runtime = process.env.FUMAN_RUNTIME_DIR || 'C:/fuman-runtime';
const out = path.join(root, 'outputs/strategy5-live-acceptance');
const read = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const arg = key => process.argv.find(v=>v.startsWith(key+'='))?.slice(key.length+1);
const expectedRunId = arg('--expected-run-id');
const scan = expectedRunId ? {runId:expectedRunId,matches:Number(arg('--expected-count'))} : read(path.join(runtime, 'data/scan-receipts/strategy5.json'));
const secret = n => fs.readFileSync(path.join(runtime, 'secrets', n), 'utf8').trim();
const url = secret('supabase-url.txt'), key = secret('supabase-service-role-key.txt');
async function get(query) {
  const response = await fetch(url + '/rest/v1/' + query, { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(30000) });
  assert(response.ok, 'DB readback HTTP ' + response.status); return response.json();
}
async function main() {
  fs.mkdirSync(out, { recursive: true });
  let report = { ok: false, checkedAt: new Date().toISOString(), runId: scan.runId, issues: [] };
  try {
    assert(/^strategy5-\d{8}-\d{14}$/.test(scan.runId), 'invalid runId');
    const [run] = await get('strategy5_scan_runs?select=*&run_id=eq.' + scan.runId);
    assert(run?.complete && run.status === 'complete' && run.scanned_count === run.expected_total && run.expected_total > 0, 'full scan not complete');
    const rows = [];
    for (let offset = 0;; offset += 500) {
      const page = await get('strategy5_scan_results?select=*&run_id=eq.' + scan.runId + '&order=rank.asc,code.asc&limit=500&offset=' + offset);
      rows.push(...page); if (page.length < 500) break;
    }
    assert(rows.length === run.result_count && rows.length === scan.matches && new Set(rows.map(r => r.code)).size === rows.length, 'full DB count/unique mismatch');
    const date = process.env.FUMAN_REPLAY_TRADE_DATE || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
    assert(String(run.scan_date).slice(0,10) === date, 'run trade date mismatch');
    const raw = fs.readFileSync(run.payload.technicalSourcePath, 'utf8');
    assert(crypto.createHash('sha256').update(raw).digest('hex') === run.payload.technicalSourceHash, 'technical evidence hash mismatch');
    const evidence = JSON.parse(raw);
    assert(evidence.runId === scan.runId && evidence.tradeDate === date && evidence.contract === technical.CONTRACT, 'evidence identity mismatch');
    const recomputed = technical.evaluate(evidence.candidates, evidence.sources, date);
    assert.deepStrictEqual(recomputed.selectionCoverage, run.payload.selectionCoverage, 'coverage recomputation mismatch');
    assert(recomputed.selectionCoverage.ok, 'candidate coverage below threshold');
    assert.deepStrictEqual(recomputed.selected.map(r => r.code), rows.map(r => r.code), 'exact selected ranked list mismatch');
    for (const row of rows) {
      const expected = recomputed.selected.find(r => r.code === row.code);
      assert(row.run_id === scan.runId && row.complete && String(row.scan_date).slice(0,10) === date, 'row identity mismatch');
      assert.deepStrictEqual(row.payload.technicalTrend, expected.technicalTrend, 'stored indicators mismatch ' + row.code);
      assert.deepStrictEqual(row.payload.matches, expected.matches, 'base strategies changed ' + row.code);
    }
    const fresh = technical.evaluate(rows.map(r => r.payload), await technical.readSources(rows.map(r => r.payload), date), date);
    assert(fresh.selected.length === rows.length, 'fresh daily source does not support selected stocks');
    for (const row of rows) {
      const actual = fresh.selected.find(r => r.code === row.code).technicalTrend;
      for (const frame of ['daily', 'hourly60']) {
        const stored = row.payload.technicalTrend[frame], now = actual[frame];
        if (frame === 'daily') assert(stored.lastBarTime === now.lastBarTime && stored.previousBarTime === now.previousBarTime && now.trendUp, 'daily source date mismatch');
        if (stored.available && now.available) for (const field of ['kdK','kdD','kdPrevK','kdPrevD','rsi3','rsi6','rsi3Prev','rsi6Prev']) assert(Math.abs(stored[field] - now[field]) < 1e-7, 'fresh indicator mismatch ' + row.code + ':' + field);
      }
    }
    const visible = api.buildPayload(rows, run).matches;
    report = { ...report, ok: true, tradeDate: date, scannedCount: run.scanned_count, expectedTotal: run.expected_total, resultCount: rows.length, readbackCount: rows.length, selectionCoverage: run.payload.selectionCoverage, technicalFreshReadback: true, technicalSourceHash: run.payload.technicalSourceHash, rows, visibleRows: visible };
    fs.writeFileSync(path.join(out, 'readback.json'), JSON.stringify(report, null, 2));
    if (process.argv.includes('--render')) {
      const args = ['--use-system-ca', path.join(root, 'scripts/verify-terminal-ui-e2e.js'), '--routes=strategy5', '--only=desktop-night,desktop-sun,mobile-night,mobile-sun', '--skip-watchlist', '--skip-mobile-watch-add', '--include-strategy5-scorecard', '--strategy5-readback=' + path.join(out,'readback.json'), '--expected-run-id=' + scan.runId, '--expected-total=' + rows.length, '--expected-scorecard-symbols=' + visible.slice(0,120).map(r=>r.code).join(','), '--out=' + path.join(out,'rendered'), '--route-timeout=90000'];
      const result = cp.spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
      assert(result.status === 0, 'actual three-surface acceptance failed');
    }
    console.log(JSON.stringify({ ok: true, runId: scan.runId, resultCount: rows.length, report: path.join(out,'readback.json') }));
  } catch (error) {
    report.ok = false; report.issues.push(error.message);
    fs.writeFileSync(path.join(out,'readback.json'), JSON.stringify(report,null,2)); throw error;
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
