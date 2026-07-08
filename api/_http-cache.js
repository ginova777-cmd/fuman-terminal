function header(req, name) {
  const headers = req?.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

function weakEtag(payload, prefix = "fuman") {
  const source = typeof payload === "string" ? payload : JSON.stringify({
    ok: payload?.ok,
    updatedAt: payload?.updatedAt || payload?.generatedAt || payload?.finishedAt || "",
    runId: payload?.runId || payload?.transport?.runId || "",
    count: payload?.count || payload?.matches?.length || payload?.rows?.length || 0,
    date: payload?.usedDate || payload?.scanStamp || payload?.date || payload?.tradeDate || "",
  });
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
  return `W/"${prefix}-${Math.abs(hash)}-${source.length}"`;
}

function cleanLimit(value, fallback = 80) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(1, Math.min(500, Math.floor(number)));
}

function wantsTopPayload(req) {
  const query = req?.query || {};
  return query.top === "1" || query.top === "true" || query.shape === "top" || query.summary === "1";
}

function wantsCompactPayload(req) {
  const query = req?.query || {};
  return query.compact === "1" || query.compact === "true" || query.shape === "compact";
}

function topArray(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : value;
}

function compactRow(row) {
  if (!row || typeof row !== "object") return row;
  const source = row.payload && typeof row.payload === "object" ? { ...row.payload, ...row } : row;
  const pick = {};
  const keys = [
    "code",
    "name",
    "underlyingCode",
    "underlyingName",
    "close",
    "price",
    "percent",
    "changePercent",
    "change_percent",
    "value",
    "tradeValue",
    "trade_value",
    "volume",
    "tradeVolume",
    "warrantCode",
    "warrantName",
    "thirtyMinuteVolume",
    "floatingUnits",
    "volumeMultiple",
    "score",
    "finalScore",
    "rank",
    "reason",
    "tags",
    "signals",
    "matches",
    "side",
    "resultType",
    "result_type",
    "foreign",
    "trust",
    "dealer",
    "total",
    "foreign_net",
    "trust_net",
    "dealer_net",
    "total_net",
  ];
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") pick[key] = source[key];
  }
  return pick;
}

function compactRows(value) {
  return Array.isArray(value) ? value.map(compactRow) : value;
}

function compactHeatmapSector(sector, limit) {
  if (!sector || typeof sector !== "object") return sector;
  const shaped = {};
  const keys = [
    "name",
    "count",
    "up",
    "down",
    "flat",
    "pct",
    "avgPct",
    "breadthPct",
    "leader",
    "leaderCode",
    "amountYi",
    "totalValue",
  ];
  for (const key of keys) {
    if (sector[key] !== undefined && sector[key] !== null && sector[key] !== "") shaped[key] = sector[key];
  }
  if (Array.isArray(sector.stocks)) {
    shaped.stocksTotal = sector.stocks.length;
    shaped.stocks = compactRows(topArray(sector.stocks, Math.min(limit, 12)));
  }
  return shaped;
}

function shapeTopPayload(req, payload) {
  const compact = wantsCompactPayload(req);
  if ((!wantsTopPayload(req) && !compact) || !payload || typeof payload !== "object") return payload;
  const limit = cleanLimit(req?.query?.limit || req?.query?.topLimit, 80);
  const shaped = { ...payload };
  const arrayKeys = [
    "rows",
    "matches",
    "volumeMatches",
    "singleSignals",
    "stocks",
    "priorityStocks",
    "observationStocks",
    "riskStocks",
    "data",
  ];
  for (const key of arrayKeys) {
    if (Array.isArray(payload[key])) {
      const totalKey = `${key}Total`;
      if (payload[totalKey] === undefined) shaped[totalKey] = payload[key].length;
      shaped[key] = compactRows(topArray(payload[key], limit));
    }
  }
  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    const entries = Object.entries(payload.data);
    shaped.dataTotal = entries.length;
    if (Array.isArray(shaped.rows)) {
      const allowed = new Set(shaped.rows.map((row) => String(row?.code || row?.Code || "").trim()).filter(Boolean));
      shaped.data = Object.fromEntries(entries.filter(([code]) => allowed.has(String(code))).map(([code, row]) => [code, compact ? compactRow(row) : row]));
    } else {
      shaped.data = Object.fromEntries(entries.slice(0, limit).map(([code, row]) => [code, compact ? compactRow(row) : row]));
    }
  }
  if (Array.isArray(payload.sectors)) {
    shaped.sectorsTotal = payload.sectors.length;
    shaped.sectors = payload.sectors.map((sector) => compactHeatmapSector(sector, limit));
  }
  if (Array.isArray(payload.industryMaster)) {
    shaped.industryMasterTotal = payload.industryMaster.length;
    shaped.industryMaster = compactRows(topArray(payload.industryMaster, limit));
  }
  if (payload.count === undefined && Array.isArray(payload.matches)) shaped.count = payload.matches.length;
  if (payload.count === undefined && Array.isArray(payload.rows)) shaped.count = payload.rows.length;
  if (payload.volumeCount === undefined && Array.isArray(payload.volumeMatches)) shaped.volumeCount = payload.volumeMatches.length;
  if (payload.singleSignalCount === undefined && Array.isArray(payload.singleSignals)) shaped.singleSignalCount = payload.singleSignals.length;
  shaped.shape = compact ? "compact" : "top";
  shaped.limit = limit;
  return shaped;
}

function sendJson(req, res, payload, prefix = "fuman") {
  const shapedPayload = shapeTopPayload(req, payload);
  const etag = weakEtag(shapedPayload, prefix);
  if (shapedPayload !== payload) res.setHeader("X-Fuman-Payload-Shape", "top");
  res.setHeader("ETag", etag);
  if (header(req, "if-none-match") === etag && typeof res.end === "function") {
    res.status(304).end();
    return;
  }
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 200).json(shapedPayload);
}

module.exports = { sendJson, weakEtag, shapeTopPayload };
