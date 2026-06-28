const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILES = ["stocks-index.json", "stocks-slim.json"];

let cached = null;

function code4(value) {
  return String(value || "").match(/\d{4}/)?.[0] || "";
}

function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  return [payload?.stocks, payload?.rows, payload?.data, payload?.items].find(Array.isArray) || [];
}

function normalize(row) {
  const code = code4(row?.code || row?.Code || row?.symbol || row?.stock_id || row?.stockNo);
  if (!code) return null;
  const name = String(row?.name || row?.Name || row?.stockName || row?.stock_name || row?.["證券名稱"] || row?.["名稱"] || "").trim();
  const market = String(row?.market || row?.Market || row?.exchange || row?.type || row?.["市場"] || row?.["上市櫃"] || "").trim();
  if (!name || name === code || !market) return null;
  return {
    code,
    name,
    market,
    close: Number(row?.close || row?.price || row?.lastPrice || 0) || 0,
    change: Number(row?.change || row?.priceChange || 0) || 0,
    percent: Number(row?.percent || row?.changePercent || row?.pct || 0) || 0,
    quoteDate: String(row?.quoteDate || row?.date || ""),
  };
}

function loadUniverse() {
  if (cached) return cached;
  const map = new Map();
  for (const file of FILES) {
    try {
      const payload = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
      for (const row of rowsOf(payload)) {
        const meta = normalize(row);
        if (!meta) continue;
        map.set(meta.code, { ...(map.get(meta.code) || {}), ...meta });
      }
    } catch {}
  }
  cached = { map, loadedAt: new Date().toISOString() };
  return cached;
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  const url = new URL(request.url || "/api/mobile-watch-meta", "https://fuman-terminal.vercel.app");
  const code = code4(request.query?.code || url.searchParams.get("code"));
  if (!code) {
    response.status(400).json({ ok: false, valid: false, error: "missing_code" });
    return;
  }
  const universe = loadUniverse();
  const stock = universe.map.get(code) || null;
  response.status(200).json({
    ok: true,
    valid: Boolean(stock),
    code,
    stock,
    count: universe.map.size,
    source: "mobile-watch-meta",
    loadedAt: universe.loadedAt,
  });
};
