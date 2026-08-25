"use strict";

const { readSnapshot } = require("../lib/supabase-snapshots");

function taipeiClock(now = new Date()) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).reduce((out, part) => {
    if (part.type !== "literal") out[part.type] = part.value;
    return out;
  }, {});
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    ymd: `${values.year}${values.month}${values.day}`,
  };
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const clock = taipeiClock();
  try {
    const snapshot = await readSnapshot("opening_report_0830_terminal_briefing", {
      tradeDate: clock.date,
      allowLatestFallback: false,
      timeoutMs: Number(process.env.FUMAN_OPENING_REPORT_0830_SNAPSHOT_TIMEOUT_MS || 2000),
    });
    const report = snapshot?.payload;
    const valid = report
      && report.contract === "opening-report-0830-terminal-briefing-v1"
      && compactDate(report.date) === clock.ymd
      && report.ok === true;

    if (!valid) {
      response.status(200).json({
        ok: false,
        openingMorningReport: null,
        trade_date: clock.date,
        reason_code: "opening_report_0830_terminal_briefing_missing_or_invalid",
      });
      return;
    }

    response.status(200).json({
      ok: true,
      openingMorningReport: {
        ...report,
        cacheSource: "supabase:market_snapshots",
        snapshot_updated_at: snapshot.updatedAt || "",
      },
    });
  } catch (error) {
    response.status(200).json({
      ok: false,
      openingMorningReport: null,
      trade_date: clock.date,
      reason_code: "opening_report_0830_terminal_briefing_unavailable",
    });
  }
};
