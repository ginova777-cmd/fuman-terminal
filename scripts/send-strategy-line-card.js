"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_DIR = path.join(RUNTIME_DIR, "data", "line-cards");
const ROOT = path.resolve(__dirname, "..");

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  if (hit) return hit.slice(prefix.length).trim();
  return process.argv.includes(`--${name}`) ? "1" : fallback;
}

function readRegistryEnv(name) {
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Environment", "/v", name], { encoding: "utf8", windowsHide: true });
    const line = out.split(/\r?\n/).find((item) => new RegExp(`\\s${name}\\s+REG_`, "i").test(item));
    if (!line) return "";
    return line.replace(new RegExp(`^.*?${name}\\s+REG_\\w+\\s+`, "i"), "").trim();
  } catch {
    return "";
  }
}

function invalidLineTarget(value) {
  const targets = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!targets.length) return true;
  return targets.some((raw) => {
    return !/^[UCR][a-f0-9]{20,}$/i.test(raw)
      || /你的|your\s*user\s*id|user\s*id\s*找不到|placeholder/i.test(raw);
  });
}

function firstValidLineTarget(...values) {
  return values.map((value) => String(value || "").trim()).find((value) => value && !invalidLineTarget(value)) || "";
}

function loadLineEnv() {
  const token = process.env.FUMAN_LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN || readRegistryEnv("FUMAN_LINE_CHANNEL_ACCESS_TOKEN") || readRegistryEnv("LINE_CHANNEL_ACCESS_TOKEN");
  const registryTo = firstValidLineTarget(readRegistryEnv("FUMAN_LINE_TO"), readRegistryEnv("LINE_TO"), readRegistryEnv("LINE_USER_ID"));
  const envTo = firstValidLineTarget(process.env.FUMAN_LINE_TO, process.env.LINE_TO, process.env.LINE_USER_ID);
  const to = registryTo || envTo;
  if (token) process.env.LINE_CHANNEL_ACCESS_TOKEN = token;
  if (to) process.env.LINE_TO = to;
  process.env.LINE_PUSH_RETRIES = process.env.LINE_PUSH_RETRIES || "3";
  process.env.LINE_PUSH_TIMEOUT_MS = process.env.LINE_PUSH_TIMEOUT_MS || "4500";
  process.env.FUMAN_ENABLE_LEGACY_EXTERNAL_NOTIFICATIONS = "1";
  process.env.NOTIFY_GUARD_DISABLED = "1";
  process.env.FUMAN_NOTIFICATION_DISABLE_FILE = path.join(RUNTIME_DIR, "config", "strategy-line-card-notifications-enabled.json");
  return { token: Boolean(token), to: String(to || ""), invalidEnvTarget: Boolean(envTo === "" && (process.env.FUMAN_LINE_TO || process.env.LINE_TO || process.env.LINE_USER_ID)) };
}

function compactDate(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}${get("month")}${get("day")}`;
}

function nowTaipeiIso() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei", hour12: false }).replace(" ", "T") + "+08:00";
}

function receiptPath(strategy, date = compactDate()) {
  return path.join(OUT_DIR, `${strategy}-line-card-${date}.json`);
}

function writeReceipt(strategy, receipt) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = receiptPath(strategy, receipt.date || compactDate());
  fs.writeFileSync(file, JSON.stringify({ ...receipt, receipt_path: file }, null, 2), "utf8");
  return file;
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function text(value, fallback = "-") {
  const str = String(value ?? "").replace(/\s+/g, " ").trim();
  return str || fallback;
}

function shortRunId(value) {
  const str = text(value, "");
  if (!str) return "-";
  return str.length <= 28 ? str : `${str.slice(0, 18)}...${str.slice(-6)}`;
}

function pct(value) {
  const n = cleanNumber(value);
  if (!Number.isFinite(n) || n === 0) return "0%";
  return `${n > 0 ? "+" : ""}${n.toFixed(2).replace(/\.00$/, "")}%`;
}

function price(value) {
  const n = cleanNumber(value);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return n.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}

function rowCode(row) {
  return text(row.code || row.symbol || row.stock_id || row.stockId, "-");
}

function rowName(row) {
  return text(row.name || row.rawName || row.displayName || row.stock_name || rowCode(row), rowCode(row)).replace(/🔥/g, "").trim();
}

function rowPrice(row) {
  return price(row.price ?? row.close ?? row.entryPrice ?? row.tvOvernightEntry?.price);
}

function rowPct(row) {
  return pct(row.percent ?? row.changePercent ?? row.change_percent ?? row.changePct);
}

function rowEntryPrice(row) {
  return price(row.entryPrice ?? row.mutakiV17?.entryPrice ?? row.price ?? row.close);
}

function rowTargetPrice(row) {
  return price(row.targetPrice ?? row.mutakiV17?.targetPrice ?? row.triangleBreakout?.resistance ?? row.priceTarget);
}
function rowScore(row) {
  const n = cleanNumber(row.score ?? row.overnightScore ?? row.swingScore ?? row.totalScore);
  return n ? String(Math.round(n * 10) / 10) : "-";
}

function rowReason(row) {
  return text(row.reason || row.pattern || row.zoneLabel || row.swingZoneLabel || row.signal || "", "").slice(0, 48);
}

function statusColor(ok, blocked) {
  if (ok && !blocked) return "#ff5b4a";
  if (blocked) return "#f2b84b";
  return "#4cd964";
}

function trendColor(value) {
  const n = cleanNumber(value);
  if (n > 0) return "#ff5b4a";
  if (n < 0) return "#4cd964";
  return "#f5f5f5";
}

function boxText(contents, options = {}) {
  return { type: "text", text: String(contents), wrap: true, ...options };
}

function metricBox(label, value, color = "#f7c75c") {
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: "#111927",
    borderColor: "#273951",
    borderWidth: "1px",
    cornerRadius: "6px",
    paddingAll: "8px",
    contents: [
      boxText(label, { size: "xxs", color: "#9fb2ce", align: "center" }),
      boxText(value, { size: "lg", weight: "bold", color, align: "center" }),
    ],
  };
}

function strategySignalLabel(signal) {
  const raw = String(signal?.short || signal?.label || signal?.name || signal?.id || signal || "").trim();
  const map = {
    overnight_chip: "隔日沖籌碼",
    tv_diagnostic_not_required: "TV診斷",
    watch_trend: "B觀察",
    lower_half_60d: "60日下半",
    below_20d_high_8: "20高-8%",
  };
  return map[raw] || raw;
}

function rowStrategyLabel(row, strategy) {
  if (strategy === "strategy4") {
    const signals = Array.isArray(row.signals) ? row.signals : Array.isArray(row.swingSignals) ? row.swingSignals : [];
    const labels = signals.map(strategySignalLabel).filter(Boolean);
    if (labels.length) return [...new Set(labels)].slice(0, 3).join("+");
    return text(row.pattern || row.zoneLabel || row.swingZoneLabel || row.zone || row.swingZone, "波段觀察");
  }
  const matches = Array.isArray(row.matches) ? row.matches : [];
  const labels = matches
    .map(strategySignalLabel)
    .filter((label) => label && !/TV診斷/i.test(label));
  if (labels.length) return [...new Set(labels)].slice(0, 3).join("+");
  return text(row.tvSignal || row.pattern || row.strategyName, "隔日沖籌碼");
}
function rowBox(row, index, strategy) {
  const percentRaw = row.percent ?? row.changePercent ?? row.change_percent ?? row.changePct;
  const isStrategy4 = strategy === "strategy4";
  // strategy3_compact_row_v1: keep all names in one LINE bubble under the 30KB Flex limit.
  if (!isStrategy4) {
    return {
      type: "box",
      layout: "horizontal",
      spacing: "xs",
      backgroundColor: index % 2 === 0 ? "#121b2b" : "#0e1624",
      borderColor: "#273951",
      borderWidth: "1px",
      cornerRadius: "6px",
      paddingAll: "7px",
      contents: [
        boxText(String(index + 1).padStart(2, "0"), { size: "sm", weight: "bold", color: "#c19a45", flex: 1 }),
        boxText(`${rowCode(row)} ${rowName(row)}`, { size: "sm", weight: "bold", color: "#ffffff", flex: 5, wrap: false }),
        boxText(`進 ${rowPrice(row)}`, { size: "sm", weight: "bold", color: "#ffd76a", align: "end", flex: 3, wrap: false }),
        boxText(rowPct(row), { size: "xs", weight: "bold", color: trendColor(percentRaw), align: "end", flex: 2, wrap: false }),
      ],
    };
  }
  const priceLabel = isStrategy4 ? "進場" : "進場";
  const mainPrice = isStrategy4 ? rowEntryPrice(row) : rowPrice(row);
  const zoneText = isStrategy4 ? `${text(row.zoneLabel || row.swingZoneLabel || row.zone || row.swingZone, "波段")} / ` : "";
  const strategyText = `策略 ${rowStrategyLabel(row, strategy)} / `;
  const scoreText = isStrategy4 ? ` / score ${rowScore(row)}` : "";
  const subtitle = isStrategy4 ? `目標 ${rowTargetPrice(row)}` : `${strategyText}${zoneText}漲幅 ${rowPct(row)}${scoreText}`;
  const subtitleColor = isStrategy4 ? "#ff2d2d" : trendColor(percentRaw);
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    backgroundColor: index % 2 === 0 ? "#121b2b" : "#0e1624",
    borderColor: "#273951",
    borderWidth: "1px",
    cornerRadius: "6px",
    paddingAll: "9px",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          boxText(`#${index + 1} ${rowCode(row)} ${rowName(row)}`, { size: "sm", weight: "bold", color: "#ffffff", flex: 5 }),
          boxText(`${priceLabel} ${mainPrice}`, { size: "sm", weight: "bold", color: "#ffd76a", align: "end", flex: 3 }),
        ],
      },
      boxText(subtitle, { size: "xs", weight: isStrategy4 ? "bold" : "regular", color: subtitleColor }),
      ...(rowReason(row) ? [boxText(rowReason(row), { size: "xxs", color: "#8498b6" })] : []),
    ],
  };
}

function buildCard(strategy, payload, receipt = {}) {
  const isStrategy4 = strategy === "strategy4";
  const title = isStrategy4 ? "FUMAN 16:00" : "FUMAN 13:00";
  const subtitle = isStrategy4 ? "策略4完整掃描 LINE 圖卡" : "隔日沖完整掃描 LINE 圖卡";
  const matches = Array.isArray(payload.matches) ? payload.matches : Array.isArray(payload.rows) ? payload.rows : [];
  const count = cleanNumber(payload.count || payload.resultCount || matches.length || receipt.matches);
  const blockedReason = text(payload.blockedReason || payload.scanner_block_reason || payload.error || receipt.blockingReason || "", "");
  const ok = payload.ok === true && count > 0 && !blockedReason;
  const displayRows = matches;
  const scanDate = text(payload.scanStamp || payload.scanDate || payload.usedDate || receipt.startedAt || nowTaipeiIso(), "-");
  const runId = text(payload.runId || receipt.runId, "-");
  const expected = cleanNumber(payload.expectedTotal || payload.sourceHealth?.expectedTotal || receipt.total);
  const maxScore = displayRows.reduce((max, row) => Math.max(max, cleanNumber(row.score ?? row.overnightScore ?? row.swingScore ?? row.totalScore)), 0);
  const summary = isStrategy4
    ? `策略4完整掃描：本卡列出全部 ${count} 檔；正式使用仍以 terminal gate / runId closure 為準。`
    : `隔日沖雷達：本卡列出全部 ${count} 檔可回讀標的；進場價格優先顯示。`;

  return {
    type: "bubble",
    size: "giga",
    styles: { body: { backgroundColor: "#070b12" }, footer: { backgroundColor: "#070b12" } },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "16px",
      backgroundColor: "#070b12",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "box", layout: "vertical", flex: 5, contents: [
              boxText(title, { size: "xxl", weight: "bold", color: "#ffd76a" }),
              boxText(subtitle, { size: "sm", color: "#ffffff" }),
            ] },

          ],
        },
        { type: "separator", color: "#d89b20" },
        {
          type: "box",
          layout: "horizontal",
          spacing: "sm",
          contents: [
            metricBox("可回讀", String(count), "#ff5b4a"),
            metricBox("最高分", maxScore ? String(maxScore) : "-", "#ffd76a"),
            metricBox(isStrategy4 ? "掃描" : "進場", isStrategy4 && expected ? String(expected) : "13:00", "#ffffff"),
          ],
        },
        {
          type: "box",
          layout: "vertical",
          backgroundColor: "#0d1420",
          borderColor: "#273951",
          borderWidth: "1px",
          cornerRadius: "6px",
          paddingAll: "10px",
          contents: [
            boxText(`runId：${shortRunId(runId)}`, { size: "xxs", color: "#9fb2ce" }),
            boxText(`資料時間：${scanDate}`, { size: "xxs", color: "#9fb2ce" }),

          ],
        },
        boxText(matches.length ? `全部標的 ${matches.length} 檔` : (ok ? "全部標的" : "狀態"), { size: "md", weight: "bold", color: "#ffd76a" }),
        ...(displayRows.length ? displayRows.map((row, index) => rowBox(row, index, strategy)) : [
          { type: "box", layout: "vertical", backgroundColor: "#101827", borderColor: "#273951", borderWidth: "1px", cornerRadius: "6px", paddingAll: "12px", contents: [boxText("目前無可回讀標的", { size: "sm", color: "#ffffff", align: "center" })] },
        ]),
        { type: "box", layout: "vertical", backgroundColor: "#f2bd4b", cornerRadius: "6px", paddingAll: "10px", contents: [boxText(summary, { size: "sm", weight: "bold", color: "#090909" })] },
      ],
    },
  };
}

function makeResponse() {
  let statusCode = 200;
  let body;
  const headers = {};
  return {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    getHeader(name) { return headers[String(name).toLowerCase()]; },
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
    send(value) { body = value; return this; },
    end(value) { if (value !== undefined) body = value; return this; },
    result() { return { statusCode, body, headers }; },
  };
}

async function supabaseRest(pathname, options = {}) {
  const supabaseUrl = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
  const supabaseKey = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
  if (!supabaseUrl || !supabaseKey) throw new Error("missing_supabase_credentials");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 25000);
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/${pathname}`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: "application/json",
        ...(options.count ? { Prefer: "count=exact" } : {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const bodyText = await response.text();
    if (!response.ok) throw new Error(`${pathname} HTTP ${response.status} ${bodyText.slice(0, 300)}`.trim());
    const contentRange = response.headers.get("content-range") || "";
    const exactCount = contentRange.includes("/") ? Number(contentRange.split("/").pop()) : null;
    return { rows: bodyText ? JSON.parse(bodyText) : [], exactCount };
  } finally {
    clearTimeout(timer);
  }
}

function resultRowToPayload(row, index, runId, scanDate) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  return {
    ...payload,
    code: text(payload.code || row.code, ""),
    name: text(payload.rawName || payload.name || payload.displayName || row.name || row.code, ""),
    rawName: text(payload.rawName || payload.name || row.name || row.code, ""),
    rank: cleanNumber(payload.rank || row.rank || index + 1),
    score: cleanNumber(payload.score || row.score),
    price: cleanNumber(payload.price || payload.close || row.price || row.close),
    close: cleanNumber(payload.close || payload.price || row.close || row.price),
    changePercent: cleanNumber(payload.changePercent ?? payload.percent ?? row.change_percent),
    percent: cleanNumber(payload.percent ?? payload.changePercent ?? row.change_percent),
    reason: text(payload.reason || row.reason, ""),
    signals: Array.isArray(payload.signals) ? payload.signals : [],
    matches: Array.isArray(payload.matches) ? payload.matches : [],
    runId,
    usedDate: runIdDateKey(runId),
    scanDate,
    updatedAt: text(payload.updatedAt || row.updated_at, ""),
    source: text(payload.source || "strategy3_scan_results", "strategy3_scan_results"),
  };
}

async function readSupabaseStrategy3Payload() {
  const latest = await supabaseRest("v_strategy3_latest_complete_run?select=run_id,scan_date,status,expected_total,scanned_count,result_count,updated_at&limit=1");
  const latestRow = latest.rows?.[0] || {};
  const runId = text(latestRow.run_id || latestRow.runId, "");
  if (!runId) throw new Error("strategy3_latest_complete_run_missing_run_id");

  const runResult = await supabaseRest(`strategy3_scan_runs?select=run_id,strategy,status,complete,scan_date,expected_total,scanned_count,result_count,quality_status,updated_at,payload&run_id=eq.${encodeURIComponent(runId)}&limit=1`);
  const runRow = runResult.rows?.[0] || latestRow;
  const resultCount = cleanNumber(runRow.result_count ?? latestRow.result_count);
  const readLimit = Math.max(1, Math.min(2000, resultCount || 2000));
  const results = await supabaseRest(`strategy3_scan_results?select=run_id,strategy,rank,code,name,price,close,change_percent,score,reason,signals,payload,updated_at&run_id=eq.${encodeURIComponent(runId)}&strategy=eq.strategy3&order=rank.asc&limit=${readLimit}`, { count: true });
  const rows = Array.isArray(results.rows) ? results.rows : [];
  const scanDate = text(runRow.scan_date || latestRow.scan_date || runIdDateKey(runId), "");
  const matches = rows.map((row, index) => resultRowToPayload(row, index, runId, scanDate));
  // strategy3_stale_quote_guard_v1: never publish a line card if scan results used stale quote prices.
  const expectedDate = String(scanDate || runIdDateKey(runId) || "").replace(/\D/g, "").slice(0, 8);
  const staleQuoteRows = matches.filter((row) => {
    const quoteDate = String(row.quoteDate || row.sourceTradeDate || "").replace(/\D/g, "").slice(0, 8);
    return expectedDate && quoteDate && quoteDate !== expectedDate;
  });

  if (runRow.status !== "complete" || runRow.complete === false) throw new Error(`strategy3_run_not_complete:${runRow.status || "unknown"}`);
  if (resultCount > 0 && matches.length !== resultCount) throw new Error(`strategy3_result_readback_mismatch:${matches.length}/${resultCount}`);
  if (staleQuoteRows.length) {
    throw new Error(`strategy3_stale_quote_price_source:${staleQuoteRows.length}/${matches.length};sample=${staleQuoteRows.slice(0, 6).map((row) => row.code).join(",")}`);
  }

  return {
    ok: true,
    source: "supabase:strategy3_scan_results:line-card-readback",
    cacheSource: "supabase-line-card-readback",
    runId,
    usedDate: runIdDateKey(runId),
    scanDate,
    scanStamp: scanDate,
    count: resultCount || matches.length,
    resultCount: resultCount || matches.length,
    expectedTotal: cleanNumber(runRow.expected_total ?? latestRow.expected_total),
    scannedCount: cleanNumber(runRow.scanned_count ?? latestRow.scanned_count),
    qualityStatus: text(runRow.quality_status || "", ""),
    blockedReason: "",
    scanner_block_reason: "",
    matches,
    rows: matches,
    readbackCount: matches.length,
    lineCardReadback: {
      source: "strategy3_scan_runs/results",
      exactCount: results.exactCount,
      rowsRead: matches.length,
      checkedAt: new Date().toISOString(),
    },
  };
}

function shouldUseStrategy3SupabaseReadback(payload = {}) {
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  const count = cleanNumber(payload.count || payload.resultCount || matches.length);
  const blocked = text(payload.blockedReason || payload.scanner_block_reason || payload.error || "", "");
  if (payload.ok !== true || blocked) return true;
  if (cleanNumber(payload.resultCount) > matches.length) return true;
  if (count > matches.length) return true;
  return false;
}

async function readApi(strategy) {
  const apiFile = strategy === "strategy4" ? path.join(ROOT, "api", "strategy4-latest.js") : path.join(ROOT, "api", "strategy3-latest.js");
  const handler = require(apiFile);
  const url = `http://localhost/api/${strategy}-latest?canvas=1&compact=1&shell=1&limit=70&live=1&fresh=${Date.now()}`;
  const request = { method: "GET", url, headers: {}, query: {}, fumanInternalVerify: true };
  const response = makeResponse();
  await handler(request, response);
  const result = response.result();
  const body = result.body && typeof result.body === "object" ? result.body : { ok: false, error: "api_no_json_body", detail: String(result.body || "") };
  body.httpStatusCode = result.statusCode;
  return body;
}

function readScanReceipt(strategy) {
  try {
    return JSON.parse(fs.readFileSync(path.join(RUNTIME_DIR, "data", "scan-receipts", `${strategy}.json`), "utf8"));
  } catch {
    return {};
  }
}

function runIdDateKey(value) {
  const textValue = String(value || "");
  const match = textValue.match(/(?:strategy[0-9]+|opening-report-0830)-(\d{8})/i);
  return match ? match[1] : "";
}

function payloadDateKey(payload, receipt) {
  const direct = [payload?.date, payload?.usedDate, payload?.tradeDate, payload?.scanDate, payload?.scanStamp, receipt?.startedAt, receipt?.finishedAt];
  for (const value of direct) {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length >= 8) return digits.slice(0, 8);
  }
  return runIdDateKey(payload?.runId) || runIdDateKey(receipt?.runId);
}

async function main() {
  const strategy = String(argValue("strategy", "")).toLowerCase();
  if (!new Set(["strategy3", "strategy4"]).has(strategy)) throw new Error("Use --strategy=strategy3 or --strategy=strategy4");
  const dryRun = process.argv.includes("--dry-run");
  const lineEnv = loadLineEnv();
  const scanReceipt = readScanReceipt(strategy);
  let payload;
  let apiError = "";
  try {
    payload = await readApi(strategy);
  } catch (error) {
    apiError = error?.message || String(error);
    payload = { ok: false, error: `${strategy}_latest_api_read_failed`, detail: apiError, matches: [] };
  }
  // strategy3_terminal_api_only_v1: LINE must mirror terminal API canonical output.
  // Do not fill terminal API partial/blocked results from strategy3_scan_results.
  const altText = strategy === "strategy4" ? "FUMAN 16:00 策略4完整掃描" : "FUMAN 13:00 隔日沖完整掃描";
  const count = cleanNumber(payload.count || payload.resultCount || (Array.isArray(payload.matches) ? payload.matches.length : 0) || scanReceipt.matches);
  const baseBlockedReason = text(payload.blockedReason || payload.scanner_block_reason || payload.error || scanReceipt.blockingReason || apiError, "");
  const today = compactDate();
  const runId = payload.runId || scanReceipt.runId || "";
  const dataDate = payloadDateKey(payload, scanReceipt) || runIdDateKey(runId);
  const dateAligned = dataDate === today;
  const staleReason = dateAligned ? "" : `strategy_line_card_date_mismatch:today=${today};dataDate=${dataDate || "unknown"};runId=${runId || "missing"}`;
  const blockedReason = [baseBlockedReason, staleReason].filter(Boolean).join("; ");
  const publicCount = dateAligned ? count : 0;
  const publicRunId = dateAligned ? runId : "";
  const receipt = {
    ok: dateAligned,
    date: today,
    strategy,
    checked_at: nowTaipeiIso(),
    dry_run: dryRun,
    message_type: "flex",
    api_http_status: payload.httpStatusCode || null,
    payload_ok: payload.ok === true,
    status: !dateAligned ? "fail_closed_no_today_run" : (payload.ok === true && count > 0 && !blockedReason ? "ready" : "blocked_or_empty"),
    reason_code: !dateAligned ? "strategy_line_card_date_mismatch" : "",
    line_push_ok: false,
    line_target_configured: Boolean(lineEnv.token && lineEnv.to),
    line_target_valid: !invalidLineTarget(lineEnv.to),
    count: publicCount,
    runId: publicRunId,
    previous_good_runId: dateAligned ? "" : runId,
    previous_good_count: dateAligned ? 0 : count,
    accepted_symbols: dateAligned && Array.isArray(payload.matches) ? payload.matches.map(rowCode).filter(Boolean) : [],
    accepted_rows: dateAligned && Array.isArray(payload.matches) ? payload.matches.map((row, index) => ({
      rank: index + 1,
      code: rowCode(row),
      name: rowName(row),
      price: rowPrice(row),
      entryPrice: rowEntryPrice(row),
      changePercent: rowPct(row),
      score: rowScore(row),
      targetPrice: rowTargetPrice(row),
      stopPrice: price(row.stopPrice ?? row.mutakiV17?.stopPrice ?? row.payload?.stopPrice ?? row.payload?.mutakiV17?.stopPrice),
      riskReward: cleanNumber(row.riskReward ?? row.mutakiV17?.riskReward ?? row.payload?.riskReward ?? row.payload?.mutakiV17?.riskReward),
      zone: text(row.zone || row.swingZone || row.payload?.zone || row.payload?.swingZone, ""),
      zoneLabel: text(row.zoneLabel || row.swingZoneLabel || row.zone_label || row.payload?.zoneLabel || row.payload?.swingZoneLabel || row.payload?.zone_label, ""),
      strategyLabel: rowStrategyLabel(row, strategy),
      priceSource: text(row.priceSource || row.price_source || row.payload?.priceSource || row.payload?.price_source, ""),
      targetPriceSource: text(row.targetPriceSource || row.target_price_source || row.payload?.targetPriceSource || row.payload?.target_price_source || (row.mutakiV17?.targetPrice || row.payload?.mutakiV17?.targetPrice ? "mutakiV17.targetPrice" : ""), ""),
      signals: (Array.isArray(row.signals) ? row.signals : Array.isArray(row.payload?.signals) ? row.payload.signals : []).map(strategySignalLabel).filter(Boolean).slice(0, 6),
      entryPriceSource: text(row.entryPriceSource || row.entry_price_source || row.payload?.entryPriceSource || row.payload?.entry_price_source, ""),
      entryCandleTime: text(row.entryCandleTime || row.entry_candle_time || row.payload?.entryCandleTime || row.payload?.entry_candle_time, ""),
      entryTradeDate: text(row.entryTradeDate || row.entry_trade_date || row.payload?.entryTradeDate || row.payload?.entry_trade_date, ""),
      entryWindow: text(row.entryWindow || row.payload?.entryWindow, ""),
      entryWindowStart: text(row.entryWindowStart || row.payload?.entryWindowStart, ""),
      entryWindowEnd: text(row.entryWindowEnd || row.payload?.entryWindowEnd, ""),
    })).filter((row) => row.code) : [],
    dataDate,
    dateAligned,
    blockedReason,
    api_error: apiError,
  };

  if (!dateAligned) {
    const file = writeReceipt(strategy, receipt);
    console.log(JSON.stringify({ ok: false, dry_run: dryRun, strategy, line_push_ok: false, status: receipt.status, reason_code: receipt.reason_code, count: publicCount, runId: publicRunId, previous_good_runId: receipt.previous_good_runId, dataDate, blockedReason, receipt_path: file }, null, 2));
    if (!dryRun) process.exitCode = 2;
    return;
  }

  const card = buildCard(strategy, payload, scanReceipt);
  if (!dryRun) {
    if (!lineEnv.token || invalidLineTarget(lineEnv.to)) throw new Error("Missing valid LINE token or target userId");
    const { sendLineFlex } = require(path.join(ROOT, "scripts", "line-push.js"));
    await sendLineFlex(altText, card, { idempotencyKey: `strategy-line-card:${strategy}:${receipt.date}:${receipt.runId || "no-run"}:${receipt.status}` });
    receipt.line_push_ok = true;
  }
  const file = writeReceipt(strategy, receipt);
  console.log(JSON.stringify({ ok: true, dry_run: dryRun, strategy, line_push_ok: receipt.line_push_ok, status: receipt.status, count, runId: receipt.runId, blockedReason, receipt_path: file }, null, 2));
}

main().catch((error) => {
  const strategy = String(argValue("strategy", "unknown")).toLowerCase();
  const receipt = {
    ok: false,
    date: compactDate(),
    strategy,
    checked_at: nowTaipeiIso(),
    dry_run: process.argv.includes("--dry-run"),
    message_type: "flex",
    line_push_ok: false,
    error: error?.message || String(error),
  };
  let file = "";
  try { file = writeReceipt(strategy, receipt); } catch {}
  console.error(JSON.stringify({ ok: false, strategy, error: receipt.error, receipt_path: file }, null, 2));
  process.exit(1);
});











