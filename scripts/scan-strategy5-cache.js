const fs = require("fs");
const path = require("path");
const { fetchMisQuotes } = require("../lib/mis-quotes");

const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "data", "strategy5-latest.json");
const BACKUP_FILE = path.join(ROOT, "data", "strategy5-backup.json");
const INSTITUTION_FILE = path.join(ROOT, "data", "institution-latest.json");
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

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
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
  const code = normalizeCode(row.Code || row.code || row["證券代號"]);
  const name = String(row.Name || row.name || row["證券名稱"] || "").trim();
  if (!/^\d{4}$/.test(code) || /^00/.test(code) || !name) return null;
  if (/ETF|ETN|指數|台灣50|高股息|正2|反1|期貨|債/i.test(name)) return null;
  return {
    code,
    name,
    close: cleanNumber(row.ClosingPrice || row.close),
    change: cleanNumber(row.Change || row.change),
    percent: cleanNumber(row.Percent || row.percent),
    value: cleanNumber(row.TradeValue || row.value),
    tradeVolume: cleanNumber(row.TradeVolume || row.tradeVolume),
    market: row.market || row.Market || "",
  };
}

async function fetchUniverse() {
  const payload = await fetchJson(STOCK_URL);
  const rows = Array.isArray(payload) ? payload : (payload.stocks || []);
  const base = rows.map(normalizeStock).filter(Boolean);
  const quotes = await fetchMisQuotes(base.map((stock) => stock.code));
  return base.map((stock) => {
    const quote = quotes.get(stock.code);
    return quote ? { ...stock, ...quote, name: quote.name || stock.name } : stock;
  });
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

function formatInstitution(value) {
  const amount = cleanNumber(value);
  const sign = amount >= 0 ? "+" : "";
  return `${sign}${Math.round(amount).toLocaleString("zh-TW")}`;
}

function buildMatches(stocks, institutionData) {
  const valueRanks = rankMap(stocks, "value");
  const volumeRanks = rankMap(stocks, "tradeVolume");
  return stocks.map((stock) => {
    const inst = institutionData[stock.code] || {};
    const valueRank = valueRanks.get(stock.code) || 0;
    const volumeRank = volumeRanks.get(stock.code) || 0;
    const pct = cleanNumber(stock.percent);
    const close = cleanNumber(stock.close);
    const foreign = cleanNumber(inst.foreign);
    const trust = cleanNumber(inst.trust);
    const total = cleanNumber(inst.total || (foreign + trust + cleanNumber(inst.dealer)));
    const smartMoney = total + trust * 1.4;
    const nearBreakout = true;
    const jointBuying = total > 0 && foreign > 0 && trust > 0;
    const scoreBase = clamp(
      Math.round(35 + pct * 7 + valueRank * 0.24 + volumeRank * 0.18 + Math.sign(smartMoney) * 8),
      0,
      100
    );
    const score = clamp(scoreBase + 18 + 8 + 6, 0, 100);
    const reason = `外資 ${formatInstitution(foreign)}、投信 ${formatInstitution(trust)} 同買，法人合計 ${formatInstitution(total)}；漲幅 ${pct.toFixed(2)}%。`;
    return {
      ...stock,
      valueRank,
      volumeRank,
      inst: { foreign, trust, dealer: cleanNumber(inst.dealer), total },
      score,
      matches: [{ id: "foreign_trust_breakout", short: "準突破", icon: "◆", score, reason }],
      activeMatch: { id: "foreign_trust_breakout", short: "準突破", icon: "◆", score, reason },
    };
  })
    .filter((stock) => stock.matches.length && stock.activeMatch && stock.score && stock.inst.total > 0 && stock.inst.foreign > 0 && stock.inst.trust > 0 && stock.percent > -1.5 && stock.percent <= 7.5 && stock.close >= 10)
    .sort((a, b) => b.score - a.score || b.percent - a.percent || b.value - a.value)
    .slice(0, 80);
}

async function main() {
  const backup = readJson(BACKUP_FILE, { ok: true, matches: [] });
  const institution = readJson(INSTITUTION_FILE, { data: {} });
  const stocks = await fetchUniverse();
  if (!stocks.length) throw new Error("No stock universe");
  const matches = buildMatches(stocks, institution.data || {});
  const quoteDate = stocks.find((stock) => stock.quoteDate)?.quoteDate || "";
  const output = {
    ok: true,
    source: "github-actions-mis-realtime",
    updatedAt: new Date().toISOString(),
    usedDate: quoteDate,
    schedule: "21:00",
    total: stocks.length,
    count: matches.length,
    matches,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  if (matches.length) fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  else if ((backup.matches || []).length) fs.writeFileSync(OUT_FILE, `${JSON.stringify({ ...backup, source: "github-actions-backup-readonly" }, null, 2)}\n`);
  console.log(`strategy5 cache updated: matches ${matches.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
