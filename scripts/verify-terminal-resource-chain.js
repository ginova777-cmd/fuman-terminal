const fs = require("fs");
const path = require("path");

const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-resource-chain-audit");
const NOW = new Date();
const ROUTE_FILTER = new Set((process.argv.find((arg) => arg.startsWith("--routes="))?.slice("--routes=".length) || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean));

const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || readSecret("terminal-supabase-url.txt")
  || readSecret("supabase-url.txt")
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");

const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecret("supabase-service-role-key.txt")
  || readSecret("supabase-anon-key.txt")
  || readSecret("terminal-supabase-service-role-key.txt")
  || readSecret("terminal-supabase-key.txt");

const STRATEGIES = [
  {
    key: "strategy1",
    label: "策略1",
    policy: "latest-complete; non-canvas full API may be blocked until futopt decision ready",
    endpoint: "/api/open-buy-latest",
    mobileTab: "strategy1",
    receiptKey: "open-buy",
    runView: { table: "v_strategy1_open_buy_latest_complete_run", strategy: "strategy1" },
    resultTable: "strategy1_open_buy_results",
    resultStrategy: "strategy1",
    allowZeroTerminal: true,
    allowSoftSnapshotFallback: true,
  },
  {
    key: "strategy2",
    label: "策略2 即時",
    policy: "same-day live",
    endpoint: "/api/latest-strategy?key=strategy2",
    directEndpoint: "/api/strategy2-latest",
    mobileTab: "strategy2",
    receiptKey: "strategy2",
    runView: { table: "v_strategy2_latest_complete_run", strategy: "strategy2" },
    resultTable: "strategy2_scan_results",
    resultStrategy: "strategy2",
    allowMissingDesktopSnapshot: true,
  },
  {
    key: "strategy3",
    label: "策略3",
    policy: "latest complete scan",
    endpoint: "/api/strategy3-latest",
    mobileTab: "strategy3",
    receiptKey: "strategy3",
    requireReceiptRunId: true,
    requireReceiptCountMatch: true,
    runView: { table: "v_strategy3_latest_complete_run", strategy: "strategy3" },
    resultTable: "strategy3_scan_results",
    resultStrategy: "strategy3",
  },
  {
    key: "strategy4",
    label: "策略4",
    policy: "latest complete scan",
    endpoint: "/api/strategy4-latest",
    mobileTab: "strategy4",
    receiptKey: "strategy4",
    runView: { table: "strategy4_scan_runs", strategy: "strategy4", order: "finished_at.desc" },
    resultTable: "strategy4_scan_results",
    resultStrategy: "strategy4",
  },
  {
    key: "strategy5",
    label: "策略5",
    policy: "latest complete scan",
    endpoint: "/api/strategy5-latest",
    mobileTab: "strategy5",
    receiptKey: "strategy5",
    runView: { table: "v_strategy5_latest_complete_run", strategy: "strategy5" },
    resultTable: "strategy5_scan_results",
    resultStrategy: "strategy5",
  },
  {
    key: "institution",
    label: "買賣超",
    policy: "latest complete scan",
    endpoint: "/api/institution-latest",
    mobileTab: "chip",
    receiptKey: "institution",
    runView: { table: "v_institution_latest_complete_run", strategy: "institution" },
    resultTable: "institution_scan_results",
    resultStrategy: "institution",
  },
  {
    key: "cb",
    label: "CB",
    policy: "latest complete scan",
    endpoint: "/api/cb-detect-latest",
    mobileTab: "cb",
    receiptKey: "cb-detect",
    runView: { table: "cb_detect_scan_runs", strategy: "cb_detect", order: "finished_at.desc" },
    resultTable: "cb_detect_scan_results",
    resultSelect: "run_id,scan_date,symbol,name,payload,updated_at",
    resultOrder: "symbol.asc",
    snapshotKey: "cb_detect_latest",
  },
  {
    key: "warrant",
    label: "權證走向",
    policy: "latest complete scan",
    endpoint: "/api/warrant-flow-latest",
    mobileTab: "warrant",
    receiptKey: "warrant-flow",
    runView: { table: "v_warrant_flow_latest_complete_run", strategy: "warrant_flow" },
    resultTable: "warrant_flow_scan_results",
    resultStrategy: "warrant_flow",
  },
  {
    key: "realtime-radar",
    label: "即時雷達",
    policy: "same-day live",
    endpoint: "/api/realtime-radar-latest",
    receiptKey: "realtime-radar",
  },
  {
    key: "market",
    label: "市場總覽",
    policy: "same-day live",
    endpoint: "/api/market",
  },
];

function readSecret(name) {
  for (const file of [
    path.join(RUNTIME_DIR, "secrets", name),
    path.join(process.cwd(), "secrets", name),
  ]) {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch {}
  }
  return "";
}

function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function compactDate(value) {
  const text = String(value || "");
  if (!text) return "";
  const direct = text.replace(/\D/g, "");
  if (direct.length >= 8) return direct.slice(0, 8);
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return taipeiDateKey(new Date(parsed));
  return "";
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function receiptSummary(receiptKey) {
  if (!receiptKey) return null;
  const file = path.join(RUNTIME_DIR, "data", "scan-receipts", `${receiptKey}.json`);
  const row = readJsonFile(file);
  if (!row) return { ok: false, key: receiptKey, file, status: "missing", error: "receipt_missing" };
  return {
    ok: row.status === "complete" && row.complete !== false && row.fallback !== true,
    key: receiptKey,
    file,
    status: String(row.status || ""),
    complete: row.complete === true,
    fallback: row.fallback === true,
    startedAt: row.startedAt || "",
    finishedAt: row.finishedAt || "",
    exitCode: row.exitCode,
    scanned: cleanNumber(row.scanned),
    total: cleanNumber(row.total),
    matches: cleanNumber(row.matches),
    qualityStatus: row.qualityStatus || "",
    runId: String(row.runId || ""),
    blockingReason: row.blockingReason || "",
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    log: row.log || "",
  };
}

function withQuery(endpoint, params = {}) {
  const url = new URL(endpoint, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

function publicUrl(endpoint) {
  return `${BASE_URL}${endpoint}`;
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 25000);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Accept: options.accept || "*/*",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
      elapsedMs: Date.now() - startedAt,
      contentType: response.headers.get("content-type") || "",
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: "",
      elapsedMs: Date.now() - startedAt,
      error: error?.message || String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const result = await fetchText(url, { ...options, accept: "application/json" });
  if (!result.ok) return { ...result, json: null };
  try {
    return { ...result, json: JSON.parse(result.text || "{}") };
  } catch (error) {
    return { ...result, ok: false, json: null, error: `json_parse_failed:${error?.message || error}` };
  }
}

async function fetchSupabaseRows(table, query, timeoutMs = 25000) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { ok: false, status: 0, rows: [], error: "missing_supabase_credentials" };
  }
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const result = await fetchJson(url, {
    timeoutMs,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
  });
  return {
    ok: result.ok,
    status: result.status,
    rows: Array.isArray(result.json) ? result.json : [],
    error: result.error || (!result.ok ? String(result.text || "").slice(0, 180) : ""),
  };
}

async function fetchLatestRun(config) {
  if (!config.runView) return null;
  const parts = ["select=*"];
  if (config.runView.strategy) parts.push(`strategy=eq.${encodeURIComponent(config.runView.strategy)}`);
  parts.push("status=eq.complete", "complete=eq.true");
  if (config.runView.order) parts.push(`order=${config.runView.order}`);
  parts.push("limit=1");
  const result = await fetchSupabaseRows(config.runView.table, parts.join("&"));
  const row = result.rows[0] || null;
  if (!result.ok || !row) return { ok: false, source: config.runView.table, error: result.error || "latest_run_missing" };
  return {
    ok: true,
    source: config.runView.table,
    runId: row.run_id || "",
    date: compactDate(row.scan_date || row.finished_at || row.updated_at),
    updatedAt: row.finished_at || row.updated_at || "",
    count: cleanNumber(row.result_count),
    expectedTotal: cleanNumber(row.expected_total),
    scannedCount: cleanNumber(row.scanned_count),
    qualityStatus: row.quality_status || "",
    row,
  };
}

async function fetchResultRows(config, runId) {
  if (!config.resultTable || !runId) return null;
  const result = await fetchSupabaseRows(
    config.resultTable,
    [
      `select=${config.resultSelect || "run_id,scan_date,code,name,rank,updated_at,generated_at,quality_status,payload"}`,
      config.resultStrategy ? `strategy=eq.${encodeURIComponent(config.resultStrategy)}` : "",
      `run_id=eq.${encodeURIComponent(runId)}`,
      `order=${config.resultOrder || "rank.asc"}`,
      "limit=10",
    ].filter(Boolean).join("&")
  );
  if (!result.ok) return { ok: false, source: config.resultTable, error: result.error };
  return {
    ok: true,
    source: config.resultTable,
    rows: result.rows,
    count: result.rows.length,
    top: topCodes(result.rows),
  };
}

async function fetchSnapshotKey(snapshotKey) {
  if (!snapshotKey) return null;
  const symbol = `__fuman_${snapshotKey}`;
  const result = await fetchSupabaseRows(
    "market_snapshots",
    `select=symbol,name,payload,updated_at&symbol=eq.${encodeURIComponent(symbol)}&limit=1`
  );
  const row = result.rows[0] || null;
  if (!result.ok || !row?.payload) return { ok: false, source: "market_snapshots", error: result.error || "snapshot_missing" };
  const payload = row.payload || {};
  return {
    ok: true,
    source: "market_snapshots",
    runId: payload.runId || payload.__snapshot?.snapshotId || "",
    date: compactDate(payload.usedDate || payload.sourceDate || payload.tradeDate || payload.updatedAt || row.updated_at),
    updatedAt: payload.updatedAt || row.updated_at || "",
    count: cleanNumber(payload.count ?? payload.rows?.length ?? payload.matches?.length),
    qualityStatus: payload.qualityStatus || "",
    top: topCodes(rowsOf(payload)),
    payload,
  };
}

function rowsOf(payload = {}) {
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.volumeMatches)) return payload.volumeMatches;
  if (Array.isArray(payload.singleSignals)) return payload.singleSignals;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function rowCode(row = {}) {
  return String(
    row.code
    || row.stock_id
    || row.stockId
    || row.underlyingCode
    || row.warrantCode
    || row.cbCode
    || row.symbol
    || row.payload?.code
    || row.payload?.underlyingCode
    || ""
  ).trim();
}

function rowName(row = {}) {
  return String(
    row.name
    || row.stock_name
    || row.stockName
    || row.underlyingName
    || row.warrantName
    || row.cbName
    || row.payload?.name
    || row.payload?.underlyingName
    || ""
  ).trim();
}

function topCodes(rows, limit = 5) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, limit)
    .map((row) => {
      const code = rowCode(row);
      const name = rowName(row);
      return [code, name].filter(Boolean).join(" ");
    })
    .filter(Boolean);
}

function summarizePayload(payload, status = 200, elapsedMs = 0) {
  const rows = rowsOf(payload);
  return {
    ok: payload?.ok !== false,
    status,
    elapsedMs,
    runId: String(payload?.runId || payload?.transport?.runId || payload?.transport?.payloadRunId || payload?.payload?.runId || ""),
    date: compactDate(payload?.usedDate || payload?.date || payload?.scanStamp || payload?.sourceDate || payload?.tradeDate || payload?.updatedAt || payload?.generatedAt),
    updatedAt: payload?.updatedAt || payload?.generatedAt || payload?.finishedAt || "",
    count: cleanNumber(payload?.count ?? payload?.matchCount ?? payload?.entryCount ?? rows.length),
    returnedCount: cleanNumber(payload?.returnedCount ?? rows.length),
    qualityStatus: payload?.qualityStatus || payload?.sourceHealth?.status || "",
    source: payload?.source || "",
    cacheSource: payload?.cacheSource || "",
    transportSource: payload?.transport?.source || "",
    snapshotHit: Boolean(payload?.snapshotHit),
    snapshotFallback: Boolean(payload?.snapshotFallback || payload?.transport?.fallbackFromPreviousSnapshot),
    error: payload?.error || payload?.detail || payload?.reason || "",
    top: topCodes(rows),
  };
}

function sourceHealthSummary(payload = {}, supabase = {}) {
  const health = payload?.sourceHealth || payload?.payload?.sourceHealth || supabase?.row?.payload?.sourceHealth || null;
  if (!health || typeof health !== "object") return null;
  return {
    status: health.status || "",
    issues: Array.isArray(health.issues) ? health.issues : [],
    warnings: Array.isArray(health.warnings) ? health.warnings : [],
    warningCount: cleanNumber(health.warningCount),
    warningLimit: cleanNumber(health.warningLimit),
    stockUniverseCount: cleanNumber(health.stockUniverseCount),
    after1300ReadyCount: cleanNumber(health.after1300ReadyCount),
    minAfter1300Candidates: cleanNumber(health.minAfter1300Candidates),
    issuedSharesCount: cleanNumber(health.issuedSharesCount),
    volumeAverageCount: cleanNumber(health.volumeAverageCount),
  };
}

function endpointFromSnapshot(snapshotPayload, endpoint) {
  const endpoints = snapshotPayload?.endpoints && typeof snapshotPayload.endpoints === "object" ? snapshotPayload.endpoints : {};
  const target = new URL(endpoint, BASE_URL);
  const cleanTarget = `${target.pathname}${target.search}`;
  if (endpoints[cleanTarget]) return { endpoint: cleanTarget, payload: endpoints[cleanTarget] };
  const entries = Object.entries(endpoints).filter(([key]) => {
    try {
      return new URL(key, BASE_URL).pathname === target.pathname;
    } catch {
      return false;
    }
  });
  const preferred = entries.find(([key]) => {
    const url = new URL(key, BASE_URL);
    return target.searchParams.get("canvas") !== "1" || url.searchParams.get("canvas") === "1";
  }) || entries[0];
  return preferred ? { endpoint: preferred[0], payload: preferred[1] } : { endpoint: "", payload: null };
}

function parseMobileFragment(html) {
  const runId = String(html.match(/data-run-id="([^"]*)"/)?.[1] || "").trim();
  const count = cleanNumber(html.match(/數量\s*<b>([^<]*)<\/b>/)?.[1]);
  const updated = String(html.match(/更新\s*<b>([^<]*)<\/b>/)?.[1] || "").trim();
  const title = String(html.match(/<strong>([^<]*)<\/strong>/)?.[1] || "").trim();
  const top = [...html.matchAll(/<h4>([^<]*)<\/h4>/g)].slice(0, 5).map((match) => decodeHtml(match[1]));
  const statusLine = String(html.match(/<article class="mobile-terminal-head">[\s\S]*?<p>([\s\S]*?)<\/p>/)?.[1] || "").replace(/<[^>]+>/g, "").trim();
  const empty = /empty-state/.test(html);
  return {
    status: 200,
    runId,
    count,
    updatedAt: updated,
    title: decodeHtml(title),
    statusLine: decodeHtml(statusLine),
    top,
    empty,
  };
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function compatibleRun(expected, actual, options = {}) {
  if (!expected || !actual) return true;
  if (expected.runId && actual.runId && expected.runId !== actual.runId) return false;
  if (!expected.runId && !actual.runId && expected.date && actual.date && expected.date !== actual.date && !options.allowDateMismatch) return false;
  return true;
}

function obviousFallback(summary) {
  const text = [
    summary?.source,
    summary?.cacheSource,
    summary?.transportSource,
    summary?.error,
  ].join(" ").toLowerCase();
  const officialDesktopSnapshot = /supabase:desktop_route_snapshot/.test(text)
    && !/snapshot-soft-fallback|snapshot-friendly-empty|previous/.test(text);
  return /(static|fallback|previous|json-snapshot|snapshot-friendly-empty)/.test(text)
    || (summary?.snapshotFallback && !officialDesktopSnapshot);
}

function issueList(config, receipt, sourceHealth, supabase, live, compact, snapshot, mobile) {
  const issues = [];
  if (receipt) {
    if (receipt.status === "missing") issues.push(`scanner receipt missing: ${receipt.key}`);
    if (receipt.status === "failed" || receipt.complete === false || receipt.exitCode > 0) {
      issues.push(`scanner receipt failed: ${receipt.status || "unknown"} exit=${receipt.exitCode ?? ""} ${receipt.blockingReason || ""}`.trim());
    } else if (receipt.status && receipt.status !== "complete") {
      issues.push(`scanner receipt not clean: ${receipt.status}`);
    }
    if (receipt.fallback) issues.push("scanner receipt fallback=true");
    if (config.requireReceiptRunId && supabase?.runId && !receipt.runId) {
      issues.push(`scanner receipt missing runId for latest complete run ${supabase.runId}`);
    }
    if (config.requireReceiptCountMatch && supabase?.count > 0 && receipt.matches !== supabase.count) {
      issues.push(`scanner receipt matches != Supabase latest count (${receipt.matches} vs ${supabase.count})`);
    }
    if (receipt.runId && supabase?.runId && receipt.runId !== supabase.runId) {
      issues.push(`scanner receipt runId != Supabase latest (${receipt.runId} vs ${supabase.runId})`);
    }
    if (receipt.runId && compact?.runId && receipt.runId !== compact.runId) {
      issues.push(`scanner receipt runId != terminal API (${receipt.runId} vs ${compact.runId})`);
    }
  }
  if (sourceHealth) {
    if (sourceHealth.status && sourceHealth.status !== "ok") {
      issues.push(`sourceHealth ${sourceHealth.status}: ${(sourceHealth.issues || []).join("; ") || "warnings present"}`);
    }
    if (sourceHealth.warningLimit && sourceHealth.warningCount > sourceHealth.warningLimit) {
      issues.push(`sourceHealth warningCount ${sourceHealth.warningCount} > ${sourceHealth.warningLimit}`);
    }
    if (sourceHealth.minAfter1300Candidates && sourceHealth.after1300ReadyCount < sourceHealth.minAfter1300Candidates) {
      issues.push(`sourceHealth after1300ReadyCount ${sourceHealth.after1300ReadyCount} < ${sourceHealth.minAfter1300Candidates}`);
    }
  }
  if (live?.status >= 500 || live?.ok === false) issues.push(`live API ${live.status || ""} ${live.error || ""}`.trim());
  if (compact?.status >= 500 || compact?.ok === false) issues.push(`terminal API ${compact.status || ""} ${compact.error || ""}`.trim());
  if (snapshot?.status >= 500 || (snapshot?.ok === false && !(config.allowMissingDesktopSnapshot && snapshot?.error === "endpoint_not_in_desktop_snapshot"))) {
    issues.push(`desktop snapshot endpoint missing/error`);
  }
  if (mobile && mobile.status >= 500) issues.push(`mobile fragment ${mobile.status}`);
  if (supabase?.ok && live && !compatibleRun(supabase, live, { allowDateMismatch: config.key === "strategy5" })) {
    issues.push(`Supabase latest run != live API (${supabase.runId || supabase.date} vs ${live.runId || live.date})`);
  }
  if (live?.runId && compact?.runId && live.runId !== compact.runId) issues.push(`live API != terminal API runId (${live.runId} vs ${compact.runId})`);
  if (live?.runId && snapshot?.runId && live.runId !== snapshot.runId) issues.push(`live API != desktop snapshot runId (${live.runId} vs ${snapshot.runId})`);
  if (live?.runId && mobile?.runId && !String(mobile.runId).includes("waiting") && live.runId !== mobile.runId) issues.push(`live API != mobile fragment runId (${live.runId} vs ${mobile.runId})`);
  const controlledWaiting = config.allowSoftSnapshotFallback && /decision|futopt|not_ready|waiting/i.test(`${compact?.error || ""} ${snapshot?.error || ""} ${mobile?.runId || ""}`);
  if (obviousFallback(compact) && !controlledWaiting) issues.push(`terminal API fallback marker: ${compact.cacheSource || compact.transportSource || compact.error}`);
  if (obviousFallback(snapshot) && !controlledWaiting) issues.push(`desktop snapshot fallback marker: ${snapshot.cacheSource || snapshot.transportSource || snapshot.error}`);
  if (!config.allowZeroTerminal && compact && cleanNumber(compact.count || compact.returnedCount) <= 0) issues.push("terminal API has zero rows");
  if (!config.allowZeroTerminal && mobile && mobile.empty) issues.push("mobile fragment empty");
  return issues;
}

async function auditOne(config, desktopSnapshotPayload) {
  const receipt = receiptSummary(config.receiptKey);
  const endpoint = withQuery(config.endpoint, { canvas: 1, compact: 1, shell: 1, limit: 60, t: Date.now() });
  const liveEndpoint = withQuery(config.directEndpoint || config.endpoint, { canvas: 1, compact: 1, shell: 1, limit: 60, live: 1, t: Date.now() });
  const [latestRun, snapshotKey, liveResult, compactResult, mobileResult] = await Promise.all([
    fetchLatestRun(config),
    fetchSnapshotKey(config.snapshotKey),
    fetchJson(publicUrl(liveEndpoint)),
    fetchJson(publicUrl(endpoint)),
    config.mobileTab ? fetchText(publicUrl(withQuery("/api/mobile-fragment", { tab: config.mobileTab, t: Date.now() })), { accept: "text/html", timeoutMs: 30000 }) : Promise.resolve(null),
  ]);
  const supabase = latestRun || snapshotKey;
  const resultRows = supabase?.runId ? await fetchResultRows(config, supabase.runId) : null;
  const live = liveResult.json ? summarizePayload(liveResult.json, liveResult.status, liveResult.elapsedMs) : {
    status: liveResult.status,
    ok: false,
    elapsedMs: liveResult.elapsedMs,
    error: liveResult.error || liveResult.text?.slice(0, 140) || "",
  };
  const compact = compactResult.json ? summarizePayload(compactResult.json, compactResult.status, compactResult.elapsedMs) : {
    status: compactResult.status,
    ok: false,
    elapsedMs: compactResult.elapsedMs,
    error: compactResult.error || compactResult.text?.slice(0, 140) || "",
  };
  const snapEntry = endpointFromSnapshot(desktopSnapshotPayload, endpoint);
  const desktopSnapshot = snapEntry.payload ? {
    ...summarizePayload(snapEntry.payload, 200, 0),
    endpoint: snapEntry.endpoint,
  } : { status: 404, ok: false, endpoint: "", error: "endpoint_not_in_desktop_snapshot" };
  const mobile = mobileResult ? (mobileResult.ok
    ? parseMobileFragment(mobileResult.text)
    : { status: mobileResult.status, ok: false, error: mobileResult.error || mobileResult.text?.slice(0, 140) || "" }) : null;
  const sourceHealth = sourceHealthSummary(liveResult.json, supabase)
    || sourceHealthSummary(compactResult.json, supabase)
    || sourceHealthSummary(snapEntry.payload, supabase);
  const issues = issueList(config, receipt, sourceHealth, supabase, live, compact, desktopSnapshot, mobile);
  return {
    key: config.key,
    label: config.label,
    policy: config.policy,
    receipt,
    sourceHealth,
    endpoint,
    liveEndpoint,
    supabase,
    supabaseNotApplicable: !config.runView && !config.snapshotKey,
    resultRows,
    live,
    terminalApi: compact,
    desktopSnapshot,
    desktopSnapshotNotApplicable: config.allowMissingDesktopSnapshot && desktopSnapshot?.error === "endpoint_not_in_desktop_snapshot",
    mobileFragment: mobile,
    ok: issues.length === 0,
    issues,
  };
}

function markdown(results, desktopSnapshot, fastBundle) {
  const lines = [];
  lines.push("# Terminal Resource Chain Audit");
  lines.push("");
  lines.push(`- Checked: ${NOW.toISOString()} / Taipei ${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei" })}`);
  lines.push(`- Base URL: ${BASE_URL}`);
  lines.push(`- Desktop snapshot: status=${desktopSnapshot.status} fresh=${desktopSnapshot.summary?.snapshotFresh ?? ""} updatedAt=${desktopSnapshot.summary?.updatedAt || ""} endpointCount=${desktopSnapshot.summary?.endpointCount || 0}`);
  lines.push(`- Terminal fast bundle: status=${fastBundle.status} fresh=${fastBundle.summary?.snapshotFresh ?? ""} updatedAt=${fastBundle.summary?.updatedAt || ""} endpointCount=${fastBundle.summary?.endpointCount || 0}`);
  lines.push("");
  lines.push("| 項目 | scanner receipt | source health | Supabase 最新 | live=1 API | 終端 compact API | desktop snapshot | mobile fragment | 判定 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const row of results) {
    const receipt = row.receipt
      ? `${row.receipt.status || "--"}<br>${row.receipt.runId || "--"}<br>${row.receipt.finishedAt || "--"}`
      : "n/a";
    const sourceHealth = row.sourceHealth
      ? `${row.sourceHealth.status || "--"}<br>13:00=${row.sourceHealth.after1300ReadyCount || 0}/${row.sourceHealth.minAfter1300Candidates || "--"} warn=${row.sourceHealth.warningCount || 0}/${row.sourceHealth.warningLimit || "--"}`
      : "n/a";
    const sup = row.supabase?.ok
      ? `${row.supabase.runId || row.supabase.date || "--"}<br>${row.supabase.count ?? "--"}`
      : row.supabaseNotApplicable
        ? "n/a"
      : `ERR ${row.supabase?.error || "missing"}`;
    const live = `${row.live?.status || "--"} ${row.live?.runId || row.live?.date || "--"}<br>${row.live?.count ?? "--"} ${row.live?.cacheSource || row.live?.transportSource || ""}`;
    const term = `${row.terminalApi?.status || "--"} ${row.terminalApi?.runId || row.terminalApi?.date || "--"}<br>${row.terminalApi?.count ?? "--"} ${row.terminalApi?.cacheSource || row.terminalApi?.transportSource || ""}`;
    const snap = row.desktopSnapshotNotApplicable
      ? "n/a"
      : `${row.desktopSnapshot?.status || "--"} ${row.desktopSnapshot?.runId || row.desktopSnapshot?.date || "--"}<br>${row.desktopSnapshot?.count ?? "--"} ${row.desktopSnapshot?.cacheSource || row.desktopSnapshot?.transportSource || ""}`;
    const mob = row.mobileFragment
      ? `${row.mobileFragment.status || "--"} ${row.mobileFragment.runId || "--"}<br>${row.mobileFragment.count ?? "--"}`
      : "n/a";
    lines.push(`| ${row.label} | ${receipt} | ${sourceHealth} | ${sup} | ${live} | ${term} | ${snap} | ${mob} | ${row.ok ? "OK" : row.issues.join("<br>")} |`);
  }
  lines.push("");
  lines.push("## Top Rows");
  for (const row of results) {
    lines.push(`### ${row.label}`);
    lines.push(`- Supabase top: ${(row.resultRows?.top || row.supabase?.top || []).join(" / ") || "--"}`);
    lines.push(`- live API top: ${(row.live?.top || []).join(" / ") || "--"}`);
    lines.push(`- terminal API top: ${(row.terminalApi?.top || []).join(" / ") || "--"}`);
    lines.push(`- desktop snapshot top: ${(row.desktopSnapshot?.top || []).join(" / ") || "--"}`);
    if (row.mobileFragment) lines.push(`- mobile fragment top: ${(row.mobileFragment.top || []).join(" / ") || "--"}`);
    if (row.issues.length) lines.push(`- Issues: ${row.issues.join("；")}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const [desktopSnapshotResult, fastBundleResult] = await Promise.all([
    fetchJson(publicUrl(withQuery("/api/desktop-route-snapshot", { t: Date.now() })), { timeoutMs: 35000 }),
    fetchJson(publicUrl(withQuery("/api/terminal-fast-bundle", { t: Date.now() })), { timeoutMs: 35000 }),
  ]);
  const desktopSnapshotPayload = desktopSnapshotResult.json || {};
  const fastBundlePayload = fastBundleResult.json || {};
  const results = [];
  for (const config of STRATEGIES.filter((item) => !ROUTE_FILTER.size || ROUTE_FILTER.has(item.key))) {
    console.log(`[audit] ${config.key}`);
    results.push(await auditOne(config, desktopSnapshotPayload));
  }
  const desktopSnapshot = {
    status: desktopSnapshotResult.status,
    summary: {
      snapshotFresh: desktopSnapshotPayload.snapshotFresh,
      updatedAt: desktopSnapshotPayload.updatedAt || desktopSnapshotPayload.generatedAt,
      endpointCount: Object.keys(desktopSnapshotPayload.endpoints || {}).length,
      partial: desktopSnapshotPayload.partial,
      misses: desktopSnapshotPayload.misses || [],
    },
  };
  const fastBundle = {
    status: fastBundleResult.status,
    summary: {
      snapshotFresh: fastBundlePayload.snapshotFresh,
      updatedAt: fastBundlePayload.updatedAt || fastBundlePayload.generatedAt,
      endpointCount: Object.keys(fastBundlePayload.endpoints || {}).length,
      partial: fastBundlePayload.partial,
      misses: fastBundlePayload.misses || [],
    },
  };
  const payload = {
    checkedAt: NOW.toISOString(),
    baseUrl: BASE_URL,
    desktopSnapshot,
    fastBundle,
    results,
    ok: results.every((row) => row.ok),
  };
  const jsonFile = path.join(OUT_DIR, "terminal-resource-chain-audit.json");
  const mdFile = path.join(OUT_DIR, "terminal-resource-chain-audit.md");
  await fs.promises.writeFile(jsonFile, JSON.stringify(payload, null, 2));
  await fs.promises.writeFile(mdFile, markdown(results, desktopSnapshot, fastBundle));
  console.log(`[audit] wrote ${mdFile}`);
  if (!payload.ok) {
    console.error("[audit] issues found");
    for (const row of results.filter((item) => !item.ok)) {
      console.error(`- ${row.key}: ${row.issues.join("; ")}`);
    }
    process.exitCode = 1;
  } else {
    console.log("[audit] ok");
  }
}

main().catch((error) => {
  console.error(`[audit] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
