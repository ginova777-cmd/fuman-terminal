const fs = require("fs");
const path = require("path");

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function slimStrategy4Match(item) {
  return {
    code: String(item.code || ""),
    name: String(item.name || item.code || ""),
    close: cleanNumber(item.close),
    percent: cleanNumber(item.percent),
    tradeVolume: cleanNumber(item.tradeVolume),
    value: cleanNumber(item.value),
    swingScore: cleanNumber(item.swingScore || item.score),
    swingZone: item.swingZone || "A",
    swingStage: item.swingStage || item.stage || null,
    swingSignals: Array.isArray(item.swingSignals || item.signals)
      ? (item.swingSignals || item.signals).slice(0, 4).map((signal) => ({
        id: signal.id || "",
        title: signal.title || "",
        short: signal.short || "",
        icon: signal.icon || "",
        reason: signal.reason || "",
      }))
      : [],
  };
}

function buildStrategy4Summary(payload) {
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];
  const zoneCounts = { A: 0, B: 0, C: 0 };
  const signalCounts = {};
  for (const item of matches) {
    const zone = item.swingZone || "A";
    zoneCounts[zone] = (zoneCounts[zone] || 0) + 1;
    for (const signal of item.swingSignals || item.signals || []) {
      const id = signal.id || signal.short || signal.title || "unknown";
      signalCounts[id] = (signalCounts[id] || 0) + 1;
    }
  }
  const topMatches = [...matches]
    .sort((a, b) => cleanNumber(b.swingScore || b.score) - cleanNumber(a.swingScore || a.score))
    .slice(0, 60)
    .map(slimStrategy4Match);
  return {
    ok: Boolean(payload?.ok ?? true),
    source: payload?.source || "",
    updatedAt: payload?.updatedAt || "",
    scanStamp: payload?.scanStamp || "",
    total: cleanNumber(payload?.total),
    scannedCount: Array.isArray(payload?.scannedCodes) ? payload.scannedCodes.length : cleanNumber(payload?.scannedCount),
    count: cleanNumber(payload?.count || matches.length),
    complete: Boolean(payload?.complete),
    qualityStatus: payload?.qualityStatus || "",
    zoneCounts,
    signalCounts,
    topMatches,
  };
}

function slimInstitutionRow(row, code) {
  return {
    code,
    name: row.name || code,
    close: cleanNumber(row.close),
    percent: cleanNumber(row.percent),
    value: cleanNumber(row.value),
    foreign: cleanNumber(row.foreign),
    trust: cleanNumber(row.trust),
    dealer: cleanNumber(row.dealer),
    total: cleanNumber(row.total),
    foreignStreak: cleanNumber(row.foreignStreak),
    trustStreak: cleanNumber(row.trustStreak),
    jointStreak: cleanNumber(row.jointStreak),
    fiveDayPctSum: cleanNumber(row.fiveDayPctSum),
    fiveDayAvgVolume: cleanNumber(row.fiveDayAvgVolume),
  };
}

function buildInstitutionSummary(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const rows = Object.entries(data).map(([code, row]) => slimInstitutionRow(row || {}, code));
  const byJoint = [...rows].sort((a, b) => b.jointStreak - a.jointStreak || (b.foreign + b.trust) - (a.foreign + a.trust)).slice(0, 60);
  const byTrust = [...rows].sort((a, b) => b.trust - a.trust).slice(0, 60);
  const byForeign = [...rows].sort((a, b) => b.foreign - a.foreign).slice(0, 60);
  return {
    ok: Boolean(payload?.ok ?? true),
    source: payload?.source || "",
    updatedAt: payload?.updatedAt || "",
    usedDate: payload?.usedDate || "",
    quoteUpdatedAt: payload?.quoteUpdatedAt || "",
    count: cleanNumber(payload?.count || rows.length),
    topJoint: byJoint,
    topTrust: byTrust,
    topForeign: byForeign,
  };
}

function slimWarrantMatch(item) {
  const code = String(item.underlyingCode || item.code || "");
  return {
    code,
    name: String(item.underlyingName || item.name || code),
    stockClose: cleanNumber(item.underlyingClose ?? item.close ?? item.stockClose),
    stockPercent: cleanNumber(item.underlyingPercent ?? item.percent ?? item.stockPercent),
    callValue: cleanNumber(item.callValue),
    putValue: cleanNumber(item.putValue),
    callCount: cleanNumber(item.callCount),
    putCount: cleanNumber(item.putCount),
    callPutRatio: cleanNumber(item.callPutRatio),
    score: cleanNumber(item.score),
    tradeDate: item.tradeDate || "",
    reason: item.reason || "",
  };
}

function slimSingleWarrantSignal(item) {
  const code = String(item.underlyingCode || item.code || "");
  return {
    code,
    name: String(item.underlyingName || item.name || code),
    warrantCode: String(item.warrantCode || ""),
    warrantName: String(item.warrantName || ""),
    stockClose: cleanNumber(item.underlyingClose ?? item.close ?? item.stockClose),
    stockPercent: cleanNumber(item.underlyingPercent ?? item.percent ?? item.stockPercent),
    value: cleanNumber(item.value),
    volume: cleanNumber(item.volume),
    strike: cleanNumber(item.strike),
    daysToExpiry: cleanNumber(item.daysToExpiry),
    moneynessPct: cleanNumber(item.moneynessPct),
    signalCount: cleanNumber(item.signalCount),
    largeSignalCount: cleanNumber(item.largeSignalCount),
    estimatedLargeSignalCount: cleanNumber(item.estimatedLargeSignalCount),
    maxSignalValue: cleanNumber(item.maxSignalValue),
    totalSignalValue: cleanNumber(item.totalSignalValue),
    hasRepeatLargeSignal: Boolean(item.hasRepeatLargeSignal),
    score: cleanNumber(item.score),
    signalGrade: item.signalGrade || "",
    actionLabel: item.actionLabel || "",
    tradeDate: item.tradeDate || "",
    reason: item.reason || "",
  };
}

function buildWarrantFlowSummary(payload) {
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];
  const singleSignals = Array.isArray(payload?.singleSignals) ? payload.singleSignals : [];
  const topMatches = [...matches]
    .sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score) || cleanNumber(b.callValue) - cleanNumber(a.callValue))
    .slice(0, 80)
    .map(slimWarrantMatch);
  const topSingleSignals = [...singleSignals]
    .sort((a, b) =>
      Number(b.hasRepeatLargeSignal) - Number(a.hasRepeatLargeSignal) ||
      cleanNumber(b.estimatedLargeSignalCount) - cleanNumber(a.estimatedLargeSignalCount) ||
      cleanNumber(b.score) - cleanNumber(a.score) ||
      cleanNumber(b.value) - cleanNumber(a.value)
    )
    .slice(0, 40)
    .map(slimSingleWarrantSignal);
  const tradeDates = [...new Set(matches.map((item) => String(item.tradeDate || "")).filter(Boolean))].sort();
  return {
    ok: Boolean(payload?.ok ?? true),
    source: payload?.source || "",
    updatedAt: payload?.updatedAt || "",
    runId: payload?.runId || payload?.transport?.runId || "",
    complete: Boolean(payload?.complete),
    qualityStatus: payload?.qualityStatus || "",
    tradeDate: payload?.tradeDate || payload?.sourceDate || payload?.usedDate || "",
    newestTradeDate: tradeDates.at(-1) || "",
    count: cleanNumber(payload?.count || matches.length),
    volumeCount: cleanNumber(payload?.volumeCount),
    singleSignalCount: cleanNumber(payload?.singleSignalCount || singleSignals.length),
    topMatches,
    topSingleSignals,
  };
}

function buildSummary(kind, payload) {
  if (kind === "strategy4") return buildStrategy4Summary(payload);
  if (kind === "institution") return buildInstitutionSummary(payload);
  if (kind === "warrant") return buildWarrantFlowSummary(payload);
  throw new Error(`Unknown summary kind: ${kind}`);
}

function writeSummary(kind, payload, outFile) {
  const summary = buildSummary(kind, payload);
  writeJson(outFile, summary);
  return summary;
}

module.exports = {
  buildSummary,
  writeSummary,
};
