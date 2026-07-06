const fs = require("fs");
const path = require("path");
const { readSnapshot } = require("../lib/supabase-snapshots");

const SNAPSHOT_KEY = process.env.FUMAN_SCORECARD_SNAPSHOT_KEY || "scorecard_latest";
const SNAPSHOT_FILE = path.join(process.cwd(), "data", "scorecard-latest.json");
const SCORECARD_CONTRACT = "scorecard-resource-chain-v1";

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function isoDate(value) {
  const text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function compactDate(value) {
  return cleanText(value).replace(/\D/g, "").slice(0, 8);
}

function compactTimestamp(value) {
  return cleanText(value).replace(/\D/g, "").slice(0, 14);
}

function createCaptureResponse(resolve) {
  let settled = false;
  const done = (statusCode, payload) => {
    if (settled) return;
    settled = true;
    resolve({ statusCode, payload });
  };
  return {
    statusCode: 200,
    setHeader() {},
    status(code) {
      this.statusCode = Number(code) || 200;
      return this;
    },
    json(payload) {
      done(this.statusCode || 200, payload);
      return this;
    },
    send(payload) {
      done(this.statusCode || 200, payload);
      return this;
    },
    end(payload = "") {
      done(this.statusCode || 204, payload);
      return this;
    },
  };
}

function callStrategy3Latest(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./strategy3-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        limit: "60",
      };
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "strategy3_source_report_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/strategy3-latest?canvas=1&compact=1&shell=1&live=1&limit=60",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "strategy3_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "strategy3_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function buildStrategy3SourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  return {
    key: "strategy3",
    strategy: "策略3隔日沖成績單",
    endpoint: "/api/strategy3-latest",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || payload.transport?.runId),
    count: cleanNumber(payload.count ?? payload.resultCount ?? payload.total),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : Array.isArray(payload.matches) ? payload.matches.length : 0,
    date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
    evidenceStatus: cleanText(payload.evidenceStatus || quality.evidenceStatus),
    unattendedStatus: cleanText(payload.unattendedStatus || quality.unattendedStatus),
    publishAllowed: payload.publishAllowed === true || quality.publishAllowed === true,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
    reason: cleanText(payload.reason || payload.detail || payload.error || payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
  };
}

function mergeSourceReport(payload, report) {
  const reports = Array.isArray(payload?.sourceReports) ? [...payload.sourceReports] : [];
  const index = reports.findIndex((item) => cleanText(item?.key).toLowerCase() === cleanText(report?.key).toLowerCase());
  if (index >= 0) reports[index] = { ...reports[index], ...report };
  else reports.push(report);
  return { ...payload, sourceReports: reports };
}

async function withLiveStrategy3SourceReport(payload) {
  const result = await callStrategy3Latest();
  return mergeSourceReport(payload, buildStrategy3SourceReport(result));
}

function withScorecardContract(payload, status, reason = "") {
  const latestDate = isoDate(payload?.latestDate || payload?.summary?.latestDate || "");
  const snapshotTradeDate = cleanText(payload?.snapshot?.tradeDate || "");
  const marketDate = latestDate || (snapshotTradeDate.length === 8
    ? `${snapshotTradeDate.slice(0, 4)}-${snapshotTradeDate.slice(4, 6)}-${snapshotTradeDate.slice(6, 8)}`
    : "");
  const runDate = compactDate(marketDate || snapshotTradeDate || payload?.updatedAt || "");
  const runStamp = compactTimestamp(payload?.updatedAt || payload?.snapshot?.updatedAt || "");
  return {
    ...payload,
    contract: cleanText(payload?.contract || SCORECARD_CONTRACT),
    qualityStatus: cleanText(payload?.qualityStatus || status),
    marketDate: cleanText(payload?.marketDate || marketDate || latestDate),
    runId: cleanText(payload?.runId || `scorecard-${runDate || "unknown"}-${runStamp || "snapshot"}`),
    fallbackReason: cleanText(payload?.fallbackReason || reason),
  };
}

function historyDates(records) {
  return [...new Set((Array.isArray(records) ? records : [])
    .map((row) => cleanText(row.record_date))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))]
    .sort()
    .reverse();
}

function summarize(records, dailyRows, latestDate) {
  const rows = Array.isArray(records) ? records : [];
  const wins = rows.filter((row) => cleanNumber(row.pnl) > 0).length;
  const losses = rows.filter((row) => cleanNumber(row.pnl) < 0).length;
  const flats = rows.length - wins - losses;
  const totalPnl = rows.reduce((sum, row) => sum + cleanNumber(row.pnl), 0);
  const grouped = new Map();
  rows.forEach((row) => {
    const strategy = cleanText(row.strategy || "未分類") || "未分類";
    grouped.set(strategy, [...(grouped.get(strategy) || []), row]);
  });
  const byStrategy = [...grouped.entries()].map(([strategy, items]) => {
    const strategyWins = items.filter((row) => cleanNumber(row.pnl) > 0).length;
    const strategyLosses = items.filter((row) => cleanNumber(row.pnl) < 0).length;
    const strategyPnl = items.reduce((sum, row) => sum + cleanNumber(row.pnl), 0);
    return {
      strategy,
      rows: items.length,
      wins: strategyWins,
      losses: strategyLosses,
      flats: items.length - strategyWins - strategyLosses,
      winRate: items.length ? (strategyWins / items.length) * 100 : 0,
      pnl: strategyPnl,
    };
  }).sort((a, b) => b.pnl - a.pnl || b.rows - a.rows);
  return {
    latestDate,
    rows: rows.length,
    wins,
    losses,
    flats,
    winRate: rows.length ? (wins / rows.length) * 100 : 0,
    totalPnl,
    byStrategy,
    daily: Array.isArray(dailyRows) ? dailyRows : [],
  };
}

function selectPayloadDate(payload, requestedDate = "") {
  const allRecords = Array.isArray(payload?.records) ? payload.records : [];
  const dates = historyDates(allRecords);
  const selectedDate = dates.includes(requestedDate) ? requestedDate : (isoDate(payload?.latestDate) || dates[0] || "");
  const records = selectedDate ? allRecords.filter((row) => cleanText(row.record_date) === selectedDate) : allRecords;
  const allDaily = Array.isArray(payload?.summary?.daily) ? payload.summary.daily : [];
  const daily = selectedDate ? allDaily.filter((row) => cleanText(row.summary_date) === selectedDate) : allDaily;
  const sourceReports = Array.isArray(payload?.sourceReports) ? payload.sourceReports : [];
  return {
    ...payload,
    latestDate: selectedDate || payload.latestDate || "",
    selectedDate: selectedDate || payload.latestDate || "",
    historyLatestDate: dates[0] || payload.latestDate || "",
    historyDates: dates,
    records,
    sourceReports,
    summary: summarize(records, daily, selectedDate || payload.latestDate || ""),
  };
}

function readStaticSnapshot(reason = "scorecard_static_snapshot") {
  const raw = fs.readFileSync(SNAPSHOT_FILE, "utf8");
  const payload = JSON.parse(raw);
  return withScorecardContract({
    ok: payload.ok !== false,
    ...payload,
    cacheSource: "json-snapshot",
    fallbackReason: reason,
  }, "degraded", reason);
}

async function buildPayload(requestedDate = "") {
  const snapshot = await readSnapshot(SNAPSHOT_KEY, { allowLatestFallback: true, timeoutMs: 30000 }).catch(() => null);
  if (snapshot?.payload && typeof snapshot.payload === "object") {
    const payload = await withLiveStrategy3SourceReport(withScorecardContract({
      ok: snapshot.payload.ok !== false,
      ...snapshot.payload,
      source: snapshot.payload.source || "supabase:scorecard_snapshot",
      cacheSource: "supabase-snapshot",
      snapshot: {
        key: snapshot.key || SNAPSHOT_KEY,
        tradeDate: snapshot.tradeDate || "",
        updatedAt: snapshot.updatedAt || "",
        source: snapshot.source || "",
      },
    }, "complete"));
    return selectPayloadDate(payload, requestedDate);
  }
  return selectPayloadDate(await withLiveStrategy3SourceReport(readStaticSnapshot("supabase_scorecard_snapshot_missing")), requestedDate);
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  try {
    const requestedDate = isoDate(request.query?.date || request.query?.record_date || "");
    const payload = await buildPayload(requestedDate);
    if (request.method === "HEAD") response.status(200).end("");
    else response.status(200).json(payload);
  } catch (error) {
    response.status(503).json({ ok: false, error: "scorecard_unavailable", reason: error?.message || String(error), updatedAt: new Date().toISOString() });
  }
};
