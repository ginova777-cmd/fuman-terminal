"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DEFAULT_REPORT_DIR = path.join(RUNTIME_DIR, "reports");
const DEFAULT_STATE_DIR = path.join(RUNTIME_DIR, "state");
const DEFAULT_PRODUCTION_URL = process.env.FUMAN_API_UNATTENDED_PRODUCTION_URL
  || process.env.FUMAN_AUDIT_BASE_URL
  || "https://fuman-terminal.vercel.app";

function parseArgs(argv) {
  const parsed = { flags: new Set(), values: new Map() };
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const splitAt = body.indexOf("=");
    if (splitAt === -1) {
      parsed.flags.add(body);
    } else {
      parsed.values.set(body.slice(0, splitAt), body.slice(splitAt + 1));
    }
  }
  return parsed;
}

const ARGS = parseArgs(process.argv.slice(2));
const BASE_URL = String(ARGS.values.get("production-url") || DEFAULT_PRODUCTION_URL).replace(/\/+$/, "");
const REPORT_DIR = path.resolve(ARGS.values.get("report-dir") || process.env.FUMAN_API_UNATTENDED_REPORT_DIR || DEFAULT_REPORT_DIR);
const OUT_FILE = path.resolve(ARGS.values.get("out") || process.env.FUMAN_API_UNATTENDED_SCORECARD_FILE || path.join(DEFAULT_STATE_DIR, "api-unattended-scorecard.json"));
const MD_FILE = path.resolve(ARGS.values.get("md") || process.env.FUMAN_API_UNATTENDED_REPORT_FILE || path.join(REPORT_DIR, "api-unattended-scorecard.md"));
const COMPUTER_LABEL = ARGS.values.get("computer") || process.env.FUMAN_API_UNATTENDED_COMPUTER || process.env.COMPUTERNAME || "unknown";
const RUN_VERIFIERS = !ARGS.flags.has("skip-verifiers") && process.env.FUMAN_API_UNATTENDED_SKIP_VERIFIERS !== "1";
const NO_FAIL = ARGS.flags.has("no-fail") || process.env.FUMAN_API_UNATTENDED_NO_FAIL === "1";
const TIMEOUT_MS = Math.max(5000, Number(ARGS.values.get("timeout-ms") || process.env.FUMAN_API_UNATTENDED_TIMEOUT_MS || 45000));
const VERIFIER_TIMEOUT_MS = Math.max(10000, Number(ARGS.values.get("verifier-timeout-ms") || process.env.FUMAN_API_UNATTENDED_VERIFIER_TIMEOUT_MS || 120000));
const MAX_SAMPLE_MISSING = Math.max(1, Number(ARGS.values.get("sample-missing") || 25));
const CHECKED_AT = new Date();
const TAIPEI_MINUTE = taipeiMinute(CHECKED_AT);
const MARKET_WINDOW = TAIPEI_MINUTE >= 8 * 60 + 30 && TAIPEI_MINUTE <= 13 * 60 + 40;
const PROFILE = ARGS.values.get("profile") || process.env.FUMAN_API_UNATTENDED_PROFILE || (MARKET_WINDOW ? "market" : "off-session");
const STRICT_LIVE = PROFILE === "market" || ARGS.flags.has("strict-live") || process.env.FUMAN_API_UNATTENDED_STRICT_LIVE === "1";

const COMMON_GROUPS = {
  identity: ["code", "symbol", "stockId", "stock_id", "underlyingCode", "stockCode", "cbCode", "warrantCode"],
  name: ["name", "stockName", "stock_name", "underlyingName", "cbName", "warrantName"],
  price: ["price", "close", "lastPrice", "latestClose", "stockPrice", "underlyingClose", "displayClose", "referencePrice"],
  percent: ["changePercent", "change_percent", "percent", "pct", "amplitudePercent", "premium"],
  volume: ["volume", "tradeVolume", "totalVolume", "trade_volume", "volumeLots", "tradeValue", "value", "callValue"],
  time: ["time", "quoteTime", "scanTime", "updatedAt", "generatedAt", "latestSeenAt", "firstAAt"],
  signal: ["reason", "signal", "signals", "state", "stateId", "score", "finalScore", "tags", "description", "actionLabel"],
  lineage: ["runId", "source", "cacheSource", "updatedAt", "generatedAt"],
};

const STRATEGIES = [
  {
    key: "strategy1",
    name: "Strategy1 open buy",
    endpoints: ["/api/open-buy-latest?canvas=1&compact=1&shell=1&limit=1200&live=1"],
    sourceChain: ["strategy1_open_buy_runs", "strategy1_open_buy_results", "v_strategy1_ready_status"],
    writerRunner: "run-open-buy.ps1 / scripts/scan-open-buy-cache.js",
    latestView: "v_strategy1_ready_status",
    runsTable: "strategy1_open_buy_runs",
    resultsTable: "strategy1_open_buy_results",
    dailySummaryTable: "strategy_daily_summary",
    retentionPolicy: "runs/results retained; static JSON retired from formal API path",
    writeBudget: "read from API evidence; no static cache publish",
    verifierCommands: [
      ["scripts/verify-strategy1-autonomy-readonly.js"],
      ["scripts/verify-strategy1-battle-state.js"],
    ],
  },
  {
    key: "strategy2",
    name: "Strategy2 intraday",
    endpoints: [
      "/api/latest-strategy?key=strategy2&compact=1&limit=1200&live=1",
      "/api/strategy2-latest?compact=1&limit=1200&live=1",
    ],
    sourceChain: ["v_strategy2_latest_complete_run", "strategy2_scan_results", "v_strategy2_readiness_status", "source_status"],
    writerRunner: "run-strategy2-intraday.ps1 / scripts/scan-intraday-signals.js",
    latestView: "v_strategy2_latest_complete_run",
    runsTable: "strategy2_scan_runs",
    resultsTable: "strategy2_scan_results",
    dailySummaryTable: "strategy_daily_summary",
    retentionPolicy: "complete runs preserved; source hard gate blocks degraded overwrite",
    writeBudget: "source_status.writeBudget / supabase publish hard gate",
    verifierCommands: [
      ["scripts/verify-supabase-publish-hard-gate.js", "--dry-run-alert"],
      ["scripts/check-strategy2-readiness-gate.js"],
      ["scripts/verify-strategy2-battle-state.js"],
    ],
  },
  {
    key: "strategy3",
    name: "Strategy3 late-session TV",
    endpoints: ["/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=1200&live=1"],
    sourceChain: ["v_strategy3_latest_complete_run", "strategy3_scan_results", "fugle_quotes_latest", "v_strategy3_intraday_1m_status", "stock_daily_volume"],
    writerRunner: "run-strategy3.ps1 / run-strategy3-complete-scan.ps1 / scripts/scan-strategy3-cache.js",
    latestView: "v_strategy3_latest_complete_run",
    runsTable: "strategy3_scan_runs",
    resultsTable: "strategy3_scan_results",
    dailySummaryTable: "strategy_daily_summary",
    retentionPolicy: "complete run authoritative; 1m warmup retained by Supabase contract",
    writeBudget: "scanner receipt and source-chain verifier",
    verifierCommands: [
      ["scripts/check-strategy3-source-chain.js"],
      ["scripts/verify-strategy3-battle-state.js"],
    ],
  },
  {
    key: "strategy4",
    name: "Strategy4",
    endpoints: ["/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=1200&live=1"],
    sourceChain: ["strategy4_scan_runs", "strategy4_scan_results"],
    writerRunner: "run-strategy4.ps1 / scripts/scan-strategy4-cache.js",
    latestView: "strategy4 latest complete run API",
    runsTable: "strategy4_scan_runs",
    resultsTable: "strategy4_scan_results",
    dailySummaryTable: "strategy_daily_summary",
    retentionPolicy: "API-only complete runs; static Strategy4 JSON retired",
    writeBudget: "strategy4 runner receipt",
    verifierCommands: [
      ["scripts/verify-strategy4-autonomy-readonly.js"],
      ["scripts/verify-strategy4-standard-gate.js"],
    ],
  },
  {
    key: "strategy5",
    name: "Strategy5 chip",
    endpoints: ["/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=1200&live=1"],
    sourceChain: ["v_strategy5_latest_complete_run", "strategy5_scan_results", "v_chip_flows_health", "v_institution_source_health"],
    writerRunner: "run-strategy5.ps1 / run-chip-source-sync.ps1 / scripts/scan-strategy5-cache.js",
    latestView: "v_strategy5_latest_complete_run",
    runsTable: "strategy5_scan_runs",
    resultsTable: "strategy5_scan_results",
    dailySummaryTable: "strategy_daily_summary",
    retentionPolicy: "chip source freshness required; no 20260626 stale snapshot publish",
    writeBudget: "strategy5 runner receipt / chip health verifier",
    verifierCommands: [
      ["scripts/verify-chip-source-health.js"],
      ["scripts/verify-strategy5-battle-state.js"],
    ],
  },
  {
    key: "institution",
    name: "Institution buy/sell",
    endpoints: ["/api/institution-latest?canvas=1&compact=1&shell=1&limit=1200&live=1"],
    sourceChain: ["v_institution_latest_complete_run", "institution_scan_results", "v_institution_source_health"],
    writerRunner: "run-institution.ps1 / scripts/scan-institution-cache.js",
    latestView: "v_institution_latest_complete_run",
    runsTable: "institution_scan_runs",
    resultsTable: "institution_scan_results",
    dailySummaryTable: "strategy_daily_summary",
    retentionPolicy: "API-only complete runs; retired institution static JSON blocked",
    writeBudget: "institution runner receipt",
    groups: {
      ...COMMON_GROUPS,
      signal: ["institutionTotalNet", "institution_total_net", "totalNet", "total_net", "foreignNet", "foreign_net", "trustNet", "dealerNet"],
      chip: ["foreignNet", "foreign_net", "trustNet", "dealerNet", "totalNet", "institutionTotalNet"],
    },
    verifierCommands: [
      ["scripts/verify-institution-battle-state.js"],
      ["scripts/verify-buy-sell-field-contract.js"],
    ],
  },
  {
    key: "cb",
    name: "CB detect",
    endpoints: ["/api/cb-detect-latest?canvas=1&compact=1&shell=1&limit=1200&live=1"],
    sourceChain: ["cb_detect_scan_runs", "cb_detect_scan_results", "v_scanner_resource_health"],
    writerRunner: "run-cb-detect.ps1 / scripts/generate-cb-detect.js",
    latestView: "CB latest complete run API",
    runsTable: "cb_detect_scan_runs",
    resultsTable: "cb_detect_scan_results",
    dailySummaryTable: "strategy_daily_summary",
    retentionPolicy: "CB source retention 5 days; static CB JSON returns 410",
    writeBudget: "CB runner/watchdog receipt",
    groups: {
      identity: ["code", "underlyingCode", "stockCode"],
      cbCode: ["cbCode", "symbol", "bondCode"],
      name: ["cbName", "name", "bondName"],
      price: ["stockPrice", "price", "close"],
      percent: ["premium", "conversionPremium", "spread"],
      volume: ["volume", "tradeValue", "turnover"],
      time: ["time", "quoteTime", "scanTime", "updatedAt", "generatedAt"],
      signal: ["score", "finalScore", "sourceLayer", "stage", "entryLabel", "reason", "tags"],
      lineage: COMMON_GROUPS.lineage,
    },
    verifierCommands: [
      ["scripts/verify-cb-autonomy-readonly.js"],
      ["scripts/verify-cb-battle-state.js"],
    ],
  },
  {
    key: "warrant",
    name: "Warrant flow",
    endpoints: ["/api/warrant-flow-latest?canvas=1&compact=1&shell=1&limit=1200&live=1"],
    sourceChain: ["v_warrant_flow_latest_complete_run", "warrant_flow_scan_results"],
    writerRunner: "run-warrant-flow.ps1 / scripts/scan-warrant-flow-cache.js",
    latestView: "v_warrant_flow_latest_complete_run",
    runsTable: "warrant_flow_scan_runs",
    resultsTable: "warrant_flow_scan_results",
    dailySummaryTable: "strategy_daily_summary",
    retentionPolicy: "warrant flow retention 5 days; snapshotStale must be false",
    writeBudget: "warrant runner receipt",
    groups: {
      identity: ["warrantCode", "code", "symbol"],
      underlying: ["underlyingCode", "stockCode"],
      name: ["warrantName", "name", "underlyingName", "stockName"],
      price: ["underlyingClose", "stockClose", "close", "displayClose"],
      percent: ["changePercent", "percent", "pct", "premium"],
      volume: ["value", "tradeValue", "callValue", "volume"],
      time: ["time", "quoteTime", "scanTime", "updatedAt", "generatedAt"],
      signal: ["reason", "actionLabel", "tags", "signal", "score", "finalScore"],
      lineage: COMMON_GROUPS.lineage,
    },
    verifierCommands: [
      ["scripts/verify-warrant-freshness.js"],
      ["scripts/verify-warrant-battle-state.js"],
    ],
  },
  {
    key: "realtime-radar",
    name: "Realtime radar",
    endpoints: ["/api/realtime-radar-latest?full=1&compact=1&shell=1&limit=1200&live=1"],
    sourceChain: ["fuman_realtime_radar_cache", "fugle_realtime_quote_latest", "fallback quote source only if explicitly disclosed"],
    writerRunner: "run-realtime-radar.ps1 / scripts/scan-realtime-radar-cache.js",
    latestView: "fuman_realtime_radar_cache",
    runsTable: "fuman_realtime_radar_cache",
    resultsTable: "fuman_realtime_radar_cache",
    dailySummaryTable: "strategy_daily_summary",
    retentionPolicy: "live cache only; staleQuoteCount must be exposed",
    writeBudget: "realtime radar cache writer",
    expectedRows: 1200,
    groups: COMMON_GROUPS,
    liveSessionSurface: true,
    skipVerifiersOffSession: true,
    verifierCommands: [
      ["scripts/check-realtime-radar-health.js"],
    ],
  },
  {
    key: "heatmap",
    name: "Heatmap live surface",
    endpoints: ["/api/heatmap?canvas=1&limit=999&stocks=999&source=desktop-live-contract"],
    rowPaths: ["sectors.*.stocks"],
    sourceChain: ["supabase:fugle_quotes_live", "api/heatmap"],
    writerRunner: "Fuman Public Slot Shared Source 0800 / Watchdog-PublicSlotSharedSource.ps1",
    latestView: "fugle_quotes_live",
    runsTable: "live surface",
    resultsTable: "fugle_quotes_live",
    dailySummaryTable: "market live surface",
    retentionPolicy: "live quote surface; static cache cannot be treated as normal data",
    writeBudget: "live quote writer budget guarded by public-slot source and production monitor",
    runIdOptional: true,
    liveSessionSurface: true,
    skipVerifiersOffSession: true,
    groups: {
      identity: ["code", "symbol"],
      name: ["name"],
      price: ["close", "price"],
      percent: ["pct", "percent", "changePercent"],
      volume: ["value", "tradeValue", "volume", "tradeVolume"],
      time: ["quoteTime", "quoteDate", "quoteUpdatedAt", "updatedAt"],
      signal: ["sector", "industry", "primaryIndustry", "heatmapSector"],
      lineage: ["quotePriceSource", "source", "cacheSource", "updatedAt"],
    },
    verifierCommands: [
      ["scripts/verify-heatmap-realtime.js"],
    ],
  },
  {
    key: "market-ai",
    name: "Market AI live surface",
    endpoints: ["/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40"],
    sourceChain: ["api/market-ai-live", "live heatmap", "realtime radar", "base market bundle"],
    writerRunner: "terminal-market-ai-live-watchdog.js / production monitor",
    latestView: "market-ai-live API",
    runsTable: "live surface",
    resultsTable: "market-ai-live response rows",
    dailySummaryTable: "market live surface",
    retentionPolicy: "live API surface; staleSources/sourceIssues must be exposed",
    writeBudget: "read-only live bundle",
    runIdOptional: true,
    liveSessionSurface: true,
    skipVerifiersOffSession: true,
    groups: {
      ...COMMON_GROUPS,
      signal: ["reason", "score", "source", "side", "tags"],
    },
    verifierCommands: [
      ["scripts/verify-market-ai-freshness-guard.js"],
      ["scripts/verify-heatmap-ai-alert-path.js"],
    ],
  },
];

function normalizeKey(value) {
  return String(value || "").replace(/[_\-\s]/g, "").toLowerCase();
}

function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.length === 0 || value.every(isBlank);
  if (typeof value === "object") return Object.keys(value).length === 0;
  const text = String(value).trim();
  return !text || text === "--" || text === "-" || /^n\/a$/i.test(text) || /^null$/i.test(text) || /^undefined$/i.test(text);
}

function getPath(row, pathText) {
  return String(pathText).split(".").reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, row);
}

function rowIdentity(row, index) {
  return [
    getPath(row, "code")
      || getPath(row, "symbol")
      || getPath(row, "stockId")
      || getPath(row, "underlyingCode")
      || getPath(row, "warrantCode")
      || getPath(row, "cbCode")
      || `#${index + 1}`,
    getPath(row, "name")
      || getPath(row, "stockName")
      || getPath(row, "underlyingName")
      || getPath(row, "warrantName")
      || getPath(row, "cbName")
      || "",
  ].filter(Boolean).join(" ");
}

function collectArrays(value, pathName = "", out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    const objectRows = value.filter((item) => item && typeof item === "object");
    if (objectRows.length) out.push({ path: pathName || "$", rows: value });
    value.slice(0, 3).forEach((item, index) => collectArrays(item, `${pathName}[${index}]`, out));
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = pathName ? `${pathName}.${key}` : key;
    if (Array.isArray(child)) {
      const objectRows = child.filter((item) => item && typeof item === "object");
      if (objectRows.length) out.push({ path: childPath, rows: child });
    } else if (child && typeof child === "object") {
      collectArrays(child, childPath, out);
    }
  }
  return out;
}

function rowsAtConfiguredPath(payload, pathText) {
  const parts = String(pathText || "").split(".").filter(Boolean);
  let current = [payload];
  for (const part of parts) {
    const next = [];
    for (const value of current) {
      if (value === null || value === undefined) continue;
      if (part === "*") {
        if (Array.isArray(value)) next.push(...value);
        else if (typeof value === "object") next.push(...Object.values(value));
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object") next.push(item[part]);
        }
      } else if (typeof value === "object") {
        next.push(value[part]);
      }
    }
    current = next;
  }
  return current.flatMap((value) => Array.isArray(value) ? value : [value]).filter((item) => item && typeof item === "object");
}

function rowsOf(payload, strategy = {}) {
  for (const pathText of strategy.rowPaths || []) {
    const rows = rowsAtConfiguredPath(payload, pathText);
    if (rows.length) return { rows, path: pathText };
  }
  const preferredPaths = [
    "rows", "results", "matches", "items", "data", "top", "stocks", "sectors",
    "hotStocks", "snapshot.rows", "snapshot.results", "snapshot.items",
  ];
  for (const pathText of preferredPaths) {
    const value = getPath(payload, pathText);
    if (Array.isArray(value) && value.some((item) => item && typeof item === "object")) {
      return { rows: value, path: pathText };
    }
  }
  if (payload?.data && !Array.isArray(payload.data) && typeof payload.data === "object") {
    const values = Object.values(payload.data);
    if (values.length && values.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      return { rows: values, path: "data.*" };
    }
  }
  const arrays = collectArrays(payload).sort((a, b) => b.rows.length - a.rows.length);
  return arrays[0] || { rows: [], path: "" };
}

function collectValuesByNames(value, names, out = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return out;
  seen.add(value);
  const targets = new Set(names.map(normalizeKey));
  if (Array.isArray(value)) {
    value.slice(0, 40).forEach((item) => collectValuesByNames(item, names, out, seen));
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    if (targets.has(normalizeKey(key)) && !isBlank(child)) out.push(child);
    if (child && typeof child === "object") collectValuesByNames(child, names, out, seen);
  }
  return out;
}

function firstValue(payload, names, fallback = "") {
  for (const name of names) {
    const direct = getPath(payload, name);
    if (!isBlank(direct)) return direct;
  }
  const values = collectValuesByNames(payload, names);
  return values.length ? values[0] : fallback;
}

function firstDirectValue(payload, names, fallback = "") {
  for (const name of names) {
    const direct = getPath(payload, name);
    if (!isBlank(direct)) return direct;
  }
  return fallback;
}

function directArray(payload, names) {
  const value = firstDirectValue(payload, names, []);
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return fallback;
  const number = Number(String(value).replace(/[,%+]/g, "").trim());
  return Number.isFinite(number) ? number : fallback;
}

function ageSeconds(value, now = Date.now()) {
  if (isBlank(value)) return null;
  const time = Date.parse(String(value));
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.round((now - time) / 1000));
}

function taipeiStamp(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace(" ", "T");
}

function taipeiMinute(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function strategyDueStatus(strategy, date = new Date()) {
  const minute = taipeiMinute(date);
  const between = (start, end) => minute >= start && minute <= end;
  const endOfEvidenceDay = 23 * 60 + 55;
  const windows = {
    strategy1: { start: 8 * 60 + 45, end: endOfEvidenceDay, label: "08:45-23:55 Asia/Taipei" },
    strategy2: { start: 8 * 60 + 45, end: endOfEvidenceDay, label: "08:45-23:55 Asia/Taipei" },
    strategy3: { start: 13 * 60 + 5, end: endOfEvidenceDay, label: "13:05-23:55 Asia/Taipei" },
    strategy4: { start: 16 * 60, end: endOfEvidenceDay, label: "16:00-23:55 Asia/Taipei" },
  };
  if (windows[strategy.key]) {
    const window = windows[strategy.key];
    const due = between(window.start, window.end);
    return {
      due,
      verifierDue: due,
      window: window.label,
      reason: due ? "strategy_evidence_due" : "strategy_not_due_for_current_taipei_time",
    };
  }
  if (strategy.key === "realtime-radar") {
    const due = between(9 * 60, endOfEvidenceDay);
    return {
      due,
      verifierDue: due,
      window: "09:00-23:55 Asia/Taipei",
      reason: due ? "radar_today_cache_due" : "radar_not_due_before_0900_or_after_2355",
    };
  }
  return {
    due: true,
    verifierDue: true,
    window: "always",
    reason: "always_due",
  };
}

function payloadGroupSatisfied(group, fields, payload) {
  const fallbackGroups = new Set(strategyPayloadFallbackGroups(group));
  if (!fallbackGroups.has(group)) return false;
  return fields.some((field) => !isBlank(getPath(payload, field)))
    || (group === "lineage" && ["runId", "cacheSource", "source", "updatedAt", "generatedAt"].some((field) => !isBlank(firstValue(payload, [field]))))
    || (group === "time" && ["updatedAt", "generatedAt", "servedAt", "scanDate", "tradeDate", "usedDate"].some((field) => !isBlank(firstValue(payload, [field]))));
}

function strategyPayloadFallbackGroups(group) {
  return ["lineage", "time"];
}

function checkFields(strategy, rows, payload = {}) {
  const groups = strategy.groups || COMMON_GROUPS;
  const groupEntries = Object.entries(groups);
  const blankCounts = Object.fromEntries(groupEntries.map(([key]) => [key, 0]));
  const sampleMissingRows = [];
  rows.forEach((row, index) => {
    const missing = [];
    for (const [group, fields] of groupEntries) {
      const hit = fields.find((field) => !isBlank(getPath(row, field)));
      if (!hit && !payloadGroupSatisfied(group, fields, payload)) {
        blankCounts[group] += 1;
        missing.push({ group, fields });
      }
    }
    if (missing.length && sampleMissingRows.length < MAX_SAMPLE_MISSING) {
      sampleMissingRows.push({
        row: rowIdentity(row, index),
        index,
        missingGroups: missing.map((item) => item.group),
      });
    }
  });
  const cells = Math.max(1, rows.length * groupEntries.length);
  const blankTotal = Object.values(blankCounts).reduce((sum, value) => sum + value, 0);
  return {
    rowsChecked: rows.length,
    requiredFields: Object.fromEntries(groupEntries),
    blankCounts,
    blankTotal,
    blankRate: Number((blankTotal / cells).toFixed(6)),
    sampleMissingRows,
    payloadFallbackGroups: ["lineage", "time"],
  };
}

async function fetchJson(endpoint) {
  const url = new URL(endpoint, BASE_URL);
  url.searchParams.set("unattendedAudit", String(Date.now()));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text || "{}");
    } catch {}
    return {
      ok: response.ok,
      status: response.status,
      url: url.toString(),
      json,
      text: text.slice(0, 800),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function runCommand(command, extraEnv = {}) {
  const script = command[0];
  if (!fs.existsSync(path.join(ROOT, script))) {
    return {
      command: `node --use-system-ca ${command.join(" ")}`,
      exitCode: 127,
      ok: false,
      missing: true,
      stdout: "",
      stderr: "verifier script missing",
    };
  }
  const verifierReportDir = path.join(REPORT_DIR, "verifier-state");
  fs.mkdirSync(verifierReportDir, { recursive: true });
  const env = {
    ...process.env,
    ...extraEnv,
    FUMAN_API_UNATTENDED_PARENT: "1",
    FUMAN_SUPABASE_PUBLISH_GATE_FILE: path.join(verifierReportDir, "supabase-publish-hard-gate.json"),
    FUMAN_SUPABASE_PUBLISH_GATE_ALERT_RECEIPT: path.join(verifierReportDir, "supabase-publish-hard-gate-alert.json"),
  };
  const result = spawnSync(process.execPath, ["--use-system-ca", ...command], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: VERIFIER_TIMEOUT_MS,
    env,
  });
  return {
    command: `node --use-system-ca ${command.join(" ")}`,
    exitCode: result.status,
    signal: result.signal || "",
    ok: result.status === 0,
    stdout: String(result.stdout || "").slice(0, 5000),
    stderr: String(result.stderr || "").slice(0, 5000),
  };
}

function extractBasic(payload, rows) {
  const updatedAt = firstDirectValue(payload, ["updatedAt", "generatedAt", "servedAt", "snapshot.updatedAt", "transport.generatedAt"]);
  return {
    apiOk: firstDirectValue(payload, ["ok"], null),
    status: firstDirectValue(payload, ["status", "qualityStatus", "dataFreshness.status", "sourceHealth.status"], ""),
    reason: firstDirectValue(payload, ["reason", "error", "detail", "dataFreshness.reason", "sourceHealth.reason"], ""),
    runId: firstDirectValue(payload, ["runId", "latestRunId", "transport.runId", "snapshot.runId"], ""),
    scanDate: firstDirectValue(payload, ["scanDate", "date", "snapshot.date"], ""),
    tradeDate: firstDirectValue(payload, ["tradeDate", "usedDate", "sourceDate", "marketSession.marketDataDate", "snapshot.tradeDate"], ""),
    updatedAt,
    generatedAt: firstDirectValue(payload, ["generatedAt", "servedAt", "transport.generatedAt"], ""),
    updatedAtAgeSeconds: ageSeconds(updatedAt),
    rows: rows.length,
    totalCount: toNumber(firstDirectValue(payload, ["totalCount", "total", "expectedTotal", "expected_total"], null)),
    resultCount: toNumber(firstDirectValue(payload, ["resultCount", "count", "resultReadbackCount", "rows"], null)),
    cacheSource: firstDirectValue(payload, ["cacheSource", "source", "transport.source", "dataContractSource"], ""),
    dataContractSource: firstDirectValue(payload, ["dataContractSource", "sourceContract", "contractVersion", "fieldContractVersion"], ""),
  };
}

function extractFreshness(payload) {
  return {
    quoteAgeSeconds: toNumber(firstValue(payload, ["quoteAgeSeconds", "quote_age_seconds", "sourceAgeSeconds"], null)),
    latestCandleTime: firstValue(payload, ["latestCandleTime", "latest_candle_time", "latest_candle_time_taipei"], ""),
    intraday1mStaleSeconds: toNumber(firstValue(payload, ["intraday_1m_stale_seconds", "intraday1mStaleSeconds", "latest_candle_age_seconds"], null)),
    latestTradeDate: firstValue(payload, ["latestTradeDate", "latest_trade_date", "sourceDate", "usedDate", "tradeDate"], ""),
    dataFreshnessStatus: firstDirectValue(payload, ["dataFreshness.status", "freshness.status", "qualityStatus"], ""),
    dataFreshnessReason: firstDirectValue(payload, ["dataFreshness.reason", "freshness.reason", "sourceHealth.reason"], ""),
  };
}

function extractCoverage(payload, rows) {
  return {
    freshQuoteCoverage120s: toNumber(firstValue(payload, ["fresh_quote_coverage_120s", "freshQuoteCoverage120s", "quoteCoverage120s"], null)),
    today1mSymbols: toNumber(firstValue(payload, ["today_1m_symbols", "intraday_1m_symbols_today", "today1mSymbols"], null)),
    readyGe35: toNumber(firstValue(payload, ["ready_ge_35", "readyGe35", "ready_ge_35_symbols"], null)),
    expectedUniverse: toNumber(firstValue(payload, ["active_symbols", "expectedUniverse", "expected_total", "expectedTotal"], null)),
    preopenCoverage: toNumber(firstValue(payload, ["preopen_coverage", "preopenCoverage", "preopenRows"], null)),
    entryWindowRows: toNumber(firstValue(payload, ["entryWindowRows", "entry_window_rows", "entryWindowCount"], null)),
    scannedCount: toNumber(firstValue(payload, ["scannedCount", "scanned_count", "latest_execution_scanned"], null)),
    resultCount: toNumber(firstValue(payload, ["resultCount", "count", "resultReadbackCount"], rows.length)),
    staleQuoteCount: toNumber(firstValue(payload, ["staleQuoteCount", "stale_quote_count"], null)),
    failedBatchCount: toNumber(firstValue(payload, ["failedBatchCount", "failed_batch_count"], null)),
    sourceExcludedCodes: firstValue(payload, ["sourceExcludedCodes", "source_excluded_codes"], []),
  };
}

function extractFallback(payload) {
  const fallbackValue = firstDirectValue(payload, ["fallbackUsed", "fallback_used", "fallback", "usedFallback"], null);
  const scope = directArray(payload, ["fallbackScope", "fallback_scope"]);
  const details = directArray(payload, ["fallbackDetails", "fallback_details"]);
  const contract = payload?.fallbackContract && typeof payload.fallbackContract === "object" ? payload.fallbackContract : {};
  const source = firstDirectValue(payload, ["fallbackSource", "fallback_source", "fallback.source"], "");
  const reason = firstDirectValue(payload, ["fallbackReason", "fallback_reason", "fallback.reason"], "");
  const cacheSource = firstDirectValue(payload, ["cacheSource", "source", "transport.source"], "");
  const truthy = fallbackValue === true || /^true$/i.test(String(fallbackValue || ""));
  const staticLike = /static|retired|old cache|legacy json|data\/|\.json/i.test(String(cacheSource || ""))
    && !/^supabase-snapshot$/i.test(String(cacheSource || ""));
  const allowedByContract = truthy
    && !staticLike
    && scope.length > 0
    && scope.every((item) => contract?.[item]?.allowed === true)
    && !scope.includes("source")
    && details.length > 0;
  return {
    fallback: truthy || staticLike,
    fallbackRaw: fallbackValue,
    fallbackScope: scope,
    fallbackDetailsCount: details.length,
    fallbackSource: source || details[0]?.fallbackSource || details[0]?.candleSource || (staticLike ? cacheSource : ""),
    fallbackReason: reason || details[0]?.fallbackReason || (staticLike ? "cacheSource looks like retired static JSON/cache" : ""),
    contractAllowed: allowedByContract,
    officialSource: !(truthy || staticLike) || allowedByContract,
  };
}

function extractCost(payload) {
  return {
    retentionOk: firstValue(payload, ["retentionOk", "retention_ok", "cost.retentionOk"], null),
    writeBudget: firstValue(payload, ["writeBudget", "write_budget", "cost.writeBudget"], ""),
    latestUpsert: firstValue(payload, ["latestUpsert", "latest_upsert"], ""),
    dailySummaryUpdated: firstValue(payload, ["dailySummaryUpdated", "daily_summary_updated"], ""),
    alert: firstValue(payload, ["alert", "gmailAlert", "alertReceipt"], ""),
  };
}

function frontendEvidence(strategy) {
  const files = [
    "terminal-app.js",
    "terminal-modules.js",
    "terminal-desktop-fast-shell.js",
    "terminal-chip-flow.js",
    "terminal-warrant-flow.js",
    "terminal-live-check.js",
    "mobile.html",
    "index.html",
  ];
  const endpointPaths = strategy.endpoints.map((endpoint) => endpoint.split("?")[0]);
  const references = [];
  const staleMarkers = [];
  const staticReferences = [];
  const staticGuardReferences = [];
  for (const file of files) {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, "utf8");
    if (endpointPaths.some((endpoint) => text.includes(endpoint))) references.push(file);
    if (/stale|degraded|partial|source_status|qualityStatus/i.test(text)) staleMarkers.push(file);
    const staticNeedle = strategy.key === "cb" ? "cb-detect" : strategy.key;
    const staticRe = new RegExp(`data[/\\\\][^'"\\s]*${staticNeedle}[^'"\\s]*\\.json`, "ig");
    let match = null;
    while ((match = staticRe.exec(text))) {
      const context = text.slice(Math.max(0, match.index - 240), Math.min(text.length, match.index + 360));
      if (/mobile large payload blocked|large payload blocked|retired static|static json blocked|returns 410/i.test(context)) {
        staticGuardReferences.push(file);
      } else {
        staticReferences.push(file);
      }
    }
  }
  return {
    endpointReferences: references,
    desktopUsesSameApi: references.length > 0,
    mobileUsesSameApi: references.some((file) => /mobile|terminal-app|terminal-modules/i.test(file)),
    staleDegradedMarkers: [...new Set(staleMarkers)],
    retiredStaticJsonReferences: [...new Set(staticReferences)],
    retiredStaticJsonGuardReferences: [...new Set(staticGuardReferences)],
  };
}

function apiIssues(strategy, endpointResult, basic, freshness, coverage, fields, fallback, frontend, dueStatus = { due: true }) {
  const issues = [];
  const warnings = [];
  const addDueIssue = (issue) => {
    if (dueStatus.due === false) warnings.push(`not_due_${issue}`);
    else issues.push(issue);
  };
  if (endpointResult.status !== 200) addDueIssue(`http_status_${endpointResult.status}`);
  if (basic.apiOk === false) addDueIssue("api_ok_false");
  if (/critical|error|failed|blocked/i.test(String(basic.status))) addDueIssue(`api_status_${basic.status}`);
  if (/stale|degraded|partial|not_ready/i.test(String(basic.status))) warnings.push(`api_status_${basic.status}`);
  if (/stale|degraded|partial|not_ready/i.test(String(freshness.dataFreshnessStatus))) warnings.push(`freshness_${freshness.dataFreshnessStatus}`);
  if (!basic.runId && !strategy.runIdOptional) warnings.push("run_id_missing");
  if (!basic.updatedAt && !basic.generatedAt) warnings.push("updated_at_missing");
  if (!basic.cacheSource && !basic.dataContractSource) warnings.push("source_marker_missing");
  if (!fields.rowsChecked) addDueIssue("api_rows_empty");
  if (strategy.expectedRows && fields.rowsChecked < strategy.expectedRows) addDueIssue(`rows_below_expected_${fields.rowsChecked}_${strategy.expectedRows}`);
  if (fields.blankTotal > 0) addDueIssue(`field_blanks_${fields.blankTotal}`);
  if (fallback.fallback && !fallback.contractAllowed) addDueIssue("fallback_or_static_cache_used");
  if (fallback.fallback && fallback.contractAllowed) warnings.push(`allowed_fallback_${fallback.fallbackScope.join("+")}`);
  if (coverage.staleQuoteCount > 0) warnings.push(`stale_quote_count_${coverage.staleQuoteCount}`);
  if (coverage.failedBatchCount > 0) addDueIssue(`failed_batch_count_${coverage.failedBatchCount}`);
  if (frontend.endpointReferences.length === 0) warnings.push("frontend_endpoint_reference_missing");
  if (frontend.retiredStaticJsonReferences.length) issues.push("frontend_retired_static_json_reference");
  return { issues, warnings };
}

function applyProfileJudgement(strategy, endpointResult, judgement) {
  if (STRICT_LIVE || !strategy.liveSessionSurface || !judgement.issues.length) return judgement;
  const downgraded = [];
  const kept = [];
  for (const issue of judgement.issues) {
    if (/^(http_status_0|http_status_503|api_ok_false|api_rows_empty|rows_below_expected_|field_blanks_)/.test(issue)) {
      downgraded.push(issue);
    } else {
      kept.push(issue);
    }
  }
  if (!downgraded.length) return judgement;
  const staleHint = JSON.stringify(endpointResult.json || {}).slice(0, 1600) + " " + String(endpointResult.text || "");
  const reason = /stale|not_today|fresh_rows_0_below|trading_day_radar_cache_stale|marketDataDate|off.?session/i.test(staleHint)
    ? "off_session_live_stale"
    : "off_session_live_unavailable";
  return {
    issues: kept,
    warnings: [
      ...judgement.warnings,
      ...downgraded.map((issue) => `${reason}:${issue}`),
    ],
  };
}

async function evaluateStrategy(strategy, context = {}) {
  const endpointResults = [];
  const verifierResults = [];
  const dueStatus = strategyDueStatus(strategy, context.now || new Date());
  for (const endpoint of strategy.endpoints) {
    const response = await fetchJson(endpoint).catch((error) => ({
      ok: false,
      status: 0,
      url: new URL(endpoint, BASE_URL).toString(),
      json: null,
      text: error?.message || String(error),
    }));
    const rowsInfo = response.json ? rowsOf(response.json, strategy) : { rows: [], path: "" };
    const basic = response.json ? extractBasic(response.json, rowsInfo.rows) : {};
    const freshness = response.json ? extractFreshness(response.json) : {};
    const coverage = response.json ? extractCoverage(response.json, rowsInfo.rows) : {};
    const fields = response.json ? checkFields(strategy, rowsInfo.rows, response.json) : checkFields(strategy, []);
    const fallback = response.json ? extractFallback(response.json) : { fallback: false, contractAllowed: false };
    const cost = response.json ? extractCost(response.json) : {};
    const frontend = frontendEvidence(strategy);
    const judgement = applyProfileJudgement(
      strategy,
      response,
      apiIssues(strategy, response, basic, freshness, coverage, fields, fallback, frontend, dueStatus)
    );
    endpointResults.push({
      endpoint,
      url: response.url,
      httpStatus: response.status,
      httpOk: response.ok,
      rowPath: rowsInfo.path,
      basic,
      freshness,
      coverage,
      fieldCompleteness: fields,
      fallback,
      cost,
      frontend,
      dueStatus,
      issues: judgement.issues,
      warnings: judgement.warnings,
      responseSample: response.ok ? undefined : response.text,
    });
  }
  if (RUN_VERIFIERS && dueStatus.verifierDue !== false) {
    for (const command of strategy.verifierCommands || []) {
      if (!STRICT_LIVE && strategy.skipVerifiersOffSession) {
        verifierResults.push({
          command: `node --use-system-ca ${command.join(" ")}`,
          exitCode: 0,
          signal: "",
          ok: true,
          skipped: true,
          stdout: "",
          stderr: `skipped in ${PROFILE} profile; rerun with --profile=market or --strict-live during market window`,
        });
      } else {
        verifierResults.push(runCommand(command));
      }
    }
  } else if (RUN_VERIFIERS && dueStatus.verifierDue === false) {
    verifierResults.push({
      command: "verifiers skipped",
      exitCode: 0,
      signal: "",
      ok: true,
      skipped: true,
      reason: dueStatus.reason,
    });
  }
  const issues = endpointResults.flatMap((item) => item.issues.map((issue) => `${item.endpoint}: ${issue}`));
  const warnings = endpointResults.flatMap((item) => item.warnings.map((warning) => `${item.endpoint}: ${warning}`));
  for (const verifier of verifierResults) {
    if (!verifier.ok) issues.push(`verifier_failed: ${verifier.command}`);
  }
  return {
    key: strategy.key,
    strategyName: strategy.name,
    productionUrl: BASE_URL,
    apiEndpoints: strategy.endpoints,
    supabaseSourceChain: strategy.sourceChain,
    writerRunner: strategy.writerRunner,
    latestTableView: strategy.latestView,
    runsTable: strategy.runsTable,
    rawResultsTable: strategy.resultsTable,
    dailySummaryTable: strategy.dailySummaryTable,
    retentionPolicy: strategy.retentionPolicy,
    writeBudgetPolicy: strategy.writeBudget,
    dueStatus,
    endpoints: endpointResults,
    verifierResults,
    issues,
    warnings,
    needsHumanWatch: issues.length > 0,
    unattendedStatus: issues.length ? "NO" : "YES",
  };
}

function gitValue(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function writeOutputs(scorecard) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.mkdirSync(path.dirname(MD_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(scorecard, null, 2)}\n`, "utf8");
  const lines = [
    "# API Unattended Scorecard",
    "",
    `- checkedAt: ${scorecard.checkedAt}`,
    `- taipeiCheckedAt: ${scorecard.taipeiCheckedAt}`,
    `- computer: ${scorecard.computer}`,
    `- productionUrl: ${scorecard.productionUrl}`,
    `- sourceSha: ${scorecard.sourceSha || "unknown"}`,
    `- profile: ${scorecard.profile}`,
    `- strictLive: ${scorecard.strictLive}`,
    `- unattendedStatus: ${scorecard.unattendedStatus}`,
    `- needsHumanWatch: ${scorecard.needsHumanWatch}`,
    `- blockers: ${scorecard.blockers.length}`,
    "",
    "| strategy | unattended | rows | blanks | issues | warnings | runId | source |",
    "|---|---:|---:|---:|---:|---:|---|---|",
  ];
  for (const strategy of scorecard.strategies) {
    const primary = strategy.endpoints[0] || {};
    lines.push([
      strategy.key,
      strategy.unattendedStatus,
      primary.fieldCompleteness?.rowsChecked ?? 0,
      primary.fieldCompleteness?.blankTotal ?? 0,
      strategy.issues.length,
      strategy.warnings.length,
      primary.basic?.runId || "--",
      primary.basic?.cacheSource || primary.basic?.dataContractSource || "--",
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push("");
  for (const strategy of scorecard.strategies.filter((item) => item.issues.length || item.warnings.length)) {
    lines.push(`## ${strategy.key}`);
    strategy.issues.slice(0, 30).forEach((issue) => lines.push(`- ISSUE: ${issue}`));
    strategy.warnings.slice(0, 30).forEach((warning) => lines.push(`- WARNING: ${warning}`));
    for (const endpoint of strategy.endpoints) {
      const missing = endpoint.fieldCompleteness?.sampleMissingRows || [];
      if (missing.length) {
        lines.push(`- sampleMissingRows ${endpoint.endpoint}: ${JSON.stringify(missing.slice(0, 5))}`);
      }
    }
    lines.push("");
  }
  fs.writeFileSync(MD_FILE, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const now = CHECKED_AT;
  const marketWindow = MARKET_WINDOW;
  const strategies = [];
  for (const strategy of STRATEGIES) {
    console.log(`[api-unattended] checking ${strategy.key}`);
    strategies.push(await evaluateStrategy(strategy, { now }));
  }
  const blockers = strategies.flatMap((strategy) => strategy.issues.map((issue) => `${strategy.key}: ${issue}`));
  const warnings = strategies.flatMap((strategy) => strategy.warnings.map((warning) => `${strategy.key}: ${warning}`));
  const scorecard = {
    ok: blockers.length === 0,
    unattendedStatus: blockers.length ? "NO" : "YES",
    needsHumanWatch: blockers.length > 0,
    checkedAt: now.toISOString(),
    taipeiCheckedAt: taipeiStamp(now),
    marketWindow,
    profile: PROFILE,
    strictLive: STRICT_LIVE,
    computer: COMPUTER_LABEL,
    productionUrl: BASE_URL,
    sourceSha: gitValue(["rev-parse", "HEAD"]),
    sourceBranch: gitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    sourceStatusShort: gitValue(["status", "--short"]),
    runtimeDir: RUNTIME_DIR,
    runVerifiers: RUN_VERIFIERS,
    requirements: {
      sourceCoverageFields: [
        "fresh_quote_coverage_120s",
        "today_1m_symbols",
        "ready_ge_35",
        "latest_candle_time",
        "intraday_1m_stale_seconds",
        "preopen_coverage",
        "daily_volume_freshness",
        "fallbackUsed",
      ],
      publishRule: "If source coverage is degraded or critical, preserve latest, do not overwrite complete run, and alert.",
      fieldRule: "All returned API rows are checked; blank groups are blockers.",
    },
    strategies,
    blockers,
    warnings,
    outputFile: OUT_FILE,
    markdownFile: MD_FILE,
  };
  writeOutputs(scorecard);
  console.log(`[api-unattended] unattendedStatus=${scorecard.unattendedStatus} strategies=${strategies.length} blockers=${blockers.length} warnings=${warnings.length}`);
  console.log(`[api-unattended] json=${OUT_FILE}`);
  console.log(`[api-unattended] md=${MD_FILE}`);
  if (blockers.length && !NO_FAIL) process.exitCode = 1;
}

main().catch((error) => {
  const payload = {
    ok: false,
    unattendedStatus: "NO",
    needsHumanWatch: true,
    checkedAt: new Date().toISOString(),
    taipeiCheckedAt: taipeiStamp(new Date()),
    computer: COMPUTER_LABEL,
    productionUrl: BASE_URL,
    sourceSha: gitValue(["rev-parse", "HEAD"]),
    blockers: [`api-unattended-scorecard-error: ${error?.message || String(error)}`],
    error: error?.stack || error?.message || String(error),
  };
  writeOutputs({ ...payload, strategies: [], warnings: [] });
  console.error(`[api-unattended] failed: ${payload.blockers[0]}`);
  if (!NO_FAIL) process.exitCode = 1;
});
