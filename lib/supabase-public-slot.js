"use strict";

const UNAVAILABLE = "supabase public slot module unavailable in this local runtime";

function emptyMapResult(extra = {}) {
  return { ok: false, error: UNAVAILABLE, byCode: new Map(), ...extra };
}

async function fetchActiveCommonStockQuotes() {
  return { ok: false, error: UNAVAILABLE, quotes: [], sourceHealthy: false, sourceAgeSeconds: null };
}

async function fetchDailyVolumeAverages() {
  return emptyMapResult();
}

async function fetchIntraday1m() {
  return { ok: false, error: UNAVAILABLE, rows: [], sourceHealthy: false, sourceAgeSeconds: null };
}

async function fetchIntraday1mStatus() {
  return emptyMapResult();
}

async function fetchQuotesByCodes() {
  return emptyMapResult({ sourceHealthy: false, sourceAgeSeconds: null });
}

async function getStrategy2SourceHealth() {
  return {
    ok: false,
    healthy: false,
    sourceHealthy: false,
    sourceAgeSeconds: null,
    reason: UNAVAILABLE,
    message: UNAVAILABLE,
    status: { status: "missing", checked_at: new Date().toISOString() },
    payload: {},
  };
}

module.exports = {
  fetchActiveCommonStockQuotes,
  fetchDailyVolumeAverages,
  fetchIntraday1m,
  fetchIntraday1mStatus,
  fetchQuotesByCodes,
  getStrategy2SourceHealth,
};
