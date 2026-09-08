"use strict";

const fs = require("fs");
const path = require("path");
const {
  normalizeFugleAggregate,
  normalizeFugleTrade,
  mergeFugleQuoteState,
} = require("../lib/fugle-websocket-quotes");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = (process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const REQUIRED_SLOTS = ["0845", "0850", "0855", "0859"];
const CONTRACT = "star_preopen_trial_history_canonical_verifier_v1";

function readText(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function payloadOf(row) {
  if (row?.payload && typeof row.payload === "object") return row.payload;
  try { return JSON.parse(String(row?.payload || "{}")); } catch { return {}; }
}

function add(checks, code, ok, detail = null) {
  checks.push({ code, ok: Boolean(ok), detail });
}

function staticChecks() {
  const checks = [];
  const trialMicros = 1788828300000000;
  const aggregate = normalizeFugleAggregate({ data: {
    symbol: "2337",
    referencePrice: 120,
    lastTrial: { price: 126, time: trialMicros },
    bids: [{ price: 126, size: 800 }],
    asks: [{ price: 126.5, size: 300 }],
    isTrial: true,
    isLimitUpBid: true,
    lastUpdated: trialMicros,
  } });
  const postOpenAggregate = normalizeFugleAggregate({ data: {
    symbol: "2337",
    referencePrice: 120,
    closePrice: 127,
    lastTrial: { price: 126, time: trialMicros },
    lastUpdated: trialMicros + 60_000_000,
  } });
  const trialTrade = normalizeFugleTrade({ data: {
    symbol: "2337",
    price: 126.5,
    bid: 126,
    ask: 126.5,
    isTrial: true,
    time: trialMicros + 1_000_000,
  } });
  const merged = mergeFugleQuoteState(aggregate, trialTrade);
  add(checks, "aggregate_trial_price", aggregate?.trialPrice === 126, aggregate);
  add(checks, "aggregate_explicit_is_trial", aggregate?.isTrial === true, aggregate?.isTrial);
  add(checks, "last_trial_does_not_imply_postopen_trial", postOpenAggregate?.isTrial === false, postOpenAggregate?.isTrial);
  add(checks, "trial_event_time_preserved", Boolean(aggregate?.trialEventAt), aggregate?.trialEventAt);
  add(checks, "trial_trade_semantics", trialTrade?.isTrial === true && trialTrade?.trialPrice === 126.5 && Boolean(trialTrade?.trialEventAt), trialTrade);
  add(checks, "sparse_trade_preserves_aggregate_context",
    merged?.referencePrice === 120
      && merged?.bidLevels?.[0]?.size === 800
      && merged?.askLevels?.[0]?.size === 300
      && merged?.bidSize === 800
      && merged?.askSize === 300
      && merged?.isLimitUpBid === true
      && merged?.trialPrice === 126.5
      && merged?.isTrial === true,
    merged);

  const writer = readText(path.join(ROOT, "scripts", "run-daytrade-source-writer.js"));
  const nearOne = readText(path.join(ROOT, "scripts", "run-daytrade-near-one-source.js"));
  const collector = readText(path.join(ROOT, "scripts", "fugle-websocket-collector.js"));
  add(checks, "collector_uses_field_aware_merge", collector.includes("mergeFugleQuoteState(previous, quote)"));
  add(checks, "history_uses_trial_event_time", writer.includes("const observedAt = trialEventAt || normalizeTimestamp"));
  add(checks, "history_run_identity", writer.includes("run_id: `${PREOPEN_WRITER_CONTRACT}:${tradeDate.replace(/-/g, \"\")}`"));
  add(checks, "history_generation_identity", writer.includes("generation_id: `${symbol}:${observedAt}`"));
  add(checks, "preopen_window_excludes_0900", writer.includes("minutes >= PREOPEN_CAPTURE_END_MINUTES"));
  add(checks, "future_snapshot_run_identity", nearOne.includes("run_id: `daytrade_futopt_preopen:${tradeDate.replace(/-/g, \"\")}`"));
  add(checks, "future_snapshot_trial_event_time", nearOne.includes("trial_event_at: trial?.trial_event_at || null"));
  return checks;
}

async function readAnon(resource, filters, key) {
  const params = new URLSearchParams({ select: "*", ...filters, limit: "5000" });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}?${params}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${resource}_HTTP_${response.status}:${body.slice(0, 240)}`);
  return { resource, status: response.status, rows: body ? JSON.parse(body) : [] };
}

async function liveChecks(tradeDate, symbols, checks) {
  const key = process.env.SUPABASE_ANON_KEY
    || process.env.FUMAN_SUPABASE_ANON_KEY
    || readText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt")).trim();
  if (!key) {
    add(checks, "anon_key_available", false, "missing_supabase_anon_key");
    return { sources: {}, cases: [] };
  }
  const symbolFilter = `in.(${symbols.join(",")})`;
  const [snapshots, history] = await Promise.all([
    readAnon("v_fugle_daytrade_preopen_snapshot_contract", {
      trade_date: `eq.${tradeDate}`, underlying_symbol: symbolFilter,
    }, key),
    readAnon("v_fugle_preopen_snapshot_history", {
      trade_date: `eq.${tradeDate}`, symbol: symbolFilter,
    }, key),
  ]);
  add(checks, "anon_snapshot_http_200", snapshots.status === 200, snapshots.status);
  add(checks, "anon_history_http_200", history.status === 200, history.status);
  const cases = symbols.map((symbol) => {
    const rows = snapshots.rows.filter((row) => String(row.underlying_symbol || "") === symbol);
    const historyRows = history.rows.filter((row) => String(row.symbol || "") === symbol);
    const slots = [...new Set(rows.map((row) => String(row.capture_slot || "")))].sort();
    const missingSlots = REQUIRED_SLOTS.filter((slot) => !slots.includes(slot));
    const incompleteRows = rows.filter((row) => {
      const payload = payloadOf(row);
      return !(row.natural_schedule_evidence === true
        && number(row.fut_price) > 0
        && number(row.trial_price) > 0
        && number(payload.reference_price) > 0
        && number(row.best_bid) > 0
        && payload.trial_event_at
        && payload.run_id
        && payload.generation_id);
    });
    const usableHistoryRows = historyRows.filter((row) => {
      const payload = payloadOf(row);
      return number(row.trial_price) > 0
        && number(row.reference_price) > 0
        && row.is_trial === true
        && payload.writer_contract === "preopen_snapshot_history_v2"
        && payload.trial_event_at
        && payload.run_id
        && payload.generation_id;
    });
    add(checks, `${symbol}_required_natural_slots`, missingSlots.length === 0, missingSlots);
    add(checks, `${symbol}_snapshot_contract_complete`, rows.length >= REQUIRED_SLOTS.length && incompleteRows.length === 0, incompleteRows.length);
    add(checks, `${symbol}_trial_history_present`, usableHistoryRows.length > 0, { total: historyRows.length, usable: usableHistoryRows.length });
    return {
      symbol,
      slots,
      missing_slots: missingSlots,
      snapshot_rows: rows.length,
      snapshot_incomplete_rows: incompleteRows.length,
      history_rows: historyRows.length,
      usable_history_rows: usableHistoryRows.length,
    };
  });
  return {
    sources: {
      [snapshots.resource]: { http_status: snapshots.status, row_count: snapshots.rows.length },
      [history.resource]: { http_status: history.status, row_count: history.rows.length },
    },
    cases,
  };
}

async function main() {
  const live = process.argv.includes("--live");
  const writeReceipt = process.argv.includes("--write-receipt");
  const tradeDate = arg("trade-date", taipeiDate());
  const symbols = [...new Set(arg("symbols", "2337,2344").split(/[,+]/).map((value) => value.replace(/\D/g, "").slice(0, 4)).filter((value) => /^\d{4}$/.test(value)))];
  const checks = staticChecks();
  let liveEvidence = { sources: {}, cases: [] };
  if (live) {
    try { liveEvidence = await liveChecks(tradeDate, symbols, checks); }
    catch (error) { add(checks, "live_readback", false, error.message); }
  }
  const failed = checks.filter((check) => !check.ok);
  const complete = live && failed.length === 0;
  const receipt = {
    contract: CONTRACT,
    mode: live ? "live_anon_read_only" : "static_contract",
    status: failed.length ? "failed" : complete ? "complete" : "pass",
    ok: failed.length === 0,
    complete,
    trade_date: tradeDate,
    checked_at: new Date().toISOString(),
    required_slots: REQUIRED_SLOTS,
    symbols,
    live_evidence: liveEvidence,
    checks,
    failed_checks: failed.map((check) => check.code),
    first_blocker: failed[0]?.code || null,
    writes_supabase: false,
    calls_fugle: false,
    sends_telegram: false,
    uses_0900_data: false,
  };
  if (writeReceipt) {
    const compact = tradeDate.replace(/-/g, "");
    const receiptPath = path.resolve(arg("receipt", path.join(RUNTIME_DIR, "data", "scan-receipts", `star-preopen-trial-history-canonical-receipt-${compact}.json`)));
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    receipt.receipt_path = receiptPath;
  }
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.ok || (live && !receipt.complete)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ contract: CONTRACT, status: "failed", ok: false, complete: false, first_blocker: error.message }, null, 2));
  process.exitCode = 1;
});
