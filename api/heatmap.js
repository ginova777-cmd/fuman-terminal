// api/heatmap.js — 產業熱力圖資料

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
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

// TWSE 官方產業代碼對照
const INDUSTRY_MAP = {
  "01": "水泥", "02": "食品", "03": "塑膠", "04": "紡織纖維",
  "05": "電機機械", "06": "電器電纜", "07": "化學生技醫療",
  "08": "玻璃陶瓷", "09": "造紙", "10": "鋼鐵",
  "11": "橡膠", "12": "汽車", "13": "電子工業",
  "14": "建材營造", "15": "航運", "16": "觀光餐旅",
  "17": "金融保險", "18": "貿易百貨", "19": "綜合",
  "20": "其他", "21": "化學", "22": "生技醫療",
  "23": "油電燃氣", "24": "半導體", "25": "電腦及週邊設備",
  "26": "光電", "27": "通信網路", "28": "電子零組件",
  "29": "電子通路", "30": "資訊服務", "31": "其他電子",
  "32": "綠能環保", "33": "數位雲端", "34": "運動休閒",
  "35": "居家生活",
};

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }

  try {
    // 抓所有個股當日資料
    const [stocks, stockInfo] = await Promise.all([
      fetchWithTimeout("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"),
      fetchWithTimeout("https://openapi.twse.com.tw/v1/opendata/t187ap03_L"),
    ]);

    // 建立股票代號 -> 產業代碼對照
    const codeToIndustry = {};
    if (Array.isArray(stockInfo)) {
      for (const item of stockInfo) {
        const code = item["公司代號"] || item["Code"] || "";
        const industry = item["產業別"] || item["Industry"] || "";
        if (code && industry) codeToIndustry[code] = industry;
      }
    }

    // 按產業分組計算
    const groups = {};
    for (const stock of stocks) {
      const code = stock.Code || "";
      const change = parseFloat(stock.Change) || 0;
      const close = parseFloat(stock.ClosingPrice) || 0;
      const value = parseFloat(stock.TradeValue) || 0;
      const prev = close - change;
      const pct = prev > 0 ? (change / prev) * 100 : 0;

      const industryName = codeToIndustry[code] || "其他";

      if (!groups[industryName]) {
        groups[industryName] = {
          name: industryName,
          stocks: [],
          totalValue: 0,
          up: 0,
          down: 0,
          flat: 0,
        };
      }

      groups[industryName].stocks.push({ code, name: stock.Name, pct, change, close, value });
      groups[industryName].totalValue += value;
      if (change > 0) groups[industryName].up++;
      else if (change < 0) groups[industryName].down++;
      else groups[industryName].flat++;
    }

    // 計算每個產業的平均漲跌幅
    const result = Object.values(groups).map(g => {
      const avgPct = g.stocks.reduce((sum, s) => sum + s.pct, 0) / g.stocks.length;
      // 找成交值最大的股票作為代表
      const leader = [...g.stocks].sort((a, b) => b.value - a.value)[0];
      return {
        name: g.name,
        pct: parseFloat(avgPct.toFixed(2)),
        totalValue: parseFloat((g.totalValue / 100000000).toFixed(1)),
        count: g.stocks.length,
        up: g.up,
        down: g.down,
        flat: g.flat,
        leader: leader ? `${leader.name} ${leader.pct >= 0 ? "+" : ""}${leader.pct.toFixed(2)}%` : "--",
        leaderCode: leader?.code || "",
      };
    }).sort((a, b) => b.pct - a.pct);

    response.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    response.status(200).json({ ok: true, updatedAt: new Date().toISOString(), sectors: result });

  } catch (e) {
    response.status(502).json({ ok: false, error: e.message });
  }
};
