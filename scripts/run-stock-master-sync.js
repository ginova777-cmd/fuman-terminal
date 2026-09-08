const fs = require("fs");
const path = require("path");
process.env.FUGLE_COLLECTOR_ROLE = process.env.FUGLE_COLLECTOR_ROLE || "daytrade";
const { writeFugleWebSocketSymbols } = require("../lib/fugle-websocket-quotes");
const {
  runtimeRoot,
  writeJson,
  fetchOfficialStockMaster,
  supabaseGetPaged,
  upsertStockTickers,
  buildTickerRows,
} = require("../lib/stock-master-sync");

const dryRun = process.argv.includes("--dry-run");
const quiet = process.argv.includes("--quiet");
const receiptPath = path.join(runtimeRoot(), "data", "scan-receipts", "stock-master-sync-runner.json");
const cachePath = path.join(runtimeRoot(), "cache", "reference", "mops-official-stock-master.json");

function runId() {
  const supplied = process.argv.find((value) => value.startsWith("--run-id="));
  return supplied ? supplied.slice("--run-id=".length) : `stock-master-sync-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
}

async function main() {
  const id = runId();
  const startedAt = new Date().toISOString();
  try {
    const official = await fetchOfficialStockMaster();
    const existing = await supabaseGetPaged("stock_tickers", "symbol,stock_type,is_etf,is_suspended,payload");
    const existingSet = new Set(existing.map((row) => String(row.symbol || "")));
    const missingBefore = official.rows.filter((row) => !existingSet.has(row.symbol)).map((row) => row.symbol);
    const updatedAt = new Date().toISOString();
    const rows = buildTickerRows(official.rows, existing, id, updatedAt);
    const written = dryRun ? 0 : await upsertStockTickers(rows);
    const universe = dryRun ? [] : await supabaseGetPaged(
      "stock_universe",
      "symbol,is_active,is_etf,is_warrant,is_cb,is_blacklisted,is_daytrade_unsuitable",
    );
    const activeUniverseSymbols = universe
      .filter((row) => /^\d{4}$/.test(String(row.symbol || ""))
        && !String(row.symbol).startsWith("00")
        && row.is_active === true
        && row.is_etf !== true
        && row.is_warrant !== true
        && row.is_cb !== true
        && row.is_blacklisted !== true
        && row.is_daytrade_unsuitable !== true)
      .map((row) => String(row.symbol))
      .sort();
    if (!dryRun) {
      writeFugleWebSocketSymbols(activeUniverseSymbols, {
        source: "stock-master-sync-active-universe-bridge",
        prioritySource: "stock-master-sync-active-universe-bridge",
        stockMasterRunId: id,
        stockMasterOfficialRows: official.rows.length,
        activeUniverseCount: activeUniverseSymbols.length,
      });
    }
    const receipt = {
      contract: "stock_master_sync_runner_receipt_v1",
      status: dryRun ? "dry_run" : "complete",
      complete: !dryRun && written === rows.length,
      ok: dryRun || written === rows.length,
      dry_run: dryRun,
      run_id: id,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      source_authority: "MOPS_OPEN_DATA_TWSE_TPEX",
      source_tables: official.sources,
      official_rows: official.rows.length,
      existing_rows_before: existing.length,
      missing_before_count: missingBefore.length,
      missing_before: missingBefore,
      prepared_rows: rows.length,
      written_rows: written,
      stock_universe_readback_rows: universe.length,
      websocket_active_universe_rows: activeUniverseSymbols.length,
      websocket_active_universe_contains_3167: activeUniverseSymbols.includes("3167"),
      websocket_active_universe_contains_4979: activeUniverseSymbols.includes("4979"),
      master_blacklist_filter_applied: false,
      scanner_eligibility_separate_from_master: true,
      receipt_path: receiptPath,
    };
    writeJson(cachePath, { contract: "mops_official_stock_master_cache_v1", updated_at: updatedAt, sources: official.sources, rows: official.rows });
    writeJson(receiptPath, receipt);
    if (!quiet) console.log(JSON.stringify(receipt, null, 2));
    if (!receipt.ok) process.exitCode = 1;
  } catch (error) {
    const receipt = {
      contract: "stock_master_sync_runner_receipt_v1",
      status: "failed",
      complete: false,
      ok: false,
      run_id: runId(),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      error: error?.message || String(error),
      receipt_path: receiptPath,
    };
    try { writeJson(receiptPath, receipt); } catch {}
    console.error(JSON.stringify(receipt, null, 2));
    process.exitCode = 1;
  }
}

main();
