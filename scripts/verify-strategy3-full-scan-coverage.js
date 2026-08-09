"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const RUNS_TABLE = process.env.STRATEGY3_SUPABASE_RUNS_TABLE || "strategy3_scan_runs";
const RESULTS_TABLE = process.env.STRATEGY3_SUPABASE_RESULTS_TABLE || "strategy3_scan_results";
const INTRADAY_1M_TABLE = process.env.STRATEGY3_SUPABASE_1M_TABLE || "fugle_daytrade_intraday_1m";

const args = process.argv.slice(2);
const argValue = (name, fallback = "") => {
  const found = args.find((arg) => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
};

function readSecret(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function secret(name) {
  if (process.env[name]) return process.env[name];
  if (name === "SUPABASE_SERVICE_ROLE_KEY") return readSecret(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"));
  if (name === "SUPABASE_ANON_KEY") return readSecret(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"));
  return "";
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function normalizeDate(value) {
  const text = cleanText(value);
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return "";
}

function taipeiDateFromNow() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function candleMinute(row = {}) {
  const raw = cleanText(row.candle_time || row.time || row.timestamp || row.datetime || "");
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(parsed));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (Number.isInteger(hour) && Number.isInteger(minute)) return hour * 60 + minute;
  }
  const match = raw.match(/(?:T|\s)(\d{2}):(\d{2})(?::\d{2})?/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function symbolOf(row = {}) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return cleanText(row.code || row.symbol || payload.code || payload.symbol || payload.stock_id).replace(/\D/g, "").slice(0, 4);
}

function headers(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    Prefer: "count=exact",
  };
}

async function rest(pathname, key) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    headers: headers(key),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} HTTP ${response.status}: ${text.slice(0, 400)}`);
  return {
    rows: text ? JSON.parse(text) : [],
    count: Number((response.headers.get("content-range") || "").split("/").at(-1)) || null,
  };
}

async function fetchRun({ tradeDate, runId, key }) {
  const query = runId
    ? [
      "select=run_id,strategy,scan_date,status,complete,expected_total,scanned_count,result_count,payload,updated_at",
      `run_id=eq.${encodeURIComponent(runId)}`,
      "limit=1",
    ].join("&")
    : [
      "select=run_id,strategy,scan_date,status,complete,expected_total,scanned_count,result_count,payload,updated_at",
      "strategy=eq.strategy3",
      "status=eq.complete",
      "complete=eq.true",
      `scan_date=eq.${encodeURIComponent(tradeDate)}`,
      "order=updated_at.desc",
      "limit=1",
    ].join("&");
  return (await rest(`${RUNS_TABLE}?${query}`, key)).rows[0] || null;
}

async function fetchResults(runId, key) {
  const query = [
    "select=run_id,strategy,rank,code,name,price,close,score,payload,updated_at",
    `run_id=eq.${encodeURIComponent(runId)}`,
    "strategy=eq.strategy3",
    "order=rank.asc",
    "limit=1000",
  ].join("&");
  return (await rest(`${RESULTS_TABLE}?${query}`, key)).rows;
}

async function fetchEntryCandles(tradeDate, symbols, key) {
  const bySymbol = new Map();
  if (!tradeDate || !symbols.length) return bySymbol;
  for (let index = 0; index < symbols.length; index += 80) {
    const chunk = symbols.slice(index, index + 80);
    const query = [
      "select=symbol,trade_date,candle_time,close,volume,source,source_channel,candle_origin,synthetic,rest_repair_row,websocket_row",
      `trade_date=eq.${encodeURIComponent(tradeDate)}`,
      `symbol=in.(${chunk.map(encodeURIComponent).join(",")})`,
      `candle_time=gte.${encodeURIComponent(`${tradeDate}T04:50:00+00:00`)}`,
      `candle_time=lte.${encodeURIComponent(`${tradeDate}T05:00:59+00:00`)}`,
      "order=candle_time.asc",
      "limit=2000",
    ].join("&");
    const rows = (await rest(`${INTRADAY_1M_TABLE}?${query}`, key)).rows;
    for (const row of rows) {
      const symbol = cleanText(row.symbol);
      const minute = candleMinute(row);
      const close = cleanNumber(row.close);
      if (!symbol || !(close > 0) || minute === null || minute < 12 * 60 + 50 || minute > 13 * 60) continue;
      const current = bySymbol.get(symbol);
      if (!current || minute >= current.minute) bySymbol.set(symbol, { ...row, minute, close });
    }
  }
  return bySymbol;
}

function addIssue(issues, ok, code, detail = {}) {
  if (!ok) issues.push({ code, ...detail });
}

async function main() {
  const serviceKey = secret("SUPABASE_SERVICE_ROLE_KEY") || secret("SUPABASE_ANON_KEY");
  if (!serviceKey) throw new Error("missing Supabase key");

  const tradeDate = normalizeDate(argValue("--trade-date", taipeiDateFromNow()));
  const runId = cleanText(argValue("--run-id", ""));
  const run = await fetchRun({ tradeDate, runId, key: serviceKey });
  if (!run?.run_id) throw new Error(`strategy3 complete run not found for ${runId || tradeDate}`);

  const payload = run.payload && typeof run.payload === "object" ? run.payload : {};
  const selfTest = payload.selfTest || {};
  const scanCoverage = payload.scanCoverage || {};
  const sourceHealth = payload.sourceHealth || {};
  const sourceCoverage = payload.sourceCoverage || {};
  const results = await fetchResults(run.run_id, serviceKey);
  const symbols = [...new Set(results.map(symbolOf).filter(Boolean))];
  const entryMap = await fetchEntryCandles(normalizeDate(run.scan_date || tradeDate), symbols, serviceKey);
  const missingEntrySymbols = symbols.filter((symbol) => !entryMap.has(symbol));
  const sampleEntries = symbols.slice(0, 12).map((symbol) => {
    const row = results.find((item) => symbolOf(item) === symbol) || {};
    const candle = entryMap.get(symbol) || {};
    return {
      symbol,
      name: row.name || row.payload?.name || "",
      rank: cleanNumber(row.rank),
      scanPrice: cleanNumber(row.price || row.payload?.price),
      entryPrice1300: candle.close || null,
      entryCandleTime: candle.candle_time || "",
      entrySource: candle.source || "",
    };
  });

  const expectedTotal = cleanNumber(run.expected_total || payload.expectedTotal || payload.total || selfTest.sourceUniverseCount || scanCoverage.sourceUniverseCount);
  const scannedCount = cleanNumber(run.scanned_count || payload.scannedCount || selfTest.scannedCount || scanCoverage.scannedCount);
  const resultCount = cleanNumber(run.result_count || payload.count || payload.resultCount || selfTest.resultCount);
  const motherPoolSymbols = cleanNumber(scanCoverage.daytradeMotherPoolSymbols || sourceCoverage.rawStatus?.payload?.mother_pool_symbols);
  const resultInMotherPool = cleanNumber(scanCoverage.resultInMotherPool);
  const motherPoolOverlayOk = scanCoverage.daytradeMotherPoolOverlayOk === true;
  const motherPoolScopeOk = resultCount === 0 || (motherPoolOverlayOk && motherPoolSymbols > 0 && resultInMotherPool === resultCount);
  const scanScope = cleanText(scanCoverage.scanScope || payload.scanScope || "");
  const issues = [];

  addIssue(issues, run.status === "complete" && run.complete === true, "strategy3_run_not_complete", { status: run.status, complete: run.complete });
  addIssue(issues, expectedTotal > 0, "strategy3_expected_total_missing", { expectedTotal });
  addIssue(issues, scannedCount === expectedTotal && expectedTotal > 0, "strategy3_scan_not_complete", { scannedCount, expectedTotal });
  addIssue(issues, selfTest.completeScan === true, "strategy3_self_test_complete_scan_false", { completeScan: selfTest.completeScan });
  addIssue(issues, scanCoverage.candidateLimitApplied !== true, "strategy3_candidate_limit_applied", { candidateLimitApplied: scanCoverage.candidateLimitApplied });
  addIssue(issues, results.length === resultCount, "strategy3_result_count_mismatch", { readbackResults: results.length, resultCount });
  addIssue(issues, sourceHealth.status === "ok", "strategy3_source_health_not_ok", { sourceHealthStatus: sourceHealth.status, sourceHealthIssues: sourceHealth.issues || [] });
  addIssue(issues, sourceCoverage.ready === true || sourceCoverage.ok === true, "strategy3_source_coverage_not_ready", { sourceCoverageStatus: sourceCoverage.status, sourceCoverageReason: sourceCoverage.reason });
  addIssue(issues, motherPoolScopeOk, "strategy3_result_not_all_in_daytrade_mother_pool", {
    resultCount,
    resultInMotherPool,
    motherPoolSymbols,
    motherPoolOverlayOk,
  });
  addIssue(issues, resultCount === 0 || scanScope === "daytrade_mother_pool", "strategy3_scan_scope_not_daytrade_mother_pool", {
    scanScope,
    required: "daytrade_mother_pool",
  });
  addIssue(issues, entryMap.size === symbols.length && symbols.length === resultCount, "strategy3_1300_entry_1m_not_full", {
    expectedEntryEvidence: symbols.length,
    foundEntryEvidence: entryMap.size,
    missingEntrySymbols,
  });

  const receipt = {
    ok: issues.length === 0,
    verifier: "verify-strategy3-full-scan-coverage",
    tradeDate: normalizeDate(run.scan_date || tradeDate),
    runId: run.run_id,
    decision: issues.length ? "NO" : "YES",
    first_blocker: issues[0]?.code || "",
    reason_code: issues[0]?.code || "strategy3_full_scan_verified",
    allowed_action: issues.length
      ? (issues[0]?.code === "strategy3_result_not_all_in_daytrade_mother_pool"
        ? "rerun_strategy3_with_daytrade_mother_pool_scope_then_rerun_full_scan_verifier"
        : "repair_missing_1300_intraday_1m_then_rerun_strategy3_full_scan_verifier")
      : "strategy3_full_scan_can_be_accepted",
    fullScan: {
      expectedTotal,
      scannedCount,
      sourceUniverseCount: cleanNumber(selfTest.sourceUniverseCount || scanCoverage.sourceUniverseCount),
      completeScan: selfTest.completeScan === true && scannedCount === expectedTotal && expectedTotal > 0,
      candidateLimitApplied: scanCoverage.candidateLimitApplied === true,
    },
    motherPoolAtRun: {
      source: scanCoverage.daytradeMotherPoolSource || sourceCoverage.rawStatus?.payload?.mother_pool_source || "",
      symbols: motherPoolSymbols,
      overlapWithSourceUniverse: cleanNumber(scanCoverage.daytradeMotherPoolUniverseOverlap),
      resultInMotherPool,
      updatedAt: scanCoverage.daytradeMotherPoolUpdatedAt || sourceCoverage.rawStatus?.payload?.runtime_priority_updated_at || "",
      overlayOk: motherPoolOverlayOk,
      scopeOk: motherPoolScopeOk,
      requiredRule: "resultInMotherPool must equal resultCount for Strategy3 formal publish",
      scanScope,
    },
    funnel: {
      sourceUniverse: cleanNumber(scanCoverage.sourceUniverseCount || selfTest.sourceUniverseCount || expectedTotal),
      scanned: scannedCount,
      sessionReadyCandidates: cleanNumber(scanCoverage.sessionReadyCandidates),
      hardFieldGateCandidates: cleanNumber(scanCoverage.hardFieldGateCandidates || scanCoverage.fieldGateCandidates),
      fixedPassCandidates: cleanNumber(scanCoverage.fixedPassCandidates || scanCoverage.rawFixedPassCandidates),
      tvSourceCompleteCandidates: cleanNumber(scanCoverage.tvSourceCompleteCandidates),
      tvAnalyzedCount: cleanNumber(scanCoverage.tvAnalyzedCount),
      tvPassCount: cleanNumber(scanCoverage.tvPassCount || payload.tvPassCount),
      resultCount,
    },
    entryEvidence1300: {
      expected: symbols.length,
      found: entryMap.size,
      missing: missingEntrySymbols,
      sample: sampleEntries,
      source: INTRADAY_1M_TABLE,
      requiredWindowAsiaTaipei: "12:50-13:00",
    },
    sourceHealth: {
      status: sourceHealth.status || "",
      stockUniverseCount: cleanNumber(sourceHealth.stockUniverseCount),
      intraday1mReadyCount: cleanNumber(sourceHealth.intraday1mReadyCount),
      sideVolumeReadyCount: cleanNumber(sourceHealth.sideVolumeReadyCount),
      latestCandleTime: sourceHealth.latestCandleTime || "",
      issues: sourceHealth.issues || [],
      warnings: sourceHealth.warnings || [],
    },
    issues,
    checkedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.ok) process.exit(2);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message || String(error), verifier: "verify-strategy3-full-scan-coverage" }, null, 2));
  process.exit(1);
});

