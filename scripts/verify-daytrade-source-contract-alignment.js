const fs = require("fs");
const path = require("path");

const PROJECT_URL = process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co";
const SOURCE_NAME = process.env.DAYTRADE_SOURCE_NAME || "fugle_daytrade_source";

function readTextSecret(paths) {
  for (const file of paths) {
    try {
      if (!fs.existsSync(file)) continue;
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {
      // optional secret path
    }
  }
  return "";
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function boolValue(value) {
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|ok|ready)$/i.test(String(value || "").trim());
}

function firstObject(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

async function restGet(anonKey, pathAndQuery) {
  const url = `${PROJECT_URL.replace(/\/$/, "")}/rest/v1/${pathAndQuery}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`GET ${pathAndQuery} HTTP ${response.status}: ${text.slice(0, 240)}`);
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

function normalizeSourceStatus(row) {
  const payload = row?.payload || {};
  return {
    status: stringValue(row?.status),
    message: stringValue(row?.message),
    updatedAt: stringValue(row?.updated_at),
    daytradeGateGrade: stringValue(payload.daytrade_gate_grade),
    priorityFreshQuotes120s: numberValue(payload.priority_fresh_quotes_120s),
    priorityPoolSymbols: numberValue(payload.priority_pool_symbols),
    priorityFreshQuoteCoverage120s: numberValue(payload.priority_fresh_quote_coverage_120s),
    quoteAgeSeconds: numberValue(payload.quote_age_seconds, 999999),
    formalEntryAllowed: boolValue(payload.formal_entry_allowed),
    scannerCanRunQuoteOnly: boolValue(payload.scanner_can_run_quote_only),
    scannerCanRunOpening: boolValue(payload.scanner_can_run_opening),
    rateLimitStatus: stringValue(payload.rate_limit_status),
    readyMa20Continuous: numberValue(payload.ready_ma20_continuous),
    readyMa35Continuous: numberValue(payload.ready_ma35_continuous),
  };
}

function normalizeGate(row) {
  return {
    gateGrade: stringValue(row?.canonical_gate_grade || row?.daytrade_gate_grade || row?.gate_grade || row?.gate),
    gateStatus: stringValue(row?.canonical_gate_status || row?.gate_status || row?.status),
    reason: stringValue(row?.reason || row?.canonical_reason || row?.scanner_block_reason),
    priorityFreshQuoteCoverage120s: numberValue(row?.priority_fresh_quote_coverage_120s),
    quoteAgeSeconds: numberValue(row?.quote_age_seconds, 999999),
    freshQuotes120s: numberValue(row?.fresh_quotes_120s),
    scorecardRequiredOkCount: numberValue(row?.scorecard_required_ok_count),
    scorecardRequiredCount: numberValue(row?.scorecard_required_count),
    formalEntrySpeedVerdict: stringValue(row?.formal_entry_speed_verdict),
    readyMa20Continuous: numberValue(row?.ready_ma20_continuous_symbols ?? row?.ready_ma20_continuous),
    readyMa35Continuous: numberValue(row?.ready_ma35_continuous_symbols ?? row?.ready_ma35_continuous),
  };
}

function isSourceA(source) {
  return source.status === "ok"
    && source.daytradeGateGrade === "A"
    && source.priorityFreshQuoteCoverage120s >= 0.95
    && source.quoteAgeSeconds <= 90
    && source.formalEntryAllowed === true
    && source.scannerCanRunQuoteOnly === true
    && source.scannerCanRunOpening === true
    && source.rateLimitStatus !== "rate_limited";
}

function isSourceOffSessionFailClosed(source) {
  const message = `${source.status} ${source.message}`.toLowerCase();
  return ["ok", "stopped", "not_ready"].includes(source.status)
    && message.includes("off-session")
    && source.daytradeGateGrade === "A"
    && source.priorityFreshQuoteCoverage120s >= 0.95
    && source.quoteAgeSeconds <= 90
    && source.formalEntryAllowed === false
    && source.scannerCanRunQuoteOnly === true
    && source.scannerCanRunOpening === true
    && source.rateLimitStatus !== "rate_limited";
}

function isGateA(gate) {
  return gate.gateGrade === "A"
    && ["ready", "ok", "yes", ""].includes(gate.gateStatus.toLowerCase())
    && gate.priorityFreshQuoteCoverage120s >= 0.95
    && gate.quoteAgeSeconds <= 90
    && gate.formalEntrySpeedVerdict === "YES";
}

function isGateFailClosed(gate) {
  return gate.gateGrade !== "A"
    && gate.gateStatus === "not_ready"
    && ["off_session_not_formal_entry", "formal_entry_not_allowed", "source_status_not_ok"].includes(gate.reason)
    && gate.formalEntrySpeedVerdict === "NO";
}

function gateVerdict(source, canonicalGate, unattendedGate) {
  const sourceA = isSourceA(source);
  const sourceOffSession = isSourceOffSessionFailClosed(source);
  const canonicalA = isGateA(canonicalGate);
  const unattendedA = isGateA(unattendedGate);
  const canonicalClosed = isGateFailClosed(canonicalGate);
  const unattendedClosed = isGateFailClosed(unattendedGate);
  if (sourceA && canonicalA && unattendedA) return { ok: true, verdict: "A_READY_ALIGNED", mode: "formal_ready", issues: [] };
  if (sourceOffSession && canonicalClosed && unattendedClosed) return { ok: true, verdict: "OFF_SESSION_FAIL_CLOSED_ALIGNED", mode: "off_session_fail_closed", issues: [] };
  const issues = [];
  if (!sourceA && !sourceOffSession) issues.push("source_status_not_a_or_off_session_fail_closed");
  if (!canonicalA && !canonicalClosed) issues.push("canonical_gate_not_a_or_fail_closed");
  if (!unattendedA && !unattendedClosed) issues.push("unattended_gate_not_a_or_fail_closed");
  return { ok: false, verdict: "NOT_ALIGNED", mode: "mismatch", issues };
}

async function main() {
  const anonKey = process.env.SUPABASE_ANON_KEY || readTextSecret([
    path.join("C:", "fuman-runtime", "secrets", "supabase-anon-key.txt"),
    path.join(__dirname, "..", "secrets", "supabase-anon-key.txt"),
  ]);
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY is required.");

  const [sourceRows, canonicalRows, unattendedRows] = await Promise.all([
    restGet(anonKey, `source_status?source_name=eq.${encodeURIComponent(SOURCE_NAME)}&select=source_name,status,updated_at,message,payload&limit=1`),
    restGet(anonKey, "v_fugle_daytrade_canonical_gate?select=*&limit=1"),
    restGet(anonKey, "v_fugle_daytrade_unattended_gate_status?select=*&limit=1"),
  ]);

  const sourceStatus = normalizeSourceStatus(firstObject(sourceRows));
  const canonicalGate = normalizeGate(firstObject(canonicalRows));
  const unattendedGate = normalizeGate(firstObject(unattendedRows));
  const alignment = gateVerdict(sourceStatus, canonicalGate, unattendedGate);
  const issues = [...alignment.issues];
  if (Math.abs(sourceStatus.priorityFreshQuoteCoverage120s - canonicalGate.priorityFreshQuoteCoverage120s) > 0.05) issues.push("source_vs_canonical_priority_coverage_mismatch");
  if (Math.abs(sourceStatus.priorityFreshQuoteCoverage120s - unattendedGate.priorityFreshQuoteCoverage120s) > 0.05) issues.push("source_vs_unattended_priority_coverage_mismatch");

  const result = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    sourceName: SOURCE_NAME,
    sourceStatus,
    canonicalGate,
    unattendedGate,
    issues,
    mode: alignment.mode,
    verdict: alignment.verdict,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`[daytrade-source-contract-alignment] ${error.message}`);
  process.exitCode = 2;
});
