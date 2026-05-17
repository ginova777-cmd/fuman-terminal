const fs = require("fs");
const path = require("path");
const scanStrategy4 = require("../api/scan-strategy4");

const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "data", "strategy4-latest.json");
const BACKUP_FILE = path.join(ROOT, "data", "strategy4-backup.json");
const BATCH_SIZE = Number(process.env.STRATEGY4_BATCH_SIZE || 48);
const BATCHES_PER_RUN = Number(process.env.STRATEGY4_BATCHES_PER_RUN || 5);
const FULL_SCAN = process.env.FULL_SCAN === "1";
const STOCK_URL = process.env.STOCK_UNIVERSE_URL || "https://fuman-terminal.vercel.app/api/stocks";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

async function fetchJson(url, timeout = 20000) {
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
  const code = normalizeCode(row.Code || row.code || row["證券代號"]);
  const name = String(row.Name || row.name || row["證券名稱"] || "").trim();
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
  try {
    const payload = await fetchJson(STOCK_URL, 30000);
    const rows = Array.isArray(payload) ? payload : (payload.stocks || []);
    const parsed = rows.map(normalizeStock).filter(Boolean);
    if (parsed.length) return parsed;
  } catch (error) {
    console.log(`stock endpoint fallback: ${error.message}`);
  }

  const rows = await fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", 30000);
  return rows.map(normalizeStock).filter(Boolean);
}

function runHandler(codes) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: { codes: codes.join(",") } };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, matches: [] }); },
    };
    Promise.resolve(scanStrategy4(req, res)).catch(reject);
  });
}

async function main() {
  const universe = await fetchUniverse();
  const codes = universe.map((stock) => stock.code);
  if (!codes.length) throw new Error("No stock universe");

  const previousRaw = readJson(OUT_FILE, {
    ok: true,
    cursor: 0,
    total: codes.length,
    scannedCodes: [],
    matches: [],
  });
  const backup = readJson(BACKUP_FILE, { ok: true, matches: [] });
  const previous = (previousRaw.matches || []).length ? previousRaw : { ...previousRaw, matches: backup.matches || [] };
  const previousMatches = new Map((previous.matches || []).map((item) => [item.code, item]));
  const scanned = new Set(previous.scannedCodes || []);
  let cursor = Number(previous.cursor || 0) % codes.length;
  let scannedThisRun = 0;
  const batchesToRun = FULL_SCAN ? Math.ceil(codes.length / BATCH_SIZE) : BATCHES_PER_RUN;
  if (FULL_SCAN) {
    previousMatches.clear();
    scanned.clear();
    cursor = 0;
  }

  for (let batch = 0; batch < batchesToRun; batch++) {
    const start = cursor;
    const slice = codes.slice(start, start + BATCH_SIZE);
    const wrapped = slice.length < BATCH_SIZE ? codes.slice(0, BATCH_SIZE - slice.length) : [];
    const batchCodes = [...slice, ...wrapped];
    cursor = (start + BATCH_SIZE) % codes.length;
    batchCodes.forEach((code) => scanned.add(code));

    const payload = await runHandler(batchCodes);
    const matched = new Set((payload.matches || []).map((item) => item.code));
    (payload.matches || []).forEach((item) => {
      const base = universe.find((stock) => stock.code === item.code) || {};
      previousMatches.set(item.code, {
        ...base,
        ...item,
        name: base.name || item.name || item.code,
      });
    });
    scannedThisRun += batchCodes.length;
  }

  const matches = [...previousMatches.values()]
    .sort((a, b) => (b.swingScore || b.score || 0) - (a.swingScore || a.score || 0) || (b.percent || 0) - (a.percent || 0))
    .slice(0, 200);
  const output = {
    ok: true,
    source: "github-actions",
    updatedAt: new Date().toISOString(),
    fullScan: FULL_SCAN,
    cursor,
    total: codes.length,
    scannedThisRun,
    scannedCodes: [...scanned].filter((code) => codes.includes(code)),
    count: matches.length,
    matches,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  if (matches.length) {
    fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  } else if ((backup.matches || []).length) {
    fs.writeFileSync(OUT_FILE, `${JSON.stringify({ ...backup, source: "github-actions-backup-readonly", updatedAt: backup.updatedAt || new Date().toISOString() }, null, 2)}\n`);
  }
  console.log(`strategy4 cache updated: full ${FULL_SCAN}, scanned ${scannedThisRun}, total progress ${output.scannedCodes.length}/${codes.length}, matches ${matches.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
