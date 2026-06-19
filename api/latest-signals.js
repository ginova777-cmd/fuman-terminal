const strategy4Latest = require("./strategy4-latest");
const strategy3Latest = require("./strategy3-latest");
const strategy5Latest = require("./strategy5-latest");
const watchlistMatchIndex = require("./watchlist-match-index");

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function createCaptureResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    status(code) { this.statusCode = Number(code) || 200; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function loadWatchlistIndex(request) {
  const response = createCaptureResponse();
  await watchlistMatchIndex({ ...request, method: "GET" }, response);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`watchlist-match-index status ${response.statusCode}`);
  }
  return response.body && typeof response.body === "object" ? response.body : {};
}

function buildConfluencePayload(index, { minCount = 2, limit = 120 } = {}) {
  const byCode = index?.byCode && typeof index.byCode === "object" ? index.byCode : {};
  const namesByCode = index?.namesByCode && typeof index.namesByCode === "object" ? index.namesByCode : {};
  const quoteByCode = index?.quoteByCode && typeof index.quoteByCode === "object" ? index.quoteByCode : {};
  const rows = Object.entries(byCode).map(([code, entries]) => {
    const matches = Array.isArray(entries) ? entries : [];
    const quote = quoteByCode[code] && typeof quoteByCode[code] === "object" ? quoteByCode[code] : {};
    const sourceCount = matches.length;
    const totalRawScore = matches.reduce((sum, item) => sum + cleanNumber(item?.rawScore ?? item?.score), 0);
    const maxScore = matches.reduce((max, item) => Math.max(max, cleanNumber(item?.rawScore ?? item?.score)), 0);
    const strategy5InternalCount = matches.reduce((max, item) => {
      const key = String(item?.key || "");
      return key === "strategy5" ? Math.max(max, cleanNumber(item?.internalCount)) : max;
    }, 0);
    const rankScore = sourceCount
      + Math.max(0, Math.min(99, strategy5InternalCount)) / 100
      + Math.max(0, Math.min(sourceCount * 100, totalRawScore)) / 100000;
    return {
      code,
      name: namesByCode[code] || matches.find((item) => item?.name)?.name || code,
      close: cleanNumber(quote.close || quote.price),
      price: cleanNumber(quote.price || quote.close),
      percent: cleanNumber(quote.percent),
      volume: cleanNumber(quote.volume || quote.tradeVolume),
      tradeVolume: cleanNumber(quote.tradeVolume || quote.volume),
      value: cleanNumber(quote.value || quote.tradeValue),
      tradeValue: cleanNumber(quote.tradeValue || quote.value),
      market: quote.market || "",
      score: rankScore,
      rankScore,
      rawScore: totalRawScore,
      maxScore,
      sourceCount,
      confluenceCount: sourceCount,
      terminalConfluenceCount: sourceCount,
      strategy5InternalCount,
      strategies: matches,
      matches,
      labels: matches.map((item) => item?.label).filter(Boolean),
      reason: matches.map((item) => {
        const details = Array.isArray(item?.details) && item.details.length ? `：${item.details.slice(0, 3).join("、")}` : "";
        return `${item?.label || item?.key || "終端策略"}${details}`;
      }).join("；"),
      updatedAt: matches.map((item) => item?.updatedAt).filter(Boolean).sort().at(-1) || index?.updatedAt || "",
    };
  }).filter((row) => row.sourceCount >= minCount)
    .sort((a, b) => b.sourceCount - a.sourceCount || b.strategy5InternalCount - a.strategy5InternalCount || b.score - a.score || b.maxScore - a.maxScore || a.code.localeCompare(b.code))
    .slice(0, limit);
  return {
    ok: true,
    source: "watchlist-match-index-confluence",
    cacheSource: index?.cacheSource || index?.source || "",
    updatedAt: index?.updatedAt || new Date().toISOString(),
    runId: index?.runId || index?.transport?.runId || "",
    minCount,
    count: rows.length,
    matches: rows,
    rows,
    strategies: index?.strategies || {},
    transport: {
      ...(index?.transport || {}),
      via: "api/latest-signals",
      mode: "terminal-confluence",
    },
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET" && request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const url = new URL(request.url || "/api/latest-signals", "https://fuman-terminal.vercel.app");
  const strategy = String(url.searchParams.get("strategy") || request.query?.strategy || "strategy4").trim().toLowerCase();

  if (strategy === "strategy4" || strategy === "swing" || strategy === "swing_radar") {
    await strategy4Latest({ ...request, method: "GET" }, response);
    return;
  }

  if (strategy === "strategy3" || strategy === "overnight") {
    await strategy3Latest({ ...request, method: "GET" }, response);
    return;
  }

  if (strategy === "strategy5") {
    await strategy5Latest({ ...request, method: "GET" }, response);
    return;
  }

  if (strategy === "multi" || strategy === "confluence") {
    try {
      const minCount = Math.max(2, cleanNumber(url.searchParams.get("min") || request.query?.min || 2));
      const limit = Math.max(1, cleanNumber(url.searchParams.get("limit") || request.query?.limit || 120));
      const index = await loadWatchlistIndex(request);
      const payload = buildConfluencePayload(index, { minCount, limit });
      if (!payload.count) {
        response.status(404).json({
          ok: false,
          error: "terminal_confluence_latest_empty",
          detail: "latest watchlist_match_index snapshot has no rows matching minCount",
          cacheSource: payload.cacheSource || "none",
          minCount,
          count: 0,
          matches: [],
          rows: [],
          transport: payload.transport,
        });
        return;
      }
      response.status(200).json(payload);
    } catch (error) {
      response.status(503).json({
        ok: false,
        error: "terminal_confluence_unavailable",
        detail: error?.message || String(error),
        minCount: 2,
        count: 0,
        matches: [],
      });
    }
    return;
  }

  response.status(400).json({
    ok: false,
    error: "unsupported_strategy",
    strategy,
    supported: ["strategy3", "strategy4", "strategy5", "multi", "confluence"],
  });
};
