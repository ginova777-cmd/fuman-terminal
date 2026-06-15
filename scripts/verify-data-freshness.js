const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const LIVE = process.argv.includes("--live") || process.env.FUMAN_DATA_FRESHNESS_LIVE === "1";
const WRITE_REPORT = process.argv.includes("--write") || process.env.FUMAN_WRITE_FRESHNESS_REPORT === "1";
const SKIP_TERMINAL_GATE = process.env.FUMAN_SKIP_TERMINAL_GATE_ARTIFACT === "1";
const LOCAL_DATA_DIR = process.env.FUMAN_VERIFY_DATA_DIR || path.join(ROOT, "data");

const TARGETS = [
  { name: "data-manifest", file: "data/data-manifest.json", minCount: 25 },
  { name: "terminal-home-bundle", file: "data/terminal-home-bundle.json" },
  { name: "market-summary", file: "data/market-summary.json" },
  { name: "health-summary", file: "data/health-summary.json" },
  { name: "stocks-index", file: "data/stocks-index.json", minCount: 1000 },
  { name: "open-buy-latest", file: "data/open-buy-latest.json", minCount: 1 },
  { name: "strategy3-latest", file: "data/strategy3-latest.json", minCount: 1 },
  { name: "strategy4-latest", file: "data/strategy4-latest.json", minCount: 1 },
  { name: "strategy4-summary", file: "data/strategy4-summary.json", minCount: 1 },
  { name: "strategy5-latest", file: "data/strategy5-latest.json", minCount: 1 },
  { name: "strategy-match-index", file: "data/strategy-match-index.json", minCount: 1 },
  { name: "warrant-flow-latest", file: "data/warrant-flow-latest.json" },
  { name: "stocks-quotes-slim", file: "data/stocks-quotes-slim.json", minCount: 1000 },
  { name: "institution-latest", file: "data/institution-latest.json", minCount: 1000 },
  { name: "institution-slim", file: "data/institution-slim.json", minCount: 1000 },
  { name: "institution-mobile-top", file: "data/institution-mobile-top.json", minCount: 1 },
  { name: "cb-detect-latest", file: "data/cb-detect-latest.json", minCount: 1 },
  { name: "warrant-flow-slim", file: "data/warrant-flow-slim.json", minCount: 1 },
  { name: "warrant-priority-top", file: "data/warrant-priority-top.json", minCount: 1 },
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
  const normalized = String(file || "").replace(/\\/g, "/");
  const dataPrefix = "data/";
  if (normalized.startsWith(dataPrefix)) {
    return fs.readFileSync(path.join(LOCAL_DATA_DIR, normalized.slice(dataPrefix.length)), "utf8");
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

async function fetchJsonFile(pathname) {
  const result = await fetchText(pathname);
  if (result.status < 200 || result.status >= 300) throw new Error(`${pathname} HTTP ${result.status}`);
  return JSON.parse(result.body);
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
  const strategy5 = payloads["strategy5-latest"];
  const openBuy = payloads["open-buy-latest"];
  const strategyMatchIndex = payloads["strategy-match-index"];
  const institutionLatest = payloads["institution-latest"];
  const institutionSlim = payloads["institution-slim"];
  const institutionMobile = payloads["institution-mobile-top"];
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
    ["cb-detect-latest.json", cb],
    ["warrant-flow-slim.json", warrantSlim],
    ["warrant-priority-top.json", warrantPriority],
    ["warrant-flow-mobile-top.json", warrantMobile],
    ["open-buy-latest.json", openBuy],
    ["strategy5-latest.json", strategy5],
    ["strategy-match-index.json", strategyMatchIndex],
    ["stocks-quotes-slim.json", quotes],
    ["terminal-home-bundle.json", home],
  ]) {
    const entry = manifest?.entries?.[name];
    assertFresh(entry, `data-manifest missing ${name}`, issues);
    if (entry) assertFresh(Number(entry.count || 0) === extractCount(payload), `data-manifest ${name} count mismatch entry=${entry.count} actual=${extractCount(payload)}`, issues);
  }
  const institutionLatestDate = normalizeDate(institutionLatest?.usedDate || institutionLatest?.date);
  const institutionSlimDate = normalizeDate(institutionSlim?.usedDate || institutionSlim?.date);
  assertFresh(!quoteDate || !institutionLatestDate || institutionLatestDate <= quoteDate, `institution-latest date mismatch quoteDate=${quoteDate}`, issues);
  assertFresh(!quoteDate || !institutionSlimDate || institutionSlimDate <= quoteDate, `institution-slim date mismatch quoteDate=${quoteDate}`, issues);
  assertFresh(extractCount(institutionMobile) <= extractCount(institutionSlim), "institution-mobile-top larger than institution-slim", issues);
  assertFresh(extractCount(cb) > 0, "cb-detect-latest empty", issues);
  const openBuyDate = normalizeDate(openBuy?.usedDate || openBuy?.date || openBuy?.sourceDate);
  assertFresh(openBuy?.ok === true, "open-buy-latest ok=false", issues);
  assertFresh(extractCount(openBuy) > 0, "open-buy-latest empty", issues);
  assertFresh(!quoteDate || openBuyDate === quoteDate, `open-buy sourceDate mismatch quoteDate=${quoteDate} sourceDate=${openBuyDate}`, issues);

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
  assertFresh(priorityFirst && mobileFirst && homeFirst, "missing warrant first rows across priority/mobile/home", issues);
  if (priorityFirst && mobileFirst && homeFirst) {
    for (const [label, row] of [["mobile", mobileFirst], ["home", homeFirst]]) {
      assertFresh(String(row.code || "") === String(priorityFirst.code || ""), `warrant ${label} first code mismatch`, issues);
      assertFresh(sameNumber(rowClose(row), rowClose(priorityFirst)), `warrant ${label} first close mismatch`, issues);
      assertFresh(sameNumber(row.finalScore, priorityFirst.finalScore, 0), `warrant ${label} first finalScore mismatch`, issues);
      assertFresh(normalizeDate(row.quoteDate) === quoteDate, `warrant ${label} first quoteDate mismatch quoteDate=${quoteDate}`, issues);
    }
  }
  assertFresh(extractCount(warrantSlim) === extractCount(warrantLatest), "warrant-flow-slim count mismatch latest", issues);
  assertFresh(extractCount(warrantPriority) <= extractCount(warrantSlim), "warrant-priority-top larger than slim", issues);
  assertFresh(extractCount(warrantMobile) <= extractCount(warrantSlim), "warrant-flow-mobile-top larger than slim", issues);
  assertFresh(Number(home?.mobile?.warrant?.count || 0) === extractCount(warrantMobile), "terminal-home-bundle warrant count mismatch mobile", issues);
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
  assertFresh(fingerprint.foreignTrust <= 10, `strategy5 foreign_trust_breakout count out of governed range; got ${fingerprint.foreignTrust}`, issues);
  assertFresh(fingerprint.chipK !== 0 || fingerprint.foreignTrust !== 42, "strategy5 appears to be stale pre-governance cache chipK=0 foreignTrust=42", issues);
  assertFresh(Number(manifestEntry?.count || 0) === fingerprint.count, `strategy5 manifest count mismatch manifest=${manifestEntry?.count} actual=${fingerprint.count}`, issues);
  assertFresh(Number(indexEntry?.count || 0) >= fingerprint.count, `strategy-match-index manifest count too small index=${indexEntry?.count} strategy5=${fingerprint.count}`, issues);
  assertFresh(Number(strategyMatchIndex?.count || 0) >= fingerprint.count, `strategy-match-index count too small index=${strategyMatchIndex?.count} strategy5=${fingerprint.count}`, issues);
  assertFresh(sourceDate === quoteDate, `strategy5 sourceDate mismatch quoteDate=${quoteDate} sourceDate=${sourceDate}`, issues);
  assertFresh(Boolean(generatedDate), "strategy5 missing generatedDate/updatedAt", issues);
  assertFresh(Number(homeStrategy5?.count || 0) === fingerprint.count, `terminal-home-bundle strategy5 count mismatch home=${homeStrategy5?.count} actual=${fingerprint.count}`, issues);

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

async function validateTerminalFreshnessGate(payloads, issues) {
  if (!LIVE || SKIP_TERMINAL_GATE) return;
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
  const openBuy = payloads["open-buy-latest"];
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
  assertFresh(Number(gate.manifestCbCount || 0) === Number(manifest?.entries?.["cb-detect-latest.json"]?.count || 0), `terminal freshness gate manifest CB count mismatch gate=${gate.manifestCbCount} actual=${manifest?.entries?.["cb-detect-latest.json"]?.count}`, issues);
  assertFresh(Number(gate.cbCount || 0) === Number(manifest?.entries?.["cb-detect-latest.json"]?.count || 0), `terminal freshness gate CB rows not aligned with manifest gate=${gate.cbCount} manifest=${manifest?.entries?.["cb-detect-latest.json"]?.count}`, issues);
  assertFresh(Number(gate.openBuyCount || 0) === extractCount(openBuy), `terminal freshness gate openBuy count mismatch gate=${gate.openBuyCount} actual=${extractCount(openBuy)}`, issues);
  assertFresh(normalizeDate(gate.openBuySourceDate) === normalizeDate(openBuy?.usedDate || openBuy?.date || openBuy?.sourceDate), `terminal freshness gate openBuy date mismatch gate=${gate.openBuySourceDate} actual=${openBuy?.usedDate || openBuy?.date || openBuy?.sourceDate}`, issues);
  assertFresh(Number(gate.strategy5Count || 0) === strategy5Fingerprint.count, `terminal freshness gate strategy5 count mismatch gate=${gate.strategy5Count} actual=${strategy5Fingerprint.count}`, issues);
  assertFresh(Number(gate.strategy5ChipKCount || 0) === strategy5Fingerprint.chipK, `terminal freshness gate strategy5 chipK mismatch gate=${gate.strategy5ChipKCount} actual=${strategy5Fingerprint.chipK}`, issues);
  assertFresh(Number(gate.strategy5ForeignTrustCount || 0) === strategy5Fingerprint.foreignTrust, `terminal freshness gate strategy5 foreignTrust mismatch gate=${gate.strategy5ForeignTrustCount} actual=${strategy5Fingerprint.foreignTrust}`, issues);
  assertFresh(Number(gate.strategy5MultiCount || 0) === strategy5Fingerprint.multi, `terminal freshness gate strategy5 multi mismatch gate=${gate.strategy5MultiCount} actual=${strategy5Fingerprint.multi}`, issues);
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


