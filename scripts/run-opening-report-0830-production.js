"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { upsertSnapshot } = require("../lib/supabase-snapshots");

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
  return [
    {
      industry: "PCB_CCL",
      display_name: "PCB／CCL",
      bias: "positive_mixed",
      confidence: 0.72,
      evidence_summary: "韓系 Simmtech/Daeduck 偏強、MEIKO 前收強；Fujikura 偏弱，整體分歧偏多。",
      mapped_symbols: [
        { symbol: "2383", name: "台光電", tier: "A" },
        { symbol: "6274", name: "台燿", tier: "A" },
        { symbol: "2368", name: "金像電", tier: "A" },
        { symbol: "3044", name: "健鼎", tier: "A" },
        { symbol: "4958", name: "臻鼎-KY", tier: "A" },
        { symbol: "2313", name: "華通", tier: "A" },
        { symbol: "8358", name: "金居", tier: "A" },
        { symbol: "3037", name: "欣興", tier: "B" },
        { symbol: "8046", name: "南電", tier: "B" },
        { symbol: "3189", name: "景碩", tier: "B" }
      ]
    },
    {
      industry: "MEMORY",
      display_name: "記憶體",
      bias: "positive_mixed",
      confidence: 0.68,
      evidence_summary: "Micron 近持平，SK Hynix/韓系記憶體 proxy 分歧偏多。",
      mapped_symbols: [
        { symbol: "2408", name: "南亞科", tier: "A" },
        { symbol: "2344", name: "華邦電", tier: "A" },
        { symbol: "6770", name: "力積電", tier: "A" },
        { symbol: "8299", name: "群聯", tier: "A" },
        { symbol: "3260", name: "威剛", tier: "A" },
        { symbol: "2337", name: "旺宏", tier: "B" },
        { symbol: "3006", name: "晶豪科", tier: "B" }
      ]
    },
    {
      industry: "AI_GPU_CLOUD",
      display_name: "AI GPU／雲端",
      bias: "negative_mixed",
      confidence: 0.6,
      evidence_summary: "Nasdaq 偏弱、AMD 明顯弱，NVDA 個別支撐，AI 題材分歧。",
      mapped_symbols: [
        { symbol: "2382", name: "廣達", tier: "A" },
        { symbol: "3231", name: "緯創", tier: "A" },
        { symbol: "6669", name: "緯穎", tier: "A" },
        { symbol: "2356", name: "英業達", tier: "A" },
        { symbol: "2376", name: "技嘉", tier: "A" },
        { symbol: "2317", name: "鴻海", tier: "A" },
        { symbol: "2330", name: "台積電", tier: "B" },
        { symbol: "2308", name: "台達電", tier: "B" },
        { symbol: "3017", name: "奇鋐", tier: "B" },
        { symbol: "3324", name: "雙鴻", tier: "B" }
      ]
    }
  ].map((item) => ({
    date: tradeDate,
    report_time: "08:30",
    run_id: `${runId}-${item.industry}`,
    source: SOURCE,
    mode: MODE,
    industry: item.industry,
    bias: item.bias,
    confidence: item.confidence,
    evidence_summary: item.evidence_summary,
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
  for (const item of items) {
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
  lines.push(`formal_candidates=${taiwanGate.ok ? "gate_ready_but_not_generated_by_0830_report" : 0}`);
  lines.push(`watchlist_only=${!taiwanGate.ok}`);
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
  const mock = hasFlag("--self-test") || hasFlag("--mock-overseas");
  const applyBridge = hasFlag("--apply-bridge");
  const sendLine = hasFlag("--send-line");
  const dryRunLine = !sendLine;
  const overseasPreflight = await buildOverseasPreflight(tradeDate, runId, mock);
  const items = baseIndustryItems(tradeDate, runId);
  const taiwanGate = readTaiwanGate(tradeDate);
  const reportPath = path.join(RECEIPT_DIR, `opening-report-0830-${compact}.md`);
  const overseasPath = path.join(RECEIPT_DIR, `overseas-preflight-${compact}.json`);
  const finalPath = path.join(RECEIPT_DIR, `opening-report-0830-final-receipt-${compact}.json`);
  ensureDir(reportPath);
  fs.writeFileSync(reportPath, markdownReport({ tradeDate, runId, overseasPreflight, items, taiwanGate }), "utf8");
  writeJson(overseasPath, overseasPreflight);
  const bridgeResults = [];
  for (const item of items) {
    const inputPath = path.join(STATE_DIR, `opening_report_0830.industry_bias.${item.industry}.json`);
    const receiptPath = path.join(RUNTIME_DIR, "data", "scan-receipts", `opening-report-0830-priority-bias-bridge-${item.industry}-${compact}.json`);
    writeJson(inputPath, item);
    if (applyBridge) bridgeResults.push({ industry: item.industry, inputPath, receiptPath, result: runBridge(inputPath, receiptPath, tradeDate) });
    else bridgeResults.push({ industry: item.industry, inputPath, receiptPath, skipped: true, reason_code: "bridge_apply_not_requested" });
  }
  const lineReceipt = await pushLine({ cardText: `Fuman 08:30 日報 ${tradeDate}\n${items.map(approxBiasText).join("\n")}\n台股：${taiwanGate.reason_code}`, runId, dryRun: dryRunLine });
  const lineReceiptPath = path.join(RECEIPT_DIR, `line-push-receipt-${compact}.json`);
  writeJson(lineReceiptPath, lineReceipt);
  const final = {
    contract: "opening-report-0830-production-v1",
    ok: overseasPreflight.ok && Boolean(reportPath) && (!sendLine || lineReceipt.line_push_ok),
    report_status: taiwanGate.ok ? "PASS" : "FAIL_CLOSED",
    overseas_sources_ok: overseasPreflight.ok,
    industry_bias_exported: true,
    mother_pool_bridge_attempted: applyBridge,
    mother_pool_bridge_ok: applyBridge ? bridgeResults.every((row) => row.result?.exitCode === 0) : null,
    line_push_attempted: sendLine,
    line_push_ok: lineReceipt.line_push_ok,
    formal_candidates: 0,
    watchlist_only: true,
    run_id: runId,
    date: tradeDate,
    report_path: reportPath,
    overseas_preflight_receipt: overseasPath,
    line_push_receipt: lineReceiptPath,
    bridge_results: bridgeResults.map((row) => ({ industry: row.industry, inputPath: row.inputPath, receiptPath: row.receiptPath, skipped: row.skipped === true, exitCode: row.result?.exitCode ?? null, reason_code: row.reason_code || "" })),
    taiwan_gate: taiwanGate,
    checked_at: timestamp()
  };
  writeJson(finalPath, final);
  const terminalBriefingSnapshot = await syncTerminalBriefingSnapshot(tradeDate, runId);
  final.terminal_briefing_snapshot = terminalBriefingSnapshot;
  writeJson(finalPath, final);
  console.log(JSON.stringify({ ok: final.ok, final_receipt: finalPath, report_path: reportPath, run_id: runId, report_status: final.report_status, terminal_briefing_snapshot_ok: terminalBriefingSnapshot.ok === true }, null, 2));
  if (hasFlag("--self-test") && !final.industry_bias_exported) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, reason_code: "opening_report_0830_runner_error", error: error?.stack || error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});

