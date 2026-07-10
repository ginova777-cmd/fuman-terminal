"use strict";

const { buildMarketCalendarContract } = require("../lib/market-calendar-contract");

function originFrom(request) {
  const host = request.headers["x-forwarded-host"] || request.headers.host || "fuman-terminal.vercel.app";
  const proto = request.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

function dateFromRequest(request) {
  const url = new URL(request.url || "/api/market-calendar", originFrom(request));
  const date = String(request.query?.date || request.query?.marketDate || url.searchParams.get("date") || url.searchParams.get("marketDate") || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Date(`${date}T12:00:00+08:00`);
  return new Date();
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const previousTradingDate = String(request.query?.previousTradingDate || "").trim();
    const payload = await buildMarketCalendarContract({ now: dateFromRequest(request), previousTradingDate });
    if (request.method === "HEAD") response.status(200).end("");
    else response.status(200).json(payload);
  } catch (error) {
    response.status(503).json({
      ok: false,
      error: "market_calendar_unavailable",
      reason: error?.message || String(error),
      checkedAt: new Date().toISOString(),
    });
  }
};
