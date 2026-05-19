const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "data", "strategy3-latest.json");
const BACKUP_FILE = path.join(ROOT, "data", "strategy3-backup.json");
const INSTITUTION_FILE = path.join(ROOT, "data", "institution-latest.json");
const INSTITUTION_BACKUP_FILE = path.join(ROOT, "data", "institution-backup.json");
const STOCK_URL = process.env.STOCK_UNIVERSE_URL || "https://fuman-terminal.vercel.app/api/stocks";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function normalizeStock(row) {
  const code = normalizeCode(row.Code || row.code);
  const name = String(row.Name || row.name || "").trim();
  if (!/^\d{4}$/.test(code) || /^00/.test(code) || !name) return null;
  return {
    code,
    name,
    close: cleanNumber(row.ClosingPrice || row.close),
    change: cleanNumber(row.Change || row.change),
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

function rankMap(stocks, key) {
  const sorted = [...stocks].sort((a, b) => cleanNumber(b[key]) - cleanNumber(a[key]));
  const total = Math.max(sorted.length - 1, 1);
  const ranks = new Map();
  sorted.forEach((stock, index) => {
    ranks.set(stock.code, Math.round(((total - index) / total) * 100));
  });
  return ranks;
}

function buildMatches(stocks, institutionData) {
  const valueRanks = rankMap(stocks, "value");
  const volumeRanks = rankMap(stocks, "tradeVolume");
  return stocks.map((stock) => {
    const inst = institutionData[stock.code] || {};
    const valueRank = valueRanks.get(stock.code) || 0;
    const volumeRank = volumeRanks.get(stock.code) || 0;
    const pct = Number(stock.percent) || 0;
    const total = cleanNumber(inst.total);
    const trust = cleanNumber(inst.trust);
    const foreign = cleanNumber(inst.foreign);
    const instBoost = total > 0 ? 12 : trust > 0 ? 10 : foreign > 0 ? 6 : 0;
    const heatPenalty = pct > 8.8 ? 24 : pct > 6.5 ? 12 : pct < 0 ? 30 : 0;
    const overnightScore = clamp(Math.round(valueRank * 0.34 + volumeRank * 0.26 + Math.min(Math.max(pct, 0) * 5, 24) + instBoost - heatPenalty), 0, 100);
    const pass = pct >= 1 && pct <= 8.8 && valueRank >= 50 && volumeRank >= 45;
    const reason = pass
      ? "量價接近隔日沖候選條件，尾盤可列入觀察。"
      : "未完整命中強條件，但量價排名仍值得觀察。";
    return {
      ...stock,
      inst: {
        ...inst,
        foreign,
        trust,
        total,
        dealer: cleanNumber(inst.dealer),
      },
      valueRank,
      volumeRank,
      projectedRatio: Math.max(1, (volumeRank || 0) / 24),
      overnightScore,
      overnightState: pass ? "通過" : "觀察",
      score: overnightScore,
      matches: [{ id: "overnight_chip", reason }],
    };
  })
    .filter((stock) => (
      stock.close >= 10 &&
      stock.percent > 0 &&
      stock.percent <= 9.8 &&
      stock.valueRank >= 42 &&
      stock.volumeRank >= 38
    ))
    .sort((a, b) => b.overnightScore - a.overnightScore || b.value - a.value)
    .slice(0, 80);
}

async function main() {
  const backup = readJson(BACKUP_FILE, { ok: true, matches: [] });
  const institutionPayload = readJson(INSTITUTION_FILE, readJson(INSTITUTION_BACKUP_FILE, { data: {} }));
  const stocks = await fetchUniverse();
  if (!stocks.length) throw new Error("No stock universe");
  const matches = buildMatches(stocks, institutionPayload.data || {});
  const output = {
    ok: true,
    source: "github-actions",
    updatedAt: new Date().toISOString(),
    usedDate: institutionPayload.usedDate || "",
    total: stocks.length,
    count: matches.length,
    matches,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  if (matches.length) fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  else if ((backup.matches || []).length) fs.writeFileSync(OUT_FILE, `${JSON.stringify({ ...backup, source: "github-actions-backup-readonly" }, null, 2)}\n`);
  console.log(`strategy3 cache updated: matches ${matches.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
