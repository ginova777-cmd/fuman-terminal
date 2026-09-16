const CONTRACT = 'daytrade_intraday_turnover_v1';
const number = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value)) ? Number(value) : null;
const dateOf = value => Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value) + 28800000).toISOString().slice(0, 10) : '';

// Only raw cumulative aggregate fields enter this contract. No capital/10,
// last-trade size, historical turnover or magnitude-based unit inference.
function nativeVolume(data = {}, source) {
  const market = String(data.market || data.exchange || '').toUpperCase();
  return {
    value: number(data.total?.tradeVolume),
    unit: ['TSE', 'TWSE', 'OTC', 'TPEX', 'TIB'].includes(market) ? 'lots' : null,
    event_at: Number.isFinite(Number(data.total?.time)) && Number(data.total?.time) > 0
      ? new Date(Number(data.total.time) / 1000).toISOString() : null,
    source, is_synthetic: false,
  };
}

function evaluateTurnover({ symbol, master = {}, volume = {}, tradeDate, now }) {
  const reasons = [];
  const shares = number(master.official_issued_common_shares);
  const amount = number(volume.value);
  if (master.stock_master_source !== 'MOPS_OPEN_DATA_TWSE_TPEX' || master.official_present !== true) reasons.push('OFFICIAL_MASTER_MISSING');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(master.stock_master_source_date || '') || master.stock_master_source_date > tradeDate
    || dateOf(master.stock_master_synced_at) !== tradeDate || Date.parse(master.stock_master_synced_at) > Date.parse(now)) reasons.push('MASTER_DATE_NOT_CURRENT');
  if (!(shares > 0)) reasons.push('ISSUED_COMMON_SHARES_INVALID');
  if (amount === null || amount < 0) reasons.push('CUMULATIVE_VOLUME_INVALID');
  if (!['lots', 'shares'].includes(volume.unit)) reasons.push('VOLUME_UNIT_INVALID');
  if (volume.is_synthetic !== false || !volume.source) reasons.push('NATURAL_VOLUME_UNPROVEN');
  const age = (Date.parse(now) - Date.parse(volume.event_at)) / 1000;
  if (dateOf(volume.event_at) !== tradeDate || !Number.isFinite(age) || age < 0 || age > 120) reasons.push('VOLUME_EVENT_NOT_FRESH_SAME_DAY');
  const volumeShares = amount === null ? null : amount * (volume.unit === 'lots' ? 1000 : 1);
  return { symbol, trade_date: tradeDate, status: reasons.length ? 'DATA_GAP' : 'ready', reasons,
    turnover_pct: reasons.length ? null : volumeShares / shares * 100,
    cumulative_volume: amount, volume_unit: volume.unit || null, cumulative_volume_shares: ['lots', 'shares'].includes(volume.unit) ? volumeShares : null,
    volume_source: volume.source || null, volume_event_at: volume.event_at || null, volume_age_seconds: Number.isFinite(age) ? age : null,
    issued_common_shares: shares, shares_source: master.stock_master_source || null, shares_source_date: master.stock_master_source_date || null,
    shares_synced_at: master.stock_master_synced_at || null,
    stock_master_run_id: master.stock_master_run_id || null, is_synthetic: volume.is_synthetic ?? null };
}

function typedCollectorVolume(row = {}) {
  return { value: row.totalVolumeAvailable === true ? number(row.tradeVolume) : null,
    unit: row.totalVolumeUnit || null, event_at: row.totalVolumeSourceEventAt || null,
    is_synthetic: row.isSynthetic ?? null, source: 'fugle.collector.typed_cumulative_volume' };
}

function rankTurnover(rows, { tradeDate, canonicalRunId, now }) {
  const ready = rows.filter(row => row.status === 'ready').sort((a, b) => b.turnover_pct - a.turnover_pct || a.symbol.localeCompare(b.symbol));
  return { contract: CONTRACT, trade_date: tradeDate, canonical_run_id: canonicalRunId, calculated_at: now,
    run_id: `intraday-turnover:${tradeDate}:${now}`,
    scope: 'active_common_stock_universe', formula: 'cumulative_volume_shares / issued_common_shares * 100',
    requested_count: rows.length, ready_count: ready.length, data_gap_count: rows.length - ready.length,
    rows: ready.map((row, index) => ({ ...row, rank: index + 1 })),
    gaps: rows.filter(row => row.status !== 'ready'), creates_formal_candidate: false };
}
module.exports = { CONTRACT, nativeVolume, typedCollectorVolume, evaluateTurnover, rankTurnover };
