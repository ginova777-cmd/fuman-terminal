"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_FILE = process.env.FUMAN_BATTLE_READINESS_OUT
  || path.join(RUNTIME_DIR, "battle-readiness-latest.json");

const CHECKS = [
  {
    key: "strategy1",
    label: "Strategy1",
    script: "scripts/verify-strategy1-battle-state.js",
    normalize: normalizeStrategy1,
  },
  {
    key: "strategy2",
    label: "Strategy2",
    script: "scripts/verify-strategy2-battle-state.js",
    normalize: normalizeStrategy2,
  },
  {
    key: "strategy3",
    label: "Strategy3",
    script: "scripts/verify-strategy3-battle-state.js",
    normalize: normalizeStrategy3,
  },
  {
    key: "strategy4",
    label: "Strategy4",
    script: "scripts/verify-strategy4-standard-gate.js",
    args: ["--json"],
    normalize: normalizeStrategy4,
  },
  {
    key: "strategy5_institution",
    label: "Strategy5 / institution",
    script: "scripts/verify-strategy5-battle-state.js",
    normalize: normalizeStrategy5Institution,
  },
  {
    key: "warrant",
    label: "Warrant",
    script: "scripts/verify-warrant-battle-state.js",
    normalize: normalizeGateBased,
  },
  {
    key: "cb",
    label: "CB",
    script: "scripts/verify-cb-battle-state.js",
    normalize: normalizeGateBased,
  },
];

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function bool(value) {
  return value === true;
}

function allowedStatus(status) {
  return ["ready", "stale", "not_ready", "failed"].includes(String(status || "").toLowerCase());
}

function taipeiMinute(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function isOffSession(date = new Date()) {
  const minute = taipeiMinute(date);
  return minute < 8 * 60 + 30 || minute > 13 * 60 + 40;
}

function protectedOffSessionRow(row) {
  if (process.env.FUMAN_BATTLE_STRICT_LIVE === "1" || !isOffSession()) return false;
  if (!["strategy2", "strategy3"].includes(row.key)) return false;
  const text = [
    row.status,
    row.reason,
    ...(Array.isArray(row.issues) ? row.issues.map((item) => typeof item === "string" ? item : JSON.stringify(item)) : []),
    ...(Array.isArray(row.warnings) ? row.warnings.map((item) => typeof item === "string" ? item : JSON.stringify(item)) : []),
    row.stderr,
  ].join(" ");
  return /api_not_ok|source|stale|not_ready|non-trading|off_session|insufficient|fallback|publishAllowed_false|preservePreviousGood|degradedBlocksLatest/i.test(text);
}

function rowPasses(row) {
  return (row.ok && row.dataExists && row.healthViewCorrect && row.terminalKeysVisible)
    || protectedOffSessionRow(row);
}

function parseJsonOutput(stdout = "") {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function runCheck(check) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [check.script, ...(check.args || [])], {
    cwd: ROOT,
    env: {
      ...process.env,
      FUMAN_RUNTIME_DIR: RUNTIME_DIR,
    },
    encoding: "utf8",
    windowsHide: true,
    timeout: Number(process.env.FUMAN_BATTLE_VERIFY_TIMEOUT_MS || 180000),
  });
  const payload = parseJsonOutput(result.stdout);
  const normalized = payload
    ? check.normalize(payload)
    : {
        dataExists: false,
        healthViewCorrect: false,
        terminalKeysVisible: false,
        status: "failed",
        reason: "verifier did not return JSON",
        runId: "",
        count: 0,
        updatedAt: "",
      };
  const issues = Array.isArray(payload?.issues) ? payload.issues : [];
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  return {
    key: check.key,
    strategy: check.label,
    script: check.script,
    ok: result.status === 0 && payload?.ok === true,
    exitCode: result.status,
    dataExists: Boolean(normalized.dataExists),
    healthViewCorrect: Boolean(normalized.healthViewCorrect),
    terminalKeysVisible: Boolean(normalized.terminalKeysVisible),
    status: normalized.status || (result.status === 0 ? "ready" : "failed"),
    reason: normalized.reason || issues.map((item) => typeof item === "string" ? item : item.id || JSON.stringify(item)).join("; "),
    runId: normalized.runId || "",
    count: cleanNumber(normalized.count),
    updatedAt: normalized.updatedAt || payload?.checkedAt || startedAt,
    warnings,
    issues,
    stderr: String(result.stderr || "").trim().slice(0, 1200),
    rawSummary: normalized.rawSummary || {},
  };
}

function normalizeGateBased(payload = {}) {
  const gate = payload.gate || {};
  const health = payload.details?.scannerResourceHealth || {};
  const completeRun = payload.details?.completeRun || {};
  const api = payload.details?.api?.strict || payload.details?.api || {};
  return {
    dataExists: bool(gate.dataExists),
    healthViewCorrect: bool(gate.healthViewCorrect),
    terminalKeysVisible: bool(gate.terminalKeysVisible),
    status: health.status || (payload.ok ? "ready" : "failed"),
    reason: health.reason || payload.issues?.[0]?.id || "",
    runId: completeRun.run?.runId || api.runId || health.run_id || "",
    count: completeRun.resultRows || api.count || health.row_count || 0,
    updatedAt: health.updated_at || completeRun.run?.updatedAt || payload.checkedAt || "",
    rawSummary: {
      scannerBehavior: gate.scannerBehavior || "",
      contract: payload.contract || "",
    },
  };
}

function normalizeStrategy1(payload = {}) {
  const details = payload.details || {};
  const health = details.health || {};
  const results = details.results || {};
  const readyContract = details.readyStatusContract || {};
  const status = String(health.status || "").toLowerCase();
  const healthOk = Boolean(health.strategy)
    && allowedStatus(status)
    && (status === "ready" || Boolean(String(health.reason || "").trim()));
  return {
    dataExists: payload.ok === true && Boolean(details.latestRun?.runId) && cleanNumber(results.exactCount || results.visibleRows) > 0,
    healthViewCorrect: healthOk && (!readyContract.normalizedMissingFields || readyContract.normalizedMissingFields.length === 0),
    terminalKeysVisible: payload.ok === true
      && cleanNumber(results.missingRunId) === 0
      && cleanNumber(results.missingCode) === 0
      && cleanNumber(results.missingDecision) === 0,
    status: health.status || (payload.ok ? "ready" : "failed"),
    reason: health.reason || details.api?.reason || "",
    runId: details.latestRun?.runId || details.api?.runId || "",
    count: results.exactCount || details.api?.resultCount || details.api?.count || 0,
    updatedAt: health.updated_at || details.latestRun?.updatedAt || payload.checkedAt || "",
  };
}

function normalizeStrategy2(payload = {}) {
  const details = payload.details || {};
  const health = details.health || {};
  const status = String(health.status || "").toLowerCase();
  const resultRows = details.resultRows || {};
  const counts = details.counts || {};
  const cacheRows = cleanNumber(counts.cacheRows || details.cache?.totalRows || details.cache?.rows);
  const viewRows = cleanNumber(counts.viewRows || details.view?.totalRows || details.view?.rows);
  const rpcRows = cleanNumber(counts.rpcRows || details.rpc?.totalRows || details.rpc?.rows);
  const anySourceRows = Math.max(cacheRows, viewRows, rpcRows, cleanNumber(health.row_count));
  const eventRows = cleanNumber(resultRows.eventRows || resultRows.exactCount);
  return {
    dataExists: payload.ok === true && anySourceRows > 0 && (eventRows > 0 || cleanNumber(details.api?.count) > 0),
    healthViewCorrect: Boolean(health.strategy) && allowedStatus(status) && (status === "ready" || Boolean(String(health.reason || "").trim())),
    terminalKeysVisible: payload.ok === true && Boolean(details.latestRun?.runId) && resultRows.ok !== false,
    status: health.status || (payload.ok ? "ready" : "failed"),
    reason: health.reason || details.session?.quoteStatus || "",
    runId: details.latestRun?.runId || details.api?.runId || "",
    count: eventRows || details.api?.count || health.row_count || 0,
    updatedAt: health.updated_at || details.latestRun?.updatedAt || payload.checkedAt || "",
  };
}

function normalizeStrategy3(payload = {}) {
  const details = payload.details || {};
  const health = details.health || {};
  const results = details.results || {};
  const run = details.run || {};
  const api = details.api || {};
  const runResultCount = cleanNumber(run.resultCount || run.result_count);
  const apiCount = cleanNumber(api.count);
  const exactCount = cleanNumber(results.exactCount);
  const visibleRows = cleanNumber(results.visibleRows);
  const resultRows = exactCount || visibleRows;
  const expectedCount = runResultCount || resultRows || apiCount;
  const countsAligned = expectedCount > 0
    && apiCount === expectedCount
    && resultRows === expectedCount
    && visibleRows === expectedCount;
  const scanCoverage = run.scanCoverage || {};
  const sourceDriftHealth = run.sourceDriftHealth || {};
  const publishedSelfTest = run.publishedSelfTest || {};
  return {
    dataExists: payload.ok === true && countsAligned,
    healthViewCorrect: payload.ok === true
      && health.status === "ready"
      && scanCoverage.completeScan === true
      && sourceDriftHealth.status === "ready"
      && publishedSelfTest.ok === true,
    terminalKeysVisible: payload.ok === true && resultRows > 0 && cleanNumber(results.tvBreakdownRows) === resultRows,
    status: health.status || (payload.ok ? "ready" : "failed"),
    reason: health.reason || "",
    runId: run.runId || api.runId || "",
    count: resultRows || apiCount || 0,
    updatedAt: run.updatedAt || payload.checkedAt || "",
    rawSummary: {
      runResultCount,
      apiCount,
      resultRows,
      tvBreakdownRows: cleanNumber(results.tvBreakdownRows),
      completeScan: scanCoverage.completeScan === true,
      sourceDrift: sourceDriftHealth.status || "",
    },
  };
}

function normalizeStrategy4(payload = {}) {
  const details = payload.details || {};
  const health = details.resourceHealth || {};
  const run = details.latestCompleteRun || {};
  const published = details.publishedResults || {};
  const api = details.api || {};
  const terminal = Array.isArray(details.terminal) ? details.terminal : [];
  return {
    dataExists: payload.ok === true
      && Boolean(run.run_id)
      && cleanNumber(run.result_count) > 0
      && cleanNumber(published.rows) === cleanNumber(run.result_count),
    healthViewCorrect: payload.ok === true && health.status === "ready",
    terminalKeysVisible: payload.ok === true
      && cleanNumber(published.missingBreakdown) === 0
      && terminal.every((item) => item.ok === true),
    status: health.status || (payload.ok ? "ready" : "failed"),
    reason: health.reason || "",
    runId: run.run_id || api.runId || published.runId || "",
    count: run.result_count || api.count || published.rows || 0,
    updatedAt: health.updatedAt || health.updated_at || run.finished_at || payload.checkedAt || "",
  };
}

function normalizeStrategy5Institution(payload = {}) {
  const details = payload.details || {};
  const health = details.health || {};
  const source = details.sourceHealth || {};
  const s5 = details.runs?.strategy5 || {};
  const inst = details.runs?.institution || {};
  const s5Stats = s5.keyStats || {};
  const instStats = inst.keyStats || {};
  const s5Rows = cleanNumber(s5.fetchedRows);
  const instRows = cleanNumber(inst.fetchedRows);
  const s5KeysVisible = ["code", "name", "score", "chip"].every((key) => cleanNumber(s5Stats[key]) === s5Rows);
  const instKeysVisible = ["code", "foreign", "trust", "dealer", "total"].every((key) => cleanNumber(instStats[key]) === instRows);
  return {
    dataExists: payload.ok === true
      && cleanNumber(s5.resultRows) > 0
      && cleanNumber(inst.resultRows) > 0
      && source.coverageStatus === "ready",
    healthViewCorrect: payload.ok === true && health.status === "ready" && source.coverageStatus === "ready",
    terminalKeysVisible: payload.ok === true && s5KeysVisible && instKeysVisible,
    status: health.status || (payload.ok ? "ready" : "failed"),
    reason: health.reason || source.reason || "",
    runId: s5.run?.runId || inst.run?.runId || "",
    count: cleanNumber(s5.resultRows) + cleanNumber(inst.resultRows),
    updatedAt: health.updated_at || s5.run?.updatedAt || inst.run?.updatedAt || payload.checkedAt || "",
  };
}

function pad(value, width) {
  const text = String(value ?? "");
  const length = [...text].length;
  return text + " ".repeat(Math.max(0, width - length));
}

function printTable(rows) {
  const tableRows = rows.map((row) => ({
    strategy: row.strategy,
    dataExists: row.dataExists ? "true" : "false",
    healthViewCorrect: row.healthViewCorrect ? "true" : "false",
    terminalKeysVisible: row.terminalKeysVisible ? "true" : "false",
    status: row.status,
    count: row.count,
    runId: row.runId,
    reason: row.reason || "",
  }));
  const columns = ["strategy", "dataExists", "healthViewCorrect", "terminalKeysVisible", "status", "count", "runId", "reason"];
  const widths = Object.fromEntries(columns.map((column) => [
    column,
    Math.min(48, Math.max(column.length, ...tableRows.map((row) => [...String(row[column] ?? "")].length))),
  ]));
  process.stdout.write(`${columns.map((column) => pad(column, widths[column])).join(" | ")}\n`);
  process.stdout.write(`${columns.map((column) => "-".repeat(widths[column])).join("-|-")}\n`);
  for (const row of tableRows) {
    process.stdout.write(`${columns.map((column) => {
      const value = String(row[column] ?? "");
      const clipped = [...value].length > widths[column] ? `${[...value].slice(0, widths[column] - 1).join("")}…` : value;
      return pad(clipped, widths[column]);
    }).join(" | ")}\n`);
  }
}

function main() {
  const rows = CHECKS.map(runCheck);
  const summary = {
    ok: rows.every(rowPasses),
    checkedAt: new Date().toISOString(),
    contract: "daily-battle-readiness-table-v1",
    rows: rows.map((row) => ({
      ...row,
      acceptedAsProtectedOffSession: protectedOffSessionRow(row),
    })),
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  printTable(rows);
  process.stdout.write(`\njson=${OUT_FILE}\n`);
  if (!summary.ok) process.exit(1);
}

main();
