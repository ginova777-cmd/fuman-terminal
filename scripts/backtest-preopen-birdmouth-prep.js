"use strict";

const fs = require("fs");
const path = require("path");
const { anonKey, serverSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";

function value(name, fallback = "") {
  const prefix = `${name}=`;
  const arg = process.argv.find((x) => x === name || x.startsWith(prefix));
  return arg === name ? "1" : arg ? arg.slice(prefix.length) : fallback;
}
function flag(name) { return process.argv.includes(name); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function num(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function compact(date) { return String(date).replace(/\D/g, "").slice(0, 8); }
function symbolsArg() { return value("--symbols", "").split(",").map((x) => x.trim()).filter(Boolean); }
function pick(row, names) { for (const name of names) if (row?.[name] !== undefined && row?.[name] !== null && row?.[name] !== "") return row[name]; return null; }
function average(list) { return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null; }
function csvCell(v) { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

async function restRows(table, query) {
  const key = anonKey({ runtimeDir: RUNTIME });
  const base = serverSupabaseUrl({ runtimeDir: RUNTIME });
  if (!key || !base) throw new Error("supabase_read_credentials_missing");
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const separator = query ? "&" : "";
    const response = await fetch(`${base}/rest/v1/${table}?${query}${separator}limit=1000&offset=${offset}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`${table}_read_http_${response.status}:${body.slice(0, 240)}`);
    const page = body ? JSON.parse(body) : [];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

function latestBySymbol(rows, timeFields = ["observed_at", "updated_at"]) {
  const out = new Map();
  for (const row of rows) {
    const symbol = String(row.symbol || row.code || "");
    const time = pick(row, timeFields) || "";
    const previous = out.get(symbol);
    if (symbol && (!previous || Date.parse(time) > Date.parse(pick(previous, timeFields) || ""))) out.set(symbol, row);
  }
  return out;
}

async function discoverRows(date, inputFile, requested) {
  const source = inputFile ? read(inputFile) : read(path.join(RUNTIME, "data", "preopen-birdmouth-prep", `preopen-birdmouth-source-${compact(date)}.json`));
  let rows = Array.isArray(source) ? source : source?.rows || source?.items || source?.history_rows || [];
  const staticFile = path.join(RUNTIME, "data", "opening-limit-order", `opening-limit-order-0850-static-prefilter-${compact(date)}.json`);
  const staticRows = read(staticFile)?.rows || [];
  const slim = read(path.join(RUNTIME, "data", "stocks-slim.json"));
  const slimRows = Array.isArray(slim) ? slim : slim?.rows || slim?.stocks || [];
  const names = new Map([...staticRows, ...slimRows].map((row) => [String(row.symbol || row.code || row.stock_no || ""), row.name || row.stock_name || ""]));
  let meta = null;
  if (!inputFile && !rows.length) {
    const start = encodeURIComponent(`${date}T00:45:00.000Z`);
    const cutoff = encodeURIComponent(`${date}T00:59:59.999Z`);
    const symbolsFilter = requested.length ? `&symbol=in.(${requested.map(encodeURIComponent).join(",")})` : "";
    const history = await restRows("fugle_preopen_snapshot_history", `select=*&trade_date=eq.${date}&observed_at=gte.${start}&observed_at=lte.${cutoff}${symbolsFilter}&order=observed_at.asc`);
    const snapshots = history.length ? [] : await restRows("fugle_preopen_snapshot", `select=*&trade_date=eq.${date}${symbolsFilter}&order=updated_at.asc`);
    const futures = await restRows("v_stock_future_live_contract", `select=*&trade_date=eq.${date}${symbolsFilter}`);
    const warmups = await restRows("fugle_daytrade_intraday_1m", `select=symbol,trade_date,candle_time,close,updated_at&trade_date=eq.${date}&candle_time=lte.${cutoff}${symbolsFilter}&order=candle_time.asc`);
    const primary = history.length ? history.map((row) => ({ ...row, source_kind: "history" })) : snapshots.map((row) => ({ ...row, source_kind: "snapshot", preopen_snapshot_used: true }));
    const primaryBySymbol = latestBySymbol(primary);
    const futureBySymbol = latestBySymbol(futures, ["updated_at", "futopt_updated_at"]);
    const warmupBySymbol = new Map();
    for (const bar of warmups) {
      const symbol = String(bar.symbol || "");
      if (!warmupBySymbol.has(symbol)) warmupBySymbol.set(symbol, []);
      warmupBySymbol.get(symbol).push({ time: bar.candle_time, close: bar.close });
    }
    const universe = requested.length ? requested : slimRows.filter((row) => /^\d{4}$/.test(String(row.code || row.symbol || ""))).map((row) => String(row.code || row.symbol));
    rows = universe.map((symbol) => {
      const base = primaryBySymbol.get(symbol) || { symbol, source_missing: true };
      const future = futureBySymbol.get(symbol) || {};
      const bid = num(base.bid_volume), ask = num(base.ask_volume);
      return {
        ...base,
        symbol,
        name: base.name || names.get(symbol) || future.stock_name || "",
        bid_ask_ratio: pick(base, ["bid_ask_ratio", "bidAskRatio"]) ?? (bid !== null && ask > 0 ? bid / ask : null),
        future_symbol: pick(future, ["future_symbol", "source_symbol"]),
        future_price: pick(future, ["last_price", "futopt_last_price"]),
        future_change_percent: pick(future, ["change_percent", "futopt_change_percent"]),
        relative_to_txf_percent: future.relative_to_txf_percent,
        future_volume: pick(future, ["total_volume", "futopt_total_volume"]),
        warmup_bars: warmupBySymbol.get(symbol) || [],
      };
    });
    const historyTimes = history.map((row) => row.observed_at || row.updated_at).filter(Boolean).sort();
    const snapshotTimes = snapshots.map((row) => row.updated_at).filter(Boolean).sort();
    const futureTimes = futures.map((row) => row.updated_at || row.futopt_updated_at).filter(Boolean).sort();
    const warmupTimes = warmups.map((row) => row.candle_time || row.updated_at).filter(Boolean).sort();
    meta = { historyRows: history.length, historyLatest: historyTimes.at(-1) || null, snapshotRows: snapshots.length, snapshotLatest: snapshotTimes.at(-1) || null, futureRows: futures.length, futureLatest: futureTimes.at(-1) || null, warmupRows: warmups.length, warmupLatest: warmupTimes.at(-1) || null };
  }
  const bySymbol = new Map(rows.map((row) => [String(row.symbol || row.code || row.stock_no || ""), row]));
  if (!requested.length) {
    if (rows.length) return { rows, meta };
    return { rows: slimRows.filter((row) => /^\d{4}$/.test(String(row.code || row.symbol || ""))).map((row) => ({ symbol: String(row.code || row.symbol), name: row.name || "", source_missing: true })), meta };
  }
  return { rows: requested.map((symbol) => bySymbol.get(symbol) || { symbol, name: names.get(symbol) || "", source_missing: true }), meta };
}

function warmup(row, trialPrice, date) {
  const cutoff = Date.parse(`${date}T08:59:59+08:00`);
  const bars = (row.warmup_bars || row.minute_bars || row.bars || []).filter((bar) => {
    const t = Date.parse(bar.time || bar.timestamp || bar.datetime || "");
    return Number.isFinite(t) && t <= cutoff;
  }).sort((a, b) => Date.parse(a.time || a.timestamp || a.datetime) - Date.parse(b.time || b.timestamp || b.datetime));
  const closes = bars.map((bar) => num(bar.close)).filter((x) => x !== null);
  const ma5 = num(pick(row, ["ma5", "MA5"])) ?? average(closes.slice(-5));
  const ma10 = num(pick(row, ["ma10", "MA10"])) ?? average(closes.slice(-10));
  const prevMa5 = num(pick(row, ["previous_ma5", "prev_ma5"])) ?? average(closes.slice(-6, -1));
  const prevMa10 = num(pick(row, ["previous_ma10", "prev_ma10"])) ?? average(closes.slice(-11, -1));
  const projectedMa5 = num(pick(row, ["projected_ma5", "projectedMa5"])) ?? (trialPrice && closes.length >= 4 ? average([...closes.slice(-4), trialPrice]) : null);
  const projectedMa10 = num(pick(row, ["projected_ma10", "projectedMa10"])) ?? (trialPrice && closes.length >= 9 ? average([...closes.slice(-9), trialPrice]) : null);
  const approach = [ma5, ma10, prevMa5, prevMa10].every((x) => x !== null) && prevMa5 <= prevMa10 && ma5 <= ma10 * 1.002;
  const ma5Up = ma5 !== null && prevMa5 !== null && ma5 > prevMa5;
  const ma10NotDown = ma10 !== null && prevMa10 !== null && ma10 >= prevMa10 * 0.998;
  const projectedNear = projectedMa5 !== null && projectedMa10 !== null && projectedMa5 >= projectedMa10 * 0.998;
  const hasEvidence = [ma5, ma10, prevMa5, prevMa10, projectedMa5, projectedMa10].every((x) => x !== null);
  return { ma5, ma10, projectedMa5, projectedMa10, trajectoryOk: approach && ma5Up && ma10NotDown && projectedNear, hasEvidence, approach, ma5Up, ma10NotDown, projectedNear, usesPost0900: false };
}

function evaluate(row, date) {
  const symbol = String(row.symbol || row.code || row.stock_no || "");
  const trialPrice = num(pick(row, ["trial_price", "trialPrice"]));
  const referencePrice = num(pick(row, ["reference_price", "referencePrice"]));
  const trialRisePct = num(pick(row, ["trial_rise_pct", "trialRisePct"])) ?? (trialPrice && referencePrice ? ((trialPrice - referencePrice) / referencePrice) * 100 : null);
  const ratio = num(pick(row, ["bid_ask_ratio", "bidAskRatio"]));
  const bestBid = num(pick(row, ["best_bid_price", "bestBidPrice"]));
  const futureSymbol = String(pick(row, ["future_symbol", "futureSymbol", "futures_symbol"]) || "");
  const futurePrice = num(pick(row, ["future_price", "futurePrice"]));
  const futurePct = num(pick(row, ["future_change_percent", "futureChangePercent", "futopt_change_percent"]));
  const relativePct = num(pick(row, ["relative_to_txf_percent", "relativeToTxfPercent"]));
  const futureVolume = num(pick(row, ["future_volume", "futureVolume"]));
  const ma = warmup(row, trialPrice, date);
  const blockers = [];
  if (!(trialPrice > 0)) blockers.push("缺試撮價");
  if (!(referencePrice > 0)) blockers.push("缺參考價");
  if (trialRisePct !== null && trialRisePct < 2) blockers.push("試撮漲幅<2%");
  if (ratio === null || ratio < 1.5) blockers.push("買盤不足");
  if (trialPrice > 0 && (bestBid === null || bestBid < trialPrice * 0.998)) blockers.push("買盤未鎖住試撮價");
  const validStockFuture = Boolean(futureSymbol) && !futureSymbol.toUpperCase().startsWith("TXF");
  if (!validStockFuture) blockers.push("缺個股期貨");
  if (validStockFuture && !(futurePrice > 0)) blockers.push("缺期貨價");
  if (validStockFuture && futurePct !== null && futurePct < 2) blockers.push("期貨漲幅<2%");
  if (validStockFuture && relativePct !== null && relativePct < 1) blockers.push("相對TXF<1%");
  if (validStockFuture && futureVolume !== null && futureVolume < 50) blockers.push("期貨量<50");
  if (!ma.hasEvidence) blockers.push("暖機 MA5/MA10 未形成鳥嘴預備");
  else {
    if (!ma.approach) blockers.push("暖機 MA5/MA10 未形成鳥嘴預備");
    if (!ma.ma5Up) blockers.push("MA5 未向上");
    if (!ma.ma10NotDown) blockers.push("MA10 下彎");
    if (!ma.projectedNear) blockers.push("Projected MA5 未接近/突破 Projected MA10");
  }
  const dataGap = [trialPrice, referencePrice, ratio, futurePrice, futurePct, relativePct, futureVolume].some((x) => x === null) || !futureSymbol;
  const label = blockers.length === 0 ? "盤前觀察｜鳥嘴預備" : dataGap && ma.trajectoryOk ? "DATA_GAP｜鳥嘴預備候選" : "剔除｜鳥嘴預備不足";
  return { time: "08:59", symbol, name: row.name || "", label, trial_price: trialPrice, trial_rise_pct: trialRisePct, bidAskRatio: ratio, best_bid_price: bestBid, future_symbol: futureSymbol, future_price: futurePrice, future_change_percent: futurePct, relative_to_txf_percent: relativePct, future_volume: futureVolume, ma5: ma.ma5, ma10: ma.ma10, projected_ma5: ma.projectedMa5, projected_ma10: ma.projectedMa10, blockers, uses_0900_data: false, formal_candidate: false, order_allowed: false };
}

async function main() {
  const startedAt = new Date().toISOString();
  const date = value("--date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date YYYY-MM-DD is required");
  const includeFailed = flag("--include-failed");
  const requested = symbolsArg();
  const discovered = await discoverRows(date, value("--input"), requested);
  const sourceRows = discovered.rows;
  const readbackMeta = discovered.meta;
  const rows = sourceRows.map((row) => evaluate(row, date));
  const visible = rows.filter((row) => includeFailed || row.label !== "剔除｜鳥嘴預備不足").slice(0, Math.max(1, Number(value("--show", "20"))));
  const outDir = path.resolve(value("--output-dir", path.join(ROOT, "outputs")));
  fs.mkdirSync(outDir, { recursive: true });
  const cutoffMs = Date.parse(`${date}T08:59:59+08:00`);
  visible.forEach((row) => {
    const source = sourceRows.find((item) => String(item.symbol || item.code || "") === row.symbol) || {};
    row.warmup_bars = (source.warmup_bars || source.minute_bars || source.bars || []).filter((bar) => {
      const time = Date.parse(bar.time || bar.timestamp || bar.datetime || "");
      return Number.isFinite(time) && time <= cutoffMs;
    }).length;
  });
  const columns = ["time","symbol","name","label","trial_price","trial_rise_pct","bidAskRatio","best_bid_price","future_symbol","future_price","future_change_percent","relative_to_txf_percent","future_volume","ma5","ma10","projected_ma5","projected_ma10","warmup_bars","blockers"];
  const csv = [columns.join(","), ...visible.map((row) => columns.map((c) => csvCell(c === "blockers" ? row.blockers.join("；") : row[c])).join(","))].join("\r\n") + "\r\n";
  const txt = visible.map((row) => [`${row.time} ${row.symbol} ${row.name} ${row.label}`, `試撮價=${row.trial_price ?? "-"} 試撮漲幅=${row.trial_rise_pct ?? "-"}% bidAskRatio=${row.bidAskRatio ?? "-"} best_bid=${row.best_bid_price ?? "-"}`, `期貨=${row.future_symbol || "-"} 期貨價=${row.future_price ?? "-"} 漲幅=${row.future_change_percent ?? "-"}% 相對TXF=${row.relative_to_txf_percent ?? "-"}% 期貨量=${row.future_volume ?? "-"}`, `MA5=${row.ma5 ?? "-"} MA10=${row.ma10 ?? "-"} ProjectedMA5=${row.projected_ma5 ?? "-"} ProjectedMA10=${row.projected_ma10 ?? "-"}`, `阻擋原因：${row.blockers.length ? row.blockers.join("、") : "無"}`, ""].join("\n")).join("\n");
  const txtPath = path.join(outDir, `preopen-birdmouth-prep-${compact(date)}.txt`);
  const csvPath = path.join(outDir, `preopen-birdmouth-prep-${compact(date)}.csv`);
  fs.writeFileSync(txtPath, txt, "utf8"); fs.writeFileSync(csvPath, csv, "utf8");
  const isSnapshot = (row) => row.preopen_snapshot_used === true || String(row.source_kind || "").toLowerCase() === "snapshot";
  const historyRows = sourceRows.filter((row) => !isSnapshot(row) && pick(row, ["trial_price", "trialPrice", "reference_price", "referencePrice", "bid_ask_ratio", "bidAskRatio"]) !== null);
  const historyTimes = historyRows.map((row) => pick(row, ["observed_at", "updated_at", "time", "timestamp"])).filter(Boolean).filter((time) => Date.parse(time) <= cutoffMs).sort();
  const warmupRows = sourceRows.reduce((sum, row) => sum + (row.warmup_bars || row.minute_bars || row.bars || []).filter((bar) => Date.parse(bar.time || bar.timestamp || bar.datetime || "") <= Date.parse(`${date}T08:59:59+08:00`)).length, 0);
  const preopenRows = historyRows.length;
  const futoptRows = sourceRows.filter((row) => pick(row, ["future_symbol", "futureSymbol", "future_price", "futurePrice", "futopt_last_price"]) !== null).length;
  const quoteRows = sourceRows.filter((row) => pick(row, ["trial_price", "trialPrice", "best_bid_price", "bestBidPrice", "reference_price", "referencePrice"]) !== null).length;
  const passedCount = rows.filter((row) => row.label === "盤前觀察｜鳥嘴預備").length;
  const datagapCount = rows.filter((row) => row.label === "DATA_GAP｜鳥嘴預備候選").length;
  const failedCount = rows.filter((row) => row.label === "剔除｜鳥嘴預備不足").length;
  const snapshotRows = sourceRows.filter(isSnapshot);
  const snapshotTimes = snapshotRows.map((row) => pick(row, ["observed_at", "updated_at", "time", "timestamp"])).filter(Boolean).sort();
  const effectiveHistoryRows = readbackMeta?.historyRows ?? preopenRows;
  const effectiveSnapshotRows = readbackMeta?.snapshotRows ?? snapshotRows.length;
  const effectiveFutoptRows = readbackMeta?.futureRows ?? futoptRows;
  const effectiveWarmupRows = readbackMeta?.warmupRows ?? warmupRows;
  const receipt = { contract: "preopen-birdmouth-prep-readonly-v2", status: "complete", ok: true, trade_date: date, started_at: startedAt, finished_at: new Date().toISOString(), mode: requested.length ? "symbols" : "full_market", requested_symbols: requested, evaluated_count: rows.length, output_count: visible.length, include_failed: includeFailed, readback_mode: value("--input") ? "local_fixture" : "supabase_read_only", preopen_history_source_table: "fugle_preopen_snapshot_history", preopen_history_rows: effectiveHistoryRows, preopen_history_latest_time: readbackMeta?.historyLatest ?? historyTimes.at(-1) ?? null, preopen_history_trade_date: effectiveHistoryRows ? date : null, preopen_snapshot_source_table: "fugle_preopen_snapshot", preopen_snapshot_rows: effectiveSnapshotRows, preopen_snapshot_latest_time: readbackMeta?.snapshotLatest ?? snapshotTimes.at(-1) ?? null, preopen_snapshot_trade_date: effectiveSnapshotRows ? date : null, preopen_snapshot_used: effectiveSnapshotRows > 0 && effectiveHistoryRows === 0, futopt_source_table: "v_stock_future_live_contract", futopt_rows: effectiveFutoptRows, futopt_latest_time: readbackMeta?.futureLatest ?? null, futopt_trade_date: effectiveFutoptRows ? date : null, quote_source_table: effectiveHistoryRows ? "fugle_preopen_snapshot_history" : "fugle_preopen_snapshot", quote_rows: effectiveHistoryRows || effectiveSnapshotRows, quote_latest_time: readbackMeta ? (readbackMeta.historyLatest || readbackMeta.snapshotLatest) : ([...historyTimes, ...snapshotTimes].sort().at(-1) || null), quote_trade_date: (effectiveHistoryRows || effectiveSnapshotRows) ? date : null, warmup_1m_source_table: "fugle_daytrade_intraday_1m", warmup_1m_rows: effectiveWarmupRows, warmup_1m_latest_time: readbackMeta?.warmupLatest ?? null, warmup_1m_cutoff_time: `${date}T08:59:59+08:00`, checked_symbols: rows.length, candidate_symbols: passedCount + datagapCount, passed_count: passedCount, datagap_count: datagapCount, failed_count: failedCount, top_failed_with_blockers: rows.filter((row) => row.blockers.length).slice(0, 20).map((row) => ({ symbol: row.symbol, name: row.name, blockers: row.blockers })), uses_0900_data: false, writes_supabase: false, calls_fugle: false, formal_candidate: false, order_allowed: false, replay_limitation: effectiveHistoryRows > 0 ? null : (effectiveSnapshotRows ? "盤後只能 snapshot 回看，不是完整 08:45-08:59 replay" : "無完整 08:45-08:59 preopen history replay"), txt_path: txtPath, csv_path: csvPath, json_path: "", rows: visible };
  const receiptPath = path.join(outDir, `preopen-birdmouth-prep-receipt-${compact(date)}.json`);
  receipt.json_path = receiptPath;
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ...receipt, rows: visible.slice(0, 3), receipt_path: receiptPath }, null, 2));
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, status: "failed", error: error.message }, null, 2)); process.exit(1); });
