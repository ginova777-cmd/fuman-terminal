const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL, URLSearchParams } = require("url");

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1UCpEBXmOWNA57eLXH62WffnPrflly6OwmDm242JYhp8";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const SECRET_DIR = process.env.GOOGLE_OAUTH_DIR || path.join(RUNTIME_DIR, "secrets");
const TOKEN_PATH = path.join(SECRET_DIR, "google-sheets-token.json");
const CREDENTIALS_PATH = process.env.GOOGLE_OAUTH_CLIENT || path.join(SECRET_DIR, "google-oauth-client.json");
const STATE_FILE = path.join(RUNTIME_DIR, "state", "trade-manager-state.json");
const TARGET_SHEET = process.env.TRADE_MANAGER_SHEET_NAME || "交易管家成績單";
const REQUIRED_DAILY_TRADES = Math.max(1, Number(process.env.TRADE_MANAGER_REQUIRED_DAILY_TRADES || 10));

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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
        "User-Agent": "FumanTradeManagerSheet/1.0",
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
  const cfg = raw?.installed || raw?.web || raw;
  if (!cfg?.client_id || !cfg?.client_secret) throw new Error(`Missing Google OAuth client: ${CREDENTIALS_PATH}`);
  return cfg;
}

async function getAccessToken() {
  const client = getClientConfig();
  const token = readJson(TOKEN_PATH);
  if (token?.access_token && token?.created_at && Date.now() - token.created_at < (token.expires_in || 3600) * 900) {
    return token.access_token;
  }
  if (!token?.refresh_token) throw new Error(`Missing Google refresh token: ${TOKEN_PATH}`);
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

async function sheets(method, endpoint, token, body) {
  return requestJson(method, `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${endpoint}`, { token, body });
}

async function sheetHasRows(token) {
  const range = encodeURIComponent(`${a1Quote(TARGET_SHEET)}!A:A`);
  const payload = await sheets("GET", `/values/${range}?majorDimension=ROWS`, token);
  return Boolean(payload.values?.some((row) => row.some((cell) => String(cell || "").trim())));
}

function a1Quote(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

function sheetIdByTitle(spreadsheet, title) {
  return (spreadsheet.sheets || []).find((sheet) => sheet.properties?.title === title)?.properties?.sheetId;
}

async function ensureSheet(token, spreadsheet, title) {
  if (sheetIdByTitle(spreadsheet, title) != null) return;
  await sheets("POST", ":batchUpdate", token, { requests: [{ addSheet: { properties: { title } } }] });
}

function fmtNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return value ?? "";
  return Number(num.toFixed(digits));
}

function fmtPrice(value) {
  return fmtNumber(value, 2);
}

function scorecardTime(value) {
  return String(value || "").match(/\d{2}:\d{2}(?::\d{2})?/)?.[0] || "";
}

function tradeResult(position) {
  const entry = Number(position?.entryPrice);
  const exit = Number(position?.exitPrice ?? position?.lastPrice ?? position?.highestPrice ?? position?.entryPrice);
  const shares = Number(position?.shares ?? 1000);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || !Number.isFinite(shares)) {
    return { exit: "", pnl: "", returnPct: "" };
  }
  return {
    exit,
    pnl: Math.round((exit - entry) * shares),
    returnPct: entry ? ((exit - entry) / entry) * 100 : 0,
  };
}

function buildRows() {
  const state = readJson(STATE_FILE, { date: "", positions: {}, closed: {} });
  const closed = Object.values(state.closed || {}).sort((a, b) => Date.parse(a.closedAt || "") - Date.parse(b.closedAt || ""));
  const open = Object.values(state.positions || {}).sort((a, b) => Date.parse(a.openedAt || "") - Date.parse(b.openedAt || ""));
  const allResults = [...closed, ...open].map(tradeResult);
  const totalPnl = allResults.reduce((sum, item) => sum + (Number.isFinite(Number(item.pnl)) ? Number(item.pnl) : 0), 0);
  const wins = closed.filter((item) => Number(tradeResult(item).pnl) > 0).length;
  const winRate = closed.length ? `${((wins / closed.length) * 100).toFixed(0)}%` : "--";
  const rows = [
    ["交易管家成績單"],
    ["日期", state.date || "", "產生時間", new Date().toLocaleString("zh-TW"), "來源", STATE_FILE],
    ["今日交易計畫", `${closed.length + open.length}/${REQUIRED_DAILY_TRADES}`, "已出場", closed.length, "追蹤中", open.length, "日內結清", `${closed.length}/${closed.length + open.length || REQUIRED_DAILY_TRADES}`, "已出場勝率", winRate, "合計損益", totalPnl],
    [""],
    ["狀態", "日內", "保底", "股票代碼", "股票名稱", "策略", "進場時間", "進場價", "出場/目前時間", "出場/目前價", "報酬率(%)", "損益", "停利價", "停損價", "股數", "原因"],
  ];
  for (const item of closed) {
    const result = tradeResult(item);
    rows.push([
      item.exitAction === "takeProfit" ? "停利" : item.exitAction === "stopLoss" ? "停損" : item.exitAction === "dayClose" ? "當沖出場" : "已出場",
      "是",
      item.forcedMinimumTrade ? "是" : "",
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
      [item.exitReason, item.stopLossBasis ? `智慧停損：${item.stopLossBasis}` : ""].filter(Boolean).join("；"),
    ]);
  }
  for (const item of open) {
    const result = tradeResult(item);
    rows.push([
      "追蹤中",
      "未結清",
      item.forcedMinimumTrade ? "是" : "",
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
      item.stopLossBasis ? `智慧停損：${item.stopLossBasis}` : "",
    ]);
  }
  if (!closed.length && !open.length) rows.push(["今天交易管家沒有建立交易計畫", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
  return rows;
}

async function formatSheet(token, spreadsheet) {
  const sheetId = sheetIdByTitle(spreadsheet, TARGET_SHEET);
  if (sheetId == null) return;
  await sheets("POST", ":batchUpdate", token, {
    requests: [
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 5 } }, fields: "gridProperties.frozenRowCount" } },
      { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 16 } } },
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.96, green: 0.98, blue: 1 }, textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { repeatCell: { range: { sheetId, startRowIndex: 4, endRowIndex: 5 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.94, green: 0.94, blue: 0.94 }, textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
    ],
  });
}

async function main() {
  const token = await getAccessToken();
  let spreadsheet = await sheets("GET", "?fields=sheets.properties(title,sheetId)", token);
  await ensureSheet(token, spreadsheet, TARGET_SHEET);
  spreadsheet = await sheets("GET", "?fields=sheets.properties(title,sheetId)", token);
  const rows = buildRows();
  if (await sheetHasRows(token)) rows.unshift([""]);
  await sheets(
    "POST",
    `/values/${encodeURIComponent(`${a1Quote(TARGET_SHEET)}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    token,
    { values: rows }
  );
  spreadsheet = await sheets("GET", "?fields=sheets.properties(title,sheetId)", token);
  await formatSheet(token, spreadsheet);
  console.log(`Appended trade manager scorecard: ${TARGET_SHEET}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});


