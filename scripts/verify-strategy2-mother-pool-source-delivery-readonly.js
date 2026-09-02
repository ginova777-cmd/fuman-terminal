"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATUS_FILE = process.env.FUGLE_WS_STATUS_FILE || path.join(RUNTIME, "state", "fugle-daytrade-websocket-status-v2.json");
const PRIORITY_FILE = process.env.FUGLE_WS_PRIORITY_SYMBOLS_FILE || path.join(RUNTIME, "cache", "intraday", "fugle-daytrade-priority-symbols.json");
const FORMAL_ROOT = "C:/fuman-release-owner/fuman-terminal";
const MIN_CANDLES = 35;
const MIN_COVERAGE = 0.90;
const QUOTE_FRESH_SECONDS = Number(process.env.STRATEGY2_QUOTE_FRESH_SECONDS || 120);
const CANDLE_FRESH_SECONDS = Number(process.env.STRATEGY2_CANDLE_FRESH_SECONDS || 120);

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}
function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return fallback; }
}
function secret(name) {
  if (process.env[name]) return process.env[name];
  for (const file of [path.join(RUNTIME, "secrets", `${name.toLowerCase().replaceAll("_", "-")}.txt`), path.join(FORMAL_ROOT, "secrets", `${name.toLowerCase().replaceAll("_", "-")}.txt`), path.join("C:/fuman-terminal/secrets", `${name.toLowerCase().replaceAll("_", "-")}.txt`)]) {
    try { const value = fs.readFileSync(file, "utf8").trim(); if (value) return value; } catch {}
  }
  return "";
}
function norm(value) { return String(value || "").replace(/[^0-9]/g, "").slice(0, 4); }
function unique(values) { return [...new Set((Array.isArray(values) ? values : []).map((v) => norm(v?.symbol || v?.code || v)).filter((v) => /^\d{4}$/.test(v)))]; }
function ageSeconds(value) { const ms = Date.parse(value || ""); return Number.isFinite(ms) ? Math.max(0, Math.round((Date.now() - ms) / 1000)) : 999999; }
function payload(row) { return row?.payload && typeof row.payload === "object" ? row.payload : {}; }

async function get(base, key, endpoint) {
  const response = await fetch(`${base}/rest/v1/${endpoint}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${endpoint}:HTTP_${response.status}:${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
}

async function rpc(base, key, name, body) {
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`rpc/${name}:HTTP_${response.status}:${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
}
async function main() {
  const tradeDate = arg("trade-date", taipeiDate());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || tradeDate !== taipeiDate()) throw new Error(`trade_date_must_be_today:${tradeDate}`);
  const base = process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || secret("SUPABASE_URL") || "https://cpmpfhbzutkiecccekfr.supabase.co";
  const key = process.env.SUPABASE_ANON_KEY || secret("SUPABASE_ANON_KEY");
  if (!base || !key) throw new Error("missing_supabase_read_credentials");
  const status = readJson(STATUS_FILE, {});
  const priority = readJson(PRIORITY_FILE, {});
  const [poolRows, sourceRows] = await Promise.all([
    get(base, key, "v_fugle_daytrade_mother_pool?select=*&limit=1000"),
    get(base, key, "source_status?source_name=eq.fugle_daytrade_source&select=source_name,trade_date,status,updated_at,payload&limit=1"),
  ]);
  // The Mother Pool hot path already joins today's formal 1m status cache and
  // quote readback. Avoid the all-market health view, which can time out under load.
  const healthRows = poolRows;
  const source = sourceRows[0] || {};
  const sourcePayload = payload(source);
  let canonicalRunId = String(sourcePayload.canonical_run_id || sourcePayload.canonicalRunId || "");
  const sourceTradeDate = String(sourcePayload.trade_date || sourcePayload.tradeDate || source.trade_date || "");
  const deep = poolRows.filter((row) => {
    const p = payload(row);
    return (row.deep_scan_eligible === true || p.deep_scan_eligible === true)
      && (row.base_pool_eligible === true || row.basePoolEligible === true || p.basePoolEligible === true || p.base_pool_eligible === true);
  });
  const members = new Map(deep.map((row) => [norm(row.symbol || row.code), row]).filter(([symbol]) => symbol));
  if (!canonicalRunId) canonicalRunId = String(payload(deep[0]).canonical_run_id || deep[0]?.canonical_run_id || "");
  const candleRows = [];
  const memberSymbols = [...members.keys()];
  if (Math.ceil(memberSymbols.length / 25) > 40) throw new Error("strategy2_pool_exceeds_bounded_rpc_batches");
  for (let offset = 0; offset < memberSymbols.length; offset += 25) {
    candleRows.push(...await rpc(base, key, "get_fugle_daytrade_intraday_1m_latest_n", { symbols: memberSymbols.slice(offset, offset + 25), bars_per_symbol: 500 }));
  }
  const candleStats = new Map();
  for (const item of candleRows) {
    if (String(item.trade_date || "") !== tradeDate || item.synthetic === true) continue;
    const symbol = norm(item.symbol); if (!members.has(symbol)) continue;
    const current = candleStats.get(symbol) || { count: 0, first: "", latest: "", runIds: new Set() };
    const time = String(item.candle_time || ""); current.count += 1;
    if (!current.first || time < current.first) current.first = time;
    if (!current.latest || time > current.latest) current.latest = time;
    const runId = String(payload(item).canonical_run_id || payload(item).run_id || ""); if (runId) current.runIds.add(runId);
    candleStats.set(symbol, current);
  }
  const health = new Map(healthRows.map((row) => [norm(row.symbol), row]).filter(([symbol]) => symbol));
  const candleSet = new Set(unique(status.candleSubscribedSymbolList));
  const tradeSet = new Set(unique(status.tradeSubscribedSymbolList));
  const aggregateSet = new Set(unique(status.aggregateSubscribedSymbolList));
  const manifestStrategy2 = unique(priority.strategy2 || priority.strategy2Symbols);
  const statusExpected = unique(status.strategy2ExpectedSymbols);
  const rows = [...members.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([symbol, member]) => {
    const h = health.get(symbol) || {};
    const p = payload(member);
    const candle = candleStats.get(symbol) || { count: 0, first: "", latest: "", runIds: new Set() };
    const quoteAge = Number(h.quote_age_seconds ?? 999999);
    const stale = ageSeconds(candle.latest);
    const count = candle.count;
    const subscribed = candleSet.has(symbol) && tradeSet.has(symbol) && aggregateSet.has(symbol);
    const quoteAvailable = Boolean(h.quote_seen_at);
    const rowRunId = String(member.canonical_run_id || p.canonical_run_id || canonicalRunId);
    const rowTradeDate = String(member.trade_date || p.trade_date || tradeDate);
    const reasons = [];
    if (!subscribed) reasons.push("WEBSOCKET_NOT_SUBSCRIBED");
    if (!quoteAvailable) reasons.push("QUOTE_MISSING"); else if (quoteAge > QUOTE_FRESH_SECONDS) reasons.push("QUOTE_STALE");
    if (count === 0) reasons.push("NO_1M");
    else {
      if (count < MIN_CANDLES) reasons.push("CANDLE_COUNT_UNDER_35");
      const firstMinute = String(candle.first || "").slice(11, 16);
      if (firstMinute && firstMinute > "09:01") reasons.push("LATE_START");
      if (stale > CANDLE_FRESH_SECONDS) reasons.push("STOPPED");
    }
    if (!canonicalRunId || rowRunId !== canonicalRunId || rowTradeDate !== tradeDate || sourceTradeDate !== tradeDate || [...candle.runIds].some((runId) => runId !== canonicalRunId)) reasons.push("RUN_ID_MISMATCH");
    if (!h.symbol || String(h.trade_date || h.source_trade_date || "") !== tradeDate) reasons.push("STATUS_VIEW_MISMATCH");
    return {
      symbol, strategy2_pool_member: true, base_pool_eligible: true, deep_scan_eligible: true,
      websocket_subscribed: subscribed, quote_available: quoteAvailable, quote_age_seconds: quoteAge,
      today_formal_1m_count: count, first_candle_time: candle.first || null,
      latest_candle_minute: candle.latest || null,
      intraday_1m_stale_seconds: stale, data_gap: reasons.length > 0,
      data_gap_reason: reasons.length ? reasons.join("|") : null,
    };
  });
  const expectedCount = rows.length;
  const readyCount = rows.filter((row) => !row.data_gap).length;
  const coverageRatio = expectedCount ? readyCount / expectedCount : 0;
  const runIdAligned = Boolean(canonicalRunId) && sourceTradeDate === tradeDate && rows.every((row) => !String(row.data_gap_reason || "").includes("RUN_ID_MISMATCH"));
  const actualSubscriptions = {
    candles: Number(status.candleSubscribedSymbols || candleSet.size), trades: Number(status.tradeSubscribedSymbols || tradeSet.size), aggregates: Number(status.aggregateSubscribedSymbols || aggregateSet.size),
    targets: { candles: 1000, trades: 400, aggregates: 400 },
  };
  const subscriptionTargetsMet = actualSubscriptions.candles === 1000 && actualSubscriptions.trades === 400 && actualSubscriptions.aggregates === 400;
  const fixedRetentionOk = manifestStrategy2.length === expectedCount && statusExpected.length === expectedCount && rows.every((row) => row.websocket_subscribed);
  const normalizedFormalRoot = FORMAL_ROOT.toLowerCase();
  const collectorRoot = String(status.collectorProductionRoot || "").replaceAll("\\", "/").toLowerCase();
  const writerRoot = String(sourcePayload.writer_root || sourcePayload.production_root || "").replaceAll("\\", "/").toLowerCase();
  const scannerReceipt = readJson(path.join(RUNTIME, "data", "scan-receipts", "strategy2-v3-live.json"), {});
  const scannerRoot = String(scannerReceipt.productionRoot || scannerReceipt.sourceRoot || scannerReceipt.repository || "").replaceAll("\\", "/").toLowerCase();
  const rootsAligned = collectorRoot === normalizedFormalRoot && writerRoot === normalizedFormalRoot && scannerRoot === normalizedFormalRoot;
  const formalAllowed = expectedCount > 0 && coverageRatio >= MIN_COVERAGE && runIdAligned && subscriptionTargetsMet && fixedRetentionOk && rootsAligned;
  const report = {
    ok: formalAllowed, contract: "strategy2-mother-pool-source-delivery-readonly-v1", checked_at: new Date().toISOString(), trade_date: tradeDate,
    canonical_run_id: canonicalRunId, expected_count: expectedCount, ready_count: readyCount,
    coverage_ratio: Number(coverageRatio.toFixed(4)), required_coverage_ratio: MIN_COVERAGE,
    data_gap_count: expectedCount - readyCount, run_id_aligned: runIdAligned,
    production_root_aligned: rootsAligned, actual_subscriptions: actualSubscriptions,
    subscription_targets_met: subscriptionTargetsMet, strategy2_fixed_retention_ok: fixedRetentionOk,
    morning_report_dependency: false, formal_allowed: formalAllowed, publish_allowed: formalAllowed,
    update_scorecard_88_allowed: formalAllowed, formal_line_allowed: formalAllowed, previous_good_allowed: false,
    first_blocker: formalAllowed ? "" : expectedCount === 0 ? "STRATEGY2_DEEP_SCAN_POOL_EMPTY" : rows.find((row) => row.data_gap)?.data_gap_reason || (!subscriptionTargetsMet ? "ACTUAL_SUBSCRIPTION_TARGET_MISMATCH" : !fixedRetentionOk ? "STRATEGY2_FIXED_RETENTION_MISMATCH" : !rootsAligned ? "PRODUCTION_ROOT_MISMATCH" : coverageRatio < MIN_COVERAGE ? "COVERAGE_BELOW_90_PERCENT" : "CONTRACT_MISMATCH"),
    rows, read_only: true,
    forbidden_actions: ["start_strategy2_scan", "write_supabase", "publish", "update_scorecard_88", "send_formal_line", "use_previous_good"],
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, contract: "strategy2-mother-pool-source-delivery-readonly-v1", error: error.message || String(error), read_only: true }, null, 2) + "\n");
  process.exitCode = 2;
});
