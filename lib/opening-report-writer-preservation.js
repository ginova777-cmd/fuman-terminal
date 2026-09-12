"use strict";

// Keep morning evidence alongside normal rows; never grant trading eligibility.
function preserveMorningWatchRows(rows, seeds, tradeDate, updatedAt, deepScanMax) {
  const bySymbol = new Map(rows.map(row => [row.symbol, row]));
  for (const seed of seeds) {
    const evidence = seed.openingReport0830IndustryBias;
    if (!evidence || evidence.date !== tradeDate || evidence.formal_candidate_allowed !== false || evidence.forbidden_publish_guard !== true) continue;
    let row = bySymbol.get(seed.symbol);
    if (!row) {
      const rank = Math.max(deepScanMax + 1, rows.length + 1);
      row = {symbol:seed.symbol,name:seed.name || seed.symbol,market:seed.market || "TW",priority_rank:rank,
        priority_reason:"opening_report_0830_industry_bias",source:"opening_report_0830",updated_at:updatedAt,
        payload:{trade_date:tradeDate,pool_layer:"morning_watch_only",canonical_pool_layer:"morning_watch_only",
          priority_rank:rank,deep_scan_eligible:false,candles_priority_required:false,formal_pool_eligible:false,
          is_daytrade_allowed:false,basePoolEligible:false,motherPoolCandidate:false,formal_candidate:false,
          formal_candidate_allowed:false,forbidden_publish_guard:true,watchlist_only:true,
          expires_at:`${tradeDate}T13:30:00+08:00`}};
      rows.push(row); bySymbol.set(seed.symbol,row);
    }
    row.payload = {...row.payload, openingReport0830IndustryBias:evidence,
      opening_report_0830_source:"opening_report_0830",opening_report_0830_priority_reason:"opening_report_0830_industry_bias"};
  }
  return rows;
}
module.exports={preserveMorningWatchRows};
