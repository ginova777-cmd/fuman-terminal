"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const CONTRACT = "opening_limit_order_0850_static_prefilter_v1";
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

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}
function compactDate(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function dashDate(value) { const date = compactDate(value); return date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : ""; }
function n(value, fallback = NaN) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function round(value, digits = 4) { return Number.isFinite(value) ? Number(value.toFixed(digits)) : null; }
function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function validateOpeningReport(payload, tradeDate) {
  const date = dashDate(payload?.trade_date || payload?.date);
  const confidence = n(payload?.confidence);
  return date === tradeDate
    && /^08:30(?:$|[:+T\s])/.test(String(payload?.report_time || ""))
    && Boolean(payload?.run_id)
    && payload?.source === "opening_report_0830"
    && payload?.mode === "priority_bias_only"
    && Boolean(String(payload?.industry || "").trim())
    && Boolean(String(payload?.bias || "").trim())
    && Boolean(String(payload?.evidence_summary || "").trim())
    && Array.isArray(payload?.mapped_symbols)
    && payload.mapped_symbols.length > 0
    && Number.isFinite(confidence)
    && confidence >= 0
    && confidence <= 1
    && payload?.allowed_action === "boost_scan_priority_only"
    && payload?.forbidden_action === "publish_formal_candidate_without_taiwan_evidence";
}
function sectorTrendLabel(us1, us2) {
  if (us1 && us2) return "us_up_1d_and_2d";
  if (us1) return "us_up_1d_only";
  if (us2) return "us_up_2d_only";
  return "us_not_strong";
}
function maxFinite(values) {
  const finite = (values || []).map((value) => n(value)).filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
}
function loadOpeningReport(tradeDate) {
  const stateDir = path.join(RUNTIME_DIR, "state");
  const result = { files_seen: 0, files_accepted: 0, run_ids: [], industries: [], strong_industries: [], by_symbol: new Map() };
  let files = [];
  try {
    files = fs.readdirSync(stateDir)
      .filter((name) => /^opening_report_0830\.industry_bias\..+\.json$/.test(name))
      .map((name) => path.join(stateDir, name));
  } catch {
    return result;
  }
  result.files_seen = files.length;
  for (const reportFile of files) {
    const payload = readJson(reportFile);
    if (!validateOpeningReport(payload, tradeDate)) continue;
    result.files_accepted += 1;
    result.run_ids.push(payload.run_id);
    result.industries.push(payload.industry);
    const usReturn1d = n(payload.us_return_1d_pct);
    const overseasReturn1d = n(payload.overseas_return_1d_pct);
    const sectorReturn1d = maxFinite([usReturn1d, overseasReturn1d]);
    const sectorReturn2d = maxFinite([payload.us_return_2d_pct, payload.overseas_return_2d_pct]);
    const strongSectorReturn1d = Number.isFinite(sectorReturn1d) && sectorReturn1d > 0;
    if (strongSectorReturn1d || payload.us_sector_up_1d === true || payload.overseas_sector_up_1d === true) {
      result.strong_industries.push({
        industry: payload.industry,
        display_name: payload.display_name || payload.industry,
        bias: payload.bias,
        priority_rank: Number.isFinite(n(payload.priority_rank)) ? n(payload.priority_rank) : null,
        sector_return_1d_pct: round(sectorReturn1d),
        sector_return_2d_pct: round(sectorReturn2d),
        us_sector_up_1d: payload.us_sector_up_1d === true,
        us_sector_up_2d: payload.us_sector_up_2d === true,
        overseas_sector_up_1d: payload.overseas_sector_up_1d === true,
        overseas_sector_up_2d: payload.overseas_sector_up_2d === true,
      });
    }
    for (const entry of payload.mapped_symbols || []) {
      const symbol = String(typeof entry === "string" ? entry : entry?.symbol || entry?.stock_id || "");
      if (!/^\d{4,6}$/.test(symbol)) continue;
      const context = result.by_symbol.get(symbol) || {
        priority_observation: true,
        industries: [],
        display_names: [],
        run_ids: [],
        priority_ranks: [],
        biases: [],
        tiers: [],
        us_sector_up_1d: false,
        us_sector_up_2d: false,
        overseas_sector_up_1d: false,
        overseas_sector_up_2d: false,
        us_return_1d_pct: null,
        us_return_2d_pct: null,
        overseas_return_1d_pct: null,
        overseas_return_2d_pct: null,
        sector_return_1d_pct: null,
        sector_return_2d_pct: null,
        strong_sector_return_1d: false,
        us_sector_trend: "us_not_strong",
      };
      const tier = typeof entry === "string" ? "" : String(entry?.tier || "");
      context.priority_observation = true;
      context.industries.push(payload.industry);
      context.display_names.push(payload.display_name || payload.industry);
      context.run_ids.push(payload.run_id);
      if (Number.isFinite(n(payload.priority_rank))) context.priority_ranks.push(n(payload.priority_rank));
      context.biases.push(payload.bias);
      if (tier) context.tiers.push(tier);
      context.us_sector_up_1d ||= payload.us_sector_up_1d === true;
      context.us_sector_up_2d ||= payload.us_sector_up_2d === true;
      context.overseas_sector_up_1d ||= payload.overseas_sector_up_1d === true;
      context.overseas_sector_up_2d ||= payload.overseas_sector_up_2d === true;
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
  result.run_ids = unique(result.run_ids);
  result.industries = unique(result.industries);
  result.strong_industries = [...new Map(result.strong_industries
    .sort((a, b) => n(a.priority_rank, 999) - n(b.priority_rank, 999))
    .map((item) => [item.industry, item])).values()];
  for (const context of result.by_symbol.values()) {
    context.industries = unique(context.industries);
    context.display_names = unique(context.display_names);
    context.run_ids = unique(context.run_ids);
    context.priority_ranks = unique(context.priority_ranks).sort((a, b) => a - b);
    context.biases = unique(context.biases);
    context.tiers = unique(context.tiers);
    context.us_return_1d_pct = round(context.us_return_1d_pct);
    context.us_return_2d_pct = round(context.us_return_2d_pct);
    context.overseas_return_1d_pct = round(context.overseas_return_1d_pct);
    context.overseas_return_2d_pct = round(context.overseas_return_2d_pct);
    context.sector_return_1d_pct = round(context.sector_return_1d_pct);
    context.sector_return_2d_pct = round(context.sector_return_2d_pct);
  }
  return result;
}
function writeJson(file, payload) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8"); }
function priceRows(rows) { return [...(rows || [])].sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))); }
function ma(rows, index, length) { if (index < length - 1) return NaN; const values = rows.slice(index - length + 1, index + 1).map((row) => n(row.close)); return values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) / length : NaN; }
function limitDownReopened(today, prev) { const base = n(prev?.close); return Number.isFinite(base) && n(today?.min) <= base * 0.9 * 1.012 && n(today?.close) > base * 0.9 * 1.025; }
function limitUpClosed(today, prev) { return Number.isFinite(n(today?.close)) && Number.isFinite(n(prev?.close)) && n(today.close) >= n(prev.close) * 1.095; }
function twoDayUp(rows, index) { return index >= 2 && n(rows[index].close) > n(rows[index - 1].close) && n(rows[index - 1].close) > n(rows[index - 2].close); }
function reboundFromLow(rows, index) { const lows = rows.slice(Math.max(0, index - 5), index + 1).map((row) => n(row.min)).filter(Number.isFinite); return lows.length > 0 && n(rows[index].close) >= Math.min(...lows) * 1.06; }
function supportedByMa(today, value) { return Number.isFinite(value) && n(today?.min) <= value * 1.02 && n(today?.close) >= value; }
function brokeAboveMa(today, prev, value, priorValue) { return Number.isFinite(value) && Number.isFinite(priorValue) && n(today?.close) > value && n(prev?.close) <= priorValue; }
function holdKeyLevelTwoDays(rows, index, level) { return Number.isFinite(level) && index >= 1 && n(rows[index].min) >= level * 0.985 && n(rows[index - 1].min) >= level * 0.985; }
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
function mergeBranchCosts(rows) {
  const buckets = new Map();
  for (const row of rows || []) {
    const id = String(row.securities_trader_id || row.trader_id || "");
    if (!id) continue;
    const trader = String(row.securities_trader || row.trader || row.branch_name || row.name || "").trim();
    const item = buckets.get(id) || { trader, trader_id: id, buy: 0, sell: 0, buyAmount: 0, sellAmount: 0 };
    if (!item.trader && trader) item.trader = trader;
    const price = n(row.price); const buy = n(row.buy, 0); const sell = n(row.sell, 0);
    item.buy += buy; item.sell += sell;
    if (Number.isFinite(price)) { item.buyAmount += price * buy; item.sellAmount += price * sell; }
    buckets.set(id, item);
  }
  return [...buckets.values()].map((item) => {
    const netBuy = item.buy - item.sell;
    return { trader: item.trader, trader_id: item.trader_id, net_buy: netBuy, net_buy_cost: netBuy > 0 ? (item.buyAmount - item.sellAmount) / netBuy : null };
  }).filter((item) => item.net_buy > 0 && Number.isFinite(item.net_buy_cost)).sort((a, b) => b.net_buy - a.net_buy);
}
function weightedCost(rows) { const positives = mergeBranchCosts(rows).slice(0, 10); const volume = positives.reduce((sum, row) => sum + row.net_buy, 0); return volume ? positives.reduce((sum, row) => sum + row.net_buy * row.net_buy_cost, 0) / volume : NaN; }
function preferredTopNetBuyBroker(rows) {
  const top = mergeBranchCosts(rows)[0] || null;
  if (!top) return { available: false, matched: false, rank: null, broker_name: "", trader_id: "", net_buy: null, cost_price: null, reason: "top_net_buy_branch_missing" };
  const brokerName = String(top.trader || "").trim();
  if (!brokerName) return { available: false, matched: false, rank: 1, broker_name: "", trader_id: String(top.trader_id || ""), net_buy: round(top.net_buy, 0), cost_price: round(top.net_buy_cost), reason: "top_net_buy_broker_name_missing" };
  const compact = brokerName.replace(/[\s\-_.()（）]/g, "").toLowerCase();
  const brokerKey = /摩根大通|jpmorgan/.test(compact) ? "jpmorgan" : /摩根士丹利|morganstanley/.test(compact) ? "morgan_stanley" : "";
  return { available: true, matched: Boolean(brokerKey), broker_key: brokerKey || null, rank: 1, broker_name: brokerName, trader_id: String(top.trader_id || ""), net_buy: round(top.net_buy, 0), cost_price: round(top.net_buy_cost), reason: brokerKey ? "preferred_broker_top_net_buy" : "top_net_buy_broker_not_preferred" };
}
function institutionTwoDayBuy(rows, signalDate) {
  const buckets = new Map();
  for (const row of rows || []) {
    const date = String(row.date || ""); if (!date) continue;
    const item = buckets.get(date) || { date, net: 0 };
    item.net += n(row.buy, 0) - n(row.sell, 0); buckets.set(date, item);
  }
  const values = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  const index = values.findIndex((row) => row.date === signalDate);
  return index > 0 && values[index].net > 0 && values[index - 1].net > 0;
}
function main() {
  const tradeDate = dashDate(arg("trade-date"));
  const defaultCache = path.join(RUNTIME_DIR, "data", "opening-limit-order", `opening-limit-order-0850-static-sources-${compactDate(tradeDate)}.json`);
  const sourceCachePath = arg("source-cache", defaultCache);
  const outPath = arg("out", path.join(RUNTIME_DIR, "data", "opening-limit-order", `opening-limit-order-0850-static-prefilter-${compactDate(tradeDate)}.json`));
  const source = readJson(sourceCachePath);
  const failures = [];
  if (!tradeDate) failures.push("trade_date_invalid");
  if (!source || source.contract !== "opening_limit_order_0850_static_sources_v1" || source.trade_date !== tradeDate) failures.push("static_source_cache_missing_or_mismatched");
  const openingReport = loadOpeningReport(tradeDate);
  const rows = [];
  for (const item of source?.symbols || []) {
    const symbol = String(item.symbol || ""); const prices = priceRows(item.price_rows); const index = prices.findIndex((row) => String(row.date || "") === item.signal_date);
    if (!symbol || item.error || index < 1) {
      rows.push({ symbol, status: "DATA_GAP", static_matched_rules: [], pending_confirmation_rules: [], first_blocker: item.error || "daily_signal_data_missing" });
      continue;
    }
    const today = prices[index]; const previous = prices[index - 1]; const ma60 = ma(prices, index, 60); const ma60Previous = ma(prices, index - 1, 60); const ma240 = ma(prices, index, 240); const ma240Previous = ma(prices, index - 1, 240);
    const close = n(today.close); const cost = weightedCost(item.branch_rows); const topNetBuyBroker = preferredTopNetBuyBroker(item.branch_rows); const overnight = item.overnight || {}; const wNeckline = detectWNeckline(prices, index);
    const eligible = Number.isFinite(close) && close >= 50;
    const staticRules = [];
    if (eligible && limitDownReopened(today, previous) && Number.isFinite(cost) && cost >= close * 0.99) staticRules.push("limit_down_reopened_main_force_cost_high");
    if (eligible && reboundFromLow(prices, index) && twoDayUp(prices, index) && institutionTwoDayBuy(item.institutional_rows, item.signal_date)) staticRules.push("low_rebound_two_day_up_institution_buy");
    if (eligible && wNeckline.two_day_hold === true && overnight.available === true && overnight.matched === true) staticRules.push("w_neckline_two_day_hold_overnight_trader_branches");
    const report = openingReport.by_symbol.get(symbol) || null;
    const reportPresent = Boolean(report);
    const us1 = report?.us_sector_up_1d === true;
    const us2 = report?.us_sector_up_2d === true;
    const overseas1 = report?.overseas_sector_up_1d === true;
    const overseas2 = report?.overseas_sector_up_2d === true;
    const sector1 = report?.strong_sector_return_1d === true || us1 || overseas1 || n(report?.sector_return_1d_pct) > 0;
    const sector2 = us2 || overseas2 || n(report?.sector_return_2d_pct) > 0;
    const pendingRules = [];
    const confirmOrPendingSector1 = (rule) => {
      if (sector1) staticRules.push(rule);
      else if (!reportPresent) pendingRules.push({ rule, required_confirmation: "opening_report_sector_up_1d" });
    };
    if (eligible && supportedByMa(today, ma60)) confirmOrPendingSector1("ma60_support_us_sector_strong");
    if (eligible && brokeAboveMa(today, previous, ma240, ma240Previous)) confirmOrPendingSector1("ma240_breakout_us_sector_strong");
    if (eligible && sector2) staticRules.push("two_day_us_sector_strong_mapped_tw");
    if (eligible && limitUpClosed(today, previous)) pendingRules.push({ rule: "previous_limit_up_futopt_positive_basis", required_confirmation: "08:45_08:55_futopt_positive_basis" });
    const keyLevel = Number.isFinite(cost) ? cost : ma60;
    if (eligible && holdKeyLevelTwoDays(prices, index, keyLevel)) confirmOrPendingSector1("us_sector_key_level_hold_two_days");
    rows.push({
      symbol, trade_date: tradeDate, signal_date: item.signal_date,
      status: !eligible ? "REJECTED" : staticRules.length ? "STATIC_MATCH" : pendingRules.length ? "CONDITIONALLY_READY" : "NO_STATIC_MATCH",
      qualified_label: staticRules.length ? "符合開盤入靜態標的" : pendingRules.length ? "待 08:45-08:55 / 海外條件確認" : "未符合開盤入",
      preopen_price_reference: round(close), eligibility: eligible ? "eligible" : Number.isFinite(close) ? "price_below_50" : "price_unknown",
      static_matched_rules: staticRules,
      static_matched_strategy_numbers: ruleNos(staticRules),
      static_matched_strategy_labels: ruleDisplays(staticRules),
      pending_confirmation_rules: pendingRules,
      pending_strategy_numbers: ruleNos(pendingRules.map((item) => item.rule)),
      pending_strategy_labels: pendingRules.map((item) => ({ ...ruleDisplay(item.rule), required_confirmation: item.required_confirmation })),
      evidence: {
        close: round(close),
        main_force_cost_top10: round(cost),
        preferred_broker_top_net_buy: topNetBuyBroker.matched === true,
        preferred_broker_top_net_buy_detail: topNetBuyBroker,
        ma60: round(ma60),
        ma240: round(ma240),
        w_neckline: wNeckline,
        overnight_matched: overnight.matched === true,
        opening_report_priority_observation: report?.priority_observation === true,
        opening_report_industries: report?.industries || [],
        opening_report_display_names: report?.display_names || [],
        opening_report_run_ids: report?.run_ids || [],
        opening_report_priority_ranks: report?.priority_ranks || [],
        opening_report_biases: report?.biases || [],
        opening_report_tiers: report?.tiers || [],
        strong_sector_return_1d: report?.strong_sector_return_1d === true,
        opening_report_sector_up_1d: sector1,
        opening_report_sector_up_2d: sector2,
        sector_return_1d_pct: report?.sector_return_1d_pct ?? null,
        sector_return_2d_pct: report?.sector_return_2d_pct ?? null,
        overseas_sector_up_1d: overseas1,
        overseas_sector_up_2d: overseas2,
        overseas_return_1d_pct: report?.overseas_return_1d_pct ?? null,
        overseas_return_2d_pct: report?.overseas_return_2d_pct ?? null,
        us_sector_up_1d: us1,
        us_sector_up_2d: us2,
        us_sector_trend: report?.us_sector_trend || "missing_opening_report_mapping",
        us_return_1d_pct: report?.us_return_1d_pct ?? null,
        us_return_2d_pct: report?.us_return_2d_pct ?? null,
      },
      first_blocker: !eligible ? (Number.isFinite(close) ? "price_below_50" : "price_unknown") : null,
    });
  }
  const openingReportRows = [...openingReport.by_symbol.values()];
  const output = {
    ok: failures.length === 0, contract: CONTRACT, trade_date: tradeDate, checked_at: new Date().toISOString(), source_cache_path: sourceCachePath,
    scope: "completed_daily_evidence_only", static_rules: ["1", "2", "8"], conditional_rules: ["3", "4", "9", "10"], rule_display_contract: "opening_limit_order_strategy_display_v1", rule_definitions: RULE_DEFINITIONS,
    opening_report_readback: {
      industry_bias_files_seen: openingReport.files_seen,
      industry_bias_files_accepted: openingReport.files_accepted,
      mapped_symbol_count: openingReport.by_symbol.size,
      priority_observation_symbol_count: openingReportRows.filter((row) => row.priority_observation === true).length,
      strong_sector_symbol_count: openingReportRows.filter((row) => row.strong_sector_return_1d === true).length,
      opening_report_sector_up_1d_symbol_count: openingReportRows.filter((row) => row.strong_sector_return_1d === true || row.us_sector_up_1d === true || row.overseas_sector_up_1d === true || n(row.sector_return_1d_pct) > 0).length,
      us_sector_up_1d_symbol_count: openingReportRows.filter((row) => row.us_sector_up_1d === true).length,
      us_sector_up_2d_symbol_count: openingReportRows.filter((row) => row.us_sector_up_2d === true).length,
      overseas_sector_up_1d_symbol_count: openingReportRows.filter((row) => row.overseas_sector_up_1d === true).length,
      strong_industries: openingReport.strong_industries,
      run_ids: openingReport.run_ids,
      industries: openingReport.industries,
    },
    action_guard: { creates_order: false, creates_formal_candidate: false, publish_allowed: false },
    static_match_count: rows.filter((row) => row.status === "STATIC_MATCH").length,
    conditional_ready_count: rows.filter((row) => row.status === "CONDITIONALLY_READY").length,
    data_gap_count: rows.filter((row) => row.status === "DATA_GAP").length,
    rows, failed_checks: failures, first_blocker: failures[0] || null,
  };
  writeJson(outPath, output);
  console.log(JSON.stringify({ ...output, rows: undefined, output_path: outPath }, null, 2));
  process.exitCode = output.ok ? 0 : 1;
}

main();


