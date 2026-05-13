// api/proxy.js — 解決 CORS 問題，代理 mis.twse.com.tw 請求
module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") { response.status(405).json({ error: "Method not allowed" }); return; }

  const { code, market } = request.query;
  if (!code) { response.status(400).json({ error: "Missing code" }); return; }

  const ex = (market === "otc") ? "otc" : "tse";
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${ex}_${code}.tw&json=1&delay=0`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        "Referer": "https://mis.twse.com.tw/",
      },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    response.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
    response.status(200).json(data);
  } catch (e) {
    response.status(502).json({ error: e.message });
  }
};
