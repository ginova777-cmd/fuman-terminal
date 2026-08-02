"use strict";

// Formal daytrade source adapter. The old shared-source monitor is preserved
// as check-strategy2-shared-source-diagnostic.js and is never authoritative.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATE_DIR = path.join(RUNTIME_DIR, "state");
const OUT_FILE = process.env.STRATEGY2_SUPABASE_COVERAGE_FILE || path.join(STATE_DIR, "strategy2-supabase-coverage.json");
const LOG_DIR = path.join(RUNTIME_DIR, "logs");
const VERIFY_SCRIPT = path.join(ROOT, "scripts", "verify-daytrade-source-contract-alignment.js");

function taipeiNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date()).map((item) => [item.type, item.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function taipeiMinuteOfDay() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date()).map((item) => [item.type, item.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function cleanNumber(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : fallback;
}

function parseJson(text) {
  try { return JSON.parse(String(text || "")); } catch { return null; }
}

function sourceCoverage(source = {}, canonical = {}, unattended = {}) {
  const fresh = cleanNumber(source.priorityFreshQuoteCoverage120s || source.freshQuoteCoverage120s);
  const active = cleanNumber(source.activeSymbols || source.priorityPoolSymbols || source.priorityFreshQuotes120s);
  return {
    sourceRole: "formal_authority_dedicated_daytrade",
    quoteCount: cleanNumber(source.priorityFreshQuotes120s || source.freshQuotes120s),
    activeCommonStockQuotes: active,
    quoteCoverageRatio: fresh,
    quoteAgeSeconds: cleanNumber(source.quoteAgeSeconds, 999999),
    intraday1mReadyRows: cleanNumber(source.today1mSymbols),
    intraday1mRowsToday: cleanNumber(source.today1mRows),
    intraday1mReadyGe35: cleanNumber(source.readyMa35Continuous),
    intraday1mStaleSeconds: cleanNumber(source.intraday1mStaleSeconds, 999999),
    dailyVolumeRows: cleanNumber(source.dailyVolumeRows),
    dailyVolumeCoverage: cleanNumber(source.dailyVolumeCoverage),
    preopenRows: cleanNumber(source.preopenRows),
    finalBlindBuyRows: cleanNumber(source.finalBlindBuyRows),
    futoptMappingRows: cleanNumber(source.futoptStockMapped),
    futoptQuoteRows: cleanNumber(source.futoptReadyRows),
    priorityPoolSymbols: cleanNumber(canonical.priorityPoolSymbols || unattended.priorityPoolSymbols || source.priorityPoolSymbols),
    priorityFreshQuotes120s: cleanNumber(canonical.priorityFreshQuotes120s || unattended.priorityFreshQuotes120s || source.priorityFreshQuotes120s),
    priorityFreshQuoteCoverage120s: cleanNumber(canonical.priorityFreshQuoteCoverage120s || unattended.priorityFreshQuoteCoverage120s || source.priorityFreshQuoteCoverage120s),
    scannerCanRunOpening: canonical.scannerCanRunOpening === true && unattended.scannerCanRunOpening === true,
    formalEntryAllowed: canonical.formalEntryAllowed === true && unattended.formalEntryAllowed === true,
  };
}

function checkOnce() {
  const result = spawnSync(process.execPath, [VERIFY_SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "--use-system-ca" },
    timeout: 180000,
    windowsHide: true,
  });
  const alignment = parseJson(result.stdout) || {
    ok: false,
    verdict: "NOT_ALIGNED",
    issues: [result.stderr || result.stdout || "dedicated source alignment output missing"],
  };
  const source = alignment.sourceStatus || {};
  const canonical = alignment.canonicalGate || {};
  const unattended = alignment.unattendedGate || {};
  const formalReady = alignment.ok === true && alignment.verdict === "A_READY_ALIGNED";
  const issues = formalReady ? [] : [{
    severity: "critical",
    id: "daytrade_formal_gate_not_ready",
    message: alignment.verdict || "dedicated daytrade source is not A_READY_ALIGNED",
    details: { alignmentIssues: alignment.issues || [] },
  }];
  const payload = {
    ok: formalReady,
    source: "strategy2-supabase-coverage",
    sourceRole: "formal_authority_dedicated_daytrade",
    formalEntryAuthority: true,
    canonicalGateAuthority: true,
    latestPointerAuthority: true,
    unattendedAuthority: true,
    decision: formalReady ? "FORMAL_READY" : "FAIL_CLOSED",
    mode: "dedicated_daytrade_contract",
    checkedAt: new Date().toISOString(),
    checkedAtTaipei: taipeiNow(),
    alignmentVerdict: alignment.verdict || "NOT_ALIGNED",
    sourceStatus: source,
    canonicalGate: canonical,
    unattendedGate: unattended,
    coverage: sourceCoverage(source, canonical, unattended),
    issues,
    warnings: [],
    verifier: "verify-daytrade-source-contract-alignment.js",
    verifierExitCode: result.status ?? 1,
  };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const watch = args.has("--watch");
  const failOnCritical = args.has("--fail-on-critical");
  const intervalSeconds = Math.max(15, Number(process.env.STRATEGY2_COVERAGE_INTERVAL_SECONDS || 60));
  let payload = checkOnce();
  if (watch) {
    const until = process.env.STRATEGY2_COVERAGE_UNTIL || "09:10";
    const match = until.match(/^(\d{1,2}):(\d{2})$/);
    const untilMinute = match ? Number(match[1]) * 60 + Number(match[2]) : 550;
    while (taipeiMinuteOfDay() <= untilMinute) {
      await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
      payload = checkOnce();
    }
  }
  if (failOnCritical && !payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const payload = {
    ok: false,
    source: "strategy2-supabase-coverage",
    sourceRole: "formal_authority_dedicated_daytrade",
    formalEntryAuthority: true,
    canonicalGateAuthority: true,
    latestPointerAuthority: true,
    unattendedAuthority: true,
    decision: "FAIL_CLOSED",
    checkedAt: new Date().toISOString(),
    issues: [{ severity: "critical", id: "dedicated_gate_adapter_error", message: error.message || String(error) }],
  };
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});
