const { readSnapshot } = require("../lib/supabase-snapshots");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const { verifyScorecardStrategyRules } = require("../lib/scorecard-rule-locks");

const SNAPSHOT_KEY = process.env.FUMAN_SCORECARD_SNAPSHOT_KEY || "scorecard_latest";
const TERMINAL_SCORECARD_SOURCE = "terminal-complete-run-scorecard";
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
const STRATEGY_SOURCE_REPORT_KEYS = {
  "策略1開盤入成績單": "strategy1",
  "策略2成績單": "strategy2",
  "策略3隔日沖成績單": "strategy3",
  "策略4成績單": "strategy4",
  "策略5成績單": "strategy5",
  "買賣超成績單": "institution",
  "權證成績單": "warrant",
  "CB成績單": "cb",
  "即時雷達成績單": "realtime-radar",
};

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function normalizedDate(value) {
  const text = cleanText(value);
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return "";
}

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function scorecardFreshnessRequirement(request, now = new Date()) {
  const parts = taipeiParts(now);
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  const taipeiMinute = hour * 60 + minute;
  const cutoffMinute = Math.max(0, Number(process.env.FUMAN_SCORECARD_HEALTH_REQUIRED_AFTER_MINUTE || (14 * 60 + 5)));
  const weekday = cleanText(parts.weekday).toLowerCase();
  const weekend = weekday.startsWith("sat") || weekday.startsWith("sun");
  const query = request.query || {};
  const allowStale = cleanText(query.allowStale || query.allowPrevious || "") === "1"
    || process.env.FUMAN_SCORECARD_HEALTH_ALLOW_STALE === "1";
  const expectedDate = `${parts.year}-${parts.month}-${parts.day}`;
  const afterCutoff = taipeiMinute >= cutoffMinute;
  const required = !allowStale && !weekend && afterCutoff;
  return {
    required,
    expectedDate,
    taipeiTime: `${parts.hour}:${parts.minute}:${parts.second}`,
    taipeiMinute,
    cutoffMinute,
    weekend,
    allowStale,
    reason: required ? "weekday_after_1405_requires_today_scorecard" : "not_required",
  };
}

function strictSourceHealthRequired(request) {
  const query = request.query || {};
  return cleanText(query.strictSources || query.strict || "") === "1"
    || process.env.FUMAN_SCORECARD_HEALTH_STRICT_SOURCES === "1";
}

function scorecardDateMatches(summary, payload, requirement) {
  if (!requirement.required) return true;
  const dates = [
    summary?.latestDate,
    payload?.latestDate,
    payload?.marketDate,
    payload?.snapshot?.tradeDate,
  ].map(normalizedDate).filter(Boolean);
  return dates.includes(requirement.expectedDate);
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

function sourceHealthFromBundle(bundle, key, pathname) {
  const summary = bundle?.summary && typeof bundle.summary === "object" ? bundle.summary : {};
  const endpoints = bundle?.endpoints && typeof bundle.endpoints === "object" ? bundle.endpoints : {};
  const pathnameBase = cleanText(pathname).split("?")[0];
  const candidates = [...Object.entries(summary), ...Object.entries(endpoints)];
  const found = candidates.find(([candidate]) => {
    const text = cleanText(candidate);
    return text === pathname || text.startsWith(`${pathname}&`) || text.startsWith(`${pathnameBase}?`) || text === pathnameBase;
  })?.[1];
  if (!found || typeof found !== "object") return null;
  const rows = arrayFromPayload(found);
  const rowCount = rows.length || cleanNumber(found.count || found.total || found.resultCount || found.returnedCount || found.summary?.rows);
  return {
    ok: found.ok !== false && rowCount > 0,
    status: 200,
    payloadOk: found.ok !== false,
    rows: rowCount,
    runId: cleanText(found.runId || found.run_id || found.meta?.runId),
    updatedAt: cleanText(found.updatedAt || found.updated_at || found.generatedAt),
    source: cleanText(found.source || found.cacheSource),
    elapsedMs: cleanNumber(bundle.elapsedMs),
    error: "",
    via: "terminal-fast-bundle",
    bundleKey: key,
  };
}

function strategyBreakdown(records) {
  const byStrategy = {};
  for (const row of Array.isArray(records) ? records : []) {
    const strategy = cleanText(row.strategy || "未分類");
    byStrategy[strategy] = (byStrategy[strategy] || 0) + 1;
  }
  return byStrategy;
}

function sourceReportForStrategy(payload, strategy) {
  const key = STRATEGY_SOURCE_REPORT_KEYS[strategy] || "";
  const reports = Array.isArray(payload?.sourceReports) ? payload.sourceReports : [];
  return reports.find((report) => cleanText(report?.key).toLowerCase() === key);
}

function isCompleteEmptySourceReport(report) {
  if (!report || typeof report !== "object") return false;
  const evidenceStatus = cleanText(report.evidenceStatus).toLowerCase();
  const unattendedStatus = cleanText(report.unattendedStatus).toUpperCase();
  const count = cleanNumber(report.count ?? report.emittedRows ?? report.resultCount ?? report.readbackCount);
  return Boolean(cleanText(report.runId))
    && report.ok !== false
    && report.publishAllowed === true
    && (evidenceStatus === "complete" || evidenceStatus === "sufficient")
    && (unattendedStatus === "YES" || unattendedStatus === "")
    && count === 0;
}

function blockedStrategiesFromPayload(payload) {
  const fromSummary = Array.isArray(payload?.summary?.blockedStrategies) ? payload.summary.blockedStrategies : [];
  const fromReports = (Array.isArray(payload?.sourceReports) ? payload.sourceReports : [])
    .filter((report) => {
      const evidenceStatus = cleanText(report?.evidenceStatus).toLowerCase();
      return report?.ok === false
        || report?.publishAllowed === false
        || evidenceStatus === "insufficient"
        || evidenceStatus === "source_quality_fail";
    })
    .map((report) => cleanText(report?.strategy))
    .filter(Boolean);
  return [...new Set([...fromSummary.map(cleanText), ...fromReports])].filter(Boolean);
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
  const blockedStrategies = blockedStrategiesFromPayload(payload);
  const rawMissingStrategies = EXPECTED_STRATEGIES.filter((strategy) => !byStrategy[strategy]);
  const emptyCompleteStrategies = rawMissingStrategies.filter((strategy) => isCompleteEmptySourceReport(sourceReportForStrategy(payload, strategy)));
  const missingStrategies = rawMissingStrategies.filter((strategy) => !emptyCompleteStrategies.includes(strategy) && !blockedStrategies.includes(strategy));
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
    rawMissingStrategies,
    emptyCompleteStrategies,
    blockedStrategies,
    suppressedRows: cleanNumber(payload?.summary?.suppressedRows),
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

function missingStrategiesCoveredByEmptyComplete(summary, peerSummary) {
  const missing = Array.isArray(summary?.missingStrategies) ? summary.missingStrategies : [];
  if (!missing.length) return true;
  const covered = new Set(Array.isArray(peerSummary?.emptyCompleteStrategies) ? peerSummary.emptyCompleteStrategies : []);
  return missing.every((strategy) => covered.has(strategy));
}

function strategy2OutOfWindowCovered(summary, peerSummary) {
  const count = cleanNumber(summary?.strategy2OutOfWindow);
  if (count <= 0) return true;
  const blocked = new Set(Array.isArray(peerSummary?.blockedStrategies) ? peerSummary.blockedStrategies : []);
  return blocked.has("策略2成績單") && cleanNumber(peerSummary?.suppressedRows) >= count;
}

async function fetchSupabaseTable(table) {
  const url = terminalSupabaseUrl();
  const key = terminalSupabaseKey();
  if (!url || !key) return { ok: false, reason: "missing_supabase_credentials", rows: 0 };
  const dateColumn = table === "strategy_daily_summary" ? "summary_date" : "record_date";
  const endpoint = `${url}/rest/v1/${table}?select=${dateColumn},updated_at,source&source=eq.${encodeURIComponent(TERMINAL_SCORECARD_SOURCE)}&order=${dateColumn}.desc&limit=5`;
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
      source: TERMINAL_SCORECARD_SOURCE,
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
  const bundle = await fetchJson(`${baseUrl}/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&health=${Date.now()}`, 30000);
  const entries = await Promise.all(SOURCE_ENDPOINTS.map(async ([key, pathname]) => {
    const bundled = bundle.ok ? sourceHealthFromBundle(bundle.json, key, pathname) : null;
    if (bundled) return [key, bundled];
    const result = await fetchJson(`${baseUrl}${pathname}${pathname.includes("?") ? "&" : "?"}health=${Date.now()}`, 30000);
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
      via: "direct-endpoint",
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
  const strictSources = strictSourceHealthRequired(request);
  const sources = strictSources ? await sourceEndpointHealth(baseUrl) : {};
  const tradeRecords = await fetchSupabaseTable("trade_records");
  const dailySummary = await fetchSupabaseTable("strategy_daily_summary");
  const snapshot = await readSnapshot(SNAPSHOT_KEY, { allowLatestFallback: true, timeoutMs: 30000 }).catch((error) => ({ error }));
  const snapshotPayload = snapshot?.payload || null;
  const snapshotSummary = summarizeScorecard(snapshotPayload || {});
  const scorecardApi = await fetchJson(`${baseUrl}/api/scorecard?health=${Date.now()}`, 30000);
  const scorecardSummary = summarizeScorecard(scorecardApi.json || {});
  const snapshotMissingCovered = missingStrategiesCoveredByEmptyComplete(snapshotSummary, scorecardSummary);
  const apiMissingCovered = missingStrategiesCoveredByEmptyComplete(scorecardSummary, snapshotSummary);
  const snapshotStrategy2OutOfWindowCovered = strategy2OutOfWindowCovered(snapshotSummary, scorecardSummary);
  const apiStrategy2OutOfWindowCovered = strategy2OutOfWindowCovered(scorecardSummary, snapshotSummary);
  const freshnessRequirement = scorecardFreshnessRequirement(request);
  const sourceDatesOk = !freshnessRequirement.required
    || (
      normalizedDate(tradeRecords.latestDate) === freshnessRequirement.expectedDate
      && normalizedDate(dailySummary.latestDate) === freshnessRequirement.expectedDate
    );
  const snapshotDateOk = scorecardDateMatches(snapshotSummary, {
    ...snapshotPayload,
    snapshot: {
      tradeDate: snapshot?.tradeDate || snapshotPayload?.snapshot?.tradeDate || "",
    },
  }, freshnessRequirement);
  const apiDateOk = scorecardDateMatches(scorecardSummary, scorecardApi.json || {}, freshnessRequirement);
  const page = await fetchText(`${baseUrl}/88?health=${Date.now()}`, 30000);
  const pageBody = page.text || "";
  const pageChecks = {
    historyDate: pageBody.includes("scorecard-history-date"),
    themeToggle: pageBody.includes("scorecard-theme-toggle"),
    noBasisPanel: !pageBody.includes("scorecard-basis"),
    pnlMultiplier: /PNL_MULTIPLIER\s*=\s*1000/.test(pageBody),
    symbolTheme: pageBody.includes("☀") && pageBody.includes("☾") && pageBody.includes("#facc15"),
  };
  const sourceOk = strictSources ? Object.values(sources).every((item) => item.ok) : true;
  const snapshotOk = Boolean(snapshotPayload)
    && snapshotSummary.cacheSource === "supabase-snapshot"
    && snapshotSummary.rows > 0
    && snapshotDateOk
    && snapshotMissingCovered
    && snapshotSummary.missingRequiredFields === 0
    && snapshotStrategy2OutOfWindowCovered
    && snapshotSummary.strategy3BadEntry === 0
    && snapshotSummary.cbBad === 0
    && snapshotSummary.strategyRules.ok;
  const apiOk = scorecardApi.ok
    && scorecardSummary.cacheSource === "supabase-snapshot"
    && scorecardSummary.rows > 0
    && apiDateOk
    && apiMissingCovered
    && scorecardSummary.missingRequiredFields === 0
    && apiStrategy2OutOfWindowCovered
    && scorecardSummary.strategy3BadEntry === 0
    && scorecardSummary.cbBad === 0
    && scorecardSummary.strategyRules.ok;
  const pageOk = page.ok && Object.values(pageChecks).every(Boolean);
  const directSourceOk = tradeRecords.ok && dailySummary.ok && sourceDatesOk;
  const scorecardPageChainOk = snapshotOk && apiOk && snapshotDateOk && apiDateOk;
  const stages = {
    sources: stage(sourceOk, strictSources ? {
      required: true,
      endpoints: sources,
    } : {
      required: false,
      status: "not_required_for_scorecard_page",
      note: "Use ?strictSources=1 to include live strategy endpoint patrol. Default /88 health is limited to scorecard snapshot/API/page freshness.",
    }),
    supabaseSource: stage(strictSources ? directSourceOk : scorecardPageChainOk, {
      required: strictSources,
      status: strictSources ? "strict_direct_table_check" : "covered_by_scorecard_latest_snapshot",
      freshness: { ...freshnessRequirement, dateOk: strictSources ? sourceDatesOk : (snapshotDateOk && apiDateOk) },
      tradeRecords,
      dailySummary,
      snapshotSource: {
        exportSource: cleanText(snapshotPayload?.exportSource || snapshotPayload?.sourceFields?.exportSource),
        sourceQuery: snapshotPayload?.sourceQuery || null,
        runId: cleanText(snapshotPayload?.runId),
        updatedAt: cleanText(snapshotPayload?.updatedAt),
      },
    }),
    scorecardLatest: stage(snapshotOk, {
      key: snapshot?.key || SNAPSHOT_KEY,
      tradeDate: snapshot?.tradeDate || "",
      updatedAt: snapshot?.updatedAt || "",
      freshness: { ...freshnessRequirement, dateOk: snapshotDateOk },
      missingStrategiesCoveredByApiSourceReports: snapshotMissingCovered,
      strategy2OutOfWindowCoveredByApiSuppression: snapshotStrategy2OutOfWindowCovered,
      summary: snapshotSummary,
    }),
    apiScorecard: stage(apiOk, { status: scorecardApi.status, elapsedMs: scorecardApi.elapsedMs, freshness: { ...freshnessRequirement, dateOk: apiDateOk }, missingStrategiesCoveredBySnapshotSourceReports: apiMissingCovered, strategy2OutOfWindowCoveredBySnapshotSuppression: apiStrategy2OutOfWindowCovered, summary: scorecardSummary }),
    scorecardFreshness: stage(snapshotDateOk && apiDateOk, {
      ...freshnessRequirement,
      snapshotLatestDate: snapshotSummary.latestDate,
      apiLatestDate: scorecardSummary.latestDate,
      snapshotDateOk,
      apiDateOk,
    }),
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
