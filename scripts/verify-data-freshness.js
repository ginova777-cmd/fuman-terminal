const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const LIVE = process.argv.includes("--live") || process.env.FUMAN_DATA_FRESHNESS_LIVE === "1";
const WRITE_REPORT = process.argv.includes("--write") || process.env.FUMAN_WRITE_FRESHNESS_REPORT === "1";

const TARGETS = [
  { name: "data-manifest", file: "data/data-manifest.json", minCount: 25 },
  { name: "terminal-home-bundle", file: "data/terminal-home-bundle.json" },
  { name: "market-summary", file: "data/market-summary.json" },
  { name: "health-summary", file: "data/health-summary.json" },
  { name: "stocks-index", file: "data/stocks-index.json", minCount: 1000 },
  { name: "strategy3-latest", file: "data/strategy3-latest.json", minCount: 1 },
  { name: "strategy4-latest", file: "data/strategy4-latest.json", minCount: 1 },
  { name: "strategy4-summary", file: "data/strategy4-summary.json", minCount: 1 },
  { name: "strategy5-latest", file: "data/strategy5-latest.json" },
  { name: "warrant-flow-latest", file: "data/warrant-flow-latest.json" },
  { name: "stocks-quotes-slim", file: "data/stocks-quotes-slim.json", minCount: 1000 },
  { name: "institution-latest", file: "data/institution-latest.json", minCount: 1000 },
  { name: "institution-slim", file: "data/institution-slim.json", minCount: 1000 },
  { name: "institution-mobile-top", file: "data/institution-mobile-top.json", minCount: 1 },
  { name: "cb-detect-latest", file: "data/cb-detect-latest.json", minCount: 1 },
  { name: "warrant-flow-slim", file: "data/warrant-flow-slim.json", minCount: 1 },
  { name: "warrant-flow-mobile-top", file: "data/warrant-flow-mobile-top.json", minCount: 1 },
];

function fetchText(pathname, timeoutMs = 20000) {
  const url = `${BASE_URL}/${pathname}?v=freshness-${Date.now()}`;
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
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function normalizeDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function extractDate(payload) {
  return normalizeDate(payload.scanStamp || payload.dataDate || payload.usedDate || payload.date || payload.updatedAt || payload.generatedAt || payload.asOf);
}

function extractCount(payload) {
  if (Number.isFinite(Number(payload.count))) return Number(payload.count);
  if (Number.isFinite(Number(payload.total))) return Number(payload.total);
  if (Array.isArray(payload.items)) return payload.items.length;
  if (Array.isArray(payload.matches)) return payload.matches.length;
  if (Array.isArray(payload.rows)) return payload.rows.length;
  if (Array.isArray(payload.data)) return payload.data.length;
  if (Array.isArray(payload.stocks)) return payload.stocks.length;
  if (Array.isArray(payload.quotes)) return payload.quotes.length;
  if (payload.entries && typeof payload.entries === "object") return Object.keys(payload.entries).length;
  return 0;
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.stocks)) return payload.stocks;
  if (Array.isArray(payload.quotes)) return payload.quotes;
  return [];
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

function validateCrossPayloads(payloads, issues) {
  const manifest = payloads["data-manifest"];
  const home = payloads["terminal-home-bundle"];
  const quotes = payloads["stocks-quotes-slim"];
  const institutionLatest = payloads["institution-latest"];
  const institutionSlim = payloads["institution-slim"];
  const institutionMobile = payloads["institution-mobile-top"];
  const cb = payloads["cb-detect-latest"];
  const warrantLatest = payloads["warrant-flow-latest"];
  const warrantSlim = payloads["warrant-flow-slim"];
  const warrantMobile = payloads["warrant-flow-mobile-top"];
  const quoteDate = normalizeDate(quotes?.resolvedTradeDate || quotes?.today || quotes?.date);
  for (const [name, payload] of [
    ["institution-latest.json", institutionLatest],
    ["institution-slim.json", institutionSlim],
    ["institution-mobile-top.json", institutionMobile],
    ["cb-detect-latest.json", cb],
    ["warrant-flow-slim.json", warrantSlim],
    ["warrant-flow-mobile-top.json", warrantMobile],
    ["stocks-quotes-slim.json", quotes],
    ["terminal-home-bundle.json", home],
  ]) {
    const entry = manifest?.entries?.[name];
    assertFresh(entry, `data-manifest missing ${name}`, issues);
    if (entry) assertFresh(Number(entry.count || 0) === extractCount(payload), `data-manifest ${name} count mismatch entry=${entry.count} actual=${extractCount(payload)}`, issues);
  }
  assertFresh(normalizeDate(institutionLatest?.usedDate || institutionLatest?.date) === quoteDate, `institution-latest date mismatch quoteDate=${quoteDate}`, issues);
  assertFresh(normalizeDate(institutionSlim?.usedDate || institutionSlim?.date) === quoteDate, `institution-slim date mismatch quoteDate=${quoteDate}`, issues);
  assertFresh(extractCount(institutionMobile) <= extractCount(institutionSlim), "institution-mobile-top larger than institution-slim", issues);
  assertFresh(extractCount(cb) > 0, "cb-detect-latest empty", issues);

  const latestFirst = rows(warrantLatest)[0];
  const slimFirst = rows(warrantSlim)[0];
  const mobileFirst = rows(warrantMobile)[0];
  const homeFirst = home?.mobile?.warrant?.top?.[0];
  assertFresh(latestFirst && slimFirst && mobileFirst && homeFirst, "missing warrant first rows across latest/slim/mobile/home", issues);
  if (latestFirst && slimFirst && mobileFirst && homeFirst) {
    for (const [label, row] of [["slim", slimFirst], ["mobile", mobileFirst], ["home", homeFirst]]) {
      assertFresh(String(row.code || "") === String(latestFirst.code || ""), `warrant ${label} first code mismatch`, issues);
      assertFresh(sameNumber(rowClose(row), rowClose(latestFirst)), `warrant ${label} first close mismatch`, issues);
      assertFresh(sameNumber(row.finalScore, latestFirst.finalScore, 0), `warrant ${label} first finalScore mismatch`, issues);
      assertFresh(normalizeDate(row.quoteDate) === quoteDate, `warrant ${label} first quoteDate mismatch quoteDate=${quoteDate}`, issues);
    }
  }
  assertFresh(extractCount(warrantSlim) === extractCount(warrantLatest), "warrant-flow-slim count mismatch latest", issues);
  assertFresh(extractCount(warrantMobile) <= extractCount(warrantSlim), "warrant-flow-mobile-top larger than slim", issues);
  assertFresh(Number(home?.mobile?.warrant?.count || 0) === extractCount(warrantMobile), "terminal-home-bundle warrant count mismatch mobile", issues);

  const quoteMap = new Map(rows(quotes).map((row) => [String(row.code || row.symbol || "").trim(), row]));
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


async function loadTarget(target) {
  if (!LIVE) return JSON.parse(readLocal(target.file));
  const result = await fetchText(target.file);
  if (result.status < 200 || result.status >= 300) throw new Error(`${target.name} HTTP ${result.status}`);
  return JSON.parse(result.body);
}

async function main() {
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
