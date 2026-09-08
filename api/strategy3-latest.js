"use strict";

const { withEntitlementRequired } = require("../lib/server-entitlement-guard");
const { buildMarketCalendarContract, installMarketCalendarResponse } = require("../lib/market-calendar-contract");

const STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS = Number(
  process.env.STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS
    || process.env.FUMAN_STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS
    || 2500
);

const strategy3V2Latest = require("./strategy3-v2-latest.js");

async function strategy3LatestWithEvidence(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  const marketCalendar = await buildMarketCalendarContract().catch(() => null);
  installMarketCalendarResponse(response, marketCalendar);
  const result = await strategy3V2Latest(request, response);
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  return result;
};

const protectedStrategy3Latest = withEntitlementRequired(strategy3LatestWithEvidence, "strategy3");
protectedStrategy3Latest.STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS = STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS;
module.exports = protectedStrategy3Latest;
