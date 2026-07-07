const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const { auditStrategy3BusinessFields } = require("./scan-strategy3-cache");
const { verifyStrategy3PrewaterPayload } = require("./strategy3-prewater-payload-verifier");
const { normalizeStrategy3ApiContract } = require("../api/strategy3-latest");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_DIR = path.resolve(process.env.STRATEGY3_LIVE_READBACK_OUT_DIR || path.join(ROOT, "outputs", "strategy3-live-readback"));
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "scan-receipts");
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
const DEFAULT_TIMEOUT_MS = Number(process.env.STRATEGY3_LIVE_READBACK_TIMEOUT_MS || 25000);

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg === name || arg.startsWith(prefix));
  if (!hit) return fallback;
  return hit === name ? "1" : hit.slice(prefix.length);
}

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function requireSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing_supabase_credentials");
}

async function rest(pathname, options = {}) {
  requireSupabase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
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
    if (!response.ok) throw new Error(`${pathname} HTTP ${response.status} ${text.slice(0, 300)}`.trim());
    const contentRange = response.headers.get("content-range") || "";
    const exactCount = contentRange.includes("/") ? Number(contentRange.split("/").pop()) : null;
    return { rows: text ? JSON.parse(text) : [], exactCount };
  } finally {
    clearTimeout(timer);
  }
}

async function restSafe(pathname, options = {}) {
  try {
    return { ok: true, ...(await rest(pathname, options)) };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), rows: [], exactCount: null };
  }
}

async function captureApi(handler, query = {}) {
  let body = null;
  const req = { method: "GET", query, headers: {}, url: "/api/strategy3-latest?verify=1&live=1&limit=120" };
  const res = {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    json(payload) { body = payload; return payload; },
    send(payload) { body = payload; return payload; },
    end(payload) { body = payload; return payload; },
  };
  await Promise.resolve(handler(req, res));
  return { statusCode: res.statusCode, body };
}

function rowPayload(row = {}, index = 0, fallbackRunId = "") {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return {
    ...payload,
    code: String(payload.code || row.code || "").trim(),
    name: String(payload.name || payload.displayName || row.name || "").trim(),
    rank: cleanNumber(payload.rank || row.rank || index + 1),
    score: cleanNumber(payload.score || row.score),
    runId: String(payload.runId || row.run_id || fallbackRunId || "").trim(),
    updatedAt: String(payload.updatedAt || row.updated_at || "").trim(),
    source: String(payload.source || row.source || "strategy3_scan_results").trim(),
  };
}

async function readLatestState() {
  const latest = await restSafe("v_strategy3_latest_complete_run?select=*&limit=1");
  const latestRow = latest.rows?.[0] || {};
  const latestRunId = String(latestRow.run_id || latestRow.runId || latestRow.id || "").trim();
  const runResult = latestRunId
    ? await restSafe(`strategy3_scan_runs?select=run_id,strategy,status,expected_total,scanned_count,result_count,payload,updated_at&run_id=eq.${encodeURIComponent(latestRunId)}&limit=1`)
    : { ok: false, rows: [], error: "latest_run_id_missing" };
  const runRow = runResult.rows?.[0] || latestRow;
  const resultCount = cleanNumber(runRow.result_count ?? latestRow.result_count ?? latestRow.count);
  const readLimit = Math.max(1, Math.min(2000, resultCount || 2000));
  const results = latestRunId
    ? await restSafe(`strategy3_scan_results?select=run_id,strategy,rank,code,name,score,payload,updated_at&run_id=eq.${encodeURIComponent(latestRunId)}&strategy=eq.strategy3&order=rank.asc&limit=${readLimit}`, { count: true })
    : { ok: false, rows: [], exactCount: 0, error: "latest_run_id_missing" };
  const apiHandler = require("../api/strategy3-latest");
  const api = await captureApi(apiHandler, { verify: "1", live: "1", limit: "120", noSnapshot: "1" });
  const apiPayload = api.body && typeof api.body === "object"
    ? api.body
    : normalizeStrategy3ApiContract(api.body || {}, {});
  const runPayload = runRow.payload && typeof runRow.payload === "object" ? runRow.payload : {};
  const resultPayloads = asArray(results.rows).map((row, index) => rowPayload(row, index, latestRunId));
  const mergedPayload = {
    ...runPayload,
    runId: latestRunId || runPayload.runId || apiPayload.runId || "",
    count: resultCount,
    matches: resultPayloads,
    resultRows: resultPayloads,
    readbackCount: cleanNumber(results.exactCount ?? results.rows?.length),
    latestPointerRunId: latestRunId,
  };
  return {
    checkedAt: new Date().toISOString(),
    latest: { ok: latest.ok, error: latest.error || "", row: latestRow, runId: latestRunId },
    run: { ok: runResult.ok, error: runResult.error || "", row: runRow, payload: runPayload },
    results: {
      ok: results.ok,
      error: results.error || "",
      exactCount: results.exactCount,
      rowsRead: results.rows.length,
      sample: resultPayloads.slice(0, 10).map((row) => ({ code: row.code, name: row.name, rank: row.rank, score: row.score })),
    },
    api: { statusCode: api.statusCode, payload: apiPayload },
    mergedPayload,
  };
}

function latestPointer(state = {}) {
  const quality = state.mergedPayload?.run_quality_at_publish || {};
  return {
    runId: state.latest?.runId || state.mergedPayload?.runId || "",
    resultCount: cleanNumber(state.run?.row?.result_count ?? state.mergedPayload?.count),
    readbackCount: cleanNumber(state.results?.exactCount ?? state.results?.rowsRead ?? quality.readbackCount),
    checkedAt: state.checkedAt || "",
  };
}

function allowsExplicitEmptyCompleteRun(state = {}) {
  const payload = state.mergedPayload || {};
  const pointer = latestPointer(state);
  return pointer.resultCount === 0
    && pointer.readbackCount === 0
    && payload.count === 0
    && payload.emptyCompleteReleaseOwnerApproved === true;
}

function newestBlockedReceipt(sinceIso = "") {
  const since = Date.parse(sinceIso || "") || 0;
  let files = [];
  try {
    files = fs.readdirSync(RECEIPT_DIR)
      .filter((name) => /^strategy3-blocked-.*\.json$/i.test(name))
      .map((name) => path.join(RECEIPT_DIR, name))
      .map((file) => ({ file, stat: fs.statSync(file), payload: safeJson(file, {}) }))
      .filter((item) => item.stat.mtimeMs >= since)
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  } catch {}
  const hit = files[0] || null;
  return hit ? {
    ...hit.payload,
    file: hit.file,
    mtime: new Date(hit.stat.mtimeMs).toISOString(),
  } : null;
}

function verifyState(state, options = {}) {
  const issues = [];
  const warnings = [];
  const pointer = latestPointer(state);
  const payload = state.mergedPayload || {};
  const api = state.api?.payload || {};
  const quality = payload.run_quality_at_publish || {};
  const before = options.before || {};
  const beforePointer = before.latestPointer || before.pointer || {};
  const receipt = options.expectBlocked
    ? newestBlockedReceipt(before.checkedAt || beforePointer.checkedAt || "")
    : null;
  const blockedPayload = receipt || api;
  const prewater = options.expectBlocked
    ? verifyStrategy3PrewaterPayload(blockedPayload, { label: receipt ? "blocked-receipt" : "api-blocked-payload", expectBlocked: true })
    : verifyStrategy3PrewaterPayload(payload, { label: "supabase-run-payload", expectBlocked: false });
  const business = options.expectBlocked
    ? { ok: true, blankTotal: 0, blankCounts: {}, sampleMissingRows: [] }
    : auditStrategy3BusinessFields(payload);

  if (!state.latest?.ok) issues.push(`latest_view_read_failed:${state.latest?.error || "unknown"}`);
  if (!state.run?.ok) issues.push(`run_read_failed:${state.run?.error || "unknown"}`);
  if (!state.results?.ok) issues.push(`result_read_failed:${state.results?.error || "unknown"}`);
  if (!pointer.runId) issues.push("latest_pointer_runId_missing");
  if (pointer.resultCount !== pointer.readbackCount) issues.push(`readback_mismatch:${pointer.readbackCount}/${pointer.resultCount}`);
  if (!prewater.ok) issues.push(...prewater.issues.map((issue) => `prewater:${issue}`));
  if (!business.ok) issues.push(`business_blank_total:${business.blankTotal}`);
  if (asArray(payload.fallbackScope).includes("source")) issues.push("formal_source_fallback_used");
  if (payload.fallbackUsed === true && (!asArray(payload.fallbackScope).length || !asArray(payload.fallbackDetails).length || !payload.fallbackContract)) {
    issues.push("fallback_disclosure_incomplete");
  }

  if (options.expectComplete) {
    if (payload.evidenceStatus !== "complete") issues.push(`evidenceStatus_not_complete:${payload.evidenceStatus || "missing"}`);
    if (payload.unattendedStatus !== "YES") issues.push(`unattendedStatus_not_YES:${payload.unattendedStatus || "missing"}`);
    if (payload.publishAllowed !== true && quality.publishAllowed !== true) issues.push("publishAllowed_not_true");
    if (payload.latestOverwriteAllowed === false) issues.push("latestOverwriteAllowed_false_on_complete");
    if (pointer.resultCount <= 0 && !allowsExplicitEmptyCompleteRun(state)) issues.push("complete_run_empty_result_not_accepted_without_explicit_empty_contract");
    if (api.runId && pointer.runId && String(api.runId) !== String(pointer.runId)) issues.push(`api_runId_mismatch:${api.runId}/${pointer.runId}`);
  }

  if (options.expectBlocked) {
    const blockedQuality = blockedPayload.run_quality_at_publish || {};
    if (api.publishAllowed === true || api.run_quality_at_publish?.publishAllowed === true) issues.push("api_blocked_state_publishAllowed_true");
    if (api.latestOverwriteAllowed === true || api.run_quality_at_publish?.latestOverwriteAllowed === true) issues.push("api_blocked_state_latestOverwriteAllowed_true");
    if (api.preservePreviousGood !== true && api.run_quality_at_publish?.preservePreviousGood !== true) issues.push("api_blocked_state_preservePreviousGood_not_true");
    if (api.evidenceStatus === "complete" || api.unattendedStatus === "YES") issues.push("api_blocked_state_fake_complete_or_yes");
    if (blockedPayload.publishAllowed === true || blockedQuality.publishAllowed === true) issues.push("blocked_state_publishAllowed_true");
    if (blockedPayload.latestOverwriteAllowed === true || blockedQuality.latestOverwriteAllowed === true) issues.push("blocked_state_latestOverwriteAllowed_true");
    if (blockedPayload.preservePreviousGood !== true && blockedQuality.preservePreviousGood !== true) issues.push("blocked_state_preservePreviousGood_not_true");
    if (blockedPayload.evidenceStatus === "complete" || blockedPayload.unattendedStatus === "YES") issues.push("blocked_state_fake_complete_or_yes");
    if (beforePointer.runId && pointer.runId !== beforePointer.runId) {
      issues.push(`latest_pointer_changed_when_blocked:${beforePointer.runId}->${pointer.runId}`);
    }
    if (!receipt) {
      issues.push("blocked_receipt_missing_after_before_capture");
    } else {
      if (receipt.latestOverwriteAllowed !== false) issues.push("blocked_receipt_allows_latest");
      if (receipt.preservePreviousGood !== true) issues.push("blocked_receipt_preservePreviousGood_not_true");
      if (receipt.evidenceStatus !== "insufficient" || receipt.unattendedStatus !== "NO") issues.push("blocked_receipt_status_invalid");
      if (!receipt.blockedReason) issues.push("blocked_receipt_reason_missing");
    }
    warnings.push("expect_blocked_does_not_regrade_historical_previous_good_run_payload");
  }

  if (options.expectComplete && payload.count === 0 && !allowsExplicitEmptyCompleteRun(state)) {
    issues.push("empty_result_complete_requires_release_owner_approval_before_accepting_latest");
  }

  return {
    ok: issues.length === 0,
    pointer,
    prewater,
    business: {
      ok: business.ok,
      blankTotal: business.blankTotal,
      blankCounts: business.blankCounts,
      sampleMissingRows: business.sampleMissingRows,
    },
    issues,
    warnings,
  };
}

async function main() {
  const captureBefore = hasFlag("--capture-before");
  const expectBlocked = hasFlag("--expect-blocked");
  const expectComplete = hasFlag("--expect-complete") || (!expectBlocked && !captureBefore);
  const beforeFile = argValue("--compare-before", "");
  const before = beforeFile ? safeJson(path.resolve(beforeFile), {}) : null;
  const state = await readLatestState();
  const pointer = latestPointer(state);
  const verification = captureBefore
    ? { ok: true, pointer, issues: [], warnings: ["capture_before_only_no_publish_claim"] }
    : verifyState(state, { expectBlocked, expectComplete, before });
  const output = {
    ok: verification.ok,
    checkedAt: new Date().toISOString(),
    mode: captureBefore ? "capture-before" : expectBlocked ? "expect-blocked" : "expect-complete",
    readOnly: true,
    latestPointer: pointer,
    verification,
    state: {
      latest: state.latest,
      run: {
        ok: state.run.ok,
        error: state.run.error,
        runId: state.run.row?.run_id || "",
        status: state.run.row?.status || "",
        expectedTotal: state.run.row?.expected_total,
        scannedCount: state.run.row?.scanned_count,
        resultCount: state.run.row?.result_count,
        payloadKeys: Object.keys(state.run.payload || {}).sort(),
      },
      results: state.results,
      api: {
        statusCode: state.api.statusCode,
        runId: state.api.payload?.runId || "",
        count: state.api.payload?.count,
        evidenceStatus: state.api.payload?.evidenceStatus || "",
        unattendedStatus: state.api.payload?.unattendedStatus || "",
        publishAllowed: state.api.payload?.publishAllowed,
        fallbackUsed: state.api.payload?.fallbackUsed,
      },
    },
  };
  if (captureBefore) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `strategy3-before-${stamp()}.json`);
    fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
    output.beforeFile = file;
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    checkedAt: new Date().toISOString(),
    readOnly: true,
    error: error?.message || String(error),
  }, null, 2)}\n`);
  process.exitCode = 1;
});
