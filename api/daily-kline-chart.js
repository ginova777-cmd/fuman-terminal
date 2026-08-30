"use strict";

const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");
const { detectElliottWave } = require("../lib/elliott-wave");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const PRIMARY_TABLE = process.env.FUMAN_DAILY_KLINE_TABLE || "strategy4_daily_ohlcv_view";
const FALLBACK_TABLE = "finmind_daily_ohlcv";
const DAILY_KLINE_SVG_CONTRACT = "terminal-daily-kline-svg-v1";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function codeOf(value) {
  return String(value || "").trim().match(/^\d{4}$/)?.[0] || "";
}

function limitOf(value) {
  const parsed = Math.floor(number(value));
  return [60, 120, 240].includes(parsed) ? parsed : 120;
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[character]));
}

function normalized(row) {
  const date = String(row?.trade_date || "").slice(0, 10);
  const open = number(row?.open);
  const high = number(row?.high);
  const low = number(row?.low);
  const close = number(row?.close);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !open || !high || !low || !close || high < Math.max(open, close) || low > Math.min(open, close)) return null;
  return { date, open, high, low, close, volume: number(row?.volume_lots) };
}

async function loadBars(base, key, table, code, limit, signal) {
  const url = new URL(`/rest/v1/${encodeURIComponent(table)}`, base);
  url.searchParams.set("select", "trade_date,open,high,low,close,volume_lots");
  url.searchParams.set("symbol", `eq.${code}`);
  url.searchParams.set("order", "trade_date.desc");
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, { signal, headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body)) return [];
  return body.map(normalized).filter(Boolean).sort((left, right) => left.date.localeCompare(right.date));
}

function errorSvg(label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 360" role="img" aria-label="日K資料不足"><rect width="1120" height="360" fill="#0b1220"/><text x="560" y="180" text-anchor="middle" fill="#93a4ba" font-family="system-ui, sans-serif" font-size="20" font-weight="700">${escapeXml(label)}</text></svg>`;
}

function chartSvg(code, bars) {
  const width = 1120;
  const height = 360;
  const left = 56;
  const right = 20;
  const top = 38;
  const priceBottom = 250;
  const volumeTop = 280;
  const volumeBottom = 334;
  const allHigh = Math.max(...bars.map((bar) => bar.high));
  const allLow = Math.min(...bars.map((bar) => bar.low));
  const spread = Math.max(0.01, allHigh - allLow);
  const high = allHigh + spread * 0.06;
  const low = Math.max(0, allLow - spread * 0.06);
  const volumeMax = Math.max(1, ...bars.map((bar) => bar.volume));
  const step = (width - left - right) / Math.max(1, bars.length - 1);
  const bodyWidth = Math.max(1.6, Math.min(8, step * 0.58));
  const x = (index) => left + index * step;
  const y = (price) => top + ((high - price) / Math.max(0.01, high - low)) * (priceBottom - top);
  const average = (period) => bars.map((_, index) => {
    if (index + 1 < period) return null;
    let total = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) total += bars[cursor].close;
    return total / period;
  });
  const line = (period, color) => {
    const points = average(period).map((value, index) => value == null ? "" : `${x(index).toFixed(1)},${y(value).toFixed(1)}`).filter(Boolean).join(" ");
    return points ? `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>` : "";
  };
  const grids = [0, 0.5, 1].map((ratio) => {
    const lineY = top + (priceBottom - top) * ratio;
    const label = (high - (high - low) * ratio).toFixed(1);
    return `<line x1="${left}" x2="${width - right}" y1="${lineY.toFixed(1)}" y2="${lineY.toFixed(1)}" stroke="#26364b" stroke-dasharray="3 5"/><text x="6" y="${(lineY + 4).toFixed(1)}" fill="#8194ad" font-family="system-ui, sans-serif" font-size="12">${label}</text>`;
  }).join("");
  const candles = bars.map((bar, index) => {
    const rising = bar.close >= bar.open;
    const color = rising ? "#ff5c77" : "#23c49a";
    const candleX = x(index);
    const openY = y(bar.open);
    const closeY = y(bar.close);
    const volumeHeight = (bar.volume / volumeMax) * (volumeBottom - volumeTop);
    return `<line x1="${candleX.toFixed(1)}" x2="${candleX.toFixed(1)}" y1="${y(bar.high).toFixed(1)}" y2="${y(bar.low).toFixed(1)}" stroke="${color}" stroke-width="1.2"/><rect x="${(candleX - bodyWidth / 2).toFixed(1)}" y="${Math.min(openY, closeY).toFixed(1)}" width="${bodyWidth.toFixed(1)}" height="${Math.max(1.5, Math.abs(closeY - openY)).toFixed(1)}" rx="1" fill="${color}"/><rect x="${(candleX - bodyWidth / 2).toFixed(1)}" y="${(volumeBottom - volumeHeight).toFixed(1)}" width="${bodyWidth.toFixed(1)}" height="${Math.max(1, volumeHeight).toFixed(1)}" rx="1" fill="${color}" opacity=".58"/>`;
  }).join("");
  const ticks = [0, Math.floor((bars.length - 1) / 3), Math.floor((bars.length - 1) * 2 / 3), bars.length - 1].map((index) => `<text x="${x(index).toFixed(1)}" y="354" text-anchor="middle" fill="#8194ad" font-family="system-ui, sans-serif" font-size="12">${escapeXml(bars[index].date.slice(5).replace("-", "/"))}</text>`).join("");
  const last = bars[bars.length - 1];
  const elliott = detectElliottWave(bars);
  const wavePoints = ["confirmed", "probable"].includes(elliott.status) ? elliott.points.map((point) => {
    const index = bars.findIndex((bar) => bar.date === point.date);
    if (index < 0) return "";
    const pointX = x(index);
    const pointY = y(point.price);
    return `<circle cx="${pointX.toFixed(1)}" cy="${pointY.toFixed(1)}" r="8" fill="#0b1220" stroke="#ffcc4d" stroke-width="2"/><text x="${pointX.toFixed(1)}" y="${(pointY + 4).toFixed(1)}" text-anchor="middle" fill="#ffcc4d" font-family="system-ui, sans-serif" font-size="10" font-weight="800">${escapeXml(point.label)}</text>`;
  }).join("") : "";
  const waveSummary = ["confirmed", "probable"].includes(elliott.status)
    ? `${elliott.pattern === "impulse_1_5" ? "艾略特 1-5" : "艾略特 A-B-C"} ${elliott.status} ${(elliott.confidence * 100).toFixed(0)}%｜失效 ${elliott.invalidationPrice.toFixed(2)}`
    : `艾略特 ${elliott.status === "DATA_GAP" ? "DATA_GAP" : "未確認"}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(`${code} 正式日K線`)}"><rect width="${width}" height="${height}" fill="#0b1220"/>${grids}<line x1="${left}" x2="${width - right}" y1="268" y2="268" stroke="#34465d"/>${candles}${line(5, "#f4c656")}${line(10, "#4aa7ff")}${line(20, "#b18ae3")}${wavePoints}<text x="${left}" y="22" fill="#dce9fa" font-family="system-ui, sans-serif" font-size="15" font-weight="800">${escapeXml(code)} 日K｜${escapeXml(last.date)}｜收 ${last.close.toFixed(2)}</text><text x="${width - right}" y="22" text-anchor="end" fill="#ffcc4d" font-family="system-ui, sans-serif" font-size="12">${escapeXml(waveSummary)}</text>${ticks}</svg>`;
}

module.exports = async (request, response) => {
  const code = codeOf(request.query?.code);
  const limit = limitOf(request.query?.limit);
  response.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  response.setHeader("X-Fuman-Daily-Kline-Contract", DAILY_KLINE_SVG_CONTRACT);
  response.setHeader("Cache-Control", "public, max-age=120, s-maxage=120, stale-while-revalidate=300");
  if (!code) return response.status(200).end(errorSvg("股票代碼無效"));
  const base = serverSupabaseUrl({ runtimeDir: RUNTIME_DIR });
  const key = serverSupabaseKey({ runtimeDir: RUNTIME_DIR });
  if (!base || !key) return response.status(200).end(errorSvg("正式日K來源暫時不可用"));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    let bars = await loadBars(base, key, PRIMARY_TABLE, code, limit, controller.signal);
    let source = PRIMARY_TABLE;
    if (bars.length < 20) {
      bars = await loadBars(base, key, FALLBACK_TABLE, code, limit, controller.signal);
      source = FALLBACK_TABLE;
    }
    response.setHeader("X-Fuman-Daily-Kline-Source", source);
    response.setHeader("X-Fuman-Daily-Kline-Count", String(bars.length));
    return response.status(200).end(bars.length >= 20 ? chartSvg(code, bars) : errorSvg("正式日K資料不足"));
  } catch {
    return response.status(200).end(errorSvg("正式日K讀取失敗"));
  } finally {
    clearTimeout(timer);
  }
};
