'use strict';

// 開盤多盤前篩選 V1
// 水源欄位：strategy4_daily_ohlcv_view
// symbol,name,trade_date,open,high,low,close,volume_lots,volume_shares,source,updated_at

const fs = require('fs');

const arg = (name, fallback = undefined) =>
  process.argv.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

function populationStd(values, average) {
  if (!values.length || !Number.isFinite(average)) return null;
  return Math.sqrt(mean(values.map((x) => (x - average) ** 2)));
}

function normalizeRows(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.rows;
  if (!Array.isArray(rows)) throw new Error('INPUT_MUST_BE_ARRAY_OR_OBJECT_ROWS');
  return rows.map((row) => ({
    symbol: String(row.symbol ?? row.code ?? '').trim(),
    name: String(row.name ?? '').trim(),
    trade_date: String(row.trade_date ?? row.date ?? '').slice(0, 10),
    open: finite(row.open),
    high: finite(row.high),
    low: finite(row.low),
    close: finite(row.close),
    volume_lots: finite(row.volume_lots ?? row.volume),
    volume_shares: finite(row.volume_shares),
    source: String(row.source ?? 'strategy4_daily_ohlcv_view'),
    updated_at: row.updated_at ?? null,
  })).filter((row) => /^\d{4}$/.test(row.symbol) && /^\d{4}-\d{2}-\d{2}$/.test(row.trade_date));
}

async function readLiveRows(requestedDate) {
  const keylib = require('C:/fuman-release-owner/fuman-terminal/lib/server-supabase-key');
  const url = keylib.terminalSupabaseUrl();
  const key = keylib.terminalSupabaseKey();
  const start = new Date(`${requestedDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 120);
  const startDate = start.toISOString().slice(0, 10);
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const query = new URLSearchParams({
      select: 'symbol,name,trade_date,open,high,low,close,volume_lots,volume_shares,source,updated_at',
      trade_date: `gte.${startDate}`,
      order: 'symbol.asc,trade_date.asc',
      limit: '1000',
      offset: String(offset),
    });
    const response = await fetch(`${url}/rest/v1/strategy4_daily_ohlcv_view?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`DAILY_SOURCE_HTTP_${response.status}`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('DAILY_SOURCE_INVALID_ROWS');
    rows.push(...page.filter((row) => String(row.trade_date ?? '') <= requestedDate));
    if (page.length < 1000) break;
  }
  if (!rows.length) throw new Error('DAILY_SOURCE_EMPTY');
  return rows;
}

function readTelegramEvidence(date) {
  const file = `C:/fuman-runtime/data/scan-receipts/daytrade-intraday-burst-telegram-${date.replaceAll('-', '')}.json`;
  try {
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    const valid = body?.trade_date === date && body?.complete === true;
    const events = Array.isArray(body?.sent_events) ? body.sent_events : [];
    const sent = new Set(events.filter((event) => /volume_burst|瞬間巨量|盤中巨量/.test(`${event.trigger_type ?? ''} ${event.notification_type ?? ''}`)).map((event) => String(event.symbol ?? '')));
    return { file, status: valid ? 'READY' : 'UNKNOWN', sent };
  } catch {
    return { file, status: 'UNKNOWN', sent: new Set() };
  }
}

async function readTopBuyBranch(symbol, date) {
  try {
    const token = process.env.FINMIND_TOKEN || fs.readFileSync('C:/fuman-runtime/secrets/finmind-token.txt', 'utf8').trim();
    const query = new URLSearchParams({ dataset: 'TaiwanStockTradingDailyReport', data_id: symbol, start_date: date, end_date: date });
    const response = await fetch(`https://api.finmindtrade.com/api/v4/data?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    const body = await response.json();
    if (!response.ok || body.status !== 200 || !Array.isArray(body.data)) throw new Error(`FINMIND_BRANCH_HTTP_${response.status}`);
    const byBranch = new Map();
    for (const item of body.data) {
      if (item.date !== date || String(item.stock_id) !== symbol) continue;
      const buy = finite(item.buy), sell = finite(item.sell), price = finite(item.price);
      if (!item.securities_trader_id || buy === null || sell === null || price === null || buy <= sell) continue;
      const current = byBranch.get(item.securities_trader_id) ?? { name: item.securities_trader, buy: 0, sell: 0, amount: 0 };
      current.buy += buy; current.sell += sell; current.amount += buy * price;
      byBranch.set(item.securities_trader_id, current);
    }
    const top = [...byBranch.values()].sort((a, b) => (b.buy - b.sell) - (a.buy - a.sell))[0];
    if (!top) return { status: 'UNKNOWN', source: 'FinMind:TaiwanStockTradingDailyReport' };
    return { status: 'READY', source: 'FinMind:TaiwanStockTradingDailyReport', name: top.name, buy_lots: top.buy, sell_lots: top.sell, net_buy_lots: top.buy - top.sell, buy_cost: top.amount / top.buy, cost_method: 'buy_volume_weighted_average', trade_date: date };
  } catch (error) {
    return { status: 'UNKNOWN', source: 'FinMind:TaiwanStockTradingDailyReport', reason: error.message };
  }
}

function evaluateSymbol(bars, requestedDate, config) {
  const ordered = bars
    .filter((x) => x.trade_date <= requestedDate && Number.isFinite(x.close))
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const latest = ordered.at(-1);
  if (!latest) return { status: 'DATA_GAP', reason: 'NO_DAILY_CLOSE' };
  if (latest.trade_date !== requestedDate) {
    return { symbol: latest.symbol, name: latest.name, date: latest.trade_date, status: 'DATA_GAP', reason: `STALE_LATEST_DATE_EXPECTED_${requestedDate}` };
  }

  const closes = ordered.map((x) => x.close);
  const date = latest.trade_date;
  const latest20 = closes.slice(-20);
  const previous20 = closes.slice(-21, -1);
  const enough = latest20.length >= 20 && previous20.length >= 20;
  if (!enough) return { symbol: latest.symbol, name: latest.name, date, status: 'DATA_GAP', reason: 'HISTORY_LT_21' };

  const ma20 = mean(latest20);
  const previousMa20 = mean(previous20);
  const slopeRaw = previousMa20 > 0 ? (ma20 / previousMa20 - 1) * 100 : null;
  const std20 = populationStd(latest20, ma20);
  const upper = std20 === null ? null : ma20 + 2 * std20;
  const lower = std20 === null ? null : ma20 - 2 * std20;
  const bollRaw = std20 > 0 ? 10 * (latest.close - ma20) / (2 * std20) : null;
  const volumeLots = latest.volume_lots;

  const row = {
    symbol: latest.symbol,
    name: latest.name,
    date,
    close: latest.close,
    open: latest.open,
    high: latest.high,
    low: latest.low,
    volume_lots: volumeLots,
    source: latest.source,
    source_updated_at: latest.updated_at,
    history_count: ordered.length,
    ma20_today: ma20,
    ma20_yesterday: previousMa20,
    month_slope_raw: slopeRaw,
    month_slope_display: slopeRaw === null ? null : Number(slopeRaw.toFixed(1)),
    month_slope_zone: slopeZone(slopeRaw, config),
    std20,
    boll_upper: upper,
    boll_middle: ma20,
    boll_lower: lower,
    boll_level_raw: bollRaw,
    boll_level_display: bollRaw === null ? null : Number(bollRaw.toFixed(2)),
    boll_position_zone: positionZone(bollRaw, config),
  };

  const volumePass = volumeLots !== null ? volumeLots > config.volumeLotsExclusive : null;
  const corePass = slopeRaw !== null && bollRaw !== null &&
    slopeRaw >= config.coreSlopeMin &&
    bollRaw >= config.coreBollMin && bollRaw <= config.coreBollMax;

  row.open_long_core_pass = volumePass === true && corePass;
  row.open_long_grade = grade(slopeRaw, bollRaw, config);
  row.open_long_reason = reason(row, volumePass, corePass, config);
  row.open_long_reject_reason = rejectReason(row, volumePass, corePass, config);
  row.source_contract = {
    table: 'strategy4_daily_ohlcv_view',
    price_fields: ['open', 'high', 'low', 'close'],
    volume_field: 'volume_lots',
    date_field: 'trade_date',
    calculation_price: 'close',
    stddev: 'population',
  };
  return row;
}

function slopeZone(value, c) {
  if (value === null) return 'UNKNOWN';
  if (value >= c.strongSlopeMin) return 'STRONG';
  if (value >= c.bullSlopeMin) return 'BULLISH';
  if (value >= c.watchSlopeMin) return 'FLAT_WATCH';
  if (value <= c.rejectSlopeMax) return 'BEARISH_REJECT';
  return 'BEARISH_UNCLASSIFIED';
}

function positionZone(value, c) {
  if (value === null) return 'UNKNOWN';
  if (value < c.coreBollMin) return 'DEEP_PULLBACK_OR_OVERSOLD';
  if (value < 0) return 'BELOW_MA20_PULLBACK';
  if (value <= c.coreBollMax) return 'ABOVE_MA20_NEAR';
  return 'TOO_FAR_ABOVE_MA20';
}

function grade(slope, boll, c) {
  if (slope === null || boll === null) return 'NONE';
  if (slope >= c.aPlusSlopeMin && boll >= 0 && boll <= c.coreBollMax) return 'A_PLUS';
  if (slope >= c.coreSlopeMin && boll >= 0 && boll <= c.coreBollMax) return 'A';
  if (slope >= c.coreSlopeMin && boll >= c.coreBollMin && boll < 0) return 'A';
  if (slope >= c.watchSlopeMin && slope < c.coreSlopeMin && boll >= c.coreBollMin && boll <= c.coreBollMax) return 'WATCH';
  return 'NONE';
}

function reason(row, volumePass, corePass, c) {
  if (row.open_long_core_pass) return `${row.open_long_grade}: MONTH_SLOPE>=${c.coreSlopeMin}, BOLL_LEVEL in [${c.coreBollMin},${c.coreBollMax}], volume>${c.volumeLotsExclusive} lots`;
  const missing = [];
  if (volumePass === null) missing.push('volume_lots');
  if (row.month_slope_raw === null) missing.push('month_slope');
  if (row.boll_level_raw === null) missing.push('boll_level');
  return missing.length ? `DATA_GAP: ${missing.join(',')}` : `NOT_CORE: grade=${row.open_long_grade}`;
}

function rejectReason(row, volumePass, corePass, c) {
  if (row.open_long_core_pass) return null;
  if (volumePass === false) return `VOLUME_NOT_OVER_${c.volumeLotsExclusive}_LOTS`;
  if (row.month_slope_raw !== null && row.month_slope_raw <= c.rejectSlopeMax) return 'MA20_SLOPE_TOO_BEARISH';
  if (row.boll_level_raw !== null && row.boll_level_raw < c.coreBollMin) return 'BELOW_CORE_ZONE_OVERSOLD_OR_DEEP_PULLBACK';
  if (row.boll_level_raw !== null && row.boll_level_raw > c.coreBollMax) return 'TOO_FAR_ABOVE_MA20';
  return null;
}

const CONFIG = Object.freeze({
  volumeLotsExclusive: 2000,
  strongSlopeMin: 0.5,
  bullSlopeMin: 0.1,
  watchSlopeMin: -0.1,
  coreSlopeMin: 0,
  rejectSlopeMax: -0.3,
  coreBollMin: -5,
  coreBollMax: 3,
  aPlusSlopeMin: 0.3,
});

async function main() {
  const input = arg('input');
  const output = arg('output', 'opening-long-v1-report.json');
  const requestedDate = arg('date', new Date().toISOString().slice(0, 10));
  const rows = input
    ? normalizeRows(JSON.parse(fs.readFileSync(input, 'utf8')))
    : normalizeRows(await readLiveRows(requestedDate));
  const actualDate = [...new Set(rows.map((x) => x.trade_date).filter((x) => x <= requestedDate))].sort().at(-1);
  if (!actualDate) throw new Error('NO_AVAILABLE_TRADE_DATE');

  const bySymbol = new Map();
  for (const row of rows) {
    const list = bySymbol.get(row.symbol) ?? [];
    list.push(row);
    bySymbol.set(row.symbol, list);
  }

  const evaluated = [...bySymbol.values()].map((bars) => evaluateSymbol(bars, actualDate, CONFIG));
  const candidates = evaluated
    .filter((x) => x.open_long_core_pass === true)
    .sort((a, b) => gradeRank(b.open_long_grade) - gradeRank(a.open_long_grade) || b.month_slope_raw - a.month_slope_raw || b.boll_level_raw - a.boll_level_raw || a.symbol.localeCompare(b.symbol));

  const telegram = readTelegramEvidence(actualDate);
  let cursor = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (cursor < candidates.length) {
      const row = candidates[cursor++];
      row.telegram_intraday_volume = {
        source: telegram.file,
        status: telegram.status === 'READY' ? (telegram.sent.has(row.symbol) ? 'SENT' : 'NO_SENT_BURST') : 'UNKNOWN',
        bonus: telegram.status === 'READY' && telegram.sent.has(row.symbol) ? 1 : 0,
      };
      row.buy_top_branch_cost = await readTopBuyBranch(row.symbol, actualDate);
    }
  }));

  const report = {
    contract: 'opening-long-premarket-v1',
    requested_date: requestedDate,
    trade_date: actualDate,
    complete: true,
    source_contract: 'strategy4_daily_ohlcv_view',
    config: CONFIG,
    counts: {
      scanned: evaluated.length,
      core_pass: candidates.length,
      a_plus: candidates.filter((x) => x.open_long_grade === 'A_PLUS').length,
      a: candidates.filter((x) => x.open_long_grade === 'A').length,
      watch: evaluated.filter((x) => x.open_long_grade === 'WATCH').length,
      none: evaluated.filter((x) => x.open_long_grade === 'NONE').length,
      data_gap: evaluated.filter((x) => x.status === 'DATA_GAP').length,
    },
    candidates,
    rows: evaluated,
    safety: {
      premarket_only: true,
      auto_order: false,
      opening_gap_skip_rule: 'abs(open/previous_close-1)>=5%; requires next-day previous_close input',
      bollinger_touch_is_intraday_confirmation: true,
      oversold_reversal_separate_strategy: true,
      telegram_intraday_volume: 'required_display_and_plus_one_bonus; missing does not block core pass',
      buy_top_branch_cost: 'required_display_only; missing is UNKNOWN and never inferred',
    },
  };

  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, trade_date: actualDate, counts: report.counts, source: input || 'live:strategy4_daily_ohlcv_view' }));
}

function gradeRank(value) {
  return value === 'A_PLUS' ? 3 : value === 'A' ? 2 : value === 'WATCH' ? 1 : 0;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
