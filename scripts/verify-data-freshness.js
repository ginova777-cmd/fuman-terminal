const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const LIVE = process.argv.includes("--live") || process.env.FUMAN_DATA_FRESHNESS_LIVE === "1";
const WRITE_REPORT = process.argv.includes("--write") || process.env.FUMAN_WRITE_FRESHNESS_REPORT === "1";
const CHECK_LEGACY_TERMINAL_GATE = process.env.FUMAN_CHECK_LEGACY_TERMINAL_GATE_ARTIFACT === "1";
const SKIP_TERMINAL_GATE = process.env.FUMAN_SKIP_TERMINAL_GATE_ARTIFACT !== "0";
const VERIFY_STATIC_DATA_FRESHNESS = process.env.FUMAN_VERIFY_STATIC_DATA_FRESHNESS === "1";
const LOCAL_DATA_DIR = process.env.FUMAN_VERIFY_DATA_DIR || path.join(ROOT, "data");

const TARGETS = [
  { name: "data-manifest", file: "data/data-manifest.json", minCount: 25 },
  { name: "terminal-home-bundle", file: "data/terminal-home-bundle.json", api: "api/terminal-home" },
  { name: "market-summary", file: "data/market-summary.json" },
  { name: "health-summary", file: "data/health-summary.json" },
  { name: "stocks-index", file: "data/stocks-index.json", minCount: 1000 },
  { name: "open-buy-latest", file: "data/open-buy-latest.json", api: "api/open-buy-latest", minCount: 1 },
  { name: "strategy3-latest", file: "data/strategy3-latest.json", api: "api/strategy3-latest", minCount: 1 },
  { name: "strategy4-latest", file: "data/strategy4-latest.json", api: "api/strategy4-latest", minCount: 1 },
  { name: "strategy4-summary", file: "data/strategy4-summary.json", api: "api/strategy4-latest", derive: "strategy4-summary", minCount: 1 },
  { name: "strategy4-slim", file: "data/strategy4-slim.json", api: "api/strategy4-latest", derive: "strategy4-slim", minCount: 1 },
  { name: "strategy4-score-top", file: "data/strategy4-score-top.json", api: "api/strategy4-latest", derive: "strategy4-score-top", minCount: 1 },
  { name: "strategy4-zone-a", file: "data/strategy4-zone-a.json", api: "api/strategy4-latest", derive: "strategy4-zone-a" },
  { name: "strategy4-zone-b", file: "data/strategy4-zone-b.json", api: "api/strategy4-latest", derive: "strategy4-zone-b" },
  { name: "strategy4-zone-c", file: "data/strategy4-zone-c.json", api: "api/strategy4-latest", derive: "strategy4-zone-c" },
  { name: "strategy5-latest", file: "data/strategy5-latest.json", api: "api/strategy5-latest", minCount: 1 },
  { name: "strategy-match-index", file: "data/strategy-match-index.json", minCount: 1 },
  { name: "warrant-flow-latest", file: "data/warrant-flow-latest.json", api: "api/warrant-flow-latest" },
  { name: "stocks-quotes-slim", file: "data/stocks-quotes-slim.json", minCount: 1000 },
  { name: "institution-latest", file: "data/institution-latest.json", api: "api/institution-latest", minCount: Number(process.env.INSTITUTION_MIN_OUTPUT_ROWS || 250) },
  { name: "institution-slim", file: "data/institution-slim.json", api: "api/institution-latest", derive: "institution-slim", minCount: Number(process.env.INSTITUTION_MIN_OUTPUT_ROWS || 250) },
  { name: "institution-mobile-top", file: "data/institution-mobile-top.json", api: "api/institution-latest", derive: "institution-mobile-top", minCount: 1 },
  { name: "institution-tdcc-breakout-top", file: "data/institution-tdcc-breakout-top.json", api: "api/institution-tdcc-breakout-latest", minCount: Number(process.env.INSTITUTION_TDCC_MIN_OUTPUT_ROWS || 0) },
  { name: "cb-detect-latest", file: "data/cb-detect-latest.json", api: "api/cb-detect-latest", minCount: 1 },
  { name: "warrant-flow-slim", file: "data/warrant-flow-slim.json", api: "api/warrant-flow-latest", derive: "warrant-flow-slim", minCount: 1 },
  { name: "warrant-priority-top", file: "data/warrant-priority-top.json", api: "api/warrant-flow-latest", derive: "warrant-priority-top", minCount: 1 },
  { name: "warrant-flow-mobile-top", file: "data/warrant-flow-mobile-top.json", api: "api/warrant-flow-latest", derive: "warrant-flow-mobile-top", minCount: 1 },
];

const LIVE_API_TARGETS = [
  { name: "data-manifest", endpoint: "api/mobile-boot" },
  { name: "terminal-home-bundle", endpoint: "api/terminal-home" },
  { name: "market-summary", endpoint: "api/market-ai-live" },
  { name: "health-summary", endpoint: "api/mobile-boot" },
  { name: "stocks-index", endpoint: "api/heatmap", minCount: 500 },
  { name: "open-buy-latest", endpoint: "api/open-buy-latest", minCount: 1, requireRunId: true, notBeforeTaipeiMinute: 8 * 60 + 45 },
  { name: "strategy3-latest", endpoint: "api/strategy3-latest", minCount: 1, requireRunId: true, notBeforeTaipeiMinute: 13 * 60 },
  { name: "strategy4-latest", endpoint: "api/strategy4-latest", minCount: 1, requireRunId: true },
  { name: "strategy4-summary", endpoint: "api/strategy4-latest?top=1&compact=1&limit=20", minCount: 1, requireRunId: true },
  { name: "strategy4-slim", endpoint: "api/strategy4-latest?top=1&compact=1&limit=80", minCount: 1, requireRunId: true },
  { name: "strategy4-score-top", endpoint: "api/strategy4-latest?top=1&compact=1&limit=120", minCount: 1, requireRunId: true },
  { name: "strategy4-zone-a", endpoint: "api/strategy4-latest", minCount: 1, requireRunId: true },
  { name: "strategy4-zone-b", endpoint: "api/strategy4-latest", minCount: 1, requireRunId: true },
  { name: "strategy4-zone-c", endpoint: "api/strategy4-latest", minCount: 1, requireRunId: true },
  { name: "strategy5-latest", endpoint: "api/strategy5-latest?top=1&compact=1&limit=50", minCount: 1, requireRunId: true },
  { name: "strategy-match-index", endpoint: "api/watchlist-match-index", minCount: 1, requireRunId: true },
  { name: "warrant-flow-latest", endpoint: "api/warrant-flow-latest?top=1&compact=1&limit=30", minCount: 1, requireRunId: true, requireWarrantContract: true },
  { name: "stocks-quotes-slim", endpoint: "api/heatmap", minCount: 500 },
  { name: "institution-latest", endpoint: "api/institution-latest", minCount: Number(process.env.INSTITUTION_MIN_OUTPUT_ROWS || 250), requireRunId: true },
  { name: "institution-slim", endpoint: "api/institution-latest?top=1&compact=1&limit=100", minCount: 1, requireRunId: true },
  { name: "institution-mobile-top", endpoint: "api/institution-latest?top=1&compact=1&limit=50", minCount: 1, requireRunId: true },
  { name: "institution-tdcc-breakout-top", endpoint: "api/institution-tdcc-breakout-latest", minCount: Number(process.env.INSTITUTION_TDCC_MIN_OUTPUT_ROWS || 1) },
  { name: "cb-detect-latest", endpoint: "api/cb-detect-latest", minCount: 1, requireRunId: true },
  { name: "warrant-flow-slim", endpoint: "api/warrant-flow-latest?top=1&compact=1&limit=80", minCount: 1, requireRunId: true, requireWarrantContract: true },
  { name: "warrant-priority-top", endpoint: "api/warrant-flow-latest?top=1&compact=1&limit=120", minCount: 1, requireRunId: true, requireWarrantContract: true },
  { name: "warrant-flow-mobile-top", endpoint: "api/warrant-flow-latest?top=1&compact=1&limit=50", minCount: 1, requireRunId: true, requireWarrantContract: true },
];

function fetchText(pathname, timeoutMs = 20000) {
  const cleanPath = String(pathname || "").replace(/^\/+/, "");
  const separator = cleanPath.includes("?") ? "&" : "?";
  const url = `${BASE_URL}/${cleanPath}${separator}v=freshness-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

function readLocal(file) {
  const normalized = String(file || "").replace(/\\/g, "/");
  const dataPrefix = "data/";
  if (normalized.startsWith(dataPrefix)) {
    const dataFile = normalized.slice(dataPrefix.length);
    const localPath = path.join(LOCAL_DATA_DIR, dataFile);
    if (dataFile === "cb-detect-latest.json" && !fs.existsSync(localPath)) {
      const statusPath = path.join(LOCAL_DATA_DIR, "cb-detect-supabase-status.json");
      const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
      return JSON.stringify({
        ok: status.ok === true,
        source: status.source || "cb-detect-supabase",
        status: "api-only-supabase-snapshot",
        cacheSource: "supabase-snapshot",
        runId: status.runId || "",
        usedDate: status.usedDate || status.tradeDate || "",
        sourceDate: status.usedDate || status.tradeDate || "",
        updatedAt: status.lastSuccessAt || status.updatedAt || "",
        count: Number(status.count || status.matchCount || 0),
        rows: Array.from({ length: Number(status.count || status.matchCount || 0) }, () => ({})),
        sourceCounts: status.sourceCounts || {},
        excludedCounts: status.excludedCounts || {},
        quoteSources: status.quoteSources || {},
        transport: {
          source: "supabase-snapshot",
          snapshotKey: status.snapshotKey || "cb_detect_latest",
          runId: status.runId || "",
          gate: "latest-snapshot",
          readbackVerified: status.readbackVerified === true,
        },
      });
    }
    return fs.readFileSync(localPath, "utf8");
  }
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function normalizeDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function extractDate(payload) {
  return normalizeDate(payload.scanStamp || payload.dataDate || payload.usedDate || payload.date || payload.updatedAt || payload.generatedAt || payload.asOf);
}

function extractCount(payload) {
  if (!payload) return 0;
  if (Number.isFinite(Number(payload.count))) return Number(payload.count);
  if (Number.isFinite(Number(payload.total))) return Number(payload.total);
  if (Number.isFinite(Number(payload.stockCount))) return Number(payload.stockCount);
  if (Array.isArray(payload.items)) return payload.items.length;
  if (Array.isArray(payload.matches)) return payload.matches.length;
  if (Array.isArray(payload.rows)) return payload.rows.length;
  if (Array.isArray(payload.data)) return payload.data.length;
  if (Array.isArray(payload.stocks)) return payload.stocks.length;
  if (Array.isArray(payload.quotes)) return payload.quotes.length;
  if (payload.entries && typeof payload.entries === "object") return Object.keys(payload.entries).length;
  return 0;
}

function extractVolumeCount(payload) {
  if (!payload) return 0;
  if (Number.isFinite(Number(payload.volumeCount))) return Number(payload.volumeCount);
  if (Array.isArray(payload.volumeMatches)) return payload.volumeMatches.length;
  return 0;
}

function extractRunId(payload) {
  return String(
    payload?.runId ||
    payload?.run_id ||
    payload?.snapshotId ||
    payload?.snapshot_id ||
    payload?.bootHash ||
    payload?.boot_hash ||
    payload?.transport?.runId ||
    payload?.transport?.run_id ||
    ""
  ).trim();
}

function extractRowsForLiveApi(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.stocks)) return payload.stocks;
  if (Array.isArray(payload.quotes)) return payload.quotes;
  return [];
}

function validateWarrantContract(payload, name, issues) {
  const contract = payload?.dataContract || {};
  assertFresh(contract.ok === true, `${name}: warrant dataContract ok=false`, issues);
  assertFresh(String(payload?.schemaVersion || "").includes("warrant-flow-run-id-complete-v1"), `${name}: schemaVersion not run-id complete v1`, issues);
  const volumeRows = Array.isArray(payload?.volumeMatches) ? payload.volumeMatches : [];
  assertFresh(volumeRows.length > 0, `${name}: volumeMatches empty`, issues);
  for (const row of volumeRows.slice(0, 10)) {
    assertFresh(Boolean(String(row?.warrantCode || "").trim()), `${name}: volumeMatches row missing warrantCode`, issues);
    assertFresh(Boolean(String(row?.warrantName || "").trim()), `${name}: volumeMatches row missing warrantName`, issues);
    assertFresh(/^\d{4}$/.test(String(row?.underlyingCode || "").trim()), `${name}: volumeMatches row missing 4-digit underlyingCode`, issues);
    assertFresh(Number.isFinite(Number(row?.thirtyMinuteVolume)), `${name}: volumeMatches row missing thirtyMinuteVolume`, issues);
    assertFresh(Number.isFinite(Number(row?.floatingUnits)), `${name}: volumeMatches row missing floatingUnits`, issues);
    assertFresh(Number.isFinite(Number(row?.volumeMultiple)), `${name}: volumeMatches row missing volumeMultiple`, issues);
  }
}

function rows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.stocks)) return payload.stocks;
  if (Array.isArray(payload.quotes)) return payload.quotes;
  return [];
}

async function fetchJsonFile(pathname) {
  const result = await fetchText(pathname);
  if (result.status < 200 || result.status >= 300) throw new Error(`${pathname} HTTP ${result.status}`);
  return JSON.parse(result.body);
}

function taipeiMinuteOfDay(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function isLiveApiTargetNotYetDue(target) {
  return Number.isFinite(Number(target?.notBeforeTaipeiMinute)) && taipeiMinuteOfDay() < Number(target.notBeforeTaipeiMinute);
}

function cloneWithRows(payload, rowsValue, extra = {}) {
  const rowsArray = Array.isArray(rowsValue) ? rowsValue : [];
  return {
    ...payload,
    ...extra,
    count: rowsArray.length,
    rows: rowsArray,
    matches: rowsArray,
  };
}

function deriveApiPayload(payload, derive) {
  if (!derive) return payload;
  const sourceRows = rows(payload);
  if (derive === "strategy4-summary" || derive === "strategy4-slim") {
    return cloneWithRows(payload, sourceRows);
  }
  if (derive === "strategy4-score-top") {
    return cloneWithRows(payload, sourceRows.slice(0, Math.min(120, sourceRows.length)));
  }
  if (/^strategy4-zone-/.test(derive)) {
    const zone = derive.replace("strategy4-zone-", "").toUpperCase();
    const filtered = sourceRows.filter((row, index) => {
      const rowZone = String(row.zone || row.zoneKey || row.bucket || "").replace(/[^a-z]/gi, "").toUpperCase();
      if (rowZone) return rowZone === zone;
      if (zone === "A") return index < sourceRows.length;
      return false;
    });
    return cloneWithRows(payload, filtered);
  }
  if (derive === "institution-slim") {
    return cloneWithRows(payload, sourceRows.length ? sourceRows : Object.values(payload?.data || {}));
  }
  if (derive === "institution-mobile-top") {
    return cloneWithRows(payload, (sourceRows.length ? sourceRows : Object.values(payload?.data || {})).slice(0, 50));
  }
  if (derive === "warrant-flow-slim" || derive === "warrant-priority-top") {
    return cloneWithRows(payload, sourceRows);
  }
  if (derive === "warrant-flow-mobile-top") {
    return cloneWithRows(payload, sourceRows.slice(0, Math.min(50, sourceRows.length)));
  }
  return payload;
}

function rowClose(row) {
  return Number(row?.displayClose ?? row?.underlyingClose ?? row?.close ?? 0);
}

function rowPercent(row) {
  return Number(row?.displayPercent ?? row?.underlyingPercent ?? row?.percent ?? row?.changePercent ?? 0);
}

function quoteClose(row) {
  return Number(row?.close ?? row?.z ?? row?.price ?? row?.lastPrice ?? 0);
}

function assertFresh(condition, message, issues) {
  if (!condition) issues.push(message);
}

function sameNumber(actual, expected, tolerance = 0.01) {
  const a = Number(actual);
  const e = Number(expected);
  return Number.isFinite(a) && Number.isFinite(e) && Math.abs(a - e) <= tolerance;
}

function isApiAuthoritative(payload) {
  const source = String(payload?.cacheSource || payload?.transport?.source || payload?.source || "");
  return /supabase|api-only/i.test(source);
}

function validateCrossPayloads(payloads, issues) {
  const manifest = payloads["data-manifest"];
  const home = payloads["terminal-home-bundle"];
  const quotes = payloads["stocks-quotes-slim"];
  const strategy5 = payloads["strategy5-latest"];
  const strategy4 = payloads["strategy4-latest"];
  const strategy4Summary = payloads["strategy4-summary"];
  const strategy4Slim = payloads["strategy4-slim"];
  const strategy4ScoreTop = payloads["strategy4-score-top"];
  const strategy4ZoneA = payloads["strategy4-zone-a"];
  const strategy4ZoneB = payloads["strategy4-zone-b"];
  const strategy4ZoneC = payloads["strategy4-zone-c"];
  const openBuy = payloads["open-buy-latest"];
  const strategyMatchIndex = payloads["strategy-match-index"];
  const institutionLatest = payloads["institution-latest"];
  const institutionSlim = payloads["institution-slim"];
  const institutionMobile = payloads["institution-mobile-top"];
  const institutionTdcc = payloads["institution-tdcc-breakout-top"];
  const cb = payloads["cb-detect-latest"];
  const warrantLatest = payloads["warrant-flow-latest"];
  const warrantSlim = payloads["warrant-flow-slim"];
  const warrantPriority = payloads["warrant-priority-top"];
  const warrantMobile = payloads["warrant-flow-mobile-top"];
  const quoteDate = normalizeDate(quotes?.resolvedTradeDate || quotes?.today || quotes?.date);
  for (const [name, payload] of [
    ["institution-latest.json", institutionLatest],
    ["institution-slim.json", institutionSlim],
    ["institution-mobile-top.json", institutionMobile],
    ["institution-tdcc-breakout-top.json", institutionTdcc],
    ["cb-detect-latest.json", cb],
    ["warrant-flow-slim.json", warrantSlim],
    ["warrant-priority-top.json", warrantPriority],
    ["warrant-flow-mobile-top.json", warrantMobile],
    ["open-buy-latest.json", openBuy],
    ["strategy4-latest.json", strategy4],
    ["strategy4-summary.json", strategy4Summary],
    ["strategy4-slim.json", strategy4Slim],
    ["strategy4-score-top.json", strategy4ScoreTop],
    ["strategy5-latest.json", strategy5],
    ["strategy-match-index.json", strategyMatchIndex],
    ["stocks-quotes-slim.json", quotes],
    ["terminal-home-bundle.json", home],
  ]) {
    const entry = manifest?.entries?.[name];
    if (!entry && !isApiAuthoritative(payload)) assertFresh(entry, `data-manifest missing ${name}`, issues);
    if (entry && !isApiAuthoritative(payload)) assertFresh(Number(entry.count || 0) === extractCount(payload), `data-manifest ${name} count mismatch entry=${entry.count} actual=${extractCount(payload)}`, issues);
  }
  const institutionLatestDate = normalizeDate(institutionLatest?.usedDate || institutionLatest?.date);
  const institutionSlimDate = normalizeDate(institutionSlim?.usedDate || institutionSlim?.date);
  assertFresh(!quoteDate || !institutionLatestDate || institutionLatestDate <= quoteDate, `institution-latest date mismatch quoteDate=${quoteDate}`, issues);
  assertFresh(!quoteDate || !institutionSlimDate || institutionSlimDate <= quoteDate, `institution-slim date mismatch quoteDate=${quoteDate}`, issues);
  assertFresh(extractCount(institutionMobile) <= extractCount(institutionSlim), "institution-mobile-top larger than institution-slim", issues);
  assertFresh(extractCount(institutionTdcc) <= extractCount(institutionSlim), "institution-tdcc-breakout-top larger than institution-slim", issues);
  assertFresh(extractCount(cb) > 0, "cb-detect-latest empty", issues);
  const openBuyDate = normalizeDate(openBuy?.usedDate || openBuy?.date || openBuy?.sourceDate);
  assertFresh(openBuy?.ok === true, "open-buy-latest ok=false", issues);
  assertFresh(extractCount(openBuy) > 0, "open-buy-latest empty", issues);
  assertFresh(!quoteDate || openBuyDate === quoteDate, `open-buy sourceDate mismatch quoteDate=${quoteDate} sourceDate=${openBuyDate}`, issues);

  const strategy4Date = normalizeDate(strategy4?.scanStamp || strategy4?.sourceDate || strategy4?.updatedAt);
  const strategy4Count = extractCount(strategy4);
  const strategy4SlimCount = extractCount(strategy4Slim);
  const strategy4ZoneTotal = extractCount(strategy4ZoneA) + extractCount(strategy4ZoneB) + extractCount(strategy4ZoneC);
  const strategy4Home = home?.strategy4 || home?.strategies?.strategy4 || home?.desktop?.strategy4 || home?.mobile?.strategy4;
  assertFresh(strategy4?.ok === true, "strategy4-latest ok=false", issues);
  assertFresh(strategy4?.complete === true, "strategy4-latest complete=false; full daily scan did not publish", issues);
  assertFresh(!/partial/i.test(String(strategy4?.source || "")), `strategy4-latest source is partial source=${strategy4?.source}`, issues);
  assertFresh(Number(strategy4?.total || 0) >= 1500, `strategy4 total too small total=${strategy4?.total}`, issues);
  assertFresh(strategy4Count === rows(strategy4).length, `strategy4 count mismatch count=${strategy4?.count} rows=${rows(strategy4).length}`, issues);
  assertFresh(!quoteDate || strategy4Date === quoteDate, `strategy4 scanStamp mismatch quoteDate=${quoteDate} scanDate=${strategy4Date}`, issues);
  assertFresh(extractCount(strategy4Summary) === strategy4Count, `strategy4-summary count mismatch latest=${strategy4Count} summary=${extractCount(strategy4Summary)}`, issues);
  assertFresh(strategy4SlimCount === strategy4Count, `strategy4-slim count mismatch latest=${strategy4Count} slim=${strategy4SlimCount}`, issues);
  assertFresh(strategy4ZoneTotal === strategy4SlimCount, `strategy4 zone total mismatch zones=${strategy4ZoneTotal} slim=${strategy4SlimCount}`, issues);
  assertFresh(extractCount(strategy4ScoreTop) === Math.min(120, strategy4SlimCount), `strategy4-score-top count mismatch top=${extractCount(strategy4ScoreTop)} slim=${strategy4SlimCount}`, issues);
  assertFresh(Number(strategy4Home?.count || 0) === extractCount(strategy4ScoreTop), `terminal-home-bundle strategy4 count mismatch home=${strategy4Home?.count} top=${extractCount(strategy4ScoreTop)}`, issues);

  const latestFirst = rows(warrantLatest)[0];
  const slimFirst = rows(warrantSlim)[0];
  const priorityFirst = rows(warrantPriority)[0];
  const mobileFirst = rows(warrantMobile)[0];
  const homeFirst = home?.mobile?.warrant?.top?.[0];
  const quoteMap = new Map(rows(quotes).map((row) => [String(row.code || row.symbol || "").trim(), row]));
  assertFresh(latestFirst && slimFirst, "missing warrant first rows across latest/slim", issues);
  if (latestFirst && slimFirst) {
    for (const [label, row] of [["slim", slimFirst]]) {
      assertFresh(String(row.code || "") === String(latestFirst.code || ""), `warrant ${label} first code mismatch`, issues);
      const quote = quoteMap.get(String(row.code || row.underlyingCode || "").trim());
      assertFresh(quote, `missing stock quote for warrant ${label} first code=${row.code || row.underlyingCode || ""}`, issues);
      if (quote) {
        assertFresh(sameNumber(rowClose(row), quoteClose(quote)), `warrant ${label} first close mismatch quote`, issues);
        if (Number.isFinite(Number(quote.percent))) assertFresh(sameNumber(rowPercent(row), quote.percent, 0.05), `warrant ${label} first percent mismatch quote`, issues);
      }
      assertFresh(sameNumber(row.finalScore, latestFirst.finalScore, 0), `warrant ${label} first finalScore mismatch`, issues);
      assertFresh(normalizeDate(row.quoteDate) === quoteDate, `warrant ${label} first quoteDate mismatch quoteDate=${quoteDate}`, issues);
    }
  }
  assertFresh(priorityFirst && mobileFirst, "missing warrant first rows across priority/mobile", issues);
  if (priorityFirst && mobileFirst) {
    for (const [label, row] of [["mobile", mobileFirst]]) {
      assertFresh(String(row.code || "") === String(priorityFirst.code || ""), `warrant ${label} first code mismatch`, issues);
      assertFresh(sameNumber(rowClose(row), rowClose(priorityFirst)), `warrant ${label} first close mismatch`, issues);
      assertFresh(sameNumber(row.finalScore, priorityFirst.finalScore, 0), `warrant ${label} first finalScore mismatch`, issues);
      assertFresh(normalizeDate(row.quoteDate) === quoteDate, `warrant ${label} first quoteDate mismatch quoteDate=${quoteDate}`, issues);
    }
  }
  assertFresh(extractCount(warrantSlim) === extractCount(warrantLatest), "warrant-flow-slim count mismatch latest", issues);
  assertFresh(extractCount(warrantPriority) <= extractCount(warrantSlim), "warrant-priority-top larger than slim", issues);
  assertFresh(extractCount(warrantMobile) <= extractCount(warrantSlim), "warrant-flow-mobile-top larger than slim", issues);
  if (homeFirst && !isApiAuthoritative(home)) {
    assertFresh(Number(home?.mobile?.warrant?.count || 0) === extractCount(warrantMobile), "terminal-home-bundle warrant count mismatch mobile", issues);
  }
  validateStrategy5Governance({ strategy5, strategyMatchIndex, manifest, home, quoteDate, issues });

  for (const row of rows(warrantSlim).slice(0, 20)) {
    const code = String(row.code || row.underlyingCode || "").trim();
    const quote = quoteMap.get(code);
    assertFresh(quote, `missing stock quote for warrant code=${code}`, issues);
    if (quote) {
      assertFresh(sameNumber(rowClose(row), quoteClose(quote)), `warrant ${code} close mismatch quote`, issues);
      if (Number.isFinite(Number(quote.percent))) assertFresh(sameNumber(rowPercent(row), quote.percent, 0.05), `warrant ${code} percent mismatch quote`, issues);
      assertFresh(normalizeDate(row.quoteDate) === quoteDate, `warrant ${code} quoteDate mismatch quoteDate=${quoteDate}`, issues);
    }
  }
}

function strategy5ThemeCount(strategy5, id) {
  return rows(strategy5).filter((stock) => (stock.matches || []).some((match) => match.id === id)).length;
}

function strategy5MultiCount(strategy5) {
  const ids = new Set(["chip_k_confluence", "foreign_trust_breakout", "limit_up_doji", "volume_turnover_breakout", "bollinger_kdj_buy"]);
  return rows(strategy5).filter((stock) => (stock.matches || []).filter((match) => ids.has(match.id)).length >= 2).length;
}

function strategy5RulesFingerprint(strategy5) {
  return {
    count: extractCount(strategy5),
    multi: strategy5MultiCount(strategy5),
    chipK: strategy5ThemeCount(strategy5, "chip_k_confluence"),
    foreignTrust: strategy5ThemeCount(strategy5, "foreign_trust_breakout"),
    limitUpDoji: strategy5ThemeCount(strategy5, "limit_up_doji"),
    volumeTurnover: strategy5ThemeCount(strategy5, "volume_turnover_breakout"),
    bollingerKdj: strategy5ThemeCount(strategy5, "bollinger_kdj_buy"),
  };
}

function validateStrategy5Governance({ strategy5, strategyMatchIndex, manifest, home, quoteDate, issues }) {
  const fingerprint = strategy5RulesFingerprint(strategy5);
  const sourceDate = normalizeDate(strategy5?.sourceDate || strategy5?.usedDate || strategy5?.date);
  const generatedDate = normalizeDate(strategy5?.generatedDate || strategy5?.updatedAt);
  const manifestEntry = manifest?.entries?.["strategy5-latest.json"];
  const indexEntry = manifest?.entries?.["strategy-match-index.json"];
  const indexByCode = strategyMatchIndex?.byCode || {};
  const homeStrategy5 = home?.strategies?.strategy5 || home?.desktop?.strategy5 || home?.mobile?.strategy5 || home?.strategy5;
  const detailLabelById = {
    chip_k_confluence: "籌碼老K",
    foreign_trust_breakout: "準突破",
    limit_up_doji: "漲停十字",
    volume_turnover_breakout: "量價周轉",
    bollinger_kdj_buy: "布林KDJ",
  };

  assertFresh(strategy5?.ok === true, "strategy5-latest ok=false", issues);
  assertFresh(fingerprint.count === extractCount(strategy5), `strategy5 count mismatch payload=${strategy5?.count} actual=${fingerprint.count}`, issues);
  assertFresh(fingerprint.chipK >= 1, `strategy5 chip_k_confluence empty; expected latest 籌碼老K rules to produce rows, got ${fingerprint.chipK}`, issues);
  if (!isApiAuthoritative(strategy5)) {
    assertFresh(fingerprint.foreignTrust <= 10, `strategy5 foreign_trust_breakout count out of governed range; got ${fingerprint.foreignTrust}`, issues);
  }
  assertFresh(fingerprint.chipK !== 0 || fingerprint.foreignTrust !== 42, "strategy5 appears to be stale pre-governance cache chipK=0 foreignTrust=42", issues);
  if (manifestEntry && !isApiAuthoritative(strategy5)) {
    assertFresh(Number(manifestEntry?.count || 0) === fingerprint.count, `strategy5 manifest count mismatch manifest=${manifestEntry?.count} actual=${fingerprint.count}`, issues);
  }
  assertFresh(Number(indexEntry?.count || 0) >= fingerprint.count, `strategy-match-index manifest count too small index=${indexEntry?.count} strategy5=${fingerprint.count}`, issues);
  assertFresh(Number(strategyMatchIndex?.count || 0) >= fingerprint.count, `strategy-match-index count too small index=${strategyMatchIndex?.count} strategy5=${fingerprint.count}`, issues);
  assertFresh(sourceDate === quoteDate, `strategy5 sourceDate mismatch quoteDate=${quoteDate} sourceDate=${sourceDate}`, issues);
  assertFresh(Boolean(generatedDate), "strategy5 missing generatedDate/updatedAt", issues);
  assertFresh(Number(homeStrategy5?.count || 0) === fingerprint.count, `terminal-home-bundle strategy5 count mismatch home=${homeStrategy5?.count} actual=${fingerprint.count}`, issues);

  if (!isApiAuthoritative(strategy5)) {
    for (const stock of rows(strategy5).slice(0, 40)) {
      const code = String(stock.code || "").trim();
      if (!code) continue;
      const indexMatches = indexByCode[code] || [];
      const strategy5Index = indexMatches.find((item) => item?.key === "strategy5");
      const details = Array.isArray(strategy5Index?.details) ? strategy5Index.details.map(String) : [];
      const strategy5Ids = (stock.matches || []).map((match) => match.id).filter(Boolean);
      assertFresh(strategy5Index, `strategy-match-index missing strategy5 entry code=${code}`, issues);
      for (const id of strategy5Ids) {
        const label = detailLabelById[id] || id;
        assertFresh(details.includes(label), `strategy-match-index missing strategy5 detail code=${code} id=${id} label=${label}`, issues);
      }
    }
  }
}

async function validateTerminalFreshnessGate(payloads, issues) {
  if (!LIVE || SKIP_TERMINAL_GATE || !CHECK_LEGACY_TERMINAL_GATE) return;
  let version = null;
  let gate = null;
  try {
    version = await fetchJsonFile("version.json");
  } catch (error) {
    issues.push(`terminal freshness gate missing version.json: ${error.message}`);
    return;
  }
  try {
    gate = await fetchJsonFile("data/live-freshness-ok.json");
  } catch (error) {
    issues.push(`terminal freshness gate missing live-freshness-ok.json: ${error.message}`);
    return;
  }

  const manifest = payloads["data-manifest"];
  const cb = payloads["cb-detect-latest"];
  const strategy5 = payloads["strategy5-latest"];
  const strategy4 = payloads["strategy4-latest"];
  const openBuy = payloads["open-buy-latest"];
  const institutionLatest = payloads["institution-latest"];
  const institutionSlim = payloads["institution-slim"];
  const institutionTdcc = payloads["institution-tdcc-breakout-top"];
  const warrantSlim = payloads["warrant-flow-slim"];
  const strategy5Fingerprint = strategy5RulesFingerprint(strategy5);
  const gateCheckedAt = Date.parse(gate.checkedAt || "");
  const ageMinutes = Number.isFinite(gateCheckedAt) ? (Date.now() - gateCheckedAt) / 60000 : Infinity;
  assertFresh(gate.ok === true, "terminal freshness gate ok=false", issues);
  assertFresh(Boolean(String(gate.gateId || "").trim()), "terminal freshness gate missing gateId", issues);
  assertFresh(/^\d{14}-[0-9a-f]{7,12}$/i.test(String(gate.gateId || "")), `terminal freshness gate invalid gateId=${gate.gateId}`, issues);
  assertFresh(String(gate.version || "") === String(version.version || ""), `terminal freshness gate version mismatch gate=${gate.version} live=${version.version}`, issues);
  assertFresh(String(gate.verifier || "").includes("verify:data-freshness:live"), "terminal freshness gate verifier missing live data freshness", issues);
  assertFresh(ageMinutes <= 1440, `terminal freshness gate stale ageMinutes=${Math.round(ageMinutes)}`, issues);
  assertFresh(Number(gate.manifestCount || 0) === extractCount(manifest), `terminal freshness gate manifest count mismatch gate=${gate.manifestCount} actual=${extractCount(manifest)}`, issues);
  assertFresh(Number(gate.cbCount || 0) === extractCount(cb), `terminal freshness gate CB count mismatch gate=${gate.cbCount} actual=${extractCount(cb)}`, issues);
  if (isApiAuthoritative(cb)) {
    assertFresh(Number(gate.manifestCbCount || 0) === extractCount(cb), `terminal freshness gate API CB count mismatch gate=${gate.manifestCbCount} actual=${extractCount(cb)}`, issues);
  } else {
    assertFresh(Number(gate.manifestCbCount || 0) === Number(manifest?.entries?.["cb-detect-latest.json"]?.count || 0), `terminal freshness gate manifest CB count mismatch gate=${gate.manifestCbCount} actual=${manifest?.entries?.["cb-detect-latest.json"]?.count}`, issues);
    assertFresh(Number(gate.cbCount || 0) === Number(manifest?.entries?.["cb-detect-latest.json"]?.count || 0), `terminal freshness gate CB rows not aligned with manifest gate=${gate.cbCount} manifest=${manifest?.entries?.["cb-detect-latest.json"]?.count}`, issues);
  }
  assertFresh(Number(gate.institutionCount || 0) === extractCount(institutionLatest), `terminal freshness gate institution count mismatch gate=${gate.institutionCount} actual=${extractCount(institutionLatest)}`, issues);
  assertFresh(normalizeDate(gate.institutionDate) === normalizeDate(institutionLatest?.usedDate || institutionLatest?.date), `terminal freshness gate institution date mismatch gate=${gate.institutionDate} actual=${institutionLatest?.usedDate || institutionLatest?.date}`, issues);
  assertFresh(Number(gate.institutionSlimCount || 0) === extractCount(institutionSlim), `terminal freshness gate institution slim count mismatch gate=${gate.institutionSlimCount} actual=${extractCount(institutionSlim)}`, issues);
  assertFresh(normalizeDate(gate.institutionSlimDate) === normalizeDate(institutionSlim?.usedDate || institutionSlim?.date), `terminal freshness gate institution slim date mismatch gate=${gate.institutionSlimDate} actual=${institutionSlim?.usedDate || institutionSlim?.date}`, issues);
  assertFresh(Number(gate.institutionTdccCount || 0) === extractCount(institutionTdcc), `terminal freshness gate institution TDCC count mismatch gate=${gate.institutionTdccCount} actual=${extractCount(institutionTdcc)}`, issues);
  assertFresh(normalizeDate(gate.institutionTdccDate) === normalizeDate(institutionTdcc?.institutionDate || institutionTdcc?.usedDate || institutionTdcc?.date), `terminal freshness gate institution TDCC date mismatch gate=${gate.institutionTdccDate} actual=${institutionTdcc?.institutionDate || institutionTdcc?.usedDate || institutionTdcc?.date}`, issues);
  assertFresh(Number(gate.warrantCount || 0) === extractCount(warrantSlim), `terminal freshness gate warrant count mismatch gate=${gate.warrantCount} actual=${extractCount(warrantSlim)}`, issues);
  assertFresh(Number(gate.warrantVolumeCount || 0) === extractVolumeCount(warrantSlim), `terminal freshness gate warrant volume count mismatch gate=${gate.warrantVolumeCount} actual=${extractVolumeCount(warrantSlim)}`, issues);
  assertFresh(Number(gate.warrantSingleSignalCount || 0) === Number(warrantSlim?.singleSignalCount || 0), `terminal freshness gate warrant single signal count mismatch gate=${gate.warrantSingleSignalCount} actual=${warrantSlim?.singleSignalCount}`, issues);
  assertFresh(Number(gate.openBuyCount || 0) === extractCount(openBuy), `terminal freshness gate openBuy count mismatch gate=${gate.openBuyCount} actual=${extractCount(openBuy)}`, issues);
  assertFresh(normalizeDate(gate.openBuySourceDate) === normalizeDate(openBuy?.usedDate || openBuy?.date || openBuy?.sourceDate), `terminal freshness gate openBuy date mismatch gate=${gate.openBuySourceDate} actual=${openBuy?.usedDate || openBuy?.date || openBuy?.sourceDate}`, issues);
  assertFresh(Number(gate.strategy4Count || 0) === extractCount(strategy4), `terminal freshness gate strategy4 count mismatch gate=${gate.strategy4Count} actual=${extractCount(strategy4)}`, issues);
  assertFresh(normalizeDate(gate.strategy4ScanStamp) === normalizeDate(strategy4?.scanStamp), `terminal freshness gate strategy4 scanStamp mismatch gate=${gate.strategy4ScanStamp} actual=${strategy4?.scanStamp}`, issues);
  assertFresh(Boolean(gate.strategy4Complete) === Boolean(strategy4?.complete), `terminal freshness gate strategy4 complete mismatch gate=${gate.strategy4Complete} actual=${strategy4?.complete}`, issues);
  assertFresh(Number(gate.strategy4Total || 0) === Number(strategy4?.total || 0), `terminal freshness gate strategy4 total mismatch gate=${gate.strategy4Total} actual=${strategy4?.total}`, issues);
  assertFresh(Number(gate.strategy5Count || 0) === strategy5Fingerprint.count, `terminal freshness gate strategy5 count mismatch gate=${gate.strategy5Count} actual=${strategy5Fingerprint.count}`, issues);
  assertFresh(Number(gate.strategy5ChipKCount || 0) === strategy5Fingerprint.chipK, `terminal freshness gate strategy5 chipK mismatch gate=${gate.strategy5ChipKCount} actual=${strategy5Fingerprint.chipK}`, issues);
  assertFresh(Number(gate.strategy5ForeignTrustCount || 0) === strategy5Fingerprint.foreignTrust, `terminal freshness gate strategy5 foreignTrust mismatch gate=${gate.strategy5ForeignTrustCount} actual=${strategy5Fingerprint.foreignTrust}`, issues);
  assertFresh(Number(gate.strategy5MultiCount || 0) === strategy5Fingerprint.multi, `terminal freshness gate strategy5 multi mismatch gate=${gate.strategy5MultiCount} actual=${strategy5Fingerprint.multi}`, issues);
}


async function loadTarget(target) {
  if (!LIVE) {
    if (!target.api) return JSON.parse(readLocal(target.file));
  }
  const result = await fetchText(target.api || target.file);
  if (result.status < 200 || result.status >= 300) throw new Error(`${target.name} HTTP ${result.status}`);
  return deriveApiPayload(JSON.parse(result.body), target.derive);
}

async function loadLiveApiTarget(target) {
  const result = await fetchText(target.endpoint);
  if (result.status < 200 || result.status >= 300) {
    if (isLiveApiTargetNotYetDue(target)) {
      let payload = {};
      try {
        payload = JSON.parse(result.body || "{}");
      } catch {
        payload = {};
      }
      return {
        ...payload,
        ok: true,
        count: 0,
        rows: [],
        runId: `not-yet-applicable-${target.name}`,
        _notApplicable: true,
        _httpStatus: result.status,
      };
    }
    throw new Error(`${target.name} HTTP ${result.status}`);
  }
  return JSON.parse(result.body);
}

async function validateLegacyGateArtifactIfOpted(report, issues) {
  if (!LIVE || !CHECK_LEGACY_TERMINAL_GATE || SKIP_TERMINAL_GATE) return;
  try {
    const gate = await fetchJsonFile("data/live-freshness-ok.json");
    report.legacyGateArtifact = {
      ok: gate?.ok === true,
      gateId: gate?.gateId || null,
      checkedAt: gate?.checkedAt || null,
    };
    assertFresh(gate?.ok === true, "legacy terminal freshness gate ok=false", issues);
  } catch (error) {
    report.legacyGateArtifact = { ok: false, error: error.message };
    issues.push(`legacy terminal freshness gate unavailable: ${error.message}`);
  }
}

async function verifyLiveApiOnly() {
  const report = {
    ok: true,
    mode: "live",
    authority: "supabase-complete-run-api",
    checkedAt: new Date().toISOString(),
    entries: {},
  };
  const issues = [];

  for (const target of LIVE_API_TARGETS) {
    try {
      const payload = await loadLiveApiTarget(target);
      const count = extractCount(payload);
      const rowsCount = extractRowsForLiveApi(payload).length;
      const runId = extractRunId(payload);
      const date = normalizeDate(
        payload?.usedDate ||
        payload?.sourceDate ||
        payload?.marketDataDate ||
        payload?.marketSession?.marketDataDate ||
        payload?.date ||
        payload?.updatedAt ||
        payload?.generatedAt
      );
      const notApplicable = payload?._notApplicable === true;
      const ok = notApplicable || (target.minCount ? count >= target.minCount : true);
      report.entries[target.name] = {
        ok,
        endpoint: target.endpoint,
        count,
        rows: rowsCount,
        date,
        runId: runId || null,
        cacheSource: payload?.cacheSource || payload?.source || null,
        status: notApplicable ? "not_applicable_yet" : "checked",
      };
      if (!notApplicable && payload?.ok === false) issues.push(`${target.name}: ok=false reason=${payload.reason || payload.error || "unknown"}`);
      if (!ok) issues.push(`${target.name}: count ${count} < ${target.minCount}`);
      if (!notApplicable && target.requireRunId && !runId) issues.push(`${target.name}: missing runId/snapshot id`);
      if (!notApplicable && target.requireWarrantContract) validateWarrantContract(payload, target.name, issues);
    } catch (error) {
      report.entries[target.name] = { ok: false, endpoint: target.endpoint, error: error.message };
      issues.push(`${target.name}: ${error.message}`);
    }
  }

  await validateLegacyGateArtifactIfOpted(report, issues);
  report.ok = issues.length === 0;
  const outPath = path.join(ROOT, "data", "data-freshness-report.json");
  if (WRITE_REPORT) fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  if (issues.length) {
    console.error("[data-freshness] failed");
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }
  console.log(`[data-freshness] ok mode=live entries=${Object.keys(report.entries).length}`);
}

async function main() {
  if (LIVE && !VERIFY_STATIC_DATA_FRESHNESS) {
    await verifyLiveApiOnly();
    return;
  }
  const report = {
    ok: true,
    mode: LIVE ? "live" : "local",
    checkedAt: new Date().toISOString(),
    entries: {},
  };
  const issues = [];
  const payloads = {};
  for (const target of TARGETS) {
    try {
      const payload = await loadTarget(target);
      payloads[target.name] = payload;
      const count = extractCount(payload);
      const date = extractDate(payload);
      const ok = target.minCount ? count >= target.minCount : true;
      report.entries[target.name] = { ok, count, date };
      if (!ok) issues.push(`${target.name}: count ${count} < ${target.minCount}`);
    } catch (error) {
      report.entries[target.name] = { ok: false, error: error.message };
      issues.push(`${target.name}: ${error.message}`);
    }
  }
  validateCrossPayloads(payloads, issues);
  await validateTerminalFreshnessGate(payloads, issues);
  report.ok = issues.length === 0;
  const outPath = path.join(ROOT, "data", "data-freshness-report.json");
  if (WRITE_REPORT) fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  if (issues.length) {
    console.error("[data-freshness] failed");
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }
  console.log(`[data-freshness] ok mode=${report.mode} entries=${Object.keys(report.entries).length}`);
}

main().catch((error) => {
  console.error(`[data-freshness] failed: ${error.message}`);
  process.exit(1);
});





