const fs = require("fs");
const path = require("path");
const {
  runtimeRoot,
  writeJson,
  fetchOfficialStockMaster,
  supabaseGetPaged,
  compareOfficialToReadback,
} = require("../lib/stock-master-sync");

const receiptDir = path.join(runtimeRoot(), "data", "scan-receipts");
const runnerReceiptPath = path.join(receiptDir, "stock-master-sync-runner.json");
const canonicalReceiptPath = path.join(receiptDir, "stock-master-sync.json");
const websocketSymbolsPath = path.join(runtimeRoot(), "cache", "intraday", "fugle-daytrade-ws-symbols.json");
const quiet = process.argv.includes("--quiet");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return null; }
}

function addCheck(checks, name, ok, detail) {
  checks.push({ name, ok: ok === true, detail });
}

async function main() {
  const checkedAt = new Date().toISOString();
  const runner = readJson(runnerReceiptPath);
  try {
    const official = await fetchOfficialStockMaster();
    const [tickers, universe] = await Promise.all([
      supabaseGetPaged("stock_tickers", "symbol,name,market,stock_type,industry,type,is_etf,is_suspended,updated_at,payload"),
      supabaseGetPaged("stock_universe", "symbol,name,market,industry,is_active,is_etf,is_warrant,is_cb,is_blacklisted,is_daytrade_unsuitable,payload"),
    ]);
    const compared = compareOfficialToReadback(official.rows, tickers, universe);
    const websocket = readJson(websocketSymbolsPath) || {};
    const websocketSymbols = new Set((Array.isArray(websocket.symbols) ? websocket.symbols : []).map(String));
    const expectedActiveSymbols = universe
      .filter((row) => /^\d{4}$/.test(String(row.symbol || ""))
        && !String(row.symbol).startsWith("00")
        && row.is_active === true
        && row.is_etf !== true
        && row.is_warrant !== true
        && row.is_cb !== true
        && row.is_blacklisted !== true
        && row.is_daytrade_unsuitable !== true)
      .map((row) => String(row.symbol));
    const websocketMissing = expectedActiveSymbols.filter((symbol) => !websocketSymbols.has(symbol));
    const checks = [];
    addCheck(checks, "runner_receipt_complete", runner?.complete === true && runner?.status === "complete", runner?.status || "missing");
    addCheck(checks, "both_official_markets_loaded", official.sources.length === 2 && official.sources.every((source) => source.rows >= 500), official.sources);
    addCheck(checks, "official_master_row_floor", official.rows.length >= 1900, official.rows.length);
    addCheck(checks, "stock_tickers_missing_zero", compared.missingTickers.length === 0, compared.missingTickers.slice(0, 100));
    addCheck(checks, "stock_universe_missing_zero", compared.missingUniverse.length === 0, compared.missingUniverse.slice(0, 100));
    addCheck(checks, "official_names_match", compared.nameMismatch.length === 0, compared.nameMismatch.slice(0, 50));
    addCheck(checks, "official_markets_match", compared.marketMismatch.length === 0, compared.marketMismatch.slice(0, 50));
    addCheck(checks, "official_industries_match", compared.industryMismatch.length === 0, compared.industryMismatch.slice(0, 50));
    addCheck(checks, "websocket_active_universe_bridge_current", websocket.stockMasterRunId === runner?.run_id, {
      expected_run_id: runner?.run_id || null,
      actual_run_id: websocket.stockMasterRunId || null,
      source: websocket.source || null,
    });
    addCheck(checks, "websocket_active_universe_missing_zero", websocketMissing.length === 0, websocketMissing.slice(0, 100));
    addCheck(checks, "3167_master_present", compared.tickerMap.has("3167") && compared.universeMap.has("3167"), {
      ticker: compared.tickerMap.get("3167") || null,
      universe: compared.universeMap.get("3167") || null,
    });
    addCheck(checks, "3167_websocket_universe_present", websocketSymbols.has("3167"), websocketSymbols.has("3167"));
    addCheck(checks, "4979_master_present", compared.tickerMap.has("4979") && compared.universeMap.has("4979"), {
      ticker: compared.tickerMap.get("4979") || null,
      universe: compared.universeMap.get("4979") || null,
    });
    const failed = checks.filter((check) => !check.ok);
    const receipt = {
      contract: "stock_master_sync_canonical_verifier_receipt_v1",
      status: failed.length ? "failed" : "complete",
      complete: failed.length === 0,
      ok: failed.length === 0,
      checked_at: checkedAt,
      runner_run_id: runner?.run_id || null,
      source_authority: "MOPS_OPEN_DATA_TWSE_TPEX",
      official_rows: official.rows.length,
      stock_tickers_rows: tickers.length,
      stock_universe_rows: universe.length,
      missing_stock_tickers_count: compared.missingTickers.length,
      missing_stock_universe_count: compared.missingUniverse.length,
      name_mismatch_count: compared.nameMismatch.length,
      market_mismatch_count: compared.marketMismatch.length,
      industry_mismatch_count: compared.industryMismatch.length,
      websocket_active_universe_rows: expectedActiveSymbols.length,
      websocket_symbols_rows: websocketSymbols.size,
      websocket_missing_active_universe_count: websocketMissing.length,
      websocket_symbols_path: websocketSymbolsPath,
      master_blacklist_filter_applied: false,
      scanner_eligibility_separate_from_master: true,
      checks,
      failed_checks: failed.map((check) => check.name),
      first_blocker: failed[0]?.name || null,
      receipt_path: canonicalReceiptPath,
    };
    writeJson(canonicalReceiptPath, receipt);
    if (!quiet) console.log(JSON.stringify(receipt, null, 2));
    if (!receipt.complete) process.exitCode = 1;
  } catch (error) {
    const receipt = {
      contract: "stock_master_sync_canonical_verifier_receipt_v1",
      status: "failed",
      complete: false,
      ok: false,
      checked_at: checkedAt,
      runner_run_id: runner?.run_id || null,
      first_blocker: "verifier_exception",
      error: error?.message || String(error),
      receipt_path: canonicalReceiptPath,
    };
    try { writeJson(canonicalReceiptPath, receipt); } catch {}
    console.error(JSON.stringify(receipt, null, 2));
    process.exitCode = 1;
  }
}

main();
