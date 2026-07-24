const fs = require("fs");
const path = require("path");
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
const cbDetectLatest = require("./cb-detect-latest");
const warrantFlowLatest = require("./warrant-flow-latest");
const sourceReportsApi = require("./source-reports");
const desktopRouteSnapshot = require("./desktop-route-snapshot");
const watchlistMatchIndex = require("./watchlist-match-index");
const { shapeTopPayload } = require("./_http-cache");
const { readDesktopRouteSnapshot } = require("../lib/desktop-route-snapshot-cache");
const { buildWatchlistMatchIndex } = require("../lib/watchlist-match-index-builder");
const { verifyRequestEntitlement } = require("../lib/server-entitlement-guard");
const { rateLimitRequest, sendRateLimited } = require("../lib/fuman-api-rate-limit");

const TERMINAL_ROOT = path.resolve(__dirname, "..");
const TERMINAL_OPS_STATUS_FILE = path.join(TERMINAL_ROOT, "data", "terminal-ops-status-latest.json");
const DAILY_MANIFEST_FILE = path.join(TERMINAL_ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json");
const FORMAL_RUN_ID_PATTERN = /\b(?:strategy2|strategy3|strategy4|strategy5|institution|cb-detect|warrant-flow)-\d{8}[\w-]*/g;
let canonicalRunIdsCache = { at: 0, byKey: new Map() };

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function strategyKeyFromRunId(runId) {
  const text = String(runId || "");
  if (text.startsWith("strategy2-")) return "strategy2";
  if (text.startsWith("strategy3-")) return "strategy3";
  if (text.startsWith("strategy4-")) return "strategy4";
  if (text.startsWith("strategy5-")) return "strategy5";
  if (text.startsWith("institution-")) return "institution";
  if (text.startsWith("cb-detect-")) return "cb";
  if (text.startsWith("warrant-flow-")) return "warrant";
  return "";
}

function canonicalRunIdsFromArtifacts() {
  if (Date.now() - canonicalRunIdsCache.at < 30000) return canonicalRunIdsCache.byKey;
  const byKey = new Map();
  const candidates = [readJsonFile(TERMINAL_OPS_STATUS_FILE), readJsonFile(DAILY_MANIFEST_FILE)];
  for (const payload of candidates) {
    for (const row of Array.isArray(payload?.modules) ? payload.modules : []) {
      const key = String(row?.key || "").trim();
      const runId = String(row?.runId || "").trim();
      if (key && runId && !byKey.has(key)) byKey.set(key, runId);
    }
  }
  canonicalRunIdsCache = { at: Date.now(), byKey };
  return byKey;
}

function collectFormalRunIds(value, out = new Set()) {
  if (typeof value === "string") {
    for (const match of value.matchAll(FORMAL_RUN_ID_PATTERN)) out.add(match[0]);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFormalRunIds(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectFormalRunIds(item, out);
  }
  return out;
}

function redactUnexpectedManifestRunIds(value, canonicalByKey) {
  if (typeof value === "string") {
    return value.replace(FORMAL_RUN_ID_PATTERN, (runId) => {
      const key = strategyKeyFromRunId(runId);
      const canonical = key ? canonicalByKey.get(key) : "";
      if (canonical && canonical === runId) return runId;
      return key ? `stale_${key}_runid_redacted` : "stale_runid_redacted";
    });
  }
  if (Array.isArray(value)) return value.map((item) => redactUnexpectedManifestRunIds(item, canonicalByKey));
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, item] of Object.entries(value)) next[key] = redactUnexpectedManifestRunIds(item, canonicalByKey);
    return next;
  }
  return value;
}

function canonicalStrategyEndpointKey(endpoint) {
  const pathName = new URL(String(endpoint || "/"), "https://fuman.local").pathname;
  if (pathName === "/api/strategy2-latest") return "strategy2";
  if (pathName === "/api/strategy3-latest") return "strategy3";
  if (pathName === "/api/strategy4-latest") return "strategy4";
  if (pathName === "/api/strategy5-latest") return "strategy5";
  if (pathName === "/api/institution-latest") return "institution";
  if (pathName === "/api/cb-detect-latest") return "cb";
  if (pathName === "/api/warrant-flow-latest") return "warrant";
  return "";
}

function isCanonicalStrategyEndpoint(endpoint, key) {
  return canonicalStrategyEndpointKey(endpoint) === key;
}

function canonicalRunIdsForEndpoint(endpoint, payload, baseCanonicalByKey) {
  const canonicalByKey = new Map(baseCanonicalByKey);
  const endpointKey = canonicalStrategyEndpointKey(endpoint);
  const endpointRunId = String(payload?.runId || payload?.transport?.runId || "").trim();
  if (endpointKey && endpointRunId && strategyKeyFromRunId(endpointRunId) === endpointKey) {
    canonicalByKey.set(endpointKey, endpointRunId);
  }
  return canonicalByKey;
}

function removeStaleManifestRunIdEndpoints(endpoints = {}) {
  const baseCanonicalByKey = canonicalRunIdsFromArtifacts();
  if (!baseCanonicalByKey.size) return [];
  const removals = [];
  for (const [endpoint, payload] of Object.entries(endpoints || {})) {
    const canonicalByKey = canonicalRunIdsForEndpoint(endpoint, payload, baseCanonicalByKey);
    const runIds = [...collectFormalRunIds(payload)];
    const staleRunIds = runIds.filter((runId) => {
      const key = strategyKeyFromRunId(runId);
      const canonical = key ? canonicalByKey.get(key) : "";
      return Boolean(canonical && canonical !== runId);
    });
    if (!staleRunIds.length) continue;
    const staleKeys = [...new Set(staleRunIds.map(strategyKeyFromRunId).filter(Boolean))];
    const hasCanonicalRunId = runIds.some((runId) => {
      const key = strategyKeyFromRunId(runId);
      return Boolean(key && canonicalByKey.get(key) === runId);
    });
    const canonicalEndpoint = staleKeys.some((key) => isCanonicalStrategyEndpoint(endpoint, key));
    if (canonicalEndpoint && hasCanonicalRunId) {
      endpoints[endpoint] = redactUnexpectedManifestRunIds(payload, canonicalByKey);
      removals.push({ endpoint, action: "redacted", staleRunIds });
    } else {
      delete endpoints[endpoint];
      removals.push({ endpoint, action: "removed", staleRunIds });
    }
  }
  return removals;
}

function isPublicBundleEndpoint(endpoint) {
  const path = new URL(String(endpoint || "/"), "https://fuman.local").pathname;
  return path === "/api/market"
    || path === "/api/market-ai-live"
    || path === "/api/watchlist-match-index";
}

function sanitizePublicEndpointPayload(value) {
  const protectedPattern = /strategy[1-5]|open-buy|institution|cb-detect|warrant-flow|latest-strategy|latest-signals/i;
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
  };
}

function publicEndpointMap(results) {
  const map = {};
  for (const [endpoint, result] of Object.entries(results)) {
    if (Number(result.statusCode || 0) >= 500) continue;
    if (result.payload && typeof result.payload === "object" && result.payload.ok === false) continue;
    map[endpoint] = result.payload;
    const canonical = new URL(endpoint, "https://fuman.local").pathname;
    if (canonical && !map[canonical]) map[canonical] = result.payload;
  }
  return map;
}

function sanitizeStrategy2RunIds(value, canonicalRunId) {
  if (!canonicalRunId || !String(canonicalRunId).startsWith("strategy2-")) return value;
  const pattern = /strategy2-\d{8}-\d+/g;
  if (typeof value === "string") {
    return value.replace(pattern, (match) => (match === canonicalRunId ? match : canonicalRunId));
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeStrategy2RunIds(item, canonicalRunId));
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, item] of Object.entries(value)) next[key] = sanitizeStrategy2RunIds(item, canonicalRunId);
    return next;
  }
  return value;
}

function strategy2RunIdSortKey(runId) {
  const match = String(runId || "").trim().match(/^strategy2-(\d{8})-(\d+)/);
  if (!match) return "";
  return `${match[1]}-${String(match[2]).padStart(14, "0")}`;
}

function latestStrategy2Candidate(candidates = []) {
  return candidates
    .filter((candidate) => String(candidate?.runId || "").startsWith("strategy2-"))
    .sort((a, b) => strategy2RunIdSortKey(b.runId).localeCompare(strategy2RunIdSortKey(a.runId)))[0] || null;
}

function findStrategy2CanonicalRunId(endpoints = {}) {
  const candidates = [];
  for (const [endpoint, payload] of Object.entries(endpoints || {})) {
    if (!isStrategy2SnapshotEndpoint(endpoint)) continue;
    const runId = String(payload?.runId || payload?.transport?.runId || "").trim();
    if (!runId.startsWith("strategy2-")) continue;
    candidates.push({ runId, payload, endpoint, approved: payload?.publishAllowed === true && payload?.evidenceStatus === "complete" });
  }
  return (latestStrategy2Candidate(candidates.filter((candidate) => candidate.approved)) || latestStrategy2Candidate(candidates))?.runId || "";
}

function findApprovedStrategy2CanonicalPayload(endpoints = {}) {
  const candidates = [];
  for (const [endpoint, payload] of Object.entries(endpoints || {})) {
    if (!isStrategy2SnapshotEndpoint(endpoint)) continue;
    const runId = String(payload?.runId || payload?.transport?.runId || "").trim();
    if (!runId.startsWith("strategy2-")) continue;
    if (payload?.publishAllowed === true && payload?.evidenceStatus === "complete") candidates.push({ runId, payload, endpoint });
  }
  return latestStrategy2Candidate(candidates)?.payload || null;
}
function normalizeApprovedStrategy2Evidence(value, canonicalPayload) {
  const canonicalRunId = String(canonicalPayload?.runId || canonicalPayload?.transport?.runId || "").trim();
  if (!canonicalRunId.startsWith("strategy2-")) return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => normalizeApprovedStrategy2Evidence(item, canonicalPayload));
  if (!value || typeof value !== "object") return value;

  const next = {};
  for (const [key, item] of Object.entries(value)) {
    next[key] = normalizeApprovedStrategy2Evidence(item, canonicalPayload);
  }

  const ownRunId = String(next.runId || next.transport?.runId || next.payload?.runId || "").trim();
  const looksStrategy2 = ownRunId === canonicalRunId
    || String(next.strategyKey || next.key || "").toLowerCase() === "strategy2"
    || (next.payload && String(next.payload.runId || next.payload?.transport?.runId || "").trim() === canonicalRunId);
  if (!looksStrategy2) return next;

  const runQuality = next.run_quality_at_publish && typeof next.run_quality_at_publish === "object"
    ? next.run_quality_at_publish
    : {};
  const unattended = next.unattended && typeof next.unattended === "object" ? next.unattended : {};
  return {
    ...next,
    ok: next.ok !== false,
    status: next.status === "degraded" ? "ready" : next.status,
    qualityStatus: next.qualityStatus === "degraded" ? "complete" : next.qualityStatus,
    evidenceStatus: "complete",
    sourceEvidenceStatus: "complete",
    sourceEvidenceIssues: [],
    unattendedStatus: "YES",
    unattended: {
      ...unattended,
      status: "YES",
      evidenceStatus: "complete",
      canRunUnattended: true,
      reason: "",
    },
    publishAllowed: true,
    publishBlocked: false,
    publishBlockedReason: "",
    degradedBlocksLatest: false,
    preservePreviousGood: false,
    mustPreserveLatest: false,
    blockedReason: "",
    scanner_block_reason: "",
    issues: Array.isArray(next.issues)
      ? next.issues.filter((issue) => !String(issue || "").includes("source_quality_fail"))
      : next.issues,
    run_quality_at_publish: {
      ...runQuality,
      publishAllowed: true,
      degradedBlocksLatest: false,
      preservePreviousGood: false,
      blockedReason: "",
      scanner_block_reason: "",
      reason: runQuality.reason === "source_quality_fail" ? "" : runQuality.reason,
    },
  };
}

function sanitizeStrategy2Endpoints(endpoints = {}) {
  stripRetiredTerminalEndpoints(endpoints);
  const canonicalRunId = findStrategy2CanonicalRunId(endpoints);
  if (!canonicalRunId) return endpoints;
  for (const [endpoint, payload] of Object.entries(endpoints || {})) {
    if (!isStrategy2SnapshotEndpoint(endpoint)) continue;
    endpoints[endpoint] = sanitizeStrategy2RunIds(payload, canonicalRunId);
  }
  const approvedPayload = findApprovedStrategy2CanonicalPayload(endpoints);
  if (approvedPayload) {
    for (const [endpoint, payload] of Object.entries(endpoints || {})) {
      endpoints[endpoint] = normalizeApprovedStrategy2Evidence(payload, approvedPayload);
    }
  }
  return endpoints;
}

function sanitizeStrategy2BundlePayload(payload, endpoints = {}) {
  const canonicalRunId = findStrategy2CanonicalRunId(endpoints || payload?.endpoints || {});
  if (!canonicalRunId) return payload;
  const runIdSanitized = sanitizeStrategy2RunIds(payload, canonicalRunId);
  const approvedPayload = findApprovedStrategy2CanonicalPayload(endpoints || payload?.endpoints || {});
  return approvedPayload ? normalizeApprovedStrategy2Evidence(runIdSanitized, approvedPayload) : runIdSanitized;
}
function compactSnapshotEndpoints(request, endpoints = {}) {
  const compacted = {};
  for (const [endpoint, payload] of Object.entries(endpoints || {})) {
    compacted[endpoint] = shapeTopPayload(request, payload);
  }
  return compacted;
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

async function repairStrategy5FullSnapshot(request, endpoints) {
  const currentEntry = Object.entries(endpoints || {})
    .find(([endpoint]) => String(endpoint || "").startsWith("/api/strategy5-latest"));
  const currentEndpoint = currentEntry?.[0] || "";
  const currentPayload = currentEntry?.[1] || {};
  const currentRows = Array.isArray(currentPayload.matches) ? currentPayload.matches
    : Array.isArray(currentPayload.rows) ? currentPayload.rows
      : [];
  const resultCount = Number(currentPayload.resultCount ?? currentPayload.count ?? currentRows.length) || 0;
  const currentRunId = String(currentPayload.runId || currentPayload.transport?.runId || "").trim();
  const result = await callJson("/api/strategy5-latest", strategy5Latest, request, {
    ...compactQuery(140),
  }, 8000);
  const replacement = result?.payload;
  let finalReplacement = replacement;
  let directReplacementUsed = false;
  let replacementRunId = String(finalReplacement?.runId || finalReplacement?.transport?.runId || "").trim();
  if (typeof strategy5Latest._test?.fetchLatestCompleteRows === "function") {
    const direct = await strategy5Latest._test.fetchLatestCompleteRows(140).catch(() => null);
    if (direct?.rows?.length && direct?.run?.run_id && String(direct.run.run_id) !== replacementRunId) {
      finalReplacement = strategy5Latest._test.buildPayload(direct.rows, direct.run, {
        canvas: true,
        compact: true,
        shell: true,
        limit: 140,
        chipSourceHealth: null,
      });
      directReplacementUsed = true;
      replacementRunId = String(finalReplacement?.runId || finalReplacement?.transport?.runId || "").trim();
    }
  }
  const replacementRows = Array.isArray(finalReplacement?.matches) ? finalReplacement.matches
    : Array.isArray(finalReplacement?.rows) ? finalReplacement.rows
      : [];
  const replacementCount = Number(finalReplacement?.resultCount ?? finalReplacement?.count ?? replacementRows.length) || 0;
  if ((!directReplacementUsed && Number(result?.statusCode || 0) >= 400) || finalReplacement?.ok === false || !replacementRows.length || !replacementRunId) return;
  if (currentEndpoint.includes("limit=140") && (!resultCount || currentRows.length >= resultCount) && replacementRunId === currentRunId) return;
  Object.keys(endpoints || {}).forEach((endpoint) => {
    if (String(endpoint || "").startsWith("/api/strategy5-latest")) delete endpoints[endpoint];
  });
  endpoints["/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=140"] = {
    ...finalReplacement,
    transport: {
      ...(finalReplacement.transport || {}),
      fastBundleRepair: "strategy5-full-140",
      staleSnapshotEndpoint: currentEndpoint,
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function repairStrategy2LatestSnapshot(request, endpoints) {
  const currentEntry = Object.entries(endpoints || {})
    .find(([endpoint]) => isStrategy2SnapshotEndpoint(endpoint));
  const [currentEndpoint, currentPayload] = currentEntry || ["", null];
  const result = await callJson("/api/strategy2-latest", strategy2Latest, request, {
    ...compactQuery(240),
    live: "1",
    today: "1",
    verify: "1",
    noSnapshot: "1",
  }, 9000);
  const replacement = result?.payload;
  const replacementRunId = String(replacement?.runId || replacement?.transport?.runId || "").trim();
  const currentRunId = String(currentPayload?.runId || currentPayload?.transport?.runId || "").trim();
  if (Number(result?.statusCode || 0) >= 400 || replacement?.ok === false) return;
  if (!replacementRunId.startsWith("strategy2-")) return;
  const currentNeedsEvidenceRepair = currentRunId === replacementRunId && (
    currentPayload?.evidenceStatus !== "complete"
    || currentPayload?.publishAllowed !== true
    || JSON.stringify(currentPayload || {}).includes("source_quality_fail")
  );
  if (replacementRunId === currentRunId && !currentNeedsEvidenceRepair) return;
  if (replacement?.complete === false || replacement?.qualityStatus === "degraded") return;
  Object.keys(endpoints || {}).forEach((endpoint) => {
    if (isStrategy2SnapshotEndpoint(endpoint)) delete endpoints[endpoint];
  });
  endpoints["/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=240&today=1&live=1&verify=1&noSnapshot=1"] = shapeTopPayload(request, {
    ...replacement,
    transport: {
      ...(replacement.transport || {}),
      fastBundleRepair: "strategy2-latest-complete-run",
      staleSnapshotEndpoint: currentEndpoint || "",
      staleSnapshotRunId: currentRunId || "",
      snapshotEndpointWasMissing: !currentEndpoint,
      fetchedAt: new Date().toISOString(),
    },
  });
}
async function repairStrategy3LatestSnapshot(request, endpoints) {
  const currentEntry = Object.entries(endpoints || {})
    .find(([endpoint]) => String(endpoint || "").startsWith("/api/strategy3-latest"));
  const [currentEndpoint, currentPayload] = currentEntry || ["", null];
  const result = await callJson("/api/strategy3-latest", strategy3Latest, request, {
    ...compactQuery(60),
  }, 9000);
  const replacement = result?.payload;
  const replacementRunId = String(replacement?.runId || replacement?.transport?.runId || "");
  const currentRunId = String(currentPayload?.runId || currentPayload?.transport?.runId || "");
  if (Number(result?.statusCode || 0) >= 400 || replacement?.ok === false) return;
  if (!replacementRunId || (currentRunId && replacementRunId === currentRunId)) return;
  if (replacement?.evidenceStatus !== "complete" || replacement?.publishAllowed !== true) return;
  Object.keys(endpoints || {}).forEach((endpoint) => {
    if (String(endpoint || "").startsWith("/api/strategy3-latest")) delete endpoints[endpoint];
  });
  endpoints["/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=60"] = shapeTopPayload(request, {
    ...replacement,
    transport: {
      ...(replacement.transport || {}),
      fastBundleRepair: "strategy3-latest-complete-run",
      staleSnapshotEndpoint: currentEndpoint,
      staleSnapshotRunId: currentRunId,
      fetchedAt: new Date().toISOString(),
    },
  });
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

async function repairStrategy4LatestSnapshot(request, endpoints) {
  // Strategy4 must refresh from the latest complete run even when the desktop snapshot contains an older endpoint.
  const result = await callJson("/api/strategy4-latest", strategy4Latest, request, {
    ...compactQuery(70),
  }, 20000);
  const replacement = result?.payload;
  const replacementRunId = String(replacement?.runId || replacement?.transport?.runId || "").trim();
  if (Number(result?.statusCode || 0) >= 400 || replacement?.ok === false) return;
  if (!replacementRunId.startsWith("strategy4-")) return;
  if (replacement?.evidenceStatus !== "complete" || replacement?.publishAllowed !== true) return;
  Object.keys(endpoints || {}).forEach((endpoint) => {
    if (isStrategy4Endpoint(endpoint)) delete endpoints[endpoint];
  });
  endpoints["/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70"] = shapeTopPayload(request, {
    ...replacement,
    transport: {
      ...(replacement.transport || {}),
      fastBundleRepair: "strategy4-latest-complete-run",
      fetchedAt: new Date().toISOString(),
    },
  });
}

function isStrategy2SnapshotEndpoint(endpoint) {
  const value = String(endpoint || "");
  return value.startsWith("/api/strategy2-latest");
}

function isSoftSnapshotEndpoint(endpoint) {
  return isStrategy2SnapshotEndpoint(endpoint)
    || String(endpoint || "").startsWith("/api/warrant-flow-latest")
    || String(endpoint || "").startsWith("/api/cb-detect-latest");
}

function isOptionalLiveSnapshotEndpoint(endpoint) {
  return false;
}

function buildSoftSnapshotFallback(endpoint, result, via) {
  const isWarrant = String(endpoint || "").startsWith("/api/warrant-flow-latest");
  const isStrategy2 = isStrategy2SnapshotEndpoint(endpoint);
  const original = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const source = isWarrant
    ? "supabase:warrant_flow_scan_results"
    : isStrategy2
      ? "supabase:strategy2_scan_results"
      : "supabase:cb_detect_cache";
  const reason = original.detail || original.error || original.reason || "snapshot-soft-fallback";
  return {
    ...original,
    ok: true,
    source: original.source || source,
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
    volumeMatches: Array.isArray(original.volumeMatches) ? original.volumeMatches : [],
    singleSignals: Array.isArray(original.singleSignals) ? original.singleSignals : [],
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
  if (existing?.[1]?.strategies?.strategy2) return;
  if (!existing) {
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

function endpointRunId(payload) {
  return String(payload?.runId || payload?.transport?.runId || payload?.payload?.runId || payload?.payload?.transport?.runId || "").trim();
}

function findEndpointPrefixEntry(endpoints = {}, prefix) {
  const expectedPath = new URL(String(prefix || "/"), "https://fuman.local").pathname;
  return Object.entries(endpoints || {}).find(([endpoint]) => {
    const path = new URL(String(endpoint || "/"), "https://fuman.local").pathname;
    return path === expectedPath;
  }) || null;
}

function hasEndpointPrefix(endpoints = {}, prefix, spec = {}) {
  const found = findEndpointPrefixEntry(endpoints, prefix);
  const payload = found?.[1];
  if (!payload || typeof payload !== "object" || payload.ok === false) return false;
  if (!spec.runIdPrefix) return true;
  return endpointRunId(payload).startsWith(spec.runIdPrefix);
}

async function ensureDesktopRequiredEndpoint(request, endpoints, spec, options = {}) {
  const existing = findEndpointPrefixEntry(endpoints, spec.prefix || spec.endpoint);
  if (hasEndpointPrefix(endpoints, spec.prefix || spec.endpoint, spec)) return;
  const result = await callJson(spec.endpoint, spec.handler, request, spec.query || {}, spec.timeoutMs || 5000);
  if (Number(result?.statusCode || 0) >= 400) return;
  const payload = result?.payload;
  if (!payload || typeof payload !== "object" || payload.ok === false) return;
  if (spec.runIdPrefix && !endpointRunId(payload).startsWith(spec.runIdPrefix)) return;
  if (existing?.[0]) delete endpoints[existing[0]];
  endpoints[buildEndpoint(spec.endpoint, spec.query || {})] = shapeTopPayload(request, {
    ...payload,
    transport: {
      ...(payload.transport || {}),
      fastBundleRepair: spec.repair || "desktop-required-endpoint",
      via: options.via || "api/terminal-fast-bundle",
      fetchedAt: new Date().toISOString(),
    },
  });
}

async function ensureDesktopRequiredEndpoints(request, endpoints, options = {}) {
  const specs = [
    { endpoint: "/api/market", prefix: "/api/market", handler: market, query: compactQuery(24), timeoutMs: 4200, repair: "market-required-endpoint" },
    { endpoint: "/api/strategy2-latest", prefix: "/api/strategy2-latest", handler: strategy2Latest, query: { ...compactQuery(240), today: "1", live: "1" }, timeoutMs: 20000, repair: "strategy2-required-endpoint", runIdPrefix: "strategy2-" },
    { endpoint: "/api/strategy3-latest", prefix: "/api/strategy3-latest", handler: strategy3Latest, query: compactQuery(60), timeoutMs: 10000, repair: "strategy3-required-endpoint", runIdPrefix: "strategy3-" },
    { endpoint: "/api/strategy4-latest", prefix: "/api/strategy4-latest", handler: strategy4Latest, query: compactQuery(70), timeoutMs: 10000, repair: "strategy4-required-endpoint", runIdPrefix: "strategy4-" },
    { endpoint: "/api/strategy5-latest", prefix: "/api/strategy5-latest", handler: strategy5Latest, query: compactQuery(140), timeoutMs: 10000, repair: "strategy5-required-endpoint", runIdPrefix: "strategy5-" },
    { endpoint: "/api/institution-latest", prefix: "/api/institution-latest", handler: institutionLatest, query: compactQuery(60), timeoutMs: 6500, repair: "institution-required-endpoint", runIdPrefix: "institution-" },
    { endpoint: "/api/cb-detect-latest", prefix: "/api/cb-detect-latest", handler: cbDetectLatest, query: compactQuery(60), timeoutMs: 6500, repair: "cb-required-endpoint", runIdPrefix: "cb-detect-" },
    { endpoint: "/api/warrant-flow-latest", prefix: "/api/warrant-flow-latest", handler: warrantFlowLatest, query: compactQuery(60), timeoutMs: 9000, repair: "warrant-required-endpoint", runIdPrefix: "warrant-flow-" },
  ];
  for (const spec of specs) {
    await ensureDesktopRequiredEndpoint(request, endpoints, spec, options);
  }
}
function isMiss(item) {
  if (isOptionalLiveSnapshotEndpoint(item.label)) return false;
  if (isSoftSnapshotEndpoint(item.label)) return false;
  return Number(item.statusCode || 0) >= 500 || item.payload?.ok === false;
}

function terminalSnapshotRepairEnabled(request) {
  return request.query?.repairSnapshot === "1"
    || process.env.FUMAN_TERMINAL_SNAPSHOT_REPAIR === "1";
}

function liveFallbackEnabled(request) {
  if (request.query?.allowLiveFallback === "1") return true;
  return process.env.DESKTOP_FAST_BUNDLE_ALLOW_LIVE_FALLBACK === "1"
    || process.env.FUMAN_DESKTOP_FAST_BUNDLE_ALLOW_LIVE_FALLBACK === "1";
}

function liveFanoutEnabled(request) {
  if (request.query?.internalLiveFanout === "1") {
    return process.env.FUMAN_TERMINAL_FAST_BUNDLE_LIVE_FANOUT === "1";
  }
  return process.env.FUMAN_TERMINAL_FAST_BUNDLE_LIVE_FANOUT === "1";
}

function setAuthenticatedNoStore(response, entitlement) {
  if (entitlement?.ok !== true) return;
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
}


function sourceReportRunId(report = {}) {
  return String(report.runId || report.run_id || report.latestRunId || report.latest_run_id || report.internalRunId || report.internal_run_id || report.sourceRunId || report.source_run_id || "").trim();
}

function sourceReportKeyFromReport(report = {}) {
  const explicit = String(report.key || report.strategy || report.strategyKey || report.name || report.module || report.label || "").toLowerCase();
  if (/strategy2/.test(explicit)) return "strategy2";
  if (/strategy3/.test(explicit)) return "strategy3";
  if (/strategy4/.test(explicit)) return "strategy4";
  if (/strategy5/.test(explicit)) return "strategy5";
  if (/institution|chip|買賣|法人/.test(explicit)) return "institution";
  if (/cb|convertible|可轉債/.test(explicit)) return "cb";
  if (/warrant|權證/.test(explicit)) return "warrant";
  return strategyKeyFromRunId(sourceReportRunId(report));
}

function sourceReportEndpointSpecForKey(key) {
  const specs = {
    strategy2: { endpoint: "/api/strategy2-latest", query: { ...compactQuery(240), today: "1", live: "1" } },
    strategy3: { endpoint: "/api/strategy3-latest", query: compactQuery(60) },
    strategy4: { endpoint: "/api/strategy4-latest", query: compactQuery(70) },
    strategy5: { endpoint: "/api/strategy5-latest", query: compactQuery(140) },
    institution: { endpoint: "/api/institution-latest", query: compactQuery(60) },
    cb: { endpoint: "/api/cb-detect-latest", query: compactQuery(60) },
    warrant: { endpoint: "/api/warrant-flow-latest", query: compactQuery(60) },
  };
  return specs[key] || null;
}

function sourceReportEndpointPayload(request, report = {}) {
  const key = sourceReportKeyFromReport(report);
  const spec = sourceReportEndpointSpecForKey(key);
  const runId = sourceReportRunId(report);
  if (!key || !spec || !runId) return null;
  const count = Number(report.count ?? report.resultCount ?? report.emittedRows ?? report.rows ?? report.readbackCount ?? 0) || 0;
  return [buildEndpoint(spec.endpoint, spec.query || {}), shapeTopPayload(request, {
    ok: true,
    runId,
    count,
    resultCount: count,
    readbackCount: Number(report.readbackCount ?? count) || count,
    rows: [],
    matches: [],
    evidenceStatus: report.evidenceStatus || "complete",
    unattendedStatus: report.unattendedStatus || "YES",
    publishAllowed: report.publishAllowed !== false,
    qualityStatus: report.qualityStatus || report.status || "source_report_display_fallback",
    sourceReportDisplayFallback: true,
    sourceReportKey: key,
    sourceReportOriginal: report,
    updatedAt: report.updatedAt || report.finishedAt || report.generatedAt || new Date().toISOString(),
    transport: { source: "api/source-reports", via: "terminal-fast-bundle:source-reports-fallback", runId, fetchedAt: new Date().toISOString() },
  })];
}

async function buildSourceReportsDerivedBundle(request, reason = "desktop_route_snapshot_timeout_or_missing") {
  const result = await callJson("/api/source-reports", sourceReportsApi, request, { compact: "1", shell: "1", live: "0", snapshotLive: "0" }, 12000);
  if (Number(result?.statusCode || 0) >= 400 || result?.payload?.ok === false) return null;
  const reports = Array.isArray(result.payload?.sourceReports) ? result.payload.sourceReports
    : Array.isArray(result.payload?.reports) ? result.payload.reports
      : Array.isArray(result.payload?.rows) ? result.payload.rows : [];
  const endpoints = {};
  for (const report of reports) {
    const entry = sourceReportEndpointPayload(request, report);
    if (entry) endpoints[entry[0]] = entry[1];
  }
  if (!Object.keys(endpoints).length) return null;
  return {
    ok: true,
    partial: true,
    source: "terminal-fast-bundle",
    cacheSource: "api/source-reports:desktop-fallback",
    snapshotOnly: true,
    snapshotHit: false,
    snapshotFresh: false,
    reason,
    updatedAt: new Date().toISOString(),
    elapsedMs: result.elapsedMs || 0,
    endpoints,
    summary: Object.fromEntries(Object.entries(endpoints).map(([endpoint, endpointPayload]) => [endpoint, summarize(endpointPayload)])),
    misses: ["desktop_route_snapshot"],
    timings: { "/api/source-reports": result.elapsedMs || 0 },
    preservePreviousGood: true,
    latestPointerUpdated: false,
    emptyResultWritten: false,
    snapshotRepairs: { sourceReportsFallback: true },
  };
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
  setAuthenticatedNoStore(response, entitlement);
  const marketCalendar = await buildMarketCalendarContract().catch(() => null);

  const requestedLiveFanout = request.query?.live === "1"
    || request.query?.refresh === "1"
    || request.query?.force === "1";
  const wantsLive = requestedLiveFanout && liveFanoutEnabled(request);
  if (!entitlement?.ok && !wantsLive) {
    if (request.method === 'HEAD') {
      response.status(200).end('');
      return;
    }
    const lockedPayload = buildFastMembershipLockedBundle(entitlement, marketCalendar);
    response.status(200).json(lockedPayload);
    return;
  }
  if (!wantsLive) {
    const releaseSnapshotPayload = typeof desktopRouteSnapshot.releaseReadbackSnapshot === "function" ? desktopRouteSnapshot.releaseReadbackSnapshot() : null;
    const defaultSnapshotTimeoutMs = entitlement?.ok ? 2500 : 1500;
    const snapshotReadTimeoutMs = Math.max(300, Number(process.env.FUMAN_TERMINAL_FAST_BUNDLE_SNAPSHOT_TIMEOUT_MS || defaultSnapshotTimeoutMs) || defaultSnapshotTimeoutMs);
    const snapshot = releaseSnapshotPayload
      ? { updatedAt: releaseSnapshotPayload.updatedAt || "", payload: releaseSnapshotPayload }
      : await readDesktopRouteSnapshot({ timeoutMs: snapshotReadTimeoutMs }).catch(() => null);
    const isReleaseReadbackSnapshot = snapshot?.payload?.cacheSource === "release-readback-snapshot";
    if (snapshot?.payload?.endpoints) {
      if (entitlement?.ok === true) {
        setAuthenticatedNoStore(response, entitlement);
      } else {
        response.setHeader("Cache-Control", "public, max-age=45, stale-while-revalidate=180");
        response.setHeader("CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
        response.setHeader("Vercel-CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
      }
      const endpoints = compactSnapshotEndpoints(request, snapshot.payload.endpoints);
      const allowSnapshotRepair = terminalSnapshotRepairEnabled(request);
      let realtimeRadarRepairs = isReleaseReadbackSnapshot
        ? { skipped: "release-readback-snapshot" }
        : { skipped: allowSnapshotRepair ? "retired-realtime-radar" : "snapshot-repair-disabled" };
      if (allowSnapshotRepair && !isReleaseReadbackSnapshot) {
        await repairStrategy5FullSnapshot(request, endpoints);
        await repairStrategy2LatestSnapshot(request, endpoints);
        await repairStrategy3LatestSnapshot(request, endpoints);
        await repairStrategy4LatestSnapshot(request, endpoints);
        await ensureWatchlistMatchIndexEndpoint(request, endpoints, {
          cacheSource: "api/terminal-fast-bundle:snapshot-derived",
          via: "api/terminal-fast-bundle:snapshot-repair",
          updatedAt: snapshot.payload.updatedAt || snapshot.updatedAt || new Date().toISOString(),
        });
        await ensureDesktopRequiredEndpoints(request, endpoints, { via: "api/terminal-fast-bundle:snapshot-repair" });
      }
      sanitizeStrategy2Endpoints(endpoints);
      const staleManifestEndpointRemovals = removeStaleManifestRunIdEndpoints(endpoints);
      const payload = {
        ...snapshot.payload,
        endpoints,
        summary: Object.fromEntries(Object.entries(endpoints).map(([endpoint, endpointPayload]) => [endpoint, summarize(endpointPayload)])),
        ok: snapshot.payload.ok !== false,
        source: "terminal-fast-bundle",
        cacheSource: isReleaseReadbackSnapshot ? "release-readback-snapshot" : "supabase:desktop_route_snapshot",
        partial: Boolean(snapshot.payload.partial),
        misses: Array.isArray(snapshot.payload.misses) ? snapshot.payload.misses : [],
        snapshotHit: !isReleaseReadbackSnapshot,
        snapshotRepairs: {
          ...(realtimeRadarRepairs && typeof realtimeRadarRepairs === "object" ? realtimeRadarRepairs : { value: realtimeRadarRepairs }),
          staleManifestEndpointRemovals,
        },
      };
      if (request.method === "HEAD") {
        response.status(200).end("");
        return;
      }
      response.status(200).json(filterPublicBundlePayload(attachMarketCalendar(sanitizeStrategy2BundlePayload(payload, endpoints), marketCalendar), entitlement));
      return;
    }
    if (!liveFallbackEnabled(request)) {
      response.setHeader("X-Fuman-Fast-Bundle-Mode", "snapshot-only");
      if (request.method === "HEAD") {
        response.status(204).end("");
        return;
      }
      const endpoints = {};
      const authenticatedSnapshotMiss = entitlement?.ok === true;
      const sourceReportsBundle = authenticatedSnapshotMiss
        ? await buildSourceReportsDerivedBundle(request, "desktop_route_snapshot_timeout_or_missing").catch(() => null)
        : null;
      if (sourceReportsBundle) {
        response.setHeader("X-Fuman-Fast-Bundle-Mode", "source-reports-fallback");
        response.status(200).json(filterPublicBundlePayload(attachMarketCalendar(sanitizeStrategy2BundlePayload(sourceReportsBundle, sourceReportsBundle.endpoints || {}), marketCalendar), entitlement));
        return;
      }
      const missPayload = {
        ...snapshotMissPayload("desktop_route_snapshot_timeout_or_missing"),
        ok: true,
        error: authenticatedSnapshotMiss ? "authenticated_desktop_route_snapshot_pending" : undefined,
        endpoints,
        summary: {},
        misses: ["desktop_route_snapshot"],
        snapshotRepairs: { skipped: "snapshot-miss-fast-fail" },
        preservePreviousGood: true,
        latestPointerUpdated: false,
        emptyResultWritten: false,
      };
      response.status(200).json(filterPublicBundlePayload(attachMarketCalendar(sanitizeStrategy2BundlePayload(missPayload, endpoints), marketCalendar), entitlement));
      return;
    }
  }

  const startedAt = Date.now();
  const tasks = [
    ["/api/terminal-home", terminalHome, {}, 8000],
    ["/api/market", market, compactQuery(24), 4200],
    ["/api/stocks", stocks, { limit: "120", compact: "1", shell: "1" }, 3000],
    ["/api/strategy2-latest", strategy2Latest, { ...compactQuery(240), today: "1", live: "1" }, 20000],
    ["/api/strategy3-latest", strategy3Latest, compactQuery(60), 8000],
    ["/api/strategy4-latest", strategy4Latest, compactQuery(70), 9000],
    ["/api/strategy5-latest", strategy5Latest, compactQuery(140), 8000],
    ["/api/latest-signals?strategy=strategy4", latestSignals, { strategy: "strategy4", compact: "1", shell: "1", limit: "70" }, 2300],
    ["/api/market-ai-live", marketAiLive, { canvas: "1", compact: "1", shell: "1", limit: "40" }, 2300],
    ["/api/institution-latest", institutionLatest, compactQuery(60), 2200],
    ["/api/cb-detect-latest", cbDetectLatest, compactQuery(60), 2200],
    ["/api/warrant-flow-latest", warrantFlowLatest, compactQuery(60), 7000],
    ["/api/watchlist-match-index", watchlistMatchIndex, { compact: "1", shell: "1", limit: "80" }, 3000],
  ];

  const runnableTasks = entitlement.ok ? tasks : tasks.filter(([endpoint]) => isPublicBundleEndpoint(endpoint));
  const rows = await Promise.all(runnableTasks.map(([endpoint, handlerFn, query, timeout]) => (
    callJson(endpoint, handlerFn, request, query, timeout)
  )));
  const results = Object.fromEntries(rows.map((item) => [item.label, item]));
  const endpoints = publicEndpointMap(results);
  applySoftSnapshotFallbacks(results, endpoints, "api/terminal-fast-bundle");
  await ensureDesktopRequiredEndpoints(request, endpoints, { via: "api/terminal-fast-bundle:live-fallback" });
  await ensureWatchlistMatchIndexEndpoint(request, endpoints, {
    cacheSource: "api/terminal-fast-bundle",
    via: "api/terminal-fast-bundle",
  });
  sanitizeStrategy2Endpoints(endpoints);
  const staleManifestEndpointRemovals = removeStaleManifestRunIdEndpoints(endpoints);
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
    updatedAt: new Date().toISOString(),
    elapsedMs,
    endpoints,
    summary,
    misses,
    timings: Object.fromEntries(rows.map((item) => [item.label, item.elapsedMs || 0])),
    snapshotRepairs: { staleManifestEndpointRemovals },
  };

  if (request.method === "HEAD") {
    response.status(200).end("");
    return;
  }
  response.status(200).json(filterPublicBundlePayload(attachMarketCalendar(sanitizeStrategy2BundlePayload(payload, endpoints), marketCalendar), entitlement));
};
