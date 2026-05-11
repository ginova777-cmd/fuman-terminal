// api/institution.js — 三大法人買賣超資料

async function fetchWithTimeout(url, options = {}, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        "Accept": "application/json",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }

  try {
    // 三大法人買賣超
    const data = await fetchWithTimeout(
      "https://openapi.twse.com.tw/v1/exchangeReport/BFIAUU"
    );

    if (!Array.isArray(data)) throw new Error("Invalid data");

    // 建立 code -> 法人資料 對照表
    const result = {};
    for (const item of data) {
      const code = item["證券代號"] || item["Code"] || "";
      if (!code) continue;
      result[code] = {
        foreign: parseInt(String(item["外陸資買賣超股數(不含外資自營商)"] || item["外資買賣超"] || "0").replace(/,/g, "")) || 0,
        trust: parseInt(String(item["投信買賣超股數"] || item["投信買賣超"] || "0").replace(/,/g, "")) || 0,
        dealer: parseInt(String(item["自營商買賣超股數(不含自行買賣)"] || item["自營商買賣超"] || "0").replace(/,/g, "")) || 0,
      };
    }

    response.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    response.status(200).json({ ok: true, updatedAt: new Date().toISOString(), data: result });

  } catch (e) {
    response.status(502).json({ ok: false, error: e.message });
  }
};
