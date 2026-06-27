const BASE_URL = (process.env.FUMAN_COLD_START_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.FUMAN_TERMINAL_WARM_TIMEOUT_MS || 20000);

const ENDPOINTS = [
  ["/api/terminal-fast-bundle?canvas=1&compact=1&shell=1", "fast-bundle"],
  ["/api/market?canvas=1&compact=1&shell=1&limit=24", "market"],
  ["/api/heatmap?snapshot=1&canvas=1&compact=1&shell=1&limit=60", "heatmap"],
  ["/api/market-ai-live?canvas=1&compact=1&shell=1&limit=20", "market-ai"],
  ["/api/realtime-radar-latest?canvas=1&compact=1&shell=1&limit=80", "realtime-radar"],
  ["/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=240&today=1&live=1", "strategy2-live"],
  ["/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=60", "strategy3"],
  ["/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70", "strategy4"],
  ["/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=70", "strategy5"],
  ["/api/institution-latest?canvas=1&compact=1&shell=1&limit=60", "institution"],
  ["/api/cb-detect-latest?canvas=1&compact=1&shell=1&limit=60", "cb"],
  ["/api/warrant-flow-latest?canvas=1&compact=1&shell=1&limit=60", "warrant"],
];

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
    return {
      label,
      ok: response.status >= 200 && response.status < 500 && payload?.ok !== false,
      status: response.status,
      ms: Date.now() - startedAt,
      rows: rowsOf(payload || {}),
      cacheSource: payload?.cacheSource || payload?.source || "",
      error: payload?.error || "",
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
  console.log(`[warm-terminal] ok endpoints=${results.length} slowest=${slowest}`);
})().catch((error) => {
  console.error(`[warm-terminal] failed ${error.stack || error.message || error}`);
  process.exit(1);
});
