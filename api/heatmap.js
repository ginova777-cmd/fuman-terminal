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

// TWSE 官方產業代碼對照表
const INDUSTRY_CODE_MAP = {
  "01": "水泥", "02": "食品", "03": "塑膠", "04": "紡織纖維",
  "05": "電機機械", "06": "電器電纜", "07": "化學生技醫療",
  "08": "玻璃陶瓷", "09": "造紙", "10": "鋼鐵",
  "11": "橡膠", "12": "汽車", "13": "電子工業",
  "14": "建材營造", "15": "航運", "16": "觀光餐旅",
  "17": "金融保險", "18": "貿易百貨", "19": "綜合",
  "20": "其他", "21": "化學", "22": "生技醫療",
  "23": "油電燃氣", "24": "半導體", "25": "電腦及週邊",
  "26": "光電", "27": "通信網路", "28": "電子零組件",
  "29": "電子通路", "30": "資訊服務", "31": "其他電子",
  "32": "綠能環保", "33": "數位雲端", "34": "運動休閒",
  "35": "居家生活", "36": "電商零售", "37": "貿易", "38": "生活消費",
  "39": "文化創意", "40": "農業科技", "41": "交通運輸",
  "91": "存託憑證",
};

// 也對照中文產業名稱（有時 API 直接回中文）
const INDUSTRY_NAME_MAP = {
  "水泥工業": "水泥", "食品工業": "食品", "塑膠工業": "塑膠",
  "紡織纖維": "紡織纖維", "電機機械": "電機機械", "電器電纜": "電器電纜",
  "化學工業": "化學", "化學生技醫療業": "化學生技醫療",
  "玻璃陶瓷": "玻璃陶瓷", "造紙工業": "造紙", "鋼鐵工業": "鋼鐵",
  "橡膠工業": "橡膠", "汽車工業": "汽車", "電子工業": "電子工業",
  "建材營造業": "建材營造", "航運業": "航運", "觀光餐旅業": "觀光餐旅",
  "金融保險業": "金融保險", "貿易百貨業": "貿易百貨", "綜合": "綜合",
  "其他": "其他", "生技醫療業": "生技醫療", "油電燃氣業": "油電燃氣",
  "半導體業": "半導體", "電腦及週邊設備業": "電腦及週邊",
  "光電業": "光電", "通信網路業": "通信網路", "電子零組件業": "電子零組件",
  "電子通路業": "電子通路", "資訊服務業": "資訊服務", "其他電子業": "其他電子",
  "綠能環保": "綠能環保", "數位雲端": "數位雲端", "運動休閒": "運動休閒",
  "居家生活": "居家生活",
};

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }

  try {
    const [stocks, stockInfo] = await Promise.all([
      fetchWithTimeout("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"),
      fetchWithTimeout("https://openapi.twse.com.tw/v1/opendata/t187ap03_L"),
    ]);

    // 建立股票代號 -> 產業名稱對照
    const codeToIndustry = {};
    if (Array.isArray(stockInfo)) {
      for (const item of stockInfo) {
        const code = item["公司代號"] || item["Code"] || "";
        const industryRaw = item["產業別"] || item["Industry"] || item["industry"] || "";
        if (!code) continue;
        // 先試代碼對照，再試名稱對照，最後直接用原始值
        const industryName =
          INDUSTRY_CODE_MAP[String(industryRaw).padStart(2, "0")] ||
          INDUSTRY_NAME_MAP[industryRaw] ||
          industryRaw ||
          "其他";
        codeToIndustry[code] = industryName;
      }
    }

    // 按產業分組
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
        groups[industryName] = { name: industryName, stocks: [], totalValue: 0, up: 0, down: 0, flat: 0 };
      }
      groups[industryName].stocks.push({ code, name: stock.Name, pct, change, close, value });
      groups[industryName].totalValue += value;
      if (change > 0) groups[industryName].up++;
      else if (change < 0) groups[industryName].down++;
      else groups[industryName].flat++;
    }

    const result = Object.values(groups).map(g => {
      const avgPct = g.stocks.reduce((sum, s) => sum + s.pct, 0) / g.stocks.length;
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
    }).filter(g => g.name !== "其他" && g.count >= 3)
      .sort((a, b) => b.pct - a.pct);

    response.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    response.status(200).json({ ok: true, updatedAt: new Date().toISOString(), sectors: result });

  } catch (e) {
    response.status(502).json({ ok: false, error: e.message });
  }
};
