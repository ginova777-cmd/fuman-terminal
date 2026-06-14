const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { ROOT, dataPath, statePath } = require("./runtime-paths");

const TDCC_OPEN_DATA_URL = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5";
const TDCC_QUERY_URL = "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock";
const SOURCE_NAME = process.env.FUMAN_TDCC_SOURCE_NAME || "fuman_tdcc_shareholding_1000";
const HISTORY_FILE = dataPath("tdcc-shareholding-1000-history.json");
const STATUS_FILE = statePath("tdcc-shareholding-supabase-status.json");
const DEFAULT_DATES = "20260529,20260605,20260612";

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function readText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function readSecret(name) {
  return readText(path.join(ROOT, "secrets", name))
    || readText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", name));
}

const SUPABASE_URL = (
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || readSecret("supabase-url.txt")
  || ""
).replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_KEY
  || readSecret("supabase-service-role-key.txt");
const SUPABASE_READ_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecret("supabase-anon-key.txt")
  || SUPABASE_SERVICE_ROLE_KEY;

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function normalizeDate(value) {
  const text = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(text) ? text : "";
}

function normalizeCode(value) {
  const text = String(value || "").trim();
  return /^\d{4}$/.test(text) ? text : "";
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim());
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        i += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row.map((item) => item.trim()));
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row.map((item) => item.trim()));
  }
  return rows.filter((item) => item.some(Boolean));
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; FumanTerminalBot/1.0)",
      Accept: "text/html,text/csv,text/plain,*/*",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${url} HTTP ${response.status} ${body.slice(0, 160)}`.trim());
  }
  return response.text();
}

async function fetchLatestOpenData() {
  const text = await fetchText(TDCC_OPEN_DATA_URL);
  const rows = parseCsv(text);
  const header = rows.shift() || [];
  const dateIndex = header.findIndex((item) => item.includes("資料日期"));
  const codeIndex = header.findIndex((item) => item.includes("證券代號"));
  const classIndex = header.findIndex((item) => item.includes("持股分級"));
  const holdersIndex = header.findIndex((item) => item.includes("人數"));
  const sharesIndex = header.findIndex((item) => item.includes("股數"));
  const ratioIndex = header.findIndex((item) => item.includes("比例"));
  const byCode = {};
  let usedDate = "";

  for (const row of rows) {
    const date = normalizeDate(row[dateIndex]);
    const code = normalizeCode(row[codeIndex]);
    const level = String(row[classIndex] || "").trim();
    if (!date || !code || level !== "15") continue;
    usedDate ||= date;
    byCode[code] = {
      code,
      date,
      level: 15,
      holders: cleanNumber(row[holdersIndex]) || 0,
      shares: cleanNumber(row[sharesIndex]) || 0,
      ratio1000Up: cleanNumber(row[ratioIndex]) || 0,
    };
  }

  if (!usedDate || Object.keys(byCode).length < 1000) {
    throw new Error(`TDCC open data parse weak: date=${usedDate || "--"} rows=${Object.keys(byCode).length}`);
  }
  return { date: usedDate, byCode };
}

function parseSetCookie(headers) {
  const raw = headers.get("set-cookie") || "";
  return raw.split(",").map((part) => part.split(";")[0].trim()).filter((part) => part.includes("=")).join("; ");
}

function extractToken(html) {
  return /name="SYNCHRONIZER_TOKEN" value="([^"]+)"/.exec(html)?.[1] || "";
}

function extractRatio1000Up(html) {
  const table = /<table[\s\S]*?1,000,001以上[\s\S]*?<\/table>/i.exec(html)?.[0] || "";
  if (!table) return null;
  const text = table.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const match = /15\s+1,000,001以上\s+(\S+)\s+(\S+)\s+([\d.\-]+)/.exec(text);
  if (!match) return null;
  return {
    level: 15,
    holders: cleanNumber(match[1]) || 0,
    shares: cleanNumber(match[2]) || 0,
    ratio1000Up: cleanNumber(match[3]) || 0,
  };
}

async function fetchHistoricalCodeDate(code, date) {
  const form = await fetch(TDCC_QUERY_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; FumanTerminalBot/1.0)",
      Accept: "text/html,*/*",
    },
  });
  if (!form.ok) throw new Error(`TDCC form HTTP ${form.status}`);
  const cookie = parseSetCookie(form.headers);
  const formHtml = await form.text();
  const token = extractToken(formHtml);
  if (!token) throw new Error("TDCC token missing");
  const body = new URLSearchParams({
    SYNCHRONIZER_TOKEN: token,
    SYNCHRONIZER_URI: "/portal/zh/smWeb/qryStock",
    method: "submit",
    firDate: date,
    scaDate: date,
    sqlMethod: "StockNo",
    stockNo: code,
    stockName: "",
  });
  const result = await fetch(TDCC_QUERY_URL, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; FumanTerminalBot/1.0)",
      Accept: "text/html,*/*",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
    body,
  });
  if (!result.ok) throw new Error(`TDCC query HTTP ${result.status}`);
  const ratio = extractRatio1000Up(await result.text());
  return ratio ? { code, date, ...ratio } : null;
}

function institutionCandidates(limit = 0) {
  const payload = readJson(dataPath("institution-latest.json"), {});
  const rows = payload.items
    ? payload.items
    : Object.values(payload.data || {});
  const candidates = rows
    .filter((row) => /^\d{4}$/.test(String(row.code || "")))
    .filter((row) => Number(row.foreignStreak || 0) >= 3 && Number(row.foreign || 0) > 0)
    .sort((a, b) => Number(b.foreignStreak || 0) - Number(a.foreignStreak || 0) || Number(b.foreign || 0) - Number(a.foreign || 0));
  return limit > 0 ? candidates.slice(0, limit) : candidates;
}

function mergeWeek(history, date, byCode) {
  const weeks = history.weeks && typeof history.weeks === "object" ? history.weeks : {};
  weeks[date] = {
    date,
    count: Object.keys(byCode || {}).length,
    byCode,
  };
  const dates = Object.keys(weeks).sort();
  const maxWeeks = Number(process.env.FUMAN_TDCC_MAX_WEEKS || 60);
  while (dates.length > maxWeeks) {
    const oldest = dates.shift();
    delete weeks[oldest];
  }
  return weeks;
}

function compactPayload(history) {
  const weeks = history.weeks || {};
  const dates = Object.keys(weeks).sort();
  return {
    ok: true,
    source: "tdcc",
    sourceName: SOURCE_NAME,
    updatedAt: new Date().toISOString(),
    latestDate: dates.at(-1) || "",
    dates,
    countByDate: Object.fromEntries(dates.map((date) => [date, weeks[date]?.count || Object.keys(weeks[date]?.byCode || {}).length])),
    weeks,
  };
}

function supabaseHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function upsertSourceStatus(payload) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    writeJson(STATUS_FILE, { ok: false, skipped: true, reason: "missing Supabase credentials", checkedAt: new Date().toISOString() });
    return false;
  }
  const tradeDate = payload.latestDate ? `${payload.latestDate.slice(0, 4)}-${payload.latestDate.slice(4, 6)}-${payload.latestDate.slice(6, 8)}` : null;
  const body = {
    source_name: SOURCE_NAME,
    trade_date: tradeDate,
    updated_at: new Date().toISOString(),
    status: "ok",
    stale_seconds: 0,
    message: `TDCC 1000-share cache weeks=${payload.dates.length} latest=${payload.latestDate || "--"}`,
    payload,
  };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/source_status?on_conflict=source_name`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY),
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    writeJson(STATUS_FILE, { ok: false, table: "source_status", error: `HTTP ${response.status} ${text.slice(0, 240)}`, checkedAt: new Date().toISOString() });
    return false;
  }
  const readback = await readSourceStatus();
  const ok = readback?.payload?.latestDate === payload.latestDate && Array.isArray(readback?.payload?.dates);
  writeJson(STATUS_FILE, { ok, table: "source_status", sourceName: SOURCE_NAME, latestDate: payload.latestDate, weeks: payload.dates.length, checkedAt: new Date().toISOString() });
  return ok;
}

async function readSourceStatus() {
  if (!SUPABASE_URL || !SUPABASE_READ_KEY) return null;
  const url = `${SUPABASE_URL}/rest/v1/source_status?source_name=eq.${encodeURIComponent(SOURCE_NAME)}&select=source_name,updated_at,payload&limit=1`;
  const response = await fetch(url, { headers: supabaseHeaders(SUPABASE_READ_KEY) });
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] : null;
}

async function backfillHistorical(history) {
  const dates = arg("dates", DEFAULT_DATES).split(",").map(normalizeDate).filter(Boolean);
  const limit = Number(arg("limit", "0"));
  const sleepMs = Number(arg("sleep", process.env.FUMAN_TDCC_SLEEP_MS || "120"));
  const candidates = institutionCandidates(limit);
  console.log(`TDCC historical backfill candidates=${candidates.length} dates=${dates.join(",")}`);
  for (const date of dates) {
    const existing = history.weeks?.[date]?.byCode || {};
    const byCode = { ...existing };
    let done = 0;
    for (const stock of candidates) {
      const code = normalizeCode(stock.code);
      if (!code || byCode[code]) continue;
      done += 1;
      process.stdout.write(`[${date}] ${done}/${candidates.length} ${code} ${stock.name || ""}\r`);
      try {
        const row = await fetchHistoricalCodeDate(code, date);
        if (row) byCode[code] = row;
      } catch (error) {
        console.warn(`\nTDCC historical ${date} ${code} failed: ${error.message}`);
      }
      if (sleepMs > 0) await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
    process.stdout.write("\n");
    history.weeks = mergeWeek(history, date, byCode);
    writeJson(HISTORY_FILE, compactPayload(history));
  }
}

async function main() {
  const history = readJson(HISTORY_FILE, { ok: true, source: "tdcc", weeks: {} });
  if (hasFlag("latest") || !hasFlag("backfill")) {
    const latest = await fetchLatestOpenData();
    history.weeks = mergeWeek(history, latest.date, latest.byCode);
    console.log(`TDCC latest synced: date=${latest.date} rows=${Object.keys(latest.byCode).length}`);
  }
  if (hasFlag("backfill")) {
    await backfillHistorical(history);
  }
  const payload = compactPayload(history);
  payload.hash = crypto.createHash("sha256").update(JSON.stringify(payload.weeks)).digest("hex");
  writeJson(HISTORY_FILE, payload);
  const supabaseOk = await upsertSourceStatus(payload);
  console.log(`TDCC cache ready: weeks=${payload.dates.length} latest=${payload.latestDate || "--"} supabase=${supabaseOk ? "ok" : "skipped/failed"}`);
}

main().catch((error) => {
  writeJson(STATUS_FILE, { ok: false, checkedAt: new Date().toISOString(), error: error.message || String(error) });
  console.error(error);
  process.exit(1);
});
