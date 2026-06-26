const fs = require("fs");
const path = require("path");

const MIN_AVG_VOLUME_LOTS_5 = 3000;
const MIN_INNER_OUTER_LOTS = 3000;
const DEFAULT_RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DEFAULT_BLACKLIST_FILE = path.join(DEFAULT_RUNTIME_DIR, "config", "fugle-api-blacklist-symbols.txt");

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function normalizeCode(value) {
  const code = String(value || "").trim();
  return /^\d{4}$/.test(code) ? code : "";
}

function readText(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

function loadChipTradeBlacklist(file = process.env.FUMAN_CHIP_BLACKLIST_FILE || DEFAULT_BLACKLIST_FILE) {
  const codes = new Set();
  readText(file).split(/\r?\n|,/)
    .map((item) => normalizeCode(item))
    .filter(Boolean)
    .forEach((code) => codes.add(code));
  return codes;
}

function flagTrue(value) {
  if (value === true) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "1" || text === "yes" || text === "y";
}

function volumeLots(value, key = "") {
  const n = cleanNumber(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const field = String(key || "").toLowerCase();
  if (/innerouter|insideoutside|accumulated|cumulative/.test(field)) {
    return n >= 100000 ? n / 1000 : n;
  }
  const shareBasedField = /tradevolume|fivedayavgvolume|avg_volume_5|avgvolume5|avg5volume/.test(field);
  if (shareBasedField) return n / 1000;
  return n >= 100000 ? n / 1000 : n;
}

function firstVolumeLots(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && String(row[key]).trim() !== "") {
      return volumeLots(row[key], key);
    }
  }
  return 0;
}

function chipTradeExclusion(row, blacklistCodes = new Set()) {
  const code = normalizeCode(row?.code || row?.symbol || row?.Code || row?.Symbol);
  const name = String(row?.name || row?.Name || "").trim();
  const industry = String(row?.industry || row?.officialIndustry || row?.primaryIndustry || row?.quoteIndustry || "").trim();
  const text = `${code} ${name} ${industry}`;
  const reasons = [];

  if (!code) reasons.push("代號格式不符");
  if (/^00/.test(code)) reasons.push("00開頭/ETF");
  if (blacklistCodes.has(code)) reasons.push("黑名單");
  if (flagTrue(row?.is_etf ?? row?.isEtf)) reasons.push("ETF");
  if (flagTrue(row?.is_warrant ?? row?.isWarrant)) reasons.push("權證");
  if (flagTrue(row?.is_cb ?? row?.isCb)) reasons.push("可轉債");
  if (flagTrue(row?.is_blacklisted ?? row?.isBlacklisted)) reasons.push("黑名單");
  if (flagTrue(row?.is_daytrade_unsuitable ?? row?.isDaytradeUnsuitable)) reasons.push("不適合當沖");
  if (flagTrue(row?.is_halted ?? row?.isHalted ?? row?.is_suspended ?? row?.isSuspended)) reasons.push("停牌/暫停交易");
  if (/(ETF|ETN|DR|指數|台灣50|高股息|正2|反1|期貨|債|權證|認購|認售|牛證|熊證|CB|可轉債)/i.test(text)) {
    reasons.push("ETF/權證/可轉債/非普通股");
  }
  if (/水泥|軍工|國防|航太|漢翔|雷虎|龍德|駐龍|晟田|寶一|亞航|千附/i.test(text)) {
    reasons.push("水泥/軍工");
  }
  if (/^(28|58)/.test(code) || /(金控|銀行|證券|保險|票券|租賃|產險|中租|致和證|統一證|三商壽)/i.test(text)) {
    reasons.push("金融股");
  }
  if (/^(2610|2618|2646|6757)$/.test(code) || /(航空|空運|華航|星宇航空|台灣虎航)/i.test(text)) {
    reasons.push("航空股");
  }

  const avgVolume5 = firstVolumeLots(row, ["fiveDayAvgVolume", "avg_volume_5", "avgVolume5", "avg5Volume"]);
  if (avgVolume5 > 0 && avgVolume5 < MIN_AVG_VOLUME_LOTS_5) reasons.push("近5日均量<3000張");

  const innerOuter = firstVolumeLots(row, ["innerOuterVolume", "insideOutsideVolume", "accumulatedBidAskVolume", "cumulative_bid_ask_volume", "cumulativeBidAskVolume"]);
  const bid = firstVolumeLots(row, ["cumulative_bid_volume", "cumulativeBidVolume"]);
  const ask = firstVolumeLots(row, ["cumulative_ask_volume", "cumulativeAskVolume"]);
  const bidAskTotal = innerOuter || (bid || ask ? bid + ask : 0);
  if (!bidAskTotal) {
    const tradeVolume = firstVolumeLots(row, ["tradeVolume", "volume", "TradeVolume"]);
    if (tradeVolume > 0 && tradeVolume < MIN_INNER_OUTER_LOTS) reasons.push("成交量<3000張");
  }

  return {
    excluded: reasons.length > 0,
    reasons: [...new Set(reasons)],
  };
}

function isChipTradeExcluded(row, blacklistCodes = new Set()) {
  return chipTradeExclusion(row, blacklistCodes).excluded;
}

module.exports = {
  MIN_AVG_VOLUME_LOTS_5,
  MIN_INNER_OUTER_LOTS,
  chipTradeExclusion,
  cleanNumber,
  isChipTradeExcluded,
  loadChipTradeBlacklist,
  normalizeCode,
  volumeLots,
};
