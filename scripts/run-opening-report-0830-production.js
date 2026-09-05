"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { upsertSnapshot } = require("../lib/supabase-snapshots");
const { OPENING_REPORT_0830_INDUSTRY_MAP } = require("./opening-report-0830-industry-map-contract.js");
const { isTwseTradingDay } = require("./twse-trading-day.js");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "opening-report-0830");
const BRIDGE_SCRIPT = path.resolve(__dirname, "apply-opening-report-0830-priority-bias-bridge.js");
const SOURCE = "opening_report_0830";
const MODE = "priority_bias_only";
const ALLOWED_ACTION = "boost_scan_priority_only";
const FORBIDDEN_ACTION = "publish_formal_candidate_without_taiwan_evidence";

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const match = process.argv.find((item) => item === name || item.startsWith(prefix));
  return match === name ? "1" : (match ? match.slice(prefix.length) : fallback);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function timestamp() {
  return new Date().toISOString();
}

function taipeiMinuteOfDay(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}
async function waitUntilTaipeiMinute(targetMinute) {
  while (taipeiMinuteOfDay() < targetMinute) await sleep(Math.min(15000, (targetMinute - taipeiMinuteOfDay()) * 60000));
}
function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function writeJson(file, value) {
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function windowsUserEnv(name) {
  if (process.env[name]) return { value: process.env[name], source: "process_env" };
  const result = spawnSync("reg", ["query", "HKCU\\Environment", "/v", name], { encoding: "utf8", windowsHide: true });
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  const line = text.split(/\r?\n/).find((row) => new RegExp(`\\s${name}\\s+REG_`).test(row));
  if (!line) return { value: "", source: "missing" };
  const parts = line.trim().split(/\s{2,}/);
  const value = parts.length >= 3 ? parts.slice(2).join("  ").trim() : "";
  return { value, source: value ? "windows_user_env" : "missing" };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableStatus(status) {
  return status === 429 || status >= 500;
}

async function fetchWithRetry(url, options = {}) {
  const attempts = [];
  const backoff = [2000, 5000, 10000];
  for (let index = 0; index < 3; index += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs || 9000) : undefined });
      const text = await response.text();
      attempts.push({ attempt: index + 1, status: response.status, retryable: retryableStatus(response.status) });
      if (response.ok) return { ok: true, status: response.status, text, attempts };
      if (!retryableStatus(response.status)) return { ok: false, status: response.status, text, attempts };
    } catch (error) {
      attempts.push({ attempt: index + 1, status: 0, retryable: true, error: error?.message || String(error) });
    }
    if (index < 2) await sleep(backoff[index]);
  }
  return { ok: false, status: attempts.at(-1)?.status || 0, text: "", attempts };
}

function approxBiasText(item) {
  return `${item.display_name}: ${item.bias}, confidence=${item.confidence}, ${item.evidence_summary}`;
}

function baseIndustryItems(tradeDate, runId) {
  const compact = tradeDate.replace(/\D/g, "");
  // 08:30 must consume frozen 08:20 evidence only; it must never refetch or
  // recalculate the overseas direction after the evidence cutoff.
  const leaders = readJson(path.join(RECEIPT_DIR, `opening-report-0820-overseas-leaders-${compact}.json`));
  const detected = new Map((leaders?.industries || []).map((row) => [row.industry, row]));
  const rows = OPENING_REPORT_0830_INDUSTRY_MAP.map((mapRow) => {
    const row = detected.get(mapRow.industry) || {};
    const average = Number(row.average_percent);
    const direction = row.direction || (average > 0.3 ? "positive" : average < -0.3 ? "negative" : "neutral");
    return {
      industry: mapRow.industry,
      display_name: mapRow.display_name,
      bias: `${direction}_mixed`,
      confidence: Number(mapRow.default_confidence || 0),
      evidence_summary: Number.isFinite(average) ? `海外族群平均漲幅 ${average.toFixed(2)}%` : mapRow.evidence_summary,
      overseas_return_1d_pct: Number.isFinite(average) ? average : null,
      overseas_leader_detection: row,
      mapped_symbols_a: mapRow.a,
      mapped_symbols_b: mapRow.b,
      mapped_symbols: [...mapRow.a, ...mapRow.b],
    };
  });
  const positive = rows.filter((row) => row.bias.startsWith("positive")).sort((a, b) => Number(b.overseas_return_1d_pct) - Number(a.overseas_return_1d_pct));
  const positiveRank = new Map(positive.map((row, index) => [row.industry, index + 1]));
  return rows.map((item) => ({
    date: tradeDate,
    report_time: "08:30",
    run_id: `${runId}-${item.industry}`,
    source: SOURCE,
    mode: MODE,
    industry: item.industry,
    display_name: item.display_name,
    bias: item.bias,
    confidence: item.confidence,
    evidence_summary: item.evidence_summary,
    overseas_return_1d_pct: item.overseas_return_1d_pct,
    positive_return_rank: positiveRank.get(item.industry) || null,
    overseas_leader_detection: item.overseas_leader_detection,
    mapped_symbols_a: item.mapped_symbols_a,
    mapped_symbols_b: item.mapped_symbols_b,
    mapped_symbols: item.mapped_symbols,
    allowed_action: ALLOWED_ACTION,
    forbidden_action: FORBIDDEN_ACTION
  }));
}

function readTaiwanGate(tradeDate) {
  const preflight = readJson(path.join(STATE_DIR, "daytrade-preflight-0830.json"));
  const watchdogCandidates = fs.existsSync(STATE_DIR)
    ? fs.readdirSync(STATE_DIR).filter((name) => name.startsWith(`daytrade-unattended-gate-watchdog-evidence-${tradeDate.replace(/\D/g, "")}`)).sort()
    : [];
  const watchdog = watchdogCandidates.length ? readJson(path.join(STATE_DIR, watchdogCandidates.at(-1))) : readJson(path.join(STATE_DIR, "daytrade-unattended-gate-watchdog.json"));
  const ok = preflight?.ok === true && watchdog?.formal_entry_allowed === true;
  return {
    ok,
    preflight_ok: preflight?.ok === true,
    formal_entry_allowed: watchdog?.formal_entry_allowed === true,
    canonical_gate_status: watchdog?.metrics?.canonical_gate_status || watchdog?.canonical_gate_status || "",
    canonical_gate_grade: watchdog?.metrics?.canonical_gate_grade || watchdog?.canonical_gate_grade || "",
    first_blocker: ok ? "" : "daytrade_preflight_0830_or_formal_gate_not_ready",
    reason_code: ok ? "taiwan_formal_gate_ready" : "taiwan_formal_gate_fail_closed"
  };
}

async function buildOverseasPreflight(tradeDate, runId, mock) {
  const groups = [
    { key: "us_close", url: "https://www.google.com/finance/quote/.IXIC:INDEXNASDAQ", required: true },
    { key: "japan_morning", url: "https://www.google.com/finance/quote/NI225:INDEXNIKKEI", required: true },
    { key: "korea_morning", url: "https://www.google.com/finance/quote/KOSPI:KRX", required: true }
  ];
  const checks = [];
  for (const group of groups) {
    if (mock) {
      checks.push({ key: group.key, ok: true, status: 200, attempts: [{ attempt: 1, status: 200 }], mode: "mock_self_test" });
      continue;
    }
    const result = await fetchWithRetry(group.url, { timeoutMs: 9000 });
    checks.push({ key: group.key, ok: result.ok, status: result.status, attempts: result.attempts, url: group.url });
  }
  const ok = checks.every((row) => row.ok || !groups.find((group) => group.key === row.key)?.required);
  return {
    contract: "opening-report-0830-overseas-preflight-v1",
    ok,
    status: ok ? "PASS" : "FAIL_CLOSED",
    date: tradeDate,
    run_id: runId,
    checked_at: timestamp(),
    mode: "directional_approximate",
    max_attempts: 3,
    retry_on: ["network_timeout", "dns_error", "http_429", "http_5xx"],
    checks,
    reason_code: ok ? "overseas_directional_sources_available" : "overseas_source_preflight_failed"
  };
}

function markdownReport({ tradeDate, runId, overseasPreflight, items, taiwanGate }) {
  const lines = [];
  lines.push(`# Fuman 台股 08:30 開盤前日報`);
  lines.push("");
  lines.push(`日期：${tradeDate}`);
  lines.push(`run_id：${runId}`);
  lines.push(`資料截點：${tradeDate} 08:30:59 Asia/Taipei`);
  lines.push("");
  lines.push(`結論：${taiwanGate.ok ? "台股 Formal Gate READY" : "FAIL_CLOSED，正式可沖候選 0 檔"}。海外方向已完成預檢，可提供母池 priority_scan。`);
  lines.push("");
  lines.push("## 海外產業方向");
  lines.push("");
  lines.push("| 產業 | bias | confidence | 台股對應 | 判讀 |");
  lines.push("|---|---|---:|---|---|");
  for (const item of items.filter((row) => Number(row.positive_return_rank) >= 1 && Number(row.positive_return_rank) <= 3).sort((a, b) => a.positive_return_rank - b.positive_return_rank)) {
    lines.push(`| ${item.industry} | ${item.bias} | ${item.confidence} | ${item.mapped_symbols.map((row) => `${row.symbol} ${row.name}`).join("、")} | ${item.evidence_summary} |`);
  }
  lines.push("");
  lines.push("## 台股 Gate");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(taiwanGate, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Final");
  lines.push("");
  lines.push("```text");
  lines.push(`report_status=${taiwanGate.ok ? "PASS" : "FAIL_CLOSED"}`);
  lines.push("formal_candidates: 0");
  lines.push("watchlist_only: true");
  lines.push("formal_candidates=0");
  lines.push("watchlist_only=true");
  lines.push("mode=industry_observation_only");
  lines.push(`overseas_sources_ok=${overseasPreflight.ok}`);
  lines.push("formal_trading_use=false");
  lines.push("```");
  return `${lines.join("\n")}\n`;
}

function runBridge(inputPath, receiptPath, tradeDate) {
  const result = spawnSync(process.execPath, [BRIDGE_SCRIPT, `--input=${inputPath}`, `--receipt=${receiptPath}`, `--expected-date=${tradeDate.replace(/\D/g, "")}`], {
    encoding: "utf8",
    windowsHide: true,
    cwd: path.resolve(__dirname, "..")
  });
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}

function splitLineTargets(value) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function lineTargetType(target) {
  const first = String(target || "")[0] || "";
  if (first === "U") return "user";
  if (first === "C") return "group";
  if (first === "R") return "room";
  return "unknown";
}

function lineStockNames(rows, limit = 6) {
  const list = Array.isArray(rows) ? rows : [];
  const names = list.slice(0, limit).map((row) => Array.isArray(row) ? row[1] : String(row?.name || row?.symbol || row || "")).filter(Boolean);
  const remaining = Math.max(0, list.length - limit);
  return names.join("、") + (remaining ? `（另有 ${remaining} 檔）` : "");
}

function lineReportText(tradeDate, displayTop3) {
  const medals = ["🥇", "🥈", "🥉"];
  const sections = displayTop3.map((item, index) => [
    `${medals[index] || `${item.positive_return_rank}.`} ${item.display_name}`,
    `海外平均漲幅：${Number(item.overseas_return_1d_pct) >= 0 ? "+" : ""}${Number(item.overseas_return_1d_pct).toFixed(2)}%`,
    `台股 A：${lineStockNames(item.mapped_symbols_a) || "無"}`,
    `台股 B：${lineStockNames(item.mapped_symbols_b) || "無"}`,
  ].join("\n"));
  return [
    "📈 08:30 漲幅族群晨報",
    `${tradeDate}｜15 個產業掃描完成`,
    "",
    sections.join("\n\n"),
  ].join("\n");
}

function lineReportFlex(tradeDate, displayTop3) {
  const medals = ["🥇", "🥈", "🥉"];
  const body = [];
  displayTop3.forEach((item, index) => {
    body.push({ type: "text", text: `${medals[index] || `${item.positive_return_rank}.`} ${item.display_name}`, weight: "bold", size: "md", wrap: true, margin: index ? "lg" : "none" });
    body.push({ type: "text", text: `海外平均漲幅：${Number(item.overseas_return_1d_pct) >= 0 ? "+" : ""}${Number(item.overseas_return_1d_pct).toFixed(2)}%`, size: "sm", color: Number(item.overseas_return_1d_pct) >= 0 ? "#169B62" : "#D64545", wrap: true });
    body.push({ type: "text", text: `台股 A：${lineStockNames(item.mapped_symbols_a) || "無"}`, size: "sm", wrap: true });
    body.push({ type: "text", text: `台股 B：${lineStockNames(item.mapped_symbols_b) || "無"}`, size: "sm", wrap: true });
  });
  return {
    type: "bubble",
    header: { type: "box", layout: "vertical", contents: [{ type: "text", text: "📈 08:30 漲幅族群晨報", weight: "bold", wrap: true }, { type: "text", text: `${tradeDate}｜15 個產業掃描完成`, size: "xs", color: "#777777", margin: "sm", wrap: true }] },
    body: { type: "box", layout: "vertical", spacing: "sm", contents: body },
  };
}

function invalidLineTarget(target) {
  const value = String(target || "").trim();
  return !/^[UCR][0-9a-f]{32}$/i.test(value);
}

function collectLineTargets() {
  const envNames = [
    "FUMAN_LINE_TO",
    "FUMAN_LINE_TO_USER",
    "FUMAN_LINE_USER_ID",
    "FUMAN_LINE_TO_GROUP",
    "FUMAN_LINE_GROUP_ID",
    "FUMAN_LINE_TO_ROOM",
    "FUMAN_LINE_ROOM_ID",
    "LINE_TO",
    "LINE_TARGET_ID",
    "LINE_USER_ID",
    "LINE_GROUP_ID",
  ];
  const seen = new Set();
  const targets = [];
  for (const envName of envNames) {
    const env = windowsUserEnv(envName);
    for (const target of splitLineTargets(env.value)) {
      if (seen.has(target)) continue;
      seen.add(target);
      targets.push({ target, env_name: envName, source: env.source, target_type: lineTargetType(target) });
    }
  }
  return targets;
}

async function pushLine({ cardText, flexCard, runId, dryRun }) {
  const token = windowsUserEnv("FUMAN_LINE_CHANNEL_ACCESS_TOKEN");
  const targets = collectLineTargets();
  const invalidTargets = targets.filter((row) => invalidLineTarget(row.target));
  const base = {
    line_push_attempted: !dryRun,
    line_push_ok: false,
    attempts: 0,
    retryable_errors: [],
    non_retryable_error: "",
    token_source: token.source === "process_env" ? "windows_user_env" : token.source,
    token_logged: false,
    target_logged: false,
    report_run_id: runId,
    checked_at: timestamp()
  };
  if (!token.value || targets.length === 0) {
    return { ...base, reason_code: "line_env_missing", missing_env: [!token.value ? "FUMAN_LINE_CHANNEL_ACCESS_TOKEN" : "", targets.length === 0 ? "FUMAN_LINE_TO_OR_TARGET_ENV" : ""].filter(Boolean), target_count: targets.length };
  }
  if (invalidTargets.length) {
    return { ...base, reason_code: "line_target_invalid", missing_env: invalidTargets.map((row) => row.env_name), target_count: targets.length, target_types: targets.map((row) => row.target_type) };
  }
  const messages = flexCard
    ? [{ type: "flex", altText: String(cardText || "Fuman 08:30 開盤前日報").slice(0, 400), contents: flexCard }]
    : [{ type: "text", text: String(cardText || "").slice(0, 4500) }];
  if (dryRun) {
    return {
      ...base,
      line_push_attempted: false,
      line_push_ok: true,
      reason_code: "line_dry_run_flex_card_ready",
      message_type: flexCard ? "flex" : "text",
      target_count: targets.length,
      delivered_count: targets.length,
      target_types: targets.map((row) => row.target_type),
      has_user_target: targets.some((row) => row.target_type === "user"),
      has_group_target: targets.some((row) => row.target_type === "group"),
    };
  }
  const results = [];
  for (const row of targets) {
    const body = { to: row.target, messages };
    const result = await fetchWithRetry("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: "Bearer " + token.value, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 9000
    });
    results.push({ target_type: row.target_type, env_name: row.env_name, ok: result.ok, status: result.status, attempts: result.attempts.length, text: result.text || "" });
  }
  const failed = results.filter((row) => !row.ok);
  return {
    ...base,
    line_push_attempted: true,
    line_push_ok: failed.length === 0,
    message_type: flexCard ? "flex" : "text",
    target_count: targets.length,
    delivered_count: results.filter((row) => row.ok).length,
    target_types: targets.map((row) => row.target_type),
    has_user_target: targets.some((row) => row.target_type === "user"),
    has_group_target: targets.some((row) => row.target_type === "group"),
    attempts: results.reduce((sum, row) => sum + row.attempts, 0),
    retryable_errors: [],
    non_retryable_error: failed.length ? "line_targets_failed_" + failed.length : "",
    line_error_detail: failed.map((row) => row.target_type + ":http_" + row.status + " " + String(row.text || "").slice(0, 160)).join("; "),
    reason_code: failed.length ? "line_push_failed" : "line_push_ok"
  };
}

async function syncTerminalBriefingSnapshot(tradeDate, runId) {
  try {
    if (typeof upsertSnapshot !== "function") {
      return { ok: false, reason_code: "opening_report_0830_terminal_snapshot_writer_missing" };
    }
    const compact = String(tradeDate || "").replace(/\D/g, "").slice(0, 8);
    const marketAiLive = require("../api/market-ai-live");
    const briefing = marketAiLive.__test.readOpeningMorningReport({
      date: compact ? compact.slice(0, 4) + "-" + compact.slice(4, 6) + "-" + compact.slice(6, 8) : tradeDate,
      ymd: compact,
      seconds: 8 * 60 * 60 + 30 * 60,
      time: "08:30:00",
    });
    const payload = {
      ...briefing,
      source: "opening_report_0830_terminal_briefing",
      updatedAt: timestamp(),
    };
    return await upsertSnapshot("opening_report_0830_terminal_briefing", payload, {
      tradeDate,
      snapshotId: runId,
      source: "opening_report_0830_terminal_briefing",
      reason: "opening-report-0830-production",
      locked: false,
    });
  } catch (error) {
    return {
      ok: false,
      reason_code: "opening_report_0830_terminal_snapshot_sync_failed",
      error: error?.message || String(error),
    };
  }
}

async function main() {
  const tradeDate = argValue("--date", process.env.FUMAN_TRADE_DATE || taipeiDateKey());
  const compact = tradeDate.replace(/\D/g, "");
  const runId = argValue("--run-id", `opening-report-0830-${compact}-${Date.now()}`);
  const isolatedBacktest = hasFlag("--isolated-backtest") || hasFlag("--self-test");
  if (!isolatedBacktest) {
    const calendarDate = new Date(`${tradeDate}T12:00:00+08:00`);
    const tradingDay = await isTwseTradingDay(calendarDate, { stateDir: STATE_DIR });
    if (tradingDay.isTradingDay !== true) {
      const finalPath = path.join(RECEIPT_DIR, `opening-report-0830-final-receipt-${compact}.json`);
      const skipped = {
        contract: "opening-report-0830-production-v1",
        ok: true,
        complete: false,
        status: "skipped",
        report_status: "MARKET_CLOSED",
        reason_code: "market_calendar_non_trading_day",
        first_blocker: null,
        date: tradeDate,
        trade_date: tradeDate,
        run_id: runId,
        market_status: "closed",
        closed_reason: tradingDay.reason || "market_closed",
        formal_scan_skipped: true,
        latest_pointer_updated: false,
        industry_bias_exported: false,
        mother_pool_bridge_attempted: false,
        line_push_attempted: false,
        terminal_snapshot_attempted: false,
        no_side_effects: true,
        checked_at: timestamp(),
      };
      writeJson(finalPath, skipped);
      console.log(JSON.stringify({ ok: true, status: "skipped", reason_code: skipped.reason_code, no_side_effects: true, final_receipt: finalPath }, null, 2));
      return;
    }
  }
  if (hasFlag("--freeze-market-snapshot")) {
    const frozenLeadersPath = path.join(RECEIPT_DIR, `opening-report-0820-overseas-leaders-${compact}.json`);
    const frozenLeaders = readJson(frozenLeadersPath);
    const frozenItems = Array.isArray(frozenLeaders?.industries) ? frozenLeaders.industries : [];
    const snapshotPath = path.join(RECEIPT_DIR, `opening-report-0820-market-snapshot-${compact}.json`);
    const snapshot = {
      contract: "opening-report-0820-frozen-market-snapshot-v1",
      ok: frozenLeaders?.ok === true && frozenItems.length === 15,
      date: tradeDate,
      trade_date: tradeDate,
      run_id: runId,
      cutoff: `${tradeDate} 08:20:00 Asia/Taipei`,
      source_receipt: frozenLeadersPath,
      industry_count: frozenItems.length,
      items: frozenItems,
      observation_only: true,
      terminal_published: false,
      line_pushed: false,
      mother_pool_bridge_attempted: false,
      checked_at: timestamp(),
      reason_code: frozenLeaders?.ok === true && frozenItems.length === 15
        ? "opening_report_0820_market_snapshot_frozen"
        : "opening_report_0820_market_snapshot_source_incomplete",
    };
    writeJson(snapshotPath, snapshot);
    console.log(JSON.stringify({ ok: snapshot.ok, snapshot_path: snapshotPath, run_id: runId, industry_count: frozenItems.length, no_delivery: true }, null, 2));
    if (!snapshot.ok) process.exitCode = 1;
    return;
  }
const mock = hasFlag("--self-test") || hasFlag("--mock-overseas") || hasFlag("--isolated-backtest");
  // Production always hands the same-day report to Mother Pool. Only an
  // explicit isolated test may suppress the bridge.
  const applyBridge = !mock && !hasFlag("--skip-bridge");
  const reuseLineReceipt = hasFlag("--reuse-line-receipt");
  const sendLine = !mock && !reuseLineReceipt;
  const dryRunLine = mock;

  const overseasPreflight = await buildOverseasPreflight(tradeDate, runId, mock);
  const items = baseIndustryItems(tradeDate, runId);
  const displayTop3 = items
    .filter((row) => Number(row.positive_return_rank) >= 1 && Number(row.positive_return_rank) <= 3)
    .sort((a, b) => Number(a.positive_return_rank) - Number(b.positive_return_rank));
  const deliveryContentHash = crypto.createHash("sha256").update(JSON.stringify(displayTop3.map((row) => ({ rank: row.positive_return_rank, industry: row.industry, average_percent: row.overseas_return_1d_pct })))).digest("hex");
  const taiwanGate = readTaiwanGate(tradeDate);
  const reportPath = path.join(RECEIPT_DIR, `opening-report-0830-${compact}.md`);
  const overseasPath = path.join(RECEIPT_DIR, `overseas-preflight-${compact}.json`);
  const finalPath = path.join(RECEIPT_DIR, `opening-report-0830-final-receipt-${compact}.json`);
  ensureDir(reportPath);
  fs.writeFileSync(reportPath, markdownReport({ tradeDate, runId, overseasPreflight, items, taiwanGate }), "utf8");
  writeJson(overseasPath, overseasPreflight);
  const bridgeResults = [];
  if (applyBridge && !mock) await waitUntilTaipeiMinute(8 * 60 + 35);
  for (const item of items) {
    const inputPath = path.join(STATE_DIR, `opening_report_0830.industry_bias.${item.industry}.json`);
    const receiptPath = path.join(RUNTIME_DIR, "data", "scan-receipts", `opening-report-0830-priority-bias-bridge-${item.industry}-${compact}.json`);
    writeJson(inputPath, item);
    const top3 = Number(item.positive_return_rank) >= 1 && Number(item.positive_return_rank) <= 3;
    if (isolatedBacktest && top3) bridgeResults.push({ industry: item.industry, positive_return_rank: item.positive_return_rank, inputPath, receiptPath, result: { exitCode: 0, simulated: true }, reason_code: "isolated_bridge_contract_pass" });
    else if (applyBridge && top3) bridgeResults.push({ industry: item.industry, positive_return_rank: item.positive_return_rank, inputPath, receiptPath, result: runBridge(inputPath, receiptPath, tradeDate) });
    else bridgeResults.push({ industry: item.industry, positive_return_rank: item.positive_return_rank, inputPath, receiptPath, skipped: true, reason_code: top3 ? "bridge_apply_not_requested" : "not_positive_return_top3_bridge_skip" });
  }
  const lineReceiptPath = path.join(RECEIPT_DIR, `line-push-receipt-${compact}.json`);
  const lineReceipt = isolatedBacktest
    ? { line_push_attempted: false, line_push_ok: true, simulated: true, reason_code: "isolated_line_flex_payload_pass", target_count: 2, delivered_count: 2, has_user_target: true, has_group_target: true, token_logged: false, target_logged: false }
    : reuseLineReceipt
    ? readJson(lineReceiptPath)
    : await pushLine({ cardText: lineReportText(tradeDate, displayTop3), flexCard: lineReportFlex(tradeDate, displayTop3), runId, dryRun: dryRunLine });
  Object.assign(lineReceipt, {
    ok: lineReceipt?.line_push_ok === true,
    run_id: runId,
    report_run_id: runId,
    delivery_content_hash: deliveryContentHash,
  });
  writeJson(lineReceiptPath, lineReceipt);
  const lineDeliveryOk = lineReceipt?.line_push_ok === true && (!reuseLineReceipt || String(lineReceipt?.report_run_id || lineReceipt?.run_id || "") === runId);
  const successfulBridgeCount = bridgeResults.filter((row) => Number(row.positive_return_rank) >= 1 && Number(row.positive_return_rank) <= 3 && row.result?.exitCode === 0).length;
  const bridgeAggregatePath = path.join(RECEIPT_DIR, `opening-report-0830-bridge-aggregate-${compact}.json`);
  const bridgeAggregate = {
    contract: "opening-report-0830-positive-top3-bridge-aggregate-v1",
    status: (applyBridge || isolatedBacktest) && successfulBridgeCount === displayTop3.length ? "BRIDGE_OK" : "BRIDGE_FAIL_CLOSED",
    run_id: runId,
    trade_date: tradeDate,
    industry_count: displayTop3.length,
    successful_industry_count: successfulBridgeCount,
    forbidden_publish_guard: true,
    formal_candidate_count: 0,
    formal_candidate_allowed: false,
    checked_at: timestamp(),
  };
  writeJson(bridgeAggregatePath, bridgeAggregate);
  const final = {
    contract: "opening-report-0830-production-v1",
    ok: overseasPreflight.ok && Boolean(reportPath) && lineDeliveryOk,
    report_status: taiwanGate.ok ? "PASS" : "FAIL_CLOSED",
    overseas_sources_ok: overseasPreflight.ok,
    industry_bias_exported: true,
    mother_pool_bridge_attempted: applyBridge || isolatedBacktest,
    mother_pool_bridge_ok: (applyBridge || isolatedBacktest) ? bridgeResults.filter((row) => Number(row.positive_return_rank) >= 1 && Number(row.positive_return_rank) <= 3).every((row) => row.result?.exitCode === 0) : null,
    line_push_attempted: sendLine,
    line_push_ok: lineDeliveryOk,
    delivery_content_hash: deliveryContentHash,
    line_receipt_reused: reuseLineReceipt,
    display_contract: "opening_report_positive_return_top3_only_v1",
    expected_industry_count: OPENING_REPORT_0830_INDUSTRY_MAP.length,
    scanned_industry_count: items.length,
    bridge_contract: "positive_overseas_return_top3_only",
    bridge_delivery_invariant: "It must never change the 08:30 report delivery decision.",
    display_top3: displayTop3.map((row) => ({ rank: row.positive_return_rank, industry: row.industry, display_name: row.display_name, average_percent: row.overseas_return_1d_pct })),
    formal_candidates: 0,
    watchlist_only: true,
    run_id: runId,
    date: tradeDate,
    report_path: reportPath,
    overseas_preflight_receipt: overseasPath,
    line_push_receipt: lineReceiptPath,
    bridge_results: bridgeResults.map((row) => ({ industry: row.industry, positive_return_rank: row.positive_return_rank ?? null, inputPath: row.inputPath, receiptPath: row.receiptPath, skipped: row.skipped === true, exitCode: row.result?.exitCode ?? null, reason_code: row.reason_code || "" })),
    bridge_aggregate_receipt: bridgeAggregatePath,
    taiwan_gate: taiwanGate,
    checked_at: timestamp()
  };
  writeJson(finalPath, final);
  const terminalBriefingSnapshot = isolatedBacktest
    ? { ok: true, key: "opening_report_0830_terminal_briefing", tradeDate: compact, attempts: 0, simulated: true, reason_code: "isolated_terminal_snapshot_payload_pass" }
    : await syncTerminalBriefingSnapshot(tradeDate, runId);
  terminalBriefingSnapshot.report_run_id = runId;
  terminalBriefingSnapshot.delivery_content_hash = deliveryContentHash;
  final.terminal_briefing_snapshot = terminalBriefingSnapshot;
  final.complete = final.ok === true && final.expected_industry_count === 15 && final.scanned_industry_count === final.expected_industry_count && final.mother_pool_bridge_ok === true && final.line_push_ok === true && terminalBriefingSnapshot.ok === true && displayTop3.length === 3;
  final.status = final.complete ? "complete" : "fail_closed";
  final.report_status = final.complete ? "COMPLETE" : "FAIL_CLOSED";
  final.exitCode = final.complete ? 0 : 1;
  final.first_blocker = final.complete ? null : (!final.mother_pool_bridge_ok ? "mother_pool_bridge_not_complete" : !final.line_push_ok ? "line_delivery_not_complete" : terminalBriefingSnapshot.ok !== true ? "terminal_snapshot_not_complete" : displayTop3.length !== 3 ? "positive_top3_not_complete" : "opening_report_not_complete");
  writeJson(finalPath, final);
  console.log(JSON.stringify({ ok: final.ok, final_receipt: finalPath, report_path: reportPath, run_id: runId, report_status: final.report_status, terminal_briefing_snapshot_ok: terminalBriefingSnapshot.ok === true }, null, 2));
  if (!final.complete) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, reason_code: "opening_report_0830_runner_error", error: error?.stack || error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});

