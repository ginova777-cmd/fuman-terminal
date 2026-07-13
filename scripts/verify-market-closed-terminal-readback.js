"use strict";

const DEFAULT_BASE_URL = "https://fuman-terminal.vercel.app";
const EXPECTED_DISPLAY_DATE = process.env.FUMAN_EXPECTED_DISPLAY_TRADE_DATE || "";
const EXPECTED_CLOSED_REASON = process.env.FUMAN_EXPECTED_CLOSED_REASON || "";

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg === name || arg.startsWith(prefix));
  if (!found) return fallback;
  if (found === name) return "1";
  return found.slice(prefix.length);
}

const baseUrl = (argValue("--base-url", process.env.FUMAN_LIVE_BASE_URL || DEFAULT_BASE_URL)).replace(/\/+$/, "");
const timeoutMs = Number(argValue("--timeout-ms", process.env.FUMAN_VERIFY_TIMEOUT_MS || "30000"));

const jsonEndpoints = [
  ["market-calendar", "/api/market-calendar"],
  ["terminal-fast-bundle", "/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&limit=70"],
  ["mobile-boot", "/api/mobile-boot"],
  ["scorecard", "/api/scorecard?live=1"],
  ["heatmap", "/api/heatmap"],
  ["market-ai-live", "/api/market-ai-live"],
  ["strategy1", "/api/open-buy-latest?canvas=1&compact=1&shell=1&limit=1200&live=1"],
  ["strategy2", "/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=1200&live=1"],
  ["strategy3", "/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=1200&live=1"],
  ["strategy4", "/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=1200&live=1"],
  ["strategy5", "/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=1200&live=1"],
  ["institution", "/api/institution-latest?canvas=1&compact=1&shell=1&limit=1200&live=1"],
  ["cb", "/api/cb-detect-latest?limit=500&live=1"],
  ["warrant", "/api/warrant-flow-latest?limit=500&live=1"],
  ["realtime-radar", "/api/realtime-radar-latest?full=1&limit=1200&live=1"],
];

const htmlSurfaces = [
  ["desktop", "/?desktop=1"],
  ["mobile", "/mobile"],
  ["scorecard-88", "/88.html"],
];

function withCacheBust(path) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}verifyMarketClosed=${Date.now()}`;
}

async function fetchWithTimeout(path, as = "json") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl}${withCacheBust(path)}`;
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    const text = await response.text();
    let payload = null;
    if (as === "json" && text) {
      try { payload = JSON.parse(text); } catch (error) { throw new Error(`invalid JSON: ${error.message}; body=${text.slice(0, 180)}`); }
    }
    return { url, status: response.status, ok: response.ok, text, payload };
  } finally {
    clearTimeout(timer);
  }
}

function isMembershipRequiredPayload(payload) {
  return Boolean(payload && payload.protected === true && payload.error === "membership_required");
}

function validClosedReason(reason) {
  if (EXPECTED_CLOSED_REASON) return reason === EXPECTED_CLOSED_REASON;
  return Boolean(reason && /^(weekend|holiday|typhoon_holiday|market_closed|non_trading_day)$/i.test(String(reason)));
}

function normalizeDate(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : "";
}

function validDisplayTradeDate(value) {
  if (EXPECTED_DISPLAY_DATE) return normalizeDate(value) === normalizeDate(EXPECTED_DISPLAY_DATE);
  const normalized = normalizeDate(value);
  if (!normalized) return false;
  return normalized <= new Date().toISOString().slice(0, 10);
}

function inspectMarketCalendarPayload(name, payload, expectedOpen = null) {
  const issues = [];
  if (!payload || typeof payload !== "object") {
    issues.push("payload is not object");
    return issues;
  }
  const openMode = expectedOpen === null ? payload.marketOpen !== false : expectedOpen === true;
  if (openMode) {
    if (payload.marketOpen !== true) issues.push(`marketOpen expected true got ${JSON.stringify(payload.marketOpen)}`);
    if (payload.marketStatus !== "open") issues.push(`marketStatus expected open got ${JSON.stringify(payload.marketStatus)}`);
    if (payload.closedReason) issues.push(`closedReason expected empty got ${JSON.stringify(payload.closedReason)}`);
    if (payload.formalScanSkipped === true) issues.push("formalScanSkipped must be false after market reopens");
    if (payload.sourceFreshnessRequired === false) issues.push("sourceFreshnessRequired must be true after market reopens");
    if (name === "market-calendar" && payload.preservePreviousGood === true) issues.push("market calendar preservePreviousGood must not remain true after reopen");
    if (String(payload.skipReason || "").includes("market_closed")) issues.push(`skipReason still contains market_closed after reopen: ${JSON.stringify(payload.skipReason)}`);
    if (name === "market-calendar" && payload.scannerAction !== "allow_formal_scan") issues.push(`scannerAction expected allow_formal_scan got ${JSON.stringify(payload.scannerAction)}`);
    if (!validDisplayTradeDate(payload.displayTradeDate || payload.marketDate || payload.requestedDate)) issues.push(`displayTradeDate expected valid current trade date got ${JSON.stringify(payload.displayTradeDate || payload.marketDate || payload.requestedDate)}`);
    return issues;
  }
  if (payload.marketOpen !== false) issues.push(`marketOpen expected false got ${JSON.stringify(payload.marketOpen)}`);
  if (payload.marketStatus !== "closed") issues.push(`marketStatus expected closed got ${JSON.stringify(payload.marketStatus)}`);
  if (!validClosedReason(payload.closedReason)) issues.push(`closedReason expected ${EXPECTED_CLOSED_REASON || "closed reason"} got ${JSON.stringify(payload.closedReason)}`);
  if (payload.formalScanSkipped !== true) issues.push(`formalScanSkipped expected true got ${JSON.stringify(payload.formalScanSkipped)}`);
  if (payload.sourceFreshnessRequired !== false) issues.push(`sourceFreshnessRequired expected false got ${JSON.stringify(payload.sourceFreshnessRequired)}`);
  if (payload.preservePreviousGood !== true) issues.push(`preservePreviousGood expected true got ${JSON.stringify(payload.preservePreviousGood)}`);
  if (payload.latestPointerUpdated !== false) issues.push(`latestPointerUpdated expected false got ${JSON.stringify(payload.latestPointerUpdated)}`);
  if (payload.emptyResultWritten !== false) issues.push(`emptyResultWritten expected false got ${JSON.stringify(payload.emptyResultWritten)}`);
  if (!validDisplayTradeDate(payload.displayTradeDate)) issues.push(`displayTradeDate expected ${EXPECTED_DISPLAY_DATE || "valid previous/current trade date"} got ${JSON.stringify(payload.displayTradeDate)}`);
  if (name === "market-calendar") {
    if (payload.scannerAction !== "skip_formal_scan") issues.push(`scannerAction expected skip_formal_scan got ${JSON.stringify(payload.scannerAction)}`);
    if (EXPECTED_CLOSED_REASON && payload.tradingDay?.source !== "dgpa_auto_update" && payload.tradingDay?.source !== "manual_override") {
      issues.push(`market calendar source expected dgpa_auto_update/manual_override got ${JSON.stringify(payload.tradingDay?.source)}`);
    }
  }
  return issues;
}

function inspectHtmlSurface(text) {
  const issues = [];
  if (!text.includes("fuman-market-closed-banner")) issues.push("missing fuman-market-closed-banner hook");
  if (!text.includes("/api/market-calendar")) issues.push("missing /api/market-calendar fetch hook");
  if (!text.includes("休市保護")) issues.push("missing 休市保護 display text");
  if (!text.includes("previous good")) issues.push("missing previous good display text");
  return issues;
}

async function main() {
  const issues = [];
  const jsonReports = [];
  const htmlReports = [];

  for (const [name, path] of jsonEndpoints) {
    try {
      const result = await fetchWithTimeout(path, "json");
      const endpointIssues = [];
      const membershipProtected = result.status === 401 && isMembershipRequiredPayload(result.payload);
      if (membershipProtected) {
        jsonReports.push({ name, url: result.url, status: result.status, ok: true, membershipProtected: true, issues: endpointIssues });
        continue;
      }
      if (!result.ok) endpointIssues.push(`HTTP ${result.status}`);
      endpointIssues.push(...inspectMarketCalendarPayload(name, result.payload));
      jsonReports.push({ name, url: result.url, status: result.status, ok: result.ok, marketOpen: result.payload?.marketOpen, marketStatus: result.payload?.marketStatus, closedReason: result.payload?.closedReason, displayTradeDate: result.payload?.displayTradeDate, issues: endpointIssues });
      for (const issue of endpointIssues) issues.push(`${name}: ${issue}`);
    } catch (error) {
      jsonReports.push({ name, path, error: error.message, issues: [error.message] });
      issues.push(`${name}: ${error.message}`);
    }
  }

  for (const [name, path] of htmlSurfaces) {
    try {
      const result = await fetchWithTimeout(path, "text");
      const surfaceIssues = [];
      if (!result.ok) surfaceIssues.push(`HTTP ${result.status}`);
      surfaceIssues.push(...inspectHtmlSurface(result.text));
      htmlReports.push({ name, url: result.url, status: result.status, ok: result.ok, bytes: Buffer.byteLength(result.text || ""), issues: surfaceIssues });
      for (const issue of surfaceIssues) issues.push(`${name}: ${issue}`);
    } catch (error) {
      htmlReports.push({ name, path, error: error.message, issues: [error.message] });
      issues.push(`${name}: ${error.message}`);
    }
  }

  const report = {
    ok: issues.length === 0,
    contract: "market-calendar-terminal-readback-v2",
    checkedAt: new Date().toISOString(),
    baseUrl,
    expected: {
      mode: "auto-open-or-closed",
      marketOpen: "auto",
      marketStatus: "auto",
      closedReason: EXPECTED_CLOSED_REASON,
      displayTradeDate: EXPECTED_DISPLAY_DATE,
      closedModeRequires: {
        formalScanSkipped: true,
        sourceFreshnessRequired: false,
        preservePreviousGood: true,
        latestPointerUpdated: false,
        emptyResultWritten: false,
      },
      openModeRequires: {
        formalScanSkipped: false,
        sourceFreshnessRequired: true,
        marketCalendarScannerAction: "allow_formal_scan",
        noMarketClosedSkipReason: true,
      },
    },
    jsonReports,
    htmlReports,
    issues,
  };
  console.log(JSON.stringify(report, null, 2));
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, contract: "market-calendar-terminal-readback-v2", error: error?.message || String(error), checkedAt: new Date().toISOString() }, null, 2));
  process.exit(1);
});
