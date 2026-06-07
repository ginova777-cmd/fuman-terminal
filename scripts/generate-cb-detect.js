const fs = require("fs/promises");
const path = require("path");

const CBAS_BASE = "https://cbas16889.pscnet.com.tw/api/CbasQuote";
const OUT_FILE = path.join(__dirname, "..", "data", "cb-detect-latest.json");
const STOCKS_FILE = path.join(__dirname, "..", "data", "stocks-slim.json");
const HISTORY_MONTHS = 14;
const HISTORY_CONCURRENCY = 4;
const INTRADAY_60M_RANGE = "6mo";

const SOURCES = [
  { layer: "第一層：MOPS董事會決議", stage: "董事會決議", url: `${CBAS_BASE}/GetBoardAnnouncement` },
  { layer: "第二層：CBAS預計發行", stage: "生效後", url: `${CBAS_BASE}/GetRecentlyEffectively` },
  { layer: "第三層：CBAS已發行（近期掛牌）", stage: "已發行", url: `${CBAS_BASE}/GetRecentlyListed` },
];

function num(value) {
  if (value === undefined || value === null || value === "") return 0;
  return Number(String(value).replace(/[,%]/g, "").trim()) || 0;
}

function cleanCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function isAuction(text) {
  return String(text || "").includes("競拍");
}

function rocToIso(value) {
  const parts = String(value || "").split("/");
  if (parts.length !== 3) return "";
  const year = Number(parts[0]) + 1911;
  return `${year}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
}

function monthStarts(count = HISTORY_MONTHS) {
  const dates = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    dates.push({
      twse: `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}01`,
      tpex: `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/01`,
    });
  }
  return dates;
}

function normalizeTwseRows(payload) {
  if (!Array.isArray(payload?.data)) return [];
  return payload.data.map((row) => ({
    date: rocToIso(row[0]),
    close: num(row[6]),
  })).filter((row) => row.date && row.close);
}

function normalizeTpexRows(payload) {
  const table = Array.isArray(payload?.tables) ? payload.tables[0] : null;
  if (!Array.isArray(table?.data)) return [];
  return table.data.map((row) => ({
    date: rocToIso(row[0]),
    close: num(row[6]),
  })).filter((row) => row.date && row.close);
}

function sma(values, length, offset = 0) {
  const end = values.length - offset;
  const start = end - length;
  if (start < 0 || end <= 0) return 0;
  const slice = values.slice(start, end);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

function emaSeries(values, length) {
  if (!values.length) return [];
  const multiplier = 2 / (length + 1);
  const result = [];
  values.forEach((value, index) => {
    result[index] = index === 0 ? value : value * multiplier + result[index - 1] * (1 - multiplier);
  });
  return result;
}

function macdSnapshot(values) {
  if (values.length < 35) return { histogram: 0, prevHistogram: 0, goldenCross: false, rising: false };
  const ema12 = emaSeries(values, 12);
  const ema26 = emaSeries(values, 26);
  const macdLine = values.map((_, index) => (ema12[index] || 0) - (ema26[index] || 0));
  const signalLine = emaSeries(macdLine, 9);
  const histogram = (macdLine.at(-1) || 0) - (signalLine.at(-1) || 0);
  const prevHistogram = (macdLine.at(-2) || 0) - (signalLine.at(-2) || 0);
  return {
    histogram,
    prevHistogram,
    goldenCross: prevHistogram <= 0 && histogram > 0,
    rising: histogram > prevHistogram,
  };
}

async function fetchOfficialJson(url, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminalBot/1.0)",
        Accept: "application/json,text/plain,*/*",
        Referer: url.includes("tpex.org.tw") ? "https://www.tpex.org.tw/" : "https://www.twse.com.tw/",
      },
    });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTwseMonth(code, date) {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?response=json&date=${date}&stockNo=${code}`;
  const payload = await fetchOfficialJson(url);
  if (payload?.stat && payload.stat !== "OK") return [];
  return normalizeTwseRows(payload);
}

async function fetchTpexMonth(code, date) {
  const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${code}&date=${encodeURIComponent(date)}&id=&response=json`;
  const payload = await fetchOfficialJson(url);
  return normalizeTpexRows(payload);
}

function normalizeYahooRows(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  return timestamps.map((timestamp, index) => {
    const close = num(closes[index]);
    if (!timestamp || !close) return null;
    const date = new Date(timestamp * 1000);
    return {
      date: date.toISOString().slice(0, 10),
      close,
    };
  }).filter(Boolean);
}

async function fetchYahooHistory(code, suffix) {
  const symbol = `${code}.${suffix}`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=18mo&interval=1d&events=history&includeAdjustedClose=true`;
  const payload = await fetchOfficialJson(url, 15000);
  return normalizeYahooRows(payload);
}

async function fetchYahoo60mHistory(code, suffix) {
  const symbol = `${code}.${suffix}`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${INTRADAY_60M_RANGE}&interval=60m&includePrePost=false&events=history`;
  const payload = await fetchOfficialJson(url, 15000);
  return normalizeYahooRows(payload);
}

async function fetchHistory(code) {
  const yahoo60Results = await Promise.allSettled(["TW", "TWO"].map((suffix) => fetchYahoo60mHistory(code, suffix)));
  const yahoo60Rows = yahoo60Results
    .filter((result) => result.status === "fulfilled" && result.value.length)
    .sort((a, b) => b.value.length - a.value.length)[0]?.value || [];
  if (yahoo60Rows.length) {
    return { code, market: "YAHOO_60M", timeframe: "60m", rows: yahoo60Rows };
  }

  const months = monthStarts();
  const twseResults = await Promise.allSettled(months.map((item) => fetchTwseMonth(code, item.twse)));
  let market = "TWSE";
  let rows = twseResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (rows.length < 80) {
    market = "TPEX";
    const tpexResults = await Promise.allSettled(months.map((item) => fetchTpexMonth(code, item.tpex)));
    rows = tpexResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }
  if (rows.length < 200) {
    const yahooResults = await Promise.allSettled(["TW", "TWO"].map((suffix) => fetchYahooHistory(code, suffix)));
    const yahooRows = yahooResults
      .filter((result) => result.status === "fulfilled" && result.value.length > rows.length)
      .sort((a, b) => b.value.length - a.value.length)[0]?.value || [];
    if (yahooRows.length > rows.length) {
      market = "YAHOO";
      rows = yahooRows;
    }
  }
  const byDate = new Map();
  rows.forEach((row) => byDate.set(row.date, row));
  return { code, market, timeframe: "1d", rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

async function mapLimit(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function loadStockMap() {
  try {
    const payload = JSON.parse(await fs.readFile(STOCKS_FILE, "utf8"));
    const rows = Array.isArray(payload?.stocks) ? payload.stocks : [];
    return new Map(rows.map((stock) => [cleanCode(stock.code), stock]).filter(([code]) => code));
  } catch {
    return new Map();
  }
}

function technicalFromHistory(history) {
  const closes = (history?.rows || []).map((row) => num(row.close)).filter(Boolean);
  const latestClose = closes.at(-1) || 0;
  const timeframe = history?.timeframe || "";
  if (timeframe !== "60m") {
    return {
      stockPrice: latestClose,
      aboveMa200: null,
      maAlignedUp: null,
      ma200Rising: null,
      allMaRising: null,
      macdBullish: null,
      technicalPass: false,
      technicalScore: 0,
      tags: ["缺少60分K資料，CB技術門檻不通過"],
      ma5: 0,
      ma35: 0,
      ma200: 0,
      historyCount: closes.length,
      timeframe,
    };
  }
  if (closes.length < 200) {
    return {
      stockPrice: latestClose,
      aboveMa200: null,
      maAlignedUp: null,
      ma200Rising: null,
      allMaRising: null,
      macdBullish: null,
      technicalPass: false,
      technicalScore: 0,
      tags: [`60分K歷史不足 ${closes.length}/200，CB技術門檻不通過`],
      ma5: sma(closes, 5),
      ma35: sma(closes, 35),
      ma200: 0,
      historyCount: closes.length,
      timeframe,
    };
  }
  const ma5 = sma(closes, 5);
  const ma35 = sma(closes, 35);
  const ma200 = sma(closes, 200);
  const ma5Prev = sma(closes, 5, 1);
  const ma35Prev = sma(closes, 35, 1);
  const ma200Prev = sma(closes, 200, 1);
  const aboveMa200 = latestClose > ma200;
  const ma5Rising = ma5 > ma5Prev;
  const ma35Rising = ma35 > ma35Prev;
  const ma200Rising = ma200 > ma200Prev;
  const allMaRising = ma5Rising && ma35Rising && ma200Rising;
  const maAlignedUp = ma5 > ma35 && ma35 > ma200 && allMaRising;
  const technicalPass = (aboveMa200 && ma200Rising) || allMaRising;
  const macd = macdSnapshot(closes);
  const macdBullish = macd.rising || macd.goldenCross;
  const technicalScore = (aboveMa200 && ma200Rising ? 10 : 0) + (allMaRising ? 10 : 0) + (macdBullish ? 5 : 0);
  const tags = [];
  if (aboveMa200 && ma200Rising) tags.push("60分K站上MA200且MA200向上 +10");
  if (allMaRising) tags.push("60分MA5/MA35/MA200均線同時向上 +10");
  if (!technicalPass) tags.push("60分K未符合CB技術門檻，一票否決");
  if (macdBullish) tags.push(macd.goldenCross ? "MACD黃金交叉 +5" : "MACD柱狀向上 +5");
  return {
    stockPrice: latestClose,
    aboveMa200,
    maAlignedUp,
    ma5Rising,
    ma35Rising,
    ma200Rising,
    allMaRising,
    technicalPass,
    macdBullish,
    technicalScore,
    tags,
    ma5,
    ma35,
    ma200,
    macdHistogram: macd.histogram,
    macdPrevHistogram: macd.prevHistogram,
    historyCount: closes.length,
    timeframe,
  };
}

function premiumValue(row) {
  const issuedPremium = num(row.premium_rate);
  if (issuedPremium) return issuedPremium;
  const raw = num(row.conversion_premium_rate || row.tentative_premium_rate);
  if (!raw) return 0;
  return raw > 100 ? raw - 100 : raw;
}

function scoreRow(row, source, technical = {}) {
  let score = 0;
  const tags = [];
  const circulation = num(row.circulation);
  const premium = premiumValue(row);
  const auction = isAuction(row.inquiry_auction);

  if (source.stage === "董事會決議") {
    score += 15;
    tags.push("最早期4~8週");
  } else if (source.stage === "生效後") {
    score += 20;
    tags.push("生效後確定性較高");
  } else {
    score += 10;
    tags.push("掛牌後追蹤");
  }

  if (auction) {
    score += 25;
    tags.push("競價拍賣 +25");
  } else if (row.inquiry_auction) {
    tags.push("詢價圈購");
  }

  if (circulation > 0 && circulation <= 10) {
    score += 15;
    tags.push("發行規模10億以下 +15");
  } else if (circulation > 20) {
    tags.push("發行規模偏大");
  }

  if (premium > 0 && premium <= 20) {
    score += 15;
    tags.push("轉換溢價20%以下 +15");
  } else if (premium > 30) {
    tags.push("溢價偏高");
  }

  if (technical.technicalPass === false) tags.push("60分K未符合CB技術門檻，一票否決");
  else tags.push(...(technical.tags || ["技術面待確認"]));

  return {
    baseScore: Math.min(85, score),
    score: Math.min(105, score + num(technical.technicalScore)),
    tags: [...new Set(tags)],
  };
}

function normalize(row, source, stockMap, technicalMap) {
  const code = String(row.code || row.convert_target_code || "").trim();
  const cbCode = String(row.cb_code || row.bond_code || "").trim();
  const cbName = String(row.cb_name || row.underlying_bond || "").trim();
  const premium = premiumValue(row);
  const stock = stockMap.get(cleanCode(code)) || {};
  const technical = technicalMap.get(cleanCode(code)) || {};
  const stockPrice = num(row.underlying_stock_market_price) || num(stock.close) || num(technical.stockPrice);
  const scored = scoreRow(row, source, technical);
  return {
    sourceLayer: source.layer,
    stage: source.stage,
    code,
    cbCode,
    name: code || cbCode,
    cbName,
    issueAmount: row.circulation || "",
    auctionType: row.inquiry_auction || "",
    convertPrice: num(row.conversion_price),
    stockPrice,
    premium,
    date: row.announcement_day || row.expected_effective_date || row.listing_day || row.issue_date || "",
    tcri: row.tcri || row.guarantee_situation || "",
    baseScore: scored.baseScore,
    score: scored.score,
    aboveMa200: technical.aboveMa200 ?? null,
    maAlignedUp: technical.maAlignedUp ?? null,
    ma5Rising: technical.ma5Rising ?? null,
    ma35Rising: technical.ma35Rising ?? null,
    ma200Rising: technical.ma200Rising ?? null,
    allMaRising: technical.allMaRising ?? null,
    technicalPass: technical.technicalPass ?? null,
    macdBullish: technical.macdBullish ?? null,
    ma5: technical.ma5 || 0,
    ma35: technical.ma35 || 0,
    ma200: technical.ma200 || 0,
    macdHistogram: technical.macdHistogram || 0,
    historyCount: technical.historyCount || 0,
    technicalTimeframe: technical.timeframe || "",
    quoteDate: stock.quoteDate || "",
    veto: technical.technicalPass !== true,
    tags: scored.tags,
    raw: row,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  const json = await response.json();
  if (json.statusClass !== 1 || !Array.isArray(json.result)) {
    throw new Error(`${url} unexpected response`);
  }
  return json.result;
}

async function main() {
  const rows = [];
  const sourceCounts = {};
  const stockMap = await loadStockMap();
  for (const source of SOURCES) {
    const data = await fetchJson(source.url);
    sourceCounts[source.layer] = data.length;
    rows.push(...data);
  }

  const codes = [...new Set(rows.map((row) => cleanCode(row.code || row.convert_target_code)).filter(Boolean))];
  const histories = await mapLimit(codes, HISTORY_CONCURRENCY, async (code) => {
    try {
      const history = await fetchHistory(code);
      return [code, technicalFromHistory(history)];
    } catch (error) {
      return [code, { technicalScore: 0, tags: [`技術面讀取失敗: ${error.message}`] }];
    }
  });
  const technicalMap = new Map(histories);

  const normalizedRows = [];
  for (const source of SOURCES) {
    const data = await fetchJson(source.url);
    normalizedRows.push(...data.map((row) => normalize(row, source, stockMap, technicalMap)));
  }

  const allCandidates = normalizedRows
    .filter((row) => row.code || row.cbCode);
  const candidates = allCandidates
    .filter((row) => !row.veto)
    .sort((a, b) => b.score - a.score || num(a.issueAmount) - num(b.issueAmount));

  const payload = {
    ok: true,
    source: "CBAS",
    updatedAt: new Date().toISOString(),
    sourceCounts,
    excludedCounts: {
      veto: allCandidates.length - candidates.length,
    },
    scoringNote: "CBAS supplies CB source/issuance terms. CB technical gate uses Yahoo 60-minute K data: pass only when 60m close is above MA200 and MA200 is rising, or when 60m MA5/MA35/MA200 are all rising. Rows failing this 60m gate are excluded from display.",
    rows: candidates,
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`wrote ${OUT_FILE} (${candidates.length} rows)`);
  console.log(candidates.slice(0, 12).map((row) => `${row.score} ${row.sourceLayer} ${row.code} ${row.cbName} ${row.tags.join(" / ")}`).join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
