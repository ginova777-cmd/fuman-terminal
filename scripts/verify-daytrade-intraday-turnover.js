const fs = require('node:fs');
const path = require('node:path');

// Independent arithmetic verifier. Input must be the DB-readback ranking
// envelope; this script never publishes rows or repairs the supplied values.
function verify(r, expected = {}) {
  const failed = [];
  const check = (ok, name) => { if (!ok) failed.push(name); };
  check(r?.contract === 'daytrade_intraday_turnover_v1', 'contract');
  check(/^\d{4}-\d{2}-\d{2}$/.test(r?.trade_date || ''), 'trade_date');
  check(r?.canonical_run_id === `fugle_daytrade_source:${String(r?.trade_date || '').replace(/-/g, '')}:canonical`, 'canonical_identity');
  if (expected.trade_date) check(r?.trade_date === expected.trade_date, 'expected_trade_date');
  if (expected.canonical_run_id) check(r?.canonical_run_id === expected.canonical_run_id, 'expected_canonical_identity');
  check(r?.creates_formal_candidate === false && r?.publish_allowed === false, 'publication_prohibited');
  check(typeof r?.run_id === 'string' && r.run_id.length > 0 && Number.isFinite(Date.parse(r?.calculated_at)), 'batch_identity');
  const rows = Array.isArray(r?.rows) ? r.rows : [];
  const gaps = Array.isArray(r?.data_gaps) ? r.data_gaps : [];
  if (r?.gaps) check(JSON.stringify(r.gaps) === JSON.stringify(gaps), 'legacy_gap_alias_consistent');
  check(Array.isArray(r?.rows) && Array.isArray(r?.data_gaps), 'arrays');
  check(Number.isInteger(r?.requested_count) && r.requested_count > 0, 'nonempty_universe');
  check(r?.requested_count === rows.length + gaps.length && r?.ready_count === rows.length && r?.data_gap_count === gaps.length, 'counts');
  check(new Set([...rows, ...gaps].map(x => x.symbol)).size === rows.length + gaps.length, 'unique_symbols');
  for (const [i, row] of rows.entries()) {
    const volume = row.cumulative_volume;
    const shares = row.issued_common_shares;
    const expected = volume * (row.volume_unit === 'lots' ? 1000 : 1) / shares * 100;
    const age = (Date.parse(r.calculated_at) - Date.parse(row.volume_event_at)) / 1000;
    const eventDate = Number.isFinite(Date.parse(row.volume_event_at)) ? new Date(Date.parse(row.volume_event_at) + 28800000).toISOString().slice(0, 10) : '';
    check(typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 && typeof shares === 'number' && shares > 0 && Number.isFinite(shares), `numeric:${row.symbol}`);
    check(['lots', 'shares'].includes(row.volume_unit) && row.is_synthetic === false && !!row.volume_source, `source:${row.symbol}`);
    const syncDate = Number.isFinite(Date.parse(row.shares_synced_at)) ? new Date(Date.parse(row.shares_synced_at) + 28800000).toISOString().slice(0, 10) : '';
    check(row.shares_source === 'MOPS_OPEN_DATA_TWSE_TPEX' && /^\d{4}-\d{2}-\d{2}$/.test(row.shares_source_date || '')
      && row.shares_source_date <= r.trade_date && syncDate === r.trade_date
      && Date.parse(row.shares_synced_at) <= Date.parse(r.calculated_at), `shares:${row.symbol}`);
    check(eventDate === r.trade_date && age >= 0 && age <= 120 && row.trade_date === r.trade_date, `event:${row.symbol}`);
    check(Number.isFinite(row.cumulative_volume_shares) && row.cumulative_volume_shares === volume * (row.volume_unit === 'lots' ? 1000 : 1), `volume_conversion:${row.symbol}`);
    check(Number.isFinite(row.volume_age_seconds) && Math.abs(row.volume_age_seconds - age) < 1e-6, `volume_age:${row.symbol}`);
    check(/^\d{4}$/.test(row.symbol), `symbol:${row.symbol}`);
    check(row.status === 'ready' && Array.isArray(row.reasons) && row.reasons.length === 0 && row.rank === i + 1, `row:${row.symbol}`);
    check(typeof row.turnover_pct === 'number' && Number.isFinite(expected) && Math.abs(row.turnover_pct - expected) <= 1e-10, `formula:${row.symbol}`);
    if (i) check(rows[i - 1].turnover_pct > row.turnover_pct || (rows[i - 1].turnover_pct === row.turnover_pct && rows[i - 1].symbol.localeCompare(row.symbol) < 0), `order:${row.symbol}`);
  }
  for (const row of gaps) check(/^\d{4}$/.test(row.symbol) && row.trade_date === r.trade_date && row.status === 'DATA_GAP' && row.turnover_pct === null && row.rank == null && Array.isArray(row.reasons) && row.reasons.length > 0, `gap:${row.symbol}`);
  return { contract: 'daytrade_intraday_turnover_verifier_v1', scope: 'provided_readback_arithmetic_and_contract',
    status: failed.length ? 'blocked' : 'complete', complete: failed.length === 0,
    requested_count: r?.requested_count ?? null, ready_count: rows.length, data_gap_count: gaps.length,
    data_coverage: r?.requested_count > 0 ? rows.length / r.requested_count : null,
    all_market_data_ready: r?.requested_count > 0 && gaps.length === 0 && rows.length === r.requested_count,
    failed_checks: failed, first_blocker: failed[0] || null, exit_code: failed.length ? 1 : 0 };
}
// Called only after the Writer has performed the anon query. No supplied file
// or arithmetic-only verdict is sufficient to claim DB delivery.
function verifyDelivery(actual, written, evidence = {}) {
  const verdict = verify(actual, {trade_date: written?.trade_date, canonical_run_id: written?.canonical_run_id});
  const failed = [...verdict.failed_checks];
  const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  if (!actual || stable(actual) !== stable(written)) failed.push('anon_readback_not_same_batch');
  const writtenCount = (written?.rows?.length || 0) + (written?.data_gaps?.length || 0);
  const readCount = (actual?.rows?.length || 0) + (actual?.data_gaps?.length || 0);
  if (written?.requested_count !== writtenCount || writtenCount !== readCount) failed.push('requested_written_readback_counts');
  if (evidence.read_role !== 'anon' || evidence.db_readback_ok !== true) failed.push('anon_readback_unproven');
  return {...written, ...verdict, contract: 'daytrade_intraday_turnover_verifier_v1',
    scope: 'intraday_turnover_runner_anon_readback', written_count: writtenCount, readback_count: readCount,
    read_role: evidence.read_role || null, db_readback_ok: evidence.db_readback_ok === true,
    failed_checks: failed, first_blocker: failed[0] || null,
    status: failed.length ? 'blocked' : 'complete', complete: failed.length === 0, exit_code: failed.length ? 1 : 0};
}
if (require.main === module) {
  const input = process.argv.find(x => x.startsWith('--input='))?.slice(8);
  const output = process.argv.find(x => x.startsWith('--out='))?.slice(6);
  if (!input || !output) throw new Error('Require --input=DB-readback.json --out=receipt.json');
  const value = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
  const result = { ...verify(value), checked_at: new Date().toISOString(), input_path: path.resolve(input),
    // A file alone does not prove anon access or natural production execution.
    natural_production_readback_verified: false };
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result)); process.exitCode = result.exit_code;
}
module.exports = { verify, verifyDelivery };
