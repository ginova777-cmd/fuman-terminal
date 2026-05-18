const fs = require("fs");
const path = require("path");
const scanOpenBuy = require("../api/scan-open-buy");

const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "data", "open-buy-latest.json");
const BACKUP_FILE = path.join(ROOT, "data", "open-buy-backup.json");
const BATCH_SIZE = Number(process.env.OPEN_BUY_BATCH_SIZE || 48);
const BATCHES_PER_RUN = Number(process.env.OPEN_BUY_BATCHES_PER_RUN || 5);
const STOCK_URL = process.env.STOCK_UNIVERSE_URL || "https://fuman-terminal.vercel.app/api/stocks";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

async function fetchJson(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminalBot/1.0)",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeStock(row) {
  const code = normalizeCode(row.Code || row.code);
  const name = String(row.Name || row.name || "").trim();
  if (!/^\d{4}$/.test(code) || /^00/.test(code) || !name) return null;
  return {
    code,
    name,
    close: cleanNumber(row.ClosingPrice || row.close),
    percent: cleanNumber(row.Percent || row.percent),
    value: cleanNumber(row.TradeValue || row.value),
    tradeVolume: cleanNumber(row.TradeVolume || row.tradeVolume),
  };
}

async function fetchUniverse() {
  const payload = await fetchJson(STOCK_URL);
  const rows = Array.isArray(payload) ? payload : (payload.stocks || []);
  return rows.map(normalizeStock).filter(Boolean);
}

function runHandler(codes) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: { codes: codes.join(",") } };
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, matches: [] }); },
    };
    Promise.resolve(scanOpenBuy(req, res)).catch(reject);
  });
}

async function main() {
  const universe = await fetchUniverse();
  const codes = universe.map((stock) => stock.code);
  if (!codes.length) throw new Error("No stock universe");

  const previousRaw = readJson(OUT_FILE, { ok: true, cursor: 0, total: codes.length, scannedCodes: [], matches: [] });
  const backup = readJson(BACKUP_FILE, { ok: true, matches: [] });
  const previous = (previousRaw.matches || []).length ? previousRaw : { ...previousRaw, matches: backup.matches || [] };
  const previousMatches = new Map((previous.matches || []).map((item) => [item.code, item]));
  const scanned = new Set(previous.scannedCodes || []);
  let cursor = Number(previous.cursor || 0) % codes.length;
  let scannedThisRun = 0;

  for (let batch = 0; batch < BATCHES_PER_RUN; batch++) {
    const start = cursor;
    const slice = codes.slice(start, start + BATCH_SIZE);
    const wrapped = slice.length < BATCH_SIZE ? codes.slice(0, BATCH_SIZE - slice.length) : [];
    const batchCodes = [...slice, ...wrapped];
    cursor = (start + BATCH_SIZE) % codes.length;
    batchCodes.forEach((code) => scanned.add(code));

    const payload = await runHandler(batchCodes);
    batchCodes.forEach((code) => previousMatches.delete(code));
    (payload.matches || []).forEach((item) => {
      const base = universe.find((stock) => stock.code === item.code) || {};
      previousMatches.set(item.code, { ...base, ...item, name: base.name || item.name || item.code });
    });
    scannedThisRun += batchCodes.length;
  }

  const matches = [...previousMatches.values()]
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.percent || 0) - (a.percent || 0))
    .slice(0, 200);
  const output = {
    ok: true,
    source: "github-actions",
    updatedAt: new Date().toISOString(),
    cursor,
    total: codes.length,
    scannedThisRun,
    scannedCodes: [...scanned].filter((code) => codes.includes(code)),
    count: matches.length,
    matches,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  if (matches.length) fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  else if ((backup.matches || []).length) fs.writeFileSync(OUT_FILE, `${JSON.stringify({ ...backup, source: "github-actions-backup-readonly" }, null, 2)}\n`);
  console.log(`open-buy cache updated: scanned ${scannedThisRun}, progress ${output.scannedCodes.length}/${codes.length}, matches ${matches.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
