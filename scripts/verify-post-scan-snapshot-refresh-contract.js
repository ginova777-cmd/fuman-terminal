"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_FILE = process.env.FUMAN_POST_SCAN_SNAPSHOT_REFRESH_OUT
  || path.join(RUNTIME_DIR, "post-scan-snapshot-refresh-latest.json");

const {
  readDesktopRouteSnapshot,
  endpointPayloadFromSnapshot,
} = require("../lib/desktop-route-snapshot-cache");

const TASKS = [
  {
    key: "strategy1",
    strategy: "Strategy1",
    endpoint: "/api/open-buy-latest",
    modulePath: "../api/open-buy-latest",
    query: { canvas: "1", compact: "1", shell: "1", limit: "60" },
    minCount: 1,
  },
  {
    key: "strategy3",
    strategy: "Strategy3",
    endpoint: "/api/strategy3-latest",
    modulePath: "../api/strategy3-latest",
    query: { canvas: "1", compact: "1", shell: "1", limit: "60" },
    minCount: 1,
  },
  {
    key: "strategy4",
    strategy: "Strategy4",
    endpoint: "/api/strategy4-latest",
    modulePath: "../api/strategy4-latest",
    query: { canvas: "1", compact: "1", shell: "1", limit: "70" },
    minCount: 1,
  },
  {
    key: "strategy5",
    strategy: "Strategy5",
    endpoint: "/api/strategy5-latest",
    modulePath: "../api/strategy5-latest",
    query: { canvas: "1", compact: "1", shell: "1", limit: "70" },
    minCount: 1,
  },
  {
    key: "institution",
    strategy: "Strategy5 / institution",
    endpoint: "/api/institution-latest",
    modulePath: "../api/institution-latest",
    query: { canvas: "1", compact: "1", shell: "1", limit: "60" },
    minCount: 1,
  },
  {
    key: "cb",
    strategy: "CB",
    endpoint: "/api/cb-detect-latest",
    modulePath: "../api/cb-detect-latest",
    query: { canvas: "1", compact: "1", shell: "1", limit: "60" },
    minCount: 1,
  },
  {
    key: "warrant",
    strategy: "Warrant",
    endpoint: "/api/warrant-flow-latest",
    modulePath: "../api/warrant-flow-latest",
    query: { canvas: "1", compact: "1", shell: "1", limit: "60" },
    minCount: 1,
  },
];

function arg(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((item) => item === name || item.startsWith(prefix));
  if (!found) return fallback;
  return found === name ? "1" : found.slice(prefix.length);
}

function flag(name) {
  return process.argv.includes(name) || process.argv.some((item) => item.startsWith(`${name}=`));
}

function selectedTasks() {
  const raw = String(arg("--routes", process.env.FUMAN_POST_SCAN_SNAPSHOT_ROUTES || "") || "").trim();
  if (!raw) return TASKS;
  const wanted = new Set(raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
  if (!wanted.size) return TASKS;
  const tasks = TASKS.filter((task) => wanted.has(task.key.toLowerCase()));
  if (!tasks.length) throw new Error(`no post-scan snapshot tasks matched routes=${raw}`);
  return tasks;
}

function mkdirp(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function writeJson(file, payload) {
  mkdirp(file);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function compactDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return digits;
  if (/^\d{7}$/.test(digits)) {
    const rocYear = Number(digits.slice(0, 3));
    if (rocYear > 0) return `${rocYear + 1911}${digits.slice(3)}`;
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return digits.slice(0, 8);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(parsed)).replace(/\D/g, "");
}

function arraysFromPayload(payload) {
  if (!payload || typeof payload !== "object") return [];
  const arrays = [];
  for (const key of ["matches", "rows", "records", "signals", "volumeMatches", "singleSignals"]) {
    if (Array.isArray(payload[key])) arrays.push(payload[key]);
  }
  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    arrays.push(Object.values(payload.data));
  }
  return arrays;
}

function firstFinite(values) {
  for (const value of values) {
    const number = cleanNumber(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function payloadCount(payload) {
  const arrays = arraysFromPayload(payload);
  return firstFinite([
    payload?.count,
    payload?.total,
    payload?.resultCount,
    payload?.matchesTotal,
    payload?.rowsTotal,
    payload?.dataTotal,
    arrays[0]?.length,
  ]);
}

function returnedCount(payload) {
  const arrays = arraysFromPayload(payload);
  return firstFinite([
    payload?.returnedCount,
    payload?.returned_count,
    arrays[0]?.length,
  ]);
}

function payloadRunId(payload) {
  return String(
    payload?.runId
    || payload?.run_id
    || payload?.transport?.runId
    || payload?.transport?.run_id
    || payload?.meta?.runId
    || payload?.meta?.run_id
    || ""
  ).trim();
}

function payloadDate(payload) {
  return compactDate(
    payload?.usedDate
    || payload?.tradeDate
    || payload?.sourceDate
    || payload?.scanDate
    || payload?.date
    || payload?.marketSession?.marketDataIsoDate
    || payload?.marketSession?.taipeiDate
    || payload?.transport?.date
    || ""
  );
}

function payloadUpdatedAt(payload) {
  return String(
    payload?.updatedAt
    || payload?.generatedAt
    || payload?.finishedAt
    || payload?.transport?.fetchedAt
    || ""
  ).trim();
}

function normalizePayload(payload, statusCode = 0) {
  const count = payloadCount(payload);
  return {
    ok: Boolean(payload && typeof payload === "object" && payload.ok !== false && Number(statusCode || 0) < 400),
    statusCode: Number(statusCode || 0),
    cacheSource: String(payload?.cacheSource || payload?.source || payload?.transport?.source || ""),
    runId: payloadRunId(payload),
    date: payloadDate(payload),
    count,
    returnedCount: returnedCount(payload),
    complete: payload?.complete === undefined ? null : Boolean(payload.complete),
    qualityStatus: String(payload?.qualityStatus || payload?.quality_status || ""),
    updatedAt: payloadUpdatedAt(payload),
    reason: String(payload?.reason || payload?.detail || payload?.error || payload?.transport?.gate || ""),
  };
}

function buildEndpoint(endpoint, query = {}) {
  const url = new URL(endpoint, "https://fuman.local");
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
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
    getHeader(name) {
      return this.headers[String(name).toLowerCase()];
    },
    status(code) {
      this.statusCode = Number(code) || 200;
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

function callApi(task, mode, timeoutMs) {
  return new Promise((resolve) => {
    const handler = require(task.modulePath);
    const query = {
      ...task.query,
      verify: "1",
      postScanSnapshotContract: "1",
      ...(mode === "live" ? { live: "1" } : {}),
    };
    const endpoint = buildEndpoint(task.endpoint, query);
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      resolve({
        statusCode: 504,
        payload: {
          ok: false,
          error: "post_scan_snapshot_contract_timeout",
          mode,
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
    const req = {
      method: "GET",
      url: endpoint,
      headers: { host: "localhost", "x-post-scan-snapshot-contract": "1" },
      query,
    };
    Promise.resolve(handler(req, createCaptureResponse(finish, endpoint))).catch((error) => {
      finish({
        statusCode: 500,
        payload: {
          ok: false,
          error: "post_scan_snapshot_contract_handler_failed",
          mode,
          endpoint,
          message: error?.message || String(error),
        },
        headers: {},
        label: endpoint,
      });
    });
  });
}

function alignRow(task, snapshotBundlePayload, snapshotApi, liveApi, maxAgeOk) {
  const bundleEndpoint = buildEndpoint(task.endpoint, task.query);
  const bundlePayload = endpointPayloadFromSnapshot(snapshotBundlePayload, bundleEndpoint);
  const bundle = normalizePayload(bundlePayload, bundlePayload ? 200 : 404);
  const snapshot = normalizePayload(snapshotApi.payload, snapshotApi.statusCode);
  const live = normalizePayload(liveApi.payload, liveApi.statusCode);
  const reasons = [];

  const snapshotHit = /desktop_route_snapshot/.test(snapshot.cacheSource);
  const bundleHit = Boolean(bundlePayload);
  const runIdAligned = live.runId
    ? live.runId === snapshot.runId && live.runId === bundle.runId
    : snapshot.runId === bundle.runId;
  const countAligned = live.count === snapshot.count && snapshot.count === bundle.count;
  const dateAligned = !live.date || !snapshot.date || live.date === snapshot.date;
  const enoughRows = live.count >= task.minCount && snapshot.count >= task.minCount && bundle.count >= task.minCount;
  const bundleDisplayReady = bundleHit && runIdAligned && countAligned && dateAligned && enoughRows;

  if (!maxAgeOk) reasons.push("desktop_route_snapshot is stale");
  if (!bundlePayload) reasons.push("endpoint missing from desktop_route_snapshot bundle");
  if (!snapshot.ok) reasons.push(`snapshot API failed status=${snapshot.statusCode} reason=${snapshot.reason}`);
  if (!live.ok) reasons.push(`live API failed status=${live.statusCode} reason=${live.reason}`);
  if (!snapshotHit && !bundleDisplayReady) reasons.push(`snapshot API did not hit desktop route snapshot; cacheSource=${snapshot.cacheSource || "empty"}`);
  if (!runIdAligned) reasons.push(`runId mismatch live=${live.runId || "empty"} snapshot=${snapshot.runId || "empty"} bundle=${bundle.runId || "empty"}`);
  if (!countAligned) reasons.push(`count mismatch live=${live.count} snapshot=${snapshot.count} bundle=${bundle.count}`);
  if (!dateAligned) reasons.push(`date mismatch live=${live.date || "empty"} snapshot=${snapshot.date || "empty"}`);
  if (!enoughRows) reasons.push(`row_count below minimum ${task.minCount}; live=${live.count} snapshot=${snapshot.count} bundle=${bundle.count}`);

  return {
    key: task.key,
    strategy: task.strategy,
    endpoint: bundleEndpoint,
    status: reasons.length ? "failed" : "ready",
    immediateDisplayReady: reasons.length === 0,
    snapshotHit,
    bundleHit,
    runIdAligned,
    countAligned,
    dateAligned,
    rowCountOk: enoughRows,
    minCount: task.minCount,
    live: {
      runId: live.runId,
      date: live.date,
      count: live.count,
      returnedCount: live.returnedCount,
      cacheSource: live.cacheSource,
      updatedAt: live.updatedAt,
      reason: live.reason,
      elapsedMs: liveApi.elapsedMs || 0,
    },
    snapshotApi: {
      runId: snapshot.runId,
      date: snapshot.date,
      count: snapshot.count,
      returnedCount: snapshot.returnedCount,
      cacheSource: snapshot.cacheSource,
      updatedAt: snapshot.updatedAt,
      reason: snapshot.reason,
      elapsedMs: snapshotApi.elapsedMs || 0,
    },
    bundle: {
      runId: bundle.runId,
      date: bundle.date,
      count: bundle.count,
      returnedCount: bundle.returnedCount,
      cacheSource: bundle.cacheSource,
      updatedAt: bundle.updatedAt,
      reason: bundle.reason,
    },
    reason: reasons.length ? reasons.join("; ") : "snapshot API, live API, and desktop_route_snapshot bundle are aligned",
  };
}

async function main() {
  const timeoutMs = Math.max(1000, cleanNumber(arg("--timeout-ms", process.env.FUMAN_POST_SCAN_SNAPSHOT_ENDPOINT_TIMEOUT_MS || "30000")));
  const maxAgeMs = Math.max(0, cleanNumber(arg("--max-age-ms", process.env.FUMAN_POST_SCAN_SNAPSHOT_MAX_AGE_MS || "600000")));
  const failOnStale = !flag("--allow-stale");
  const tasks = selectedTasks();
  const snapshot = await readDesktopRouteSnapshot({
    timeoutMs,
    allowStale: !failOnStale,
    maxAgeMs,
  });
  const snapshotPayload = snapshot?.payload && typeof snapshot.payload === "object" ? snapshot.payload : null;
  const snapshotAgeMs = cleanNumber(snapshotPayload?.snapshotAgeMs ?? snapshotPayload?.snapshot?.ageMs);
  const snapshotUpdatedAt = String(snapshotPayload?.snapshot?.updatedAt || snapshotPayload?.updatedAt || snapshot?.updatedAt || "");
  const maxAgeOk = Boolean(snapshotPayload && (!maxAgeMs || snapshotAgeMs <= maxAgeMs || snapshotPayload.snapshotFresh === true));

  const rows = [];
  if (snapshotPayload) {
    for (const task of tasks) {
      const [snapshotApi, liveApi] = await Promise.all([
        callApi(task, "snapshot", timeoutMs),
        callApi(task, "live", timeoutMs),
      ]);
      rows.push(alignRow(task, snapshotPayload, snapshotApi, liveApi, maxAgeOk));
    }
  }

  const issues = [];
  if (!snapshotPayload) issues.push("desktop_route_snapshot missing or stale");
  for (const row of rows) {
    if (!row.immediateDisplayReady) issues.push(`${row.strategy}: ${row.reason}`);
  }

  const payload = {
    ok: issues.length === 0,
    contract: "post_scan_immediate_display_snapshot_refresh",
    status: issues.length === 0 ? "ready" : "failed",
    checkedAt: new Date().toISOString(),
    routes: tasks.map((task) => task.key),
    snapshot: {
      exists: Boolean(snapshotPayload),
      updatedAt: snapshotUpdatedAt,
      ageMs: Number.isFinite(snapshotAgeMs) ? snapshotAgeMs : null,
      maxAgeMs,
      fresh: Boolean(snapshotPayload && maxAgeOk),
      endpointCount: Object.keys(snapshotPayload?.endpoints || {}).length,
      partial: Boolean(snapshotPayload?.partial),
      misses: Array.isArray(snapshotPayload?.misses) ? snapshotPayload.misses : [],
      previousFilled: Array.isArray(snapshotPayload?.previousFilled) ? snapshotPayload.previousFilled : [],
    },
    gates: {
      dataExists: rows.length === tasks.length && rows.every((row) => row.rowCountOk),
      healthViewCorrect: Boolean(snapshotPayload && maxAgeOk),
      terminalKeysVisible: rows.length === tasks.length && rows.every((row) => (row.snapshotHit || row.bundleHit) && row.runIdAligned && row.countAligned),
      immediateDisplayReady: issues.length === 0,
    },
    rows,
    issues,
  };

  writeJson(OUT_FILE, payload);
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exit(1);
}

main().catch((error) => {
  const payload = {
    ok: false,
    contract: "post_scan_immediate_display_snapshot_refresh",
    status: "failed",
    checkedAt: new Date().toISOString(),
    error: error?.message || String(error),
  };
  try { writeJson(OUT_FILE, payload); } catch {}
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
