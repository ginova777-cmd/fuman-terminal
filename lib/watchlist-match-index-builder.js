"use strict";

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function signalText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return String(value.label || value.name || value.title || value.short || value.reason || value.id || "").trim();
}

const SOURCES = [
  { key: "openBuy", label: "策略1-明日開盤入", endpoint: "/api/open-buy-latest", fields: ["matches"] },
  { key: "strategy3", label: "策略3-隔日沖", endpoint: "/api/strategy3-latest", fields: ["matches", "rows"] },
  { key: "strategy4", label: "策略4-波段", endpoint: "/api/strategy4-latest", fields: ["matches", "rows"] },
  { key: "strategy5", label: "策略5-綜合策略", endpoint: "/api/strategy5-latest", fields: ["matches", "rows"] },
  { key: "institution", label: "買賣超", endpoint: "/api/institution-latest", fields: ["data", "rows", "matches"], objectFields: ["data"] },
  { key: "warrant", label: "權證", endpoint: "/api/warrant-flow-latest", fields: ["matches", "rows", "volumeMatches", "singleSignals"], codeField: "underlyingCode" },
  { key: "cb", label: "CB名單", endpoint: "/api/cb-detect-latest", fields: ["rows", "matches"] },
];

function findEndpointPayload(endpoints, source) {
  const entries = Object.entries(endpoints || {});
  const exact = entries.find(([key]) => key.startsWith(source.endpoint));
  return exact?.[1] && typeof exact[1] === "object" ? exact[1] : null;
}

function rowsFromPayload(payload, source) {
  return source.fields.flatMap((field) => {
    const value = payload?.[field];
    if (source.objectFields?.includes(field) && value && typeof value === "object" && !Array.isArray(value)) {
      return Object.values(value);
    }
    return normalizeArray(value);
  }).filter((row) => {
    const codeField = source.codeField || "code";
    return row?.[codeField] || row?.code;
  });
}

function detailsFor(row, key) {
  const sources = {
    openBuy: [row.setup, row.status, row.reason],
    strategy3: [row.setup, row.status, row.reason, ...normalizeArray(row.matches).map(signalText)],
    strategy4: [
      row.strategyLabel,
      row.swingZone ? `分區${row.swingZone}` : "",
      ...normalizeArray(row.signals).map(signalText),
      ...normalizeArray(row.swingSignals).map(signalText),
    ],
    strategy5: [
      signalText(row.activeMatch),
      ...normalizeArray(row.matches).flatMap((match) => [match?.label, match?.short, match?.title, match?.name, match?.id].map(signalText)),
    ],
    institution: [
      row.total > 0 ? "法人合計買超" : row.total < 0 ? "法人合計賣超" : "法人中性",
      row.foreign > 0 ? "外資買超" : row.foreign < 0 ? "外資賣超" : "",
      row.trust > 0 ? "投信買超" : row.trust < 0 ? "投信賣超" : "",
      row.jointStreak ? `連買${row.jointStreak}日` : "",
    ],
    warrant: [
      row.signalGrade ? `等級${row.signalGrade}` : "",
      row.actionLabel,
      row.stockSetupLabel,
      row.branchLabel,
      row.level ? `Level ${row.level}` : "",
    ],
    cb: [
      row.entryLabel,
      row.tradableLabel,
      row.conversionPriceLabel,
      row.sourceLayer,
      row.cbName,
    ],
  };
  return [...new Set((sources[key] || []).map(signalText).map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 12);
}

function strategy5InternalCount(row, source) {
  if (source.key !== "strategy5") return 0;
  const ids = normalizeArray(row.matches)
    .map((match) => String(match?.id || match?.label || match?.short || match?.title || "").trim())
    .filter(Boolean);
  const activeId = String(row.activeMatch?.id || row.activeMatch?.label || row.activeMatch?.short || "").trim();
  if (activeId) ids.push(activeId);
  return Math.max(1, new Set(ids).size);
}

function buildWatchlistMatchIndex(endpoints, options = {}) {
  const byCode = {};
  const namesByCode = {};
  const quoteByCode = {};
  const strategies = {};
  const warnings = [];

  for (const source of SOURCES) {
    const payload = findEndpointPayload(endpoints, source);
    if (!payload) {
      warnings.push(`${source.key}: endpoint_missing`);
      strategies[source.key] = { label: source.label, api: source.endpoint, count: 0, error: "endpoint_missing" };
      continue;
    }
    const rows = rowsFromPayload(payload, source);
    const date = payload.usedDate || payload.date || payload.tradeDate || payload.scanStamp || payload.updatedAt || "";
    strategies[source.key] = {
      label: source.label,
      api: source.endpoint,
      date,
      updatedAt: payload.updatedAt || payload.generatedAt || payload.scanStamp || "",
      cacheSource: payload.cacheSource || payload.source || "",
      count: rows.length,
    };
    for (const row of rows) {
      const code = String(row?.[source.codeField || "code"] || row.code || "").trim();
      if (!/^\d{4}$/.test(code)) continue;
      const name = String(row?.name || row?.stockName || row?.underlyingName || "").trim();
      if (name && !namesByCode[code]) namesByCode[code] = name;
      const quote = {
        close: cleanNumber(row.close || row.price || row.lastPrice || row.referencePrice),
        price: cleanNumber(row.price || row.close || row.lastPrice || row.referencePrice),
        percent: cleanNumber(row.percent ?? row.changePercent ?? row.change_percent),
        volume: cleanNumber(row.volume || row.tradeVolume || row.trade_volume),
        tradeVolume: cleanNumber(row.tradeVolume || row.volume || row.trade_volume),
        value: cleanNumber(row.value || row.tradeValue || row.trade_value),
        tradeValue: cleanNumber(row.tradeValue || row.value || row.trade_value),
        market: String(row.market || row.exchange || "").trim(),
        updatedAt: payload.updatedAt || payload.generatedAt || payload.scanStamp || row.updatedAt || "",
      };
      if (!quoteByCode[code] || quote.value > cleanNumber(quoteByCode[code].value) || quote.close > 0 && cleanNumber(quoteByCode[code].close) <= 0) {
        quoteByCode[code] = quote;
      }
      const rawScore = cleanNumber(row.score || row.maxScore || row.swingScore || row.finalScore || row.total);
      const entry = {
        key: source.key,
        label: source.label,
        score: 1 + Math.max(0, Math.min(100, rawScore)) / 1000,
        rawScore,
        internalCount: strategy5InternalCount(row, source),
        date,
        updatedAt: payload.updatedAt || payload.generatedAt || payload.scanStamp || row.updatedAt || "",
        details: detailsFor(row, source.key),
      };
      if (!byCode[code]) byCode[code] = [];
      byCode[code].push(entry);
    }
  }

  for (const [code, entries] of Object.entries(byCode)) {
    const merged = new Map();
    for (const entry of entries) {
      const previous = merged.get(entry.key);
      if (!previous) {
        merged.set(entry.key, { ...entry, details: [...entry.details] });
        continue;
      }
      previous.score = Math.max(cleanNumber(previous.score), cleanNumber(entry.score));
      previous.internalCount = Math.max(cleanNumber(previous.internalCount), cleanNumber(entry.internalCount));
      previous.details = [...new Set([...previous.details, ...entry.details])].slice(0, 12);
      previous.updatedAt = previous.updatedAt || entry.updatedAt;
      previous.date = previous.date || entry.date;
    }
    byCode[code] = [...merged.values()].sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score) || a.key.localeCompare(b.key));
  }

  const updatedAt = options.updatedAt || new Date().toISOString();
  const runId = `watchlist-match-index-${updatedAt.replace(/\D/g, "").slice(0, 14)}`;
  return {
    ok: true,
    source: "watchlist-match-index",
    cacheSource: options.cacheSource || "desktop-route-snapshot-build",
    runId,
    updatedAt,
    count: Object.keys(byCode).length,
    warnings,
    strategies,
    namesByCode,
    quoteByCode,
    byCode,
    transport: {
      source: options.cacheSource || "desktop-route-snapshot-build",
      via: options.via || "lib/watchlist-match-index-builder",
      fetchedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  buildWatchlistMatchIndex,
};
