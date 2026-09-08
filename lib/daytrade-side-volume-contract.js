"use strict";

const SOURCE_NAME = "fugle_daytrade_source";
const SIDE_VOLUME_UNIT = "lots";
const SIDE_VOLUME_THRESHOLD_LOTS = 2000;
const SIDE_VOLUME_SOURCE = "fugle_quote.total.tradeVolumeAtBid+tradeVolumeAtAsk";
const SIDE_VOLUME_DEFINITION = "same_day_cumulative_executed_regular_board_lots_classified_at_bid_or_ask";

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function firstNumberOrNull(...values) {
  for (const value of values) {
    const parsed = numberOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value).trim();
  if (/^\d{10,17}$/.test(text)) {
    const raw = Number(text);
    if (Number.isFinite(raw) && raw > 0) {
      const milliseconds = raw > 1e15 ? raw / 1000 : raw > 1e12 ? raw : raw > 1e10 ? raw : raw * 1000;
      const parsedNumeric = new Date(milliseconds);
      if (Number.isFinite(parsedNumeric.getTime())) return parsedNumeric.toISOString();
    }
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function taipeiDateFrom(value = new Date()) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function canonicalRunId(tradeDate, sourceName = SOURCE_NAME) {
  const compact = String(tradeDate || "").replace(/\D/g, "").slice(0, 8);
  return compact.length === 8 ? `${sourceName}:${compact}:canonical` : "";
}

function ageSeconds(value, now = new Date()) {
  const timestamp = Date.parse(String(value || ""));
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now || ""));
  return Number.isFinite(timestamp) && Number.isFinite(nowMs)
    ? Math.max(0, Math.floor((nowMs - timestamp) / 1000))
    : null;
}

function normalizeUnit(value) {
  const unit = String(value || "").trim().toLowerCase();
  if (["lot", "lots", "張"].includes(unit)) return SIDE_VOLUME_UNIT;
  if (["share", "shares", "股"].includes(unit)) return "shares";
  return "";
}

function deriveDaytradeSideVolumeContract(options = {}) {
  const quote = options.quote && typeof options.quote === "object" ? options.quote : {};
  const payload = options.payload && typeof options.payload === "object"
    ? options.payload
    : (quote.payload && typeof quote.payload === "object" ? quote.payload : {});
  const raw = payload.raw && typeof payload.raw === "object" ? payload.raw : {};
  const rawTotal = raw.total && typeof raw.total === "object" ? raw.total : {};
  const payloadTotal = payload.total && typeof payload.total === "object" ? payload.total : {};
  const expectedTradeDate = String(options.expectedTradeDate || taipeiDateFrom(new Date())).slice(0, 10);
  const sourceName = String(options.sourceName || SOURCE_NAME);

  // Bid/ask cumulative volume is an independent Fugle field. Never substitute
  // total_volume when either side is missing.
  const insideVolume = firstNumberOrNull(
    quote.cumulative_bid_volume,
    payload.cumulativeBidVolume,
    payload.cumulative_bid_volume,
    payloadTotal.tradeVolumeAtBid,
    rawTotal.tradeVolumeAtBid,
  );
  const outsideVolume = firstNumberOrNull(
    quote.cumulative_ask_volume,
    payload.cumulativeAskVolume,
    payload.cumulative_ask_volume,
    payloadTotal.tradeVolumeAtAsk,
    rawTotal.tradeVolumeAtAsk,
  );
  const reportedSideTotal = firstNumberOrNull(
    quote.cumulative_bid_ask_volume,
    payload.cumulativeBidAskVolume,
    payload.cumulative_bid_ask_volume,
  );
  const totalVolume = firstNumberOrNull(
    quote.total_volume,
    quote.trade_volume,
    payload.totalVolume,
    payload.tradeVolume,
    payloadTotal.tradeVolume,
    rawTotal.tradeVolume,
  );
  const sourceEventAt = normalizeTimestamp(firstText(
    payload.sideVolumeSourceEventAt,
    payload.side_volume_source_event_at,
    payload.aggregate_last_updated,
    payload.aggregateLastUpdated,
    raw.aggregateLastUpdated,
    raw.lastUpdated,
    payloadTotal.time,
    rawTotal.time,
    quote.last_trade_time,
    quote.quote_seen_at,
  ));
  const sourceTradeDate = firstText(
    sourceEventAt ? taipeiDateFrom(sourceEventAt) : "",
    payload.sideVolumeTradeDate,
    payload.side_volume_trade_date,
    payload.date,
    raw.date,
  ).slice(0, 10);
  const explicitUnit = normalizeUnit(firstText(
    payload.sideVolumeUnit,
    payload.side_volume_unit,
    payload.volume_unit,
    raw.volume_unit,
  ));
  // fugle_daytrade_quotes_live is regular-board-lot stock water. Fugle's
  // regular quote tradeVolumeAtBid/AtAsk fields are already expressed in lots.
  const unit = explicitUnit || SIDE_VOLUME_UNIT;
  const sideVolumePresent = insideVolume !== null && outsideVolume !== null;
  const sideVolumeTotal = sideVolumePresent ? insideVolume + outsideVolume : null;
  const sourceCanonicalRunId = canonicalRunId(sourceTradeDate, sourceName);
  const expectedCanonicalRunId = canonicalRunId(expectedTradeDate, sourceName);
  const sideVolumeSameTradeDate = Boolean(sourceTradeDate) && sourceTradeDate === expectedTradeDate;
  const sideVolumeSameCanonicalRun = Boolean(sourceCanonicalRunId) && sourceCanonicalRunId === expectedCanonicalRunId;
  const sideVolumeAvailable = sideVolumePresent
    && unit === SIDE_VOLUME_UNIT
    && Boolean(sourceEventAt)
    && sideVolumeSameTradeDate
    && sideVolumeSameCanonicalRun;
  const sideVolumeGe2000Lots = sideVolumeAvailable && sideVolumeTotal >= SIDE_VOLUME_THRESHOLD_LOTS;
  const sourceEventAgeSeconds = ageSeconds(sourceEventAt, options.now || new Date());
  const differenceFromTotal = sideVolumeTotal !== null && totalVolume !== null
    ? totalVolume - sideVolumeTotal
    : null;

  return {
    insideVolume,
    outsideVolume,
    sideVolumeTotal,
    sideVolumeReportedTotal: reportedSideTotal,
    sideVolumeUnit: unit,
    sideVolumeUnitKnown: unit === SIDE_VOLUME_UNIT,
    sideVolumePresent,
    sideVolumeAvailable,
    sideVolumeThresholdLots: SIDE_VOLUME_THRESHOLD_LOTS,
    sideVolumeThresholdMet: sideVolumeGe2000Lots,
    sideVolumeGe2000Lots,
    sideVolumeSource: SIDE_VOLUME_SOURCE,
    sideVolumeSourceEventAt: sourceEventAt,
    sideVolumeSourceEventAgeSeconds: sourceEventAgeSeconds,
    sideVolumeTradeDate: sourceTradeDate,
    sideVolumeCanonicalRunId: sourceCanonicalRunId,
    sideVolumeSameTradeDate,
    sideVolumeSameCanonicalRun,
    sideVolumeDefinition: SIDE_VOLUME_DEFINITION,
    sideVolumeIncludesOddLot: false,
    sideVolumeIncludesOpeningAuctionFirstTrade: false,
    sideVolumeIncludesUnclassifiedTrades: false,
    sideVolumeDifferenceFromTotal: differenceFromTotal,
    sideVolumeDifferenceExplanation: "Fugle excludes the opening auction first trade from bid/ask-side totals; trades without bid/ask-side classification remain outside the two side fields.",
  };
}

module.exports = {
  SIDE_VOLUME_DEFINITION,
  SIDE_VOLUME_SOURCE,
  SIDE_VOLUME_THRESHOLD_LOTS,
  SIDE_VOLUME_UNIT,
  canonicalRunId,
  deriveDaytradeSideVolumeContract,
  normalizeTimestamp,
  taipeiDateFrom,
};
