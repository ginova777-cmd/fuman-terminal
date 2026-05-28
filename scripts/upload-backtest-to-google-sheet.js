const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL, URLSearchParams } = require("url");
const { execFile } = require("child_process");
const { fetchMisQuotes } = require("../lib/mis-quotes");

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1UCpEBXmOWNA57eLXH62WffnPrflly6OwmDm242JYhp8";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const SECRET_DIR = process.env.GOOGLE_OAUTH_DIR || path.join(RUNTIME_DIR, "secrets");
const TOKEN_PATH = path.join(SECRET_DIR, "google-sheets-token.json");
const CREDENTIALS_PATH = process.env.GOOGLE_OAUTH_CLIENT || path.join(SECRET_DIR, "google-oauth-client.json");
const REPORT_DIR = process.env.BACKTEST_REPORT_DIR || path.join(process.env.USERPROFILE || "C:\\Users\\ginov", "OneDrive", "Desktop", "回測報告");
const DATA_DIR = process.env.FUMAN_DATA_DIR || path.join(RUNTIME_DIR, "data");
const CACHE_DIR = process.env.FUMAN_CACHE_DIR || path.join(RUNTIME_DIR, "cache");
const REPO_DATA_DIR = process.env.FUMAN_REPO_DATA_DIR || "C:\\fuman-terminal\\data";
const STRATEGY5_SCORECARD_FILE = path.join(DATA_DIR, "strategy5-scorecard-latest.json");
const STRATEGY5_SCORECARD_HISTORY_DIR = path.join(DATA_DIR, "strategy5-scorecard-history");
const STRATEGY5_TRACK_FILE = path.join(CACHE_DIR, "intraday", "strategy5-scorecard-trades.json");
const TRADE_MANAGER_STATE_FILE = path.join(RUNTIME_DIR, "state", "trade-manager-state.json");
const STRATEGY5_TAKE_PROFIT_PCT = Number(process.env.STRATEGY5_TAKE_PROFIT_PCT || process.env.TRADE_MANAGER_TAKE_PROFIT_PCT || 3);
const STRATEGY5_STOP_LOSS_PCT = Number(process.env.STRATEGY5_STOP_LOSS_PCT || process.env.TRADE_MANAGER_STOP_LOSS_PCT || 2);
const REDIRECT_PORT = Number(process.env.GOOGLE_OAUTH_PORT || 53682);
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/oauth2callback`;
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') { cell += '"'; i += 1; continue; }
      if (ch === '"') { quoted = false; continue; }
      cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(cell); cell = ""; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).length));
}

function requestJson(method, rawUrl, { token, body, form } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(rawUrl);
    const data = form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : null;
    const req = https.request({
      method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        Accept: "application/json,text/plain,*/*",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : body ? { "Content-Type": "application/json" } : {}),
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let chunks = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { chunks += chunk; });
      res.on("end", () => {
        const parsed = chunks ? (() => { try { return JSON.parse(chunks); } catch { return chunks; } })() : {};
        if (res.statusCode >= 400) {
          const detail = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
          reject(new Error(`${method} ${url.pathname} HTTP ${res.statusCode}: ${detail.slice(0, 800)}`));
          return;
        }
        resolve(parsed);
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function getClientConfig() {
  const raw = readJson(CREDENTIALS_PATH);
  if (!raw) {
    throw new Error(`Missing Google OAuth client file: ${CREDENTIALS_PATH}\n請下載 OAuth Client JSON 後放到這裡，檔名 google-oauth-client.json`);
  }
  const cfg = raw.installed || raw.web || raw;
  if (!cfg.client_id || !cfg.client_secret) throw new Error("OAuth client JSON 缺少 client_id/client_secret");
  return cfg;
}

function openBrowser(url) {
  return new Promise((resolve) => {
    execFile("rundll32.exe", ["url.dll,FileProtocolHandler", url], { windowsHide: true }, () => resolve());
  });
}

async function authorizeWithBrowser(client) {
  const state = Math.random().toString(36).slice(2);
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404); res.end("Not found"); return;
      }
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400); res.end("Invalid state"); reject(new Error("Invalid OAuth state")); return;
      }
      const authCode = url.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h2>Google 授權完成，可以回到 Codex。</h2>");
      server.close();
      resolve(authCode);
    });
    server.listen(REDIRECT_PORT, "127.0.0.1", async () => {
      console.log(`Opening Google OAuth browser: ${authUrl.toString()}`);
      await openBrowser(authUrl.toString());
    });
    server.on("error", reject);
  });

  const token = await requestJson("POST", "https://oauth2.googleapis.com/token", {
    form: {
      client_id: client.client_id,
      client_secret: client.client_secret,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    },
  });
  token.created_at = Date.now();
  writeJson(TOKEN_PATH, token);
  return token;
}

async function getAccessToken() {
  const client = getClientConfig();
  const token = readJson(TOKEN_PATH);
  if (token?.access_token && token?.created_at && Date.now() - token.created_at < (token.expires_in || 3600) * 900) {
    return token.access_token;
  }
  if (token?.refresh_token) {
    const refreshed = await requestJson("POST", "https://oauth2.googleapis.com/token", {
      form: {
        client_id: client.client_id,
        client_secret: client.client_secret,
        refresh_token: token.refresh_token,
        grant_type: "refresh_token",
      },
    });
    const merged = { ...token, ...refreshed, created_at: Date.now() };
    writeJson(TOKEN_PATH, merged);
    return merged.access_token;
  }
  const authorized = await authorizeWithBrowser(client);
  return authorized.access_token;
}

async function sheets(method, endpoint, token, body) {
  return requestJson(method, `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${endpoint}`, { token, body });
}

function a1Quote(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

async function ensureSheet(token, spreadsheet, title) {
  if ((spreadsheet.sheets || []).some((s) => s.properties?.title === title)) return;
  await sheets("POST", ":batchUpdate", token, { requests: [{ addSheet: { properties: { title } } }] });
}

async function putValues(token, sheetName, rows) {
  await sheets("POST", `/values/${encodeURIComponent(a1Quote(sheetName))}:clear`, token, {});
  await sheets("PUT", `/values/${encodeURIComponent(a1Quote(sheetName))}!A1?valueInputOption=RAW`, token, { values: rows });
}

async function deleteSheets(token, spreadsheet, titles) {
  const requests = [];
  for (const title of titles) {
    const sheetId = sheetIdByTitle(spreadsheet, title);
    if (sheetId != null) requests.push({ deleteSheet: { sheetId } });
  }
  if (requests.length) await sheets("POST", ":batchUpdate", token, { requests });
}

function readFirstJson(paths) {
  for (const file of paths) {
    const value = readJson(file);
    if (value) return { file, value };
  }
  return { file: "", value: null };
}

function fmtNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return value ?? "";
  return Number(num.toFixed(digits));
}

function fmtPrice(value) {
  return fmtNumber(value, 2);
}

function firstReason(item) {
  return item?.activeMatch?.reason || item?.matches?.[0]?.reason || item?.reason || item?.stateReason || "";
}

function isDrStock(item) {
  return /\bDR\b|[\-－]DR/i.test(String(item?.name || ""));
}

function scorecardExitPrice(item) {
  return item?.exitPrice ?? item?.observedPrice ?? item?.currentPrice ?? item?.lastPrice ?? item?.close ?? "";
}

function scorecardEntryPrice(item) {
  return item?.entryPrice ?? item?.entry ?? item?.open ?? item?.close ?? "";
}

function scorecardTime(...values) {
  for (const value of values) {
    const match = String(value || "").match(/\d{2}:\d{2}(?::\d{2})?/);
    if (match) return match[0];
  }
  return "";
}

function scorecardPnl(item) {
  const exitPrice = Number(scorecardExitPrice(item));
  const entryPrice = Number(scorecardEntryPrice(item));
  const shares = Number(item?.shares ?? 1000);
  if (!Number.isFinite(exitPrice) || !Number.isFinite(entryPrice) || !Number.isFinite(shares)) return item?.pnl ?? "";
  return Math.round((exitPrice - entryPrice) * shares);
}

function tradeManagerResult(position) {
  const entry = Number(position?.entryPrice);
  const exit = Number(position?.exitPrice ?? position?.lastPrice ?? position?.highestPrice ?? position?.entryPrice);
  const shares = Number(position?.shares ?? 1000);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || !Number.isFinite(shares)) {
    return { exit: "", pnl: "", returnPct: "" };
  }
  const pnl = Math.round((exit - entry) * shares);
  const returnPct = entry ? ((exit - entry) / entry) * 100 : 0;
  return { exit, pnl, returnPct };
}

function tradeManagerRows(dateText) {
  const state = readJson(TRADE_MANAGER_STATE_FILE, { date: dateText, positions: {}, closed: {} });
  const closed = Object.values(state.closed || {}).sort((a, b) => Date.parse(a.closedAt || "") - Date.parse(b.closedAt || ""));
  const open = Object.values(state.positions || {}).sort((a, b) => Date.parse(a.openedAt || "") - Date.parse(b.openedAt || ""));
  const rowsForTotals = [...closed, ...open].map((item) => tradeManagerResult(item));
  const totalPnl = rowsForTotals.reduce((sum, item) => sum + (Number.isFinite(Number(item.pnl)) ? Number(item.pnl) : 0), 0);
  const wins = closed.filter((item) => Number(tradeManagerResult(item).pnl) > 0).length;
  const winRate = closed.length ? `${((wins / closed.length) * 100).toFixed(0)}%` : "--";
  const rows = [
    ["交易管家成績單"],
    ["日期", state.date || dateText, "產生時間", new Date().toLocaleString("zh-TW"), "來源", TRADE_MANAGER_STATE_FILE],
    ["今日交易計畫", closed.length + open.length, "已出場", closed.length, "追蹤中", open.length, "已出場勝率", winRate, "合計損益", totalPnl],
    [""],
    ["狀態", "股票代碼", "股票名稱", "策略", "進場時間", "進場價", "出場/目前時間", "出場/目前價", "報酬率(%)", "損益", "停利價", "停損價", "股數", "原因"],
  ];
  for (const item of closed) {
    const result = tradeManagerResult(item);
    rows.push([
      item.exitAction === "takeProfit" ? "停利" : item.exitAction === "stopLoss" ? "停損" : item.exitAction === "dayClose" ? "當沖出場" : "已出場",
      item.code || "",
      item.name || "",
      item.strategy || "",
      item.entryTime || "",
      fmtPrice(item.entryPrice),
      scorecardTime(item.closedAt),
      fmtPrice(result.exit),
      fmtNumber(result.returnPct),
      result.pnl,
      fmtPrice(item.takeProfitPrice),
      fmtPrice(item.stopLossPrice),
      item.shares || "",
      item.exitReason || "",
    ]);
  }
  for (const item of open) {
    const result = tradeManagerResult(item);
    rows.push([
      "追蹤中",
      item.code || "",
      item.name || "",
      item.strategy || "",
      item.entryTime || "",
      fmtPrice(item.entryPrice),
      scorecardTime(item.lastUpdatedAt),
      fmtPrice(result.exit),
      fmtNumber(result.returnPct),
      result.pnl,
      fmtPrice(item.takeProfitPrice),
      fmtPrice(item.stopLossPrice),
      item.shares || "",
      "",
    ]);
  }
  if (!closed.length && !open.length) rows.push(["今天交易管家沒有建立交易計畫", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
  return rows;
}

function roundTradePrice(price) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) return "";
  const tick = value >= 1000 ? 5 : value >= 500 ? 1 : value >= 100 ? 0.5 : value >= 50 ? 0.1 : value >= 10 ? 0.05 : 0.01;
  return Number((Math.round(value / tick) * tick).toFixed(2));
}

function clampPrice(price, low, high) {
  const value = Number(price);
  const min = Number(low);
  const max = Number(high);
  if (!Number.isFinite(value)) return "";
  if (Number.isFinite(min) && value < min) return min;
  if (Number.isFinite(max) && value > max) return max;
  return value;
}

function timeToSeconds(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function ensureExitAfterEntry(entryTime, exitTime) {
  if (timeToSeconds(exitTime) > timeToSeconds(entryTime)) return exitTime;
  return timeToSeconds(entryTime) < timeToSeconds("13:20:00") ? "13:20:00" : "13:25:00";
}

function taipeiUnix(dateText, hour = 0, minute = 0) {
  return Math.floor(new Date(`${dateText}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`).getTime() / 1000);
}

function timeFromUnix(seconds) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(seconds * 1000));
}

async function fetchYahooIntraday(item, dateText) {
  const code = String(item.code || "");
  const suffix = String(item.market || "").toUpperCase() === "TPEX" ? "TWO" : "TW";
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${code}.${suffix}`);
  url.searchParams.set("period1", String(taipeiUnix(dateText, 0, 0)));
  url.searchParams.set("period2", String(taipeiUnix(dateText, 23, 59)));
  url.searchParams.set("interval", "1m");
  url.searchParams.set("includePrePost", "false");
  const payload = await requestJson("GET", url.toString());
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0] || {};
  const timestamps = result?.timestamp || [];
  const prevClose = Number(result?.meta?.chartPreviousClose || item.prevClose || 0);
  const candles = timestamps.map((timestamp, index) => ({
    timestamp,
    time: timeFromUnix(timestamp),
    open: Number(quote.open?.[index]),
    high: Number(quote.high?.[index]),
    low: Number(quote.low?.[index]),
    close: Number(quote.close?.[index]),
    volume: Number(quote.volume?.[index] || 0),
  })).filter((row) => (
    Number.isFinite(row.open)
    && Number.isFinite(row.high)
    && Number.isFinite(row.low)
    && Number.isFinite(row.close)
    && timeToSeconds(row.time) >= timeToSeconds("09:00:00")
    && timeToSeconds(row.time) <= timeToSeconds("13:30:00")
  ));
  return { code, source: `Yahoo Finance 1m ${code}.${suffix}`, prevClose, candles };
}

async function fetchYahooIntradayMap(matches, dateText) {
  const map = new Map();
  for (const item of matches) {
    try {
      map.set(String(item.code || ""), await fetchYahooIntraday(item, dateText));
    } catch (error) {
      map.set(String(item.code || ""), { code: String(item.code || ""), error: error.message, candles: [] });
    }
  }
  return map;
}

function strategy5PlanFromCandles(item, intraday) {
  const candles = intraday?.candles || [];
  if (!candles.length) return null;
  const prevClose = Number(intraday.prevClose || item.prevClose || 0);
  let cumulativeVolume = 0;
  let cumulativeValue = 0;
  let rollingHigh = 0;
  let entry = null;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    cumulativeVolume += candle.volume || 0;
    cumulativeValue += (candle.close || 0) * (candle.volume || 0);
    rollingHigh = Math.max(rollingHigh, candle.high || 0);
    if (timeToSeconds(candle.time) < timeToSeconds("09:05:00")) continue;
    const vwap = cumulativeVolume ? cumulativeValue / cumulativeVolume : candle.close;
    const pct = prevClose ? ((candle.close - prevClose) / prevClose) * 100 : Number(item.percent || 0);
    const nearHigh = rollingHigh ? candle.close >= rollingHigh * 0.985 : true;
    const notOverheated = pct <= 8.5;
    if (pct >= 2 && notOverheated && candle.close >= vwap && nearHigh && cumulativeVolume >= 100) {
      entry = { ...candle, index, pct, vwap, cumulativeVolume };
      break;
    }
  }
  if (!entry) return null;
  const entryPrice = roundTradePrice(entry.close);
  const takeProfitPrice = roundTradePrice(entryPrice * (1 + STRATEGY5_TAKE_PROFIT_PCT / 100));
  const stopLossPrice = roundTradePrice(entryPrice * (1 - STRATEGY5_STOP_LOSS_PCT / 100));
  let exit = null;
  for (const candle of candles.slice(entry.index + 1)) {
    const hitStop = stopLossPrice && candle.low <= stopLossPrice;
    const hitProfit = takeProfitPrice && candle.high >= takeProfitPrice;
    if (hitStop && hitProfit) {
      exit = candle.close >= entryPrice
        ? { time: candle.time, price: takeProfitPrice, reason: `觸及 ${STRATEGY5_TAKE_PROFIT_PCT}% 停利` }
        : { time: candle.time, price: stopLossPrice, reason: `跌破 ${STRATEGY5_STOP_LOSS_PCT}% 停損` };
      break;
    }
    if (hitProfit) {
      exit = { time: candle.time, price: takeProfitPrice, reason: `觸及 ${STRATEGY5_TAKE_PROFIT_PCT}% 停利` };
      break;
    }
    if (hitStop) {
      exit = { time: candle.time, price: stopLossPrice, reason: `跌破 ${STRATEGY5_STOP_LOSS_PCT}% 停損` };
      break;
    }
  }
  if (!exit) {
    const last = candles.at(-1);
    exit = { time: last.time, price: roundTradePrice(last.close), reason: "收盤結算" };
  }
  const shares = Number(item?.shares ?? 1000);
  const pnl = Number.isFinite(shares) ? Math.round((exit.price - entryPrice) * shares) : "";
  return {
    entryTime: entry.time,
    entryPrice,
    exitTime: exit.time,
    exitPrice: exit.price,
    pnl,
    reason: `1分K觸發：漲幅${entry.pct.toFixed(2)}%、站上VWAP、貼近當時高點；${exit.reason}`,
    source: intraday.source,
  };
}

function strategy5TradePlan(item, track, tradeDateRaw, intraday = null) {
  const candlePlan = strategy5PlanFromCandles(item, intraday);
  if (candlePlan) return candlePlan;
  const shares = Number(item?.shares ?? 1000);
  const entryPrice = Number(track?.entryPrice);
  const exitPrice = Number(track?.observedHigh);
  if (!track?.entryAt || !Number.isFinite(entryPrice)) {
    return { entryTime: "", entryPrice: "", exitTime: "", exitPrice: "", pnl: "", reason: "尚未觸發管家式進場條件" };
  }
  if (compactYmd(track.date) !== tradeDateRaw) {
    return { entryTime: "", entryPrice: "", exitTime: "", exitPrice: "", pnl: "", reason: "追蹤紀錄日期不符，未計入" };
  }
  const finalExitPrice = roundTradePrice(exitPrice || track.observedPrice || entryPrice);
  const pnl = Number.isFinite(shares) ? Math.round((finalExitPrice - entryPrice) * shares) : "";
  return {
    entryTime: scorecardTime(track.entryAt),
    entryPrice: roundTradePrice(entryPrice),
    exitTime: scorecardTime(track.observedHighAt) || "追蹤中",
    exitPrice: finalExitPrice,
    pnl,
    reason: track.entryReason || "策略5前日名單，盤中量價符合管家條件",
  };
}

function formatYmd(value) {
  const raw = String(value || "").replace(/\D/g, "");
  if (raw.length !== 8) return value || "";
  return raw.slice(0, 4) + "-" + raw.slice(4, 6) + "-" + raw.slice(6, 8);
}

function compactYmd(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function strategy1Pnl(openPrice, highPrice, shares = 1000) {
  const open = Number(openPrice);
  const high = Number(highPrice);
  const lot = Number(shares || 1000);
  if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(lot)) return "";
  return Math.round((high - open) * lot);
}

function strategy3EntryPrice(item) {
  return hasStrategy3EntrySnapshot(item) ? item.entryPrice : (item?.entry ?? item?.close ?? "");
}

function strategy3EntryTime(item) {
  if (!hasStrategy3EntrySnapshot(item)) return "13:00";
  return String(item.entryTime || item.entryAt || "").match(/\d{2}:\d{2}(?::\d{2})?/)?.[0] || "13:00";
}

function hasStrategy3EntrySnapshot(item) {
  const entryPrice = Number(item?.entryPrice);
  const entryTime = String(item?.entryTime || item?.entryAt || "");
  return Number.isFinite(entryPrice) && /13:00(?::\d{2})?/.test(entryTime);
}

function strategy3Pnl(entryPrice, exitPrice, shares = 1000) {
  const entry = Number(entryPrice);
  const exit = Number(exitPrice);
  const lot = Number(shares || 1000);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || !Number.isFinite(lot)) return "";
  return Math.round((exit - entry) * lot);
}

async function strategy1Rows(payloadInfo, dateText) {
  const payload = payloadInfo.value || {};
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  const sourceDateRaw = payload.usedDate || matches[0]?.quoteDate || matches[0]?.date || "";
  const sourceDate = formatYmd(sourceDateRaw);
  const tradeDate = dateText;
  const tradeDateRaw = compactYmd(tradeDate);
  const codes = matches.map((item) => item.code).filter(Boolean);
  const quoteMap = await fetchMisQuotes(codes);
  const rowsForPnl = matches.map((item) => {
    const quote = quoteMap.get(String(item.code || ""));
    const quoteDateRaw = compactYmd(quote?.quoteDate);
    const hasTradeQuote = quote && quoteDateRaw === tradeDateRaw;
    const openPrice = hasTradeQuote ? quote.open : "";
    const highPrice = hasTradeQuote ? quote.high : "";
    const pnl = hasTradeQuote ? strategy1Pnl(openPrice, highPrice, item.shares ?? 1000) : "";
    return { item, quote, hasTradeQuote, openPrice, highPrice, pnl };
  });
  const totalPnl = rowsForPnl.reduce((sum, row) => {
    const pnl = Number(row.pnl);
    return sum + (Number.isFinite(pnl) ? pnl : 0);
  }, 0);
  const rows = [
    ["策略1成績單", "", "今日損益", totalPnl, "更新時間", payload.updatedAt || "", "來源", payloadInfo.file],
    ["標的日", "股票代號", "股票名稱", "交易日", "09:00開盤價", "盤中最高價", "損益", "來源策略"],
  ];
  for (const row of rowsForPnl) {
    const item = row.item;
    rows.push([
      sourceDate,
      item.code || "",
      item.name || row.quote?.name || "",
      row.hasTradeQuote ? formatYmd(row.quote.quoteDate) : tradeDate,
      row.hasTradeQuote ? fmtPrice(row.openPrice) : "",
      row.hasTradeQuote ? fmtPrice(row.highPrice) : "",
      row.pnl,
      item.setup || item.status || (Array.isArray(item.matchedSetups) ? item.matchedSetups.join(" / ") : ""),
    ]);
  }
  if (!matches.length) rows.push(["目前沒有符合資料", "", "", "", "", "", "", ""]);
  return rows;
}

async function strategy3Rows(payloadInfo, dateText) {
  const payload = payloadInfo.value || {};
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  const sourceDateRaw = payload.usedDate || matches[0]?.quoteDate || matches[0]?.date || "";
  const sourceDate = formatYmd(sourceDateRaw);
  const tradeDate = dateText;
  const tradeDateRaw = compactYmd(tradeDate);
  const codes = matches.map((item) => item.code).filter(Boolean);
  const quoteMap = await fetchMisQuotes(codes);
  const rowsForPnl = matches.map((item) => {
    const quote = quoteMap.get(String(item.code || ""));
    const quoteDateRaw = compactYmd(quote?.quoteDate);
    const hasTradeQuote = quote && quoteDateRaw === tradeDateRaw;
    const entryPrice = strategy3EntryPrice(item);
    const exitPrice = hasTradeQuote ? quote.high : "";
    const pnl = hasTradeQuote ? strategy3Pnl(entryPrice, exitPrice, item.shares ?? 1000) : "";
    return { item, quote, hasTradeQuote, entryPrice, exitPrice, pnl };
  });
  const totalPnl = rowsForPnl.reduce((sum, row) => {
    const pnl = Number(row.pnl);
    return sum + (Number.isFinite(pnl) ? pnl : 0);
  }, 0);
  const rows = [
    ["策略3成績單"],
    ["標的日", sourceDate, "交易日", tradeDate, "更新時間", payload.updatedAt || "", "來源", payloadInfo.file],
    ["今日損益", totalPnl, "規則", "前一交易日13:00買 / 隔日盤中最高價賣", "", "", "", ""],
    ["股票代碼", "股票名稱", "進場日", "進場時間", "進場價", "出場日", "盤中最高價", "損益"],
  ];
  for (const row of rowsForPnl) {
    const item = row.item;
    const entryTime = strategy3EntryTime(item);
    rows.push([
      item.code || "",
      item.name || row.quote?.name || "",
      sourceDate,
      entryTime,
      fmtPrice(row.entryPrice),
      row.hasTradeQuote ? formatYmd(row.quote.quoteDate) : tradeDate,
      row.hasTradeQuote ? fmtPrice(row.exitPrice) : "",
      row.pnl,
    ]);
  }
  if (!matches.length) rows.push(["目前沒有符合資料", "", "", "", "", "", "", ""]);
  return rows;
}

function strategyMatchesRows(title, payloadInfo, dateText, options = {}) {
  const payload = payloadInfo.value || {};
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  const totalPnl = matches.reduce((sum, item) => {
    const pnl = Number(scorecardPnl(item));
    return sum + (Number.isFinite(pnl) ? pnl : 0);
  }, 0);
  const summaryRow = options.pnlSummary
    ? ["今日損益", totalPnl, "", "", "", ""]
    : ["總掃描", payload.total ?? "", "符合筆數", payload.count ?? matches.length, "", ""];
  const rows = [
    [title],
    ["資料日期", payload.usedDate || dateText, "更新時間", payload.updatedAt || "", "來源", payloadInfo.file],
    summaryRow,
    options.entryExitColumns
      ? ["股票代碼", "股票名稱", "買進價格", "出場價格", "漲幅(%)", "損益"]
      : ["股票代碼", "股票名稱", "收盤價", "漲幅(%)", "出場價格", "損益"],
  ];
  for (const item of matches) {
    if (options.entryExitColumns) {
      rows.push([
        item.code || "",
        item.name || "",
        fmtPrice(scorecardEntryPrice(item)),
        fmtPrice(scorecardExitPrice(item)),
        fmtNumber(item.percent),
        scorecardPnl(item),
      ]);
    } else {
      rows.push([
        item.code || "",
        item.name || "",
        fmtPrice(item.close),
        fmtNumber(item.percent),
        fmtPrice(scorecardExitPrice(item)),
        scorecardPnl(item),
      ]);
    }
  }
  if (!matches.length) rows.push(["目前沒有符合資料", "", "", "", "", ""]);
  return rows;
}

async function strategy5Rows(payloadInfo, dateText) {
  const payload = payloadInfo.value || {};
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  const tradeDateRaw = compactYmd(dateText);
  const tracker = readJson(STRATEGY5_TRACK_FILE, { trades: {} });
  const intradayMap = await fetchYahooIntradayMap(matches, dateText);
  const plans = matches.map((item) => {
    const code = String(item.code || "");
    return { item, plan: strategy5TradePlan(item, tracker.trades?.[`strategy5:${code}`], tradeDateRaw, intradayMap.get(code)) };
  }).sort((a, b) => Number(b.item?.percent || 0) - Number(a.item?.percent || 0) || String(a.item?.code || "").localeCompare(String(b.item?.code || "")));
  const sourceDate = formatYmd(payload.usedDate || matches[0]?.quoteDate || matches[0]?.date || "");
  const updatedLabel = formatYmd(payload.updatedAt || payload.usedDate || dateText) || payload.updatedAt || "";
  const recordPayload = {
    source: "strategy5-scorecard",
    sourceFile: payloadInfo.file,
    sourceDate,
    tradeDate: dateText,
    updatedAt: new Date().toISOString(),
    total: plans.length,
    trades: plans.map(({ item, plan }) => ({
      strategy: "strategy5",
      sourceDate,
      tradeDate: dateText,
      code: String(item.code || ""),
      name: item.name || "",
      entryTime: plan.entryTime,
      entryPrice: plan.entryPrice,
      exitTime: plan.exitTime,
      exitPrice: plan.exitPrice,
      pnl: plan.pnl,
      percent: fmtNumber(item.percent),
      reason: plan.reason,
      intradaySource: plan.source || "",
      sourceReason: firstReason(item),
      automationReady: Boolean(plan.entryPrice && plan.exitPrice),
    })),
  };
  writeJson(STRATEGY5_SCORECARD_FILE, recordPayload);
  if (tradeDateRaw) writeJson(path.join(STRATEGY5_SCORECARD_HISTORY_DIR, `${tradeDateRaw}.json`), recordPayload);
  const totalPnl = plans.reduce((sum, row) => {
    const pnl = Number(row.plan.pnl);
    return sum + (Number.isFinite(pnl) ? pnl : 0);
  }, 0);
  const rows = [
    ["策略5成績單"],
    ["資料日期", payload.usedDate || dateText, "更新時間", updatedLabel, "來源", payloadInfo.file, "", "", "", ""],
    ["今日損益", totalPnl, "", "", "", "", "", "", "", ""],
    ["排序", "股票代碼", "股票名稱", "進場時間", "進場價格", "出場時間", "出場價格", "漲幅(%)", "損益", "判斷原因"],
  ];
  plans.forEach((row, index) => {
    const { item, plan } = row;
    rows.push([
      index + 1,
      item.code || "",
      item.name || "",
      plan.entryTime,
      fmtPrice(plan.entryPrice),
      plan.exitTime,
      fmtPrice(plan.exitPrice),
      fmtNumber(item.percent),
      plan.pnl,
      plan.reason,
    ]);
  });
  if (!matches.length) rows.push(["目前沒有符合資料", "", "", "", "", "", "", "", "", ""]);
  return rows;
}

function ma35AttemptText(item) {
  const attempts = Array.isArray(item.ma35Attempts) ? item.ma35Attempts : [];
  return attempts.map((attempt) => `${attempt.source}:${attempt.ok ? "OK" : "NO"}${attempt.configured === false ? "(no-key)" : ""}${attempt.error ? ` ${attempt.error}` : ""}`).join(" / ");
}

function strategy2Rows(dateText) {
  const info = readFirstJson([path.join(DATA_DIR, "strategy2-intraday-latest.json"), path.join(REPO_DATA_DIR, "strategy2-intraday-latest.json")]);
  const payload = info.value || {};
  const events = (Array.isArray(payload.events) ? payload.events : []).filter((item) => !isDrStock(item));
  const records = (Array.isArray(payload.records) ? payload.records : []).filter((item) => !isDrStock(item));
  const timeOnly = (value) => String(value || "").match(/\d{2}:\d{2}(?::\d{2})?/)?.[0] || "";
  const zoneLabel = (item) => item.stateLabel || (item.stateId === "go" || item.stateId === "entry" ? "進場區" : item.stateId === "wait" ? "觀察區" : item.status || "");
  const strategyText = (item) => Array.isArray(item.strategies) ? item.strategies.join(" / ") : item.strategy || "";
  const latestRecords = [...records].sort((a, b) => {
    const at = Date.parse(String(a.timestamp || a.entryAt || "").replace(" ", "T"));
    const bt = Date.parse(String(b.timestamp || b.entryAt || "").replace(" ", "T"));
    if (Number.isFinite(bt) && Number.isFinite(at) && bt !== at) return bt - at;
    return Number(b.score || 0) - Number(a.score || 0);
  });
  const rows = [
    ["策略2成績單"],
    ["資料日期", payload.date || dateText, "更新時間", payload.updatedAt || "", "來源", info.file],
    ["掃描筆數", records.length, "事件筆數", events.length, "進場區筆數", events.filter((event) => event.firstAAt).length, "觀察筆數", events.filter((event) => !event.firstAAt && event.firstBAt).length],
    ["MA35規則", "Yahoo優先，Fugle備援，本機1分鐘快取第三順位", "允許來源", "yahoo-1m / fugle-1m / local-1m-cache", "缺資料處理", "不發訊號"],
    [""],
    ["盤中逐筆掃描紀錄（最新在上，不是只有首次觸發）"],
    ["掃描時間", "股票代碼", "股票名稱", "區域", "分數", "進場價", "觀察價", "最高價", "最高時間", "漲幅(%)", "成交量", "策略", "MA35來源", "MA35代號", "MA35時間", "MA35值", "備援嘗試", "原因"],
  ];
  for (const item of latestRecords.slice(0, 500)) {
    rows.push([
      timeOnly(item.timestamp || item.entryAt),
      item.code || "",
      item.name || "",
      zoneLabel(item),
      item.score ?? "",
      fmtPrice(item.entryPrice),
      fmtPrice(item.observedPrice),
      fmtPrice(item.observedHigh ?? item.highestPrice),
      timeOnly(item.observedHighAt || item.highestAt),
      fmtNumber(item.percent),
      item.volume ?? "",
      strategyText(item),
      item.ma35Source || "",
      item.ma35Symbol || "",
      item.ma35At || "",
      fmtPrice(item.ma35),
      ma35AttemptText(item),
      item.stateReason || item.reason || "",
    ]);
  }
  if (!records.length) rows.push(["目前沒有盤中逐筆掃描資料", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);

  rows.push([""]);
  rows.push(["首次觸發事件摘要"]);
  rows.push(["股票代碼", "股票名稱", "首次觀察", "首次進場區", "進場價", "最高價", "最高時間", "分數", "策略", "原因"]);
  for (const item of events.slice(0, 300)) {
    rows.push([
      item.code || "",
      item.name || "",
      item.firstBAt || "",
      item.firstAAt || "",
      fmtPrice(item.firstAPrice ?? item.firstBPrice),
      fmtPrice(item.highestPrice ?? item.highAfterA),
      item.highestAt ?? item.highAfterAAt ?? "",
      item.maxScore ?? "",
      strategyText(item),
      item.stateReason || "",
    ]);
  }
  if (!events.length) rows.push(["目前沒有事件資料", "", "", "", "", "", "", "", "", ""]);
  return rows;
}

function realtimeRadarRows(radarCsv, report, dateText) {
  const scorecard = readFirstJson([path.join(DATA_DIR, "realtime-radar-scorecard-latest.json"), path.join(REPO_DATA_DIR, "realtime-radar-scorecard-latest.json")]);
  const scorecardRows = Array.isArray(scorecard.value?.rows) ? scorecard.value.rows : [];
  if (scorecardRows.length) {
    const totalProfit = Number.isFinite(Number(scorecard.value?.totalProfit))
      ? Math.round(Number(scorecard.value.totalProfit))
      : scorecardRows.reduce((sum, item) => {
        const profit = Number(item.profit);
        return sum + (Number.isFinite(profit) ? Math.round(profit) : 0);
      }, 0);
    const rows = [
      ["即時雷達成績單"],
      ["資料日期", scorecard.value?.date || dateText, "最新雷達更新", scorecard.value?.updatedAt || "", "來源", scorecard.file],
      ["今日損益", totalProfit, "回測命中", scorecardRows.length, "", "", ""],
      ["date", "code", "name", "eventAt", "實際進場價", "盤中最高價", "損益"],
    ];
    for (const item of scorecardRows) {
      const entryTime = item.entryTime || String(item.entryAt || "").match(/\d{2}:\d{2}(?::\d{2})?/)?.[0] || "";
      rows.push([
        scorecard.value?.date || dateText,
        item.code || "",
        item.name || "",
        entryTime,
        fmtPrice(item.entryPrice),
        fmtPrice(item.dayHigh ?? item.highestPrice ?? item.exitPrice),
        Number.isFinite(Number(item.profit)) ? Math.round(Number(item.profit)) : "",
      ]);
    }
    return rows;
  }

  const latest = readFirstJson([path.join(DATA_DIR, "realtime-radar-latest.json"), path.join(REPO_DATA_DIR, "realtime-radar-latest.json")]);
  const header = radarCsv[0] || [];
  const indexOf = (name) => header.findIndex((cell) => String(cell).trim() === name);
  const idx = {
    date: indexOf("date"),
    code: indexOf("code"),
    name: indexOf("name"),
    eventAt: indexOf("eventAt"),
    entryPrice: indexOf("entryPrice"),
    highestPrice: indexOf("exitPrice"),
    pnl: indexOf("pnl"),
  };
  const radarRows = [
    ["date", "code", "name", "eventAt", "實際進場價", "盤中最高價", "損益"],
    ...radarCsv.slice(1).map((row) => [
      row[idx.date] ?? "",
      row[idx.code] ?? "",
      row[idx.name] ?? "",
      row[idx.eventAt] ?? "",
      fmtPrice(row[idx.entryPrice]),
      fmtPrice(row[idx.highestPrice]),
      row[idx.pnl] ?? "",
    ]),
  ];
  const rows = [
    ["即時雷達成績單"],
    ["資料日期", dateText, "最新雷達更新", latest.value?.updatedAt || "", "來源", latest.file],
    ["今日損益", report?.radar?.summary?.pnl ?? "", "回測命中", report?.radar?.hits?.length ?? Math.max(0, radarCsv.length - 1), "", "", ""],
  ];
  rows.push(...radarRows);
  return rows;
}

async function loadScorecardSheets(stamp, radarCsv, report) {
  const dateText = stamp.slice(0, 4) + "-" + stamp.slice(4, 6) + "-" + stamp.slice(6, 8);
  return {
    "即時雷達成績單": realtimeRadarRows(radarCsv, report, dateText),
    "交易管家成績單": tradeManagerRows(dateText),
    "策略1成績單": await strategy1Rows(readFirstJson([path.join(DATA_DIR, "open-buy-scorecard-source.json"), path.join(REPO_DATA_DIR, "open-buy-scorecard-source.json")]), dateText),
    "策略2成績單": strategy2Rows(dateText),
    "策略3成績單": await strategy3Rows(readFirstJson([path.join(DATA_DIR, "strategy3-scorecard-source.json"), path.join(REPO_DATA_DIR, "strategy3-scorecard-source.json"), path.join(DATA_DIR, "strategy3-latest.json"), path.join(REPO_DATA_DIR, "strategy3-latest.json")]), dateText),
    "策略5成績單": await strategy5Rows(readFirstJson([path.join(DATA_DIR, "strategy5-latest.json"), path.join(REPO_DATA_DIR, "strategy5-latest.json")]), dateText),
  };
}

function sheetIdByTitle(spreadsheet, title) {
  const sheet = (spreadsheet.sheets || []).find((s) => s.properties?.title === title);
  return sheet?.properties?.sheetId;
}

async function formatWorkbook(token, spreadsheet, titles) {
  const requests = [];
  for (const title of titles) {
    const sheetId = sheetIdByTitle(spreadsheet, title);
    if (sheetId == null) continue;
    requests.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: title === "歷史與區間損益" || title === "策略5成績單" ? 4 : 1 } }, fields: "gridProperties.frozenRowCount" } });
    requests.push({ autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 16 } } });
    if (title === "策略2成績單") {
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endColumnIndex: 16 }, cell: { userEnteredFormat: { numberFormat: { type: "TEXT", pattern: "@" } } }, fields: "userEnteredFormat.numberFormat" } });
    }
    if (title === "策略1成績單") {
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 4, endColumnIndex: 7 }, cell: { userEnteredFormat: { horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat.horizontalAlignment" } });
    }
    if (title === "策略5成績單") {
      requests.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 58 }, fields: "pixelSize" } });
      requests.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 3 }, properties: { pixelSize: 78 }, fields: "pixelSize" } });
      requests.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 9 }, properties: { pixelSize: 88 }, fields: "pixelSize" } });
      requests.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 9, endIndex: 10 }, properties: { pixelSize: 430 }, fields: "pixelSize" } });
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.96, blue: 1 }, textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } });
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 10 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 }, horizontalAlignment: "CENTER", textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)" } });
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: 4, startColumnIndex: 0, endColumnIndex: 9 }, cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat.horizontalAlignment" } });
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: 4, startColumnIndex: 9, endColumnIndex: 10 }, cell: { userEnteredFormat: { horizontalAlignment: "LEFT", wrapStrategy: "WRAP" } }, fields: "userEnteredFormat(horizontalAlignment,wrapStrategy)" } });
    }
    requests.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.96, green: 0.98, blue: 1 }, textFormat: { bold: true, foregroundColor: { red: 0.2, green: 0.25, blue: 0.35 } } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } });
  }

  const strategy3Id = sheetIdByTitle(spreadsheet, "策略3成績單");
  if (strategy3Id != null) {
    requests.push({ updateDimensionProperties: { range: { sheetId: strategy3Id, dimension: "COLUMNS", startIndex: 0, endIndex: 8 }, properties: { pixelSize: 88 }, fields: "pixelSize" } });
  }

  const strategy1Id = sheetIdByTitle(spreadsheet, "策略1成績單");
  if (strategy1Id != null) {
    requests.push({ updateDimensionProperties: { range: { sheetId: strategy1Id, dimension: "COLUMNS", startIndex: 0, endIndex: 8 }, properties: { pixelSize: 88 }, fields: "pixelSize" } });
  }

  const historyId = sheetIdByTitle(spreadsheet, "歷史與區間損益");
  if (historyId != null) {
    requests.push({ updateDimensionProperties: { range: { sheetId: historyId, dimension: "COLUMNS", startIndex: 0, endIndex: 8 }, properties: { pixelSize: 100 }, fields: "pixelSize" } });
    requests.push({ repeatCell: { range: { sheetId: historyId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 }, textFormat: { bold: true, fontSize: 10 } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } });
    requests.push({ repeatCell: { range: { sheetId: historyId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 8 }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } });
    requests.push({ repeatCell: { range: { sheetId: historyId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 8 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.96, green: 0.96, blue: 0.96 }, horizontalAlignment: "CENTER", textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)" } });
    requests.push({ addConditionalFormatRule: { rule: { ranges: [{ sheetId: historyId, startRowIndex: 4, startColumnIndex: 7, endColumnIndex: 8 }], booleanRule: { condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "0" }] }, format: { textFormat: { foregroundColor: { red: 0.78, green: 0.18, blue: 0.28 }, bold: true } } } }, index: 0 } });
    requests.push({ addConditionalFormatRule: { rule: { ranges: [{ sheetId: historyId, startRowIndex: 4, startColumnIndex: 7, endColumnIndex: 8 }], booleanRule: { condition: { type: "NUMBER_LESS", values: [{ userEnteredValue: "0" }] }, format: { textFormat: { foregroundColor: { red: 0.15, green: 0.65, blue: 0.32 }, bold: true } } } }, index: 0 } });
  }

  if (requests.length) await sheets("POST", ":batchUpdate", token, { requests });
}

async function setSheetNavLinks(token, spreadsheet, sheetName, navTitles) {
  const sheetId = sheetIdByTitle(spreadsheet, sheetName);
  if (sheetId == null) return;
  const colors = [
    { red: 0.12, green: 0.33, blue: 0.72 },
    { red: 0.05, green: 0.50, blue: 0.52 },
    { red: 0.46, green: 0.30, blue: 0.72 },
    { red: 0.78, green: 0.36, blue: 0.12 },
    { red: 0.65, green: 0.18, blue: 0.35 },
    { red: 0.16, green: 0.45, blue: 0.24 },
    { red: 0.47, green: 0.38, blue: 0.10 },
    { red: 0.24, green: 0.30, blue: 0.38 },
  ];
  const values = navTitles.map((title, index) => {
    const targetSheetId = sheetIdByTitle(spreadsheet, title);
    const link = targetSheetId == null ? null : `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${targetSheetId}`;
    return {
      userEnteredValue: { stringValue: title },
      textFormatRuns: link ? [{
        startIndex: 0,
        format: {
          foregroundColor: { red: 1, green: 1, blue: 1 },
          bold: true,
          underline: true,
          link: { uri: link },
        },
      }] : [],
      userEnteredFormat: targetSheetId == null ? {} : {
        backgroundColor: colors[index % colors.length],
        horizontalAlignment: "CENTER",
        textFormat: {
          bold: true,
          underline: true,
          foregroundColor: { red: 1, green: 1, blue: 1 },
          link: { uri: link },
        },
      },
    };
  });
  await sheets("POST", ":batchUpdate", token, {
    requests: [{
      updateCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: navTitles.length },
        rows: [{ values }],
        fields: "userEnteredValue,textFormatRuns,userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)",
      },
    }],
  });
}

function todayStamp() {
  const arg = process.argv.find((v) => /^\d{8}$/.test(v) || /^\d{4}-\d{2}-\d{2}$/.test(v));
  if (arg) return arg.replace(/-/g, "");
  const files = fs.readdirSync(REPORT_DIR).filter((name) => /^backtest-trades-\d{8}\.csv$/.test(name)).sort();
  if (!files.length) throw new Error(`No backtest-trades-YYYYMMDD.csv in ${REPORT_DIR}`);
  return files.at(-1).match(/(\d{8})/)[1];
}

function loadBacktestRows(stamp) {
  const tradesPath = path.join(REPORT_DIR, `backtest-trades-${stamp}.csv`);
  const radarPath = path.join(REPORT_DIR, `backtest-radar-${stamp}.csv`);
  const reportPath = path.join(REPORT_DIR, `backtest-strategy2-manager-radar-${stamp}.json`);
  if (!fs.existsSync(tradesPath)) throw new Error(`Missing ${tradesPath}`);
  if (!fs.existsSync(radarPath)) throw new Error(`Missing ${radarPath}`);
  const trades = parseCsv(fs.readFileSync(tradesPath, "utf8"));
  if (trades.length) {
    trades[0] = ["日期", "股票代碼", "股票名稱", "進場時間", "進場價", "出場時間", "出場價", "出場原因", "報酬率(%)", "損益"];
  }
  const radar = parseCsv(fs.readFileSync(radarPath, "utf8"));
  const report = readJson(reportPath, {});
  const dateText = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
  const totalPnl = report?.manager?.summary?.pnl ?? "";
  const historyRows = [
    ["交易管家成績單", "即時雷達成績單", "策略1成績單", "策略2成績單", "策略3成績單", "策略5成績單", "歷史與區間損益", "回測摘要"],
    ["起始日:", dateText, "結束日:", dateText, "查詢損益", "", "區間總損益:", totalPnl === "" ? "" : `${Number(totalPnl).toLocaleString("zh-TW")} 元`],
    ["", "", "", "", "", "", "", ""],
    ["日期", "股票", "股名", "買進股數", "買均價", "賣均價", "出場原因", "實現損益(元)"],
  ];
  for (const row of trades.slice(1)) {
    historyRows.push([
      row[0] || dateText,
      row[1] || "",
      row[2] || "",
      "1",
      row[4] || "0",
      row[6] || "0",
      row[7] || "",
      row[9] || "0",
    ]);
  }
  const summary = [
    ["項目", "數值"],
    ["日期", dateText],
    ["產生時間", new Date().toLocaleString("zh-TW")],
    ["管家交易筆數", report?.manager?.summary?.total ?? Math.max(0, trades.length - 1)],
    ["管家勝率", report?.manager?.summary ? `${report.manager.summary.winRate.toFixed(1)}%` : ""],
    ["管家總損益", totalPnl],
    ["管家平均報酬", report?.manager?.summary ? `${report.manager.summary.avgReturn.toFixed(2)}%` : ""],
    ["即時雷達命中", report?.radar?.hits?.length ?? Math.max(0, radar.length - 1)],
    ["來源資料", report?.sourceFile || ""],
  ];
  return { trades, radar, report, summary, historyRows };
}

async function main() {
  const stamp = todayStamp();
  const { trades, radar, report, summary, historyRows } = loadBacktestRows(stamp);
  const scorecardSheets = await loadScorecardSheets(stamp, radar, report);
  const token = await getAccessToken();
  let spreadsheet = await sheets("GET", "?fields=sheets.properties(title,sheetId)", token);
  const summarySheet = "回測摘要";
  const historySheet = "歷史與區間損益";
  const obsoleteSheets = ["實體庫存與TA分析", "自選股監控池", "策略監控區"];
  await deleteSheets(token, spreadsheet, obsoleteSheets);
  spreadsheet = await sheets("GET", "?fields=sheets.properties(title,sheetId)", token);
  const titles = [summarySheet, historySheet, ...Object.keys(scorecardSheets)];
  for (const title of titles) await ensureSheet(token, spreadsheet, title);
  spreadsheet = await sheets("GET", "?fields=sheets.properties(title,sheetId)", token);
  await putValues(token, summarySheet, summary);
  await putValues(token, historySheet, historyRows);
  for (const [title, rows] of Object.entries(scorecardSheets)) await putValues(token, title, rows);
  spreadsheet = await sheets("GET", "?fields=sheets.properties(title,sheetId)", token);
  await formatWorkbook(token, spreadsheet, titles);
  await setSheetNavLinks(token, spreadsheet, historySheet, ["交易管家成績單", "即時雷達成績單", "策略1成績單", "策略2成績單", "策略3成績單", "策略5成績單", "歷史與區間損益", "回測摘要"]);
  console.log("Uploaded " + stamp + " to Google Sheet " + SHEET_ID);
  console.log("Sheets: " + [historySheet, summarySheet, ...Object.keys(scorecardSheets)].join(", "));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});








