const fs = require("fs");
const path = require("path");
const scanWarrantFlow = require("../api/scan-warrant-flow");
const { writeSummary } = require("./cache-summary");

const { ROOT, dataPath } = require("./runtime-paths");
const OUT_FILE = dataPath("warrant-flow-latest.json");
const BACKUP_FILE = dataPath("warrant-flow-backup.json");
const SUMMARY_FILE = dataPath("warrant-flow-summary.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function runHandler() {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: {} };
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
    Promise.resolve(scanWarrantFlow(req, res)).catch(reject);
  });
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function tradeDateToDate(value) {
  const text = String(value || "").trim();
  let match = text.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (match) return new Date(`${1911 + Number(match[1])}-${match[2]}-${match[3]}T00:00:00+08:00`);
  match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`);
  match = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (match) return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`);
  return null;
}

function taipeiDateOnly() {
  const text = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${text}T00:00:00+08:00`);
}

function ageInDaysFromTradeDate(value) {
  const date = tradeDateToDate(value);
  if (!date) return Infinity;
  return Math.floor((taipeiDateOnly() - date) / 86400000);
}
function normalizeMatch(item) {
  const code = String(item.underlyingCode || item.code || "").trim();
  const name = String(item.underlyingName || item.name || "").trim();
  const close = cleanNumber(item.underlyingClose ?? item.close ?? item.stockClose);
  const percentRaw = item.underlyingPercent ?? item.percent ?? item.stockPercent;
  const percent = Number.isFinite(Number(percentRaw)) ? Number(percentRaw) : 0;
  return {
    ...item,
    code,
    name,
    close,
    percent,
    displayClose: close,
    displayPercent: percent,
    underlyingCode: code,
    underlyingName: name,
    underlyingClose: close,
    underlyingPercent: percent,
  };
}

async function main() {
  const backup = readJson(BACKUP_FILE, { ok: true, matches: [] });
  const payload = await runHandler();
  const matches = Array.isArray(payload.matches) ? payload.matches.map(normalizeMatch) : [];
  const output = {
    ...payload,
    ok: true,
    source: "github-actions",
    updatedAt: new Date().toISOString(),
    count: matches.length,
    matches,
  };

  if (!matches.length) {
    console.error("warrant-flow scan returned 0 matches; keeping existing cache files unchanged");
    process.exit(2);
  }
  const tradeDates = [...new Set(matches.map((item) => String(item.tradeDate || "")).filter(Boolean))];
  const newestTradeDate = tradeDates.sort().at(-1) || "";
  const dataAge = ageInDaysFromTradeDate(newestTradeDate);
  if (dataAge > 3) {
    console.error(`warrant-flow cache is stale: newest tradeDate ${newestTradeDate || "--"}, age ${dataAge} days; keeping existing cache files unchanged`);
    process.exit(2);
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  writeSummary("warrant", output, SUMMARY_FILE);
  fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  console.log(`warrant-flow cache updated: matches ${matches.length}, tradeDate ${newestTradeDate || "--"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

