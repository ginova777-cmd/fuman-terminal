const fs = require("fs");
const path = require("path");

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || (() => {
    try { return fs.readFileSync(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"), "utf8").trim(); } catch { return ""; }
  })();

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function captureHandler(handler, query = {}) {
  let body = null;
  const req = { method: "GET", query, headers: {} };
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

async function rest(pathname, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) fail("missing Supabase service credentials");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 25000);
  try {
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    };
    if (options.count) headers.Prefer = "count=exact";
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, { headers, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) fail(`${pathname} HTTP ${response.status}`, { body: text.slice(0, 500) });
    const range = response.headers.get("content-range") || "";
    const exactCount = range.includes("/") ? Number(range.split("/").pop()) : null;
    return { rows: text ? JSON.parse(text) : [], exactCount };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const issues = [];
  const details = {};
  const strategy3Latest = require("../api/strategy3-latest");

  const api = await captureHandler(strategy3Latest, {
    limit: "20",
    canvas: "1",
    compact: "1",
    shell: "1",
    verify: "1",
  });
  details.api = {
    statusCode: api.statusCode,
    ok: api.body?.ok,
    runId: api.body?.runId,
    count: api.body?.count,
    tvPassCount: api.body?.tvPassCount,
    usedDate: api.body?.usedDate,
  };
  if (api.statusCode !== 200 || api.body?.ok !== true) issues.push("api_not_ok");
  if (cleanNumber(api.body?.count) !== 12) issues.push(`api_count_${api.body?.count}_not_12`);
  if (!Object.prototype.hasOwnProperty.call(api.body || {}, "tvPassCount")) issues.push("api_missing_tvPassCount");
  if (!api.body?.runId) issues.push("api_missing_runId");

  const health = await rest("v_scanner_resource_health?select=strategy,status,latest_date,row_count,reason&strategy=eq.Strategy3&limit=1");
  const healthRow = health.rows?.[0] || {};
  details.health = healthRow;
  if (healthRow.status !== "ready") issues.push(`health_not_ready_${healthRow.status || "missing"}`);

  const runs = await rest("strategy3_scan_runs?select=run_id,result_count,payload,updated_at&strategy=eq.strategy3&status=eq.complete&order=updated_at.desc&limit=1");
  const run = runs.rows?.[0] || {};
  const payload = run.payload || {};
  details.run = {
    runId: run.run_id,
    resultCount: run.result_count,
    selfTest: payload.selfTest,
    sourceDriftHealth: payload.sourceDriftHealth,
    publishedSelfTest: payload.publishedSelfTest,
  };
  if (!run.run_id) issues.push("latest_run_missing");
  if (cleanNumber(run.result_count) !== 12) issues.push(`run_result_count_${run.result_count}_not_12`);
  if (payload.selfTest?.ok !== true) issues.push("run_selfTest_not_ok");
  if (cleanNumber(payload.selfTest?.fieldGateReadyCount) !== 12) issues.push("fieldGateReadyCount_not_12");
  if (payload.sourceDriftHealth?.status !== "ready") issues.push("sourceDrift_not_ready");
  if (payload.publishedSelfTest?.ok !== true) issues.push("publishedSelfTest_not_ok");

  const rows = await rest(`strategy3_scan_results?select=code,name,payload&run_id=eq.${encodeURIComponent(run.run_id || "")}&strategy=eq.strategy3&order=rank.asc&limit=80`, { count: true });
  const resultRows = rows.rows || [];
  const tvBreakdownRows = resultRows.filter((row) => row?.payload?.tvBreakdown).length;
  const tvPassRows = resultRows.filter((row) => row?.payload?.tvOk === true || row?.payload?.tvFlame === true || row?.payload?.tvOvernightEntry?.ok === true).length;
  details.results = {
    exactCount: rows.exactCount,
    visibleRows: resultRows.length,
    tvBreakdownRows,
    tvPassRows,
    names: resultRows.slice(0, 12).map((row) => row.name),
  };
  if (resultRows.length !== 12) issues.push(`result_rows_${resultRows.length}_not_12`);
  if (tvBreakdownRows !== 12) issues.push(`tvBreakdownRows_${tvBreakdownRows}_not_12`);
  if (!resultRows.every((row) => row?.payload?.tvBreakdown && typeof row.payload.tvBreakdown.controlOk === "boolean" && typeof row.payload.tvBreakdown.obvOk === "boolean")) {
    issues.push("tv_breakdown_boolean_fields_missing");
  }

  const sourceCounts = await Promise.all([
    rest("v_strategy3_quote_ready?select=symbol&limit=1", { count: true }).then((r) => ["v_strategy3_quote_ready", r.exactCount]),
    rest("strategy3_ready_snapshot?select=symbol&limit=1", { count: true }).then((r) => ["strategy3_ready_snapshot", r.exactCount]),
    rest("fugle_quotes_latest?select=symbol&limit=1", { count: true }).then((r) => ["fugle_quotes_latest", r.exactCount]),
    rest("stock_daily_volume?select=trade_date&order=trade_date.desc&limit=1", { count: true }).then((r) => ["stock_daily_volume", r.exactCount, r.rows?.[0]?.trade_date]),
  ]);
  details.sourceCounts = Object.fromEntries(sourceCounts.map(([name, count, latestDate]) => [name, { count, latestDate }]));
  for (const [name, count] of sourceCounts) {
    if (cleanNumber(count) < 1000) issues.push(`${name}_count_${count}_below_1000`);
  }

  const output = { ok: issues.length === 0, checkedAt: new Date().toISOString(), issues, details };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error?.message || String(error), details: error?.details || {} }, null, 2)}\n`);
  process.exit(1);
});
