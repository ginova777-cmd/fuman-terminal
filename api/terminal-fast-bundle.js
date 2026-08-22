const market = require("./market");
const { buildMarketCalendarContract, attachMarketCalendar } = require("../lib/market-calendar-contract");
const stocks = require("./stocks");
const terminalHome = require("./terminal-home");
const strategy2Latest = require("./strategy2-latest");
const strategy3Latest = require("./strategy3-latest");
const strategy4Latest = require("./strategy4-latest");
const strategy5Latest = require("./strategy5-latest");
const latestSignals = require("./latest-signals");
const marketAiLive = require("./market-ai-live");
const institutionLatest = require("./institution-latest");
const desktopRouteSnapshot = require("./desktop-route-snapshot");
const watchlistMatchIndex = require("./watchlist-match-index");
const { shapeTopPayload } = require("./_http-cache");
const { readDesktopRouteSnapshot, readDesktopRouteSnapshotForRoute } = require("../lib/desktop-route-snapshot-cache");
const { buildLatestOpsStatus } = require("../lib/terminal-ops-status");
const { buildWatchlistMatchIndex } = require("../lib/watchlist-match-index-builder");
const { verifyRequestEntitlement } = require("../lib/server-entitlement-guard");
const { rateLimitRequest, sendRateLimited } = require("../lib/fuman-api-rate-limit");
const { fetchMainForceCosts, normalizeCode } = require("../lib/terminal-main-force-costs");
const FAST_BUNDLE_SNAPSHOT_TIMEOUT_MS = Math.max(500, Math.min(3000, Number(process.env.FUMAN_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS || 2200) || 2200));

function isPublicBundleEndpoint(endpoint) {
  const path = new URL(String(endpoint || "/"), "https://fuman.local").pathname;
  return path === "/api/market"
    || path === "/api/market-ai-live"
    || path === "/api/watchlist-match-index";
}

function sanitizePublicEndpointPayload(value) {
  const protectedPattern = /strategy[1-5]|open-buy|institution|latest-strategy|latest-signals/i;
  if (typeof value === "string") {
    return protectedPattern.test(value) ? value.replace(protectedPattern, "protected-source") : value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizePublicEndpointPayload(item));
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      if (protectedPattern.test(key)) continue;
      next[key] = sanitizePublicEndpointPayload(item);
    }
    return next;
  }
  return value;
}

function filterPublicBundlePayload(payload, entitlement) {
  if (entitlement?.ok) return payload;
  const endpoints = {};
  for (const [endpoint, endpointPayload] of Object.entries(payload?.endpoints || {})) {
    if (isPublicBundleEndpoint(endpoint)) {
      endpoints[endpoint] = sanitizePublicEndpointPayload(endpointPayload);
    }
  }
  const timings = {};
  for (const [endpoint, elapsedMs] of Object.entries(payload?.timings || {})) {
    if (isPublicBundleEndpoint(endpoint)) timings[endpoint] = elapsedMs;
  }
  return {
    ok: payload?.ok !== false,
    partial: Boolean(payload?.partial),
    source: payload?.source || "terminal-fast-bundle",
    cacheSource: payload?.cacheSource || "",
    snapshotHit: payload?.snapshotHit === true,
    snapshotFresh: payload?.snapshotFresh === true,
    updatedAt: payload?.updatedAt || new Date().toISOString(),
    elapsedMs: Number(payload?.elapsedMs || 0) || 0,
    protected: true,
    membershipRequired: true,
    protectedReason: entitlement?.reason || "missing_bearer_token",
    publicSurfaces: ["market-overview", "market-ai", "learning-plan"],
    endpoints,
    summary: Object.fromEntries(Object.entries(endpoints).map(([endpoint, endpointPayload]) => [endpoint, summarize(endpointPayload)])),
    misses: Array.isArray(payload?.misses) ? payload.misses.filter((endpoint) => isPublicBundleEndpoint(endpoint)) : [],
    timings,
    marketCalendar: payload?.marketCalendar || null,
    marketOpen: payload?.marketOpen,
    marketStatus: payload?.marketStatus || "",
    closedReason: payload?.closedReason || "",
    closedReasonText: payload?.closedReasonText || "",
    requestedDate: payload?.requestedDate || "",
    displayTradeDate: payload?.displayTradeDate || "",
    formalScanSkipped: payload?.formalScanSkipped === true,
    sourceFreshnessRequired: payload?.sourceFreshnessRequired !== false,
    preservePreviousGood: payload?.preservePreviousGood === true,
    latestPointerUpdated: payload?.latestPointerUpdated === true,
    emptyResultWritten: payload?.emptyResultWritten === true,
  };
}

function buildFastMembershipLockedBundle(entitlement, marketCalendar) {
  const updatedAt = new Date().toISOString();
  const endpoints = {
    '/api/market': { ok: true, protected: false, publicSurface: 'market-overview', rows: [], count: 0, source: 'membership-fast-shell', updatedAt },
    '/api/market-ai-live': { ok: true, protected: false, publicSurface: 'market-ai', rows: [], count: 0, source: 'membership-fast-shell', updatedAt },
  };
  return attachMarketCalendar({
    ok: true,
    partial: false,
    source: 'terminal-fast-bundle',
    cacheSource: 'membership-fast-shell',
    snapshotHit: true,
    snapshotFresh: true,
    updatedAt,
    elapsedMs: 0,
    protected: true,
    membershipRequired: true,
    protectedReason: entitlement?.reason || 'missing_bearer_token',
    publicSurfaces: ['market-overview', 'market-ai', 'learning-plan'],
    endpoints,
    summary: Object.fromEntries(Object.entries(endpoints).map(([endpoint, endpointPayload]) => [endpoint, summarize(endpointPayload)])),
    misses: [],
    timings: Object.fromEntries(Object.keys(endpoints).map((endpoint) => [endpoint, 0])),
    sourceFreshnessRequired: false,
    preservePreviousGood: true,
    latestPointerUpdated: false,
    emptyResultWritten: false,
  }, marketCalendar);
}

function createCaptureResponse(resolve, label) {
  let settled = false;
  const done = (statusCode, payload, headers = {}) => {
    if (settled) return;
    settled = true;
    resolve({ statusCode, payload, headers, label });
  };
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      done(this.statusCode || 200, payload, this.headers);
      return this;
    },
    send(payload) {
      done(this.statusCode || 200, payload, this.headers);
      return this;
    },
    end(payload = "") {
      done(this.statusCode || 204, payload, this.headers);
      return this;
    },
  };
}

function buildEndpoint(label, query = {}) {
  const url = new URL(label, "https://fuman.local");
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return `${url.pathname}${url.search}`;
}

function compactQuery(limit) {
  return {
    canvas: "1",
    compact: "1",
    shell: "1",
    limit: String(limit),
  };
}

const MAIN_FORCE_ENDPOINTS = new Set(["/api/strategy2-latest", "/api/strategy3-latest", "/api/strategy4-latest", "/api/strategy5-latest", "/api/institution-latest"]);
function mainForceRows(payload = {}) { for (const rows of [payload.rows, payload.matches, payload.results, payload.data]) if (Array.isArray(rows)) return rows; return []; }
function mainForceDataDate(payload = {}) { const value = String(payload.tradeDate || payload.scanDate || payload.usedDate || payload.dataDate || payload.date || "").slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value; if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`; return ""; }
async function attachMainForceCostsToEndpoints(endpoints = {}) {
  const groups = new Map();
  for (const [endpoint, payload] of Object.entries(endpoints)) {
    const pathname = new URL(String(endpoint || "/"), "https://fuman.local").pathname; if (!MAIN_FORCE_ENDPOINTS.has(pathname) || !payload || typeof payload !== "object") continue;
    if (payload.diagnosticReplay === true) { payload.mainForceCostContract = { contract: "terminal-main-force-costs-v1", skipped: "diagnostic_replay" }; continue; }
    const asOfDate = mainForceDataDate(payload), rows = mainForceRows(payload), codes = [...new Set(rows.map((row) => normalizeCode(row?.code || row?.symbol || row?.stock_id || row?.stockId)).filter(Boolean))];
    if (!asOfDate || !codes.length) continue; const group = groups.get(asOfDate) || { codes: new Set(), targets: [] }; codes.forEach((code) => group.codes.add(code)); group.targets.push({ payload, rows }); groups.set(asOfDate, group);
  }
  for (const [asOfDate, group] of groups) {
    try { const result = await fetchMainForceCosts({ codes: [...group.codes], asOf: asOfDate }), byCode = new Map((result.items || []).map((item) => [item.code, item])); for (const target of group.targets) { target.rows.forEach((row) => { const code = normalizeCode(row?.code || row?.symbol || row?.stock_id || row?.stockId); if (code) row.terminalMainForce = byCode.get(code) || null; }); target.payload.mainForceCostContract = { contract: "terminal-main-force-costs-v1", asOfDate, count: result.count, missingCount: result.missingCodes?.length || 0, source: result.source }; } }
    catch { for (const target of group.targets) { target.rows.forEach((row) => { row.terminalMainForce = null; }); target.payload.mainForceCostContract = { contract: "terminal-main-force-costs-v1", asOfDate, count: 0, missingCount: group.codes.size, source: "unavailable" }; } }
  }
}
function attachSnapshotMainForcePlaceholders(endpoints = {}) {
  for (const [endpoint, payload] of Object.entries(endpoints)) {
    const pathname = new URL(String(endpoint || "/"), "https://fuman.local").pathname;
    if (!MAIN_FORCE_ENDPOINTS.has(pathname) || !payload || typeof payload !== "object") continue;
    const rows = mainForceRows(payload);
    const asOfDate = mainForceDataDate(payload);
    let missingCount = 0;
    for (const row of rows) {
      if (!row || typeof row !== "object" || Object.prototype.hasOwnProperty.call(row, "terminalMainForce")) continue;
      const code = normalizeCode(row?.code || row?.symbol || row?.stock_id || row?.stockId);
      row.terminalMainForce = {
        code,
        tradeDate: asOfDate,
        status: "data_insufficient",
        mainForceCostPrice: null,
        mainForceNetBuy: null,
        mainForceBranchCount: 0,
        topBranches: [],
        overnight: { matched: false, costPrice: null, netBuy: null, status: "data_insufficient" },
        shortSwing: { matched: false, costPrice: null, netBuy: null, status: "data_insufficient" },
        daytrade: { matched: false, costPrice: null, netBuy: null, status: "data_insufficient" },
        source: "snapshot:client-hydration-pending",
        updatedAt: "",
      };
      missingCount += 1;
    }
    if (missingCount) {
      payload.mainForceCostContract = {
        contract: "terminal-main-force-costs-v1",
        asOfDate,
        count: 0,
        missingCount,
        source: "snapshot:client-hydration-pending",
      };
    }
  }
}
function callJson(label, handler, request, query = {}, timeoutMs = 5500) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const endpoint = buildEndpoint(label, query);
    const endpointUrl = new URL(endpoint, "https://fuman.local");
    const mergedQuery = {
      ...(request.query || {}),
      ...Object.fromEntries(endpointUrl.searchParams.entries()),
      fastBundle: "1",
      snapshotBuild: "1",
    };
    const timer = setTimeout(() => {
      resolve({
        statusCode: 504,
        payload: {
          ok: false,
          error: "fast_bundle_timeout",
          endpoint,
          timeoutMs,
        },
        headers: {},
        label: endpoint,
        elapsedMs: Date.now() - startedAt,
      });
    }, timeoutMs);
    const finish = (result) => {
      clearTimeout(timer);
      resolve({ ...result, elapsedMs: Date.now() - startedAt });
    };
    const capture = createCaptureResponse(finish, endpoint);
    const req = {
      ...request,
      method: "GET",
      fumanInternalVerify: true,
      url: buildEndpoint(endpoint, { fastBundle: "1", snapshotBuild: "1" }),
      query: mergedQuery,
    };
    Promise.resolve(handler(req, capture)).catch((error) => {
      finish({
        statusCode: 500,
        payload: {
          ok: false,
          error: "fast_bundle_handler_failed",
          endpoint,
          message: error?.message || String(error),
        },
        headers: {},
        label: endpoint,
      });
    });
  });
}

function opsModuleKeyForEndpoint(endpoint) {
  const path = new URL(String(endpoint || "/"), "https://fuman.local").pathname.toLowerCase();
  if (path.includes("strategy2-latest")) return "strategy2";
  if (path.includes("strategy3-latest")) return "strategy3";
  if (path.includes("strategy4-latest") || path.includes("latest-signals")) return "strategy4";
  if (path.includes("strategy5-latest")) return "strategy5";
  if (path.includes("institution-latest")) return "institution";
  return "";
}

function compactOpsAuthority(row = {}) {
  return {
    key: row.key || "",
    runId: row.runId || "",
    tradeDate: row.tradeDate || "",
    sourceDate: row.sourceDate || "",
    moduleStatus: row.moduleStatus || "",
    todayAuthoritative: row.todayAuthoritative === true,
    formalDisplayAllowed: row.formalDisplayAllowed === true,
    displayMode: row.displayMode || "",
    displayBlockReason: row.displayBlockReason || row.issue || "",
    pendingNotDue: row.pendingNotDue === true,
    evidenceStatus: row.evidenceStatus || "",
    publishAllowed: row.publishAllowed === true,
    fallback: row.fallback === true,
    resultCount: Number(row.resultCount || 0),
    readbackCount: Number(row.readbackCount || 0),
  };
}

function buildOpsAuthorityIndex() {
  const status = buildLatestOpsStatus();
  const modules = Array.isArray(status.modules) ? status.modules : [];
  const byKey = Object.fromEntries(modules.filter((row) => row?.key).map((row) => [row.key, compactOpsAuthority(row)]));
  return {
    contract: "terminal-display-authority-v1",
    source: status.source || "",
    tradeDate: status.tradeDate || "",
    state: status.state || "",
    unattendedStatus: status.unattendedStatus || "NO",
    generatedAt: status.generatedAt || new Date().toISOString(),
    byKey,
  };
}

function strategy2V3Authority(payload = {}) {
  const isFormal = payload.status === "complete"
    && payload.complete === true
    && payload.publishAllowed === true
    && payload.formalDisplayAllowed === true;
  const dataDate = String(payload.dataDate || payload.tradeDate || payload.date || "");
  const diagnostic = payload.status === "diagnostic_replay";
  return {
    key: "strategy2",
    runId: String(payload.runId || ""),
    tradeDate: dataDate,
    sourceDate: dataDate,
    moduleStatus: isFormal ? "complete" : diagnostic ? "diagnostic" : "waiting",
    todayAuthoritative: Boolean(dataDate),
    formalDisplayAllowed: isFormal,
    displayMode: isFormal ? "V3_FORMAL_COMPLETE" : diagnostic ? "V3_DIAGNOSTIC_VISIBLE_NOT_FORMAL" : "V3_WAITING_FOR_LIVE_SCAN",
    displayBlockReason: isFormal ? "" : String(payload.reason || "strategy2_v3_not_formal"),
    pendingNotDue: !dataDate,
    evidenceStatus: isFormal ? "complete" : diagnostic ? "diagnostic_only" : "waiting",
    publishAllowed: isFormal,
    fallback: false,
    resultCount: Number(payload.resultCount ?? payload.count ?? 0),
    readbackCount: Number(payload.resultCount ?? payload.count ?? 0),
  };
}

function strategy3V2DirectAuthority(payload = {}) {
  if (payload?.strategy !== "strategy3_v2") return null;
  const evidenceStatus = String(payload.evidenceStatus || payload.run_quality_at_publish?.evidenceStatus || "").toLowerCase();
  const unattendedStatus = String(payload.unattendedStatus || payload.run_quality_at_publish?.unattendedStatus || "").toUpperCase();
  const publishAllowed = payload.publishAllowed ?? payload.run_quality_at_publish?.publishAllowed;
  const complete = payload.complete === true || String(payload.status || "").toLowerCase() === "complete";
  if (!complete || publishAllowed !== true || evidenceStatus !== "complete" || unattendedStatus !== "YES" || payload.preservePreviousGood === true) return null;
  const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.matches) ? payload.matches : [];
  const count = Number(payload.count ?? payload.resultCount ?? rows.length) || rows.length;
  const tradeDate = String(payload.tradeDate || payload.trade_date || payload.scanDate || payload.usedDate || "").slice(0, 10);
  const runId = String(payload.runId || payload.run_id || "").trim();
  if (!runId.startsWith("strategy3v2-")) return null;
  return {
    ...(payload.terminalAuthority || {}),
    key: "strategy3",
    runId,
    tradeDate,
    sourceDate: tradeDate,
    moduleStatus: "complete",
    todayAuthoritative: true,
    formalDisplayAllowed: true,
    displayMode: "strategy3_v2_complete_run",
    displayBlockReason: "",
    pendingNotDue: false,
    evidenceStatus: "complete",
    publishAllowed: true,
    fallback: false,
    resultCount: count,
    readbackCount: rows.length,
  };
}

function terminalTaipeiDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function terminalNormalizeTradeDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return String(value || "").slice(0, 10);
}

function terminalRunIdTradeDate(runId) {
  const match = String(runId || "").match(/(?:^|-)20(\d{6})(?:-|$)/);
  return match ? `20${match[1]}` : "";
}

function institutionDirectAuthority(payload = {}) {
  const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.matches) ? payload.matches : [];
  const count = Number(payload.count ?? payload.resultCount ?? payload.returnedCount ?? rows.length) || rows.length;
  const runId = String(payload.runId || payload.run_id || payload.transport?.runId || "").trim();
  const tradeDate = terminalNormalizeTradeDate(payload.usedDate || payload.tradeDate || payload.scanDate || payload.date);
  const runDate = terminalNormalizeTradeDate(terminalRunIdTradeDate(runId));
  const today = terminalNormalizeTradeDate(terminalTaipeiDateKey());
  const evidenceStatus = String(payload.evidenceStatus || payload.run_quality_at_publish?.evidenceStatus || "").toLowerCase();
  const publishAllowed = payload.publishAllowed ?? payload.run_quality_at_publish?.publishAllowed;
  const complete = payload.complete === true || String(payload.status || "").toLowerCase() === "complete";
  if (!runId.startsWith("institution-") || runDate !== today || tradeDate !== today || !complete || publishAllowed !== true || evidenceStatus !== "complete" || payload.preservePreviousGood === true || count <= 0 || rows.length <= 0) return null;
  return {
    ...(payload.terminalAuthority || {}),
    key: "institution",
    runId,
    tradeDate,
    sourceDate: tradeDate,
    moduleStatus: "complete",
    todayAuthoritative: true,
    formalDisplayAllowed: true,
    displayMode: "institution_complete_run",
    displayBlockReason: "",
    pendingNotDue: false,
    evidenceStatus: "complete",
    publishAllowed: true,
    fallback: false,
    resultCount: count,
    readbackCount: rows.length,
  };
}

function directLatestReadOnlyAuthority(key, payload = {}) {
  if (!["strategy3", "strategy4", "strategy5", "institution"].includes(key)) return null;
  const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.matches) ? payload.matches : Array.isArray(payload.data) ? payload.data : [];
  const count = Number(payload.count ?? payload.resultCount ?? payload.returnedCount ?? rows.length) || rows.length;
  const runId = String(payload.runId || payload.run_id || payload.transport?.runId || "").trim();
  const prefixes = { strategy3: "strategy3v2-", strategy4: "strategy4-", strategy5: "strategy5-", institution: "institution-" };
  if (!runId.startsWith(prefixes[key]) || count <= 0 || rows.length <= 0) return null;
  const evidenceStatus = String(payload.evidenceStatus || payload.run_quality_at_publish?.evidenceStatus || "").toLowerCase();
  const publishAllowed = payload.publishAllowed ?? payload.run_quality_at_publish?.publishAllowed;
  const complete = payload.complete === true || String(payload.status || "").toLowerCase() === "complete" || String(payload.qualityStatus || "").toLowerCase() === "complete";
  if (!complete || publishAllowed !== true || evidenceStatus !== "complete") return null;
  const tradeDate = terminalNormalizeTradeDate(payload.usedDate || payload.tradeDate || payload.trade_date || payload.scanDate || payload.date || terminalRunIdTradeDate(runId));
  const runDate = terminalNormalizeTradeDate(terminalRunIdTradeDate(runId));
  const today = terminalNormalizeTradeDate(terminalTaipeiDateKey());
  const isToday = runDate === today && tradeDate === today && payload.preservePreviousGood !== true && payload.previousGoodReadback !== true;
  const completeMode = key === "strategy3" ? "strategy3_v2_complete_run" : `${key}_complete_run`;
  return {
    ...(payload.terminalAuthority || {}),
    key,
    runId,
    tradeDate,
    sourceDate: tradeDate,
    moduleStatus: "complete",
    todayAuthoritative: isToday,
    formalDisplayAllowed: true,
    displayMode: isToday ? completeMode : "latest_readonly_history",
    displayBlockReason: "",
    pendingNotDue: false,
    evidenceStatus: "complete",
    publishAllowed: true,
    fallback: !isToday,
    resultCount: count,
    readbackCount: rows.length,
  };
}
function attachOpsAuthorityToEndpoints(endpoints = {}, authority = {}) {
  for (const [endpoint, payload] of Object.entries(endpoints || {})) {
    if (!payload || typeof payload !== "object") continue;
    const key = opsModuleKeyForEndpoint(endpoint);
    const v3Strategy2 = key === "strategy2"
      && payload.strategyContract === "strategy2-live-v3-fugle-deep-scan-1m"
      && payload.version === "v3";
    const v2Strategy3 = key === "strategy3" ? strategy3V2DirectAuthority(payload) : null;
    const directInstitution = key === "institution" ? institutionDirectAuthority(payload) : null;
    const directReadOnly = !v3Strategy2 ? directLatestReadOnlyAuthority(key, payload) : null;
    const row = v3Strategy2 ? strategy2V3Authority(payload) : v2Strategy3 || directInstitution || directReadOnly || (key ? authority.byKey?.[key] : null);
    if (!row) continue;
    if (v3Strategy2) {
      authority.byKey = { ...(authority.byKey || {}), strategy2: row };
      authority.source = `${authority.source || "runtime-output-artifacts"}+strategy2-v3-direct`;
    }
    if (v2Strategy3) {
      authority.byKey = { ...(authority.byKey || {}), strategy3: row };
      authority.source = `${authority.source || "runtime-output-artifacts"}+strategy3-v2-direct`;
    }
    if (directInstitution) {
      authority.byKey = { ...(authority.byKey || {}), institution: row };
      authority.source = `${authority.source || "runtime-output-artifacts"}+institution-direct`;
    }
    if (directReadOnly) {
      authority.byKey = { ...(authority.byKey || {}), [key]: row };
      authority.source = `${authority.source || "runtime-output-artifacts"}+${key}-direct-readonly`;
    }
    payload.terminalAuthority = row;
    payload.todayAuthoritative = row.todayAuthoritative;
    payload.formalDisplayAllowed = row.formalDisplayAllowed;
    payload.displayMode = row.displayMode;
    payload.displayBlockReason = row.displayBlockReason;
    payload.moduleStatus = row.moduleStatus;
  }
  return endpoints;
}
function summarize(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, count: 0 };
  const rows = Array.isArray(payload.matches) ? payload.matches
    : Array.isArray(payload.rows) ? payload.rows
      : Array.isArray(payload.records) ? payload.records
        : Array.isArray(payload.events) ? payload.events
          : [];
  return {
    ok: payload.ok !== false,
    count: Number(payload.count ?? payload.total ?? rows.length) || 0,
    runId: payload.runId || payload.transport?.runId || "",
    updatedAt: payload.updatedAt || payload.generatedAt || payload.finishedAt || "",
    source: payload.source || payload.cacheSource || payload.transport?.source || "",
    evidenceStatus: payload.evidenceStatus || payload.run_quality_at_publish?.evidenceStatus || "",
    unattendedStatus: payload.unattendedStatus || payload.run_quality_at_publish?.unattendedStatus || "",
    publishAllowed: payload.publishAllowed ?? payload.run_quality_at_publish?.publishAllowed ?? null,
    latestOverwriteAllowed: payload.latestOverwriteAllowed ?? payload.run_quality_at_publish?.latestOverwriteAllowed ?? null,
    preservePreviousGood: payload.preservePreviousGood ?? payload.run_quality_at_publish?.preservePreviousGood ?? null,
    blockedReason: payload.blockedReason || payload.scanner_block_reason || payload.run_quality_at_publish?.blockedReason || "",
    terminalAuthority: payload.terminalAuthority || null,
    todayAuthoritative: payload.todayAuthoritative === true || payload.terminalAuthority?.todayAuthoritative === true,
    formalDisplayAllowed: payload.formalDisplayAllowed === true || payload.terminalAuthority?.formalDisplayAllowed === true,
    displayMode: payload.displayMode || payload.terminalAuthority?.displayMode || "",
    displayBlockReason: payload.displayBlockReason || payload.terminalAuthority?.displayBlockReason || "",
  };
}

function publicEndpointMap(results) {
  const map = {};
  for (const [endpoint, result] of Object.entries(results)) {
    if (Number(result.statusCode || 0) >= 500) continue;
    if (result.payload && typeof result.payload === "object" && result.payload.ok === false && !isDisplayableFailClosedPayload(result.payload)) continue;
    map[endpoint] = result.payload;
    const canonical = new URL(endpoint, "https://fuman.local").pathname;
    if (canonical && !map[canonical]) map[canonical] = result.payload;
  }
  return map;
}

function sanitizeStrategy2Endpoints(endpoints = {}) {
  stripRetiredTerminalEndpoints(endpoints);
  return endpoints;
}

async function ensureStrategy2V3Endpoint(request, endpoints) {
  for (const endpoint of Object.keys(endpoints || {})) {
    if (new URL(String(endpoint || "/"), "https://fuman.local").pathname === "/api/strategy2-latest") delete endpoints[endpoint];
  }
  const direct = await callJson("/api/strategy2-latest", strategy2Latest, request, {
    ...compactQuery(240), today: "1", live: "1",
  }, 15000);
  const payload = direct.payload && typeof direct.payload === "object" ? direct.payload : {};
  const contractOk = payload.strategyContract === "strategy2-live-v3-fugle-deep-scan-1m" && payload.version === "v3";
  const endpoint = direct.label || buildEndpoint("/api/strategy2-latest", { ...compactQuery(240), today: "1", live: "1" });
  endpoints[endpoint] = contractOk ? payload : {
    ok: false,
    strategy: "strategy2",
    version: "v3",
    strategyContract: "strategy2-live-v3-fugle-deep-scan-1m",
    status: "strategy2_v3_endpoint_unavailable",
    dataDate: "",
    runId: "",
    rows: [], records: [], events: [], count: 0, resultCount: 0,
    fallbackUsed: false, previousGoodRunId: "",
    reason: payload.error || payload.reason || "strategy2_v3_direct_contract_failed",
  };
  return endpoints[endpoint];
}

function sanitizeStrategy2BundlePayload(payload) {
  // A fast bundle must never promote stale/degraded evidence to unattended YES.
  return payload;
}
function compactSnapshotEndpoints(request, endpoints = {}) {
  const compacted = {};
  for (const [endpoint, payload] of Object.entries(endpoints || {})) {
    compacted[endpoint] = shapeTopPayload(request, payload);
  }
  return compacted;
}

function requestedStrategyRoute(request = {}) {
  const value = String(
    request.query?.route
    || request.query?.strategy
    || request.query?.tab
    || ""
  ).trim().toLowerCase();
  if (["strategy2", "strategy3", "strategy4", "strategy5", "institution"].includes(value)) return value;
  return "";
}

function endpointBelongsToRoute(endpoint, route) {
  if (!route) return true;
  const pathname = new URL(String(endpoint || "/"), "https://fuman.local").pathname;
  const expected = {
    strategy2: "/api/strategy2-latest",
    strategy3: "/api/strategy3-latest",
    strategy4: "/api/strategy4-latest",
    strategy5: "/api/strategy5-latest",
    institution: "/api/institution-latest",
  }[route];
  return pathname === expected;
}

function endpointsForRequestedRoute(request, endpoints = {}) {
  const route = requestedStrategyRoute(request);
  if (!route) return endpoints;
  return Object.fromEntries(Object.entries(endpoints).filter(([endpoint]) => endpointBelongsToRoute(endpoint, route)));
}

function tasksForRequestedRoute(request, tasks = []) {
  const route = requestedStrategyRoute(request);
  if (!route) return tasks;
  return tasks.filter(([endpoint]) => endpointBelongsToRoute(endpoint, route));
}
function directLiveTaskForRequestedRoute(request) {
  const route = requestedStrategyRoute(request);
  if (route === "strategy3") return [["/api/strategy3-latest", strategy3Latest, { ...compactQuery(1200), live: "1", verify: "1", noSnapshot: "1" }, 15000]];
  if (route === "strategy4") return [["/api/strategy4-latest", strategy4Latest, { ...compactQuery(1200), live: "1", verify: "1", noSnapshot: "1" }, 15000]];
  if (route === "strategy5") return [["/api/strategy5-latest", strategy5Latest, { ...compactQuery(1200), live: "1", verify: "1", noSnapshot: "1" }, 15000]];
  if (route === "institution") return [["/api/institution-latest", institutionLatest, { ...compactQuery(1200), live: "1", verify: "1", noSnapshot: "1" }, 15000]];
  return null;
}
function shouldBuildWatchlistIndex(request) {
  return !requestedStrategyRoute(request);
}
const RETIRED_TERMINAL_ENDPOINTS = new Set([
  `/api/${"open-buy"}-latest`,
  `/api/${"realtime-radar"}-latest`,
  `/api/${"heatmap"}`,
]);

function isRetiredTerminalEndpoint(endpoint) {
  const path = new URL(String(endpoint || "/"), "https://fuman.local").pathname;
  return RETIRED_TERMINAL_ENDPOINTS.has(path);
}

function stripRetiredTerminalEndpoints(endpoints = {}) {
  for (const endpoint of Object.keys(endpoints || {})) {
    if (isRetiredTerminalEndpoint(endpoint)) delete endpoints[endpoint];
  }
  return endpoints;
}
function textFrom(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFrom).join(" ");
  if (typeof value === "object") return Object.values(value).map(textFrom).join(" ");
  return String(value);
}

async function repairStrategy5FullSnapshot() {
  return null;
}

async function repairStrategy3LatestSnapshot(request, endpoints = {}) {
  if (requestedStrategyRoute(request) !== "strategy3") return null;
  const endpoint = "/api/strategy3-latest?compact=1&limit=60";
  const direct = await callJson("/api/strategy3-latest", strategy3Latest, request, {
    compact: "1",
    limit: "60",
    live: "1",
    refresh: "1",
    force: "1",
  }, 8000);
  const payload = direct?.payload || {};
  const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.matches) ? payload.matches : [];
  const isV2Complete = direct.statusCode === 200
    && payload.strategy === "strategy3_v2"
    && payload.complete === true
    && payload.publishAllowed === true
    && String(payload.runId || "").startsWith("strategy3v2-")
    && rows.length > 0;
  if (!isV2Complete) return null;
  for (const key of Object.keys(endpoints || {})) {
    if (String(key).startsWith("/api/strategy3-latest")) delete endpoints[key];
  }
  endpoints[endpoint] = {
    ...payload,
    transport: {
      ...(payload.transport || {}),
      fastBundleRepair: "strategy3-v2-direct-canonical",
      via: "api/terminal-fast-bundle:snapshot-repair",
      fetchedAt: new Date().toISOString(),
    },
  };
  return endpoints[endpoint];
}

async function repairInstitutionLatestSnapshot(request, endpoints = {}) {
  if (requestedStrategyRoute(request) !== "institution") return null;
  const endpoint = "/api/institution-latest?canvas=1&compact=1&shell=1&limit=120&live=1&verify=1&noSnapshot=1";
  const direct = await callJson("/api/institution-latest", institutionLatest, request, {
    ...compactQuery(120),
    live: "1",
    verify: "1",
    noSnapshot: "1",
    refresh: "1",
    force: "1",
  }, 15000);
  const payload = direct?.payload || {};
  const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.matches) ? payload.matches : [];
  const authority = institutionDirectAuthority(payload);
  if (direct.statusCode !== 200 || !authority || rows.length <= 0) return null;
  for (const key of Object.keys(endpoints || {})) {
    if (String(key).startsWith("/api/institution-latest")) delete endpoints[key];
  }
  endpoints[endpoint] = {
    ...payload,
    terminalAuthority: authority,
    todayAuthoritative: true,
    formalDisplayAllowed: true,
    displayMode: authority.displayMode,
    displayBlockReason: "",
    transport: {
      ...(payload.transport || {}),
      fastBundleRepair: "institution-direct-canonical",
      via: "api/terminal-fast-bundle:snapshot-repair",
      fetchedAt: new Date().toISOString(),
    },
  };
  return endpoints[endpoint];
}

function isStrategy4Endpoint(endpoint) {
  return String(endpoint || "").startsWith("/api/strategy4-latest");
}

function hasStrategy4Endpoint(endpoints = {}) {
  return Object.entries(endpoints || {}).some(([endpoint, payload]) => {
    const runId = String(payload?.runId || payload?.transport?.runId || "").trim();
    return isStrategy4Endpoint(endpoint) && runId.startsWith("strategy4-");
  });
}

async function repairStrategy4LatestSnapshot() {
  return null;
}

function isSoftSnapshotEndpoint() {
  // Strategy2 V3 never uses a soft snapshot fallback. A failed V3 read must remain visible as unavailable.
  return false;
}
function isOptionalLiveSnapshotEndpoint(endpoint) {
  return false;
}

function isDisplayableFailClosedPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  const runId = String(payload.runId || payload.transport?.runId || "").trim();
  if (!runId) return false;
  const text = [
    payload.evidenceStatus,
    payload.unattendedStatus,
    payload.qualityStatus,
    payload.blockedReason,
    payload.scanner_block_reason,
    payload.reason,
    payload.error,
    payload.displayBlockReason,
    payload.run_quality_at_publish?.evidenceStatus,
    payload.run_quality_at_publish?.unattendedStatus,
    payload.run_quality_at_publish?.blockedReason,
  ].join(" ").toLowerCase();
  return payload.preservePreviousGood === true
    || payload.run_quality_at_publish?.preservePreviousGood === true
    || payload.publishAllowed === false
    || payload.run_quality_at_publish?.publishAllowed === false
    || /insufficient|degraded|blocked|source_quality_fail|market_closed|previous_good/.test(text);
}
function buildSoftSnapshotFallback(endpoint, result, via) {
  const original = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const reason = original.detail || original.error || original.reason || "snapshot-soft-fallback";
  return {
    ...original,
    ok: true,
    source: original.source || "supabase:strategy2_scan_results",
    cacheSource: "snapshot-soft-fallback",
    complete: original.complete === true,
    qualityStatus: original.qualityStatus || "waiting_snapshot",
    runId: original.runId || original.transport?.runId || "",
    usedDate: original.usedDate || original.date || "",
    tradeDate: original.tradeDate || original.usedDate || original.date || "",
    sourceDate: original.sourceDate || original.usedDate || original.date || "",
    count: Number(original.count ?? original.matchCount ?? original.entryCount ?? 0) || 0,
    returnedCount: Number(original.returnedCount ?? original.count ?? 0) || 0,
    rows: Array.isArray(original.rows) ? original.rows : [],
    records: Array.isArray(original.records) ? original.records : [],
    events: Array.isArray(original.events) ? original.events : [],
    matches: Array.isArray(original.matches) ? original.matches : [],
    updatedAt: original.updatedAt || new Date().toISOString(),
    reason,
    displayOnlyFallback: true,
    transport: {
      ...(original.transport || {}),
      source: "fast-bundle",
      gate: "snapshot-soft-fallback",
      endpoint,
      originalStatusCode: result?.statusCode || 0,
      via,
      fetchedAt: new Date().toISOString(),
    },
  };
}
function applySoftSnapshotFallbacks(results, endpoints, via) {
  for (const [endpoint, result] of Object.entries(results)) {
    if (endpoints[endpoint] || !isSoftSnapshotEndpoint(endpoint)) continue;
    if (Number(result.statusCode || 0) >= 400 || result.payload?.ok === false) {
      endpoints[endpoint] = buildSoftSnapshotFallback(endpoint, result, via);
    }
  }
}

function findWatchlistEndpoint(endpoints = {}) {
  return Object.entries(endpoints || {}).find(([endpoint]) => String(endpoint || "").startsWith("/api/watchlist-match-index"));
}

async function ensureWatchlistMatchIndexEndpoint(request, endpoints, options = {}) {
  const endpoint = "/api/watchlist-match-index?compact=1&shell=1&limit=80";
  const existing = findWatchlistEndpoint(endpoints);
  if (options.forceStrategy2Refresh && existing) delete endpoints[existing[0]];
  const currentExisting = findWatchlistEndpoint(endpoints);
  if (currentExisting?.[1]?.strategies?.strategy2) return;
  if (!currentExisting) {
    endpoints[endpoint] = buildWatchlistMatchIndex(endpoints, {
      cacheSource: options.cacheSource || "api/terminal-fast-bundle",
      via: options.via || "api/terminal-fast-bundle",
      updatedAt: options.updatedAt,
    });
  }
  const current = findWatchlistEndpoint(endpoints);
  if (current?.[1]?.strategies?.strategy2 && current?.[1]?.ok !== false) return;
  const direct = await callJson("/api/watchlist-match-index", watchlistMatchIndex, request, { compact: "1", shell: "1", limit: "80" }, 3000);
  if (Number(direct.statusCode || 0) >= 500 || direct.payload?.ok === false) return;
  if (!direct.payload?.strategies?.strategy2) return;
  if (current?.[0] && current[0] !== endpoint) delete endpoints[current[0]];
  endpoints[endpoint] = {
    ...direct.payload,
    transport: {
      ...(direct.payload.transport || {}),
      fastBundleRepair: "watchlist-match-index-direct-snapshot",
      via: options.via || "api/terminal-fast-bundle",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function isMiss(item) {
  if (isOptionalLiveSnapshotEndpoint(item.label)) return false;
  if (isDisplayableFailClosedPayload(item.payload)) return false;
  if (isSoftSnapshotEndpoint(item.label)) return false;
  return Number(item.statusCode || 0) >= 500 || item.payload?.ok === false;
}

function liveFallbackEnabled(request) {
  if (request.query?.allowLiveFallback === "1") return true;
  return process.env.DESKTOP_FAST_BUNDLE_ALLOW_LIVE_FALLBACK === "1"
    || process.env.FUMAN_DESKTOP_FAST_BUNDLE_ALLOW_LIVE_FALLBACK === "1";
}

function liveFanoutEnabled(request) {
  const query = request.query || {};
  const envEnabled = process.env.FUMAN_TERMINAL_FAST_BUNDLE_LIVE_FANOUT === "1";
  const queryRequested = query.live === "1" || query.refresh === "1" || query.force === "1";
  return envEnabled && queryRequested;
}

function snapshotMissPayload(reason = "snapshot_missing_or_stale") {
  const updatedAt = new Date().toISOString();
  return {
    ok: true,
    partial: true,
    source: "terminal-fast-bundle",
    cacheSource: "snapshot-only-miss",
    snapshotOnly: true,
    snapshotHit: false,
    snapshotFresh: false,
    reason,
    updatedAt,
    elapsedMs: 0,
    endpoints: {},
    summary: {},
    misses: ["desktop_route_snapshot"],
    timings: {},
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-cache, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "public, max-age=3, stale-while-revalidate=12");
  response.setHeader("Vercel-CDN-Cache-Control", "public, max-age=3, stale-while-revalidate=12");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const rate = rateLimitRequest(request, response, { scope: "terminal-fast-bundle", windowMs: 60_000, max: 120 });
  if (!rate.ok) return sendRateLimited(response, "terminal-fast-bundle", rate);

  const entitlement = await verifyRequestEntitlement(request, { scope: "terminal-fast-bundle" });
  const marketCalendar = await buildMarketCalendarContract().catch(() => null);
  const opsAuthority = buildOpsAuthorityIndex();
  let memberSnapshotRecovery = false;
  if (entitlement?.ok) {
    response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    response.setHeader("CDN-Cache-Control", "no-store");
    response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  }

  const requestedLiveFanout = request.query?.live === "1"
    || request.query?.refresh === "1"
    || request.query?.force === "1";
  const wantsLive = requestedLiveFanout && liveFanoutEnabled(request);
  const requestedMemberRoute = requestedStrategyRoute(request);
  const forceDirectMemberRoute = Boolean(entitlement?.ok && requestedMemberRoute && requestedMemberRoute !== "strategy2");
  if (!entitlement?.ok && !wantsLive) {
    if (request.method === 'HEAD') {
      response.status(200).end('');
      return;
    }
    const lockedPayload = buildFastMembershipLockedBundle(entitlement, marketCalendar);
    response.status(200).json(lockedPayload);
    return;
  }
  if (!wantsLive && !forceDirectMemberRoute) {
    const requestedRoute = requestedStrategyRoute(request);
    const routeSnapshot = requestedRoute && requestedRoute !== "strategy2"
      ? await readDesktopRouteSnapshotForRoute(requestedRoute, {
        timeoutMs: FAST_BUNDLE_SNAPSHOT_TIMEOUT_MS,
        allowStale: true,
      }).catch(() => null)
      : null;
    const releaseSnapshotPayload = typeof desktopRouteSnapshot.releaseReadbackSnapshot === "function" ? desktopRouteSnapshot.releaseReadbackSnapshot() : null;
    const snapshot = routeSnapshot
      || (releaseSnapshotPayload
        ? { updatedAt: releaseSnapshotPayload.updatedAt || "", payload: releaseSnapshotPayload }
        : await readDesktopRouteSnapshot({
          timeoutMs: FAST_BUNDLE_SNAPSHOT_TIMEOUT_MS,
          allowStale: true,
        }));
    const isReleaseReadbackSnapshot = snapshot?.payload?.cacheSource === "release-readback-snapshot";
    const isRouteSnapshot = snapshot?.payload?.cacheSource === "supabase:desktop_route_snapshot:route";
    if (snapshot?.payload?.endpoints) {
      const endpoints = endpointsForRequestedRoute(request, compactSnapshotEndpoints(request, snapshot.payload.endpoints));
      let realtimeRadarRepairs = isReleaseReadbackSnapshot ? { skipped: "release-readback-snapshot" } : {};
      if (requestedLiveFanout) {
        await repairStrategy3LatestSnapshot(request, endpoints);
        await repairInstitutionLatestSnapshot(request, endpoints);
      }
      if (!isReleaseReadbackSnapshot && liveFallbackEnabled(request)) {
        await repairStrategy5FullSnapshot(request, endpoints);
      }
      if (!requestedStrategyRoute(request) || requestedStrategyRoute(request) === "strategy2") {
        await ensureStrategy2V3Endpoint(request, endpoints);
      }
      if (liveFallbackEnabled(request)) {
        await repairStrategy5FullSnapshot(request, endpoints);
        await repairStrategy4LatestSnapshot(request, endpoints);
      }
      if (shouldBuildWatchlistIndex(request)) {
        await ensureWatchlistMatchIndexEndpoint(request, endpoints, {
          cacheSource: "api/terminal-fast-bundle:snapshot-derived",
          via: "api/terminal-fast-bundle:snapshot",
          updatedAt: snapshot.payload.updatedAt || snapshot.updatedAt || new Date().toISOString(),
          forceStrategy2Refresh: true,
        });
      }      sanitizeStrategy2Endpoints(endpoints);
      attachOpsAuthorityToEndpoints(endpoints, opsAuthority);
      attachSnapshotMainForcePlaceholders(endpoints);
      const payload = {
        ...snapshot.payload,
        endpoints,
        summary: Object.fromEntries(Object.entries(endpoints).map(([endpoint, endpointPayload]) => [endpoint, summarize(endpointPayload)])),
        ok: snapshot.payload.ok !== false,
        source: "terminal-fast-bundle",
        cacheSource: isReleaseReadbackSnapshot ? "release-readback-snapshot" : isRouteSnapshot ? "supabase:desktop_route_snapshot:route" : "supabase:desktop_route_snapshot",
        partial: Boolean(snapshot.payload.partial),
        misses: Array.isArray(snapshot.payload.misses) ? snapshot.payload.misses : [],
        snapshotHit: !isReleaseReadbackSnapshot,
        snapshotRepairs: realtimeRadarRepairs,
        terminalAuthority: opsAuthority,
      };
      if (request.method === "HEAD") {
        response.status(200).end("");
        return;
      }
      response.status(200).json(filterPublicBundlePayload(attachMarketCalendar(sanitizeStrategy2BundlePayload(payload, endpoints), marketCalendar), entitlement));
      return;
    }
    if (!liveFallbackEnabled(request) && !entitlement?.ok) {
      response.setHeader("X-Fuman-Fast-Bundle-Mode", "snapshot-only");
      if (request.method === "HEAD") {
        response.status(204).end("");
        return;
      }
      const endpoints = {};
      const missPayload = {
        ...snapshotMissPayload(),
        terminalAuthority: opsAuthority,
        endpoints,
        summary: Object.fromEntries(Object.entries(endpoints).map(([endpoint, endpointPayload]) => [endpoint, summarize(endpointPayload)])),
        misses: ["desktop_route_snapshot"],
        snapshotRepairs: { skipped: "published_snapshot_required" },
      };
      response.status(200).json(filterPublicBundlePayload(attachMarketCalendar(sanitizeStrategy2BundlePayload(missPayload, endpoints), marketCalendar), entitlement));
      return;
    }
  }

  const startedAt = Date.now();
  memberSnapshotRecovery = Boolean(entitlement?.ok && !wantsLive && !forceDirectMemberRoute);
  const memberSnapshotRecoveryTasks = [
    ["/api/terminal-home", terminalHome, {}, 3500],
    ["/api/market", market, compactQuery(24), 3000],
    ["/api/strategy2-latest", strategy2Latest, { ...compactQuery(240), today: "1" }, 6000],
    ["/api/strategy3-latest", strategy3Latest, compactQuery(60), 6000],
    ["/api/strategy4-latest", strategy4Latest, compactQuery(70), 6000],
    ["/api/strategy5-latest", strategy5Latest, compactQuery(140), 6000],
    ["/api/institution-latest", institutionLatest, { ...compactQuery(120), live: "1", verify: "1", noSnapshot: "1" }, 15000],
    ["/api/watchlist-match-index", watchlistMatchIndex, { compact: "1", shell: "1", limit: "80" }, 3000],
  ];
  const tasks = memberSnapshotRecovery ? memberSnapshotRecoveryTasks : [
    ["/api/terminal-home", terminalHome, {}, 8000],
    ["/api/market", market, compactQuery(24), 4200],
    ["/api/stocks", stocks, { limit: "120", compact: "1", shell: "1" }, 3000],
    ["/api/strategy2-latest", strategy2Latest, { ...compactQuery(240), today: "1", live: "1" }, 20000],
    ["/api/strategy3-latest", strategy3Latest, compactQuery(60), 8000],
    ["/api/strategy4-latest", strategy4Latest, compactQuery(70), 9000],
    ["/api/strategy5-latest", strategy5Latest, compactQuery(140), 8000],
    ["/api/latest-signals?strategy=strategy4", latestSignals, { strategy: "strategy4", compact: "1", shell: "1", limit: "70" }, 2300],
    ["/api/market-ai-live", marketAiLive, { canvas: "1", compact: "1", shell: "1", limit: "40" }, 2300],
    ["/api/institution-latest", institutionLatest, { ...compactQuery(120), live: "1", verify: "1", noSnapshot: "1" }, 15000],
    ["/api/watchlist-match-index", watchlistMatchIndex, { compact: "1", shell: "1", limit: "80" }, 3000],
  ];

  const routeTasks = forceDirectMemberRoute
    ? directLiveTaskForRequestedRoute(request)
    : tasksForRequestedRoute(request, tasks);
  const runnableTasks = entitlement.ok ? routeTasks : routeTasks.filter(([endpoint]) => isPublicBundleEndpoint(endpoint));
  const rows = await Promise.all(runnableTasks.map(([endpoint, handlerFn, query, timeout]) => (
    callJson(endpoint, handlerFn, request, query, timeout)
  )));
  const results = Object.fromEntries(rows.map((item) => [item.label, item]));
  const endpoints = publicEndpointMap(results);
  applySoftSnapshotFallbacks(results, endpoints, "api/terminal-fast-bundle");
  if (!requestedStrategyRoute(request) || requestedStrategyRoute(request) === "strategy2") {
    await ensureStrategy2V3Endpoint(request, endpoints);
  }
  if (shouldBuildWatchlistIndex(request)) {
    await ensureWatchlistMatchIndexEndpoint(request, endpoints, {
      cacheSource: "api/terminal-fast-bundle",
      via: "api/terminal-fast-bundle",
      forceStrategy2Refresh: true,
    });
  }  sanitizeStrategy2Endpoints(endpoints);
  attachOpsAuthorityToEndpoints(endpoints, opsAuthority);
  await attachMainForceCostsToEndpoints(endpoints);
  const summary = Object.fromEntries(Object.entries(endpoints).map(([endpoint, payload]) => [endpoint, summarize(payload)]));
  const elapsedMs = Date.now() - startedAt;
  const misses = rows
    .filter(isMiss)
    .map((item) => item.label);
  const payload = {
    ok: true,
    partial: misses.length > 0,
    source: "terminal-fast-bundle",
    cacheSource: "api/terminal-fast-bundle",
    snapshotRecovery: memberSnapshotRecovery,
    updatedAt: new Date().toISOString(),
    elapsedMs,
    endpoints,
    summary,
    misses,
    timings: Object.fromEntries(rows.map((item) => [item.label, item.elapsedMs || 0])),
    terminalAuthority: opsAuthority,
  };

  if (request.method === "HEAD") {
    response.status(200).end("");
    return;
  }
  response.status(200).json(filterPublicBundlePayload(attachMarketCalendar(sanitizeStrategy2BundlePayload(payload, endpoints), marketCalendar), entitlement));
};

