const { readSnapshot } = require("../lib/supabase-snapshots");
const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");
const { verifyScorecardStrategyRules } = require("../lib/scorecard-rule-locks");

const SNAPSHOT_KEY = process.env.FUMAN_SCORECARD_SNAPSHOT_KEY || "scorecard_latest";
const SOURCE_ENDPOINTS = [
  ["strategy1", "/api/open-buy-latest?canvas=1&compact=1&shell=1&limit=120"],
  ["strategy2", "/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=240"],
  ["strategy3", "/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=60"],
  ["strategy4", "/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70"],
  ["strategy5", "/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=70"],
  ["institution", "/api/institution-latest?canvas=1&compact=1&shell=1&limit=120"],
  ["warrant", "/api/warrant-flow-latest?canvas=1&compact=1&shell=1&limit=120"],
  ["cb", "/api/cb-detect-latest?canvas=1&compact=1&shell=1&limit=120"],
  ["realtime-radar", "/api/realtime-radar-latest?compact=1&shell=1&limit=80"],
];
const EXPECTED_STRATEGIES = [
  "策略1開盤入成績單",
  "策略2成績單",
  "策略3隔日沖成績單",
  "策略4成績單",
  "策略5成績單",
  "買賣超成績單",
  "權證成績單",
  "CB成績單",
  "即時雷達成績單",
];

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function absoluteBaseUrl(request) {
  const configured = process.env.FUMAN_SCORECARD_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "";
  if (configured) return configured.replace(/\/+$/, "");
  const host = request.headers["x-forwarded-host"] || request.headers.host || "fuman-terminal.vercel.app";
  const proto = request.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

async function fetchText(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: { "cache-control": "no-cache" },
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      headers: Object.fromEntries(response.headers.entries()),
      text,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      error: error?.message || String(error),
      text: "",
      headers: {},
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = 12000) {
  const result = await fetchText(url, timeoutMs);
  if (!result.text) return { ...result, json: null };
  try {
    return { ...result, json: JSON.parse(result.text) };
  } catch (error) {
    return { ...result, ok: false, json: null, error: `invalid_json: ${error.message}` };
  }
}

function arrayFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.matches)) return payload.matches;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.records)) return payload.data.records;
  if (Array.isArray(payload?.payload?.records)) return payload.payload.records;
  return [];
}

function strategyBreakdown(records) {
  const byStrategy = {};
  for (const row of Array.isArray(records) ? records : []) {
    const strategy = cleanText(row.strategy || "未分類");
    byStrategy[strategy] = (byStrategy[strategy] || 0) + 1;
  }
  return byStrategy;
}

function timeMinutes(value) {
  const match = cleanText(value).match(/(?:^|T|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function summarizeScorecard(payload) {
  const records = arrayFromPayload(payload);
  const latestDate = cleanText(payload?.latestDate || payload?.summary?.latestDate);
  const selectedRows = latestDate ? records.filter((row) => cleanText(row.record_date) === latestDate) : records;
  const byStrategy = strategyBreakdown(selectedRows);
  const missingStrategies = EXPECTED_STRATEGIES.filter((strategy) => !byStrategy[strategy]);
  const missingRequiredFields = selectedRows.filter((row) => [
    cleanText(row.record_date),
    cleanText(row.strategy),
    cleanText(row.ticker),
    cleanText(row.name),
    cleanText(row.entry_time),
    cleanNumber(row.entry_price) > 0,
    cleanNumber(row.high_price) > 0,
    row.pnl !== undefined && row.pnl !== null && cleanText(row.pnl) !== "",
    cleanText(row.reason),
  ].some((value) => !value)).length;
  const strategy2OutOfWindow = selectedRows
    .filter((row) => cleanText(row.strategy) === "策略2成績單")
    .filter((row) => {
      const minutes = timeMinutes(row.entry_time);
      return minutes === null || minutes < 9 * 60 || minutes > 12 * 60;
    }).length;
  const strategy3BadEntry = selectedRows
    .filter((row) => cleanText(row.strategy) === "策略3隔日沖成績單")
    .filter((row) => timeMinutes(row.entry_time) !== 13 * 60).length;
  const cbBad = selectedRows
    .filter((row) => cleanText(row.strategy) === "CB成績單")
    .filter((row) => !(cleanNumber(row.entry_price) > 0 && cleanNumber(row.high_price) > 0 && Number.isFinite(cleanNumber(row.pnl)))).length;
  const strategyRules = verifyScorecardStrategyRules(payload || {}, { source: "scorecard-health" });
  return {
    latestDate,
    rows: selectedRows.length,
    summaryRows: cleanNumber(payload?.summary?.rows),
    cacheSource: cleanText(payload?.cacheSource),
    historyDates: Array.isArray(payload?.historyDates) ? payload.historyDates : [],
    byStrategy,
    missingStrategies,
    missingRequiredFields,
    strategy2OutOfWindow,
    strategy3BadEntry,
    cbBad,
    strategyRules: {
      ok: strategyRules.ok,
      strict: strategyRules.strict,
      contract: strategyRules.contract,
      issues: strategyRules.issues,
      ruleGroupsByStrategy: strategyRules.ruleGroupsByStrategy,
    },
  };
}

async function fetchSupabaseTable(table) {
  const url = serverSupabaseUrl();
  const key = serverSupabaseKey();
  if (!url || !key) return { ok: false, reason: "missing_supabase_credentials", rows: 0 };
  const dateColumn = table === "strategy_daily_summary" ? "summary_date" : "record_date";
  const endpoint = `${url}/rest/v1/${table}?select=${dateColumn},updated_at,source&order=${dateColumn}.desc&limit=5`;
  const startedAt = Date.now();
  try {
    const response = await fetch(endpoint, {
      headers: { apikey: key, authorization: `Bearer ${key}`, accept: "application/json" },
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : [];
    const rows = Array.isArray(json) ? json : [];
    return {
      ok: response.ok && rows.length > 0,
      status: response.status,
      rows: rows.length,
      latestDate: cleanText(rows[0]?.[dateColumn]),
      updatedAt: cleanText(rows[0]?.updated_at),
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return { ok: false, status: 0, rows: 0, elapsedMs: Date.now() - startedAt, reason: error?.message || String(error) };
  }
}

function stage(ok, detail = {}) {
  return { ok: Boolean(ok), ...detail };
}

async function sourceEndpointHealth(baseUrl) {
  const entries = await Promise.all(SOURCE_ENDPOINTS.map(async ([key, pathname]) => {
    const result = await fetchJson(`${baseUrl}${pathname}${pathname.includes("?") ? "&" : "?"}health=${Date.now()}`, 15000);
    const payload = result.json || {};
    const rows = arrayFromPayload(payload);
    const rowCount = rows.length || cleanNumber(payload.count || payload.total || payload.summary?.rows);
    return [key, {
      ok: result.ok && rowCount > 0,
      status: result.status,
      payloadOk: payload?.ok !== false,
      rows: rowCount,
      runId: cleanText(payload.runId || payload.run_id || payload.meta?.runId),
      updatedAt: cleanText(payload.updatedAt || payload.updated_at || payload.generatedAt),
      source: cleanText(payload.source || payload.cacheSource),
      elapsedMs: result.elapsedMs,
      error: result.error || "",
    }];
  }));
  return Object.fromEntries(entries);
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const baseUrl = absoluteBaseUrl(request);
  const sources = await sourceEndpointHealth(baseUrl);
  const tradeRecords = await fetchSupabaseTable("trade_records");
  const dailySummary = await fetchSupabaseTable("strategy_daily_summary");
  const snapshot = await readSnapshot(SNAPSHOT_KEY, { allowLatestFallback: true, timeoutMs: 12000 }).catch((error) => ({ error }));
  const snapshotPayload = snapshot?.payload || null;
  const snapshotSummary = summarizeScorecard(snapshotPayload || {});
  const scorecardApi = await fetchJson(`${baseUrl}/api/scorecard?health=${Date.now()}`, 15000);
  const scorecardSummary = summarizeScorecard(scorecardApi.json || {});
  const page = await fetchText(`${baseUrl}/88?health=${Date.now()}`, 15000);
  const pageBody = page.text || "";
  const pageChecks = {
    historyDate: pageBody.includes("scorecard-history-date"),
    themeToggle: pageBody.includes("scorecard-theme-toggle"),
    noBasisPanel: !pageBody.includes("scorecard-basis"),
    pnlMultiplier: /PNL_MULTIPLIER\s*=\s*1000/.test(pageBody),
    symbolTheme: pageBody.includes("☀") && pageBody.includes("☾") && pageBody.includes("#facc15"),
  };
  const sourceOk = Object.values(sources).every((item) => item.ok);
  const snapshotOk = Boolean(snapshotPayload)
    && snapshotSummary.cacheSource === "supabase-snapshot"
    && snapshotSummary.rows > 0
    && snapshotSummary.missingStrategies.length === 0
    && snapshotSummary.missingRequiredFields === 0
    && snapshotSummary.strategy2OutOfWindow === 0
    && snapshotSummary.strategy3BadEntry === 0
    && snapshotSummary.cbBad === 0
    && snapshotSummary.strategyRules.ok;
  const apiOk = scorecardApi.ok
    && scorecardSummary.cacheSource === "supabase-snapshot"
    && scorecardSummary.rows > 0
    && scorecardSummary.missingStrategies.length === 0
    && scorecardSummary.missingRequiredFields === 0
    && scorecardSummary.strategy2OutOfWindow === 0
    && scorecardSummary.strategy3BadEntry === 0
    && scorecardSummary.cbBad === 0
    && scorecardSummary.strategyRules.ok;
  const pageOk = page.ok && Object.values(pageChecks).every(Boolean);
  const stages = {
    sources: stage(sourceOk, { endpoints: sources }),
    supabaseSource: stage(tradeRecords.ok && dailySummary.ok, { tradeRecords, dailySummary }),
    scorecardLatest: stage(snapshotOk, {
      key: snapshot?.key || SNAPSHOT_KEY,
      tradeDate: snapshot?.tradeDate || "",
      updatedAt: snapshot?.updatedAt || "",
      summary: snapshotSummary,
    }),
    apiScorecard: stage(apiOk, { status: scorecardApi.status, elapsedMs: scorecardApi.elapsedMs, summary: scorecardSummary }),
    page88: stage(pageOk, { status: page.status, elapsedMs: page.elapsedMs, checks: pageChecks }),
    scheduler: stage(true, { status: "not_applicable_on_vercel", note: "Windows Task Scheduler is verified by npm run verify:scorecard-no-rollback on the PC." }),
  };
  const issues = Object.entries(stages)
    .filter(([, value]) => !value.ok)
    .map(([name]) => name);
  const result = {
    ok: issues.length === 0,
    source: "scorecard-health",
    updatedAt: new Date().toISOString(),
    baseUrl,
    issues,
    stages,
  };
  if (request.method === "HEAD") {
    response.status(result.ok ? 200 : 503).end("");
    return;
  }
  response.status(result.ok ? 200 : 503).json(result);
};
