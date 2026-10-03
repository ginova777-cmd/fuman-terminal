const fs = require("fs");
const { normalizeResponse, publishMissing } = require("../lib/daytrade-rest-candle-repair.cjs");
const path = require("path");
const { expectedMinuteLabels, buildTimelineAudit, isSynthetic } = require("../lib/daytrade-intraday-1m-timeline");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const args = new Set(process.argv.slice(2));
const valueArg = (name, fallback = "") => {
  const item = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : fallback;
};
const APPLY = args.has("--apply");
const SYNTHESIZE = args.has("--synthesize");
const FINAL = args.has("--final");
const TRADE_DATE = valueArg("--trade-date", "");
const MAX_SYMBOLS = Math.max(1, Number(valueArg("--max-symbols", "2000")) || 2000);
const REQUESTED_SYMBOLS = new Set(valueArg("--symbols", "").split(",").filter((symbol) => /^\d{4}$/.test(symbol)));
const PAGE_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 45000;
const REST_DELAY_MS = Math.max(250, Number(valueArg("--delay-ms", process.env.FUGLE_INTRADAY_REPAIR_DELAY_MS || "1000")) || 1000);

function readSecret(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}
function secret(name) {
  return process.env[name] || readSecret(path.join(RUNTIME_DIR, "secrets", name === "FUGLE_API_KEY" ? "fugle-api-key.txt" : "supabase-service-role-key.txt"));
}
function taipeiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function taipeiMinuteNow() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === "hour")?.value || 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value || 0);
}
function normalizeSymbol(value) { return String(value || "").replace(/\D/g, "").slice(0, 4); }
function number(value) { const n = Number(String(value ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : null; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))); }
function headers(key) { return { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" }; }
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
async function supabaseGet(resource, query, key) {
  const rows = [];
  const queryWithoutPagination = query.split("&").filter((part) => !/^(limit|offset)=/.test(part)).join("&");
  for (let offset = 0; offset < 1000000; offset += PAGE_SIZE) {
    const page = await request(`${SUPABASE_URL}/rest/v1/${resource}?${queryWithoutPagination}&limit=${PAGE_SIZE}&offset=${offset}`, { headers: headers(key) });
    if (!Array.isArray(page) || !page.length) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}
async function supabaseUpsert(resource, rows, conflict, key) {
  if (!rows.length) return 0;
  let written = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    await request(`${SUPABASE_URL}/rest/v1/${resource}?on_conflict=${encodeURIComponent(conflict)}`, {
      method: "POST", headers: { ...headers(key), Prefer: "resolution=merge-duplicates,return=minimal", "Content-Type": "application/json" }, body: JSON.stringify(chunk),
    });
    written += chunk.length;
  }
  return written;
}
async function acquireLease(key, ownerId) {
  const result = await request(`${SUPABASE_URL}/rest/v1/rpc/acquire_fugle_daytrade_intraday_writer_lease`, {
    method: "POST", headers: { ...headers(key), "Content-Type": "application/json" }, body: JSON.stringify({ p_owner_id: ownerId, p_lease_seconds: 180 }),
  });
  if (!result?.ok) throw new Error(`writer lease unavailable: ${result?.reason || "unknown"}`);
}
async function releaseLease(key, ownerId) {
  try { await request(`${SUPABASE_URL}/rest/v1/rpc/release_fugle_daytrade_intraday_writer_lease`, { method: "POST", headers: { ...headers(key), "Content-Type": "application/json" }, body: JSON.stringify({ p_owner_id: ownerId }) }); } catch {}
}
async function fugleCandles(symbol, apiKey, tradeDate, runId) {
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/candles/${encodeURIComponent(symbol)}?timeframe=1`;
  const result = await request(url, { headers: { "X-API-KEY": apiKey, Accept: "application/json" } });
  const receivedAt = new Date().toISOString();
  const normalized = normalizeResponse(result, { symbol, tradeDate, receivedAt, runId });
  const evidenceDir = path.join(RUNTIME_DIR, "data", "mother-pool", "repair-evidence", tradeDate);
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, `${symbol}-${runId}.json`), JSON.stringify({ received_at: receivedAt, run_id: runId, response_sha256: normalized.response_sha256, raw: result, rejected: normalized.rejected }), { flag: "wx" });
  return normalized;
}
function candleTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}
function rowMinute(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  return `${parts.find((part) => part.type === "hour")?.value || "00"}:${parts.find((part) => part.type === "minute")?.value || "00"}`;
}
async function main() {
  if (SYNTHESIZE) throw new Error("SYNTHETIC_REPAIR_DISABLED");
  const tradeDate = TRADE_DATE || taipeiDate();
  const currentMinute = FINAL ? 13 * 60 + 30 : Math.min(13 * 60 + 30, taipeiMinuteNow() - 1);
  const expectedMinutes = expectedMinuteLabels({ endMinute: currentMinute });
  if (currentMinute < 9 * 60) throw new Error("session_not_started");
  const serviceKey = secret("SUPABASE_SERVICE_ROLE_KEY");
  const fugleKey = secret("FUGLE_API_KEY");
  if (!serviceKey) throw new Error("missing Supabase service role key");
  if (!fugleKey) throw new Error("missing Fugle API key");
  const ownerId = `${process.env.COMPUTERNAME || "writer-host"}:${process.pid}:gap-repair`;
  if (APPLY) await acquireLease(serviceKey, ownerId);
  let writtenReal = 0; let writtenSynthetic = 0; let repairedSymbols = 0; let failedSymbols = 0;
  let auditedSymbols = 0; const incompleteSymbols = [];
  try {
    const universe = (await supabaseGet("stock_universe", "select=symbol,market&is_active=eq.true&is_blacklisted=eq.false&is_daytrade_unsuitable=eq.false&limit=2000", serviceKey)).filter((row) => !REQUESTED_SYMBOLS.size || REQUESTED_SYMBOLS.has(String(row.symbol))).slice(0, MAX_SYMBOLS);
    for (const item of universe) {
      if (APPLY) await acquireLease(serviceKey, ownerId);
      const symbol = normalizeSymbol(item.symbol); if (!symbol) continue;
      const readback = async () => {
        const rows = await request(`${SUPABASE_URL}/rest/v1/fugle_daytrade_intraday_1m?select=*&trade_date=eq.${encodeURIComponent(tradeDate)}&symbol=eq.${encodeURIComponent(symbol)}&order=candle_time.asc&limit=301`, { headers: headers(serviceKey) });
        if (!Array.isArray(rows) || rows.length > 300 || rows.some(row => row.symbol !== symbol || row.trade_date !== tradeDate)) throw new Error("REPAIR_READBACK_SCOPE_INVALID");
        return rows;
      };
      let localRows = await readback();
      const auditBefore = buildTimelineAudit({ symbol, tradeDate, rows: localRows, expectedMinutes });
      auditedSymbols += 1;
      if (!auditBefore.missing_minutes.length) {
        if (APPLY) {
          await supabaseUpsert("fugle_daytrade_intraday_1m_timeline_audit", [{ ...auditBefore, checked_at: new Date().toISOString(), payload: { source: "gap-repair", synthesize: SYNTHESIZE, apply: true } }], "symbol,trade_date", serviceKey);
        } else {
          console.log(JSON.stringify(auditBefore));
        }
        continue;
      }
      repairedSymbols += 1;
      const have = new Set(expectedMinutes.filter(label => !auditBefore.missing_minutes.includes(label)));
      let fetched = [];
      const repairRunId = `rest-repair-${Date.now()}-${process.pid}`;
      const fetchedEvidence = await fugleCandles(symbol, fugleKey, tradeDate, repairRunId);
      fetched = fetchedEvidence.rows;
      if (fetchedEvidence.rejected.length) console.error(JSON.stringify({ symbol, run_id: repairRunId, rejected: fetchedEvidence.rejected }));
      await sleep(REST_DELAY_MS);
      const realRows = fetched.filter((row) => expectedMinutes.includes(rowMinute(row.candle_time)) && !have.has(rowMinute(row.candle_time)));
      let blocked = [];
      if (APPLY) {
        const result = await publishMissing({ existing: localRows, candidates: realRows, readback,
          insert: async rows => {
            const inserted = [];
            for (let offset = 0; offset < rows.length; offset += 50) {
              const chunk = rows.slice(offset, offset + 50);
              const result = await request(`${SUPABASE_URL}/rest/v1/fugle_daytrade_intraday_1m?on_conflict=symbol,candle_time`, {
                method: "POST", headers: { ...headers(serviceKey), Prefer: "resolution=ignore-duplicates,return=representation", "Content-Type": "application/json" }, body: JSON.stringify(chunk)
              });
              if (!Array.isArray(result)) throw new Error("INVALID_INSERT_ACK");
              inserted.push(...result);
            }
            return inserted;
          } });
        writtenReal += result.written;
        blocked = result.blocked;
        localRows = result.rows;
      }
      // Dry run audits persisted rows only; proposed repairs are not successful writes.
      const audit = buildTimelineAudit({ symbol, tradeDate, rows: localRows, expectedMinutes });
      if (!audit.replay_allowed) incompleteSymbols.push({ symbol, missing_minutes: audit.missing_minutes, blocked });
      if (APPLY) await supabaseUpsert("fugle_daytrade_intraday_1m_timeline_audit", [{ ...audit, checked_at: new Date().toISOString(), payload: { source: "gap-repair", synthesize: SYNTHESIZE, apply: true } }], "symbol,trade_date", serviceKey);
      else console.log(JSON.stringify(audit));
    }
    const ok = auditedSymbols > 0 && incompleteSymbols.length === 0;
    if (!ok) process.exitCode = 1;
    console.log(JSON.stringify({ ok, auditedSymbols, incompleteSymbols, apply: APPLY, tradeDate, expectedMinutes: expectedMinutes.length, repairedSymbols, failedSymbols, writtenReal, writtenSynthetic, synthesize: SYNTHESIZE, restDelayMs: REST_DELAY_MS, replayAllowedRequiresMissingMinutesEmpty: true }, null, 2));
  } finally { if (APPLY) await releaseLease(serviceKey, ownerId); }
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2)); process.exit(1); });
