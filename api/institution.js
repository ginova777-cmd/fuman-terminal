// api/institution.js — 三大法人個股買賣超（TWSE T86）

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
        "Referer": "https://www.twse.com.tw/",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function getTodayStr() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }

  try {
    const today = getTodayStr();
    const url = `https://www.twse.com.tw/fund/T86?response=json&selectType=ALLBUT0999&date=${today}`;
    const data = await fetchWithTimeout(url);

    // T86 回傳格式：data.data 是二維陣列，fields 是欄位名稱
    // 欄位順序：證券代號, 證券名稱, 外資買進, 外資賣出, 外資買賣超, 投信買進, 投信賣出, 投信買賣超, 自營商買賣超, 自營商買進, 自營商賣出, 自營商買賣超(避險), 三大法人買賣超
    if (!data || !Array.isArray(data.data)) throw new Error("No data");

    const result = {};
    for (const row of data.data) {
      const code = row[0]?.trim();
      if (!code) continue;

      const parseNum = (val) => parseInt(String(val || "0").replace(/,/g, "")) || 0;

      result[code] = {
        foreign: parseNum(row[4]),   // 外資買賣超股數
        trust:   parseNum(row[7]),   // 投信買賣超股數
        dealer:  parseNum(row[8]),   // 自營商買賣超股數
        total:   parseNum(row[12]),  // 三大法人買賣超
      };
    }

    response.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    response.status(200).json({ ok: true, updatedAt: new Date().toISOString(), data: result });

  } catch (e) {
    response.status(200).json({ ok: false, error: e.message, data: {} });
  }
};
