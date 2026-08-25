"use strict";

/*
 * 08:50 warms static, completed-day evidence. 08:55 only adds natural
 * 08:45-08:55 futures/trial evidence. Neither phase can create an order.
 */
const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const FINMIND_URL = "https://api.finmindtrade.com/api/v4/data";
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const CONTRACT = "opening_limit_order_candidate_gate_v1";
const STATIC_CACHE_CONTRACT = "opening_limit_order_0850_static_sources_v1";
const REQUIRED_PREOPEN_SLOTS = ["0845", "0850"];
const CACHE_DIR = path.join(RUNTIME_DIR, "data", "opening-limit-order");
const READ_TIMEOUT_MS = Math.max(3000, Number(process.env.DAYTRADE_SUPABASE_READ_TIMEOUT_MS || 10000));
const STATIC_CONCURRENCY = Math.min(12, Math.max(2, Number(process.env.OPENING_LIMIT_ORDER_STATIC_CONCURRENCY || 8)));
const FUTOPT_NEAR_PREV_CLOSE_PCT = 1.0;
const TRIAL_LIMIT_DOWN_PCT = -9.5;
const FUTOPT_STRONG_CHANGE_PCT = 2.0;
const FUTOPT_RELATIVE_TO_TXF_PCT = 1.0;
const FUTOPT_MIN_VOLUME = 50;
const FLAT_BASIS_ABS_PCT = 0.1;
const OPENING_REPORT_SCORE_CAP = 55;
const OPENING_REPORT_SCORE_TIERS = Object.freeze([
  { maxRank: 1, score: 55 },
  { maxRank: 2, score: 48 },
  { maxRank: 3, score: 42 },
  { maxRank: 4, score: 36 },
  { maxRank: 8, score: 28 },
  { maxRank: Infinity, score: 18 },
]);
const FUTURES_SCORE_CAP = 30;
const INDUSTRY_FUTURES_COMBO_SCORE = 20;

const RULE_DEFINITIONS = {
  limit_down_reopened_main_force_cost_high: { no: 1, label: "昨日跌停打開 + 主力成本高" },
  low_rebound_two_day_up_institution_buy: { no: 2, label: "低點反彈 + 連漲 2 日 + 法人同買" },
  ma60_support_us_sector_strong: { no: 3, label: "日 K 回測 MA60 有撐 + 海外族群漲" },
  ma240_breakout_us_sector_strong: { no: 4, label: "日 K 突破 MA240 + 海外族群漲" },
  futopt_near_prev_close_trial_limit_down_us_sector: { no: 5, label: "股期接近平盤轉強 + 試撮跌停 + 海外族群漲" },
  futopt_basis_or_inverse_convergence: { no: 6, label: "股期正價差 / 逆收斂" },
  two_day_us_sector_strong_mapped_tw: { no: 7, label: "海外族群連 2 日轉強 + 台股對應" },
  w_neckline_two_day_hold_overnight_trader_branches: { no: 8, label: "W 底頸線站穩 2 日 + 隔日沖分點" },
  us_sector_key_level_hold_two_days: { no: 9, label: "海外族群漲 + 關鍵價位守 2 日" },
  previous_limit_up_futopt_positive_basis: { no: 10, label: "昨日漲停 + 股期正價差" },
};
function ruleInfo(rule) { return RULE_DEFINITIONS[rule] || { no: null, label: rule }; }
function ruleDisplay(rule) { const info = ruleInfo(rule); return { strategy_no: info.no, rule, label: info.label, display: info.no ? `策略${info.no}：${info.label}` : info.label }; }
function ruleDisplays(rules) { return (rules || []).map(ruleDisplay); }
function ruleNos(rules) { return ruleDisplays(rules).map((item) => item.strategy_no).filter(Number.isFinite); }
const RULES = [
  "limit_down_reopened_main_force_cost_high",
  "low_rebound_two_day_up_institution_buy",
  "ma60_support_us_sector_strong",
  "ma240_breakout_us_sector_strong",
  "futopt_near_prev_close_trial_limit_down_us_sector",
  "futopt_basis_or_inverse_convergence",
  "two_day_us_sector_strong_mapped_tw",
  "w_neckline_two_day_hold_overnight_trader_branches",
  "us_sector_key_level_hold_two_days",
  "previous_limit_up_futopt_positive_basis",
];

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}
function n(value, fallback = NaN) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function round(value, digits = 4) { return Number.isFinite(value) ? Number(value.toFixed(digits)) : null; }
function unique(values) { return [...new Set((values || []).filter(Boolean).map(String))]; }
function maxFinite(values) { const finite = (values || []).map((value) => n(value)).filter(Number.isFinite); return finite.length ? Math.max(...finite) : null; }
function sectorTrendLabel(us1, us2) { if (us1 && us2) return "us_up_1d_and_2d"; if (us1) return "us_up_1d_only"; if (us2) return "us_up_2d_only"; return "us_not_strong"; }
function openingReportSectorPositive(report) {
  const biases = Array.isArray(report?.biases) ? report.biases : [];
  return report?.strong_sector_return_1d === true || biases.includes("positive_detected");
}
function openingReportScoreForRank(rank) {
  if (!Number.isFinite(rank) || rank <= 0) return 0;
  const tier = OPENING_REPORT_SCORE_TIERS.find((item) => rank <= item.maxRank);
  return Math.min(OPENING_REPORT_SCORE_CAP, tier ? tier.score : 0);
}
function openingReportRankBoost(report) {
  if (!report?.priority_observation) return 0;
  if (!openingReportSectorPositive(report)) return 0;
  const ranks = (report.opening_report_score_ranks || report.positive_return_ranks || []).map((value) => n(value)).filter(Number.isFinite);
  const bestRank = ranks.length ? Math.min(...ranks) : NaN;
  return openingReportScoreForRank(bestRank);
}
function futuresScore(preopen) {
  if (!preopen) return 0;
  let score = 0;
  if (preopen.positive_basis === true) score += 10;
  if (preopen.trial_match_ready === true) score += 6;
  if (preopen.inverse_convergence === true) score += 10;
  if (preopen.futopt_near_prev_close_and_up === true) score += 6;
  if (preopen.futopt_strength) score += 8;
  return Math.min(FUTURES_SCORE_CAP, score);
}
function industryFuturesComboScore(report, preopen) {
  const sectorStrong = openingReportSectorPositive(report);
  const futuresStrong = preopen?.positive_basis === true || preopen?.trial_match_ready === true || preopen?.inverse_convergence === true || preopen?.futopt_near_prev_close_and_up === true || Boolean(preopen?.futopt_strength);
  return sectorStrong && futuresStrong ? INDUSTRY_FUTURES_COMBO_SCORE : 0;
}function compactDate(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function dashDate(value) { const c = compactDate(value); return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}` : ""; }
function addDays(dateText, days) { const date = new Date(`${dateText}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function parseSymbols(value) { return unique(String(value || "").split(/[,\s]+/).map((item) => item.trim().match(/^\d{4,6}$/)?.[0] || "")); }
function taipeiDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function cachePath(tradeDate) { return path.join(CACHE_DIR, `opening-limit-order-0850-static-sources-${compactDate(tradeDate)}.json`); }
function readText(file) { try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; } }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function writeJson(file, payload) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8"); }
function finmindToken() { return process.env.FINMIND_TOKEN || process.env.FIN_MIND_TOKEN || readText(path.join(RUNTIME_DIR, "secrets", "finmind-token.txt")); }
function supabaseKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.FUMAN_SUPABASE_ANON_KEY || readText(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt")) || readText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt")); }

async function finmind(dataset, params, token) {
  const url = new URL(FINMIND_URL);
  url.searchParams.set("dataset", dataset);
  for (const [key, value] of Object.entries(params || {})) if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  const body = await response.text();
  let json = null; try { json = body ? JSON.parse(body) : null; } catch {}
  if (!response.ok || json?.status !== 200) throw new Error(`${dataset}_HTTP_${response.status}:${json?.msg || body.slice(0, 180)}`);
  return Array.isArray(json?.data) ? json.data : [];
}

async function supabaseSelect(view, params, key) {
  if (!key) throw new Error("missing_supabase_read_key");
  const query = new URLSearchParams(params);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${view}?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
  const body = await response.text();
  if (!response.ok) throw new Error(`${view}_HTTP_${response.status}:${body.slice(0, 180)}`);
  const rows = body ? JSON.parse(body) : [];
  return Array.isArray(rows) ? rows : [];
}

function priceRowsByDate(rows) { return [...(rows || [])].sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))); }
function lastCompletedSignalDate(priceRows, tradeDate) { return [...priceRowsByDate(priceRows)].reverse().find((row) => String(row.date || "") < tradeDate)?.date || ""; }
function ma(rows, index, length) { if (index < length - 1) return NaN; const part = rows.slice(index - length + 1, index + 1); return part.length === length ? part.reduce((sum, row) => sum + n(row.close, 0), 0) / length : NaN; }
function limitDownReopened(today, prev) { const base = n(prev?.close); const low = n(today?.min); const close = n(today?.close); return Number.isFinite(base) && Number.isFinite(low) && Number.isFinite(close) && low <= base * 0.9 * 1.012 && close > base * 0.9 * 1.025; }
function limitUpClosed(today, prev) { return Number.isFinite(n(today?.close)) && Number.isFinite(n(prev?.close)) && n(today.close) >= n(prev.close) * 1.095; }
function twoDayUp(rows, idx) { return idx >= 2 && n(rows[idx].close) > n(rows[idx - 1].close) && n(rows[idx - 1].close) > n(rows[idx - 2].close); }
function reboundFromLow(rows, idx) { const section = rows.slice(Math.max(0, idx - 5), idx + 1); const low = Math.min(...section.map((row) => n(row.min)).filter(Number.isFinite)); return Number.isFinite(low) && n(rows[idx].close) >= low * 1.06; }
function supportedByMa(today, value) { return Number.isFinite(value) && n(today?.min) <= value * 1.02 && n(today?.close) >= value; }
function brokeAboveMa(today, prev, value, priorValue) { return Number.isFinite(value) && Number.isFinite(priorValue) && n(today?.close) > value && n(prev?.close) <= priorValue; }
function holdKeyLevelTwoDays(rows, idx, level) { return Number.isFinite(level) && idx >= 1 && n(rows[idx].min) >= level * 0.985 && n(rows[idx - 1].min) >= level * 0.985; }
function taiwanTick(price) {
  if (!Number.isFinite(price)) return NaN;
  if (price < 10) return 0.01;
  if (price < 50) return 0.05;
  if (price < 100) return 0.1;
  if (price < 500) return 0.5;
  if (price < 1000) return 1;
  return 5;
}
function detectWNeckline(rows, idx) {
  const findTrough = (from, to) => {
    let price = Infinity; let index = -1;
    for (let i = from; i <= to; i += 1) {
      const low = n(rows[i]?.min);
      if (Number.isFinite(low) && low < price) { price = low; index = i; }
    }
    return { price, index };
  };
  if (idx < 8) return { detected: false, two_day_hold: false, reason: "w_neckline_history_under_8" };
  const start = Math.max(0, idx - 80); let best = null;
  for (let neckIndex = start + 3; neckIndex <= idx - 3; neckIndex += 1) {
    const neckline = n(rows[neckIndex]?.max); if (!Number.isFinite(neckline)) continue;
    const left = findTrough(Math.max(start, neckIndex - 20), neckIndex - 1);
    const right = findTrough(neckIndex + 1, Math.min(idx - 2, neckIndex + 20));
    if (!Number.isFinite(left.price) || !Number.isFinite(right.price)) continue;
    const localHighs = rows.slice(Math.max(start, neckIndex - 2), Math.min(idx - 1, neckIndex + 2) + 1).map((row) => n(row.max)).filter(Number.isFinite);
    const localHigh = Math.max(...localHighs);
    const troughDepth = Math.min((neckline - left.price) / neckline, (neckline - right.price) / neckline);
    if (neckline < localHigh * 0.995 || troughDepth < 0.025) continue;
    const tick = taiwanTick(neckline);
    const twoDayLows = [n(rows[idx - 1]?.min), n(rows[idx]?.min)];
    const twoDayHold = twoDayLows.every((low) => Number.isFinite(low) && low >= neckline - tick);
    const closeAbove = n(rows[idx]?.close) >= neckline - tick;
    if (!twoDayHold || !closeAbove) continue;
    const score = troughDepth - Math.abs((neckIndex - left.index) - (right.index - neckIndex)) * 0.0005;
    if (!best || score > best.score) best = { detected: true, two_day_hold: true, neckline_price: round(neckline), neckline_tick: tick, left_trough_price: round(left.price), right_trough_price: round(right.price), left_trough_date: rows[left.index]?.date || null, right_trough_date: rows[right.index]?.date || null, hold_dates: [rows[idx - 1]?.date || null, rows[idx]?.date || null], hold_lows: twoDayLows.map((low) => round(low)), close_above_neckline: closeAbove, score: round(score, 6), reason: "w_neckline_two_day_hold" };
  }
  if (best) {
    const retestNeckline = n(rows[idx - 2]?.close);
    const retestTick = taiwanTick(retestNeckline);
    const retestLows = [n(rows[idx - 1]?.min), n(rows[idx]?.min)];
    const recentRetestHold = Number.isFinite(retestNeckline) && Number.isFinite(retestTick) && retestNeckline > n(best.neckline_price) + retestTick && retestLows.every((low) => Number.isFinite(low) && low >= retestNeckline - retestTick) && n(rows[idx]?.close) >= retestNeckline - retestTick;
    if (recentRetestHold) return { ...best, neckline_price: round(retestNeckline), neckline_tick: retestTick, base_neckline_price: best.neckline_price, neckline_source: "recent_breakout_close_retest", hold_lows: retestLows.map((low) => round(low)), reason: "w_neckline_recent_retest_two_day_hold" };
    return { ...best, neckline_source: "w_pivot_high" };
  }
  return { detected: false, two_day_hold: false, reason: "w_neckline_not_confirmed" };
}

function institutionalByDate(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const date = String(row.date || ""); if (!date) continue;
    const bucket = map.get(date) || { date, total_net: 0, foreign_net: 0, trust_net: 0, dealer_net: 0 };
    const net = n(row.buy, 0) - n(row.sell, 0); bucket.total_net += net;
    const name = String(row.name || row.investor || "");
    if (/Foreign|外資/i.test(name)) bucket.foreign_net += net;
    else if (/Investment_Trust|投信/i.test(name)) bucket.trust_net += net;
    else if (/Dealer|自營/i.test(name)) bucket.dealer_net += net;
    map.set(date, bucket);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function mergeBranchCosts(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const id = String(row.securities_trader_id || row.trader_id || ""); if (!id) continue;
    const trader = String(row.securities_trader || row.trader || row.branch_name || row.name || "").trim();
    const item = map.get(id) || { trader, trader_id: id, buy: 0, sell: 0, buy_amount: 0, sell_amount: 0 };
    if (!item.trader && trader) item.trader = trader;
    const price = n(row.price); const buy = n(row.buy, 0); const sell = n(row.sell, 0);
    item.buy += buy; item.sell += sell; if (Number.isFinite(price)) { item.buy_amount += price * buy; item.sell_amount += price * sell; }
    map.set(id, item);
  }
  return [...map.values()].map((item) => { const net = item.buy - item.sell; return { trader: item.trader, trader_id: item.trader_id, net_buy: round(net, 0), net_buy_cost: net > 0 ? round((item.buy_amount - item.sell_amount) / net, 4) : null }; }).sort((a, b) => n(b.net_buy, 0) - n(a.net_buy, 0));
}
function weightedNetCost(rows) { let amount = 0; let qty = 0; for (const row of rows || []) if (n(row.net_buy, 0) > 0 && Number.isFinite(n(row.net_buy_cost))) { amount += n(row.net_buy) * n(row.net_buy_cost); qty += n(row.net_buy); } return qty ? round(amount / qty, 4) : null; }
function preferredTopNetBuyBrokerEvidence(rows) {
  const top = (rows || []).find((row) => n(row?.net_buy, 0) > 0) || null;
  if (!top) return { available: false, matched: false, rank: null, broker_name: "", trader_id: "", net_buy: null, cost_price: null, reason: "top_net_buy_branch_missing" };
  const brokerName = String(top.trader || "").trim();
  if (!brokerName) return { available: false, matched: false, rank: 1, broker_name: "", trader_id: String(top.trader_id || ""), net_buy: round(n(top.net_buy), 0), cost_price: round(n(top.net_buy_cost)), reason: "top_net_buy_broker_name_missing" };
  const compact = brokerName.replace(/[\s\-_.()（）]/g, "").toLowerCase();
  const brokerKey = /摩根大通|jpmorgan/.test(compact) ? "jpmorgan" : /摩根士丹利|morganstanley/.test(compact) ? "morgan_stanley" : "";
  return { available: true, matched: Boolean(brokerKey), broker_key: brokerKey || null, rank: 1, broker_name: brokerName, trader_id: String(top.trader_id || ""), net_buy: round(n(top.net_buy), 0), cost_price: round(n(top.net_buy_cost)), reason: brokerKey ? "preferred_broker_top_net_buy" : "top_net_buy_broker_not_preferred" };
}

function validateReport(payload, tradeDate) {
  const date = dashDate(payload?.trade_date || payload?.date);
  const confidence = n(payload?.confidence);
  return date === tradeDate && /^08:30(?:$|[:+T\s])/.test(String(payload?.report_time || "")) && Boolean(payload?.run_id) && payload?.source === "opening_report_0830" && payload?.mode === "priority_bias_only" && Boolean(String(payload?.industry || "").trim()) && Boolean(String(payload?.bias || "").trim()) && Boolean(String(payload?.evidence_summary || "").trim()) && Array.isArray(payload?.mapped_symbols) && payload.mapped_symbols.length > 0 && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 && payload?.allowed_action === "boost_scan_priority_only" && payload?.forbidden_action === "publish_formal_candidate_without_taiwan_evidence" && payload?.overseas_strength_contract === "opening_report_0830_overseas_strength_v1" && String(payload?.overseas_evidence_cutoff || "").includes("08:20:00 Asia/Taipei");
}
function loadOpeningReport(tradeDate) {
  const stateDir = path.join(RUNTIME_DIR, "state");
  const result = { files_seen: 0, files_accepted: 0, run_ids: [], industries: [], strong_industries: [], by_symbol: new Map() };
  let files = [];
  try {
    files = fs.readdirSync(stateDir).filter((name) => /^opening_report_0830\.industry_bias\..+\.json$/.test(name)).map((name) => path.join(stateDir, name));
  } catch {
    return result;
  }
  result.files_seen = files.length;
  const accepted = [];
  for (const file of files) {
    const payload = readJson(file);
    if (!validateReport(payload, tradeDate)) continue;
    const usReturn1d = n(payload.us_return_1d_pct);
    const overseasReturn1d = n(payload.overseas_return_1d_pct);
    const sectorReturn1d = maxFinite([usReturn1d, overseasReturn1d]);
    const sectorReturn2d = maxFinite([payload.us_return_2d_pct, payload.overseas_return_2d_pct]);
    accepted.push({ payload, sectorReturn1d, sectorReturn2d, strongSectorReturn1d: payload.bias === "positive_detected" });
  }
  const rankedPositive = accepted.filter((item) => item.strongSectorReturn1d).sort((a, b) => n(b.sectorReturn1d, -Infinity) - n(a.sectorReturn1d, -Infinity));
  const positiveRankByIndustry = new Map();
  rankedPositive.forEach((item, index) => {
    const rank = index + 1;
    positiveRankByIndustry.set(item.payload.industry, { rank, score: openingReportScoreForRank(rank) });
  });
  for (const item of accepted) {
    const { payload, sectorReturn1d, sectorReturn2d, strongSectorReturn1d } = item;
    const positiveRank = positiveRankByIndustry.get(payload.industry) || null;
    result.files_accepted += 1;
    result.run_ids.push(payload.run_id);
    result.industries.push(payload.industry);
    if (strongSectorReturn1d) {
      result.strong_industries.push({ industry: payload.industry, display_name: payload.display_name || payload.industry, bias: payload.bias, priority_rank: Number.isFinite(n(payload.priority_rank)) ? n(payload.priority_rank) : null, positive_return_rank: positiveRank?.rank ?? null, opening_report_score: positiveRank?.score ?? 0, sector_return_1d_pct: round(sectorReturn1d), sector_return_2d_pct: round(sectorReturn2d), us_sector_up_1d: payload.us_sector_up_1d === true, us_sector_up_2d: payload.us_sector_up_2d === true, overseas_sector_up_1d: payload.overseas_sector_up_1d === true, overseas_sector_up_2d: payload.overseas_sector_up_2d === true });
    }
    for (const entry of payload.mapped_symbols) {
      const symbol = String(typeof entry === "string" ? entry : entry?.symbol || entry?.stock_id || "");
      if (!/^\d{4,6}$/.test(symbol)) continue;
      const context = result.by_symbol.get(symbol) || { priority_observation: true, industries: [], display_names: [], run_ids: [], priority_ranks: [], positive_return_ranks: [], opening_report_score_ranks: [], opening_report_scores: [], biases: [], tiers: [], us_sector_up_1d: false, us_sector_up_2d: false, overseas_sector_up_1d: false, overseas_sector_up_2d: false, us_return_1d_pct: null, us_return_2d_pct: null, overseas_return_1d_pct: null, overseas_return_2d_pct: null, sector_return_1d_pct: null, sector_return_2d_pct: null, strong_sector_return_1d: false, us_sector_trend: "us_not_strong" };
      const tier = typeof entry === "string" ? "" : String(entry?.tier || "");
      context.priority_observation = true;
      context.industries.push(payload.industry); context.display_names.push(payload.display_name || payload.industry); context.run_ids.push(payload.run_id);
      if (Number.isFinite(n(payload.priority_rank))) context.priority_ranks.push(n(payload.priority_rank));
      if (positiveRank) { context.positive_return_ranks.push(positiveRank.rank); context.opening_report_score_ranks.push(positiveRank.rank); context.opening_report_scores.push(positiveRank.score); }
      context.biases.push(payload.bias); if (tier) context.tiers.push(tier);
      context.us_sector_up_1d ||= payload.us_sector_up_1d === true; context.us_sector_up_2d ||= payload.us_sector_up_2d === true;
      context.overseas_sector_up_1d ||= payload.overseas_sector_up_1d === true; context.overseas_sector_up_2d ||= payload.overseas_sector_up_2d === true;
      context.us_return_1d_pct = maxFinite([context.us_return_1d_pct, payload.us_return_1d_pct]);
      context.us_return_2d_pct = maxFinite([context.us_return_2d_pct, payload.us_return_2d_pct]);
      context.overseas_return_1d_pct = maxFinite([context.overseas_return_1d_pct, payload.overseas_return_1d_pct]);
      context.overseas_return_2d_pct = maxFinite([context.overseas_return_2d_pct, payload.overseas_return_2d_pct]);
      context.sector_return_1d_pct = maxFinite([context.sector_return_1d_pct, sectorReturn1d]);
      context.sector_return_2d_pct = maxFinite([context.sector_return_2d_pct, sectorReturn2d]);
      context.strong_sector_return_1d ||= strongSectorReturn1d;
      context.us_sector_trend = sectorTrendLabel(context.us_sector_up_1d, context.us_sector_up_2d);
      result.by_symbol.set(symbol, context);
    }
  }
  result.run_ids = unique(result.run_ids); result.industries = unique(result.industries);
  result.strong_industries = [...new Map(result.strong_industries.sort((a, b) => n(a.positive_return_rank, 999) - n(b.positive_return_rank, 999)).map((row) => [row.industry, row])).values()];
  for (const context of result.by_symbol.values()) {
    context.industries = unique(context.industries); context.display_names = unique(context.display_names); context.run_ids = unique(context.run_ids);
    context.priority_ranks = unique(context.priority_ranks).map((value) => n(value)).filter(Number.isFinite).sort((a, b) => a - b);
    context.positive_return_ranks = unique(context.positive_return_ranks).map((value) => n(value)).filter(Number.isFinite).sort((a, b) => a - b);
    context.opening_report_score_ranks = unique(context.opening_report_score_ranks).map((value) => n(value)).filter(Number.isFinite).sort((a, b) => a - b);
    context.opening_report_scores = unique(context.opening_report_scores).map((value) => n(value)).filter(Number.isFinite).sort((a, b) => b - a);
    context.opening_report_positive_return_rank = context.positive_return_ranks[0] ?? null;
    context.opening_report_score_rank = context.opening_report_score_ranks[0] ?? null;
    context.biases = unique(context.biases); context.tiers = unique(context.tiers);
    context.us_return_1d_pct = round(context.us_return_1d_pct); context.us_return_2d_pct = round(context.us_return_2d_pct); context.overseas_return_1d_pct = round(context.overseas_return_1d_pct); context.overseas_return_2d_pct = round(context.overseas_return_2d_pct); context.sector_return_1d_pct = round(context.sector_return_1d_pct); context.sector_return_2d_pct = round(context.sector_return_2d_pct);
  }
  return result;
}

function classifyPreopenSlot(row, strength) {
  const fut = n(row?.fut_price);
  const trial = n(row?.trial_price);
  const futChangePct = n(row?.fut_change_pct);
  const futVolume = n(row?.fut_volume);
  const relToTxf = n(strength?.relative_to_txf_percent);
  const effectiveVolume = Number.isFinite(futVolume) ? futVolume : n(strength?.futopt_total_volume);
  const effectiveFutChange = Number.isFinite(futChangePct) ? futChangePct : n(strength?.futopt_change_percent);
  const futStrong = Number.isFinite(effectiveFutChange) && effectiveFutChange >= FUTOPT_STRONG_CHANGE_PCT
    && Number.isFinite(relToTxf) && relToTxf >= FUTOPT_RELATIVE_TO_TXF_PCT
    && Number.isFinite(effectiveVolume) && effectiveVolume >= FUTOPT_MIN_VOLUME;
  const hasFut = Number.isFinite(fut);
  const hasTrial = Number.isFinite(trial);
  const basis = hasFut && hasTrial ? fut - trial : NaN;
  const basisPct = hasFut && hasTrial && trial !== 0 ? (basis / trial) * 100 : NaN;
  let status = "資料不足";
  let direction = "UNKNOWN";
  if (hasFut && hasTrial) {
    if (basisPct > 0 && futStrong) { status = "正價差"; direction = "POSITIVE"; }
    else if (basisPct < 0) { status = "逆價差"; direction = "NEGATIVE"; }
    else if (Math.abs(basisPct) <= FLAT_BASIS_ABS_PCT) { status = "平價差"; direction = "FLAT"; }
    else { status = "資料不足"; direction = "UNKNOWN"; }
  } else if (hasFut && !hasTrial && futStrong) {
    status = "期貨強勢/價差待確認";
  } else if (!hasFut && hasTrial) {
    status = "試撮強/缺期貨";
  }
  return {
    has_fut_price: hasFut,
    has_trial_price: hasTrial,
    fut_price: round(fut),
    fut_change_pct: round(effectiveFutChange),
    fut_volume: round(effectiveVolume, 0),
    trial_price: round(trial),
    trial_change_pct: round(n(row?.trial_change_pct)),
    relative_to_txf_percent: round(relToTxf),
    basis: round(basis),
    basis_pct: round(basisPct),
    basis_direction: direction,
    basis_status: status,
    futopt_strong: futStrong,
  };
}

async function loadPreopenEvidence(tradeDate, symbols) {
  const key = supabaseKey(); const output = { ok: false, source: "supabase_preopen_futopt_trial_views", views: { near_one: "v_fugle_daytrade_near_one_contract", preopen_snapshot: "v_fugle_daytrade_preopen_snapshot_contract", inverse_convergence: "derived_from_0845_0850_slots" }, cases: {}, failures: [] };
  if (!key) { output.failures.push("missing_supabase_read_key"); return output; }
  try {
    // Preopen source views are small same-day futures universes. Query them by
    // trade date once, then intersect locally. A 691-symbol IN predicate made
    // PostgREST time out and delayed the 08:55 observation list.
    const [nearRows, snapshots, strengthRows] = await Promise.all([
      supabaseSelect(output.views.near_one, { select: "trade_date,symbol,fut_contract,expiry_date,is_near_one,source", trade_date: `eq.${tradeDate}`, limit: "5000" }, key),
      supabaseSelect(output.views.preopen_snapshot, { select: "trade_date,capture_slot,underlying_symbol,fut_contract,expiry_date,captured_at,fut_price,fut_change_pct,fut_volume,trial_price,trial_change_pct,best_bid,best_ask,bid_ask_ratio,natural_schedule_evidence,source", trade_date: `eq.${tradeDate}`, limit: "5000" }, key),
      supabaseSelect("v_stock_future_live_contract", { select: "trade_date,symbol,futopt_change_percent,futopt_total_volume,txf_change_percent,relative_to_txf_percent,source_status", trade_date: `eq.${tradeDate}`, limit: "5000" }, key),
    ]);
    output.views.stock_future_live = "v_stock_future_live_contract";
    const near = new Map(nearRows.map((row) => [String(row.symbol), row])); const strength = new Map(strengthRows.map((row) => [String(row.symbol), row])); const snapshotsBySymbol = new Map();
    for (const row of snapshots) { const symbol = String(row.underlying_symbol || ""); const map = snapshotsBySymbol.get(symbol) || new Map(); map.set(String(row.capture_slot || ""), row); snapshotsBySymbol.set(symbol, map); }
    for (const symbol of symbols) {
      const slotMap = snapshotsBySymbol.get(symbol) || new Map(); const futStrength = strength.get(symbol) || null; const slots = REQUIRED_PREOPEN_SLOTS.map((capture_slot) => { const row = slotMap.get(capture_slot) || null; const classified = classifyPreopenSlot(row, futStrength); return { capture_slot, present: Boolean(row), natural_schedule_evidence: row?.natural_schedule_evidence === true, best_bid: round(n(row?.best_bid)), best_ask: round(n(row?.best_ask)), bid_ask_ratio: round(n(row?.bid_ask_ratio)), ...classified }; });
      const nearOneReady = Boolean(near.get(symbol)?.is_near_one === true && near.get(symbol)?.fut_contract && near.get(symbol)?.expiry_date);
      const trialMatchReady = slots.every((slot) => slot.present && slot.natural_schedule_evidence && slot.has_trial_price && slot.has_fut_price);
      const positiveBasis = slots.some((slot) => slot.basis_status === "正價差"); const negativeBasis = slots.some((slot) => slot.basis_status === "逆價差"); const flatBasis = slots.some((slot) => slot.basis_status === "平價差"); const pendingBasis = slots.some((slot) => slot.basis_status === "期貨強勢/價差待確認"); const inverseConvergence = slots.length >= 2 && slots[0].natural_schedule_evidence === true && slots[1].natural_schedule_evidence === true && Number.isFinite(n(slots[0].basis_pct)) && Number.isFinite(n(slots[1].basis_pct)) && n(slots[0].basis_pct) < 0 && n(slots[1].basis_pct) < 0 && n(slots[1].basis_pct) > n(slots[0].basis_pct);
      const futoptNearPrevCloseAndUp = slots.some((slot) => slot.fut_change_pct !== null && slot.fut_change_pct > 0 && Math.abs(slot.fut_change_pct) <= FUTOPT_NEAR_PREV_CLOSE_PCT);
      const trialMatchLimitDown = slots.some((slot) => slot.trial_change_pct !== null && slot.trial_change_pct <= TRIAL_LIMIT_DOWN_PCT);
      const failures = []; if (!nearOneReady) failures.push("near_one_incomplete"); if (!trialMatchReady) failures.push("trial_match_0845_0850_incomplete");
      output.cases[symbol] = { near_one_ready: nearOneReady, trial_match_ready: trialMatchReady, positive_basis: positiveBasis, negative_basis: negativeBasis, flat_basis: flatBasis, basis_pending: pendingBasis, inverse_convergence: inverseConvergence, futopt_near_prev_close_and_up: futoptNearPrevCloseAndUp, trial_match_limit_down: trialMatchLimitDown, futopt_strength: futStrength, slots, failures };
    }
    output.ok = true;
  } catch (error) { output.failures.push(error?.message || String(error)); }
  return output;
}

async function loadOvernightStyle(signalDate, symbol, key) {
  if (!signalDate || !key) return { available: false, matched: false, reason: key ? "signal_date_missing" : "missing_supabase_read_key" };
  try {
    const rows = await supabaseSelect("v_terminal_main_force_latest", { select: "symbol,trade_date,status,overnight_matched,overnight_cost_price,overnight_net_buy", trade_date: `eq.${signalDate}`, symbol: `eq.${symbol}`, limit: "1" }, key);
    const row = rows[0];
    if (!row || String(row.status || "") !== "ready") return { available: false, matched: false, reason: "overnight_style_unavailable" };
    return { available: true, matched: row.overnight_matched === true, cost_price: round(n(row.overnight_cost_price)), net_buy: round(n(row.overnight_net_buy), 0), reason: row.overnight_matched === true ? "overnight_style_matched" : "overnight_style_not_matched" };
  } catch (error) { return { available: false, matched: false, reason: `overnight_style_read_failed:${error?.message || String(error)}` }; }
}

async function staticSourceForSymbol(symbol, tradeDate, token, key, existing) {
  if (existing?.trade_date === tradeDate && existing.symbol === symbol && existing.signal_date && Array.isArray(existing.price_rows) && Array.isArray(existing.institutional_rows) && Array.isArray(existing.branch_rows)) return existing;
  const [priceRows, institutionalRows] = await Promise.all([
    finmind("TaiwanStockPrice", { data_id: symbol, start_date: addDays(tradeDate, -430), end_date: tradeDate }, token),
    finmind("TaiwanStockInstitutionalInvestorsBuySell", { data_id: symbol, start_date: addDays(tradeDate, -12), end_date: tradeDate }, token),
  ]);
  const signalDate = lastCompletedSignalDate(priceRows, tradeDate); if (!signalDate) throw new Error("previous_completed_daily_price_missing");
  // FinMind's trading daily report is a one-day, per-symbol endpoint. It rejects end_date.
  const [branchRows, overnight] = await Promise.all([
    finmind("TaiwanStockTradingDailyReport", { data_id: symbol, start_date: signalDate }, token),
    loadOvernightStyle(signalDate, symbol, key),
  ]);
  return { symbol, trade_date: tradeDate, signal_date: signalDate, fetched_at: new Date().toISOString(), price_rows: priceRows, institutional_rows: institutionalRows, branch_rows: branchRows, overnight };
}

async function mapConcurrent(values, limit, callback) { const out = new Array(values.length); let cursor = 0; await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => { while (cursor < values.length) { const index = cursor++; out[index] = await callback(values[index]); } })); return out; }

function summarizeEvidence(source, openingReport, preopenCase) {
  const symbol = source.symbol; const price = priceRowsByDate(source.price_rows); const idx = price.findIndex((row) => String(row.date || "") === source.signal_date);
  if (idx < 0) return { symbol, ok: false, status: "OPEN_LIMIT_ORDER_DATA_GAP", first_blocker: "signal_date_not_in_daily_price", reasons: [], data_gaps: ["previous_completed_daily_price_missing"], evidence: {} };
  const today = price[idx]; const prev = price[idx - 1]; const prev2 = price[idx - 2]; const dataGaps = []; const failures = []; const reasons = [];
  const branches = mergeBranchCosts(source.branch_rows); const positive = branches.filter((row) => n(row.net_buy, 0) > 0); const top5 = positive.slice(0, 5); const top10 = positive.slice(0, 10); const preferredTopBroker = preferredTopNetBuyBrokerEvidence(positive); const cost10 = weightedNetCost(top10); const close = n(today.close); const preopenPriceEligible = Number.isFinite(close) && close >= 50;
  if (!Number.isFinite(close)) dataGaps.push("preopen_price_unknown"); else if (!preopenPriceEligible) dataGaps.push("preopen_price_below_50");
  const highCost = Number.isFinite(cost10) && Number.isFinite(close) && cost10 >= close * 0.99;
  if (!source.branch_rows?.length) dataGaps.push("main_force_branch_cost_missing");
  const institutions = institutionalByDate(source.institutional_rows); const instIdx = institutions.findIndex((row) => row.date === source.signal_date); const instToday = institutions[instIdx]; const instPrev = institutions[instIdx - 1]; const institutionSameBuy = Boolean(instToday && instPrev && n(instToday.total_net, 0) > 0 && n(instPrev.total_net, 0) > 0); if (!instToday || !instPrev) dataGaps.push("institutional_two_day_history_missing");
  const report = openingReport.by_symbol.get(symbol) || null; const us1 = report?.us_sector_up_1d === true; const us2 = report?.us_sector_up_2d === true; const overseas1 = report?.overseas_sector_up_1d === true; const overseas2 = report?.overseas_sector_up_2d === true; const sector1 = openingReportSectorPositive(report); const sector2 = us2 || overseas2 || n(report?.sector_return_2d_pct) > 0; if (!sector1) dataGaps.push("opening_report_sector_1d_strength_missing_or_not_positive"); if (!sector2) dataGaps.push("opening_report_sector_2d_strength_missing_or_not_positive");
  const preopen = preopenCase || null; if (!preopen) dataGaps.push("futopt_preopen_evidence_missing");
  const positiveBasis = preopen?.positive_basis === true; const negativeBasis = preopen?.negative_basis === true; const flatBasis = preopen?.flat_basis === true; const basisPending = preopen?.basis_pending === true; const inverse = preopen?.inverse_convergence === true; const trialReady = preopen?.trial_match_ready === true; const nearPrevCloseUp = preopen?.futopt_near_prev_close_and_up === true; const trialLimitDown = preopen?.trial_match_limit_down === true; const basisOrInverse = positiveBasis || negativeBasis || inverse;
  if (!basisOrInverse) dataGaps.push(basisPending ? "futopt_strong_basis_pending_trial_price" : "futopt_basis_or_inverse_convergence_missing"); if (!trialReady) dataGaps.push("trial_match_0845_0850_missing");
  const overnight = source.overnight || { available: false, matched: false, reason: "overnight_style_missing" }; if (!overnight.available) dataGaps.push("overnight_trader_style_missing");
  const ma60 = ma(price, idx, 60); const ma60Prev = ma(price, idx - 1, 60); const ma240 = ma(price, idx, 240); const ma240Prev = ma(price, idx - 1, 240); const keyLevel = Number.isFinite(cost10) ? cost10 : ma60; const wNeckline = detectWNeckline(price, idx);
  const ruleMap = [
    [RULES[0], limitDownReopened(today, prev) && highCost],
    [RULES[1], reboundFromLow(price, idx) && twoDayUp(price, idx) && institutionSameBuy],
    [RULES[2], supportedByMa(today, ma60) && sector1],
    [RULES[3], brokeAboveMa(today, prev, ma240, ma240Prev) && sector1],
    [RULES[4], trialReady && nearPrevCloseUp && trialLimitDown && sector1],
    [RULES[5], basisOrInverse],
    [RULES[6], sector2],
    [RULES[7], wNeckline.two_day_hold === true && overnight.matched === true],
    [RULES[8], sector1 && holdKeyLevelTwoDays(price, idx, keyLevel)],
    [RULES[9], limitUpClosed(today, prev) && positiveBasis],
  ];
  for (const [rule, passed] of ruleMap) if (passed) reasons.push(rule);
  const ok = preopenPriceEligible && reasons.length >= 1; const status = !preopenPriceEligible ? "OPEN_LIMIT_ORDER_REJECTED" : ok ? "OPEN_LIMIT_ORDER_CANDIDATE" : dataGaps.length ? "OPEN_LIMIT_ORDER_DATA_GAP" : "OPEN_LIMIT_ORDER_REJECTED";
  const reportBoost = ok ? openingReportRankBoost(report) : 0;
  const futScore = ok ? futuresScore(preopen) : 0;
  const industryFuturesScore = ok ? industryFuturesComboScore(report, preopen) : 0;
  const brokerScore = ok && preferredTopBroker.matched === true ? 6 : 0;
  const baseScore = reasons.length * 14 + (highCost ? 8 : 0) + (institutionSameBuy ? 8 : 0);
  const entryScore = Math.min(100, baseScore + reportBoost + futScore + industryFuturesScore + brokerScore);
  return { symbol, ok, status, qualified_label: ok ? "符合開盤入標的" : status === "OPEN_LIMIT_ORDER_DATA_GAP" ? "資料缺口，未列入符合標的" : "未符合開盤入", matched_strategy_numbers: ruleNos(reasons), matched_strategy_labels: ruleDisplays(reasons), entry_score: entryScore, opening_report_rank_boost: reportBoost, entry_score_base: baseScore, matched_rule_count: reasons.length, candidate_min_matched_rules: 1, risk_score: reasons.includes(RULES[9]) ? 45 : 30, reasons, data_gaps: unique(dataGaps), failures: unique(failures), evidence: {
    daily_signal_date: source.signal_date, preopen_price_eligible: preopenPriceEligible, close, open: n(today.open), high: n(today.max), low: n(today.min), previous_close: n(prev?.close), ma60: round(ma60), ma240: round(ma240), limit_down_reopened: limitDownReopened(today, prev), previous_limit_up: limitUpClosed(today, prev), two_day_up: twoDayUp(price, idx), rebound_from_low: reboundFromLow(price, idx), ma60_support_retest: supportedByMa(today, ma60), ma240_breakout: brokeAboveMa(today, prev, ma240, ma240Prev), institution_same_buy_2d: institutionSameBuy, institution_signal_date_total_net: round(n(instToday?.total_net, 0), 0), main_force_cost_top10: cost10, main_force_cost_high: highCost, w_neckline: wNeckline, overnight_trader_style: overnight, preferred_broker_top_net_buy: preferredTopBroker.matched === true, preferred_broker_top_net_buy_detail: preferredTopBroker, top_branches: top10, opening_report_priority_observation: report?.priority_observation === true, opening_report_strong_sector_return_1d: report?.strong_sector_return_1d === true, opening_report_industries: report?.industries || [], opening_report_display_names: report?.display_names || [], opening_report_run_ids: report?.run_ids || [], opening_report_priority_ranks: report?.priority_ranks || [], opening_report_positive_return_ranks: report?.positive_return_ranks || [], opening_report_score_ranks: report?.opening_report_score_ranks || [], opening_report_score_rank: report?.opening_report_score_rank ?? null, opening_report_biases: report?.biases || [], opening_report_tiers: report?.tiers || [], opening_report_sector_return_1d_pct: report?.sector_return_1d_pct ?? null, opening_report_sector_return_2d_pct: report?.sector_return_2d_pct ?? null, opening_report_sector_up_1d: sector1, opening_report_sector_up_2d: sector2, overseas_sector_up_1d: overseas1, overseas_sector_up_2d: overseas2, opening_report_rank_boost: reportBoost, futures_score: futScore, industry_futures_combo_score: industryFuturesScore, broker_score: brokerScore, score_components: { base_score: baseScore, opening_report_score: reportBoost, futures_score: futScore, industry_futures_combo_score: industryFuturesScore, broker_score: brokerScore }, opening_report_score_policy: "strategy_first_then_positive_overseas_return_rank_tier_futures_weighted_ranking_no_formal_by_report", score_weight_contract: { base: "matched_strategy_first", opening_report_score_cap: OPENING_REPORT_SCORE_CAP, opening_report_score_tiers: OPENING_REPORT_SCORE_TIERS, futures_score_cap: FUTURES_SCORE_CAP, industry_futures_combo_score: INDUSTRY_FUTURES_COMBO_SCORE, formal_candidate_by_report_allowed: false }, us_sector_up_1d: us1, us_sector_up_2d: us2, futopt_positive_basis: positiveBasis, futopt_negative_basis: negativeBasis, futopt_flat_basis: flatBasis, futopt_basis_pending: basisPending, futopt_inverse_convergence: inverse, futopt_near_prev_close_and_up: nearPrevCloseUp, trial_match_ready: trialReady, trial_match_limit_down: trialLimitDown, preopen_required_slots: REQUIRED_PREOPEN_SLOTS, preopen_slots: preopen?.slots || [] } };
}

async function main() {
  const tradeDate = dashDate(arg("trade-date", taipeiDate())); const symbols = parseSymbols(arg("symbols", "")); const warmupOnly = arg("warmup-static", "false").toLowerCase() === "true"; const token = finmindToken(); const key = supabaseKey(); const staticPath = arg("source-cache", cachePath(tradeDate)); const existingCache = readJson(staticPath); const existingBySymbol = new Map(Array.isArray(existingCache?.symbols) ? existingCache.symbols.map((item) => [item.symbol, item]) : []); const failedChecks = [];
  if (!tradeDate) failedChecks.push("trade_date_invalid"); if (!symbols.length) failedChecks.push("symbols_required"); if (!token) failedChecks.push("finmind_token_missing");
  // 08:55 must reuse the audited 08:50 static cache. Re-fetching or rewriting
  // hundreds of daily/branch payloads here delays the pre-open list and can
  // accidentally change its evidence between the two phases.
  const validStaticCache = existingCache?.contract === STATIC_CACHE_CONTRACT
    && existingCache?.trade_date === tradeDate
    && Array.isArray(existingCache?.symbols);
  let fetched;
  let cache;
  if (warmupOnly) {
    fetched = await mapConcurrent(symbols, STATIC_CONCURRENCY, async (symbol) => { try { return await staticSourceForSymbol(symbol, tradeDate, token, key, existingBySymbol.get(symbol)); } catch (error) { return { symbol, trade_date: tradeDate, error: error?.message || String(error), price_rows: [], institutional_rows: [], branch_rows: [], overnight: { available: false, matched: false, reason: "static_source_fetch_failed" } }; } });
    cache = { ok: failedChecks.length === 0, contract: STATIC_CACHE_CONTRACT, trade_date: tradeDate, checked_at: new Date().toISOString(), symbols: fetched, source_counts: { requested: symbols.length, ready: fetched.filter((item) => item.signal_date && !item.error).length, failed: fetched.filter((item) => item.error).length } };
    writeJson(staticPath, cache);
  } else {
    if (!validStaticCache) throw new Error("opening_limit_order_0850_static_cache_missing_or_invalid");
    fetched = symbols.map((symbol) => existingBySymbol.get(symbol) || { symbol, trade_date: tradeDate, error: "opening_limit_order_0850_static_symbol_missing", price_rows: [], institutional_rows: [], branch_rows: [], overnight: { available: false, matched: false, reason: "static_source_missing" } });
    cache = existingCache;
  }
  if (warmupOnly) {
    console.log(JSON.stringify({ ok: failedChecks.length === 0, contract: CONTRACT, phase: "0850_static_source_warmup", trade_date: tradeDate, checked_at: new Date().toISOString(), source_cache_path: staticPath, source_cache: cache.source_counts, action_guard: { creates_order: false, creates_formal_candidate: false, publish_allowed: false, requires_second_confirm_before_action: true }, rule_display_contract: "opening_limit_order_strategy_display_v1", rule_definitions: RULE_DEFINITIONS, implemented_rules: RULES, rows: fetched.map((item) => ({ symbol: item.symbol, status: item.error ? "OPEN_LIMIT_ORDER_DATA_GAP" : "OPEN_LIMIT_ORDER_WARMUP_READY", data_gaps: item.error ? ["static_source_fetch_failed"] : [], first_blocker: item.error || null })), failed_checks: failedChecks, first_blocker: failedChecks[0] || null }, null, 2)); return;
  }
  const openingReport = loadOpeningReport(tradeDate); const preopen = await loadPreopenEvidence(tradeDate, symbols); const rows = fetched.map((source) => source.error ? { symbol: source.symbol, ok: false, status: "OPEN_LIMIT_ORDER_DATA_GAP", first_blocker: source.error, reasons: [], data_gaps: ["static_source_fetch_failed"], evidence: {} } : summarizeEvidence(source, openingReport, preopen.cases[source.symbol])); const candidates = rows.filter((row) => row.ok);
  const output = { ok: failedChecks.length === 0, contract: CONTRACT, trade_date: tradeDate, checked_at: new Date().toISOString(), require_readonly: true, test_override_mode: false, test_override_policy: "allow-test-overrides=false", source_cache_path: staticPath, static_source_contract: STATIC_CACHE_CONTRACT, action_guard: { creates_order: false, creates_formal_candidate: false, publish_allowed: false, requires_second_confirm_before_action: true }, rule_display_contract: "opening_limit_order_strategy_display_v1", rule_definitions: RULE_DEFINITIONS, implemented_rules: RULES, phase_readiness: { static_source_ready_count: cache.source_counts.ready, static_source_failed_count: cache.source_counts.failed, preopen_evidence_ready: preopen.ok, opening_gate_ready: candidates.length > 0 }, opening_report_readback: { industry_bias_files_seen: openingReport.files_seen, overseas_strength_files_accepted: openingReport.files_accepted, mapped_symbol_count: openingReport.by_symbol.size, priority_observation_symbol_count: [...openingReport.by_symbol.values()].filter((row) => row.priority_observation === true).length, strong_sector_symbol_count: [...openingReport.by_symbol.values()].filter((row) => row.strong_sector_return_1d === true).length, run_ids: openingReport.run_ids, industries: openingReport.industries, strong_industries: openingReport.strong_industries }, preopen_evidence_readback: preopen, symbols_requested: symbols, candidate_count: candidates.length, candidates: candidates.map((row) => ({ ok: row.ok === true, symbol: row.symbol, status: row.status, qualified_label: row.qualified_label, entry_score: row.entry_score, entry_score_base: row.entry_score_base, opening_report_rank_boost: row.opening_report_rank_boost, futures_score: row.evidence?.futures_score ?? 0, industry_futures_combo_score: row.evidence?.industry_futures_combo_score ?? 0, broker_score: row.evidence?.broker_score ?? 0, score_components: row.evidence?.score_components || null, risk_score: row.risk_score, matched_strategy_numbers: row.matched_strategy_numbers, matched_strategy_labels: row.matched_strategy_labels, reasons: row.reasons, evidence: row.evidence })), rows, failed_checks: failedChecks, first_blocker: failedChecks[0] || preopen.failures[0] || null };
  console.log(JSON.stringify(output, null, 2)); process.exitCode = output.ok ? 0 : 1;
}

main().catch((error) => {
  const tradeDate = dashDate(arg("trade-date", taipeiDate()));
  const symbols = parseSymbols(arg("symbols", ""));
  const firstBlocker = error?.message || String(error);
  console.log(JSON.stringify({
    ok: false,
    contract: CONTRACT,
    trade_date: tradeDate,
    checked_at: new Date().toISOString(),
    require_readonly: true,
    test_override_mode: false,
    test_override_policy: "allow-test-overrides=false",
    source_cache_path: arg("source-cache", cachePath(tradeDate)),
    static_source_contract: STATIC_CACHE_CONTRACT,
    action_guard: {
      creates_order: false,
      creates_formal_candidate: false,
      publish_allowed: false,
      requires_second_confirm_before_action: true,
    },
    rule_display_contract: "opening_limit_order_strategy_display_v1",
    rule_definitions: RULE_DEFINITIONS,
    implemented_rules: RULES,
    phase_readiness: {
      static_source_ready_count: 0,
      static_source_failed_count: symbols.length,
      preopen_evidence_ready: false,
      opening_gate_ready: false,
    },
    opening_report_readback: {
      industry_bias_files_seen: 0,
      overseas_strength_files_accepted: 0,
      mapped_symbol_count: 0,
      priority_observation_symbol_count: 0,
      strong_sector_symbol_count: 0,
      run_ids: [],
      industries: [],
      strong_industries: [],
    },
    preopen_evidence_readback: { ok: false, failures: [firstBlocker] },
    symbols_requested: symbols,
    candidate_count: 0,
    candidates: [],
    rows: symbols.map((symbol) => ({
      symbol,
      ok: false,
      status: "OPEN_LIMIT_ORDER_DATA_GAP",
      first_blocker: firstBlocker,
      reasons: [],
      data_gaps: [firstBlocker],
      evidence: {},
    })),
    failed_checks: [firstBlocker],
    first_blocker: firstBlocker,
  }, null, 2));
  process.exit(1);
});













