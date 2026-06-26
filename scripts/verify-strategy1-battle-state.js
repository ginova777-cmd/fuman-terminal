const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecret("supabase-service-role-key.txt")
  || readSecret("supabase-anon-key.txt");

function readSecret(name) {
  for (const file of [
    path.join(RUNTIME_DIR, "secrets", name),
    path.join(ROOT, "secrets", name),
  ]) {
    try { return fs.readFileSync(file, "utf8").trim(); } catch {}
  }
  return "";
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function compactDate(value) {
  const text = String(value || "").trim();
  const direct = text.replace(/\D/g, "");
  if (direct.length >= 8) return direct.slice(0, 8);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(parsed)).replace(/\D/g, "");
}

function taipeiNowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function hasAnyKey(row, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(row || {}, key));
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function captureOpenBuyApi(query = {}) {
  const handler = require("../api/open-buy-latest");
  const queryText = new URLSearchParams(query).toString();
  let body = null;
  const request = {
    method: "GET",
    query,
    url: `/api/open-buy-latest${queryText ? `?${queryText}` : ""}`,
    headers: {},
  };
  const response = {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = Number(code) || 200; return this; },
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = String(value); },
    json(payload) { body = payload; return payload; },
    send(payload) { body = payload; return payload; },
    end(payload) { body = payload; return payload; },
  };
  await Promise.resolve(handler(request, response));
  return { statusCode: response.statusCode, headers: response.headers, body };
}

async function rest(pathname, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) fail("missing Supabase credentials");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 25000);
  try {
    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    };
    if (options.count) headers.Prefer = "count=exact";
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) fail(`${pathname} HTTP ${response.status}`, { body: text.slice(0, 500) });
    const range = response.headers.get("content-range") || "";
    const exactCount = range.includes("/") ? Number(range.split("/").pop()) : null;
    return { rows: text ? JSON.parse(text) : [], exactCount, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

async function safeRest(pathname, options = {}) {
  try {
    const result = await rest(pathname, options);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, rows: [], exactCount: 0, error: error?.message || String(error), details: error?.details || {} };
  }
}

function summarizeRows(rows = []) {
  const row = rows[0] || {};
  return {
    rowCount: rows.length,
    sampleKeys: Object.keys(row).slice(0, 30),
    hasSymbolOrCode: hasAnyKey(row, ["symbol", "code", "stock_symbol"]),
    hasTradeDate: hasAnyKey(row, ["trade_date", "scan_date", "run_trade_date"]),
    hasUpdatedAt: hasAnyKey(row, ["updated_at", "generated_at", "finished_at"]),
    sampleDate: firstValue(row, ["trade_date", "scan_date", "run_trade_date", "updated_at", "generated_at", "finished_at"]),
  };
}

function normalizeResultRow(row = {}) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const code = String(row.code || row.symbol || payload.code || payload.symbol || "").trim();
  const decision = String(row.decision || payload.strategy1Decision?.decision || payload.decision || "").trim().toUpperCase();
  return {
    runId: String(row.run_id || payload.runId || "").trim(),
    code,
    symbol: String(row.symbol || code || "").trim(),
    name: String(row.name || payload.name || code || "").trim(),
    decision: ["BUY", "WATCH", "BLOCK"].includes(decision) ? decision : "WATCH",
    score: cleanNumber(row.score || payload.score),
    reason: String(row.reason || payload.reason || "").trim(),
    setupType: String(row.setup_type || payload.strategy1Decision?.setupType || payload.setupType || "").trim(),
    blockReason: String(row.block_reason || payload.strategy1Decision?.blockReason || "").trim(),
    updatedAt: String(row.updated_at || row.generated_at || "").trim(),
    payload,
  };
}

function localPartsFrom(value) {
  const parsed = Date.parse(String(value || ""));
  const date = Number.isFinite(parsed) ? new Date(parsed) : new Date();
  return taipeiNowParts(date);
}

function currentStrategy1Phase(readyStatus = {}) {
  const phase = String(readyStatus.current_phase || "").trim();
  if (phase) return phase;
  if (readyStatus.source_status === "stopped") return "post_open_or_wait";
  const parts = taipeiNowParts();
  const minutes = cleanNumber(parts.hour) * 60 + cleanNumber(parts.minute);
  if (minutes >= 21 * 60 + 30 || minutes < 8 * 60 + 45) return "21:30_chip_candidate";
  if (minutes >= 8 * 60 + 45 && minutes < 8 * 60 + 55) return "08:45_futopt_preopen_observe";
  if (minutes >= 8 * 60 + 55 && minutes < 9 * 60) return "08:55_final_flame_gate";
  return "post_open_or_wait";
}

function normalizeReadyStatusContract(readyStatus = {}) {
  const sourceTime = readyStatus.updated_at || readyStatus.checked_at || readyStatus.source_updated_at || "";
  const parts = localPartsFrom(sourceTime);
  const flameReason = String(
    readyStatus.flame_reason
    || readyStatus.last_error
    || readyStatus.reason
    || readyStatus.source_message
    || ""
  ).trim();
  const flameGateOpen = readyStatus.flame_gate_open === true
    || (
      readyStatus.gate_active === true
      && readyStatus.preopen_ready === true
      && readyStatus.futopt_ready === true
      && readyStatus.decision_ready === true
    );
  return {
    strategy: readyStatus.strategy || "Strategy1",
    local_date: readyStatus.local_date || `${parts.year}-${parts.month}-${parts.day}`,
    local_time: readyStatus.local_time || `${parts.hour}:${parts.minute}:${parts.second}`,
    current_phase: currentStrategy1Phase(readyStatus),
    trade_date: readyStatus.trade_date || readyStatus.latest_trading_day || "",
    daily_ready: readyStatus.daily_ready === true,
    chip_ready: readyStatus.chip_ready === true,
    preopen_ready: readyStatus.preopen_ready === true,
    futopt_ready: readyStatus.futopt_ready === true,
    decision_ready: readyStatus.decision_ready === true,
    flame_gate_open: flameGateOpen,
    flame_reason: flameReason || (flameGateOpen ? "ready" : "controlled_not_ready"),
    updated_at: readyStatus.updated_at || readyStatus.checked_at || readyStatus.source_updated_at || "",
  };
}

function phaseStatus(readyStatus = {}, sourceDetails = {}) {
  const dailyReady = readyStatus.daily_ready === true;
  const chipReady = readyStatus.chip_ready === true;
  const preopenReady = readyStatus.preopen_ready === true;
  const futoptReady = readyStatus.futopt_ready === true;
  const decisionReady = readyStatus.decision_ready === true;
  const flameGateOpen = readyStatus.flame_gate_open === true;
  const flameReason = String(readyStatus.flame_reason || readyStatus.reason || readyStatus.message || readyStatus.last_error || "").trim();
  const resultRows = cleanNumber(sourceDetails.results?.exactCount ?? sourceDetails.results?.rows?.length);
  const buyRows = cleanNumber(sourceDetails.decisions?.buyRows);
  const snapshotRows = cleanNumber(sourceDetails.futoptSnapshot?.exactCount ?? sourceDetails.futoptSnapshot?.rows?.length);
  const joinRows = cleanNumber(sourceDetails.futoptJoin?.exactCount ?? sourceDetails.futoptJoin?.rows?.length);
  const preopenFeatureRows = cleanNumber(sourceDetails.preopenFeatures?.exactCount ?? sourceDetails.preopenFeatures?.rows?.length);
  const coverageRows = cleanNumber(sourceDetails.preopenCoverage?.exactCount ?? sourceDetails.preopenCoverage?.rows?.length);
  return [
    {
      phase: "21:30_chip_candidate",
      status: dailyReady && chipReady && resultRows > 0 ? "ready" : "not_ready",
      reason: `daily_ready=${dailyReady}; chip_ready=${chipReady}; result_rows=${resultRows}; buy_rows=${buyRows}`,
      requiredSources: "v_strategy1_ready_status / strategy1_open_buy_runs / strategy1_open_buy_results",
      suggestedAction: dailyReady && chipReady ? "show 21:30 candidate card; no flame" : "preserve latest complete run; show readiness reason",
    },
    {
      phase: "08:45_futopt_preopen_observe",
      status: snapshotRows > 0 && joinRows > 0 && futoptReady ? "ready" : snapshotRows > 0 && joinRows > 0 ? "controlled_not_ready" : "not_ready",
      reason: `futopt_ready=${futoptReady}; snapshot_rows=${snapshotRows}; join_rows=${joinRows}`,
      requiredSources: "strategy1_futopt_preopen_live_snapshot / v_strategy1_futopt_preopen_join_terminal",
      suggestedAction: futoptReady ? "show 08:45 observe card; no flame" : "show observe/source reason; no BUY publish",
    },
    {
      phase: "08:55_final_flame_gate",
      status: preopenReady && futoptReady && decisionReady && flameGateOpen ? "ready" : "controlled_not_ready",
      reason: `preopen_ready=${preopenReady}; futopt_ready=${futoptReady}; decision_ready=${decisionReady}; flame_gate_open=${flameGateOpen}; feature_rows=${preopenFeatureRows}; coverage_rows=${coverageRows}; reason=${flameReason || "missing"}`,
      requiredSources: "v_strategy1_ready_status / v_strategy1_preopen_features / v_strategy1_preopen_history_coverage",
      suggestedAction: flameGateOpen ? "allow flame only for decision=BUY" : "block flame; preserve latest complete run; show reason",
    },
    {
      phase: "main_matches",
      status: resultRows > 0 ? "ready" : "not_ready",
      reason: `result_rows=${resultRows}; buy_rows=${buyRows}; watch_rows=${cleanNumber(sourceDetails.decisions?.watchRows)}; block_rows=${cleanNumber(sourceDetails.decisions?.blockRows)}`,
      requiredSources: "strategy1_open_buy_results",
      suggestedAction: "display decision=BUY only; WATCH/BLOCK stay in audit/debug",
    },
  ];
}

async function main() {
  const issues = [];
  const warnings = [];
  const details = {};
  const now = taipeiNowParts();
  details.checkedAtTaipei = `${now.year}-${now.month}-${now.day} ${now.hour}:${now.minute}:${now.second}`;

  const api = await captureOpenBuyApi({
    canvas: "1",
    compact: "1",
    shell: "1",
    live: "1",
    limit: "60",
    verify: "1",
  });
  const apiRows = Array.isArray(api.body?.rows) ? api.body.rows : [];
  details.api = {
    statusCode: api.statusCode,
    ok: api.body?.ok,
    cacheSource: api.body?.cacheSource || "",
    runId: api.body?.runId || "",
    count: api.body?.count,
    resultCount: api.body?.resultCount,
    buyCount: api.body?.buyCount,
    watchCount: api.body?.watchCount,
    blockCount: api.body?.blockCount,
    decisionReady: api.body?.decisionReady,
    decisionPending: api.body?.decisionPending,
    displayMode: api.body?.displayMode || "",
    reason: api.body?.reason || api.body?.lastError || "",
    rows: apiRows.length,
    matches: Array.isArray(api.body?.matches) ? api.body.matches.length : 0,
    stageCards: api.body?.stageCards || [],
  };
  if (api.statusCode !== 200 || api.body?.ok !== true) issues.push(`api_not_ok_status_${api.statusCode}`);
  if (!details.api.runId) issues.push("api_missing_runId");
  if (cleanNumber(details.api.resultCount) <= 0) issues.push("api_resultCount_empty");
  if (api.body?.decisionReady !== true && !String(details.api.reason || "").trim()) issues.push("api_decision_pending_reason_missing");

  const health = await rest("v_scanner_resource_health?select=strategy,required_source,latest_date,row_count,status,reason,suggested_scanner_behavior,updated_at&strategy=eq.Strategy1&limit=1");
  const healthRow = health.rows?.[0] || {};
  details.health = healthRow;
  const healthStatus = String(healthRow.status || "").trim().toLowerCase();
  if (!healthRow.strategy) issues.push("health_row_missing");
  if (!["ready", "not_ready", "stale"].includes(healthStatus)) issues.push(`health_bad_status_${healthStatus || "missing"}`);
  if (healthStatus !== "ready" && !String(healthRow.reason || "").trim()) issues.push("health_not_ready_reason_missing");

  const ready = await rest("v_strategy1_ready_status?select=*&limit=1");
  const readyStatus = ready.rows?.[0] || {};
  const normalizedReadyStatus = normalizeReadyStatusContract(readyStatus);
  details.readyStatus = readyStatus;
  details.normalizedReadyStatus = normalizedReadyStatus;
  const requiredReadyFields = [
    "strategy",
    "local_date",
    "local_time",
    "current_phase",
    "trade_date",
    "daily_ready",
    "chip_ready",
    "preopen_ready",
    "futopt_ready",
    "decision_ready",
    "flame_gate_open",
    "flame_reason",
    "updated_at",
  ];
  const nativeMissingFields = requiredReadyFields.filter((field) => !Object.prototype.hasOwnProperty.call(readyStatus, field));
  const normalizedMissingFields = requiredReadyFields.filter((field) => {
    const value = normalizedReadyStatus[field];
    return value === undefined || value === null || String(value).trim() === "";
  });
  details.readyStatusContract = {
    requiredFields: requiredReadyFields,
    nativeMissingFields,
    normalizedMissingFields,
  };
  if (nativeMissingFields.length) warnings.push(`ready_status_native_missing_fields_${nativeMissingFields.join(",")}`);
  if (normalizedMissingFields.length) issues.push(`ready_status_contract_missing_fields_${normalizedMissingFields.join(",")}`);
  for (const flag of ["daily_ready", "chip_ready", "preopen_ready", "futopt_ready", "decision_ready", "flame_gate_open"]) {
    if (Object.prototype.hasOwnProperty.call(readyStatus, flag) && typeof readyStatus[flag] !== "boolean") issues.push(`ready_status_${flag}_not_boolean`);
  }
  if (normalizedReadyStatus.flame_gate_open === true && normalizedReadyStatus.decision_ready !== true) issues.push("flame_gate_open_without_decision_ready");
  if (normalizedReadyStatus.decision_ready !== true && !String(normalizedReadyStatus.flame_reason || "").trim()) issues.push("decision_not_ready_reason_missing");

  const runs = await rest("strategy1_open_buy_runs?select=*&strategy=eq.strategy1&status=eq.complete&complete=eq.true&order=finished_at.desc&limit=1");
  const latestRun = runs.rows?.[0] || {};
  details.latestRun = {
    runId: latestRun.run_id || "",
    scanDate: latestRun.scan_date || "",
    tradeDate: latestRun.trade_date || latestRun.run_trade_date || "",
    status: latestRun.status || "",
    complete: latestRun.complete,
    expectedTotal: latestRun.expected_total,
    scannedCount: latestRun.scanned_count,
    resultCount: latestRun.result_count,
    qualityStatus: latestRun.quality_status || "",
    updatedAt: latestRun.updated_at || latestRun.finished_at || "",
  };
  if (!latestRun.run_id) issues.push("latest_complete_run_missing");
  if (latestRun.run_id && latestRun.complete !== true) issues.push("latest_run_not_complete");
  if (latestRun.run_id && String(latestRun.status || "").toLowerCase() !== "complete") issues.push(`latest_run_bad_status_${latestRun.status || "missing"}`);

  const resultsPath = `strategy1_open_buy_results?select=run_id,scan_date,code,symbol,name,decision,rank,score,reason,setup_type,block_reason,payload,updated_at&strategy=eq.strategy1&run_id=eq.${encodeURIComponent(latestRun.run_id || "")}&order=rank.asc&limit=2000`;
  const results = latestRun.run_id ? await rest(resultsPath, { count: true }) : { rows: [], exactCount: 0 };
  const normalizedRows = (results.rows || []).map(normalizeResultRow);
  const buyRows = normalizedRows.filter((row) => row.decision === "BUY").length;
  const watchRows = normalizedRows.filter((row) => row.decision === "WATCH").length;
  const blockRows = normalizedRows.filter((row) => row.decision === "BLOCK").length;
  details.results = {
    exactCount: results.exactCount,
    visibleRows: normalizedRows.length,
    buyRows,
    watchRows,
    blockRows,
    missingRunId: normalizedRows.filter((row) => !row.runId).length,
    missingCode: normalizedRows.filter((row) => !/^\d{4}$/.test(row.code || row.symbol)).length,
    missingDecision: normalizedRows.filter((row) => !["BUY", "WATCH", "BLOCK"].includes(row.decision)).length,
    missingReason: normalizedRows.filter((row) => !row.reason && row.decision !== "BLOCK").length,
    firstRows: normalizedRows.slice(0, 8).map((row) => ({
      code: row.code || row.symbol,
      name: row.name,
      decision: row.decision,
      score: row.score,
      setupType: row.setupType,
    })),
  };
  if (cleanNumber(results.exactCount ?? normalizedRows.length) <= 0) issues.push("result_rows_empty");
  if (details.results.missingRunId > 0) issues.push(`result_rows_missing_runId_${details.results.missingRunId}`);
  if (details.results.missingCode > 0) issues.push(`result_rows_missing_code_${details.results.missingCode}`);

  const sourceChecks = {
    futoptSnapshot: await safeRest("strategy1_futopt_preopen_live_snapshot?select=*&limit=1", { count: true }),
    futoptJoin: await safeRest("v_strategy1_futopt_preopen_join_terminal?select=*&limit=1", { count: true }),
    preopenFeatures: await safeRest("v_strategy1_preopen_features?select=*&limit=1", { count: true }),
    preopenCoverage: await safeRest("v_strategy1_preopen_history_coverage?select=*&limit=1", { count: true }),
  };
  details.sourceContracts = Object.fromEntries(Object.entries(sourceChecks).map(([key, value]) => [key, {
    ok: value.ok,
    error: value.error || "",
    exactCount: value.exactCount,
    ...summarizeRows(value.rows),
  }]));
  for (const [key, value] of Object.entries(sourceChecks)) {
    if (!value.ok) issues.push(`${key}_unreadable_${value.error}`);
    if (value.ok && cleanNumber(value.exactCount ?? value.rows.length) <= 0) warnings.push(`${key}_empty`);
    const summary = summarizeRows(value.rows);
    if (value.ok && value.rows.length && !summary.hasSymbolOrCode && ["futoptSnapshot", "futoptJoin", "preopenFeatures"].includes(key)) issues.push(`${key}_missing_symbol_or_code`);
  }

  details.decisions = { buyRows, watchRows, blockRows };
  details.phases = phaseStatus(normalizedReadyStatus, {
    results,
    decisions: details.decisions,
    futoptSnapshot: sourceChecks.futoptSnapshot,
    futoptJoin: sourceChecks.futoptJoin,
    preopenFeatures: sourceChecks.preopenFeatures,
    preopenCoverage: sourceChecks.preopenCoverage,
  });
  for (const phase of details.phases) {
    if (phase.status === "not_ready" && phase.phase === "21:30_chip_candidate") issues.push(`phase_${phase.phase}_not_ready`);
    if (phase.status !== "ready" && !phase.reason) issues.push(`phase_${phase.phase}_reason_missing`);
  }

  const flameRows = normalizedRows.filter((row) => row.decision === "BUY" && /A|open.?buy|開盤|火焰/i.test(`${row.setupType} ${row.reason} ${JSON.stringify(row.payload || {})}`));
  details.flameGate = {
    flameGateOpen: normalizedReadyStatus.flame_gate_open === true,
    decisionReady: normalizedReadyStatus.decision_ready === true,
    buyRows,
    inferredFlameEligibleRows: flameRows.length,
    reason: normalizedReadyStatus.flame_reason || "",
  };
  if (normalizedReadyStatus.flame_gate_open === true && buyRows <= 0) warnings.push("flame_gate_open_but_no_buy_rows");
  if (normalizedReadyStatus.flame_gate_open !== true && !details.flameGate.reason) issues.push("flame_gate_closed_reason_missing");

  const output = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    strategy: "Strategy1",
    contract: "strategy1-open-buy-battle-verify-v1",
    issues,
    warnings,
    details,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, strategy: "Strategy1", error: error?.message || String(error), details: error?.details || {} }, null, 2)}\n`);
  process.exit(1);
});
