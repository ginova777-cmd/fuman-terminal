"use strict";

const VOLUME_UNIT_SOURCE = "fugle_intraday_candles_volume_contract_v1";

function resolveVolumeUnit(metadata) {
  const type = String(metadata?.type || "").trim().toUpperCase();
  const market = String(metadata?.market || "").trim().toUpperCase();
  let unit = null;
  if (type === "INDEX") unit = "currency_amount";
  else if (type === "ODDLOT") unit = "shares";
  else if (type === "EQUITY" && market === "ESB") unit = "shares";
  else if (type === "EQUITY" && ["TSE", "OTC", "TIB"].includes(market)) unit = "lots";

  return {
    instrument_type: type || null,
    market: market || null,
    volume_unit: unit,
    volume_unit_source: unit ? VOLUME_UNIT_SOURCE : null,
    volume_available: unit !== null,
  };
}

module.exports = { VOLUME_UNIT_SOURCE, resolveVolumeUnit };
