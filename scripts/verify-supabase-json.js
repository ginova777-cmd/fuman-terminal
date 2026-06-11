const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");
const STRICT = process.env.FUMAN_SUPABASE_GUARD_OPTIONAL !== "1";

const PANEL_FILES = {
  market: ["market-summary.json", "stocks-index.json", "stocks-quotes-slim.json"],
  watchlist: ["stocks-index.json", "stocks-quotes-slim.json"],
  openBuy: ["open-buy-latest.json"],
  strategy2: ["strategy2-intraday-latest.json", "strategy2-intraday-top.json", "strategy2-intraday-live-top.json"],
  strategy3: ["strategy3-latest.json"],
  strategy4: ["strategy4-summary.json", "strategy4-score-top.json", "strategy4-zone-a.json", "strategy4-zone-b-page-1.json"],
  strategy5: ["strategy5-latest.json"],
  chipTrade: ["institution-latest.json", "institution-slim.json", "institution-mobile-top.json"],
  warrantFlow: ["warrant-flow-latest.json", "warrant-flow-slim.json", "warrant-priority-top.json", "warrant-flow-mobile-top.json"],
  cbDetect: ["cb-detect-latest.json"],
  realtimeRadar: ["realtime-radar-latest.json"],
};

function readText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function secret(name) {
  return readText(path.join(ROOT, "secrets", name)) || readText(path.join(RUNTIME_DIR, "secrets", name));
}

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || secret("supabase-url.txt")).replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || secret("supabase-service-role-key.txt")
  || secret("supabase-anon-key.txt");

function normalizeDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function count(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload?.matches)) return payload.matches.length;
  if (Array.isArray(payload?.events)) return payload.events.length;
  if (Array.isArray(payload?.records)) return payload.records.length;
  if (Array.isArray(payload?.rows)) return payload.rows.length;
  if (Array.isArray(payload?.data)) return payload.data.length;
  if (Array.isArray(payload?.stocks)) return payload.stocks.length;
  if (Array.isArray(payload?.quotes)) return payload.quotes.length;
  if (payload?.entries && typeof payload.entries === "object") return Object.keys(payload.entries).length;
  return Number(payload?.count || payload?.total || payload?.matchCount || 0);
}

function payloadDate(payload) {
  return normalizeDate(payload?.resolvedTradeDate || payload?.usedDate || payload?.tradeDate || payload?.dataDate || payload?.date || payload?.scanStamp || payload?.updatedAt);
}

function fail(issues, message) {
  issues.push(message);
}

function assert(condition, issues, message) {
  if (!condition) fail(issues, message);
}

function fetchSupabase(pathname) {
  return new Promise((resolve, reject) => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return reject(new Error("missing Supabase credentials"));
    const url = `${SUPABASE_URL}/rest/v1/${pathname}`;
    const req = https.get(url, {
      timeout: 20000,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`${pathname} HTTP ${res.statusCode} ${body.slice(0, 160)}`.trim()));
        }
        try { resolve(JSON.parse(body)); } catch (error) { reject(new Error(`${pathname} invalid JSON: ${error.message}`)); }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

function verifyJsonSurface(issues) {
  const manifest = readJson(path.join(DATA_DIR, "data-manifest.json"), {});
  const status = readJson(path.join(DATA_DIR, "data-status-index.json"), {});
  assert(manifest.ok === true, issues, "data-manifest ok=false or missing");
  assert(status.ok === true, issues, "data-status-index ok=false or missing");

  for (const [panel, files] of Object.entries(PANEL_FILES)) {
    let panelHasStatus = false;
    for (const file of files) {
      const payload = readJson(path.join(DATA_DIR, file));
      const manifestEntry = manifest.entries?.[file];
      const statusEntry = status.entries?.[file];
      assert(payload, issues, `${panel}: ${file} missing or invalid JSON`);
      assert(manifestEntry, issues, `${panel}: data-manifest missing ${file}`);
      if (statusEntry) panelHasStatus = true;
      if (!payload) continue;
      assert(payload.ok !== false, issues, `${panel}: ${file} ok=false`);
      if (manifestEntry) assert(Number(manifestEntry.count || 0) === count(payload), issues, `${panel}: ${file} manifest count mismatch manifest=${manifestEntry.count} actual=${count(payload)}`);
      if (statusEntry) {
        assert(statusEntry.ok !== false, issues, `${panel}: ${file} status ok=false`);
        const statusDate = normalizeDate(statusEntry.date || statusEntry.sourceDate);
        const jsonDate = payloadDate(payload);
        if (statusDate && jsonDate) assert(statusDate === jsonDate, issues, `${panel}: ${file} status/json date mismatch status=${statusDate} json=${jsonDate}`);
      }
    }
    assert(panelHasStatus, issues, `${panel}: data-status-index has no representative file`);
  }
}

async function verifySupabaseReadbacks(issues) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    const message = "Supabase credentials missing; cannot compare Supabase/JSON";
    if (STRICT) fail(issues, message);
    else console.warn(`[supabase-json] warning: ${message}`);
    return;
  }

  const strategy2 = readJson(path.join(DATA_DIR, "strategy2-intraday-latest.json"), {});
  try {
    const rows = await fetchSupabase("strategy2_latest?id=eq.latest&select=id,date,updated_at,entry_count,record_count,event_count");
    const row = Array.isArray(rows) ? rows[0] : null;
    assert(row, issues, "strategy2_latest missing latest row");
    if (row) {
      assert(normalizeDate(row.date) === normalizeDate(strategy2.date || strategy2.updatedAt), issues, `strategy2 Supabase/JSON date mismatch supabase=${row.date} json=${strategy2.date || strategy2.updatedAt}`);
      assert(Number(row.record_count || 0) === (Array.isArray(strategy2.records) ? strategy2.records.length : 0), issues, "strategy2 Supabase/JSON record_count mismatch");
      assert(Number(row.event_count || 0) === (Array.isArray(strategy2.events) ? strategy2.events.length : 0), issues, "strategy2 Supabase/JSON event_count mismatch");
    }
  } catch (error) {
    fail(issues, `strategy2 Supabase readback failed: ${error.message}`);
  }

  const openBuy = readJson(path.join(DATA_DIR, "open-buy-latest.json"), {});
  const openBuyTable = process.env.SUPABASE_OPEN_BUY_TABLE || "strategy1_open_buy_latest";
  try {
    const rows = await fetchSupabase(`${openBuyTable}?id=eq.latest&select=id,updated_at,match_count,scanned_count,total_count`);
    const row = Array.isArray(rows) ? rows[0] : null;
    assert(row, issues, `${openBuyTable} missing latest row`);
    if (row) {
      assert(Number(row.match_count || 0) === (Array.isArray(openBuy.matches) ? openBuy.matches.length : 0), issues, "open-buy Supabase/JSON match_count mismatch");
      assert(Number(row.scanned_count || 0) === (Array.isArray(openBuy.scannedCodes) ? openBuy.scannedCodes.length : 0), issues, "open-buy Supabase/JSON scanned_count mismatch");
      assert(Number(row.total_count || 0) === Number(openBuy.total || 0), issues, "open-buy Supabase/JSON total_count mismatch");
    }
  } catch (error) {
    fail(issues, `open-buy Supabase readback failed: ${error.message}`);
  }

  const realtime = readJson(path.join(DATA_DIR, "realtime-radar-latest.json"), {});
  const realtimeTable = process.env.FUMAN_REALTIME_RADAR_TABLE || "fuman_realtime_radar_cache";
  try {
    const rows = await fetchSupabase(`${realtimeTable}?id=eq.latest&select=id,updated_at,payload`);
    const row = Array.isArray(rows) ? rows[0] : null;
    assert(row, issues, `${realtimeTable} missing latest row`);
    if (row?.payload) {
      assert(normalizeDate(row.payload.date || row.updated_at) === normalizeDate(realtime.date || realtime.updatedAt), issues, `realtime Supabase/JSON date mismatch supabase=${row.payload.date || row.updated_at} json=${realtime.date || realtime.updatedAt}`);
      assert(count(row.payload) === count(realtime), issues, `realtime Supabase/JSON count mismatch supabase=${count(row.payload)} json=${count(realtime)}`);
    }
  } catch (error) {
    fail(issues, `realtime Supabase readback failed: ${error.message}`);
  }

  for (const [name, file] of [
    ["open-buy", path.join(STATE_DIR, "open-buy-supabase-status.json")],
    ["realtime-radar", path.join(STATE_DIR, "realtime-radar-supabase-status.json")],
    ["afterhours", path.join(DATA_DIR, "afterhours-supabase-status.json")],
  ]) {
    const status = readJson(file, null);
    assert(status, issues, `${name} Supabase status file missing: ${file}`);
    if (status && !status.pending) assert(status.ok === true, issues, `${name} Supabase status not ok: ${status.lastError || status.reason || status.error || "unknown"}`);
  }
}

async function main() {
  const issues = [];
  verifyJsonSurface(issues);
  await verifySupabaseReadbacks(issues);
  if (issues.length) {
    console.error("[supabase-json] failed");
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }
  console.log(`[supabase-json] ok panels=${Object.keys(PANEL_FILES).length}`);
}

main().catch((error) => {
  console.error(`[supabase-json] failed: ${error.message}`);
  process.exit(1);
});
