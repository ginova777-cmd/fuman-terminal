const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const repoRoot = path.resolve(__dirname, "..");
const runtimeRoot = process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const syncRoot = process.env.FUMAN_SYNC_DIR || "C:\\fuman-terminal-sync";

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload)}\n`, "utf8");
}

function writeToBoth(output, payload) {
  for (const root of [...new Set([repoRoot, runtimeRoot, syncRoot])]) {
    writeJson(path.join(root, output), payload);
  }
}

function hashPayload(payload) {
  return crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex").slice(0, 12);
}

function readOptional(rel, fallback = null) {
  for (const root of [runtimeRoot, repoRoot, syncRoot]) {
    const file = path.join(root, rel);
    if (fs.existsSync(file)) return readJson(file);
  }
  return fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function slimSignal(signal) {
  return {
    id: String(signal?.id || ""),
    title: String(signal?.title || ""),
    short: String(signal?.short || ""),
    icon: String(signal?.icon || ""),
    reason: String(signal?.reason || ""),
  };
}

function slimStrategy4(payload) {
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];
  return {
    ok: Boolean(payload?.ok ?? true),
    source: payload?.source || "strategy4-slim",
    updatedAt: payload?.updatedAt || "",
    scanStamp: payload?.scanStamp || "",
    total: cleanNumber(payload?.total),
    count: cleanNumber(payload?.count || matches.length),
    complete: Boolean(payload?.complete),
    scannedCount: Array.isArray(payload?.scannedCodes) ? payload.scannedCodes.length : cleanNumber(payload?.scannedCount),
    matches: matches.map((item) => ({
      code: String(item.code || ""),
      name: String(item.name || item.code || ""),
      close: cleanNumber(item.close),
      percent: cleanNumber(item.percent),
      tradeVolume: cleanNumber(item.tradeVolume),
      value: cleanNumber(item.value),
      swingScore: cleanNumber(item.swingScore || item.score),
      score: cleanNumber(item.swingScore || item.score),
      swingZone: item.swingZone || "A",
      swingStage: item.swingStage || item.stage || null,
      swingSignals: Array.isArray(item.swingSignals || item.signals)
        ? (item.swingSignals || item.signals).map(slimSignal)
        : [],
    })),
  };
}

function strategy4PresetFiles(payload) {
  const slim = slimStrategy4(payload);
  const matches = [...slim.matches];
  const base = {
    ok: slim.ok,
    source: "strategy4-preset",
    updatedAt: slim.updatedAt,
    scanStamp: slim.scanStamp,
    total: slim.total,
    complete: slim.complete,
  };
  const byScore = [...matches].sort((a, b) => cleanNumber(b.swingScore || b.score) - cleanNumber(a.swingScore || a.score));
  const zoneB = byScore.filter((item) => item.swingZone === "B");
  const zoneC = byScore.filter((item) => item.swingZone === "C");
  const zoneBPages = [];
  const zoneCPages = [];
  const pageSize = 25;
  for (let index = 0; index < zoneB.length; index += pageSize) {
    const page = Math.floor(index / pageSize) + 1;
    zoneBPages.push([`data/strategy4-zone-b-page-${page}.json`, {
      ...base,
      zone: "B",
      page,
      pageSize,
      totalPages: Math.ceil(zoneB.length / pageSize),
      totalCount: zoneB.length,
      count: Math.min(pageSize, zoneB.length - index),
      matches: zoneB.slice(index, index + pageSize),
    }]);
  }
  for (let index = 0; index < zoneC.length; index += pageSize) {
    const page = Math.floor(index / pageSize) + 1;
    zoneCPages.push([`data/strategy4-zone-c-page-${page}.json`, {
      ...base,
      zone: "C",
      page,
      pageSize,
      totalPages: Math.ceil(zoneC.length / pageSize),
      totalCount: zoneC.length,
      count: Math.min(pageSize, zoneC.length - index),
      matches: zoneC.slice(index, index + pageSize),
    }]);
  }
  return [
    ["data/strategy4-zone-a.json", { ...base, zone: "A", count: matches.filter((item) => (item.swingZone || "A") === "A").length, matches: byScore.filter((item) => (item.swingZone || "A") === "A") }],
    ["data/strategy4-zone-b.json", { ...base, zone: "B", count: matches.filter((item) => item.swingZone === "B").length, matches: byScore.filter((item) => item.swingZone === "B") }],
    ["data/strategy4-zone-c.json", { ...base, zone: "C", count: matches.filter((item) => item.swingZone === "C").length, matches: byScore.filter((item) => item.swingZone === "C") }],
    ["data/strategy4-score-top.json", { ...base, count: Math.min(120, byScore.length), matches: byScore.slice(0, 120) }],
    ...zoneBPages,
    ...zoneCPages,
  ];
}

function slimInstitution(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const slim = {};
  for (const [code, row] of Object.entries(data)) {
    slim[code] = {
      code,
      name: row?.name || code,
      close: cleanNumber(row?.close),
      change: cleanNumber(row?.change),
      percent: cleanNumber(row?.percent),
      tradeVolume: cleanNumber(row?.tradeVolume),
      value: cleanNumber(row?.value),
      foreign: cleanNumber(row?.foreign),
      trust: cleanNumber(row?.trust),
      dealer: cleanNumber(row?.dealer),
      total: cleanNumber(row?.total),
      foreignStreak: cleanNumber(row?.foreignStreak),
      trustStreak: cleanNumber(row?.trustStreak),
      jointStreak: cleanNumber(row?.jointStreak),
      fiveDayPctSum: cleanNumber(row?.fiveDayPctSum),
      fiveDayAvgVolume: cleanNumber(row?.fiveDayAvgVolume),
    };
  }
  return {
    ok: Boolean(payload?.ok ?? true),
    source: payload?.source || "institution-slim",
    updatedAt: payload?.updatedAt || "",
    usedDate: payload?.usedDate || "",
    quoteUpdatedAt: payload?.quoteUpdatedAt || "",
    count: cleanNumber(payload?.count || Object.keys(slim).length),
    data: slim,
  };
}

function institutionPresetFiles(payload) {
  const slim = slimInstitution(payload);
  const rows = Object.values(slim.data || {});
  const base = {
    ok: slim.ok,
    source: "institution-preset",
    updatedAt: slim.updatedAt,
    usedDate: slim.usedDate,
    quoteUpdatedAt: slim.quoteUpdatedAt,
  };
  const joint = [...rows].sort((a, b) => b.jointStreak - a.jointStreak || b.total - a.total).slice(0, 160);
  const foreign = [...rows].sort((a, b) => b.foreign - a.foreign).slice(0, 160);
  const trust = [...rows].sort((a, b) => b.trust - a.trust).slice(0, 160);
  return [
    ["data/institution-joint-top.json", { ...base, count: joint.length, rows: joint }],
    ["data/institution-foreign-top.json", { ...base, count: foreign.length, rows: foreign }],
    ["data/institution-trust-top.json", { ...base, count: trust.length, rows: trust }],
  ];
}

function slimWarrant(payload) {
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];
  return {
    ok: Boolean(payload?.ok ?? true),
    source: payload?.source || "warrant-flow-slim",
    updatedAt: payload?.updatedAt || "",
    count: cleanNumber(payload?.count || matches.length),
    matches: matches.map((item) => ({
      code: String(item.underlyingCode || item.code || ""),
      name: String(item.underlyingName || item.name || item.underlyingCode || item.code || ""),
      underlyingCode: String(item.underlyingCode || item.code || ""),
      underlyingName: String(item.underlyingName || item.name || ""),
      underlyingClose: cleanNumber(item.underlyingClose ?? item.close ?? item.stockClose),
      underlyingPercent: cleanNumber(item.underlyingPercent ?? item.percent ?? item.stockPercent),
      callValue: cleanNumber(item.callValue),
      putValue: cleanNumber(item.putValue),
      callCount: cleanNumber(item.callCount),
      putCount: cleanNumber(item.putCount),
      callPutRatio: cleanNumber(item.callPutRatio),
      score: cleanNumber(item.score),
      tradeDate: item.tradeDate || "",
      reason: item.reason || "",
    })),
  };
}

function warrantPresetFiles(payload) {
  const slim = slimWarrant(payload);
  const rows = [...slim.matches].sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score) || cleanNumber(b.callValue) - cleanNumber(a.callValue)).slice(0, 160);
  return [
    ["data/warrant-priority-top.json", {
      ok: slim.ok,
      source: "warrant-preset",
      updatedAt: slim.updatedAt,
      count: rows.length,
      matches: rows,
    }],
  ];
}


function slimStrategy2Enhancement(item) {
  return {
    at: String(item?.at || ""),
    price: cleanNumber(item?.price),
    score: cleanNumber(item?.score),
    deltaVolume: cleanNumber(item?.deltaVolume),
    totalVolume: cleanNumber(item?.totalVolume),
    trigger: String(item?.trigger || ""),
    strategy: String(item?.strategy || ""),
    reason: String(item?.reason || ""),
  };
}

function slimStrategy2Event(event) {
  const enhancements = Array.isArray(event?.enhancements) ? event.enhancements : [];
  return {
    code: String(event?.code || ""),
    name: String(event?.name || event?.code || ""),
    date: event?.date || "",
    firstBAt: event?.firstBAt || "",
    firstBPrice: cleanNumber(event?.firstBPrice),
    highAfterB: cleanNumber(event?.highAfterB),
    highAfterBAt: event?.highAfterBAt || "",
    firstAAt: event?.firstAAt || "",
    firstAPrice: cleanNumber(event?.firstAPrice),
    firstTradableAAt: event?.firstTradableAAt || "",
    firstTradableAPrice: cleanNumber(event?.firstTradableAPrice),
    latestAAt: event?.latestAAt || "",
    latestAPrice: cleanNumber(event?.latestAPrice),
    latestBAt: event?.latestBAt || "",
    latestBPrice: cleanNumber(event?.latestBPrice),
    latestSeenAt: event?.latestSeenAt || "",
    latestSeenPrice: cleanNumber(event?.latestSeenPrice),
    highAfterA: cleanNumber(event?.highAfterA),
    highAfterAAt: event?.highAfterAAt || "",
    highestPrice: cleanNumber(event?.highestPrice),
    highestAt: event?.highestAt || "",
    stateId: event?.stateId || "",
    stateLabel: event?.stateLabel || "",
    signalId: event?.signalId || event?.latestRecord?.signalId || "",
    latestState: event?.latestState || "",
    maxScore: cleanNumber(event?.maxScore),
    strategies: Array.isArray(event?.strategies) ? event.strategies.slice(0, 8).map(String) : [],
    ma35: cleanNumber(event?.ma35 || event?.latestRecord?.ma35),
    ma35Prev: cleanNumber(event?.ma35Prev || event?.latestRecord?.ma35Prev),
    aboveMa35: event?.aboveMa35 === true || event?.latestRecord?.aboveMa35 === true,
    ma35TrendUp: event?.ma35TrendUp === true || event?.latestRecord?.ma35TrendUp === true,
    ma35Source: event?.ma35Source || event?.latestRecord?.ma35Source || "",
    ma35At: event?.ma35At || event?.latestRecord?.ma35At || "",
    ma35Symbol: event?.ma35Symbol || event?.latestRecord?.ma35Symbol || "",
    macdUp: event?.macdUp === true || event?.latestRecord?.macdUp === true,
    kdUp: event?.kdUp === true || event?.latestRecord?.kdUp === true,
    intradayVolumeBurst: event?.intradayVolumeBurst === true || event?.latestRecord?.intradayVolumeBurst === true,
    latestRecord: event?.latestRecord ? slimStrategy2Record(event.latestRecord) : undefined,
    enhancements: enhancements.slice(-8).map(slimStrategy2Enhancement),
    stateReason: event?.stateReason || "",
    supportPrice: cleanNumber(event?.supportPrice),
  };
}

function slimStrategy2Record(record) {
  return {
    code: String(record?.code || ""),
    name: String(record?.name || record?.code || ""),
    date: record?.date || "",
    timestamp: record?.timestamp || "",
    entryAt: record?.entryAt || "",
    firstAAt: record?.firstAAt || "",
    firstBAt: record?.firstBAt || "",
    stateId: record?.stateId || "",
    stateLabel: record?.stateLabel || "",
    signalId: record?.signalId || record?.signal?.id || "",
    entryPrice: cleanNumber(record?.entryPrice),
    observedPrice: cleanNumber(record?.observedPrice),
    close: cleanNumber(record?.close),
    observedHigh: cleanNumber(record?.observedHigh),
    observedHighAt: record?.observedHighAt || "",
    percent: cleanNumber(record?.percent),
    volume: cleanNumber(record?.volume),
    tradeVolume: cleanNumber(record?.tradeVolume),
    deltaVolume: cleanNumber(record?.deltaVolume),
    score: cleanNumber(record?.score),
    strategy: record?.strategy || "",
    reason: record?.reason || "",
    stateReason: record?.stateReason || "",
    supportPrice: cleanNumber(record?.supportPrice),
    sourceCoverage: cleanNumber(record?.sourceCoverage),
    sourceCoverageHealthy: record?.sourceCoverageHealthy === true,
    ma35: cleanNumber(record?.ma35),
    ma35Prev: cleanNumber(record?.ma35Prev),
    aboveMa35: Boolean(record?.aboveMa35),
    ma35TrendUp: Boolean(record?.ma35TrendUp),
    ma35Source: record?.ma35Source || "",
    ma35At: record?.ma35At || "",
    ma35Symbol: record?.ma35Symbol || "",
    ma35Attempts: cleanNumber(record?.ma35Attempts),
    macdDif: cleanNumber(record?.macdDif),
    macdSignal: cleanNumber(record?.macdSignal),
    macdHist: cleanNumber(record?.macdHist),
    macdUp: record?.macdUp === true,
    kdK: cleanNumber(record?.kdK),
    kdD: cleanNumber(record?.kdD),
    kdUp: record?.kdUp === true,
    intradayVolumeBurst: record?.intradayVolumeBurst === true,
  };
}


function strategy2RecordSortTime(record) {
  return String(record?.timestamp || record?.entryAt || record?.firstAAt || record?.firstBAt || "");
}
function slimStrategy2(payload) {
  const events = Array.isArray(payload?.events) ? payload.events.map(slimStrategy2Event).filter((event) => event.code) : [];
  const latestByCode = new Map();
  (Array.isArray(payload?.records) ? payload.records : []).forEach((record) => {
    const code = String(record?.code || "");
    if (!code) return;
    const current = latestByCode.get(code);
    if (!current || strategy2RecordSortTime(record).localeCompare(strategy2RecordSortTime(current)) >= 0) {
      latestByCode.set(code, record);
    }
  });
  const records = [...latestByCode.values()]
    .sort((a, b) => strategy2RecordSortTime(b).localeCompare(strategy2RecordSortTime(a)) || String(a.code || "").localeCompare(String(b.code || "")))
    .map(slimStrategy2Record)
    .filter((record) => record.code);
  return {
    source: payload?.source || "strategy2-intraday-slim",
    profile: "strategy2-fast-slim",
    date: payload?.date || "",
    updatedAt: payload?.updatedAt || "",
    realtime: {
      requested: cleanNumber(payload?.realtime?.requested),
      received: cleanNumber(payload?.realtime?.received),
      failed: cleanNumber(payload?.realtime?.failed),
      usable: cleanNumber(payload?.realtime?.usable),
      coverage: cleanNumber(payload?.realtime?.coverage),
      coverageBeforeRescue: cleanNumber(payload?.realtime?.coverageBeforeRescue),
      coverageAfterRescue: cleanNumber(payload?.realtime?.coverageAfterRescue),
      cachedRecovered: cleanNumber(payload?.realtime?.cachedRecovered),
      entrySourceHealthy: payload?.realtime?.entrySourceHealthy === true,
      entrySourceCoverageThreshold: cleanNumber(payload?.realtime?.entrySourceCoverageThreshold),
      skippedPartialCoverage: payload?.realtime?.skippedPartialCoverage === true,
    },
    records,
    events,
    entryCount: cleanNumber(payload?.entryCount),
    aCount: cleanNumber(payload?.aCount),
    bOnlyCount: cleanNumber(payload?.bOnlyCount),
    slim: {
      generatedAt: new Date().toISOString(),
      sourceRecords: Array.isArray(payload?.records) ? payload.records.length : 0,
      records: records.length,
      events: events.length,
      enhancementLimit: 8,
    },
  };
}

function buildStrategy2Top(payload, options = {}) {
  const slim = slimStrategy2(payload);
  const rankTime = (item) => strategy2RecordSortTime(item).replace(/[^0-9: -]/g, "");
  const eventLimit = options.eventLimit || 50;
  const recordLimit = options.recordLimit || 70;
  const source = options.source || "strategy2-mobile-top";
  const rankEvents = (items) => [...items]
    .sort((a, b) => cleanNumber(b.maxScore) - cleanNumber(a.maxScore) || rankTime(b).localeCompare(rankTime(a)));
  const entryEvents = rankEvents(slim.events.filter((event) => event.stateId === "entry" || event.stateId === "go"));
  const watchEvents = rankEvents(slim.events.filter((event) => !(event.stateId === "entry" || event.stateId === "go")));
  const events = [...entryEvents, ...watchEvents].slice(0, Math.max(eventLimit, entryEvents.length));
  const eventCodes = new Set(events.map((event) => event.code));
  const records = [
    ...slim.records.filter((record) => eventCodes.has(record.code)),
    ...slim.records.filter((record) => !eventCodes.has(record.code)).slice(0, Math.max(0, recordLimit - eventCodes.size)),
  ].slice(0, recordLimit);
  return {
    ...slim,
    source,
    profile: source,
    records,
    events,
    count: events.length,
  };
}

function topStrategy2(payload) {
  return buildStrategy2Top(payload, { source: "strategy2-mobile-top", eventLimit: 50, recordLimit: 70 });
}

function liveTopStrategy2(payload) {
  return buildStrategy2Top(payload, { source: "strategy2-mobile-live-top", eventLimit: 28, recordLimit: 40 });
}

function deltaStrategy2(payload) {
  const slim = slimStrategy2(payload);
  const events = [...slim.events]
    .sort((a, b) => strategy2RecordSortTime(b).localeCompare(strategy2RecordSortTime(a)) || cleanNumber(b.maxScore) - cleanNumber(a.maxScore))
    .slice(0, 24);
  const codes = new Set(events.map((event) => event.code));
  return {
    ok: true,
    source: "strategy2-intraday-delta",
    date: slim.date,
    updatedAt: slim.updatedAt,
    since: slim.updatedAt,
    count: events.length,
    events,
    records: slim.records.filter((record) => codes.has(record.code)).slice(0, 32),
  };
}

function mobileInstitutionTop(payload) {
  const slim = slimInstitution(payload);
  const rows = Object.values(slim.data || {})
    .sort((a, b) => b.jointStreak - a.jointStreak || b.total - a.total || b.trust - a.trust)
    .slice(0, 50);
  return {
    ok: slim.ok,
    source: "institution-mobile-top",
    updatedAt: slim.updatedAt,
    usedDate: slim.usedDate,
    quoteUpdatedAt: slim.quoteUpdatedAt,
    count: rows.length,
    rows,
  };
}

function mobileWarrantTop(payload) {
  const preset = warrantPresetFiles(payload)[0]?.[1] || { matches: [] };
  const rows = (preset.matches || []).slice(0, 50);
  return {
    ok: Boolean(payload?.ok ?? true),
    source: "warrant-flow-mobile-top",
    updatedAt: payload?.updatedAt || "",
    count: rows.length,
    matches: rows,
  };
}

function mobileHomeSummary() {
  const market = readOptional("data/market-summary.json", {});
  const health = readOptional("data/health-summary.json", {});
  const strategy2 = readOptional("data/strategy2-intraday-live-top.json", readOptional("data/strategy2-intraday-top.json", {}));
  const chip = readOptional("data/institution-mobile-top.json", {});
  const warrant = readOptional("data/warrant-flow-mobile-top.json", {});
  return {
    source: "mobile-home-summary",
    updatedAt: new Date().toISOString(),
    market: {
      updatedAt: market?.updatedAt || "",
      sample: cleanNumber(market?.sample),
      up: cleanNumber(market?.up),
      down: cleanNumber(market?.down),
      flat: cleanNumber(market?.flat),
      strongSectors: (market?.strongSectors || []).slice(0, 5),
      weakSectors: (market?.weakSectors || []).slice(0, 5),
    },
    health: {
      risk: health?.risk || health?.status || "",
      high: cleanNumber(health?.highRiskCount || health?.high),
      medium: cleanNumber(health?.mediumRiskCount || health?.medium),
      low: cleanNumber(health?.lowRiskCount || health?.low),
      updatedAt: health?.updatedAt || "",
    },
    strategy2: {
      updatedAt: strategy2?.updatedAt || "",
      count: cleanNumber(strategy2?.count || strategy2?.events?.length),
      top: (strategy2?.events || []).slice(0, 8).map((item) => ({
        code: item.code,
        name: item.name,
        latestAAt: item.latestAAt,
        latestSeenAt: item.latestSeenAt,
        maxScore: item.maxScore,
        strategies: (item.strategies || []).slice(0, 3),
      })),
    },
    chip: {
      updatedAt: chip?.updatedAt || "",
      count: cleanNumber(chip?.count || chip?.rows?.length),
      top: (chip?.rows || []).slice(0, 8),
    },
    warrant: {
      updatedAt: warrant?.updatedAt || "",
      count: cleanNumber(warrant?.count || warrant?.matches?.length),
      top: (warrant?.matches || []).slice(0, 8),
    },
  };
}

function slimStocks() {
  const existing = readOptional("data/stocks-slim.json", null);
  if (cleanNumber(existing?.count) >= 500 && normalizeArray(existing?.stocks).length >= 500) {
    return existing;
  }
  const market = readOptional("data/market-summary.json", {});
  const rows = normalizeArray(market?.stocks).map((stock) => {
    const close = cleanNumber(stock.close || stock.ClosingPrice);
    const change = cleanNumber(stock.change || stock.Change);
    const previous = close - change;
    return {
      code: String(stock.code || stock.Code || ""),
      name: String(stock.name || stock.Name || stock.code || stock.Code || ""),
      close,
      change,
      percent: cleanNumber(stock.percent) || (previous ? (change / previous) * 100 : 0),
      value: cleanNumber(stock.value || stock.TradeValue),
      tradeVolume: cleanNumber(stock.tradeVolume || stock.TradeVolume),
      quoteDate: market?.resolvedTradeDate || stock.quoteDate || "",
    };
  }).filter((stock) => stock.code && stock.name && stock.close);
  return {
    ok: rows.length > 0,
    source: "stocks-slim",
    updatedAt: market?.updatedAt || new Date().toISOString(),
    resolvedTradeDate: market?.resolvedTradeDate || market?.marketDates?.twse || "",
    today: market?.today || "",
    count: rows.length,
    stocks: rows,
  };
}

function stocksIndexFiles(payload = slimStocks()) {
  const stocks = normalizeArray(payload?.stocks);
  const index = stocks.map((stock) => ({
    code: String(stock.code || stock.Code || ""),
    name: String(stock.name || stock.Name || stock.code || stock.Code || ""),
    market: String(stock.market || stock.Market || ""),
  })).filter((stock) => stock.code && stock.name);
  const quotes = stocks.map((stock) => ({
    code: String(stock.code || stock.Code || ""),
    close: cleanNumber(stock.close || stock.ClosingPrice),
    change: cleanNumber(stock.change || stock.Change),
    percent: cleanNumber(stock.percent || stock.Percent),
    tradeVolume: cleanNumber(stock.tradeVolume || stock.TradeVolume || stock.volume),
    value: cleanNumber(stock.value || stock.TradeValue),
    quoteDate: stock.quoteDate || stock.tradeDate || stock.TradeDate || "",
  })).filter((stock) => stock.code && stock.close);
  const mobileQuotes = [...quotes]
    .sort((a, b) => cleanNumber(b.value) - cleanNumber(a.value))
    .slice(0, 360);
  const base = {
    ok: Boolean(payload?.ok ?? true),
    updatedAt: payload?.updatedAt || new Date().toISOString(),
    today: payload?.today || "",
    resolvedTradeDate: payload?.resolvedTradeDate || "",
    sourceTradeDate: payload?.sourceTradeDate || "",
  };
  return [
    ["data/stocks-index.json", { ...base, source: "stocks-index", count: index.length, stocks: index }],
    ["data/stocks-quotes-slim.json", { ...base, source: "stocks-quotes-slim", count: quotes.length, quotes }],
    ["data/stocks-quotes-mobile-top.json", { ...base, source: "stocks-quotes-mobile-top", count: mobileQuotes.length, quotes: mobileQuotes }],
  ];
}

function dataStatusIndex() {
  const files = [
    "market-summary.json",
    "health-summary.json",
    "mobile-home-summary.json",
    "stocks-slim.json",
    "stocks-index.json",
    "stocks-quotes-slim.json",
    "stocks-quotes-mobile-top.json",
    "strategy-match-index.json",
    "open-buy-latest.json",
    "strategy2-intraday-latest.json",
    "strategy3-latest.json",
    "strategy4-summary.json",
    "strategy4-slim.json",
    "strategy4-score-top.json",
    "strategy4-zone-b-page-1.json",
    "strategy5-latest.json",
    "institution-latest.json",
    "institution-slim.json",
    "institution-mobile-top.json",
    "cb-detect-latest.json",
    "warrant-flow-slim.json",
    "warrant-flow-mobile-top.json",
    "realtime-radar-latest.json",
  ];
  const entries = {};
  for (const file of files) {
    const payload = readOptional(`data/${file}`, {});
    const rows = normalizeArray(payload?.matches).length || normalizeArray(payload?.rows).length || normalizeArray(payload?.stocks).length || cleanNumber(payload?.count);
    entries[file] = {
      ok: payload?.ok !== false,
      status: payload?.status || "",
      source: payload?.source || "",
      date: payload?.usedDate || payload?.date || payload?.tradeDate || payload?.resolvedTradeDate || payload?.scanStamp || "",
      updatedAt: payload?.updatedAt || payload?.scanStamp || "",
      count: rows,
    };
  }
  return {
    ok: true,
    source: "data-status-index",
    updatedAt: new Date().toISOString(),
    entries,
  };
}

function dataManifest() {
  const files = [
    "market-summary.json",
    "mobile-home-summary.json",
    "terminal-home-bundle.json",
    "data-status-index.json",
    "stocks-slim.json",
    "stocks-index.json",
    "stocks-quotes-slim.json",
    "stocks-quotes-mobile-top.json",
    "strategy-match-index.json",
    "open-buy-latest.json",
    "strategy2-intraday-slim.json",
    "strategy2-intraday-top.json",
    "strategy2-intraday-live-top.json",
    "strategy3-latest.json",
    "strategy4-summary.json",
    "strategy4-score-top.json",
  "strategy4-zone-a.json",
  "strategy4-zone-b.json",
    "strategy4-zone-c.json",
    "strategy5-latest.json",
    "institution-latest.json",
    "institution-slim.json",
    "institution-mobile-top.json",
    "cb-detect-latest.json",
    "warrant-flow-slim.json",
    "warrant-flow-mobile-top.json",
    "health-summary.json",
    "signal-quality-report.json",
    "data-quality-report.json",
    "data-consistency-report.json",
    "strategy-weight-report.json",
  ];
  for (let page = 1; page <= 48; page += 1) files.push(`strategy4-zone-b-page-${page}.json`);
  for (let page = 1; page <= 48; page += 1) files.push(`strategy4-zone-c-page-${page}.json`);
  const entries = {};
  for (const file of files) {
    const payload = readOptional(`data/${file}`, null);
    if (!payload) continue;
    const json = JSON.stringify(payload);
    entries[file] = {
      hash: crypto.createHash("sha1").update(json).digest("hex").slice(0, 12),
      bytes: Buffer.byteLength(json),
      updatedAt: payload?.updatedAt || payload?.scanStamp || "",
      date: payload?.usedDate || payload?.date || payload?.tradeDate || payload?.resolvedTradeDate || payload?.scanStamp || "",
      count: cleanNumber(payload?.count || normalizeArray(payload?.matches).length || normalizeArray(payload?.rows).length || normalizeArray(payload?.stocks).length || normalizeArray(payload?.quotes).length),
    };
  }
  return {
    ok: true,
    source: "data-manifest",
    updatedAt: new Date().toISOString(),
    count: Object.keys(entries).length,
    entries,
  };
}

function terminalHomeBundle() {
  const mobile = readOptional("data/mobile-home-summary.json", mobileHomeSummary());
  const status = readOptional("data/data-status-index.json", dataStatusIndex());
  const stocks = readOptional("data/stocks-slim.json", slimStocks());
  const strategy4Top = readOptional("data/strategy4-score-top.json", {});
  const openBuy = readOptional("data/open-buy-latest.json", {});
  const strategy3 = readOptional("data/strategy3-latest.json", {});
  const strategy5 = readOptional("data/strategy5-latest.json", {});
  return {
    ok: true,
    source: "terminal-home-bundle",
    updatedAt: new Date().toISOString(),
    mobile,
    status,
    stocks: {
      updatedAt: stocks.updatedAt || "",
      resolvedTradeDate: stocks.resolvedTradeDate || "",
      count: cleanNumber(stocks.count),
      top: normalizeArray(stocks.stocks).slice(0, 80),
    },
    strategies: {
      openBuy: {
        updatedAt: openBuy?.updatedAt || "",
        date: openBuy?.usedDate || openBuy?.date || "",
        count: cleanNumber(openBuy?.count || normalizeArray(openBuy?.matches).length),
        top: normalizeArray(openBuy?.matches).slice(0, 12),
      },
      strategy3: {
        updatedAt: strategy3?.updatedAt || "",
        date: strategy3?.usedDate || strategy3?.date || "",
        count: cleanNumber(strategy3?.count || normalizeArray(strategy3?.matches).length),
        top: normalizeArray(strategy3?.matches).slice(0, 12),
      },
      strategy4: {
        updatedAt: strategy4Top?.updatedAt || "",
        date: strategy4Top?.scanStamp || strategy4Top?.date || "",
        count: cleanNumber(strategy4Top?.count || normalizeArray(strategy4Top?.matches).length),
        top: normalizeArray(strategy4Top?.matches).slice(0, 24),
      },
      strategy5: {
        updatedAt: strategy5?.updatedAt || "",
        date: strategy5?.usedDate || strategy5?.date || "",
        count: cleanNumber(strategy5?.count || normalizeArray(strategy5?.matches).length),
        top: normalizeArray(strategy5?.matches).slice(0, 12),
      },
    },
  };
}

function signalText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return String(value.short || value.label || value.title || value.name || value.reason || value.strategy || value.id || "").trim();
}

function indexDetails(row, key) {
  const sources = {
    openBuy: [row.setup, row.status, row.reason],
    strategy2: [
      row.strategy,
      row.stateLabel,
      row.stateReason,
      ...normalizeArray(row.strategies).map(signalText),
      ...normalizeArray(row.intradaySignals).map(signalText),
    ],
    strategy3: [row.setup, row.status, row.reason, ...normalizeArray(row.matches).map(signalText)],
    strategy4: [
      row.strategyLabel,
      row.swingZone ? `分區${row.swingZone}` : "",
      ...normalizeArray(row.signals).map(signalText),
      ...normalizeArray(row.swingSignals).map(signalText),
    ],
    strategy5: [
      signalText(row.activeMatch),
      ...normalizeArray(row.matches).map(signalText),
    ],
    realtime: [
      row.signal,
      row.reason,
      ...normalizeArray(row.signalTags).map(signalText),
    ],
  };
  return [...new Set((sources[key] || []).map(signalText).map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 5);
}

function buildStrategyMatchIndex() {
  const definitions = [
    { key: "openBuy", label: "策略1-明日開盤入", file: "data/open-buy-latest.json", fields: ["matches"] },
    { key: "strategy2", label: "策略2-當沖雷達", file: "data/strategy2-intraday-slim.json", fallbackFile: "data/strategy2-intraday-top.json", fields: ["events", "records"] },
    { key: "strategy3", label: "策略3-隔日沖", file: "data/strategy3-latest.json", fields: ["matches"] },
    { key: "strategy4", label: "策略4-波段", file: "data/strategy4-slim.json", fields: ["matches"] },
    { key: "strategy5", label: "策略5-綜合策略", file: "data/strategy5-latest.json", fields: ["matches"] },
    { key: "realtime", label: "即時雷達", file: "data/realtime-radar-latest.json", fields: ["rows"] },
  ];
  const byCode = {};
  const strategies = {};
  for (const def of definitions) {
    const payload = readOptional(def.file, def.fallbackFile ? readOptional(def.fallbackFile, {}) : {});
    const rows = def.fields.flatMap((field) => normalizeArray(payload?.[field])).filter((row) => row?.code);
    const date = payload?.usedDate || payload?.date || payload?.tradeDate || payload?.scanStamp || payload?.updatedAt || "";
    strategies[def.key] = {
      label: def.label,
      file: def.file,
      date,
      updatedAt: payload?.updatedAt || payload?.scanStamp || "",
      count: rows.length,
    };
    for (const row of rows) {
      const code = String(row.code || "").trim();
      if (!code) continue;
      const entry = {
        key: def.key,
        label: def.label,
        score: cleanNumber(row.score || row.maxScore || row.swingScore),
        date,
        updatedAt: payload?.updatedAt || payload?.scanStamp || row.updatedAt || "",
        details: indexDetails(row, def.key),
      };
      if (!byCode[code]) byCode[code] = [];
      byCode[code].push(entry);
    }
  }
  for (const entries of Object.values(byCode)) {
    entries.sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score) || a.key.localeCompare(b.key));
  }
  return {
    ok: true,
    source: "strategy-match-index",
    updatedAt: new Date().toISOString(),
    count: Object.keys(byCode).length,
    strategies,
    byCode,
  };
}
const jobs = [
  ["strategy2", "data/strategy2-intraday-latest.json", "data/strategy2-intraday-slim.json", slimStrategy2, (payload) => [
    ["data/strategy2-intraday-top.json", topStrategy2(payload)],
    ["data/strategy2-intraday-live-top.json", liveTopStrategy2(payload)],
    ["data/strategy2-intraday-delta.json", deltaStrategy2(payload)],
  ]],
  ["strategy4", "data/strategy4-latest.json", "data/strategy4-slim.json", slimStrategy4, strategy4PresetFiles],
  ["institution", "data/institution-latest.json", "data/institution-slim.json", slimInstitution, (payload) => [...institutionPresetFiles(payload), ["data/institution-mobile-top.json", mobileInstitutionTop(payload)]]],
  ["warrant", "data/warrant-flow-latest.json", "data/warrant-flow-slim.json", slimWarrant, (payload) => [...warrantPresetFiles(payload), ["data/warrant-flow-mobile-top.json", mobileWarrantTop(payload)]]],
];

let wrote = 0;
for (const [name, input, output, build, presets] of jobs) {
  const candidates = [
    path.join(runtimeRoot, input),
    path.join(repoRoot, input),
  ];
  const source = candidates.find((file) => fs.existsSync(file));
  if (!source) {
    console.log(`[slim] skip ${name}: source not found`);
    continue;
  }
  const payload = build(readJson(source));
  writeToBoth(output, payload);
  for (const [presetOutput, presetPayload] of presets(readJson(source))) {
    writeToBoth(presetOutput, presetPayload);
    console.log(`[slim] wrote ${presetOutput} count=${presetPayload.count || presetPayload.rows?.length || presetPayload.matches?.length || 0}`);
  }
  wrote += 1;
  console.log(`[slim] wrote ${output} count=${payload.count || Object.keys(payload.data || {}).length}`);
}

if (wrote) {
  const mobileSummary = mobileHomeSummary();
  writeToBoth("data/mobile-home-summary.json", mobileSummary);
  console.log(`[slim] wrote data/mobile-home-summary.json strategy2=${mobileSummary.strategy2.count || 0} chip=${mobileSummary.chip.count || 0} warrant=${mobileSummary.warrant.count || 0}`);
  const stocksSlim = slimStocks();
  writeToBoth("data/stocks-slim.json", stocksSlim);
  console.log(`[slim] wrote data/stocks-slim.json count=${stocksSlim.count || 0}`);
  for (const [stockOutput, stockPayload] of stocksIndexFiles(stocksSlim)) {
    writeToBoth(stockOutput, stockPayload);
    console.log(`[slim] wrote ${stockOutput} count=${stockPayload.count || 0}`);
  }
  const strategyMatchIndex = buildStrategyMatchIndex();
  writeToBoth("data/strategy-match-index.json", strategyMatchIndex);
  console.log(`[slim] wrote data/strategy-match-index.json codes=${strategyMatchIndex.count || 0}`);
  const statusIndex = dataStatusIndex();
  writeToBoth("data/data-status-index.json", statusIndex);
  console.log(`[slim] wrote data/data-status-index.json files=${Object.keys(statusIndex.entries || {}).length}`);
  const homeBundle = terminalHomeBundle();
  writeToBoth("data/terminal-home-bundle.json", homeBundle);
  console.log(`[slim] wrote data/terminal-home-bundle.json stocks=${homeBundle.stocks.count || 0}`);
  const manifest = dataManifest();
  writeToBoth("data/data-manifest.json", manifest);
  console.log(`[slim] wrote data/data-manifest.json files=${manifest.count || 0}`);
}
if (!wrote) process.exitCode = 1;
