const fs = require("fs");
const path = require("path");
const scanInstitution = require("../api/institution");
const scanStocks = require("../stocks");

const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "data", "institution-latest.json");
const BACKUP_FILE = path.join(ROOT, "data", "institution-backup.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function runHandler() {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, data: {} }); },
    };
    Promise.resolve(scanInstitution(req, res)).catch(reject);
  });
}

function runStocksHandler() {
  return new Promise((resolve) => {
    const req = { method: "GET", query: {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve(this.statusCode >= 400 ? { ok: false, stocks: [] } : payload); },
      end() { resolve({ ok: false, stocks: [] }); },
    };
    Promise.resolve(scanStocks(req, res)).catch(() => resolve({ ok: false, stocks: [] }));
  });
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function buildQuoteMap(payload) {
  const rows = Array.isArray(payload?.stocks) ? payload.stocks : [];
  const map = new Map();
  for (const row of rows) {
    const code = String(row.Code || row.code || "").trim();
    if (!/^\d{4}$/.test(code)) continue;
    const close = cleanNumber(row.ClosingPrice || row.close);
    const change = cleanNumber(row.Change || row.change);
    const tradeVolume = cleanNumber(row.TradeVolume || row.tradeVolume);
    const value = cleanNumber(row.TradeValue || row.value);
    const previous = close - change;
    const percent = previous ? (change / previous) * 100 : cleanNumber(row.Percent || row.percent);
    map.set(code, {
      code,
      name: String(row.Name || row.name || "").trim(),
      close,
      change,
      percent: Number(percent.toFixed ? percent.toFixed(2) : percent) || 0,
      tradeVolume,
      value,
      market: row.Market || row.market || "",
    });
  }
  return map;
}

function enrichInstitutionData(data, quoteMap) {
  const output = {};
  for (const [code, row] of Object.entries(data || {})) {
    const quote = quoteMap.get(code) || {};
    output[code] = {
      ...row,
      code,
      name: row.name || quote.name || code,
      close: cleanNumber(row.close) || quote.close || 0,
      change: Number.isFinite(Number(row.change)) ? Number(row.change) : (quote.change || 0),
      percent: Number.isFinite(Number(row.percent)) ? Number(row.percent) : (quote.percent || 0),
      tradeVolume: cleanNumber(row.tradeVolume) || quote.tradeVolume || 0,
      value: cleanNumber(row.value) || quote.value || 0,
      quoteMarket: row.quoteMarket || quote.market || "",
    };
  }
  return output;
}

async function main() {
  const backup = readJson(BACKUP_FILE, { ok: true, data: {} });
  const [payload, stockPayload] = await Promise.all([runHandler(), runStocksHandler()]);
  const quoteMap = buildQuoteMap(stockPayload);
  const data = enrichInstitutionData(payload.data || {}, quoteMap);
  const count = Object.keys(data).length;
  const output = {
    ...payload,
    ok: true,
    source: "github-actions",
    updatedAt: new Date().toISOString(),
    quoteUpdatedAt: stockPayload?.updatedAt || "",
    count,
    data,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  if (count) fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  else if (Object.keys(backup.data || {}).length) fs.writeFileSync(OUT_FILE, `${JSON.stringify({ ...backup, source: "github-actions-backup-readonly" }, null, 2)}\n`);
  console.log(`institution cache updated: rows ${count}, usedDate ${output.usedDate || "--"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
