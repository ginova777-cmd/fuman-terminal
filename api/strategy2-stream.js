const fs = require("fs");
const path = require("path");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || "https://cpmpfhbzutkiecccekfr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"));
const LATEST_RUN_VIEW = process.env.STRATEGY2_SUPABASE_LATEST_RUN_VIEW || "v_strategy2_latest_complete_run";
const STREAM_INTERVAL_MS = Math.max(1500, Number(process.env.STRATEGY2_SSE_POLL_MS || 4000));
const STREAM_MAX_MS = Math.max(8000, Number(process.env.STRATEGY2_SSE_MAX_MS || 25000));

function taipeiDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value).reduce((out, part) => {
    if (part.type !== "literal") out[part.type] = part.value;
    return out;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function fetchLatestRun() {
  const base = String(SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base || !SUPABASE_KEY) return null;
  const query = [
    "select=run_id,scan_date,finished_at,updated_at,status,complete,result_count,quality_status,schema_version,data_contract_source,payload",
    "strategy=eq.strategy2",
    "status=eq.complete",
    "complete=eq.true",
    `scan_date=eq.${taipeiDateKey()}`,
    "order=finished_at.desc",
    "limit=1",
  ].join("&");
  const response = await fetch(`${base}/rest/v1/${LATEST_RUN_VIEW}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`strategy2 stream read failed HTTP ${response.status}`);
  const rows = await response.json();
  const run = Array.isArray(rows) ? rows[0] : null;
  if (!run?.run_id) return null;
  const payload = run.payload || {};
  return {
    strategy: "strategy2",
    event: "complete-run",
    runId: String(run.run_id),
    date: run.scan_date || payload.date || taipeiDateKey(),
    updatedAt: payload.updatedAt || run.updated_at || run.finished_at || new Date().toISOString(),
    entryCount: Number(payload.entryCount || payload.aCount || 0),
    recordCount: Array.isArray(payload.records) ? payload.records.length : Number(run.result_count || 0),
    eventCount: Array.isArray(payload.events) ? payload.events.length : 0,
    qualityStatus: payload.qualityStatus || run.quality_status || "",
    schemaVersion: payload.schemaVersion || run.schema_version || "strategy2-run-id-complete-v1",
    dataContractSource: payload.dataContractSource || run.data_contract_source || "",
  };
}

function writeSse(response, event, payload) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write(`retry: ${STREAM_INTERVAL_MS}\n\n`);

  const startedAt = Date.now();
  let lastRunId = "";
  let closed = false;
  request.on?.("close", () => { closed = true; });

  async function tick(initial = false) {
    if (closed) return;
    try {
      const run = await fetchLatestRun();
      if (!run) {
        if (initial) writeSse(response, "strategy2-missing", { ok: false, error: "strategy2_complete_run_missing", date: taipeiDateKey(), cacheSource: "none" });
      } else if (run.runId !== lastRunId) {
        lastRunId = run.runId;
        writeSse(response, "strategy2-run", { ok: true, ...run });
      } else if (initial) {
        writeSse(response, "strategy2-heartbeat", { ok: true, runId: run.runId, date: run.date, at: new Date().toISOString() });
      }
    } catch (error) {
      writeSse(response, "strategy2-error", { ok: false, error: "strategy2_stream_error", detail: error?.message || String(error), date: taipeiDateKey() });
    }
  }

  await tick(true);
  const timer = setInterval(async () => {
    if (closed || Date.now() - startedAt > STREAM_MAX_MS) {
      clearInterval(timer);
      if (!closed) response.end();
      return;
    }
    response.write(`: keepalive ${Date.now()}\n\n`);
    await tick(false);
  }, STREAM_INTERVAL_MS);
};