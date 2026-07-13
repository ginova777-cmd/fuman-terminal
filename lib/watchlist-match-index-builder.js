"use strict";

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function taipeiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  const seconds = Number(parts.hour || 0) * 3600 + Number(parts.minute || 0) * 60 + Number(parts.second || 0);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    seconds,
  };
}

function isIntradayFreshnessRequired(now = new Date()) {
  const clock = taipeiClock(now);
  return clock.seconds >= (8 * 3600 + 45 * 60) && clock.seconds <= (13 * 3600 + 35 * 60);
}

function signalText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return String(value.label || value.name || value.title || value.short || value.reason || value.id || "").trim();
}

const SOURCES = [
  { key: "openBuy", label: "策略1-明日開盤入", endpoint: "/api/open-buy-latest", fields: ["matches"] },
  { key: "strategy2", label: "策略2-當沖雷達", endpoint: "/api/strategy2-latest", fields: ["events", "records", "matches", "rows"] },
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

function payloadMeta(payload) {
  return payload?.payload && typeof payload.payload === "object" ? payload.payload : payload;
}

function rowsFromPayload(payload, source) {
  const candidates = [payload, payload?.payload].filter((item) => item && typeof item === "object");
  return candidates.flatMap((candidate) => source.fields.flatMap((field) => {
    const value = candidate?.[field];
    if (source.objectFields?.includes(field) && value && typeof value === "object" && !Array.isArray(value)) {
      return Object.values(value);
    }
    return normalizeArray(value);
  })).filter((row) => {
    const codeField = source.codeField || "code";
    return row?.[codeField] || row?.code;
  });
}

function detailsFor(row, key) {
  const sources = {
    openBuy: [row.setup, row.status, row.reason],
    strategy2: [
      row.strategy,
      row.state,
      row.status,
      row.signal,
      row.stateLabel,
      row.stateReason,
      row.reason,
      ...normalizeArray(row.strategies).map(signalText),
      ...normalizeArray(row.intradaySignals).map(signalText),
    ],
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

function hasFallbackMarker(payload, meta) {
  const cacheSource = String(meta?.cacheSource || meta?.source || payload?.cacheSource || payload?.source || "");
  return Boolean(
    payload?.fallbackUsed
    || meta?.fallbackUsed
    || payload?.snapshotFallback
    || meta?.snapshotFallback
    || payload?.transport?.fallbackFromPreviousSnapshot
    || meta?.transport?.fallbackFromPreviousSnapshot
    || /fallback/i.test(cacheSource)
  );
}

function buildSourceEvidence(source, payload, rows, capturedAt) {
  const meta = payloadMeta(payload) || {};
  const fallbackUsed = hasFallbackMarker(payload, meta);
  const cacheSource = String(meta.cacheSource || meta.source || payload?.cacheSource || payload?.source || "");
  const ok = Boolean(payload) && payload?.ok !== false && meta?.ok !== false;
  const count = rows.length;
  const status = !payload
    ? "missing"
    : !ok
      ? "degraded"
      : fallbackUsed
        ? "fallback"
        : "ready";
  const reason = !payload
    ? "endpoint_missing"
    : !ok
      ? String(payload?.error || meta?.error || payload?.reason || meta?.reason || "source_not_ok")
      : fallbackUsed
        ? String(payload?.snapshotFallbackReason || meta?.snapshotFallbackReason || payload?.reason || meta?.reason || "fallback_used")
        : "source_ready_at_snapshot_build";
  return {
    api: source.endpoint,
    status,
    ok,
    reason,
    cacheSource,
    count,
    runId: meta.runId || payload?.runId || payload?.transport?.runId || "",
    tradeDate: meta.tradeDate || meta.usedDate || meta.date || payload?.tradeDate || payload?.usedDate || payload?.date || "",
    updatedAt: meta.updatedAt || meta.generatedAt || meta.scanStamp || payload?.updatedAt || payload?.generatedAt || payload?.scanStamp || "",
    fallbackUsed,
    capturedAt,
  };
}

function notRequiredEvidence(name, capturedAt) {
  return {
    status: "not_required",
    required: false,
    reason: `${name} is owned by upstream strategy APIs; watchlist_match_index stores their published API payload evidence`,
    capturedAt,
  };
}

function buildQuoteCoverageEvidence(quoteByCode, byCode, capturedAt) {
  const capturedMs = Date.parse(capturedAt);
  const entries = Object.keys(byCode || {});
  const ages = entries.map((code) => {
    const updatedAt = quoteByCode?.[code]?.updatedAt || "";
    const ageSeconds = Number.isFinite(capturedMs) && Number.isFinite(Date.parse(updatedAt))
      ? Math.max(0, Math.round((capturedMs - Date.parse(updatedAt)) / 1000))
      : null;
    return { code, updatedAt, ageSeconds };
  });
  const activeSymbols = entries.length;
  const fresh = ages.filter((item) => Number.isFinite(item.ageSeconds) && item.ageSeconds <= 120).length;
  const required = isIntradayFreshnessRequired(new Date(capturedAt));
  const coverage = activeSymbols ? fresh / activeSymbols : 0;
  return {
    status: required && coverage < 0.95 ? "degraded" : "ready",
    required,
    freshnessWindow: "Asia/Taipei 08:45-13:35",
    fresh_quote_coverage_120s: Number(coverage.toFixed(6)),
    fresh_quotes: fresh,
    active_symbols: activeSymbols,
    quote_age_seconds: {
      min: ages.length ? Math.min(...ages.map((item) => item.ageSeconds ?? Infinity).filter(Number.isFinite)) : null,
      max: ages.length ? Math.max(...ages.map((item) => item.ageSeconds ?? -Infinity).filter(Number.isFinite)) : null,
    },
    staleSample: ages.filter((item) => !Number.isFinite(item.ageSeconds) || item.ageSeconds > 120).slice(0, 8),
    capturedAt,
  };
}

function buildRunEvidence({ sourceEvidence, quoteByCode, byCode, warnings, capturedAt }) {
  const fallbackDetails = Object.entries(sourceEvidence)
    .filter(([, evidence]) => evidence.fallbackUsed || evidence.status === "fallback")
    .map(([key, evidence]) => ({ key, api: evidence.api, reason: evidence.reason, cacheSource: evidence.cacheSource }));
  const sourceIssues = Object.entries(sourceEvidence)
    .filter(([, evidence]) => !["ready"].includes(evidence.status))
    .map(([key, evidence]) => `${key}:${evidence.status}:${evidence.reason}`);
  const quoteCoverage = buildQuoteCoverageEvidence(quoteByCode, byCode, capturedAt);
  const reasons = [
    ...sourceIssues,
    ...normalizeArray(warnings).map((warning) => `warning:${warning}`),
    quoteCoverage.status === "degraded" ? `quote_coverage_120s:${quoteCoverage.fresh_quote_coverage_120s}` : "",
  ].filter(Boolean);
  const publishable = reasons.length === 0;
  return {
    source_snapshot_captured_at: capturedAt,
    source_status_at_run: {
      status: publishable ? "ready" : "degraded",
      capturedAt,
      sources: sourceEvidence,
      issueCount: reasons.length,
      issues: reasons,
    },
    quote_coverage_at_run: quoteCoverage,
    intraday_1m_readiness_at_run: notRequiredEvidence("intraday_1m_readiness", capturedAt),
    ma_readiness_at_run: notRequiredEvidence("ma_readiness", capturedAt),
    preopen_futopt_daily_readiness_at_run: notRequiredEvidence("preopen_futopt_daily_readiness", capturedAt),
    run_quality_at_publish: {
      status: publishable ? "good" : "degraded",
      publishable,
      reasons,
      capturedAt,
    },
    fallbackUsed: fallbackDetails.length > 0,
    fallbackScope: fallbackDetails.length ? "source_endpoint" : "none",
    fallbackAllowed: false,
    fallbackDetails,
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    writeBudget: {
      allowed: publishable,
      used: publishable ? 1 : 0,
      limit: 1,
      remaining: publishable ? 0 : 1,
      scope: "watchlist_match_index market_snapshots upsert per desktop route snapshot refresh",
    },
    retentionOk: true,
    evidenceStatus: "complete",
    unattendedStatus: publishable ? "YES" : "NO",
  };
}

function sourceKeyFor(row, source) {
  if (source.key !== "strategy2") return source.key;
  const signalId = String(row.strategy || row.primaryStrategy || row.stateLabel || row.signalId || row.stateId || row.state || row.status || row.signal || "").trim();
  const safeSignalId = signalId.replace(/\s+/g, "_").replace(/^_+|_+$/g, "");
  return safeSignalId ? `${source.key}:${safeSignalId}` : source.key;
}

function sourceLabelFor(row, source) {
  if (source.key !== "strategy2") return source.label;
  const strategy = signalText(row.strategy || row.primaryStrategy || row.stateLabel || row.state || row.status || row.signal || row.signalId);
  return strategy ? `策略2-${strategy}` : source.label;
}

function buildWatchlistMatchIndex(endpoints, options = {}) {
  const updatedAt = options.updatedAt || new Date().toISOString();
  const byCode = {};
  const namesByCode = {};
  const quoteByCode = {};
  const strategies = {};
  const warnings = [];
  const sourceEvidence = {};

  for (const source of SOURCES) {
    const payload = findEndpointPayload(endpoints, source);
    if (!payload) {
      warnings.push(`${source.key}: endpoint_missing`);
      strategies[source.key] = { label: source.label, api: source.endpoint, count: 0, error: "endpoint_missing" };
      sourceEvidence[source.key] = buildSourceEvidence(source, null, [], updatedAt);
      continue;
    }
    const rows = rowsFromPayload(payload, source);
    const meta = payloadMeta(payload);
    const date = meta?.usedDate || meta?.date || meta?.tradeDate || meta?.scanStamp || meta?.updatedAt || payload.usedDate || payload.date || payload.tradeDate || payload.scanStamp || payload.updatedAt || "";
    strategies[source.key] = {
      label: source.label,
      api: source.endpoint,
      date,
      updatedAt: meta?.updatedAt || meta?.generatedAt || meta?.scanStamp || payload.updatedAt || payload.generatedAt || payload.scanStamp || "",
      cacheSource: meta?.cacheSource || meta?.source || payload.cacheSource || payload.source || "",
      count: rows.length,
    };
    sourceEvidence[source.key] = buildSourceEvidence(source, payload, rows, updatedAt);
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
        key: sourceKeyFor(row, source),
        label: sourceLabelFor(row, source),
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

  const runId = `watchlist-match-index-${updatedAt.replace(/\D/g, "").slice(0, 14)}`;
  const runEvidence = buildRunEvidence({ sourceEvidence, quoteByCode, byCode, warnings, capturedAt: updatedAt });
  const publishable = runEvidence?.run_quality_at_publish?.publishable === true;
  const exposedByCode = publishable ? byCode : {};
  const exposedQuoteByCode = publishable ? quoteByCode : {};
  const exposedNamesByCode = publishable ? namesByCode : {};
  return {
    ok: publishable,
    source: "watchlist-match-index",
    cacheSource: options.cacheSource || "desktop-route-snapshot-build",
    error: publishable ? "" : "watchlist_match_index_source_not_publishable",
    runId,
    updatedAt,
    count: Object.keys(exposedByCode).length,
    warnings: publishable ? warnings : [...warnings, "watchlist_match_index_source_not_publishable"],
    strategies,
    namesByCode: exposedNamesByCode,
    quoteByCode: exposedQuoteByCode,
    byCode: exposedByCode,
    ...runEvidence,
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
