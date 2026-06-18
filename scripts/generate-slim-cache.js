const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { upsertSnapshot } = require("../lib/supabase-snapshots");
const { fetchMisQuotes } = require("../lib/mis-quotes");

const repoRoot = path.resolve(__dirname, "..");
const runtimeRoot = process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const syncRoot = process.env.FUMAN_SYNC_DIR || "C:\\fuman-terminal-sync";
const deployRoot = process.env.FUMAN_DEPLOY_DIR || "C:\\fuman-terminal";
const STRATEGY4_MIN_AVG_VOLUME_5 = 3000;
const STRATEGY4_API_ONLY = true;
const OPEN_BUY_API_ONLY = true;
const DESKTOP_API_ONLY_STATIC_OUTPUT = true;

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(tempFile, `${JSON.stringify(payload)}\n`, "utf8");
  fs.renameSync(tempFile, file);
}

function dataRoots(order = "runtime-first") {
  const roots = order === "repo-first"
    ? [repoRoot, syncRoot, runtimeRoot, deployRoot]
    : [runtimeRoot, deployRoot, repoRoot, syncRoot];
  return [...new Set(roots.filter(Boolean))];
}

function isStrategy4StaticOutput(output) {
  return /^data[\\/]+strategy4.*\.json$/i.test(String(output || ""));
}

function isOpenBuyStaticOutput(output) {
  return /^data[\\/]+open-buy.*\.json$/i.test(String(output || ""));
}

function isDesktopApiOnlyStaticOutput(output) {
  return /^data[\\/]+(?:strategy2-intraday|strategy3|strategy5|institution|warrant-flow|warrant-priority|warrant-single-signal|cb-detect).*\.json$/i.test(String(output || ""));
}

function writeToBoth(output, payload) {
  if (STRATEGY4_API_ONLY && isStrategy4StaticOutput(output)) {
    console.log(`strategy4 API-only: skipped static slim output ${output}`);
    return;
  }
  if (OPEN_BUY_API_ONLY && isOpenBuyStaticOutput(output)) {
    console.log(`open-buy API-only: skipped static slim output ${output}`);
    return;
  }
  if (DESKTOP_API_ONLY_STATIC_OUTPUT && isDesktopApiOnlyStaticOutput(output)) {
    console.log(`desktop API-only: skipped static slim output ${output}`);
    return;
  }
  for (const root of dataRoots("repo-first")) {
    writeJson(path.join(root, output), payload);
  }
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(tempFile, text, "utf8");
  fs.renameSync(tempFile, file);
}

function writeTextToBoth(output, text) {
  for (const root of dataRoots("repo-first")) {
    writeText(path.join(root, output), text);
  }
}

function clearDirInAllRoots(output) {
  for (const root of dataRoots("repo-first")) {
    const target = path.join(root, output);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function payloadFreshness(payload, file) {
  const candidates = [
    payload?.updatedAt,
    payload?.generatedAt,
    payload?.scanStamp,
    payload?.asOf,
    payload?.generatedDate,
    payload?.usedDate,
    payload?.date,
  ];
  for (const value of candidates) {
    if (!value) continue;
    const text = String(value);
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) return parsed;
    const compact = text.replace(/\D/g, "");
    if (compact.length >= 8) {
      const y = compact.slice(0, 4);
      const m = compact.slice(4, 6);
      const d = compact.slice(6, 8);
      const ymd = Date.parse(`${y}-${m}-${d}T00:00:00+08:00`);
      if (Number.isFinite(ymd)) return ymd;
    }
  }
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function hashPayload(payload) {
  return crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex").slice(0, 12);
}

function readOptional(rel, fallback = null) {
  let freshest = null;
  for (const root of dataRoots("runtime-first")) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const payload = readJson(file);
    const freshness = payloadFreshness(payload, file);
    if (!freshest || freshness > freshest.freshness) {
      freshest = { payload, freshness };
    }
  }
  if (freshest) return freshest.payload;
  return fallback;
}

function readRepoOptional(rel, fallback = null) {
  for (const root of dataRoots("repo-first")) {
    const file = path.join(root, rel);
    if (fs.existsSync(file)) return readJson(file);
  }
  return fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function indexRowsFromPayload(payload, def) {
  return def.fields.flatMap((field) => {
    const value = payload?.[field];
    if (def.objectFields?.includes(field) && value && typeof value === "object" && !Array.isArray(value)) {
      return Object.values(value);
    }
    return normalizeArray(value);
  }).filter((row) => {
    const codeField = def.codeField || "code";
    return row?.[codeField] || row?.code;
  });
}

function payloadCount(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload?.matches)) return payload.matches.length;
  if (Array.isArray(payload?.events)) return payload.events.length;
  if (Array.isArray(payload?.records)) return payload.records.length;
  if (Array.isArray(payload?.rows)) return payload.rows.length;
  if (Array.isArray(payload?.data)) return payload.data.length;
  if (Array.isArray(payload?.stocks)) return payload.stocks.length;
  if (Array.isArray(payload?.quotes)) return payload.quotes.length;
  if (Array.isArray(payload?.sectors)) return payload.sectors.length;
  if (payload?.entries && typeof payload.entries === "object") return Object.keys(payload.entries).length;
  return cleanNumber(payload?.count || payload?.total || payload?.matchCount || payload?.sectorCount);
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
  const matches = Array.isArray(payload?.matches)
    ? payload.matches.filter((item) => !cleanNumber(item.avgVolume5) || cleanNumber(item.avgVolume5) >= STRATEGY4_MIN_AVG_VOLUME_5)
    : [];
  return {
    ok: Boolean(payload?.ok ?? true),
    source: payload?.source || "strategy4-slim",
    updatedAt: payload?.updatedAt || "",
    scanStamp: payload?.scanStamp || "",
    total: cleanNumber(payload?.total),
    count: matches.length,
    complete: Boolean(payload?.complete),
    scannedCount: Array.isArray(payload?.scannedCodes) ? payload.scannedCodes.length : cleanNumber(payload?.scannedCount),
    matches: matches.map((item) => ({
      code: String(item.code || ""),
      name: String(item.name || item.code || ""),
      close: cleanNumber(item.close),
      percent: cleanNumber(item.percent),
      tradeVolume: cleanNumber(item.tradeVolume),
      avgVolume5: cleanNumber(item.avgVolume5),
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
  const maxStrategy4ZonePages = 48;
  const zoneBTotalPages = Math.max(1, Math.ceil(zoneB.length / pageSize));
  const zoneCTotalPages = Math.max(1, Math.ceil(zoneC.length / pageSize));
  for (let page = 1; page <= maxStrategy4ZonePages; page += 1) {
    const index = (page - 1) * pageSize;
    const rows = zoneB.slice(index, index + pageSize);
    zoneBPages.push([`data/strategy4-zone-b-page-${page}.json`, {
      ...base,
      zone: "B",
      page,
      pageSize,
      totalPages: zoneBTotalPages,
      totalCount: zoneB.length,
      count: rows.length,
      matches: rows,
    }]);
  }
  for (let page = 1; page <= maxStrategy4ZonePages; page += 1) {
    const index = (page - 1) * pageSize;
    const rows = zoneC.slice(index, index + pageSize);
    zoneCPages.push([`data/strategy4-zone-c-page-${page}.json`, {
      ...base,
      zone: "C",
      page,
      pageSize,
      totalPages: zoneCTotalPages,
      totalCount: zoneC.length,
      count: rows.length,
      matches: rows,
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
  const volumeMatches = Array.isArray(payload?.volumeMatches) ? payload.volumeMatches : [];
  const singleSignals = Array.isArray(payload?.singleSignals) ? payload.singleSignals : [];
  const quoteRows = normalizeArray(readOptional("data/stocks-quotes-slim.json", {})?.quotes);
  const quoteByCode = new Map(quoteRows.map((row) => [String(row?.code || "").trim(), row]).filter(([code]) => code));
  const quoteFor = (item) => quoteByCode.get(String(item?.underlyingCode || item?.code || "").trim()) || null;
  const closeFor = (item) => cleanNumber(quoteFor(item)?.close ?? item.displayClose ?? item.underlyingClose ?? item.close ?? item.stockClose);
  const percentFor = (item) => cleanNumber(quoteFor(item)?.percent ?? item.displayPercent ?? item.underlyingPercent ?? item.percent ?? item.stockPercent);
  const quoteDateFor = (item) => quoteFor(item)?.quoteDate || item.quoteDate || "";
  return {
    ok: Boolean(payload?.ok ?? true),
    source: payload?.source || "warrant-flow-slim",
    updatedAt: payload?.updatedAt || "",
    count: cleanNumber(payload?.count || matches.length),
    volumeCount: cleanNumber(payload?.volumeCount || volumeMatches.length),
    singleSignalCount: cleanNumber(payload?.singleSignalCount || singleSignals.length),
    matches: matches.map((item) => ({
      code: String(item.underlyingCode || item.code || ""),
      name: String(item.underlyingName || item.name || item.underlyingCode || item.code || ""),
      underlyingCode: String(item.underlyingCode || item.code || ""),
      underlyingName: String(item.underlyingName || item.name || ""),
      underlyingClose: closeFor(item),
      underlyingPercent: percentFor(item),
      callValue: cleanNumber(item.callValue),
      putValue: cleanNumber(item.putValue),
      callCount: cleanNumber(item.callCount),
      putCount: cleanNumber(item.putCount),
      callPutRatio: cleanNumber(item.callPutRatio),
      score: cleanNumber(item.score),
      finalScore: cleanNumber(item.finalScore),
      warrantHeatScore: cleanNumber(item.warrantHeatScore),
      stockSetupScore: cleanNumber(item.stockSetupScore),
      stockSetupLabel: item.stockSetupLabel || "",
      branchPowerScore: cleanNumber(item.branchPowerScore),
      branchAvailable: Boolean(item.branchAvailable),
      branchStatus: item.branchStatus || "",
      actionLabel: item.actionLabel || "",
      signalGrade: item.signalGrade || item.level || item.grade || "",
      displayClose: closeFor(item),
      displayPercent: percentFor(item),
      tradeDate: item.tradeDate || "",
      quoteDate: quoteDateFor(item),
      reason: item.reason || "",
    })),
    volumeMatches: volumeMatches.map((item) => ({
      code: String(item.underlyingCode || item.code || ""),
      name: String(item.underlyingName || item.name || item.underlyingCode || item.code || ""),
      underlyingCode: String(item.underlyingCode || item.code || ""),
      underlyingName: String(item.underlyingName || item.name || ""),
      underlyingClose: closeFor(item),
      underlyingPercent: percentFor(item),
      callValue: cleanNumber(item.callValue),
      putValue: cleanNumber(item.putValue),
      callVolume: cleanNumber(item.callVolume),
      putVolume: cleanNumber(item.putVolume),
      callCount: cleanNumber(item.callCount),
      putCount: cleanNumber(item.putCount),
      callPutRatio: cleanNumber(item.callPutRatio),
      thirtyMinuteVolume: cleanNumber(item.thirtyMinuteVolume),
      floatingUnits: cleanNumber(item.floatingUnits),
      volumeMultiple: cleanNumber(item.volumeMultiple),
      score: cleanNumber(item.score),
      finalScore: cleanNumber(item.finalScore),
      warrantHeatScore: cleanNumber(item.warrantHeatScore),
      stockSetupScore: cleanNumber(item.stockSetupScore),
      stockSetupLabel: item.stockSetupLabel || "",
      branchPowerScore: cleanNumber(item.branchPowerScore),
      branchAvailable: Boolean(item.branchAvailable),
      branchStatus: item.branchStatus || "",
      actionLabel: item.actionLabel || "",
      signalGrade: item.signalGrade || item.level || item.grade || "",
      displayClose: closeFor(item),
      displayPercent: percentFor(item),
      tradeDate: item.tradeDate || "",
      quoteDate: quoteDateFor(item),
      reason: item.reason || "",
    })),
    singleSignals: singleSignals.map((item) => slimSingleWarrantSignal(item, { quote: quoteFor(item) })),
  };
}

function slimSingleWarrantSignal(item, options = {}) {
  const quote = options.quote || null;
  const close = cleanNumber(quote?.close ?? item.displayClose ?? item.underlyingClose ?? item.close ?? item.stockClose);
  const percent = cleanNumber(quote?.percent ?? item.displayPercent ?? item.underlyingPercent ?? item.percent ?? item.stockPercent);
  return {
    code: String(item.underlyingCode || item.code || ""),
    name: String(item.underlyingName || item.name || item.underlyingCode || item.code || ""),
    underlyingCode: String(item.underlyingCode || item.code || ""),
    underlyingName: String(item.underlyingName || item.name || ""),
    warrantCode: String(item.warrantCode || ""),
    warrantName: String(item.warrantName || ""),
    underlyingClose: close,
    underlyingPercent: percent,
    value: cleanNumber(item.value),
    volume: cleanNumber(item.volume),
    strike: cleanNumber(item.strike),
    daysToExpiry: cleanNumber(item.daysToExpiry),
    moneynessPct: cleanNumber(item.moneynessPct),
    isNearMoney: Boolean(item.isNearMoney),
    stockSetupScore: cleanNumber(item.stockSetupScore),
    stockSetupLabel: item.stockSetupLabel || "",
    groupCallValue: cleanNumber(item.groupCallValue),
    groupCallCount: cleanNumber(item.groupCallCount),
    groupPutValue: cleanNumber(item.groupPutValue),
    signalCount: cleanNumber(item.signalCount),
    largeSignalCount: cleanNumber(item.largeSignalCount),
    estimatedLargeSignalCount: cleanNumber(item.estimatedLargeSignalCount),
    maxSignalValue: cleanNumber(item.maxSignalValue),
    totalSignalValue: cleanNumber(item.totalSignalValue),
    hasRepeatLargeSignal: Boolean(item.hasRepeatLargeSignal),
    score: cleanNumber(item.score),
    signalGrade: item.signalGrade || "",
    actionLabel: item.actionLabel || "",
    displayClose: close,
    displayPercent: percent,
    tradeDate: item.tradeDate || "",
    quoteDate: quote?.quoteDate || item.quoteDate || "",
    reason: item.reason || "",
  };
}

function warrantPresetFiles(payload) {
  const slim = slimWarrant(payload);
  const rows = [...slim.matches].sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score) || cleanNumber(b.callValue) - cleanNumber(a.callValue)).slice(0, 160);
  const singleRows = [...slim.singleSignals].sort((a, b) =>
    Number(b.hasRepeatLargeSignal) - Number(a.hasRepeatLargeSignal) ||
    cleanNumber(b.estimatedLargeSignalCount) - cleanNumber(a.estimatedLargeSignalCount) ||
    cleanNumber(b.score) - cleanNumber(a.score) ||
    Number(b.isNearMoney) - Number(a.isNearMoney) ||
    cleanNumber(b.value) - cleanNumber(a.value)
  ).slice(0, 12);
  return [
    ["data/warrant-priority-top.json", {
      ok: slim.ok,
      source: "warrant-preset",
      updatedAt: slim.updatedAt,
      count: rows.length,
      matches: rows,
    }],
    ["data/warrant-single-signal-top.json", {
      ok: slim.ok,
      source: "warrant-single-signal-top",
      updatedAt: slim.updatedAt,
      count: singleRows.length,
      matches: singleRows,
    }],
  ];
}

function pageFiles(prefix, rows, base = {}, options = {}) {
  const pageSize = cleanNumber(options.pageSize) || 25;
  const maxPages = cleanNumber(options.maxPages) || Math.max(1, Math.ceil(rows.length / pageSize));
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const files = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const index = (page - 1) * pageSize;
    const pageRows = rows.slice(index, index + pageSize);
    files.push([`data/${prefix}-page-${page}.json`, {
      ...base,
      source: `${prefix}-page`,
      page,
      pageSize,
      totalPages,
      totalCount: rows.length,
      count: pageRows.length,
      rows: pageRows,
      matches: pageRows,
    }]);
  }
  return files;
}

function strategyPresetPageFiles() {
  const openBuy = readOptional("data/open-buy-latest.json", {});
  const strategy2 = readOptional("data/strategy2-intraday-live-top.json", readOptional("data/strategy2-intraday-top.json", {}));
  const strategy3 = readOptional("data/strategy3-latest.json", {});
  const strategy4 = readOptional("data/strategy4-score-top.json", {});
  const strategy5 = readOptional("data/strategy5-latest.json", {});
  const files = [];
  files.push(...pageFiles("open-buy", normalizeArray(openBuy.matches), {
    ok: openBuy?.ok !== false,
    updatedAt: openBuy?.updatedAt || "",
    usedDate: openBuy?.usedDate || openBuy?.date || "",
  }, { maxPages: 24 }));
  files.push(...pageFiles("strategy2-intraday", normalizeArray(strategy2.events || strategy2.records), {
    ok: strategy2?.ok !== false,
    updatedAt: strategy2?.updatedAt || "",
    date: strategy2?.date || "",
  }, { maxPages: 24 }));
  files.push(...pageFiles("strategy3", normalizeArray(strategy3.matches), {
    ok: strategy3?.ok !== false,
    updatedAt: strategy3?.updatedAt || "",
    usedDate: strategy3?.usedDate || strategy3?.date || "",
  }, { maxPages: 24 }));
  files.push(...pageFiles("strategy4-score", normalizeArray(strategy4.matches), {
    ok: strategy4?.ok !== false,
    updatedAt: strategy4?.updatedAt || "",
    scanStamp: strategy4?.scanStamp || "",
  }, { maxPages: 24 }));
  files.push(...pageFiles("strategy5", normalizeArray(strategy5.matches), {
    ok: strategy5?.ok !== false,
    updatedAt: strategy5?.updatedAt || "",
    generatedDate: strategy5?.generatedDate || "",
    sourceDate: strategy5?.sourceDate || strategy5?.usedDate || "",
  }, { maxPages: 24 }));
  return files;
}

function institutionPageFiles(payload) {
  const slim = slimInstitution(payload);
  const rows = Object.values(slim.data || {}).sort((a, b) => cleanNumber(b.total) - cleanNumber(a.total));
  return pageFiles("institution", rows, {
    ok: slim.ok,
    updatedAt: slim.updatedAt,
    usedDate: slim.usedDate,
    quoteUpdatedAt: slim.quoteUpdatedAt,
  }, { maxPages: 24 });
}

function warrantPageFiles(payload) {
  const slim = slimWarrant(payload);
  const rows = [...slim.matches].sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score) || cleanNumber(b.callValue) - cleanNumber(a.callValue));
  const volumeRows = [...slim.volumeMatches].sort((a, b) => cleanNumber(b.volumeMultiple) - cleanNumber(a.volumeMultiple) || cleanNumber(b.score) - cleanNumber(a.score));
  return [
    ...pageFiles("warrant-flow", rows, { ok: slim.ok, updatedAt: slim.updatedAt }, { maxPages: 24 }),
    ...pageFiles("warrant-volume", volumeRows, { ok: slim.ok, updatedAt: slim.updatedAt }, { maxPages: 24 }),
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
  const presetFiles = warrantPresetFiles(payload);
  const preset = presetFiles.find(([file]) => file === "data/warrant-priority-top.json")?.[1] || { matches: [] };
  const singlePreset = presetFiles.find(([file]) => file === "data/warrant-single-signal-top.json")?.[1] || { matches: [] };
  const rows = (preset.matches || []).slice(0, 50);
  const singleSignals = (singlePreset.matches || []).slice(0, 12);
  return {
    ok: Boolean(payload?.ok ?? true),
    source: "warrant-flow-mobile-top",
    updatedAt: payload?.updatedAt || "",
    count: rows.length,
    matches: rows,
    singleSignalCount: singleSignals.length,
    singleSignals,
  };
}

function mobileHomeSummary() {
  const market = readOptional("data/market-summary.json", {});
  const health = readOptional("data/health-summary.json", {});
  const strategy2 = readOptional("data/strategy2-intraday-live-top.json", readOptional("data/strategy2-intraday-top.json", {}));
  const chip = readOptional("data/institution-mobile-top.json", {});
  const warrant = readOptional("data/warrant-flow-mobile-top.json", {});
  const sectors = normalizeArray(market?.sectors).map((sector) => {
    const up = cleanNumber(sector?.up);
    const down = cleanNumber(sector?.down);
    const total = cleanNumber(sector?.total) || up + down + cleanNumber(sector?.flat);
    const breadth = total ? (up - down) / total : 0;
    return {
      name: sector?.name || "",
      up,
      down,
      total,
      breadth,
    };
  }).filter((sector) => sector.name && sector.total);
  const upCount = sectors.reduce((sum, sector) => sum + sector.up, 0);
  const downCount = sectors.reduce((sum, sector) => sum + sector.down, 0);
  const sampleCount = cleanNumber(market?.sample) || cleanNumber(market?.stockCount) || sectors.reduce((sum, sector) => sum + sector.total, 0);
  const strongSectors = normalizeArray(market?.strongSectors).length
    ? normalizeArray(market?.strongSectors).slice(0, 5)
    : sectors.slice().sort((a, b) => b.breadth - a.breadth || b.up - a.up).slice(0, 5);
  const weakSectors = normalizeArray(market?.weakSectors).length
    ? normalizeArray(market?.weakSectors).slice(0, 5)
    : sectors.slice().sort((a, b) => a.breadth - b.breadth || b.down - a.down).slice(0, 5);
  return {
    source: "mobile-home-summary",
    updatedAt: new Date().toISOString(),
    market: {
      updatedAt: market?.updatedAt || "",
      sample: sampleCount,
      up: cleanNumber(market?.up) || upCount,
      down: cleanNumber(market?.down) || downCount,
      flat: cleanNumber(market?.flat) || Math.max(0, sampleCount - upCount - downCount),
      strongSectors,
      weakSectors,
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

function marketAiBreadthLatest(summary = mobileHomeSummary()) {
  const market = summary.market || {};
  const up = cleanNumber(market.up);
  const down = cleanNumber(market.down);
  const flat = cleanNumber(market.flat);
  const sample = cleanNumber(market.sample) || up + down + flat;
  const directionalCount = up + down;
  const directionalRatio = directionalCount ? up / directionalCount * 100 : 50;
  const upRatio = sample ? up / sample * 100 : 0;
  const downRatio = sample ? down / sample * 100 : 0;
  return {
    ok: sample >= 500 && directionalCount > 0,
    source: "market-ai-breadth-latest",
    updatedAt: new Date().toISOString(),
    marketUpdatedAt: market.updatedAt || summary.updatedAt || "",
    sample,
    up,
    down,
    flat,
    upRatio: Number(upRatio.toFixed(2)),
    downRatio: Number(downRatio.toFixed(2)),
    directionalCount,
    directionalRatio: Number(directionalRatio.toFixed(2)),
    bias: directionalRatio >= 55 && up > down ? "多方偏強" : directionalRatio <= 45 && down > up ? "空方壓制" : "盤中保守",
    reason: "市場廣度 上漲 " + up.toLocaleString("zh-TW") + " / 下跌 " + down.toLocaleString("zh-TW") + " / 平盤 " + flat.toLocaleString("zh-TW"),
  };
}

function marketAiLiveCache() {
  const marketPayload = readOptional("data/market-summary.json", {});
  const breadth = readOptional("data/market-ai-breadth-latest.json", {});
  const strategy2 = readOptional("data/strategy2-intraday-live-top.json", readOptional("data/strategy2-intraday-top.json", {}));
  const realtimeRadar = readOptional("data/realtime-radar-latest.json", {});
  const strategy2Count = payloadCount(strategy2);
  const realtimeRadarCount = payloadCount(realtimeRadar);
  return {
    ok: Boolean(marketPayload?.ok !== false || strategy2?.ok !== false || realtimeRadar?.ok !== false),
    source: "scan-data-bundle",
    cacheSource: "data/market-ai-live.json",
    updatedAt: new Date().toISOString(),
    market: marketPayload,
    breadth,
    strategy2,
    realtimeRadar,
    summary: {
      marketStatus: marketPayload?.marketStatus || marketPayload?.status || "",
      trading: marketPayload?.trading === true,
      strategy2Count,
      realtimeRadarCount,
      strategy2Source: strategy2?.cacheSource || strategy2?.source || strategy2?.transport?.source || "",
      realtimeRadarSource: realtimeRadar?.cacheSource || realtimeRadar?.source || realtimeRadar?.transport?.source || "",
    },
  };
}

function slimStockForPanel(stock) {
  return {
    code: String(stock?.code || stock?.Code || ""),
    name: String(stock?.name || stock?.Name || stock?.code || stock?.Code || ""),
    close: cleanNumber(stock?.close || stock?.ClosingPrice),
    change: cleanNumber(stock?.change || stock?.Change),
    percent: cleanNumber(stock?.percent || stock?.pct),
    value: cleanNumber(stock?.value || stock?.TradeValue),
    tradeVolume: cleanNumber(stock?.tradeVolume || stock?.TradeVolume || stock?.volume),
    industry: String(stock?.industry || stock?.sector || stock?.group || ""),
    score: cleanNumber(stock?.score || stock?.swingScore || stock?.maxScore || stock?.reboundScore),
    tags: normalizeArray(stock?.tags || stock?.signals || stock?.swingSignals).slice(0, 5).map(signalText).filter(Boolean),
  };
}

function marketAiPanelLatest() {
  const market = readOptional("data/market-summary.json", {});
  const breadth = readOptional("data/market-ai-breadth-latest.json", marketAiBreadthLatest());
  const strategy5 = readOptional("data/strategy5-latest.json", {});
  const strategy2 = readOptional("data/strategy2-intraday-live-top.json", readOptional("data/strategy2-intraday-top.json", {}));
  const radar = readOptional("data/realtime-radar-latest.json", {});
  const quotes = readOptional("data/stocks-quotes-mobile-top.json", {});
  const sectors = normalizeArray(market?.sectors).map((sector) => {
    const up = cleanNumber(sector?.up);
    const down = cleanNumber(sector?.down);
    const sample = up + down + cleanNumber(sector?.flat);
    return {
      name: String(sector?.name || ""),
      up,
      down,
      sample,
      pct: sample ? Number(((up - down) / sample * 100).toFixed(2)) : 0,
      count: normalizeArray(sector?.stocks).length,
    };
  }).filter((sector) => sector.name);
  const strongSectors = [...sectors].sort((a, b) => b.pct - a.pct || b.up - a.up).slice(0, 8);
  const weakSectors = [...sectors].sort((a, b) => a.pct - b.pct || b.down - a.down).slice(0, 8);
  const strategyRows = [
    ...normalizeArray(strategy5?.matches).slice(0, 40),
    ...normalizeArray(strategy2?.events || strategy2?.records).slice(0, 24),
    ...normalizeArray(radar?.rows).slice(0, 24),
  ].map(slimStockForPanel).filter((stock) => stock.code);
  const byCode = new Map();
  for (const stock of strategyRows) {
    const previous = byCode.get(stock.code);
    byCode.set(stock.code, previous ? {
      ...previous,
      score: Math.max(previous.score, stock.score),
      tags: [...new Set([...previous.tags, ...stock.tags])].slice(0, 6),
      value: Math.max(previous.value, stock.value),
      percent: Math.abs(stock.percent) > Math.abs(previous.percent) ? stock.percent : previous.percent,
    } : stock);
  }
  const priorityStocks = [...byCode.values()].sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score) || cleanNumber(b.value) - cleanNumber(a.value)).slice(0, 20);
  const quoteRows = normalizeArray(quotes?.quotes).map(slimStockForPanel).filter((stock) => stock.code);
  const riskStocks = [...quoteRows].filter((stock) => stock.percent <= -3 || stock.percent >= 8.5).sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent)).slice(0, 12);
  const hotGroups = {
    all: priorityStocks.slice(0, 10),
    momentum: [...priorityStocks].sort((a, b) => cleanNumber(b.percent) - cleanNumber(a.percent)).slice(0, 10),
    risk: riskStocks.slice(0, 10),
    intraday: normalizeArray(strategy2?.events || strategy2?.records).slice(0, 10).map(slimStockForPanel),
    legal: [],
  };
  return {
    ok: true,
    source: "market-ai-panel-latest",
    updatedAt: new Date().toISOString(),
    marketUpdatedAt: market?.updatedAt || "",
    breadth,
    summary: {
      bias: breadth?.bias || "盤中保守",
      sample: cleanNumber(breadth?.sample),
      up: cleanNumber(breadth?.up),
      down: cleanNumber(breadth?.down),
      flat: cleanNumber(breadth?.flat),
      upRatio: cleanNumber(breadth?.upRatio),
      downRatio: cleanNumber(breadth?.downRatio),
      directionalRatio: cleanNumber(breadth?.directionalRatio),
      confidence: cleanNumber(breadth?.sample) >= 1000 ? Math.min(92, Math.round(58 + 1.4 * Math.abs(cleanNumber(breadth?.upRatio) - 50))) : "中",
      reason: breadth?.reason || "",
    },
    strongSectors,
    weakSectors,
    priorityStocks,
    riskStocks,
    hotGroups,
    observationStocks: priorityStocks.slice(0, 10),
    advice: [
      breadth?.bias === "多方偏強" ? "順勢追蹤" : breadth?.bias === "空方壓制" ? "降低追價" : "等待方向",
      "只看強族群前 3 名",
      "跌破量價支撐先降槓桿",
    ],
  };
}

function mobileStockAnalysisLatest(panel = null) {
  const sourcePanel = panel || readOptional("data/market-ai-panel-latest.json", marketAiPanelLatest());
  const strategyIndex = readOptional("data/strategy-match-index.json", {});
  const stockIndex = readOptional("data/stocks-index.json", {});
  const stockNameByCode = new Map(normalizeArray(stockIndex?.stocks).map((stock) => [String(stock?.code || "").trim(), String(stock?.name || "")]));
  const breadth = sourcePanel?.breadth || {};
  const summary = sourcePanel?.summary || {};
  const byCode = new Map();
  function strategyMatchesFor(code) {
    return normalizeArray(strategyIndex?.byCode?.[code]).map((match) => {
      const details = normalizeArray(match?.details).map(signalText).filter(Boolean).slice(0, 6);
      return {
        key: String(match?.key || ""),
        label: String(match?.label || strategyIndex?.strategies?.[match?.key]?.label || match?.key || "終端策略"),
        score: cleanNumber(match?.score),
        details,
        date: String(match?.date || ""),
        updatedAt: String(match?.updatedAt || ""),
      };
    }).filter((match) => match.label);
  }
  function strategySignalText(matches) {
    return matches.map((match) => {
      const detailText = match.details.length ? `：${match.details.join("、")}` : "";
      return `${match.label}${detailText}`;
    }).join("；");
  }
  function add(stock = {}, bucket = "priority", rank = 0) {
    const code = String(stock?.code || "").trim();
    if (!code) return;
    const resolvedName = String(stock?.name || stockNameByCode.get(code) || code);
    const previous = byCode.get(code) || {
      code,
      name: resolvedName,
      sources: [],
      tags: [],
    };
    const score = cleanNumber(stock?.score);
    const percent = cleanNumber(stock?.percent);
    const value = cleanNumber(stock?.value);
    const tags = normalizeArray(stock?.tags).map(signalText).filter(Boolean);
    const sourceLabel = bucket === "risk" ? "風險清單" : bucket === "momentum" ? "動能排序" : bucket === "strategy" ? "終端策略" : "優先清單";
    byCode.set(code, {
      ...previous,
      name: previous.name || resolvedName,
      score: Math.max(cleanNumber(previous.score), score),
      percent: Math.abs(percent) > Math.abs(cleanNumber(previous.percent)) ? percent : cleanNumber(previous.percent),
      value: Math.max(cleanNumber(previous.value), value),
      industry: previous.industry || String(stock?.industry || ""),
      rank: previous.rank || rank || 0,
      sources: [...new Set([...previous.sources, sourceLabel])],
      tags: [...new Set([...previous.tags, ...tags])].slice(0, 8),
      bucket,
    });
  }
  normalizeArray(sourcePanel?.priorityStocks).slice(0, 20).forEach((stock, index) => add(stock, "priority", index + 1));
  normalizeArray(sourcePanel?.riskStocks).slice(0, 12).forEach((stock, index) => add(stock, "risk", index + 1));
  normalizeArray(sourcePanel?.hotGroups?.momentum).slice(0, 10).forEach((stock, index) => add(stock, "momentum", index + 1));
  Object.keys(strategyIndex?.byCode || {}).forEach((code, index) => add({ code }, "strategy", index + 1));
  const analyses = {};
  for (const stock of byCode.values()) {
    const isRisk = stock.sources.includes("風險清單");
    const matches = strategyMatchesFor(stock.code);
    const strategySources = matches.map((match) => match.label);
    const strategyTags = matches.flatMap((match) => match.details.length ? match.details : [match.label]);
    const signalsText = strategySignalText(matches) || (stock.tags.length ? stock.tags.join("、") : "掃描端綜合排序");
    const valueText = stock.value ? `${(stock.value / 1e8).toFixed(1)} 億` : "--";
    const tagText = signalsText || "掃描端綜合排序";
    analyses[stock.code] = {
      code: stock.code,
      name: stock.name,
      updatedAt: sourcePanel?.updatedAt || "",
      marketBias: summary?.bias || breadth?.bias || "",
      sources: [...new Set([...strategySources, ...stock.sources])],
      strategies: matches,
      signalsText,
      score: stock.score,
      percent: Number(stock.percent.toFixed(2)),
      value: stock.value,
      valueText,
      industry: stock.industry || "",
      tags: [...new Set([...strategyTags, ...stock.tags])].slice(0, 10),
      reason: isRisk
        ? `漲跌幅 ${stock.percent.toFixed(2)}%，命中 ${tagText}；屬於極端波動清單，先確認是否過熱、跌破或流動性異常。`
        : `綜合分數 ${stock.score || "--"}，成交值 ${valueText}，命中 ${tagText}。`,
      aiView: `${summary?.bias || breadth?.bias || "盤勢觀察"}：${summary?.reason || breadth?.reason || "以掃描端排序為主，手機不重新計算。"}`,
      action: isRisk ? "先控風險，不追價；等待量價重新確認。" : "列入優先觀察；只在量價續強且未過熱時追蹤。",
      risk: stock.percent >= 8.5 ? "漲幅偏高，留意開高走低或爆量不漲。" : stock.percent <= -3 ? "跌幅偏大，先等止跌與量縮。" : "跌破短線支撐或量縮轉弱時降低權重。",
    };
  }
  return {
    ok: true,
    source: "mobile-stock-analysis-latest",
    updatedAt: new Date().toISOString(),
    strategyIndexUpdatedAt: strategyIndex?.updatedAt || "",
    marketUpdatedAt: sourcePanel?.marketUpdatedAt || "",
    count: Object.keys(analyses).length,
    analyses,
  };
}

function writeMobileStockAnalysisFiles(payload) {
  clearDirInAllRoots("data/mobile-analysis");
  const analyses = payload?.analyses || {};
  for (const [code, analysis] of Object.entries(analyses)) {
    const safeCode = encodeURIComponent(String(code).trim());
    if (!safeCode) continue;
    writeToBoth(`data/mobile-analysis/${safeCode}.json`, {
      ok: true,
      source: "mobile-stock-analysis",
      updatedAt: payload?.updatedAt || new Date().toISOString(),
      code,
      ...analysis,
    });
  }
  writeToBoth("data/mobile-analysis/index.json", {
    ok: true,
    source: "mobile-stock-analysis-index",
    updatedAt: payload?.updatedAt || new Date().toISOString(),
    count: Object.keys(analyses).length,
    codes: Object.keys(analyses),
  });
  return Object.keys(analyses).length;
}

function mobileTerminalLatest() {
  const mobile = readOptional("data/mobile-home-summary.json", mobileHomeSummary());
  const breadth = readOptional("data/market-ai-breadth-latest.json", marketAiBreadthLatest(mobile));
  const aiPanel = readOptional("data/market-ai-panel-latest.json", marketAiPanelLatest());
  const manifest = readOptional("data/data-manifest.json", {});
  const status = readOptional("data/data-status-index.json", {});
  const strategy2 = readOptional("data/strategy2-intraday-live-top.json", readOptional("data/strategy2-intraday-top.json", {}));
  const institution = readOptional("data/institution-mobile-top.json", {});
  const warrant = readOptional("data/warrant-flow-mobile-top.json", {});
  const strategy4 = readOptional("data/strategy4-score-top.json", {});
  const strategy5 = readOptional("data/strategy5-page-1.json", readOptional("data/strategy5-latest.json", {}));
  return {
    ok: true,
    source: "mobile-terminal-latest",
    updatedAt: new Date().toISOString(),
    mobile,
    breadth,
    aiPanel,
    manifest: {
      updatedAt: manifest?.updatedAt || "",
      count: cleanNumber(manifest?.count),
      entries: Object.fromEntries(Object.entries(manifest?.entries || {}).filter(([key]) => [
        "market-summary.json",
        "market-ai-breadth-latest.json",
        "market-ai-panel-latest.json",
        "strategy2-intraday-live-top.json",
        "strategy4-score-top.json",
        "strategy5-page-1.json",
        "institution-mobile-top.json",
        "warrant-flow-mobile-top.json",
      ].includes(key))),
    },
    status: {
      updatedAt: status?.updatedAt || "",
      entries: status?.entries || {},
    },
    strategy2: {
      updatedAt: strategy2?.updatedAt || "",
      count: payloadCount(strategy2),
      rows: normalizeArray(strategy2?.events || strategy2?.records).slice(0, 12),
    },
    strategy4: {
      updatedAt: strategy4?.updatedAt || "",
      count: payloadCount(strategy4),
      rows: normalizeArray(strategy4?.matches).slice(0, 12),
    },
    strategy5: {
      updatedAt: strategy5?.updatedAt || "",
      count: payloadCount(strategy5),
      rows: normalizeArray(strategy5?.rows || strategy5?.matches).slice(0, 12),
    },
    institution: {
      updatedAt: institution?.updatedAt || "",
      count: payloadCount(institution),
      rows: normalizeArray(institution?.rows).slice(0, 12),
    },
    warrant: {
      updatedAt: warrant?.updatedAt || "",
      count: payloadCount(warrant),
      rows: normalizeArray(warrant?.matches).slice(0, 12),
    },
  };
}

const MOBILE_AI_FRAGMENT_VERSION = "mobile-ai-v1";

function mobileAiLatestHtml(panel = marketAiPanelLatest()) {
  const summary = panel?.summary || {};
  const breadth = panel?.breadth || {};
  const bias = summary.bias || breadth.bias || "盤中保守";
  const priorityStocks = normalizeArray(panel?.priorityStocks).slice(0, 10);
  const riskStocks = normalizeArray(panel?.riskStocks).slice(0, 8);
  const strongNames = normalizeArray(panel?.strongSectors).slice(0, 4).map((item) => item.name).filter(Boolean).join("、") || "尚未形成明顯主流";
  const weakNames = normalizeArray(panel?.weakSectors).slice(0, 4).map((item) => item.name).filter(Boolean).join("、") || "暫無明顯弱勢族群";
  const stockRow = (stock, index, mode = "priority") => {
    const pct = cleanNumber(stock.percent);
    const score = cleanNumber(stock.score);
    const tags = normalizeArray(stock.tags).slice(0, 4).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
    return `
      <article class="market-ai-stock-row" data-mobile-ai-contract="stock-row">
        <div class="market-ai-rank">#${index + 1}</div>
        <div>
          <h4><span class="market-ai-code">${escapeHtml(stock.code)}</span><span class="market-ai-name">${escapeHtml(stock.name)}</span></h4>
          <p>${mode === "risk" ? "風險" : "優先"}分數 ${score || "--"}，漲幅 ${pct.toFixed(2)}%，成交值 ${(cleanNumber(stock.value) / 1e8).toFixed(1)} 億</p>
          <p>${escapeHtml(normalizeArray(stock.tags).slice(0, 2).join("、") || (mode === "risk" ? "波動過熱，先控部位。" : "掃描端已完成排序，手機直接顯示。"))}</p>
        </div>
        <div>
          <span class="market-ai-chip">${escapeHtml(stock.industry || "--")}</span>
          <span class="market-ai-chip">${(cleanNumber(stock.value) / 1e8).toFixed(1)} 億</span>
        </div>
        <div class="market-ai-score"><small>${mode === "risk" ? "風險" : "綜合"}</small><strong>${score || "--"}</strong></div>
        <div class="market-ai-tags">${tags}</div>
        <div class="market-ai-actions">
          <button type="button" data-mobile-ai-contract="analyze" data-ai-stock-code="${escapeHtml(stock.code)}" data-ai-stock-name="${escapeHtml(stock.name)}">看分析</button>
          <button type="button" data-mobile-ai-contract="watch" data-ai-watch-code="${escapeHtml(stock.code)}" data-ai-watch-name="${escapeHtml(stock.name)}">加入自選</button>
        </div>
      </article>
    `;
  };
  const points = [
    `市場廣度有效漲跌多方占 ${cleanNumber(summary.directionalRatio || breadth.directionalRatio).toFixed(1)}%，上漲 ${cleanNumber(summary.up || breadth.up).toLocaleString("zh-TW")} / 下跌 ${cleanNumber(summary.down || breadth.down).toLocaleString("zh-TW")}。`,
    `族群焦點：${strongNames}；弱勢端留意 ${weakNames}。`,
    bias === "多方偏強" ? "盤勢偏多，優先追蹤已排序完成的強勢清單。" : bias === "空方壓制" ? "盤勢偏空，降低追價，等待反彈量價確認。" : "盤勢保守，縮小部位並等待方向擴散。",
  ];
  return `
    <section class="mobile-ai-fragment" data-mobile-ai-fragment="1" data-mobile-ai-contract="root" data-mobile-ai-version="${MOBILE_AI_FRAGMENT_VERSION}" data-mobile-ai-updated-at="${escapeHtml(panel?.updatedAt || "")}">
      <section class="market-ai-summary">
        <article class="market-ai-card hero">
          <small>盤中決策節奏</small>
          <strong>${escapeHtml(bias)}</strong>
          <p>${escapeHtml(summary.reason || breadth.reason || "掃描端已完成市場廣度判讀，手機直接顯示結論。")}</p>
          <div class="market-ai-metrics">
            <span>樣本<b>${cleanNumber(summary.sample || breadth.sample).toLocaleString("zh-TW")}</b></span>
            <span>多方<b>${cleanNumber(summary.up || breadth.up).toLocaleString("zh-TW")}</b></span>
            <span>空方<b>${cleanNumber(summary.down || breadth.down).toLocaleString("zh-TW")}</b></span>
            <span>信心<b>${escapeHtml(summary.confidence || "中")}</b></span>
          </div>
        </article>
        <article class="market-ai-card">
          <small>盤勢廣度</small>
          <strong>${cleanNumber(summary.directionalRatio || breadth.directionalRatio).toFixed(1)}%</strong>
          <p>全樣本上漲 ${cleanNumber(summary.upRatio || breadth.upRatio).toFixed(1)}%，下跌 ${cleanNumber(summary.downRatio || breadth.downRatio).toFixed(1)}%。</p>
        </article>
        <article class="market-ai-card warning">
          <small>風險控管</small>
          <strong>${riskStocks.length ? "先控風險" : "風險正常"}</strong>
          <p>${escapeHtml(weakNames)} 需要留意；極端波動標的已由掃描端預先列出。</p>
        </article>
        <article class="market-ai-card">
          <small>優先觀察</small>
          <strong>${priorityStocks[0] ? `${escapeHtml(priorityStocks[0].code)} ${escapeHtml(priorityStocks[0].name)}` : "--"}</strong>
          <p>${priorityStocks[0] ? `綜合分數 ${cleanNumber(priorityStocks[0].score) || "--"}，族群 ${escapeHtml(priorityStocks[0].industry || "--")}，手機不再排序。` : "等待掃描完成。"}</p>
        </article>
      </section>
      <div class="market-ai-sort-note mobile-ai-stale-note" data-mobile-ai-stale-note hidden>等待最新掃描更新。</div>
      <div class="market-ai-sort-note mobile-ai-manual-note">
        <button type="button" data-mobile-ai-full-load="1">手動完整載入</button>
      </div>
      <section class="market-ai-advice">
        ${normalizeArray(panel?.advice).slice(0, 3).map((item, index) => `
          <article class="market-ai-card" data-ai-advice="${index === 0 ? "entry" : index === 1 ? "sector" : "risk"}" role="button" tabindex="0" aria-expanded="false">
            <small>${index === 0 ? "進場紀律" : index === 1 ? "族群聚焦" : "風險排除"}</small>
            <strong>${escapeHtml(item)}</strong>
            <p>${escapeHtml(points[index] || "")}</p>
          </article>
        `).join("")}
      </section>
      <section class="market-ai-main">
        <article class="market-ai-block">
          <h3>AI 今日重點</h3>
          <small>${escapeHtml(panel?.updatedAt || "")}</small>
          <div class="market-ai-list">
            ${points.map((text, index) => `<div class="market-ai-point"><b>${index + 1}</b><span>${escapeHtml(text)}</span></div>`).join("")}
          </div>
        </article>
        <aside class="market-ai-block">
          <h3>風險提醒</h3>
          <small>${riskStocks.length} 則</small>
          <div class="market-ai-risk">
            <article><h4>族群集中</h4><p>主流若集中在少數股票，先等第二波量價確認。</p><div class="market-ai-chips">${normalizeArray(panel?.strongSectors).slice(0, 4).map((sector) => `<span class="market-ai-chip">${escapeHtml(sector.name)}</span>`).join("")}</div></article>
            <article><h4>波動過熱</h4><p>${escapeHtml(riskStocks.slice(0, 4).map((stock) => `${stock.code} ${stock.name}`).join("、") || "暫無極端標的")}。</p></article>
          </div>
        </aside>
      </section>
      <section class="market-ai-block">
        <h3>優先觀察清單</h3>
        <small>掃描端預排序 Top ${priorityStocks.length}</small>
        <div class="market-ai-hot">${priorityStocks.map((stock, index) => stockRow(stock, index)).join("") || '<div class="empty-state">等待掃描完成。</div>'}</div>
      </section>
      <section class="market-ai-block">
        <h3>風險清單</h3>
        <small>掃描端預排序 Top ${riskStocks.length}</small>
        <div class="market-ai-hot">${riskStocks.map((stock, index) => stockRow(stock, index, "risk")).join("") || '<div class="empty-state">目前沒有極端波動標的。</div>'}</div>
      </section>
    </section>
  `.trim();
}

function mobileAiLiteHtml(panel = marketAiPanelLatest()) {
  const litePanel = {
    ...panel,
    priorityStocks: normalizeArray(panel?.priorityStocks).slice(0, 5),
    riskStocks: normalizeArray(panel?.riskStocks).slice(0, 5),
  };
  return mobileAiLatestHtml(litePanel);
}

function mobileAiUltraHtml(panel = marketAiPanelLatest()) {
  const summary = panel?.summary || {};
  const breadth = panel?.breadth || {};
  const bias = summary.bias || breadth.bias || "盤中保守";
  const priorityStocks = normalizeArray(panel?.priorityStocks).slice(0, 3);
  const riskStocks = normalizeArray(panel?.riskStocks).slice(0, 3);
  const strongNames = normalizeArray(panel?.strongSectors).slice(0, 3).map((item) => item.name).filter(Boolean).join("、") || "尚未形成明顯主流";
  const weakNames = normalizeArray(panel?.weakSectors).slice(0, 3).map((item) => item.name).filter(Boolean).join("、") || "暫無明顯弱勢族群";
  const points = [
    `市場廣度多方 ${cleanNumber(summary.directionalRatio || breadth.directionalRatio).toFixed(1)}%，上漲 ${cleanNumber(summary.up || breadth.up).toLocaleString("zh-TW")} / 下跌 ${cleanNumber(summary.down || breadth.down).toLocaleString("zh-TW")}。`,
    `強勢族群：${strongNames}。`,
    bias === "多方偏強" ? "偏多，只看掃描端排好的前三名。" : bias === "空方壓制" ? "偏空，先控風險與等待反彈確認。" : "保守，縮小部位等待方向擴散。",
  ];
  const compactRow = (stock, index, mode = "priority") => `
    <article class="market-ai-stock-row mobile-ai-ultra-row" data-mobile-ai-contract="stock-row">
      <div class="market-ai-rank">#${index + 1}</div>
      <div>
        <h4>${escapeHtml(stock.code)} ${escapeHtml(stock.name)}</h4>
        <p>${mode === "risk" ? "風險" : "優先"} ${cleanNumber(stock.score) || "--"}｜${cleanNumber(stock.percent).toFixed(2)}%｜${escapeHtml(stock.industry || "--")}</p>
      </div>
      <button type="button" data-mobile-ai-contract="analyze" data-ai-stock-code="${escapeHtml(stock.code)}" data-ai-stock-name="${escapeHtml(stock.name)}">看分析</button>
      <button type="button" data-mobile-ai-contract="watch" data-ai-watch-code="${escapeHtml(stock.code)}" data-ai-watch-name="${escapeHtml(stock.name)}">加入自選</button>
    </article>
  `;
  return `
    <section class="mobile-ai-fragment mobile-ai-ultra-fragment" data-mobile-ai-fragment="1" data-mobile-ai-contract="root" data-mobile-ai-version="${MOBILE_AI_FRAGMENT_VERSION}" data-mobile-ai-variant="ultra" data-mobile-ai-updated-at="${escapeHtml(panel?.updatedAt || "")}">
      <section class="market-ai-summary">
        <article class="market-ai-card hero">
          <small>低階手機模式</small>
          <strong>${escapeHtml(bias)}</strong>
          <p>${escapeHtml(summary.reason || breadth.reason || "掃描端已完成市場廣度判讀，手機只顯示結論。")}</p>
          <div class="market-ai-metrics">
            <span>樣本<b>${cleanNumber(summary.sample || breadth.sample).toLocaleString("zh-TW")}</b></span>
            <span>多方<b>${cleanNumber(summary.up || breadth.up).toLocaleString("zh-TW")}</b></span>
            <span>空方<b>${cleanNumber(summary.down || breadth.down).toLocaleString("zh-TW")}</b></span>
          </div>
        </article>
      </section>
      <div class="market-ai-sort-note mobile-ai-stale-note" data-mobile-ai-stale-note hidden>等待最新掃描更新。</div>
      <div class="market-ai-sort-note mobile-ai-manual-note"><button type="button" data-mobile-ai-full-load="1">手動完整載入</button></div>
      <section class="market-ai-block">
        <h3>AI 今日重點</h3>
        <small>${escapeHtml(panel?.updatedAt || "")}</small>
        <div class="market-ai-list">${points.map((text, index) => `<div class="market-ai-point"><b>${index + 1}</b><span>${escapeHtml(text)}</span></div>`).join("")}</div>
      </section>
      <section class="market-ai-block">
        <h3>優先 Top 3</h3>
        <small>手機不排序，只顯示掃描結果</small>
        <div class="market-ai-hot">${priorityStocks.map((stock, index) => compactRow(stock, index)).join("") || '<div class="empty-state">等待掃描完成。</div>'}</div>
      </section>
      <section class="market-ai-block">
        <h3>風險 Top 3</h3>
        <small>${escapeHtml(weakNames)}</small>
        <div class="market-ai-hot">${riskStocks.map((stock, index) => compactRow(stock, index, "risk")).join("") || '<div class="empty-state">目前沒有極端波動標的。</div>'}</div>
      </section>
    </section>
  `.trim();
}

function mobileAiFreshness(updatedAt) {
  const updated = Date.parse(updatedAt || "");
  if (!Number.isFinite(updated)) return "expired";
  const ageMs = Date.now() - updated;
  if (ageMs <= 10 * 60 * 1000) return "fresh";
  if (ageMs <= 30 * 60 * 1000) return "stale";
  return "expired";
}

function mobileDigest(html, panel, mobileTerminal, liteHtml = "", ultraHtml = "") {
  const htmlHash = crypto.createHash("sha1").update(html).digest("hex").slice(0, 12);
  const liteHash = crypto.createHash("sha1").update(liteHtml || "").digest("hex").slice(0, 12);
  const ultraHash = crypto.createHash("sha1").update(ultraHtml || "").digest("hex").slice(0, 12);
  return {
    ok: true,
    source: "mobile-digest",
    fragmentVersion: MOBILE_AI_FRAGMENT_VERSION,
    updatedAt: new Date().toISOString(),
    aiHash: htmlHash,
    htmlHash,
    htmlBytes: Buffer.byteLength(html),
    liteHash,
    liteBytes: Buffer.byteLength(liteHtml || ""),
    ultraHash,
    ultraBytes: Buffer.byteLength(ultraHtml || ""),
    aiUpdatedAt: panel?.updatedAt || "",
    freshness: mobileAiFreshness(panel?.updatedAt || ""),
    mobileHash: hashPayload(mobileTerminal),
    mobileUpdatedAt: mobileTerminal?.updatedAt || "",
    breadthHash: hashPayload(panel?.breadth || {}),
    bias: panel?.summary?.bias || panel?.breadth?.bias || "",
  };
}

function mobileBootLatest(mobileTerminal, digest, fragments = {}) {
  return {
    ok: true,
    source: "mobile-boot",
    updatedAt: new Date().toISOString(),
    lowPower: {
      defaultVariant: "lite",
      lowEndVariant: "ultra",
      digestPollMs: 60000,
      fullHtmlBudget: 30000,
      liteHtmlBudget: 16000,
      ultraHtmlBudget: 9000,
    },
    fragments: Object.fromEntries(Object.entries(fragments).map(([key, item]) => [key, {
      url: "/" + item.file.replace(/\\/g, "/"),
      hash: crypto.createHash("sha1").update(item.html || "").digest("hex").slice(0, 12),
      bytes: Buffer.byteLength(item.html || ""),
    }])),
    digest: {
      fragmentVersion: digest?.fragmentVersion || MOBILE_AI_FRAGMENT_VERSION,
      freshness: digest?.freshness || "expired",
      aiUpdatedAt: digest?.aiUpdatedAt || "",
      aiHash: digest?.aiHash || "",
      liteHash: digest?.liteHash || "",
      ultraHash: digest?.ultraHash || "",
      htmlBytes: cleanNumber(digest?.htmlBytes),
      liteBytes: cleanNumber(digest?.liteBytes),
      ultraBytes: cleanNumber(digest?.ultraBytes),
      bias: digest?.bias || "",
    },
    mobile: mobileTerminal?.mobile || {},
    breadth: mobileTerminal?.breadth || {},
    aiSummary: mobileTerminal?.aiPanel?.summary || {},
    status: {
      updatedAt: mobileTerminal?.status?.updatedAt || "",
    },
  };
}

function mobileFragmentStock(row = {}) {
  const active = row?.activeMatch || row?.mainMatch || {};
  return {
    code: String(row?.code || row?.Code || row?.underlyingCode || ""),
    name: String(row?.name || row?.Name || row?.underlyingName || row?.code || row?.Code || ""),
    percent: cleanNumber(row?.percent ?? row?.pct ?? row?.underlyingPercent),
    score: cleanNumber(row?.score ?? row?.finalScore ?? row?.maxScore ?? row?.swingScore ?? active?.score),
    close: cleanNumber(row?.close ?? row?.underlyingClose),
    value: cleanNumber(row?.value ?? row?.tradeValue ?? row?.callValue),
    label: String(row?.status || row?.actionLabel || row?.signalGrade || row?.stateLabel || active?.short || active?.label || ""),
    reason: String(row?.reason || active?.reason || row?.strategy || row?.source || ""),
  };
}

function mobileFragmentRows(payload, keys = []) {
  const candidates = keys.length ? keys : ["rows", "matches", "events", "records", "top", "singleSignals"];
  for (const key of candidates) {
    const rows = normalizeArray(payload?.[key]);
    if (rows.length) return rows;
  }
  return [];
}

function mobileTerminalFragmentHtml(config = {}) {
  const rows = normalizeArray(config.rows).map(mobileFragmentStock).filter((row) => row.code).slice(0, config.limit || 12);
  const points = normalizeArray(config.points).slice(0, 3);
  const rowHtml = rows.map((row, index) => `
    <article class="mobile-terminal-row">
      <b>#${index + 1}</b>
      <div>
        <h4>${escapeHtml(row.code)} ${escapeHtml(row.name)}</h4>
        <p>${escapeHtml(row.label || config.rowLabel || "掃描命中")}｜${row.score || "--"}｜${row.percent.toFixed(2)}%</p>
        <small>${escapeHtml(row.reason).slice(0, 80)}</small>
      </div>
      <div class="mobile-terminal-actions">
        <button type="button" data-mobile-ai-contract="analyze" data-ai-stock-code="${escapeHtml(row.code)}" data-ai-stock-name="${escapeHtml(row.name)}">看分析</button>
        <button type="button" data-mobile-ai-contract="watch" data-ai-watch-code="${escapeHtml(row.code)}" data-ai-watch-name="${escapeHtml(row.name)}">加入自選</button>
      </div>
    </article>
  `).join("");
  return `
    <section class="mobile-terminal-fragment" data-mobile-terminal-fragment="1" data-mobile-fragment-key="${escapeHtml(config.key || "")}">
      <article class="mobile-terminal-head">
        <small>${escapeHtml(config.kicker || "掃描端結論")}</small>
        <strong>${escapeHtml(config.title || "策略快看")}</strong>
        <p>${escapeHtml(config.subtitle || "手機只顯示掃描完成結果。")}</p>
        <div class="mobile-terminal-stats">
          <span>數量<b>${cleanNumber(config.total || rows.length).toLocaleString("zh-TW")}</b></span>
          <span>更新<b>${escapeHtml(String(config.updatedAt || "").slice(11, 19) || "--")}</b></span>
        </div>
      </article>
      ${points.length ? `<section class="mobile-terminal-points">${points.map((point, index) => `<p><b>${index + 1}</b>${escapeHtml(point)}</p>`).join("")}</section>` : ""}
      <section class="mobile-terminal-list">${rowHtml || '<div class="empty-state">等待掃描完成。</div>'}</section>
    </section>
  `.trim();
}

function mobileStrategyFragments() {
  const openBuy = readOptional("data/open-buy-page-1.json", readOptional("data/open-buy-latest.json", {}));
  const strategy2 = readOptional("data/strategy2-intraday-live-top.json", readOptional("data/strategy2-intraday-top.json", {}));
  const strategy3 = readOptional("data/strategy3-page-1.json", readOptional("data/strategy3-latest.json", {}));
  const strategy4 = readOptional("data/strategy4-score-page-1.json", readOptional("data/strategy4-score-top.json", {}));
  const strategy5 = readOptional("data/strategy5-page-1.json", readOptional("data/strategy5-latest.json", {}));
  const institution = readOptional("data/institution-mobile-top.json", {});
  const warrant = readOptional("data/warrant-flow-mobile-top.json", {});
  const definitions = [
    ["strategy1", "策略1 開盤入", "16:00 候選 / 08:55 最終名單", openBuy, ["rows", "matches"], ["開盤價進場", "有賺就走", "09:10 強制出場"]],
    ["strategy2", "策略2 當沖", "2 分 K 即時偵測摘要", strategy2, ["events", "records"], ["只看進場區", "等待量價確認", "盤中訊號掃描端完成"]],
    ["strategy3", "策略3 日線", "日線條件掃描摘要", strategy3, ["rows", "matches"], ["日線結構", "低頻確認", "不追盤中雜訊"]],
    ["strategy4", "策略4 波段", "主力籌碼與波段分數", strategy4, ["rows", "matches"], ["波段分區", "主力籌碼", "分數排序"]],
    ["strategy5", "策略5 綜合", "籌碼與價量共振", strategy5, ["rows", "matches"], ["多策略共振", "法人與價量", "只顯示預排序"]],
    ["chip", "法人籌碼", "外資/投信/自營合計", institution, ["rows"], ["連買優先", "合計買超", "籌碼集中"]],
    ["warrant", "權證資金", "認購熱度與標的型態", warrant, ["matches", "singleSignals"], ["權證先熱", "標的型態", "只看候選觀察"]],
  ];
  return Object.fromEntries(definitions.map(([key, title, subtitle, payload, keys, points]) => [key, {
    file: `data/mobile-${key}-ultra.html`,
    html: mobileTerminalFragmentHtml({
      key,
      title,
      subtitle,
      points,
      updatedAt: payload?.updatedAt || payload?.date || "",
      total: payloadCount(payload),
      rows: mobileFragmentRows(payload, keys),
    }),
  }]));
}

function slimStocks() {
  const existingCandidates = [runtimeRoot, repoRoot, syncRoot]
    .map((root) => {
      const file = path.join(root, "data/stocks-slim.json");
      if (!fs.existsSync(file)) return null;
      const payload = readJson(file);
      return {
        payload,
        count: Math.max(cleanNumber(payload?.count), normalizeArray(payload?.stocks).length),
        freshness: payloadFreshness(payload, file),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count || b.freshness - a.freshness);
  const completeExisting = existingCandidates.find((item) => item.count >= 1000);
  if (completeExisting) return completeExisting.payload;
  const fallbackExisting = existingCandidates.find((item) => item.count >= 500);
  if (fallbackExisting) {
    console.warn(`[slim] keeping partial stocks cache count=${fallbackExisting.count}; no complete cache found`);
    return fallbackExisting.payload;
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

function warrantQuoteCodes() {
  const warrant = readOptional("data/warrant-flow-latest.json", {});
  return [
    ...normalizeArray(warrant?.matches),
    ...normalizeArray(warrant?.singleSignals),
  ]
    .map((item) => String(item?.underlyingCode || item?.code || "").trim())
    .filter((code) => /^\d{4}$/.test(code));
}

async function enrichStocksWithWarrantMisQuotes(stocks) {
  const codes = warrantQuoteCodes();
  if (!codes.length) return stocks;
  const quotes = await fetchMisQuotes(codes, 60);
  if (!quotes.size) return stocks;
  const byCode = new Map(stocks.map((stock) => [String(stock.code || stock.Code || "").trim(), stock]));
  for (const [code, quote] of quotes) {
    if (!quote?.close || !quote?.quoteDate) continue;
    const existing = byCode.get(code) || {};
    byCode.set(code, {
      ...existing,
      code,
      name: quote.name || existing.name || existing.Name || code,
      market: quote.market || existing.market || existing.Market || "",
      close: quote.close,
      change: quote.change,
      percent: quote.percent,
      tradeVolume: quote.tradeVolume,
      value: quote.value,
      quoteDate: quote.quoteDate,
    });
  }
  return [...byCode.values()];
}

async function stocksIndexFiles(payload = slimStocks()) {
  const stocks = await enrichStocksWithWarrantMisQuotes(normalizeArray(payload?.stocks));
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

function taipeiDateFromIso(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}`;
}

function isAfterTaipei1330(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = Number(part.value || 0);
    return acc;
  }, {});
  const seconds = (parts.hour || 0) * 3600 + (parts.minute || 0) * 60 + (parts.second || 0);
  return seconds > 13 * 3600 + 30 * 60;
}

async function safeUpsertSnapshot(key, payload, options = {}) {
  const result = await upsertSnapshot(key, payload, {
    locked: isAfterTaipei1330(),
    reason: isAfterTaipei1330() ? "after-1330-cache" : "snapshot-cache",
    ...options,
  });
  if (!result.ok && !result.skipped) console.warn(`[snapshot] ${key} upsert skipped: ${result.error}`);
  else if (result.ok) console.log(`[snapshot] ${key} upsert ok tradeDate=${result.tradeDate}`);
}

function statusDateForFile(file, payload) {
  if (file === "strategy5-latest.json") {
    return payload?.generatedDate || taipeiDateFromIso(payload?.updatedAt || payload?.scanStamp) || payload?.usedDate || payload?.date || "";
  }
  return payload?.usedDate || payload?.date || payload?.tradeDate || payload?.resolvedTradeDate || payload?.institutionDate || payload?.scanStamp || "";
}

function dataStatusIndex() {
  const files = [
    "market-summary.json",
    "heatmap-latest.json",
    "health-summary.json",
    "mobile-home-summary.json",
    "market-ai-breadth-latest.json",
    "market-ai-panel-latest.json",
    "mobile-stock-analysis-latest.json",
    "market-ai-live.json",
    "mobile-terminal-latest.json",
    "mobile-digest.json",
    "terminal-home-mobile-slim.json",
    "stocks-slim.json",
    "stocks-index.json",
    "stocks-quotes-slim.json",
    "stocks-quotes-mobile-top.json",
    "strategy-match-index.json",
    "open-buy-latest.json",
    "strategy2-intraday-latest.json",
    "strategy3-latest.json",
    "strategy4-latest.json",
    "strategy4-summary.json",
    "strategy4-slim.json",
    "strategy4-score-top.json",
    "strategy4-zone-b-page-1.json",
    "strategy5-page-1.json",
    "strategy5-latest.json",
    "institution-latest.json",
    "institution-slim.json",
    "institution-mobile-top.json",
    "institution-tdcc-breakout-top.json",
    "cb-detect-latest.json",
    "warrant-flow-latest.json",
    "warrant-flow-slim.json",
    "warrant-priority-top.json",
    "warrant-single-signal-top.json",
    "warrant-flow-mobile-top.json",
    "warrant-flow-page-1.json",
    "realtime-radar-latest.json",
  ];
  const entries = {};
  for (const file of files) {
    const payload = readRepoOptional(`data/${file}`, {});
    entries[file] = {
      ok: payload?.ok !== false,
      status: payload?.status || "",
      source: payload?.source || "",
      date: statusDateForFile(file, payload),
      sourceDate: payload?.sourceDate || payload?.usedDate || "",
      updatedAt: payload?.updatedAt || payload?.scanStamp || "",
      count: payloadCount(payload),
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
    "heatmap-latest.json",
    "mobile-home-summary.json",
    "market-ai-breadth-latest.json",
    "market-ai-panel-latest.json",
    "mobile-stock-analysis-latest.json",
    "market-ai-live.json",
    "mobile-terminal-latest.json",
    "mobile-digest.json",
    "terminal-home-bundle.json",
    "terminal-home-mobile-slim.json",
    "data-status-index.json",
    "stocks-slim.json",
    "stocks-index.json",
    "stocks-quotes-slim.json",
    "stocks-quotes-mobile-top.json",
    "strategy-match-index.json",
    "open-buy-latest.json",
    "strategy2-intraday-latest.json",
    "strategy2-intraday-slim.json",
    "strategy2-intraday-top.json",
    "strategy2-intraday-live-top.json",
    "strategy3-latest.json",
    "strategy4-latest.json",
    "strategy4-summary.json",
    "strategy4-slim.json",
    "strategy4-score-top.json",
    "strategy4-zone-a.json",
    "strategy4-zone-b.json",
    "strategy4-zone-c.json",
    "strategy5-latest.json",
    "strategy5-page-1.json",
    "institution-latest.json",
    "institution-slim.json",
    "institution-mobile-top.json",
    "institution-tdcc-breakout-top.json",
    "cb-detect-latest.json",
    "warrant-flow-latest.json",
    "warrant-flow-slim.json",
    "warrant-priority-top.json",
    "warrant-single-signal-top.json",
    "warrant-flow-mobile-top.json",
    "warrant-flow-page-1.json",
    "realtime-radar-latest.json",
    "afterhours-supabase-status.json",
    "health-summary.json",
    "signal-quality-report.json",
    "data-quality-report.json",
    "data-consistency-report.json",
    "strategy-weight-report.json",
  ];
  for (let page = 1; page <= 48; page += 1) files.push(`strategy4-zone-b-page-${page}.json`);
  for (let page = 1; page <= 48; page += 1) files.push(`strategy4-zone-c-page-${page}.json`);
  for (let page = 1; page <= 24; page += 1) files.push(`open-buy-page-${page}.json`);
  for (let page = 1; page <= 24; page += 1) files.push(`strategy2-intraday-page-${page}.json`);
  for (let page = 1; page <= 24; page += 1) files.push(`strategy3-page-${page}.json`);
  for (let page = 1; page <= 24; page += 1) files.push(`strategy4-score-page-${page}.json`);
  for (let page = 1; page <= 24; page += 1) files.push(`strategy5-page-${page}.json`);
  for (let page = 1; page <= 24; page += 1) files.push(`institution-page-${page}.json`);
  for (let page = 1; page <= 24; page += 1) files.push(`warrant-flow-page-${page}.json`);
  for (let page = 1; page <= 24; page += 1) files.push(`warrant-volume-page-${page}.json`);
  const entries = {};
  for (const file of files) {
    const payload = readRepoOptional(`data/${file}`, null);
    if (!payload) continue;
    const json = JSON.stringify(payload);
    entries[file] = {
      hash: crypto.createHash("sha1").update(json).digest("hex").slice(0, 12),
      bytes: Buffer.byteLength(json),
      updatedAt: payload?.updatedAt || payload?.scanStamp || "",
      date: statusDateForFile(file, payload),
      sourceDate: payload?.sourceDate || payload?.usedDate || "",
      count: payloadCount(payload),
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
  const openBuy = readOptional("data/open-buy-latest.json", {});
  const strategy3 = readOptional("data/strategy3-latest.json", {});
  const strategy4Top = readOptional("data/strategy4-score-top.json", {});
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
        date: strategy5?.generatedDate || taipeiDateFromIso(strategy5?.updatedAt) || strategy5?.usedDate || strategy5?.date || "",
        sourceDate: strategy5?.sourceDate || strategy5?.usedDate || "",
        count: cleanNumber(strategy5?.count || normalizeArray(strategy5?.matches).length),
        top: normalizeArray(strategy5?.matches).slice(0, 12),
      },
    },
  };
}


function terminalHomeMobileSlim() {
  const mobile = readOptional("data/mobile-home-summary.json", mobileHomeSummary());
  const status = readOptional("data/data-status-index.json", dataStatusIndex());
  const stocks = readOptional("data/stocks-quotes-mobile-top.json", {});
  const openBuy = readOptional("data/open-buy-latest.json", {});
  const strategy4Top = readOptional("data/strategy4-score-top.json", {});
  const strategy5 = readOptional("data/strategy5-latest.json", {});
  return {
    ok: true,
    source: "terminal-home-mobile-slim",
    updatedAt: new Date().toISOString(),
    mobile,
    status: {
      updatedAt: status.updatedAt || "",
      entries: Object.fromEntries(Object.entries(status.entries || {}).filter(([key]) => [
        "market-summary.json",
        "live-freshness-ok.json",
        "mobile-home-summary.json",
        "stocks-quotes-mobile-top.json",
        "strategy2-intraday-live-top.json",
        "realtime-radar-latest.json",
        "strategy4-score-top.json",
        "warrant-flow-mobile-top.json",
      ].includes(key))),
    },
    stocks: {
      updatedAt: stocks.updatedAt || "",
      resolvedTradeDate: stocks.resolvedTradeDate || stocks.today || "",
      count: cleanNumber(stocks.count || normalizeArray(stocks.quotes).length),
      top: normalizeArray(stocks.quotes).slice(0, 48),
    },
    strategies: {
      openBuy: {
        updatedAt: openBuy?.updatedAt || "",
        date: openBuy?.usedDate || openBuy?.date || "",
        count: cleanNumber(openBuy?.count || normalizeArray(openBuy?.matches).length),
        top: normalizeArray(openBuy?.matches).slice(0, 6),
      },
      strategy4: {
        updatedAt: strategy4Top?.updatedAt || "",
        date: strategy4Top?.scanStamp || strategy4Top?.date || "",
        count: cleanNumber(strategy4Top?.count || normalizeArray(strategy4Top?.matches).length),
        top: normalizeArray(strategy4Top?.matches).slice(0, 8),
      },
      strategy5: {
        updatedAt: strategy5?.updatedAt || "",
        date: strategy5?.generatedDate || taipeiDateFromIso(strategy5?.updatedAt) || strategy5?.usedDate || strategy5?.date || "",
        sourceDate: strategy5?.sourceDate || strategy5?.usedDate || "",
        count: cleanNumber(strategy5?.count || normalizeArray(strategy5?.matches).length),
        top: normalizeArray(strategy5?.matches).slice(0, 6),
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
      ...normalizeArray(row.matches).flatMap((match) => [match?.label, match?.short, match?.title, match?.name, match?.id].map(signalText)),
    ],
    realtime: [
      row.signal,
      row.reason,
      ...normalizeArray(row.signalTags).map(signalText),
    ],
    institution: [
      row.total > 0 ? "法人合計買超" : row.total < 0 ? "法人合計賣超" : "法人中性",
      row.foreign > 0 ? "外資買超" : row.foreign < 0 ? "外資賣超" : "",
      row.trust > 0 ? "投信買超" : row.trust < 0 ? "投信賣超" : "",
      row.jointStreak ? `連買${row.jointStreak}日` : "",
    ],
    cb: [
      row.entryLabel,
      row.tradableLabel,
      row.conversionPriceLabel,
      row.sourceLayer,
      row.cbName,
    ],
    warrant: [
      row.signalGrade ? `等級${row.signalGrade}` : "",
      row.actionLabel,
      row.stockSetupLabel,
      row.branchLabel,
      row.level ? `Level ${row.level}` : "",
    ],
  };
  return [...new Set((sources[key] || []).map(signalText).map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 12);
}

function buildStrategyMatchIndex() {
  const definitions = [
    { key: "openBuy", label: "策略1-明日開盤入", file: "data/open-buy-latest.json", fields: ["matches"] },
    { key: "strategy2", label: "策略2-當沖雷達", file: "data/strategy2-intraday-slim.json", fallbackFile: "data/strategy2-intraday-top.json", fields: ["events", "records"] },
    { key: "strategy3", label: "策略3-隔日沖", file: "data/strategy3-latest.json", fields: ["matches"] },
    { key: "strategy4", label: "策略4-波段", file: "data/strategy4-slim.json", fields: ["matches"] },
    { key: "strategy5", label: "策略5-綜合策略", file: "data/strategy5-latest.json", fields: ["matches"] },
    { key: "realtime", label: "即時雷達", file: "data/realtime-radar-latest.json", fields: ["rows"] },
    { key: "institution", label: "買賣超", file: "data/institution-latest.json", fields: ["data", "rows", "matches"], objectFields: ["data"] },
    { key: "cb", label: "CB名單", file: "data/cb-detect-latest.json", fields: ["rows", "matches"] },
    { key: "warrant", label: "權證", file: "data/warrant-flow-latest.json", fields: ["matches", "rows"], codeField: "underlyingCode" },
  ];
  const byCode = {};
  const strategies = {};
  for (const def of definitions) {
    const payload = readRepoOptional(def.file, def.fallbackFile ? readRepoOptional(def.fallbackFile, {}) : {});
    const rows = indexRowsFromPayload(payload, def);
    const date = payload?.usedDate || payload?.date || payload?.tradeDate || payload?.scanStamp || payload?.updatedAt || "";
    strategies[def.key] = {
      label: def.label,
      file: def.file,
      date,
      updatedAt: payload?.updatedAt || payload?.scanStamp || "",
      count: rows.length,
    };
    for (const row of rows) {
      const code = String(row?.[def.codeField || "code"] || row.code || "").trim();
      if (!code) continue;
      const entry = {
        key: def.key,
        label: def.label,
        score: cleanNumber(row.score || row.maxScore || row.swingScore || row.finalScore || row.total),
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

async function writeStrategyMatchIndexSnapshot() {
  const strategyMatchIndex = buildStrategyMatchIndex();
  writeToBoth("data/strategy-match-index.json", strategyMatchIndex);
  await safeUpsertSnapshot("watchlist_match_index", strategyMatchIndex, {
    source: "data/strategy-match-index.json",
    snapshotId: `watchlist-match-index-${String(strategyMatchIndex.updatedAt || Date.now()).replace(/\D/g, "").slice(0, 14)}`,
  });
  console.log(`[slim] wrote data/strategy-match-index.json codes=${strategyMatchIndex.count || 0}`);
  return strategyMatchIndex;
}

const jobs = [
  ["strategy2", "data/strategy2-intraday-latest.json", "data/strategy2-intraday-slim.json", slimStrategy2, (payload) => [
    ["data/strategy2-intraday-top.json", topStrategy2(payload)],
    ["data/strategy2-intraday-live-top.json", liveTopStrategy2(payload)],
    ["data/strategy2-intraday-delta.json", deltaStrategy2(payload)],
  ]],
  ["institution", "data/institution-latest.json", "data/institution-slim.json", slimInstitution, (payload) => [...institutionPresetFiles(payload), ...institutionPageFiles(payload), ["data/institution-mobile-top.json", mobileInstitutionTop(payload)]]],
  ["warrant", "data/warrant-flow-latest.json", "data/warrant-flow-slim.json", slimWarrant, (payload) => [...warrantPresetFiles(payload), ...warrantPageFiles(payload), ["data/warrant-flow-mobile-top.json", mobileWarrantTop(payload)]]],
];

async function main() {
  let wrote = 0;
  for (const [name, input, output, build, presets] of jobs) {
    const payloadSource = readOptional(input);
    if (!payloadSource) {
      console.log(`[slim] skip ${name}: source not found`);
      continue;
    }
    const payload = build(payloadSource);
    writeToBoth(output, payload);
    for (const [presetOutput, presetPayload] of presets(payloadSource)) {
      writeToBoth(presetOutput, presetPayload);
      console.log(`[slim] wrote ${presetOutput} count=${presetPayload.count || presetPayload.rows?.length || presetPayload.matches?.length || 0}`);
    }
    wrote += 1;
    console.log(`[slim] wrote ${output} count=${payload.count || Object.keys(payload.data || {}).length}`);
  }
  await writeStrategyMatchIndexSnapshot();
  if (wrote) {
    const mobileSummary = mobileHomeSummary();
    writeToBoth("data/mobile-home-summary.json", mobileSummary);
    const marketAiBreadth = marketAiBreadthLatest(mobileSummary);
    writeToBoth("data/market-ai-breadth-latest.json", marketAiBreadth);
    console.log(`[slim] wrote data/mobile-home-summary.json strategy2=${mobileSummary.strategy2.count || 0} chip=${mobileSummary.chip.count || 0} warrant=${mobileSummary.warrant.count || 0}`);
    console.log(`[slim] wrote data/market-ai-breadth-latest.json sample=${marketAiBreadth.sample || 0} up=${marketAiBreadth.up || 0} down=${marketAiBreadth.down || 0}`);
    const stocksSlim = slimStocks();
    writeToBoth("data/stocks-slim.json", stocksSlim);
    console.log(`[slim] wrote data/stocks-slim.json count=${stocksSlim.count || 0}`);
    for (const [stockOutput, stockPayload] of await stocksIndexFiles(stocksSlim)) {
      writeToBoth(stockOutput, stockPayload);
      console.log(`[slim] wrote ${stockOutput} count=${stockPayload.count || 0}`);
    }
    const warrantSource = readOptional("data/warrant-flow-latest.json");
    if (warrantSource) {
      const warrantSlim = slimWarrant(warrantSource);
      writeToBoth("data/warrant-flow-slim.json", warrantSlim);
      for (const [presetOutput, presetPayload] of warrantPresetFiles(warrantSource)) {
        writeToBoth(presetOutput, presetPayload);
        console.log(`[slim] refreshed ${presetOutput} count=${presetPayload.count || presetPayload.rows?.length || presetPayload.matches?.length || 0}`);
      }
      writeToBoth("data/warrant-flow-mobile-top.json", mobileWarrantTop(warrantSource));
      console.log(`[slim] refreshed data/warrant-flow-slim.json count=${warrantSlim.count || 0}`);
    }
    const refreshedMobileSummary = mobileHomeSummary();
    writeToBoth("data/mobile-home-summary.json", refreshedMobileSummary);
    const refreshedMarketAiBreadth = marketAiBreadthLatest(refreshedMobileSummary);
    writeToBoth("data/market-ai-breadth-latest.json", refreshedMarketAiBreadth);
    const marketAiLive = marketAiLiveCache();
    writeToBoth("data/market-ai-live.json", marketAiLive);
    await safeUpsertSnapshot("market_ai_live", marketAiLive, {
      source: "data/market-ai-live.json",
      snapshotId: marketAiLive.runId || `market-ai-live-${marketAiLive.updatedAt || Date.now()}`,
    });
    const marketAiPanel = marketAiPanelLatest();
    writeToBoth("data/market-ai-panel-latest.json", marketAiPanel);
    const mobileStockAnalysis = mobileStockAnalysisLatest(marketAiPanel);
    writeToBoth("data/mobile-stock-analysis-latest.json", mobileStockAnalysis);
    const mobileAnalysisFileCount = writeMobileStockAnalysisFiles(mobileStockAnalysis);
    console.log(`[slim] refreshed data/mobile-home-summary.json strategy2=${refreshedMobileSummary.strategy2.count || 0} chip=${refreshedMobileSummary.chip.count || 0} warrant=${refreshedMobileSummary.warrant.count || 0}`);
    console.log(`[slim] refreshed data/market-ai-breadth-latest.json sample=${refreshedMarketAiBreadth.sample || 0} up=${refreshedMarketAiBreadth.up || 0} down=${refreshedMarketAiBreadth.down || 0}`);
    console.log(`[slim] wrote data/market-ai-live.json strategy2=${marketAiLive.summary.strategy2Count || 0} radar=${marketAiLive.summary.realtimeRadarCount || 0}`);
    console.log(`[slim] wrote data/market-ai-panel-latest.json priority=${marketAiPanel.priorityStocks?.length || 0} risk=${marketAiPanel.riskStocks?.length || 0}`);
    console.log(`[slim] wrote data/mobile-stock-analysis-latest.json count=${mobileStockAnalysis.count || 0}`);
    console.log(`[slim] wrote data/mobile-analysis/*.json count=${mobileAnalysisFileCount}`);
    for (const [pageOutput, pagePayload] of strategyPresetPageFiles()) {
      writeToBoth(pageOutput, pagePayload);
      if (pagePayload.page === 1) console.log(`[slim] wrote ${pageOutput} total=${pagePayload.totalCount || 0}`);
    }
    const statusIndex = dataStatusIndex();
    writeToBoth("data/data-status-index.json", statusIndex);
    console.log(`[slim] wrote data/data-status-index.json files=${Object.keys(statusIndex.entries || {}).length}`);
    const homeBundle = terminalHomeBundle();
    writeToBoth("data/terminal-home-bundle.json", homeBundle);
    console.log(`[slim] wrote data/terminal-home-bundle.json stocks=${homeBundle.stocks.count || 0}`);
    const mobileSlimBundle = terminalHomeMobileSlim();
    writeToBoth("data/terminal-home-mobile-slim.json", mobileSlimBundle);
    console.log(`[slim] wrote data/terminal-home-mobile-slim.json stocks=${mobileSlimBundle.stocks.count || 0}`);
    const manifest = dataManifest();
    writeToBoth("data/data-manifest.json", manifest);
    console.log(`[slim] wrote data/data-manifest.json files=${manifest.count || 0}`);
    const mobileTerminal = mobileTerminalLatest();
    writeToBoth("data/mobile-terminal-latest.json", mobileTerminal);
    console.log(`[slim] wrote data/mobile-terminal-latest.json ai=${mobileTerminal.aiPanel?.priorityStocks?.length || 0} strategy5=${mobileTerminal.strategy5?.count || 0}`);
    const mobileAiHtml = mobileAiLatestHtml(marketAiPanel);
    writeTextToBoth("data/mobile-ai-latest.html", mobileAiHtml);
    const mobileAiLite = mobileAiLiteHtml(marketAiPanel);
    writeTextToBoth("data/mobile-ai-lite.html", mobileAiLite);
    const mobileAiUltra = mobileAiUltraHtml(marketAiPanel);
    writeTextToBoth("data/mobile-ai-ultra.html", mobileAiUltra);
    const digest = mobileDigest(mobileAiHtml, marketAiPanel, mobileTerminal, mobileAiLite, mobileAiUltra);
    writeToBoth("data/mobile-digest.json", digest);
    const strategyFragments = mobileStrategyFragments();
    for (const fragment of Object.values(strategyFragments)) {
      writeTextToBoth(fragment.file, fragment.html);
    }
    const mobileBoot = mobileBootLatest(mobileTerminal, digest, strategyFragments);
    writeToBoth("data/mobile-boot.json", mobileBoot);
    console.log(`[slim] wrote data/mobile-ai-latest.html bytes=${Buffer.byteLength(mobileAiHtml)} hash=${digest.aiHash}`);
    console.log(`[slim] wrote data/mobile-ai-lite.html bytes=${Buffer.byteLength(mobileAiLite)} hash=${digest.liteHash}`);
    console.log(`[slim] wrote data/mobile-ai-ultra.html bytes=${Buffer.byteLength(mobileAiUltra)} hash=${digest.ultraHash}`);
    console.log(`[slim] wrote data/mobile-digest.json aiHash=${digest.aiHash} bias=${digest.bias}`);
    console.log(`[slim] wrote data/mobile-boot.json variant=${mobileBoot.lowPower.lowEndVariant} ultraBytes=${mobileBoot.digest.ultraBytes}`);
    console.log(`[slim] wrote mobile strategy fragments count=${Object.keys(strategyFragments).length}`);
    const finalStatusIndex = dataStatusIndex();
    writeToBoth("data/data-status-index.json", finalStatusIndex);
    const finalManifest = dataManifest();
    writeToBoth("data/data-manifest.json", finalManifest);
    console.log(`[slim] finalized data-manifest.json files=${finalManifest.count || 0}`);
  }
  if (!wrote) console.log("[slim] no legacy slim jobs wrote; API-only snapshot outputs refreshed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});


