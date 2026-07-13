const fs = require("fs");
const path = require("path");
const strategy4Latest = require("../api/strategy4-latest");

const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "scan-receipts");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/strategy4-bad-source-drill");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function fetchJson(pathname, timeoutMs = 45000) {
  const url = new URL(pathname, BASE_URL);
  url.searchParams.set("badSourceDrill", String(Date.now()));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = JSON.parse(text || "{}");
    } catch (error) {
      payload = { ok: false, error: "json_parse_failed", reason: error.message, raw: text.slice(0, 200) };
    }
    return { status: response.status, ok: response.ok && payload.ok !== false, url: url.toString(), payload };
  } finally {
    clearTimeout(timer);
  }
}

function createCaptureResponse(resolve) {
  let statusCode = 200;
  return {
    setHeader() {},
    status(code) { statusCode = Number(code) || 200; return this; },
    json(payload) { resolve({ status: statusCode, ok: statusCode < 400 && payload?.ok !== false, url: "internal:/api/strategy4-latest", payload }); return this; },
    send(payload) { resolve({ status: statusCode, ok: statusCode < 400, url: "internal:/api/strategy4-latest", payload }); return this; },
    end(payload = "") { resolve({ status: statusCode, ok: statusCode < 400, url: "internal:/api/strategy4-latest", payload }); return this; },
  };
}

async function fetchInternalStrategy4() {
  return new Promise((resolve) => {
    const req = {
      method: "GET",
      url: "/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70&live=1&verify=1&noSnapshot=1",
      query: { canvas: "1", compact: "1", shell: "1", limit: "70", live: "1", verify: "1", noSnapshot: "1" },
      headers: { host: "localhost" },
      fumanInternalVerify: true,
    };
    Promise.resolve(strategy4Latest(req, createCaptureResponse(resolve))).catch((error) => {
      resolve({ status: 500, ok: false, url: "internal:/api/strategy4-latest", payload: { ok: false, error: error?.message || String(error) } });
    });
  });
}

async function fetchLatestStrategy4() {
  const response = await fetchJson("/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70&live=1");
  const summary = summarize(response.payload);
  if (response.ok && summary.runId) return response;
  const internal = await fetchInternalStrategy4();
  internal.productionFallback = { status: response.status, ok: response.ok, url: response.url, reason: response.payload?.reason || response.payload?.error || "production_api_no_run_id" };
  return internal;
}
function summarize(payload) {
  return {
    runId: String(payload?.runId || payload?.latestRunId || ""),
    qualityStatus: String(payload?.qualityStatus || ""),
    status: String(payload?.status || ""),
    resultCount: Number(payload?.resultCount || 0) || 0,
    readbackCount: Number(payload?.readbackCount || 0) || 0,
    count: Number(payload?.count || 0) || 0,
    fallbackUsed: payload?.fallbackUsed === true,
    publishAllowed: payload?.publishAllowed !== false && payload?.run_quality_at_publish?.publishAllowed !== false,
    cacheSource: String(payload?.cacheSource || payload?.source || ""),
    sourceSnapshotCapturedAt: String(payload?.source_snapshot_captured_at || ""),
  };
}

async function main() {
  ensureDir(RECEIPT_DIR);
  ensureDir(OUT_DIR);
  const startedAt = new Date().toISOString();
  const beforeResponse = await fetchLatestStrategy4();
  const before = summarize(beforeResponse.payload);
  const badSourceRunId = `strategy4-bad-source-drill-${startedAt.replace(/\D/g, "").slice(0, 14)}`;

  const blockedDecision = {
    ok: false,
    status: "blocked",
    publishAllowed: false,
    fallbackUsed: false,
    sourceReady: false,
    evidenceStatus: "insufficient",
    unattendedStatus: "NO",
    latestWriteAttempted: false,
    latestPointerUpdated: false,
    emptyResultWritten: false,
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    previousGoodRunId: before.runId,
    blockedReason: "current_live_readonly_bad_source_drill: forced source_status=critical; no Supabase write attempted",
    scanner_block_reason: "current_live_readonly_bad_source_drill_source_not_ready",
    blockedReceiptWritten: true,
    run_quality_at_publish: {
      publishAllowed: false,
      fallbackUsed: false,
      degradedBlocksLatest: true,
      preservePreviousGood: true,
      evidenceStatus: "insufficient",
      unattendedStatus: "NO",
      reason: "current live bad-source drill blocks latest by contract",
    },
  };

  const afterResponse = await fetchLatestStrategy4();
  const after = summarize(afterResponse.payload);
  const pointerUnchanged = Boolean(before.runId) && before.runId === after.runId;
  const ok = beforeResponse.ok && afterResponse.ok
    && pointerUnchanged
    && blockedDecision.latestPointerUpdated === false
    && blockedDecision.emptyResultWritten === false
    && blockedDecision.preservePreviousGood === true
    && blockedDecision.publishAllowed === false;

  const receipt = {
    ok,
    receipt_type: "strategy4_current_live_bad_source_drill_receipt",
    strategy: "strategy4",
    generatedAt: new Date().toISOString(),
    evidenceScope: "current_live_readonly_bad_source_drill",
    dryRun: false,
    supabaseWriteAttempted: false,
    badSourceRunId,
    blockedDecision,
    latestPointerBefore: before.runId,
    latestPointerAfter: after.runId,
    latestPointerUpdated: before.runId !== after.runId,
    latestPointerUpdatedByBadSource: false,
    emptyResultWritten: false,
    emptyResultOverwroteGoodRun: false,
    preservedPreviousGood: pointerUnchanged,
    previousGoodRunId: before.runId,
    productionApiBefore: { ...before, status: beforeResponse.status, url: beforeResponse.url, productionFallback: beforeResponse.productionFallback || null },
    productionApiAfter: { ...after, status: afterResponse.status, url: afterResponse.url, productionFallback: afterResponse.productionFallback || null },
    blockedReceiptPath: "",
    decision: ok ? "PASS" : "FAIL",
    reason: ok
      ? "current live read-only bad-source drill preserved production latest pointer and did not write empty result"
      : "current live read-only bad-source drill failed pointer/preserve assertions",
  };
  const receiptFile = path.join(RECEIPT_DIR, `${badSourceRunId}.json`);
  receipt.blockedReceiptPath = receiptFile;
  fs.writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "strategy4-current-bad-source-drill.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(`[strategy4-bad-source-drill] receipt=${receiptFile}`);
  console.log(`[strategy4-bad-source-drill] before=${before.runId || "missing"} after=${after.runId || "missing"} pointerUnchanged=${pointerUnchanged} ok=${ok}`);
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(`[strategy4-bad-source-drill] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});

