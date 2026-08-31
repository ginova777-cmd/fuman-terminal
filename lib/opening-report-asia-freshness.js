"use strict";

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function isAsiaEarlySessionTicker(symbol) {
  return /\.(?:T|KS)$/i.test(String(symbol || ""));
}

function asiaWindow(tradeDate) {
  const compact = compactDate(tradeDate);
  const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  return {
    start: Date.parse(`${iso}T08:00:00+08:00`),
    cutoff: Date.parse(`${iso}T08:20:00+08:00`),
  };
}

function assessLeaderFreshness(leader, tradeDate) {
  const symbol = String(leader?.yahoo_symbol || leader?.ticker || "");
  if (!isAsiaEarlySessionTicker(symbol)) {
    return { required: false, fresh: true, reason_code: "non_asia_early_session_symbol" };
  }
  const sourceTime = leader?.selected_time || leader?.source_time || "";
  const sourceMs = Date.parse(sourceTime);
  const window = asiaWindow(tradeDate);
  if (!Number.isFinite(sourceMs)) {
    return { required: true, fresh: false, reason_code: "asia_source_time_missing", source_time: sourceTime };
  }
  if (sourceMs < window.start || sourceMs > window.cutoff) {
    return {
      required: true,
      fresh: false,
      reason_code: "asia_source_stale_or_outside_0800_0820_window",
      source_time: sourceTime,
      window_start: new Date(window.start).toISOString(),
      window_cutoff: new Date(window.cutoff).toISOString(),
    };
  }
  return {
    required: true,
    fresh: true,
    reason_code: "asia_source_in_0800_0820_window",
    source_time: sourceTime,
    window_start: new Date(window.start).toISOString(),
    window_cutoff: new Date(window.cutoff).toISOString(),
  };
}

function applyLeaderFreshness(leader, tradeDate) {
  const freshness = assessLeaderFreshness(leader, tradeDate);
  if (freshness.fresh) return { ...leader, source_freshness: freshness };
  return {
    ...leader,
    ok: false,
    percent: null,
    direction: "unknown",
    display: "資料不足",
    close: null,
    previous_close: null,
    reason_code: freshness.reason_code,
    source_gap: true,
    source_freshness: freshness,
  };
}

function summarizeReceiptFreshness(receipt, tradeDate) {
  const leaders = (Array.isArray(receipt?.industries) ? receipt.industries : []).flatMap((industry) => industry?.leaders || []);
  const stalePromoted = leaders.filter((leader) => {
    const freshness = assessLeaderFreshness(leader, tradeDate);
    return freshness.required && !freshness.fresh && leader?.ok === true;
  });
  const gaps = leaders.filter((leader) => leader?.source_gap === true || (!leader?.ok && assessLeaderFreshness(leader, tradeDate).required));
  return {
    total_leaders: leaders.length,
    stale_promoted_count: stalePromoted.length,
    source_gap_count: gaps.length,
    stale_promoted: stalePromoted.map((leader) => ({ name: leader.name || "", yahoo_symbol: leader.yahoo_symbol || "", source_time: leader.selected_time || leader.source_time || "" })),
  };
}

module.exports = {
  applyLeaderFreshness,
  assessLeaderFreshness,
  isAsiaEarlySessionTicker,
  summarizeReceiptFreshness,
};
