"use strict";

const { fetchMainForceCosts, normalizeAsOfDate, normalizeCodes } = require("../lib/terminal-main-force-costs");

module.exports = async (request, response) => {
  if (request.method && request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  const codes = normalizeCodes(request.query?.codes || request.query?.code);
  if (!codes.length) {
    response.status(400).json({ ok: false, error: "invalid_stock_codes" });
    return;
  }
  const asOfDate = normalizeAsOfDate(request.query?.asOf || request.query?.as_of);
  try {
    const result = await fetchMainForceCosts({ codes, asOf: asOfDate });
    response.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=120");
    response.status(200).json({
      ok: true,
      contract: "terminal-main-force-costs-v1",
      freshnessRule: "exact_as_of_trade_date_only; missing_or_unclassified_never_uses_stale_data",
      ...result,
    });
  } catch (error) {
    response.status(502).json({
      ok: false,
      error: error?.code || "main_force_cost_fetch_failed",
      detail: String(error?.detail || error?.message || error).slice(0, 160),
    });
  }
};