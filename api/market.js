// api/market.js — 即時加權指數 + 櫃買指數 + 台指近全
const { readEndpointFromDesktopSnapshot } = require("../lib/desktop-route-snapshot-cache");

async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        "Accept": "application/json, text/plain, */*",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        "Accept": "text/html, text/plain, */*",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function calcChange(current, prev) {
  if (!prev || !current) return { diff: "0", pct: "0", sign: "+" };
  const diff = (current - prev).toFixed(2);
  const pct = ((current - prev) / prev * 100).toFixed(2);
  return {
    diff: Math.abs(diff).toString(),
    pct: Math.abs(pct).toString(),
    sign: parseFloat(diff) >= 0 ? "+" : "-",
  };
}

function parseMarketNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%\s]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function signedIndexChange(item = {}) {
  const diff = parseMarketNumber(item["漲跌點數"] ?? item.changePoints ?? item.diff);
  const pct = parseMarketNumber(item["漲跌百分比"] ?? item.pct ?? item.percent);
  const signText = String(item["漲跌"] ?? item.sign ?? "");
  const negative = signText.includes("-") || /跌|▼|down/i.test(signText);
  return {
    diff: negative ? -Math.abs(diff) : Math.abs(diff),
    pct: negative ? -Math.abs(pct) : Math.abs(pct),
  };
}

function marketMinuteFromTime(value) {
  const text = String(value || "").trim();
  const compact = text.replace(/\D/g, "");
  if (/^\d{6}$/.test(compact) || /^\d{4}$/.test(compact)) {
    const hour = Number(compact.slice(0, 2));
    const minute = Number(compact.slice(2, 4));
    if (Number.isFinite(hour) && Number.isFinite(minute)) return hour * 60 + minute;
  }
  const match = text.match(/(\d{1,2})[:：](\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function formatMarketTime(value) {
  const minute = marketMinuteFromTime(value);
  if (minute === null) return "";
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

async function fetchMarketTradeStats() {
  try {
    const rows = await fetchWithTimeout("https://openapi.twse.com.tw/v1/exchangeReport/MI_5MINS", {}, 6500);
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    return [];
  }
}

function tradeStatValueYi(row = {}) {
  const raw = parseMarketNumber(
    row.AccTradeValue
      ?? row.accTradeValue
      ?? row["累積成交金額"]
      ?? row["累積成交金額(元)"]
      ?? row["成交金額"]
      ?? row.TradeValue
      ?? row.value
  );
  if (!raw) return 0;
  return raw > 1000000 ? raw / 100000000 : raw;
}

function buildWeightedIndexTrend(indexes = [], tradeStats = [], updatedAt = new Date().toISOString()) {
  const weighted = indexes.find((item) => String(item?.["指數"] || item?.name || "").includes("加權") || String(item?.["指數"] || "").includes("發行量"));
  const current = parseMarketNumber(weighted?.["收盤指數"] ?? weighted?.price ?? weighted?.index);
  const signed = signedIndexChange(weighted || {});
  const previousClose = current && signed.diff ? current - signed.diff : (current && signed.pct ? current / (1 + signed.pct / 100) : current);
  const startMinute = 9 * 60;
  const endMinute = 13 * 60 + 30;
  const validStats = (Array.isArray(tradeStats) ? tradeStats : [])
    .map((row) => {
      const time = formatMarketTime(row.Time ?? row.time ?? row["時間"]);
      const minute = marketMinuteFromTime(time);
      return { time, minute, valueYi: tradeStatValueYi(row) };
    })
    .filter((row) => row.time && row.minute >= startMinute && row.minute <= endMinute)
    .sort((a, b) => a.minute - b.minute);
  const sampled = validStats.filter((row, index) => index === 0 || index === validStats.length - 1 || index % Math.max(1, Math.ceil(validStats.length / 72)) === 0);
  const baseRows = sampled.length >= 2 ? sampled : [
    { time: "09:00", minute: startMinute, valueYi: 0 },
    { time: "10:00", minute: 10 * 60, valueYi: 0 },
    { time: "11:00", minute: 11 * 60, valueYi: 0 },
    { time: "12:00", minute: 12 * 60, valueYi: 0 },
    { time: "13:30", minute: endMinute, valueYi: 0 },
  ];
  let previousValueYi = 0;
  const amplitude = Math.max(Math.abs(signed.diff || 0), current ? current * 0.002 : 80);
  const points = baseRows.map((row, index) => {
    const progress = Math.max(0, Math.min(1, (row.minute - startMinute) / (endMinute - startMinute)));
    const drift = current && previousClose ? previousClose + (current - previousClose) * progress : current;
    const wave = Math.sin(progress * Math.PI * 2.2) * amplitude * 0.10 + Math.sin(progress * Math.PI * 5.5) * amplitude * 0.035;
    const price = index === baseRows.length - 1 && current ? current : (drift ? drift + wave : 0);
    const deltaValueYi = row.valueYi && previousValueYi ? Math.max(0, row.valueYi - previousValueYi) : row.valueYi || 0;
    previousValueYi = row.valueYi || previousValueYi;
    return {
      time: row.time,
      minute: row.minute,
      price: Number((price || 0).toFixed(2)),
      valueYi: Number((row.valueYi || 0).toFixed(2)),
      deltaValueYi: Number(deltaValueYi.toFixed(2)),
    };
  }).filter((point) => point.price > 0);
  return {
    symbol: "TWSE",
    name: "加權指數",
    source: "MIS即時 + TWSE OpenAPI MI_5MINS",
    priceSource: "weighted-index-current-with-volume-clock",
    estimated: true,
    updatedAt,
    current: current ? Number(current.toFixed(2)) : null,
    previousClose: previousClose ? Number(previousClose.toFixed(2)) : null,
    change: Number((signed.diff || 0).toFixed(2)),
    pct: Number((signed.pct || 0).toFixed(2)),
    points,
  };
}

async function fetchIndexes() {
  const results = [];

  try {
    const data = await fetchWithTimeout(
      "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0",
      { headers: { "Referer": "https://mis.twse.com.tw/" } }
    );
    const item = data?.msgArray?.[0];
    if (item) {
      const current = parseFloat(item.z !== "-" ? item.z : item.y) || 0;
      const prev = parseFloat(item.y) || 0;
      const { diff, pct, sign } = calcChange(current, prev);
      results.push({
        指數: "發行量加權股價指數",
        收盤指數: current > 0 ? current.toFixed(2) : prev.toFixed(2),
        漲跌: sign,
        漲跌點數: diff,
        漲跌百分比: pct,
        _source: "MIS即時",
      });
    }
  } catch (error) {
    try {
      const raw = await fetchWithTimeout("https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX");
      const item = raw.find((row) => row["指數"] === "發行量加權股價指數");
      if (item) {
        results.push({
          指數: "發行量加權股價指數",
          收盤指數: item["收盤指數"],
          漲跌: item["漲跌"],
          漲跌點數: item["漲跌點數"],
          漲跌百分比: item["漲跌百分比"],
          _source: "TWSE OpenAPI",
        });
      }
    } catch (error2) {}
  }

  try {
    const data = await fetchWithTimeout(
      "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=otc_o00.tw&json=1&delay=0",
      { headers: { "Referer": "https://mis.twse.com.tw/" } }
    );
    const item = data?.msgArray?.[0];
    if (item) {
      const current = parseFloat(item.z !== "-" ? item.z : item.y) || 0;
      const prev = parseFloat(item.y) || 0;
      const { diff, pct, sign } = calcChange(current, prev);
      results.push({
        指數: "櫃買指數",
        收盤指數: current > 0 ? current.toFixed(2) : prev.toFixed(2),
        漲跌: sign,
        漲跌點數: diff,
        漲跌百分比: pct,
        _source: "MIS即時",
      });
    }
  } catch (error) {}

  return results;
}

async function fetchTaifexMarket(marketType) {
  const data = await fetchWithTimeout("https://mis.taifex.com.tw/futures/api/getQuoteList", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Referer": "https://mis.taifex.com.tw/futures/",
      "Origin": "https://mis.taifex.com.tw",
    },
    body: JSON.stringify({
      MarketType: marketType,
      SymbolType: "F",
      KindID: "1",
      CID: "",
      ExpireMonth: "",
      RowSize: "10",
      PageNo: "1",
      Language: "zh-tw",
    }),
  }, 8000);

  return (data?.RtData?.QuoteList || data?.RtnData?.QuoteList || []).filter((item) => {
    const symbol = String(item.SymbolID || "");
    const name = String(item.DispCName || item.CName || "");
    return /^TXF/i.test(symbol) && !symbol.includes("-P") && !name.includes("現貨");
  });
}

async function fetchFutures() {
  try {
    const nightList = await fetchTaifexMarket("1");
    const dayList = nightList.length ? [] : await fetchTaifexMarket("0");
    const list = nightList.length ? nightList : dayList;

    const toItem = (item) => {
      if (!item) return null;
      const price = parseFloat(String(item.CLastPrice || "").replace(/,/g, "")) || 0;
      const prev = parseFloat(String(item.CRefPrice || "").replace(/,/g, "")) || 0;
      if (!price || !prev) return null;
      const diff = price - prev;
      const pct = prev ? (diff / prev) * 100 : 0;
      const sign = diff >= 0 ? "+" : "-";
      const basisSide = diff > 0 ? "long" : diff < 0 ? "short" : "flat";
      const basisLabel = basisSide === "long"
        ? "多方勢（高於結算）"
        : basisSide === "short"
          ? "空方勢（低於結算）"
          : "平盤（貼近結算）";
      return {
        name: item.DispCName || item.CName || "台指近全",
        month: item.SymbolID || item.CID || "",
        price: price.toFixed(0),
        change: `${sign}${Math.abs(diff).toFixed(0)}`,
        pct: `${sign}${Math.abs(pct).toFixed(2)}%`,
        volume: item.CTotalVolume || "--",
        basisLabel,
        basisSide,
      };
    };

    return { near: toItem(list[0]), next: toItem(list[1] || null) };
  } catch (error) {
    return { near: null, next: null };
  }
}

async function fetchOtcYahooSignal() {
  try {
    const html = await fetchTextWithTimeout("https://tw.stock.yahoo.com/quote/006201.TW", {}, 8000);
    const start = html.indexOf("漲→跌");
    if (start < 0) return null;
    const area = html.slice(start, start + 600);
    const percentMatch = area.match(/(\d+(?:\.\d+)?)%/);
    if (!percentMatch) return null;
    const isDown = area.includes("border-color:#00ab5e") || area.includes("▼");
    return {
      label: `漲→跌(${isDown ? "▼" : "▲"} ${percentMatch[1]}%)`,
      side: isDown ? "down" : "up",
      source: "Yahoo 006201.TW",
    };
  } catch (error) {
    return null;
  }
}

function getMarketStatus() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const day = now.getDay();
  const total = now.getHours() * 60 + now.getMinutes();
  if (day === 6) return "closed";
  if (day === 0) return total >= 15 * 60 ? "night" : "closed";
  if (total >= 8 * 60 + 45 && total <= 13 * 60 + 45) return "day";
  if (total >= 15 * 60 || total <= 5 * 60) return "night";
  return "closed";
}

function cleanRequestNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function taipeiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function readRequestOptions(request) {
  try {
    const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    const canvas = url.searchParams.get("canvas") === "1";
    const limit = Math.max(1, Math.min(120, cleanRequestNumber(url.searchParams.get("limit")) || 80));
    return { canvas, limit };
  } catch {
    return { canvas: false, limit: 80 };
  }
}

function marketCanvasRows(indexes, futures, otcSignal, limit = 80, updatedAt = new Date().toISOString()) {
  const date = taipeiDateKey(new Date(updatedAt));
  const rows = [];
  indexes.forEach((item, index) => {
    rows.push({
      rank: index + 1,
      code: item["指數"] === "櫃買指數" ? "OTC" : "TWSE",
      name: item["指數"] || "市場指數",
      title: item["指數"] || "市場指數",
      price: item["收盤指數"] || "",
      pct: `${item["漲跌"] || ""}${item["漲跌百分比"] || "0"}%`,
      score: item["漲跌點數"] || "",
      reason: item._source || "market-index",
      updatedAt,
      time: updatedAt,
      date,
    });
  });
  if (futures?.near) {
    rows.push({
      rank: rows.length + 1,
      code: "TXF",
      name: futures.near.name || "台指期",
      title: futures.near.name || "台指期",
      price: futures.near.price || "",
      pct: futures.near.pct || "",
      score: futures.near.change || "",
      reason: futures.near.basisLabel || "futures",
      updatedAt,
      time: updatedAt,
      date,
    });
  }
  if (otcSignal) {
    const signalValue = otcSignal.label || otcSignal.side || "--";
    rows.push({
      rank: rows.length + 1,
      code: "006201",
      name: "櫃買訊號",
      title: "櫃買訊號",
      value: signalValue,
      price: signalValue,
      pct: otcSignal.label || "",
      score: otcSignal.side || "",
      reason: otcSignal.source || "",
      updatedAt,
      time: updatedAt,
      date,
    });
  }
  return rows.slice(0, Math.max(1, Math.min(120, cleanRequestNumber(limit) || 80)));
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") { response.status(405).json({ error: "Method not allowed" }); return; }

  const cached = await readEndpointFromDesktopSnapshot(request, {
    timeoutMs: 650,
    via: "api/market",
  });
  if (cached) {
    response.status(200).json(cached);
    return;
  }

  const marketStatus = getMarketStatus();
  const trading = marketStatus === "day";
  const [indexes, futures, otcSignal, tradeStats] = await Promise.all([fetchIndexes(), fetchFutures(), fetchOtcYahooSignal(), fetchMarketTradeStats()]);
  const ok = indexes.length > 0;
  const updatedAt = new Date().toISOString();
  const weightedIndexTrend = buildWeightedIndexTrend(indexes, tradeStats, updatedAt);

  response.setHeader(
    "Cache-Control",
    trading
      ? "s-maxage=15, stale-while-revalidate=30"
      : "s-maxage=30, stale-while-revalidate=60"
  );

  const requestOptions = readRequestOptions(request);
  const rows = requestOptions.canvas ? marketCanvasRows(indexes, futures, otcSignal, requestOptions.limit, updatedAt) : [];
  response.status(ok ? 200 : 502).json({
    ok,
    source: "MIS即時",
    trading,
    marketStatus,
    updatedAt,
    indexes,
    stocks: [],
    futures: futures.near,
    futuresNear: futures.near,
    futuresNext: futures.next,
    otcSignal,
    weightedIndexTrend,
    marketTradeStatsCount: Array.isArray(tradeStats) ? tradeStats.length : 0,
    canvas: requestOptions.canvas,
    returnedCount: rows.length,
    rows,
  });
};
