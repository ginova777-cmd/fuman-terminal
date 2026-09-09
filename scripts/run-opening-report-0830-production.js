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
const FIELD_ACK_SCRIPT = path.resolve(__dirname, "verify-opening-report-0830-mother-pool-field-ack.js");
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

function frozenLeadersReceipt(tradeDate) {
  const compact = tradeDate.replace(/\D/g, "");
  return readJson(path.join(RECEIPT_DIR, `opening-report-0820-overseas-leaders-${compact}.json`));
}

function baseIndustryItems(tradeDate, runId, leaders = frozenLeadersReceipt(tradeDate)) {
  // 08:30 consumes frozen 08:20 evidence only. It never refetches or
  // recalculates overseas prices after the evidence cutoff.
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
      mapping_contract: mapRow.mapping_contract,
      mapping_reviewed_at: mapRow.mapping_reviewed_at,
      mapping_evidence_authorities: mapRow.mapping_evidence_authorities,
      overseas_return_1d_pct: Number.isFinite(average) ? average : null,
      overseas_leader_detection: row,
      mapped_symbols_a: mapRow.a,
      mapped_symbols_b: mapRow.b,
      mapped_symbols_c: mapRow.c,
      mapped_symbols: [...mapRow.a, ...mapRow.b, ...mapRow.c],
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
    mapping_contract: item.mapping_contract,
    mapping_reviewed_at: item.mapping_reviewed_at,
    mapping_evidence_authorities: item.mapping_evidence_authorities,
    overseas_return_1d_pct: item.overseas_return_1d_pct,
    positive_return_rank: positiveRank.get(item.industry) || null,
    overseas_leader_detection: item.overseas_leader_detection,
    mapped_symbols_a: item.mapped_symbols_a,
    mapped_symbols_b: item.mapped_symbols_b,
    mapped_symbols_c: item.mapped_symbols_c,
    mapped_symbols: item.mapped_symbols,
    allowed_action: ALLOWED_ACTION,
    forbidden_action: FORBIDDEN_ACTION
  }));
}

function uniqueMappedSymbols(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const symbol = String(row?.symbol || row?.[0] || "");
    if (!symbol || seen.has(symbol)) return false;
    seen.add(symbol);
    return true;
  });
}

function asiaPositiveLeaderObservations(items) {
  const bySymbol = new Map();
  for (const item of items) {
    for (const leader of item.overseas_leader_detection?.leaders || []) {
      const symbol = String(leader?.yahoo_symbol || "");
      if (!/\.(?:T|KS|KQ)$/i.test(symbol) || leader?.ok !== true || !Number.isFinite(Number(leader?.percent)) || Number(leader.percent) <= 0) continue;
      const entry = bySymbol.get(symbol) || {
        observation_type: "asia_positive_leader",
        overseas_name: leader.name || symbol,
        overseas_symbol: symbol,
        market: /\.T$/i.test(symbol) ? "Japan" : "Korea",
        percent: Number(leader.percent),
        source_time: leader.source_time || "",
        source: leader.source || "",
        linked_industries: [],
        mapped_symbols_a: [],
        mapped_symbols_b: [],
        mapped_symbols_c: [],
      };
      if (!entry.linked_industries.some((row) => row.industry === item.industry)) {
        entry.linked_industries.push({ industry: item.industry, display_name: item.display_name });
        entry.mapped_symbols_a.push(...item.mapped_symbols_a);
        entry.mapped_symbols_b.push(...item.mapped_symbols_b);
        entry.mapped_symbols_c.push(...item.mapped_symbols_c);
      }
      bySymbol.set(symbol, entry);
    }
  }
  return [...bySymbol.values()]
    .sort((a, b) => Number(b.percent) - Number(a.percent) || a.overseas_symbol.localeCompare(b.overseas_symbol))
    .slice(0, 3)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      industry: row.linked_industries[0]?.industry || "",
      display_name: row.linked_industries.map((item) => item.display_name).join("／"),
      mapped_symbols_a: uniqueMappedSymbols(row.mapped_symbols_a),
      mapped_symbols_b: uniqueMappedSymbols(row.mapped_symbols_b),
      mapped_symbols_c: uniqueMappedSymbols(row.mapped_symbols_c),
    }));
}

function positiveIndustryObservations(items) {
  return items
    .filter((row) => Number(row.positive_return_rank) >= 1 && Number(row.positive_return_rank) <= 3)
    .sort((a, b) => Number(a.positive_return_rank) - Number(b.positive_return_rank))
    .map((row) => ({
      observation_type: "positive_industry",
      rank: Number(row.positive_return_rank),
      industry: row.industry,
      display_name: row.display_name,
      percent: Number(row.overseas_return_1d_pct),
      linked_industries: [{ industry: row.industry, display_name: row.display_name }],
      mapped_symbols_a: row.mapped_symbols_a,
      mapped_symbols_b: row.mapped_symbols_b,
      mapped_symbols_c: row.mapped_symbols_c,
    }));
}

function buildPriorityObservations(items, usMarket) {
  const usClosed = usMarket?.no_new_us_session === true;
  const observations = usClosed ? asiaPositiveLeaderObservations(items) : positiveIndustryObservations(items);
  return {
    mode: usClosed ? "us_market_closed_asia_positive_leader_top3" : "positive_industry_top3",
    observations,
  };
}

function attachPriorityObservation(items, priority) {
  return items.map((item) => {
    const linked = priority.observations.filter((row) => row.linked_industries.some((industry) => industry.industry === item.industry));
    return {
      ...item,
      priority_observation_basis: priority.mode,
      priority_observation_rank: linked.length ? Math.min(...linked.map((row) => Number(row.rank))) : null,
      priority_overseas_leaders: linked.map((row) => ({
        rank: row.rank,
        name: row.overseas_name || "",
        symbol: row.overseas_symbol || "",
        market: row.market || "",
        percent: Number(row.percent),
        source_time: row.source_time || "",
        source: row.source || "",
      })),
    };
  });
}

async function buildOverseasPreflight(tradeDate, runId, frozenLeaders) {
  const industries = Array.isArray(frozenLeaders?.industries) ? frozenLeaders.industries : [];
  const ok = frozenLeaders?.ok === true && frozenLeaders?.date === tradeDate && industries.length === 15;
  return {
    contract: "opening-report-0830-overseas-preflight-v1",
    ok,
    status: ok ? "PASS" : "FAIL_CLOSED",
    date: tradeDate,
    run_id: runId,
    checked_at: timestamp(),
    mode: "consume_frozen_0820_only",
    source_receipt_run_id: frozenLeaders?.run_id || "",
    source_cutoff: frozenLeaders?.cutoff || "",
    industry_count: industries.length,
    us_market: frozenLeaders?.us_market || null,
    reason_code: ok ? "frozen_0820_overseas_evidence_valid" : "frozen_0820_overseas_evidence_invalid"
  };
}

function markdownReport({ tradeDate, runId, overseasPreflight, priority }) {
  const lines = [];
  lines.push(`# Fuman 台股 08:30 開盤前日報`);
  lines.push("");
  lines.push(`日期：${tradeDate}`);
  lines.push(`run_id：${runId}`);
  lines.push(`資料截點：${tradeDate} 08:20:59 Asia/Taipei`);
  lines.push("");
  lines.push("結論：晨報 15 產業觀察已完成；優先觀察名單已提供 Mother Pool priority_scan。晨報不判定盤中 Gate，也不產生正式候選。");
  lines.push("");
  lines.push(priority.mode === "us_market_closed_asia_positive_leader_top3" ? "## 日韓正漲幅個股優先觀察" : "## 海外正報酬產業優先觀察");
  lines.push("");
  lines.push("| 排名 | 海外觀察 | 產業 | 漲幅 | 台股 A | 台股 B | 台股 C |");
  lines.push("|---:|---|---|---:|---|---|---|");
  for (const row of priority.observations) {
    const overseas = row.observation_type === "asia_positive_leader" ? `${row.overseas_name}（${row.overseas_symbol}）` : row.display_name;
    lines.push(`| ${row.rank} | ${overseas} | ${row.display_name} | +${Number(row.percent).toFixed(2)}% | ${lineStockNames(row.mapped_symbols_a) || "無"} | ${lineStockNames(row.mapped_symbols_b) || "無"} | ${lineStockNames(row.mapped_symbols_c) || "無"} |`);
  }
  if (!priority.observations.length) lines.push("| - | 今日無正漲幅觀察 | - | - | - | - | - |");
  lines.push("");
  lines.push("## Mother Pool 交接邊界");
  lines.push("");
  lines.push("只提高對應台股的掃描優先序；不得建立正式候選、不得略過盤中正式 verifier、不得下單。");
  lines.push("");
  lines.push("## Final");
  lines.push("");
  lines.push("```text");
  lines.push("report_status=REPORT_OBSERVATION_READY");
  lines.push("formal_candidates: 0");
  lines.push("watchlist_only: true");
  lines.push("formal_candidates=0");
  lines.push("watchlist_only=true");
  lines.push("mode=industry_observation_only");
  lines.push(`priority_observation_mode=${priority.mode}`);
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

function runMotherPoolFieldAck(tradeDate, runId, bridgeAggregatePath, isolatedBacktest) {
  const args = isolatedBacktest
    ? [FIELD_ACK_SCRIPT, "--fixture"]
    : [FIELD_ACK_SCRIPT, `--trade-date=${tradeDate}`, `--report-run-id=${runId}`, `--bridge-aggregate=${bridgeAggregatePath}`];
  const result = spawnSync(process.execPath, args, { encoding: "utf8", windowsHide: true, cwd: path.resolve(__dirname, "..") });
  let receipt = null;
  try { receipt = JSON.parse(String(result.stdout || "").trim()); } catch {}
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr, receipt };
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

function usMarketDisplayText(usMarket) {
  if (usMarket?.no_new_us_session) return "美股休市／無新 session｜本次以日韓早盤正漲幅個股觀察";
  if (usMarket?.us_market_status === "early_close") return "美股提早收盤 session｜日韓早盤同步觀察";
  return "美股與日韓早盤同步觀察";
}

function lineObservationTitle(item, medal) {
  if (item.observation_type === "asia_positive_leader") return `${medal} ${item.overseas_name}（${item.overseas_symbol}）｜${item.display_name}`;
  return `${medal} ${item.display_name}`;
}

function lineObservationPercent(item) {
  const label = item.observation_type === "asia_positive_leader" ? "日韓早盤漲幅" : "海外平均漲幅";
  return `${label}：+${Number(item.percent).toFixed(2)}%`;
}

function lineReportText(tradeDate, observations, usMarket) {
  const medals = ["🥇", "🥈", "🥉"];
  const sections = observations.map((item, index) => [
    lineObservationTitle(item, medals[index] || `${item.rank}.`),
    lineObservationPercent(item),
    `台股 A：${lineStockNames(item.mapped_symbols_a) || "無"}`,
    `台股 B：${lineStockNames(item.mapped_symbols_b) || "無"}`,
    `台股 C：${lineStockNames(item.mapped_symbols_c) || "無"}`,
  ].join("\n"));
  return [
    "📈 08:30 漲幅族群晨報",
    `${tradeDate}｜15 個產業掃描完成`,
    usMarketDisplayText(usMarket),
    "",
    sections.length ? sections.join("\n\n") : "今日無正漲幅優先觀察標的",
  ].join("\n");
}

function lineReportFlex(tradeDate, observations, usMarket) {
  const medals = ["🥇", "🥈", "🥉"];
  const body = [];
  observations.forEach((item, index) => {
    body.push({ type: "text", text: lineObservationTitle(item, medals[index] || `${item.rank}.`), weight: "bold", size: "md", wrap: true, margin: index ? "lg" : "none" });
    body.push({ type: "text", text: lineObservationPercent(item), size: "sm", color: "#169B62", wrap: true });
    body.push({ type: "text", text: `台股 A：${lineStockNames(item.mapped_symbols_a) || "無"}`, size: "sm", wrap: true });
    body.push({ type: "text", text: `台股 B：${lineStockNames(item.mapped_symbols_b) || "無"}`, size: "sm", wrap: true });
    body.push({ type: "text", text: `台股 C：${lineStockNames(item.mapped_symbols_c) || "無"}`, size: "sm", wrap: true });
  });
  if (!body.length) body.push({ type: "text", text: "今日無正漲幅優先觀察標的", size: "sm", color: "#777777", wrap: true });
  return {
    type: "bubble",
    header: { type: "box", layout: "vertical", contents: [{ type: "text", text: "📈 08:30 漲幅族群晨報", weight: "bold", wrap: true }, { type: "text", text: `${tradeDate}｜15 個產業掃描完成`, size: "xs", color: "#777777", margin: "sm", wrap: true }, { type: "text", text: usMarketDisplayText(usMarket), size: "xs", color: "#777777", margin: "sm", wrap: true }] },
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
    if (briefing?.ok !== true) {
      return {
        ok: false,
        skipped: true,
        preserve_previous_good: true,
        reason_code: briefing?.reason_code || "opening_report_0830_terminal_briefing_incomplete",
      };
    }
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
      cutoff: `${tradeDate} 08:20:59.999 Asia/Taipei`,
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

  const frozenLeaders = frozenLeadersReceipt(tradeDate);
  const overseasPreflight = await buildOverseasPreflight(tradeDate, runId, frozenLeaders);
  const baseItems = baseIndustryItems(tradeDate, runId, frozenLeaders);
  const usMarket = frozenLeaders?.us_market || {};
  const priority = buildPriorityObservations(baseItems, usMarket);
  const items = attachPriorityObservation(baseItems, priority);
  const displayTop3 = priority.observations;
  const deliveryContentHash = crypto.createHash("sha256").update(JSON.stringify({ mode: priority.mode, observations: displayTop3.map((row) => ({ rank: row.rank, industry: row.industry, overseas_symbol: row.overseas_symbol || null, percent: row.percent })) })).digest("hex");
  const reportPath = path.join(RECEIPT_DIR, `opening-report-0830-${compact}.md`);
  const overseasPath = path.join(RECEIPT_DIR, `overseas-preflight-${compact}.json`);
  const finalPath = path.join(RECEIPT_DIR, `opening-report-0830-final-receipt-${compact}.json`);
  ensureDir(reportPath);
  fs.writeFileSync(reportPath, markdownReport({ tradeDate, runId, overseasPreflight, priority }), "utf8");
  writeJson(overseasPath, overseasPreflight);
  const bridgeResults = [];
  if (applyBridge && !mock) await waitUntilTaipeiMinute(8 * 60 + 35);
  for (const item of items) {
    const inputPath = path.join(STATE_DIR, `opening_report_0830.industry_bias.${item.industry}.json`);
    const receiptPath = path.join(RUNTIME_DIR, "data", "scan-receipts", `opening-report-0830-priority-bias-bridge-${item.industry}-${compact}.json`);
    writeJson(inputPath, item);
    const top3 = Number(item.priority_observation_rank) >= 1 && Number(item.priority_observation_rank) <= 3;
    if (isolatedBacktest && top3) bridgeResults.push({ industry: item.industry, priority_observation_rank: item.priority_observation_rank, priority_observation_basis: item.priority_observation_basis, inputPath, receiptPath, result: { exitCode: 0, simulated: true }, reason_code: "isolated_bridge_contract_pass" });
    else if (applyBridge && top3) bridgeResults.push({ industry: item.industry, priority_observation_rank: item.priority_observation_rank, priority_observation_basis: item.priority_observation_basis, inputPath, receiptPath, result: runBridge(inputPath, receiptPath, tradeDate) });
    else bridgeResults.push({ industry: item.industry, priority_observation_rank: item.priority_observation_rank, priority_observation_basis: item.priority_observation_basis, inputPath, receiptPath, skipped: true, reason_code: top3 ? "bridge_apply_not_requested" : "not_priority_observation_top3_bridge_skip" });
  }
  const lineReceiptPath = path.join(RECEIPT_DIR, `line-push-receipt-${compact}.json`);
  const lineReceipt = isolatedBacktest
    ? { line_push_attempted: false, line_push_ok: true, simulated: true, reason_code: "isolated_line_flex_payload_pass", target_count: 2, delivered_count: 2, has_user_target: true, has_group_target: true, token_logged: false, target_logged: false }
    : reuseLineReceipt
    ? readJson(lineReceiptPath)
    : await pushLine({ cardText: lineReportText(tradeDate, displayTop3, usMarket), flexCard: lineReportFlex(tradeDate, displayTop3, usMarket), runId, dryRun: dryRunLine });
  Object.assign(lineReceipt, {
    ok: lineReceipt?.line_push_ok === true,
    run_id: runId,
    report_run_id: runId,
    delivery_content_hash: deliveryContentHash,
  });
  writeJson(lineReceiptPath, lineReceipt);
  const lineDeliveryOk = lineReceipt?.line_push_ok === true && (!reuseLineReceipt || String(lineReceipt?.report_run_id || lineReceipt?.run_id || "") === runId);
  const eligibleBridgeResults = bridgeResults.filter((row) => Number(row.priority_observation_rank) >= 1 && Number(row.priority_observation_rank) <= 3);
  const successfulBridgeCount = eligibleBridgeResults.filter((row) => row.result?.exitCode === 0).length;
  const bridgeAggregatePath = path.join(RECEIPT_DIR, `opening-report-0830-bridge-aggregate-${compact}.json`);
  const bridgeAggregate = {
    contract: "opening-report-0830-priority-observation-bridge-aggregate-v2",
    status: (applyBridge || isolatedBacktest) && successfulBridgeCount === eligibleBridgeResults.length ? "BRIDGE_OK" : "BRIDGE_FAIL_CLOSED",
    run_id: runId,
    trade_date: tradeDate,
    priority_observation_mode: priority.mode,
    observation_count: displayTop3.length,
    industry_count: eligibleBridgeResults.length,
    successful_industry_count: successfulBridgeCount,
    forbidden_publish_guard: true,
    formal_candidate_count: 0,
    formal_candidate_allowed: false,
    checked_at: timestamp(),
  };
  writeJson(bridgeAggregatePath, bridgeAggregate);
  const motherPoolFieldAckRun = runMotherPoolFieldAck(tradeDate, runId, bridgeAggregatePath, isolatedBacktest);
  const motherPoolFieldAck = motherPoolFieldAckRun.receipt || { ok: false, complete: false, first_blocker: "mother_pool_field_ack_output_invalid" };
  const final = {
    contract: "opening-report-0830-production-v1",
    ok: overseasPreflight.ok && Boolean(reportPath) && lineDeliveryOk,
    report_status: "REPORT_OBSERVATION_READY",
    us_market: usMarket,
    overseas_sources_ok: overseasPreflight.ok,
    industry_bias_exported: true,
    mother_pool_bridge_attempted: applyBridge || isolatedBacktest,
    mother_pool_bridge_ok: (applyBridge || isolatedBacktest) ? eligibleBridgeResults.every((row) => row.result?.exitCode === 0) : null,
    line_push_attempted: sendLine,
    line_push_ok: lineDeliveryOk,
    delivery_content_hash: deliveryContentHash,
    line_receipt_reused: reuseLineReceipt,
    display_contract: "opening_report_priority_observation_top3_v2",
    expected_industry_count: OPENING_REPORT_0830_INDUSTRY_MAP.length,
    scanned_industry_count: items.length,
    bridge_contract: "us_open_positive_industry_or_us_closed_asia_positive_leader_top3_v2",
    bridge_delivery_invariant: "It must never change the 08:30 report delivery decision.",
    priority_observation_mode: priority.mode,
    priority_observations: displayTop3,
    display_top3: displayTop3,
    formal_candidates: 0,
    watchlist_only: true,
    run_id: runId,
    date: tradeDate,
    report_path: reportPath,
    overseas_preflight_receipt: overseasPath,
    line_push_receipt: lineReceiptPath,
    bridge_results: bridgeResults.map((row) => ({ industry: row.industry, priority_observation_rank: row.priority_observation_rank ?? null, priority_observation_basis: row.priority_observation_basis || "", inputPath: row.inputPath, receiptPath: row.receiptPath, skipped: row.skipped === true, exitCode: row.result?.exitCode ?? null, reason_code: row.reason_code || "" })),
    bridge_aggregate_receipt: bridgeAggregatePath,
    mother_pool_field_ack_receipt: motherPoolFieldAck.receipt_path || null,
    mother_pool_field_ack: motherPoolFieldAck,
    mother_pool_field_ack_ok: motherPoolFieldAckRun.exitCode === 0 && motherPoolFieldAck.ok === true,
    checked_at: timestamp()
  };
  writeJson(finalPath, final);
  const terminalBriefingSnapshot = isolatedBacktest
    ? { ok: true, key: "opening_report_0830_terminal_briefing", tradeDate: compact, attempts: 0, simulated: true, reason_code: "isolated_terminal_snapshot_payload_pass" }
    : await syncTerminalBriefingSnapshot(tradeDate, runId);
  terminalBriefingSnapshot.report_run_id = runId;
  terminalBriefingSnapshot.delivery_content_hash = deliveryContentHash;
  final.terminal_briefing_snapshot = terminalBriefingSnapshot;
  const priorityObservationContractOk = displayTop3.length >= 0 && displayTop3.length <= 3 && displayTop3.every((row) => Number(row.percent) > 0 && Number(row.rank) >= 1 && Number(row.rank) <= 3);
  const positiveIndustryRows = positiveIndustryObservations(baseItems);
  final.positive_top3_contract_ok = positiveIndustryRows.length >= 0 && positiveIndustryRows.length <= 3 && positiveIndustryRows.every((row) => Number(row.percent) > 0);
  final.positive_industry_count = positiveIndustryRows.length;
  final.priority_observation_contract_ok = priorityObservationContractOk;
  final.priority_observation_count = displayTop3.length;
  final.complete = final.ok === true && final.expected_industry_count === 15 && final.scanned_industry_count === final.expected_industry_count && final.mother_pool_bridge_ok === true && final.mother_pool_field_ack_ok === true && final.line_push_ok === true && terminalBriefingSnapshot.ok === true && final.positive_top3_contract_ok === true && priorityObservationContractOk;
  final.status = final.complete ? "complete" : "fail_closed";
  final.report_status = final.complete ? "COMPLETE" : "FAIL_CLOSED";
  final.exitCode = final.complete ? 0 : 1;
  final.first_blocker = final.complete ? null : (!final.mother_pool_bridge_ok ? "mother_pool_bridge_not_complete" : !final.mother_pool_field_ack_ok ? (motherPoolFieldAck.first_blocker || "mother_pool_field_ack_not_complete") : !final.line_push_ok ? "line_delivery_not_complete" : terminalBriefingSnapshot.ok !== true ? "terminal_snapshot_not_complete" : !priorityObservationContractOk ? "priority_observation_top3_invalid" : "opening_report_not_complete");
  writeJson(finalPath, final);
  console.log(JSON.stringify({ ok: final.ok, final_receipt: finalPath, report_path: reportPath, run_id: runId, report_status: final.report_status, terminal_briefing_snapshot_ok: terminalBriefingSnapshot.ok === true }, null, 2));
  if (!final.complete) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, reason_code: "opening_report_0830_runner_error", error: error?.stack || error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});

