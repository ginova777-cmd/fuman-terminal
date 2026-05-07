const TWSE_ENDPOINTS = {
  indexes: "https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX",
  stocks: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
};

async function fetchJson(url, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "FumanTerminal/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`TWSE responded ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const [indexes, stocks] = await Promise.all([
      fetchJson(TWSE_ENDPOINTS.indexes),
      fetchJson(TWSE_ENDPOINTS.stocks),
    ]);

    response.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    response.status(200).json({
      ok: true,
      source: "TWSE OpenAPI",
      updatedAt: new Date().toISOString(),
      indexes: Array.isArray(indexes) ? indexes : [],
      stocks: Array.isArray(stocks) ? stocks : [],
    });
  } catch (error) {
    response.status(502).json({
      ok: false,
      source: "TWSE OpenAPI",
      updatedAt: new Date().toISOString(),
      error: error.message,
    });
  }
};
