const path = require("path");
const { publishStrategyCacheStatus } = require("../lib/strategy-cache-status");
const { captureHandler } = require("./strategy-api-capture");

const ROOT = path.resolve(__dirname, "..");

const STRATEGIES = [
  {
    key: "strategy1",
    label: "策略1-明日開盤入",
    load: () => captureHandler(require("../api/open-buy-latest")).then((result) => result.body),
    allowZero: false,
  },
  {
    key: "strategy2",
    label: "策略2-盤中即時",
    load: () => captureHandler(require("../api/strategy2-latest")).then((result) => result.body),
    allowZero: false,
  },
  {
    key: "strategy3",
    label: "策略3-隔日沖",
    load: () => captureHandler(require("../api/strategy3-latest")).then((result) => result.body),
    allowZero: false,
  },
  {
    key: "strategy4",
    label: "策略4-主力籌碼",
    load: () => captureHandler(require("../api/strategy4-latest")).then((result) => result.body),
    allowZero: false,
  },
  {
    key: "strategy5",
    label: "策略5-量價籌碼",
    load: () => captureHandler(require("../api/strategy5-latest")).then((result) => result.body),
    allowZero: false,
  },
];

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function rowsOf(payload = {}) {
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function normalizeDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function statusFor(strategy, payload) {
  const rows = rowsOf(payload);
  const matchCount = cleanNumber(payload.count ?? payload.matchCount ?? payload.entryCount ?? rows.length);
  const scanned = cleanNumber(payload.scanned ?? payload.scannedThisRun ?? payload.scannedCount ?? payload.total ?? rows.length);
  const total = cleanNumber(payload.total ?? payload.totalCount ?? scanned);
  const fallback = payload?.cacheSource === "static-fallback" || payload?.transport?.source === "static-json";
  const complete = payload.complete !== false && payload.ok !== false && !fallback;
  if (!complete) throw new Error(`${strategy.key} latest payload is not Supabase complete-run source`);
  if (!strategy.allowZero && matchCount <= 0) throw new Error(`${strategy.key} latest payload has zero matches`);
  return {
    used_date: normalizeDate(payload.usedDate || payload.date || payload.scanStamp || payload.generatedDate || payload.sourceDate || payload.updatedAt),
    updated_at: payload.updatedAt || payload.generatedAt || new Date().toISOString(),
    scan_status: "complete",
    scanned,
    total,
    match_count: matchCount,
    source: payload?.transport?.source === "supabase" ? "supabase-complete-run" : String(payload.source || payload.cacheSource || ""),
    log: `status refreshed from ${payload?.transport?.via || "local payload"} run=${payload.runId || payload?.transport?.runId || ""}`,
    error: "",
  };
}

(async () => {
  const issues = [];
  for (const strategy of STRATEGIES) {
    try {
      const payload = await strategy.load();
      const overrides = statusFor(strategy, payload || {});
      const result = await publishStrategyCacheStatus(strategy.key, strategy.label, payload, overrides);
      if (!result.ok) throw new Error(result.reason || result.error || `HTTP ${result.status || ""}`.trim());
      console.log(`[strategy-cache-status] ${strategy.key}: ok count=${overrides.match_count} date=${overrides.used_date}`);
    } catch (error) {
      const message = `${strategy.key}: ${error?.message || String(error)}`;
      issues.push(message);
      console.error(`[strategy-cache-status] ${message}`);
    }
  }
  if (issues.length) process.exit(1);
})();

