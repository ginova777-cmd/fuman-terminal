"use strict";

// Retired with Strategy2 V2. The only permitted Strategy2 read path is /api/strategy2-latest.
module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.status(410).json({
    ok: false,
    retired: true,
    error: "strategy2_stream_retired",
    replacement: "/api/strategy2-latest",
    strategyContract: "strategy2-live-v2-fugle-mother-pool-1m",
  });
};