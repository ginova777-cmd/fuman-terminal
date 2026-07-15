const BASE_URL = (process.env.FUMAN_COLD_START_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.FUMAN_TERMINAL_WARM_TIMEOUT_MS || 20000);
const args = process.argv.slice(2);
const readArg = (name) => {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] || "" : "";
};
const PROFILE = readArg("profile") || process.env.FUMAN_TERMINAL_WARM_PROFILE || "core";

const CORE_ENDPOINTS = [
  ["/api/terminal-fast-bundle?canvas=1&compact=1&shell=1", "fast-bundle"],
  ["/api/market?canvas=1&compact=1&shell=1&limit=24", "market"],
  ["/api/market-ai-live?canvas=1&compact=1&shell=1&limit=20", "market-ai"],
  ["/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=240&snapshot=1&today=1", "strategy2-snapshot"],
];

const FULL_ENDPOINTS = [
  ...CORE_ENDPOINTS,
  ["/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=240&live=1&today=1", "strategy2-live"],
  ["/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=60", "strategy3"],
  ["/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70", "strategy4"],
  ["/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=140", "strategy5"],
  ["/api/institution-latest?canvas=1&compact=1&shell=1&limit=60", "institution"],
  ["/api/cb-detect-latest?canvas=1&compact=1&shell=1&limit=60", "cb"],
  ["/api/warrant-flow-latest?canvas=1&compact=1&shell=1&limit=60", "warrant"],
];

const ENDPOINTS = PROFILE === "full" ? FULL_ENDPOINTS : CORE_ENDPOINTS;

function rowsOf(payload = {}) {
  if (Array.isArray(payload.matches)) return payload.matches.length;
  if (Array.isArray(payload.rows)) return payload.rows.length;
  if (Array.isArray(payload.records)) return payload.records.length;
  if (Array.isArray(payload.events)) return payload.events.length;
  if (payload.endpoints && typeof payload.endpoints === "object") return Object.keys(payload.endpoints).length;
  return Number(payload.count || payload.total || 0) || 0;
}

async function warm(pathname, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const url = `${BASE_URL}${pathname}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch {}
    const authLocked = payload?.error === "membership_required";
    const failClosedDisplay = payload?.evidenceStatus === "source_quality_fail"
      && payload?.publishAllowed === false
      && (payload?.unattendedStatus === "NO" || payload?.ok === false);
    return {
      label,
      ok: response.status >= 200 && response.status < 500 && (payload?.ok !== false || authLocked || failClosedDisplay),
      status: response.status,
      ms: Date.now() - startedAt,
      rows: rowsOf(payload || {}),
      cacheSource: payload?.cacheSource || payload?.source || (authLocked ? "membership-gate" : failClosedDisplay ? "fail-closed-display" : ""),
      authLocked,
      failClosedDisplay,
      error: authLocked || failClosedDisplay ? "" : payload?.error || "",
    };
  } catch (error) {
    return {
      label,
      ok: false,
      status: 0,
      ms: Date.now() - startedAt,
      rows: 0,
      cacheSource: "",
      error: error?.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  const results = await Promise.all(ENDPOINTS.map(([pathname, label]) => warm(pathname, label)));
  const failures = results.filter((row) => !row.ok);
  for (const row of results) {
    console.log(`[warm-terminal] ${row.ok ? "ok" : "fail"} ${row.label} ${row.ms}ms rows=${row.rows} source=${row.cacheSource || "--"}${row.error ? ` error=${row.error}` : ""}`);
  }
  if (failures.length) {
    console.error(`[warm-terminal] failed ${failures.length}/${results.length}`);
    process.exit(1);
  }
  const slowest = results.slice().sort((a, b) => b.ms - a.ms).slice(0, 4)
    .map((row) => `${row.label}:${row.ms}ms`).join(" ");
  console.log(`[warm-terminal] ok profile=${PROFILE} endpoints=${results.length} slowest=${slowest}`);
})().catch((error) => {
  console.error(`[warm-terminal] failed ${error.stack || error.message || error}`);
  process.exit(1);
});

