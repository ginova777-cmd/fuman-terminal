"use strict";

const fs = require("fs");
const path = require("path");

const CONTRACT = "opening_limit_order_watchlist_builder_v1";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATE_DIR = path.join(RUNTIME_DIR, "state");
const INTRADAY_CACHE_DIR = path.join(RUNTIME_DIR, "cache", "intraday");
const OPENING_BIAS_PATTERN = /^opening_report_0830\.industry_bias\..+\.json$/;
const REASON_OPENING_REPORT = "opening_report_0830_industry_bias";
const REASON_MANUAL = "manual_symbol";
const REASON_USER_FILE = "opening_limit_order_user_watchlist";
const LEGACY_TOP40_KEYS = new Set([
  "priority_top40",
  "formal_priority_top40",
  "formalPrioritySymbols",
  "formalPriorityMatchedSymbols",
  "daytradeFormalPrioritySymbols",
]);
const DISABLED_SOURCE_KEYS = new Set(["warrant", "cb"]);

const PRIORITY_CACHE_FILES = [
  path.join(INTRADAY_CACHE_DIR, "fugle-daytrade-ws-priority-symbols.json"),
  path.join(INTRADAY_CACHE_DIR, "fugle-strategy-chip-priority-bridge.json"),
];

const OPTIONAL_USER_FILES = [
  path.join(STATE_DIR, "opening_limit_order_user_watchlist.json"),
  path.join(STATE_DIR, "daytrade_user_case_symbols.json"),
];

const PRIORITY_KEYS = [
  "openingReport0830PrewarmSymbols",
  "openingReport0830QuoteRefreshSymbols",
  "openingPrioritySymbols",
  "daytradeCandlePrioritySymbols",
  "userCaseSymbols",
  "userCaseCandlePrioritySymbols",
  "daytradeHotPoolSymbols",
  "daytradePriorityExtensionSymbols",
  "daytradePrioritySymbols",
  "daytradeMotherPoolSymbols",
  "terminalPrioritySymbols",
  "strategy2",
  "strategy3",
  "strategy4",
  "strategy5",
  "institution",
];

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item === `--${name}` || item.startsWith(prefix));
  if (!found) return fallback;
  return found === `--${name}` ? "1" : found.slice(prefix.length);
}

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function dashDate(value) {
  const compact = compactDate(value);
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : "";
}

function normalizeSymbol(value) {
  const symbol = String(value ?? "").trim();
  return /^\d{4,6}$/.test(symbol) ? symbol : "";
}

function parseSymbols(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeSymbol(typeof item === "object" && item ? item.symbol : item))
      .filter(Boolean);
  }
  if (value && typeof value === "object") {
    return parseSymbols(value.symbols || value.mapped_symbols || value.userCaseSymbols || value.cases || value.symbol);
  }
  return String(value || "")
    .split(/[,\s]+/)
    .map(normalizeSymbol)
    .filter(Boolean);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function addReason(reasonBySymbol, symbol, reason) {
  if (!symbol || !reason) return;
  if (!reasonBySymbol[symbol]) reasonBySymbol[symbol] = [];
  if (!reasonBySymbol[symbol].includes(reason)) reasonBySymbol[symbol].push(reason);
}

function addReject(rejected, symbol, reason, source = "", evidence = {}) {
  rejected.push({ symbol: symbol || null, reason, source, evidence });
}

function parsedIndustryPayload(raw) {
  if (raw?.opening_report_0830?.industry_bias_json) return raw.opening_report_0830.industry_bias_json;
  if (raw?.industry_bias_json && typeof raw.industry_bias_json === "object") return raw.industry_bias_json;
  return raw && typeof raw === "object" ? raw : null;
}

function validateIndustryBias(payload, tradeDate) {
  const failures = [];
  if (!payload) failures.push("industry_bias_json_missing_or_invalid");
  const expectedCompact = compactDate(tradeDate);
  const payloadDate = compactDate(payload?.trade_date || payload?.date);
  if (payloadDate !== expectedCompact) failures.push("industry_bias_json_date_mismatch");
  if (!/^08:30(?:$|[:+T\s])/.test(String(payload?.report_time || ""))) failures.push("report_time_not_0830");
  if (payload?.source !== "opening_report_0830") failures.push("source_mismatch");
  if (payload?.mode !== "priority_bias_only") failures.push("mode_mismatch");
  if (!payload?.run_id) failures.push("run_id_missing");
  if (!String(payload?.industry || "").trim()) failures.push("industry_missing");
  if (!String(payload?.bias || "").trim()) failures.push("bias_missing");
  if (!String(payload?.evidence_summary || "").trim()) failures.push("evidence_summary_missing");
  if (payload?.overseas_strength_contract !== "opening_report_0830_overseas_strength_v1") failures.push("overseas_strength_contract_missing_or_invalid");
  if (!String(payload?.overseas_evidence_cutoff || "").includes("08:20:00 Asia/Taipei")) failures.push("overseas_evidence_cutoff_invalid");
  if (![true, false, null].includes(payload?.overseas_sector_up_1d)) failures.push("overseas_sector_up_1d_invalid");
  if (![true, false, null].includes(payload?.overseas_sector_up_2d)) failures.push("overseas_sector_up_2d_invalid");
  if (![true, false, null].includes(payload?.us_sector_up_1d)) failures.push("us_sector_up_1d_invalid");
  if (![true, false, null].includes(payload?.us_sector_up_2d)) failures.push("us_sector_up_2d_invalid");
  if (!Array.isArray(payload?.mapped_symbols) || payload.mapped_symbols.length === 0) failures.push("mapped_symbols_missing");
  const confidence = Number(payload?.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) failures.push("confidence_invalid");
  if (payload?.allowed_action !== "boost_scan_priority_only") failures.push("allowed_action_mismatch");
  if (payload?.forbidden_action !== "publish_formal_candidate_without_taiwan_evidence") failures.push("forbidden_action_mismatch");
  return { ok: failures.length === 0, failures, payloadDate };
}

function readOpeningReportSymbols(tradeDate, reasonBySymbol, rejected) {
  const out = {
    files_seen: 0,
    files_accepted: 0,
    files_rejected: 0,
    run_ids: [],
    industries: [],
    symbols: [],
    industry_context_by_symbol: {},
    first_blocker: null,
  };
  let files = [];
  try {
    files = fs.readdirSync(STATE_DIR)
      .filter((name) => OPENING_BIAS_PATTERN.test(name))
      .map((name) => path.join(STATE_DIR, name))
      .sort();
  } catch {
    out.first_blocker = "opening_report_state_dir_unreadable";
    return out;
  }
  out.files_seen = files.length;
  for (const file of files) {
    const payload = parsedIndustryPayload(readJson(file));
    const validation = validateIndustryBias(payload, tradeDate);
    if (!validation.ok) {
      out.files_rejected += 1;
      addReject(rejected, null, validation.failures[0], "opening_report_0830", { file, failures: validation.failures });
      if (!out.first_blocker) out.first_blocker = validation.failures[0];
      continue;
    }
    out.files_accepted += 1;
    if (!out.run_ids.includes(payload.run_id)) out.run_ids.push(payload.run_id);
    out.industries.push(payload.industry);
    for (const symbol of parseSymbols(payload.mapped_symbols)) {
      out.symbols.push(symbol);
      addReason(reasonBySymbol, symbol, REASON_OPENING_REPORT);
      addReason(reasonBySymbol, symbol, `opening_report_industry:${payload.industry}`);
      const context = out.industry_context_by_symbol[symbol] || {
        industries: [],
        run_ids: [],
        overseas_sector_up_1d: false,
        overseas_sector_up_2d: false,
        us_sector_up_1d: false,
        us_sector_up_2d: false,
        overseas_return_1d_pct: [],
        overseas_return_2d_pct: [],
        us_return_1d_pct: [],
        us_return_2d_pct: [],
      };
      if (!context.industries.includes(payload.industry)) context.industries.push(payload.industry);
      if (!context.run_ids.includes(payload.run_id)) context.run_ids.push(payload.run_id);
      context.overseas_sector_up_1d ||= payload.overseas_sector_up_1d === true;
      context.overseas_sector_up_2d ||= payload.overseas_sector_up_2d === true;
      context.us_sector_up_1d ||= payload.us_sector_up_1d === true;
      context.us_sector_up_2d ||= payload.us_sector_up_2d === true;
      for (const field of ["overseas_return_1d_pct", "overseas_return_2d_pct", "us_return_1d_pct", "us_return_2d_pct"]) {
        const value = Number(payload[field]);
        if (Number.isFinite(value)) context[field].push(value);
      }
      out.industry_context_by_symbol[symbol] = context;
    }
  }
  return out;
}

function objectDate(value) {
  if (!value || typeof value !== "object") return "";
  return dashDate(value.tradeDate || value.trade_date || value.scanDate || value.scan_date || value.date);
}

function addSymbolsFromValue(value, context, tradeDate, reasonBySymbol, rejected, out) {
  const symbols = parseSymbols(value);
  for (const symbol of symbols) {
    if (!symbol) continue;
    out.symbols.push(symbol);
    addReason(reasonBySymbol, symbol, context.reason);
  }
}

function collectPriorityCacheObject(node, context, tradeDate, reasonBySymbol, rejected, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    addSymbolsFromValue(node, context, tradeDate, reasonBySymbol, rejected, out);
    return;
  }

  const localDate = objectDate(node);
  const effectiveDate = localDate || context.tradeDate || "";
  if (effectiveDate && dashDate(effectiveDate) !== dashDate(tradeDate)) {
    const symbols = parseSymbols(node.symbols || node.daytradePrioritySymbols || node.daytradeHotPoolSymbols);
    for (const symbol of symbols) {
      addReject(rejected, symbol, "stale_cache_rejected", context.source, {
        key_path: context.keyPath,
        cache_trade_date: effectiveDate,
        expected_trade_date: tradeDate,
      });
    }
    return;
  }

  if (Array.isArray(node.symbols) && context.keyPath) {
    addSymbolsFromValue(node.symbols, context, tradeDate, reasonBySymbol, rejected, out);
  }

  for (const [key, value] of Object.entries(node)) {
    const nextPath = context.keyPath ? `${context.keyPath}.${key}` : key;
    if (key === "symbols" && Array.isArray(value)) continue;
    if (LEGACY_TOP40_KEYS.has(key)) {
      const symbols = parseSymbols(value);
      for (const symbol of symbols) {
        addReject(rejected, symbol, "legacy_top40_source_ignored", context.source, { key_path: nextPath });
      }
      continue;
    }
    if (DISABLED_SOURCE_KEYS.has(key)) {
      const symbols = parseSymbols(value);
      for (const symbol of symbols) {
        addReject(rejected, symbol, "disabled_source_ignored", context.source, { key_path: nextPath });
      }
      continue;
    }
    const allowKey = PRIORITY_KEYS.includes(key) || /Symbols$/.test(key) || /^strategy\d+$/.test(key);
    if (Array.isArray(value) && allowKey) {
      addSymbolsFromValue(value, { ...context, reason: `priority_cache:${key}`, keyPath: nextPath }, tradeDate, reasonBySymbol, rejected, out);
    } else if (value && typeof value === "object") {
      collectPriorityCacheObject(value, { ...context, reason: `priority_cache:${key}`, keyPath: nextPath, tradeDate: effectiveDate }, tradeDate, reasonBySymbol, rejected, out);
    }
  }
}

function readPriorityCacheSymbols(tradeDate, reasonBySymbol, rejected) {
  const out = { files_seen: 0, files_read: 0, symbols: [], files: [] };
  for (const file of PRIORITY_CACHE_FILES) {
    out.files_seen += 1;
    const payload = readJson(file);
    if (!payload) {
      addReject(rejected, null, "priority_cache_missing_or_unreadable", "priority_cache", { file });
      continue;
    }
    out.files_read += 1;
    out.files.push(file);
    collectPriorityCacheObject(payload, {
      source: file,
      reason: `priority_cache:${path.basename(file)}`,
      keyPath: "",
      tradeDate: objectDate(payload),
    }, tradeDate, reasonBySymbol, rejected, out);
  }
  return out;
}

function readOptionalUserSymbols(tradeDate, reasonBySymbol, rejected) {
  const out = { files_seen: OPTIONAL_USER_FILES.length, files_read: 0, symbols: [] };
  for (const file of OPTIONAL_USER_FILES) {
    const payload = readJson(file);
    if (!payload) continue;
    const payloadDate = objectDate(payload);
    if (payloadDate && dashDate(payloadDate) !== dashDate(tradeDate)) {
      for (const symbol of parseSymbols(payload.symbols || payload.userCaseSymbols || payload.cases)) {
        addReject(rejected, symbol, "stale_cache_rejected", REASON_USER_FILE, {
          file,
          cache_trade_date: payloadDate,
          expected_trade_date: tradeDate,
        });
      }
      continue;
    }
    out.files_read += 1;
    for (const symbol of parseSymbols(payload.symbols || payload.userCaseSymbols || payload.cases || payload)) {
      out.symbols.push(symbol);
      addReason(reasonBySymbol, symbol, REASON_USER_FILE);
    }
  }
  return out;
}

function buildReceipt() {
  const tradeDate = dashDate(arg("trade-date", taipeiDate()));
  const limit = Math.max(0, Number(arg("limit", process.env.OPENING_LIMIT_ORDER_WATCHLIST_LIMIT || "160")) || 0);
  const manualSymbols = parseSymbols(arg("symbols", ""));
  const reasonBySymbol = {};
  const rejectedSymbols = [];

  const openingReport = readOpeningReportSymbols(tradeDate, reasonBySymbol, rejectedSymbols);
  const priorityCache = readPriorityCacheSymbols(tradeDate, reasonBySymbol, rejectedSymbols);
  const userFiles = readOptionalUserSymbols(tradeDate, reasonBySymbol, rejectedSymbols);

  for (const symbol of manualSymbols) addReason(reasonBySymbol, symbol, REASON_MANUAL);

  let symbols = [
    ...openingReport.symbols,
    ...priorityCache.symbols,
    ...userFiles.symbols,
    ...manualSymbols,
  ].map(normalizeSymbol).filter(Boolean);
  symbols = [...new Set(symbols)];
  symbols.sort((a, b) => {
    const ar = reasonBySymbol[a] || [];
    const br = reasonBySymbol[b] || [];
    const aOpening = ar.includes(REASON_OPENING_REPORT) ? 0 : 1;
    const bOpening = br.includes(REASON_OPENING_REPORT) ? 0 : 1;
    if (aOpening !== bOpening) return aOpening - bOpening;
    return a.localeCompare(b);
  });
  const fullSymbolCount = symbols.length;
  if (limit > 0) symbols = symbols.slice(0, limit);

  const receipt = {
    ok: symbols.length > 0,
    contract: CONTRACT,
    trade_date: tradeDate,
    checked_at: new Date().toISOString(),
    symbol_count: symbols.length,
    full_symbol_count: fullSymbolCount,
    symbols,
    reason_by_symbol: Object.fromEntries(symbols.map((symbol) => [symbol, reasonBySymbol[symbol] || []])),
    sources: {
      opening_report: openingReport,
      priority_cache: priorityCache,
      user_files: userFiles,
      manual_symbols: manualSymbols,
    },
    rejected_symbols: rejectedSymbols,
    action_guard: {
      creates_order: false,
      creates_formal_candidate: false,
      publish_allowed: false,
      requires_second_confirm_before_action: true,
    },
    formal_candidate_count: 0,
    formal_candidate_allowed: false,
    first_blocker: symbols.length ? null : (openingReport.first_blocker || rejectedSymbols[0]?.reason || "opening_limit_order_watchlist_empty"),
    reason_code: symbols.length ? "opening_limit_order_watchlist_built" : "opening_limit_order_watchlist_empty",
    next_command: symbols.length
      ? "node C:\\\\fuman-terminal\\\\scripts\\\\verify-opening-limit-order-candidate-readonly.js --trade-date=" + tradeDate + " --symbols=" + symbols.join(",")
      : "",
  };
  return receipt;
}

function main() {
  const receipt = buildReceipt();
  const out = arg("out", path.join(STATE_DIR, `opening-limit-order-watchlist-${compactDate(receipt.trade_date)}.json`));
  const dryRun = arg("dry-run", "") === "1";
  if (!dryRun) {
    writeJson(out, receipt);
    writeJson(path.join(STATE_DIR, "opening-limit-order-watchlist-latest.json"), receipt);
    receipt.output_path = out;
    receipt.latest_path = path.join(STATE_DIR, "opening-limit-order-watchlist-latest.json");
  }
  if (arg("summary", "") === "1") {
    console.log(JSON.stringify({
      ok: receipt.ok,
      contract: receipt.contract,
      trade_date: receipt.trade_date,
      symbol_count: receipt.symbol_count,
      full_symbol_count: receipt.full_symbol_count,
      first_40_symbols: receipt.symbols.slice(0, 40),
      opening_report_files_accepted: receipt.sources.opening_report.files_accepted,
      opening_report_run_ids: receipt.sources.opening_report.run_ids,
      rejected_count: receipt.rejected_symbols.length,
      formal_candidate_count: receipt.formal_candidate_count,
      formal_candidate_allowed: receipt.formal_candidate_allowed,
      action_guard: receipt.action_guard,
      first_blocker: receipt.first_blocker,
      reason_code: receipt.reason_code,
      output_path: receipt.output_path,
      latest_path: receipt.latest_path,
      next_command: receipt.next_command,
    }, null, 2));
  } else {
    console.log(JSON.stringify(receipt, null, 2));
  }
  process.exitCode = receipt.ok ? 0 : 1;
}

main();






