"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_FILE = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length)
  || path.join(RUNTIME_DIR, "data", "scorecard-terminal-current.json");

const TASKS = [
  {
    key: "strategy1",
    strategy: "策略1開盤入成績單",
    endpoint: "/api/open-buy-latest",
    modulePath: "../api/open-buy-latest",
    arrayKeys: ["matches", "rows", "buyMatches"],
    limit: 120,
  },
  {
    key: "strategy3",
    strategy: "策略3隔日沖成績單",
    endpoint: "/api/strategy3-latest",
    modulePath: "../api/strategy3-latest",
    arrayKeys: ["matches", "rows"],
    limit: 120,
  },
  {
    key: "strategy4",
    strategy: "策略4成績單",
    endpoint: "/api/strategy4-latest",
    modulePath: "../api/strategy4-latest",
    arrayKeys: ["matches", "rows"],
    limit: 120,
  },
  {
    key: "strategy5",
    strategy: "策略5成績單",
    endpoint: "/api/strategy5-latest",
    modulePath: "../api/strategy5-latest",
    arrayKeys: ["matches", "rows"],
    limit: 120,
  },
  {
    key: "institution",
    strategy: "買賣超成績單",
    endpoint: "/api/institution-latest",
    modulePath: "../api/institution-latest",
    arrayKeys: ["rows", "matches"],
    limit: 120,
  },
  {
    key: "cb",
    strategy: "CB成績單",
    endpoint: "/api/cb-detect-latest",
    modulePath: "../api/cb-detect-latest",
    arrayKeys: ["rows", "matches"],
    limit: 120,
  },
  {
    key: "warrant",
    strategy: "權證成績單",
    endpoint: "/api/warrant-flow-latest",
    modulePath: "../api/warrant-flow-latest",
    arrayKeys: ["rows", "matches", "volumeMatches", "singleSignals"],
    limit: 120,
  },
];

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function taipeiDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isoDate(value, fallback = taipeiDate()) {
  const text = cleanText(value);
  if (!text) return fallback;
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{1,2}\/\d{1,2}$/.test(text)) {
    const [month, day] = text.split("/");
    return `${fallback.slice(0, 4)}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return fallback;
}

function buildEndpoint(endpoint, query = {}) {
  const url = new URL(endpoint, "https://fuman.local");
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

function createCaptureResponse(resolve, label) {
  let settled = false;
  const done = (statusCode, payload, headers = {}) => {
    if (settled) return;
    settled = true;
    resolve({ statusCode, payload, headers, label });
  };
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = Number(code) || 200;
      return this;
    },
    json(payload) {
      done(this.statusCode || 200, payload, this.headers);
      return this;
    },
    send(payload) {
      done(this.statusCode || 200, payload, this.headers);
      return this;
    },
    end(payload = "") {
      done(this.statusCode || 204, payload, this.headers);
      return this;
    },
  };
}

function callApi(task, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const handler = require(task.modulePath);
    const query = {
      canvas: "1",
      compact: "1",
      shell: "1",
      live: "1",
      limit: String(task.limit || 120),
    };
    const endpoint = buildEndpoint(task.endpoint, query);
    const timer = setTimeout(() => {
      resolve({
        statusCode: 504,
        payload: { ok: false, error: "scorecard_source_api_timeout", endpoint },
        label: endpoint,
      });
    }, timeoutMs);
    const finish = (result) => {
      clearTimeout(timer);
      resolve(result);
    };
    const request = {
      method: "GET",
      url: endpoint,
      headers: { host: "localhost", "x-scorecard-source": "1" },
      query,
    };
    Promise.resolve(handler(request, createCaptureResponse(finish, endpoint))).catch((error) => {
      finish({
        statusCode: 500,
        payload: { ok: false, error: "scorecard_source_api_failed", message: error?.message || String(error), endpoint },
        label: endpoint,
      });
    });
  });
}

function arraysFromTaskPayload(task, payload) {
  let selected = [];
  let selectedKey = "";
  for (const key of task.arrayKeys || []) {
    if (Array.isArray(payload?.[key])) {
      selected = payload[key];
      selectedKey = key;
      if (selected.length) break;
    }
  }
  const rows = selected.map((row) => ({ ...row, _scorecardArrayKey: selectedKey || "rows" }));
  if (!rows.length && payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    for (const [code, row] of Object.entries(payload.data)) rows.push({ ...(row || {}), code });
  }
  const seen = new Set();
  return rows.filter((row, index) => {
    const code = cleanText(row.code || row.symbol || row.ticker || row.underlyingCode || row.cbCode || row.warrantCode || index);
    const key = `${row._scorecardArrayKey || "rows"}:${code}:${cleanText(row.name || row.cbName || row.warrantName)}:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function codeOf(row, fallback) {
  return cleanText(row.code || row.symbol || row.ticker || row.underlyingCode || row.cbCode || row.warrantCode || fallback);
}

function nameOf(row, code) {
  return cleanText(row.rawName || row.name || row.displayName || row.underlyingName || row.cbName || row.warrantName || code);
}

function priceOf(row) {
  return cleanNumber(row.entry_price ?? row.entryPrice ?? row.entryPriceValue ?? row.close ?? row.price ?? row.lastPrice ?? row.referencePrice);
}

function highOf(row, entryPrice) {
  return cleanNumber(row.high_price ?? row.highPrice ?? row.dayHigh ?? row.high ?? row.close ?? row.price) || entryPrice;
}

function reasonOf(row, task) {
  const signals = Array.isArray(row.signals) ? row.signals.join("；") : "";
  return cleanText(row.reason || row.blockReason || row.tags?.join?.("；") || signals || `${task.strategy} latest complete run`);
}

function normalizeRecord(task, payload, row, index) {
  const fallbackDate = taipeiDate();
  const recordDate = isoDate(row.record_date || row.tradeDate || row.usedDate || payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date, fallbackDate);
  const code = codeOf(row, `${task.key}-${index + 1}`);
  const entryPrice = priceOf(row);
  const highPrice = highOf(row, entryPrice);
  const source = "terminal-complete-run-scorecard";
  return {
    record_id: `${recordDate}-${task.key}-${code}-${index + 1}`,
    record_date: recordDate,
    strategy: task.strategy,
    ticker: code,
    name: nameOf(row, code),
    entry_time: cleanText(row.entry_time || row.entryTime || row.entryAt || row.time || ""),
    entry_price: entryPrice,
    high_price: highPrice,
    pnl: cleanNumber(row.pnl ?? row.profitPct ?? row.changePercent) || 0,
    source,
    source_sheet: source,
    reason: reasonOf(row, task),
  };
}

function summarize(records) {
  const map = new Map();
  for (const row of records) {
    const key = `${row.record_date}|||${row.strategy}`;
    const rows = map.get(key) || [];
    rows.push(row);
    map.set(key, rows);
  }
  return [...map.entries()].map(([key, rows]) => {
    const [summaryDate, strategy] = key.split("|||");
    const pnls = rows.map((row) => cleanNumber(row.pnl));
    const wins = pnls.filter((value) => value > 0).length;
    const losses = pnls.filter((value) => value < 0).length;
    const flats = pnls.length - wins - losses;
    const totalPnl = pnls.reduce((sum, value) => sum + value, 0);
    return {
      summary_date: summaryDate,
      strategy,
      signals: rows.length,
      backtestable: rows.length,
      wins,
      losses,
      flats,
      win_rate_pct: rows.length ? (wins / rows.length) * 100 : 0,
      total_pnl: totalPnl,
      avg_pnl: rows.length ? totalPnl / rows.length : 0,
      max_profit: pnls.length ? Math.max(...pnls) : 0,
      max_loss: pnls.length ? Math.min(...pnls) : 0,
      status: "complete",
      note: "Generated from terminal latest complete-run APIs; pnl is signal-time conservative value when no settled performance exists.",
      source: "terminal-complete-run-scorecard",
      source_sheet: "terminal-complete-run-scorecard",
    };
  });
}

async function main() {
  const reports = [];
  const records = [];
  for (const task of TASKS) {
    const result = await callApi(task);
    const payload = result.payload || {};
    const rows = arraysFromTaskPayload(task, payload);
    rows.forEach((row, index) => records.push(normalizeRecord(task, payload, row, index)));
    reports.push({
      key: task.key,
      strategy: task.strategy,
      statusCode: result.statusCode,
      ok: payload.ok !== false && Number(result.statusCode || 0) < 400,
      runId: cleanText(payload.runId || payload.transport?.runId),
      count: cleanNumber(payload.count ?? payload.total ?? rows.length),
      emittedRows: rows.length,
      date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
      reason: cleanText(payload.reason || payload.detail || payload.error),
    });
  }
  const filtered = records.filter((row) => row.record_date && row.ticker);
  const latestDate = filtered.map((row) => row.record_date).sort().at(-1) || taipeiDate();
  const daily = summarize(filtered);
  const payload = {
    ok: true,
    source: "terminal-complete-run-scorecard",
    cacheSource: "json-snapshot",
    exportSource: "terminal-complete-run-scorecard",
    updatedAt: new Date().toISOString(),
    latestDate,
    days: 1,
    records: filtered,
    summary: {
      latestDate,
      rows: filtered.length,
      daily,
      byStrategy: daily.map((row) => ({
        strategy: row.strategy,
        rows: row.signals,
        wins: row.wins,
        losses: row.losses,
        flats: row.flats,
        winRate: row.win_rate_pct,
        pnl: row.total_pnl,
      })),
    },
    sourceReports: reports,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    out: OUT_FILE,
    latestDate,
    rows: filtered.length,
    dailyRows: daily.length,
    reports,
  }, null, 2));
  if (!filtered.length) process.exit(2);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exit(1);
});
