const fs = require("fs");
const path = require("path");

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
  return [
    ["data/strategy4-zone-a.json", { ...base, zone: "A", count: matches.filter((item) => (item.swingZone || "A") === "A").length, matches: byScore.filter((item) => (item.swingZone || "A") === "A") }],
    ["data/strategy4-zone-b.json", { ...base, zone: "B", count: matches.filter((item) => item.swingZone === "B").length, matches: byScore.filter((item) => item.swingZone === "B") }],
    ["data/strategy4-zone-c.json", { ...base, zone: "C", count: matches.filter((item) => item.swingZone === "C").length, matches: byScore.filter((item) => item.swingZone === "C") }],
    ["data/strategy4-score-top.json", { ...base, count: Math.min(120, byScore.length), matches: byScore.slice(0, 120) }],
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
      percent: cleanNumber(row?.percent),
      value: cleanNumber(row?.value),
      foreign: cleanNumber(row?.foreign),
      trust: cleanNumber(row?.trust),
      dealer: cleanNumber(row?.dealer),
      total: cleanNumber(row?.total),
      foreignStreak: cleanNumber(row?.foreignStreak),
      trustStreak: cleanNumber(row?.trustStreak),
      jointStreak: cleanNumber(row?.jointStreak),
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
    latestState: event?.latestState || "",
    maxScore: cleanNumber(event?.maxScore),
    strategies: Array.isArray(event?.strategies) ? event.strategies.slice(0, 8).map(String) : [],
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
    ma35: cleanNumber(record?.ma35),
    ma35Prev: cleanNumber(record?.ma35Prev),
    aboveMa35: Boolean(record?.aboveMa35),
    ma35TrendUp: Boolean(record?.ma35TrendUp),
    ma35Source: record?.ma35Source || "",
    ma35At: record?.ma35At || "",
    ma35Symbol: record?.ma35Symbol || "",
    ma35Attempts: cleanNumber(record?.ma35Attempts),
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

function topStrategy2(payload) {
  const slim = slimStrategy2(payload);
  const rankTime = (item) => strategy2RecordSortTime(item).replace(/[^0-9: -]/g, "");
  const events = [...slim.events]
    .sort((a, b) => cleanNumber(b.maxScore) - cleanNumber(a.maxScore) || rankTime(b).localeCompare(rankTime(a)))
    .slice(0, 50);
  const eventCodes = new Set(events.map((event) => event.code));
  const records = [
    ...slim.records.filter((record) => eventCodes.has(record.code)),
    ...slim.records.filter((record) => !eventCodes.has(record.code)).slice(0, 20),
  ].slice(0, 70);
  return {
    ...slim,
    source: "strategy2-mobile-top",
    profile: "strategy2-mobile-top",
    records,
    events,
    count: events.length,
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
  const readOptional = (rel, fallback = null) => {
    for (const root of [runtimeRoot, repoRoot, syncRoot]) {
      const file = path.join(root, rel);
      if (fs.existsSync(file)) return readJson(file);
    }
    return fallback;
  };
  const market = readOptional("data/market-summary.json", {});
  const health = readOptional("data/health-summary.json", {});
  const strategy2 = readOptional("data/strategy2-intraday-top.json", {});
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
const jobs = [
  ["strategy2", "data/strategy2-intraday-latest.json", "data/strategy2-intraday-slim.json", slimStrategy2, (payload) => [["data/strategy2-intraday-top.json", topStrategy2(payload)]]],
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
}
if (!wrote) process.exitCode = 1;



