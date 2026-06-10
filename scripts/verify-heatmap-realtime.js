const handler = require("../api/heatmap.js");

function callHeatmap() {
  return new Promise((resolve, reject) => {
    const request = { method: "GET", query: { limit: "999", stocks: "999", source: "release-guard" } };
    const response = {
      code: 0,
      setHeader() {},
      status(code) { this.code = code; return this; },
      json(payload) { resolve({ code: this.code, payload }); },
      end() { resolve({ code: this.code, payload: null }); },
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

async function fetchLiveHeatmap() {
  const url = `https://fuman-terminal.vercel.app/api/heatmap?limit=999&stocks=999&source=release-guard-live&t=${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });
  return { code: response.status, payload: await response.json(), live: true };
}

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()).replace(/\D/g, "");
}

function fail(message, detail) {
  console.error(`[heatmap-realtime] failed: ${message}`);
  if (detail) console.error(JSON.stringify(detail, null, 2));
  process.exit(1);
}

(async () => {
  const startedAt = Date.now();
  let { code, payload, live = false } = await callHeatmap();
  if (code !== 200 || !payload?.ok) {
    const errors = payload?.errors || {};
    const fetchFailed = Object.values(errors).some((message) => String(message || "").includes("fetch failed"));
    if (fetchFailed) ({ code, payload, live } = await fetchLiveHeatmap());
  }
  if (code !== 200 || !payload?.ok) fail("API did not return a healthy payload", { code, ok: payload?.ok, health: payload?.health, errors: payload?.errors });

  const sectors = Array.isArray(payload.sectors) ? payload.sectors : [];
  const rows = sectors.flatMap((sector) => (Array.isArray(sector.stocks) ? sector.stocks : [])
    .map((stock) => ({ ...stock, sector: sector.name })));
  const today = payload.health?.today || taipeiToday();
  const badDate = rows.filter((stock) => String(stock.quoteDate || "") !== today);
  const notRealtime = rows.filter((stock) => stock.isRealtime !== true);
  const noPrice = rows.filter((stock) => !Number(stock.close));
  const requiredCodes = ["3037", "2492", "2327", "2059"];
  const required = Object.fromEntries(requiredCodes.map((target) => [target, rows.find((stock) => String(stock.code) === target) || null]));
  const missingRequired = Object.entries(required).filter(([, stock]) => !stock || stock.isRealtime !== true || !Number(stock.close));

  if (rows.length < 500 || badDate.length || notRealtime.length || noPrice.length || missingRequired.length) {
    fail("heatmap contains stale or invalid quotes", {
      today,
      rows: rows.length,
      badDate: badDate.length,
      notRealtime: notRealtime.length,
      noPrice: noPrice.length,
      missingRequired: missingRequired.map(([target]) => target),
      samples: {
        badDate: badDate.slice(0, 5).map(({ code, name, close, pct, quoteDate, sector }) => ({ code, name, close, pct, quoteDate, sector })),
        notRealtime: notRealtime.slice(0, 5).map(({ code, name, close, pct, quoteDate, sector }) => ({ code, name, close, pct, quoteDate, sector })),
        noPrice: noPrice.slice(0, 5).map(({ code, name, close, pct, quoteDate, sector }) => ({ code, name, close, pct, quoteDate, sector })),
      },
    });
  }

  console.log(`[heatmap-realtime] ok source=${live ? "live" : "local"} stocks=${rows.length} realtime=${payload.realtimeStockCount} quoteTime=${payload.health?.quoteTime || ""} ms=${Date.now() - startedAt}`);
})();
