const heatmap = document.querySelector("#heatmap");
const refreshLine = document.querySelector(".refresh-line");
const headerTimes = [...document.querySelectorAll(".header-time")];
const metricCards = [...document.querySelectorAll(".metric-card")];
const tickerStrip = document.querySelector(".ticker-strip");
const strengthPanel = document.querySelector(".strength-panel");
const terminalMessage = document.querySelector("#terminal-message");
const stockSearch = document.querySelector("#stock-search");
const stockTable = document.querySelector("#stock-table");
const watchCount = document.querySelector("#watch-count");
const viewLinks = [...document.querySelectorAll("[data-view]")];
const viewPanels = {
  market: document.querySelector("#market-view"),
  strategy: document.querySelector("#strategy-view"),
  "chip-trade": document.querySelector("#chip-trade-view"),
  "warrant-flow": document.querySelector("#warrant-flow-view"),
};
const strategyCards = [...document.querySelectorAll(".strategy-card[data-strategy]")];
const strategyTable = document.querySelector("#strategy-table");
const strategySummary = document.querySelector("#strategy-summary");
const strategySearch = document.querySelector("#strategy-search");
const strategyClear = document.querySelector("#strategy-clear");
const strategyModeButtons = [...document.querySelectorAll("[data-strategy-mode]")];
const strategyMatchCount = document.querySelector("#strategy-match-count");
const strategyAvgScore = document.querySelector("#strategy-avg-score");
const strategyTopHit = document.querySelector("#strategy-top-hit");

const endpoints = {
  backend: "/api/market",
  heatmap: "/api/heatmap",
  institution: "/api/institution",
  strategyStocks: "/api/stocks",
  stocks: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
};

let latestStocks = [];
let sectorStocksCache = {};
let institutionData = {};
let institutionDate = "";
let chipMode = "realtime";
let selectedStrategyIds = new Set(["momentum"]);
let strategyMode = "any";
let strategyKeyword = "";
let strategyStocksLoading = false;

const SECTOR_MAP = {
  "2454":"CPU/ASIC/IP","3443":"CPU/ASIC/IP","3661":"CPU/ASIC/IP","3529":"CPU/ASIC/IP",
  "3035":"CPU/ASIC/IP","6643":"CPU/ASIC/IP","6533":"CPU/ASIC/IP","5274":"CPU/ASIC/IP",
  "3036":"CPU/ASIC/IP","6770":"CPU/ASIC/IP","4967":"CPU/ASIC/IP","6582":"CPU/ASIC/IP",
  "3481":"面板業","2475":"面板業","3673":"面板業","5269":"面板業","8150":"面板業","3665":"面板業",
  "2330":"IC生產製造","2303":"IC生產製造","5347":"IC生產製造","2337":"IC生產製造","2344":"IC生產製造","2408":"IC生產製造",
  "3260":"記憶體/儲存","8299":"記憶體/儲存","4979":"記憶體/儲存","2406":"記憶體/儲存","3483":"記憶體/儲存",
  "6409":"電源系統/BBU/UPS","1537":"電源系統/BBU/UPS","3504":"電源系統/BBU/UPS","6208":"電源系統/BBU/UPS",
  "1560":"電源系統/BBU/UPS","3519":"電源系統/BBU/UPS","6550":"電源系統/BBU/UPS","3380":"電源系統/BBU/UPS",
  "1590":"電源系統/BBU/UPS","6679":"電源系統/BBU/UPS","6197":"電源系統/BBU/UPS","3023":"電源系統/BBU/UPS",
  "6670":"電源系統/BBU/UPS","3017":"電源系統/BBU/UPS",
  "3444":"半導體設備/測試","5222":"半導體設備/測試","3588":"半導體設備/測試","6510":"半導體設備/測試",
  "3530":"半導體設備/測試","5243":"半導體設備/測試","3413":"半導體設備/測試","2329":"半導體設備/測試",
  "2317":"組裝代工","2354":"組裝代工","2353":"組裝代工","2356":"組裝代工","2324":"組裝代工","4938":"組裝代工","2382":"組裝代工",
  "2327":"被動元件","2492":"被動元件","2049":"被動元件","2447":"被動元件","2351":"被動元件",
  "6271":"被動元件","2483":"被動元件","3231":"被動元件","2390":"被動元件","2441":"被動元件",
  "2395":"工業電腦","6414":"工業電腦","3596":"工業電腦","6438":"工業電腦","3026":"工業電腦","6485":"工業電腦",
  "3708":"通訊/CPO","4904":"通訊/CPO","2412":"通訊/CPO","3704":"通訊/CPO","6547":"通訊/CPO","4977":"通訊/CPO","3706":"通訊/CPO",
  "2379":"IC設計服務","3711":"IC設計服務","6415":"IC設計服務","4966":"IC設計服務","3034":"IC設計服務",
  "6146":"IC設計服務","2385":"IC設計服務","3645":"IC設計服務","3163":"IC設計服務","5388":"IC設計服務",
  "6274":"IC設計服務","3561":"IC設計服務","6191":"IC設計服務",
  "3051":"網通設備組件","6277":"網通設備組件","4906":"網通設備組件","2399":"網通設備組件","3321":"網通設備組件",
  "3037":"PCB/載板","6269":"PCB/載板","2383":"PCB/載板","3005":"PCB/載板","3044":"PCB/載板",
  "2365":"PCB/載板","3406":"PCB/載板","8046":"PCB/載板","2457":"PCB/載板","3376":"PCB/載板","2461":"PCB/載板","6289":"PCB/載板",
  "2308":"半導體","2449":"半導體","2344":"半導體","3711":"半導體","2337":"半導體",
  "3034":"半導體","6415":"半導體","2385":"半導體","3529":"半導體","4966":"半導體",
  "6146":"半導體","2329":"半導體","5347":"半導體","2363":"半導體",
  "6669":"AI伺服器","3060":"AI伺服器","3008":"AI伺服器","3045":"AI伺服器",
  "1802":"玻璃陶瓷","1805":"玻璃陶瓷","1806":"玻璃陶瓷","9902":"玻璃陶瓷","1810":"玻璃陶瓷",
  "6235":"IC封測","3515":"IC封測","2340":"IC封測","2404":"IC封測",
  "1717":"化學","1710":"化學","1711":"化學","1712":"化學","1713":"化學","1714":"化學",
  "1715":"化學","1718":"化學","1721":"化學","1722":"化學","4743":"化學","1737":"化學","1731":"化學",
  "2350":"液冷/散熱","6230":"液冷/散熱","3526":"液冷/散熱","3623":"液冷/散熱","2398":"液冷/散熱","1626":"液冷/散熱","3227":"液冷/散熱",
  "3576":"綠能環保","3533":"綠能環保","6549":"綠能環保","3580":"綠能環保","6513":"綠能環保","3560":"綠能環保","3591":"綠能環保","6220":"綠能環保",
  "9910":"運動休閒","9914":"運動休閒","5706":"運動休閒","9945":"運動休閒",
  "6451":"數位雲端","3042":"數位雲端","6180":"數位雲端","5351":"數位雲端","3592":"數位雲端","6488":"數位雲端",
  "3702":"電子通路","2347":"電子通路","2348":"電子通路","8454":"電子通路",
  "1301":"塑膠","1303":"塑膠","1304":"塑膠","1305":"塑膠","1308":"塑膠","1309":"塑膠","1310":"塑膠","1312":"塑膠","1313":"塑膠","1314":"塑膠",
  "1519":"電機機械","1504":"電機機械","1513":"電機機械","1530":"電機機械","1537":"電機機械","1538":"電機機械","1590":"電機機械","1536":"電機機械","1598":"電機機械",
  "2357":"電腦週邊","6669":"電腦週邊","2353":"電腦週邊","2362":"電腦週邊","2399":"電腦週邊","2376":"電腦週邊","3060":"電腦週邊",
  "1603":"電器電纜","1604":"電器電纜","1605":"電器電纜","1608":"電器電纜","1609":"電器電纜","1610":"電器電纜","1611":"電器電纜","1612":"電器電纜",
  "1101":"水泥","1102":"水泥","1103":"水泥","1104":"水泥","1108":"水泥","1109":"水泥",
  "2358":"其他電子","2360":"其他電子","2368":"其他電子","2369":"其他電子","2374":"其他電子","2059":"其他電子","6209":"其他電子",
  "9105":"存托憑證","9106":"存托憑證",
  "2881":"金融保險","2882":"金融保險","2883":"金融保險","2884":"金融保險","2885":"金融保險","2886":"金融保險",
  "2887":"金融保險","2888":"金融保險","2889":"金融保險","2890":"金融保險","2891":"金融保險","2892":"金融保險",
  "2801":"金融保險","5880":"金融保險","2823":"金融保險","2833":"金融保險","2841":"金融保險","2845":"金融保險","5876":"金融保險",
  "2501":"建材營造","2511":"建材營造","2515":"建材營造","2520":"建材營造","2524":"建材營造",
  "2527":"建材營造","2530":"建材營造","2534":"建材營造","2542":"建材營造","5522":"建材營造","2536":"建材營造","2538":"建材營造",
  "1402":"紡織","1409":"紡織","1410":"紡織","1414":"紡織","1417":"紡織","1418":"紡織","1434":"紡織","1436":"紡織",
  "1438":"紡織","1440":"紡織","1441":"紡織","1442":"紡織","1443":"紡織","1444":"紡織","1445":"紡織",
  "1446":"紡織","1447":"紡織","1448":"紡織","1449":"紡織","1452":"紡織","1453":"紡織","1454":"紡織",
  "1455":"紡織","1456":"紡織","1457":"紡織","1458":"紡織","1459":"紡織","1460":"紡織","1461":"紡織",
  "1463":"紡織","1464":"紡織","1465":"紡織","1466":"紡織","1467":"紡織","1468":"紡織","1469":"紡織",
  "1470":"紡織","1471":"紡織","1472":"紡織","1473":"紡織","1474":"紡織","1475":"紡織","1476":"紡織","1477":"紡織","1478":"紡織",
  "2103":"橡膠","2104":"橡膠","2105":"橡膠","2106":"橡膠","2107":"橡膠","2108":"橡膠","2109":"橡膠","2110":"橡膠",
  "2903":"貿易百貨","2904":"貿易百貨","2906":"貿易百貨","2908":"貿易百貨","2910":"貿易百貨","2911":"貿易百貨","2912":"貿易百貨","9904":"貿易百貨",
  "3481":"光電","2475":"光電","3008":"光電","2340":"光電","2409":"光電","3707":"光電","5269":"光電","3044":"光電","3673":"光電",
  "6505":"油電燃氣","9907":"油電燃氣",
  "1216":"食品","1210":"食品","1213":"食品","1215":"食品","1217":"食品","1218":"食品","1219":"食品","1220":"食品",
  "1225":"食品","1227":"食品","1229":"食品","1231":"食品","1232":"食品","1233":"食品","1234":"食品",
  "4746":"生技醫藥","6446":"生技醫藥","4743":"生技醫藥","1786":"生技醫藥","4166":"生技醫藥","4164":"生技醫藥",
  "4111":"生技醫藥","4119":"生技醫藥","4144":"生技醫藥","4116":"生技醫藥","4147":"生技醫藥","4148":"生技醫藥",
  "4153":"生技醫藥","4154":"生技醫藥","4157":"生技醫藥","4158":"生技醫藥","4160":"生技醫藥","4161":"生技醫藥",
  "4162":"生技醫藥","4163":"生技醫藥","4165":"生技醫藥","4168":"生技醫藥","4169":"生技醫藥","4171":"生技醫藥",
  "2201":"汽車","2204":"汽車","2206":"汽車","2207":"汽車","2209":"汽車","2211":"汽車","2212":"汽車","1319":"汽車","2203":"汽車","2208":"汽車",
  "2727":"觀光餐旅","2731":"觀光餐旅","2733":"觀光餐旅","2736":"觀光餐旅","6704":"觀光餐旅",
  "2719":"觀光餐旅","2722":"觀光餐旅","2704":"觀光餐旅","2706":"觀光餐旅","2707":"觀光餐旅","2712":"觀光餐旅","2718":"觀光餐旅",
  "2326":"資訊服務","6214":"資訊服務","2405":"資訊服務","2434":"資訊服務","5203":"資訊服務","5478":"資訊服務",
  "1262":"農業科技","1264":"農業科技","1267":"農業科技","1268":"農業科技","1275":"農業科技","4205":"農業科技","4207":"農業科技","4712":"農業科技",
  "1476":"居家生活","1477":"居家生活","1536":"居家生活","8464":"居家生活","2923":"居家生活","9933":"居家生活",
  "2603":"航運","2609":"航運","2610":"航運","2615":"航運","2618":"航運","2637":"航運","2641":"航運",
  "5608":"航運","2614":"航運","2616":"航運","2617":"航運","2622":"航運","2624":"航運","2626":"航運",
  "2002":"鋼鐵","2006":"鋼鐵","2007":"鋼鐵","2008":"鋼鐵","2009":"鋼鐵","2010":"鋼鐵","2012":"鋼鐵",
  "2014":"鋼鐵","2015":"鋼鐵","2027":"鋼鐵","2029":"鋼鐵","2030":"鋼鐵","2031":"鋼鐵","2032":"鋼鐵",
  "2033":"鋼鐵","2034":"鋼鐵","2035":"鋼鐵","2036":"鋼鐵","2038":"鋼鐵","2039":"鋼鐵",
  "6550":"創新板股","6730":"創新板股","6754":"創新板股","6811":"創新板股",
};

function cleanNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  return Number(String(value).replace(/[,+%]/g, "")) || 0;
}

function formatNumber(value, digits = 2) {
  return cleanNumber(value).toLocaleString("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatChange(sign, points, percent) {
  const symbol = sign === "-" ? "-" : "+";
  return `${symbol}${formatNumber(points)}　(${symbol}${formatNumber(percent)}%)`;
}

function valueOf(record, keys) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== "") return record[key];
  }
  return "";
}

async function fetchJson(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.data)) return value.data;
  if (value && Array.isArray(value.rows)) return value.rows;
  if (value && Array.isArray(value.result)) return value.result;
  return [];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rankValue(value, sortedValues) {
  if (!sortedValues.length) return 0;
  let index = 0;
  while (index < sortedValues.length && sortedValues[index] <= value) index++;
  return Math.round((index / sortedValues.length) * 100);
}

function getInstitutionTotal(code) {
  const inst = institutionData[code] || {};
  const foreign = Number(inst.foreign) || 0;
  const trust = Number(inst.trust) || 0;
  const dealer = Number(inst.dealer) || 0;
  return { foreign, trust, dealer, total: foreign + trust + dealer };
}

const STRATEGY_DEFS = [
  { id: "momentum", label: "動能分數 75+", short: "動能", icon: "⚡" },
  { id: "main_force_chip", label: "主力籌碼盤整", short: "主力", icon: "♣" },
  { id: "twenty_day_breakout", label: "突破20日新高", short: "突破", icon: "↑" },
  { id: "opening_power", label: "開盤即戰力狙擊", short: "開盤", icon: "✥" },
  { id: "red_to_green", label: "昨日紅轉綠", short: "紅轉綠", icon: "↻" },
  { id: "intraday_2m", label: "2分K當沖雷達", short: "當沖", icon: "⌁" },
  { id: "investment_trust", label: "投信連買認養股", short: "投信", icon: "▦" },
  { id: "vcp", label: "VCP 波段收斂", short: "VCP", icon: "⌁" },
  { id: "ma_bull", label: "均線多頭排列", short: "均線", icon: "☰" },
  { id: "sync_backtest", label: "高同步率回測", short: "同步", icon: "▣" },
  { id: "overnight_chip", label: "隔日沖吸籌監控", short: "隔日", icon: "⌬" },
];

const STRATEGY_BY_ID = Object.fromEntries(STRATEGY_DEFS.map((item) => [item.id, item]));

function buildStrategyUniverse(stocks) {
  const values = stocks.map((s) => s.value || 0).sort((a, b) => a - b);
  const volumes = stocks.map((s) => s.tradeVolume || 0).sort((a, b) => a - b);
  const percents = stocks.map((s) => s.percent || 0).sort((a, b) => a - b);
  return stocks.map((stock) => ({
    ...stock,
    valueRank: rankValue(stock.value || 0, values),
    volumeRank: rankValue(stock.tradeVolume || 0, volumes),
    percentRank: rankValue(stock.percent || 0, percents),
    sector: SECTOR_MAP[stock.code] || "未分類",
    inst: getInstitutionTotal(stock.code),
  }));
}

function strategyHit(id, stock) {
  const pct = stock.percent || 0;
  const valueRank = stock.valueRank || 0;
  const volumeRank = stock.volumeRank || 0;
  const inst = stock.inst || getInstitutionTotal(stock.code);
  const smartMoney = inst.total + inst.trust * 1.4;

  const scoreBase = clamp(
    Math.round(35 + pct * 7 + valueRank * 0.24 + volumeRank * 0.18 + Math.sign(smartMoney) * 8),
    0,
    100
  );

  const rules = {
    momentum: {
      hit: pct >= 2.2 && valueRank >= 55,
      score: clamp(scoreBase + 10, 0, 100),
      reason: `漲幅 ${pct.toFixed(2)}%，成交值排名 ${valueRank}%，動能轉強。`,
    },
    main_force_chip: {
      hit: smartMoney > 0 && valueRank >= 45,
      score: clamp(scoreBase + (inst.trust > 0 ? 10 : 0), 0, 100),
      reason: `法人合計 ${formatInstitution(inst.total)}，投信 ${formatInstitution(inst.trust)}，資金偏買。`,
    },
    twenty_day_breakout: {
      hit: pct >= 3.5 && volumeRank >= 50,
      score: clamp(scoreBase + 12, 0, 100),
      reason: `強漲 ${pct.toFixed(2)}%，成交量排名 ${volumeRank}%，視為突破候選。`,
    },
    opening_power: {
      hit: pct >= 1.5 && volumeRank >= 70 && stock.change > 0,
      score: clamp(scoreBase + 8, 0, 100),
      reason: `盤中量能排名 ${volumeRank}%，漲幅維持在 ${pct.toFixed(2)}%。`,
    },
    red_to_green: {
      hit: pct > 0.2 && pct <= 3.2 && valueRank >= 48,
      score: clamp(scoreBase, 0, 100),
      reason: `由弱轉強候選，漲幅 ${pct.toFixed(2)}%，成交值排名 ${valueRank}%。`,
    },
    intraday_2m: {
      hit: pct >= 1 && valueRank >= 68 && volumeRank >= 68,
      score: clamp(scoreBase + 6, 0, 100),
      reason: `成交值與成交量同步進前段班，適合當沖雷達追蹤。`,
    },
    investment_trust: {
      hit: inst.trust > 0 && pct > -1,
      score: clamp(scoreBase + 15, 0, 100),
      reason: `投信買超 ${formatInstitution(inst.trust)}，股價未轉弱。`,
    },
    vcp: {
      hit: Math.abs(pct) <= 1.8 && valueRank >= 55 && volumeRank >= 45,
      score: clamp(72 + valueRank * 0.15 - Math.abs(pct) * 5, 0, 100),
      reason: `漲跌幅收斂在 ${pct.toFixed(2)}%，量能仍在市場前段。`,
    },
    ma_bull: {
      hit: pct > 0 && valueRank >= 52 && stock.close > 10,
      score: clamp(scoreBase + 4, 0, 100),
      reason: `價格收紅且成交值排名 ${valueRank}%，趨勢股優先觀察。`,
    },
    sync_backtest: {
      hit: pct > 0 && valueRank >= 65 && volumeRank >= 60 && smartMoney >= 0,
      score: clamp(scoreBase + 12, 0, 100),
      reason: `漲幅、量能、成交值與籌碼方向同步。`,
    },
    overnight_chip: {
      hit: pct >= 1.2 && valueRank >= 60 && (smartMoney > 0 || inst.trust > 0),
      score: clamp(scoreBase + 9, 0, 100),
      reason: `尾盤吸籌候選，法人合計 ${formatInstitution(inst.total)}，量價偏強。`,
    },
  };

  return rules[id] || { hit: false, score: 0, reason: "" };
}

function evaluateStrategyStock(stock) {
  const matches = STRATEGY_DEFS.map((strategy) => {
    const result = strategyHit(strategy.id, stock);
    return { ...strategy, ...result };
  }).filter((item) => item.hit);
  const score = matches.length
    ? Math.round(matches.reduce((sum, item) => sum + item.score, 0) / matches.length)
    : 0;
  return { ...stock, matches, score };
}

function renderStrategyScanner() {
  if (!strategyTable) return;
  const selected = [...selectedStrategyIds];
  strategyCards.forEach((card) => card.classList.toggle("selected", selectedStrategyIds.has(card.dataset.strategy)));
  strategyModeButtons.forEach((button) => button.classList.toggle("active", button.dataset.strategyMode === strategyMode));

  if (!latestStocks.length) {
    strategyTable.innerHTML = `<div class="empty-state">載入全台股股票池...</div>`;
    if (strategySummary) strategySummary.textContent = "正在載入上市櫃全市場股票資料。";
    loadStrategyStocks();
    return;
  }

  if (!selected.length) {
    strategyTable.innerHTML = `<div class="empty-state">請先點選左側至少一個策略。</div>`;
    if (strategySummary) strategySummary.textContent = "尚未選擇策略。";
    if (strategyMatchCount) strategyMatchCount.textContent = "0";
    if (strategyAvgScore) strategyAvgScore.textContent = "--";
    if (strategyTopHit) strategyTopHit.textContent = "--";
    return;
  }

  const keyword = strategyKeyword.trim().toLowerCase();
  const evaluated = buildStrategyUniverse(latestStocks).map(evaluateStrategyStock).filter((stock) => {
    const matchedIds = stock.matches.map((item) => item.id);
    const passMode = strategyMode === "all"
      ? selected.every((id) => matchedIds.includes(id))
      : selected.some((id) => matchedIds.includes(id));
    const passKeyword = !keyword || stock.code.includes(keyword) || stock.name.toLowerCase().includes(keyword);
    return passMode && passKeyword;
  }).sort((a, b) => b.matches.length - a.matches.length || b.score - a.score || b.value - a.value);

  const topRows = evaluated.slice(0, 50);
  const avgScore = topRows.length
    ? Math.round(topRows.reduce((sum, stock) => sum + stock.score, 0) / topRows.length)
    : 0;
  const topHit = topRows[0]?.matches.length || 0;
  const selectedLabels = selected.map((id) => STRATEGY_BY_ID[id]?.short || id).join(" + ");

  if (strategySummary) {
    strategySummary.textContent = `${strategyMode === "all" ? "全部符合" : "任一符合"}：${selectedLabels}`;
  }
  if (strategyMatchCount) strategyMatchCount.textContent = evaluated.length.toLocaleString("zh-TW");
  if (strategyAvgScore) strategyAvgScore.textContent = topRows.length ? avgScore : "--";
  if (strategyTopHit) strategyTopHit.textContent = topRows.length ? `${topHit}/11` : "--";

  if (!topRows.length) {
    strategyTable.innerHTML = `<div class="empty-state">目前沒有符合條件的股票，請切換「任一符合」或減少策略。</div>`;
    return;
  }

  strategyTable.innerHTML = `
    <div class="strategy-row strategy-head">
      <span>股票</span><span>分數</span><span>命中策略</span><span>漲幅</span><span>成交值</span><span>原因</span>
    </div>
    ${topRows.map((stock) => {
      const sign = stock.percent >= 0 ? "+" : "";
      const chips = stock.matches.slice(0, 5).map((item) => `<b>${item.icon} ${item.short}</b>`).join("");
      const reason = stock.matches[0]?.reason || "符合策略條件";
      return `
        <div class="strategy-row">
          <span><strong>${stock.code}</strong><small>${stock.name}</small></span>
          <em>${stock.score}</em>
          <span class="strategy-chips">${chips}${stock.matches.length > 5 ? `<b>+${stock.matches.length - 5}</b>` : ""}</span>
          <span class="${stock.percent >= 0 ? "down" : "up"}">${sign}${stock.percent.toFixed(2)}%</span>
          <span>${(stock.value / 100000000).toFixed(1)} 億</span>
          <small>${reason}</small>
        </div>
      `;
    }).join("")}
  `;
}

async function loadStrategyStocks() {
  if (strategyStocksLoading || latestStocks.length) return;
  strategyStocksLoading = true;
  try {
    let stocks = [];
    try {
      const payload = await fetchJson(endpoints.strategyStocks, 20000);
      stocks = normalizeArray(payload.stocks);
    } catch (error) {
      stocks = [];
    }

    try {
      if (!stocks.length) stocks = normalizeArray(await fetchJson(endpoints.stocks, 12000));
    } catch (error) {
      if (!stocks.length) stocks = [];
    }

    let parsed = stocks.map((stock) => {
      const code = valueOf(stock, ["證券代號", "Code"]);
      const name = valueOf(stock, ["證券名稱", "Name"]);
      const value = cleanNumber(valueOf(stock, ["成交金額", "TradeValue"]));
      const tradeVolume = cleanNumber(valueOf(stock, ["成交股數", "TradeVolume"]));
      return { code, name, value, tradeVolume, ...stockChange(stock) };
    }).filter((s) => s.code && s.name && s.close);

    if (!parsed.length) {
      const heatmapPayload = await fetchJson(endpoints.heatmap, 15000);
      parsed = normalizeArray(heatmapPayload.sectors).flatMap((sector) => {
        return normalizeArray(sector.stocks).map((stock) => {
          const close = cleanNumber(stock.close);
          const percent = cleanNumber(stock.pct);
          const previous = percent === -100 ? close : close / (1 + percent / 100);
          const change = close - previous;
          return {
            code: String(stock.code || ""),
            name: String(stock.name || ""),
            close,
            change,
            percent,
            value: cleanNumber(stock.value),
            tradeVolume: cleanNumber(stock.volume),
          };
        });
      }).filter((s) => s.code && s.name && s.close);
    }

    if (parsed.length) {
      latestStocks = parsed;
      renderStrategyScanner();
    } else if (strategyTable) {
      strategyTable.innerHTML = `<div class="empty-state">策略5目前沒有可篩選的股票資料。</div>`;
    }
  } catch (error) {
    if (strategyTable) {
      strategyTable.innerHTML = `<div class="empty-state">策略5暫時無法取得股票資料，請稍後重新整理。</div>`;
    }
  } finally {
    strategyStocksLoading = false;
  }
}

function getSectorColor(pct) {
  const strength = Math.min(Math.abs(pct) / 4, 1);
  const alpha = 0.18 + strength * 0.42;
  const edgeAlpha = 0.24 + strength * 0.34;
  const rgb = pct >= 0 ? "255, 79, 104" : "0, 210, 154";
  return `
    linear-gradient(135deg,
      rgba(${rgb}, ${alpha}) 0%,
      rgba(${rgb}, ${Math.max(alpha - 0.12, 0.08)}) 46%,
      rgba(16, 22, 35, 0.82) 100%),
    radial-gradient(circle at 18% 12%, rgba(255, 255, 255, 0.12), transparent 34%)
  `;
}

function formatInstitution(val) {
  if (val === undefined || val === null) return "--";
  const n = parseInt(val);
  if (isNaN(n)) return "--";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toLocaleString("zh-TW")}`;
}

function getInstColor(val) {
  const n = parseInt(val);
  if (isNaN(n) || n === 0) return "#aaa";
  return n > 0 ? "#e74c3c" : "#27ae60";
}

function openSectorModal(sector) {
  const stocks = sectorStocksCache[sector.name] || [];
  const existing = document.querySelector("#sector-modal");
  if (existing) existing.remove();

  const sortedStocks = [...stocks].sort((a, b) => b.pct - a.pct);
  const today = new Date();
  const dateStr = `${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}`;

  const modal = document.createElement("div");
  modal.id = "sector-modal";
  modal.style.cssText = `
    position:fixed; inset:0; z-index:9999;
    background:rgba(0,0,0,0.8);
    display:flex; align-items:center; justify-content:center;
    padding:20px;
  `;

  const sign = sector.pct >= 0 ? "+" : "";

  modal.innerHTML = `
    <div style="
      background:#12151f; border:1px solid #2a2f45; border-radius:12px;
      width:100%; max-width:1000px; max-height:88vh; overflow:hidden;
      display:flex; flex-direction:column;
    ">
      <div style="padding:16px 24px 12px; border-bottom:1px solid #2a2f45;">
        <div style="color:#aaa; font-size:11px; margin-bottom:4px;">產業即時動態</div>
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div>
            <div style="font-size:20px; font-weight:700; color:#fff;">${sector.name}</div>
            <div style="color:#888; font-size:12px; margin-top:2px;">${dateStr} · 全部 · ${sector.count} 檔 · 成交額排序</div>
          </div>
          <div style="display:flex; gap:12px; align-items:center;">
            <div style="background:#1a1e2e; border-radius:8px; padding:10px 16px; text-align:center;">
              <div style="color:#888; font-size:11px;">平均漲跌幅</div>
              <div style="font-size:22px; font-weight:700; color:${sector.pct >= 0 ? "#e74c3c" : "#27ae60"}">${sign}${sector.pct.toFixed(2)}%</div>
            </div>
            <div style="background:#1a1e2e; border-radius:8px; padding:10px 16px; text-align:center;">
              <div style="color:#888; font-size:11px;">成交金額</div>
              <div style="font-size:18px; font-weight:600; color:#fff">${sector.totalValue} 億</div>
            </div>
            <div style="background:#1a1e2e; border-radius:8px; padding:10px 16px; text-align:center;">
              <div style="color:#888; font-size:11px;">上漲 / 下跌</div>
              <div style="font-size:18px; font-weight:600;">
                <span style="color:#e74c3c">▲${sector.up}</span>
                <span style="color:#555; margin:0 4px;">/</span>
                <span style="color:#27ae60">▼${sector.down}</span>
              </div>
            </div>
            <div style="background:#1a1e2e; border-radius:8px; padding:10px 16px; text-align:center;">
              <div style="color:#888; font-size:11px;">成交張數排名</div>
              <div style="font-size:14px; font-weight:600; color:#7ec8e3">${sector.leader?.split(" ")[0] || "--"} ${sector.leader?.split(" ").slice(1).join(" ") || ""}</div>
            </div>
            <button id="modal-close" style="
              background:none; border:1px solid #333; color:#aaa;
              width:30px; height:30px; border-radius:6px; cursor:pointer;
              font-size:18px; line-height:1;
            ">×</button>
          </div>
        </div>
      </div>

      <div style="overflow-y:auto; flex:1;">
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="background:#0c0f1a; color:#666; text-align:right; position:sticky; top:0; z-index:1;">
              <th style="text-align:left; padding:10px 16px; font-weight:500; color:#888;">股票</th>
              <th style="padding:10px 8px; font-weight:500;">市場</th>
              <th style="padding:10px 12px; font-weight:500;">現價</th>
              <th style="padding:10px 12px; font-weight:500;">漲跌</th>
              <th style="padding:10px 12px; font-weight:500;">成交額</th>
              <th style="padding:10px 12px; font-weight:500;">成交量</th>
              <th style="padding:10px 12px; font-weight:500;">外資</th>
              <th style="padding:10px 12px; font-weight:500;">投信</th>
              <th style="padding:10px 12px; font-weight:500;">自營商</th>
              <th style="padding:10px 16px; font-weight:500;">法人</th>
            </tr>
          </thead>
          <tbody>
            ${sortedStocks.map((s, i) => {
              const pctColor = s.pct > 0 ? "#e74c3c" : s.pct < 0 ? "#27ae60" : "#aaa";
              const pctSign = s.pct >= 0 ? "+" : "";
              const inst = institutionData[s.code] || {};
              const foreign = inst.foreign ?? null;
              const trust = inst.trust ?? null;
              const dealer = inst.dealer ?? null;
              const total = (foreign !== null && trust !== null && dealer !== null)
                ? foreign + trust + dealer : null;
              return `
                <tr style="border-bottom:1px solid #161925; ${i % 2 === 0 ? "" : "background:#0c0f1a"}">
                  <td style="padding:10px 16px;">
                    <div style="color:#7ec8e3; font-weight:600; font-size:13px;">${s.code} ${s.name}</div>
                    <div style="color:#555; font-size:11px; margin-top:2px;">${sector.name}</div>
                  </td>
                  <td style="padding:10px 8px; text-align:center; color:#888; font-size:12px;">上市</td>
                  <td style="padding:10px 12px; text-align:right; color:#fff; font-weight:600;">${s.close.toLocaleString("zh-TW")}</td>
                  <td style="padding:10px 12px; text-align:right; color:${pctColor}; font-weight:700;">${pctSign}${s.pct.toFixed(2)}%</td>
                  <td style="padding:10px 12px; text-align:right; color:#aaa;">${(s.value/100000000).toFixed(1)} 億</td>
                  <td style="padding:10px 12px; text-align:right; color:#aaa;">${(s.volume/1000).toFixed(0)} 張</td>
                  <td style="padding:10px 12px; text-align:right; color:${getInstColor(foreign)}; font-weight:500;">${formatInstitution(foreign)}</td>
                  <td style="padding:10px 12px; text-align:right; color:${getInstColor(trust)}; font-weight:500;">${formatInstitution(trust)}</td>
                  <td style="padding:10px 12px; text-align:right; color:${getInstColor(dealer)}; font-weight:500;">${formatInstitution(dealer)}</td>
                  <td style="padding:10px 16px; text-align:right; color:${getInstColor(total)}; font-weight:600;">${formatInstitution(total)}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
        ${sortedStocks.length === 0 ? `<div style="text-align:center; padding:40px; color:#666;">載入個股資料中...</div>` : ""}
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector("#modal-close").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
}

// ★ 修改：從 API 回傳的 stocks 直接存進 cache
function renderHeatmapSectors(sectors) {
  if (!sectors || !sectors.length) {
    heatmap.innerHTML = `<div class="empty-state">等待產業資料...</div>`;
    return;
  }

  // 把個股資料存進 cache
  sectors.forEach(s => {
    if (s.stocks && s.stocks.length) {
      sectorStocksCache[s.name] = s.stocks;
    }
  });

  heatmap.innerHTML = sectors.map(s => {
    const pct = s.pct || 0;
    const sign = pct >= 0 ? "+" : "";
    const bg = getSectorColor(pct);
    const toneClass = pct >= 0 ? "hot" : "cold";
    // 不把 stocks 放進 data-sector，太大了
    const sectorMeta = { name: s.name, pct: s.pct, totalValue: s.totalValue, count: s.count, up: s.up, down: s.down, flat: s.flat, leader: s.leader };
    return `
      <article class="sector-card ${toneClass}" style="--sector-bg:${bg}; cursor:pointer;" data-sector="${encodeURIComponent(JSON.stringify(sectorMeta))}">
        <h3>${s.name}<span>${sign}${pct.toFixed(2)}%</span></h3>
        <p>${s.count} 檔 · ${s.totalValue} 億</p>
        <small>
          <span>▲ ${s.up}</span><b>▼ ${s.down}</b>
          <span>${s.leader || "--"}</span>
        </small>
      </article>
    `;
  }).join("");

  heatmap.querySelectorAll(".sector-card").forEach(card => {
    card.addEventListener("click", () => {
      const sector = JSON.parse(decodeURIComponent(card.dataset.sector));
      openSectorModal(sector);
    });
  });
}

function renderIndexes(indexes, futuresNear, futuresNext, marketStatus, otcSignal) {
  const targets = [["發行量加權", "加權指數"], ["櫃買", "櫃買指數"]];
  targets.forEach(([keyword, label], index) => {
    const record = indexes.find((item) => String(valueOf(item, ["指數", "指數/報酬指數"])).includes(keyword));
    if (!record || !metricCards[index]) return;
    const sign = valueOf(record, ["漲跌", "漲跌(+/-)"]);
    const points = valueOf(record, ["漲跌點數"]);
    const percent = valueOf(record, ["漲跌百分比", "漲跌百分比(%)"]);
    const close = valueOf(record, ["收盤指數"]);
    const trendClass = sign === "-" ? "up" : "down";
    metricCards[index].innerHTML = `
      <span>↗ ${label}</span>
      <strong>${formatNumber(close)}</strong>
      <em class="${trendClass}">${formatChange(sign, points, percent)}</em>
      ${index === 1 && otcSignal ? `<small class="metric-signal ${otcSignal.side === "down" ? "green" : "red"}">${otcSignal.label}</small>` : ""}
    `;
  });

  const statusLabel = {
    day:    "日盤進行中",
    night:  "夜盤進行中",
    closed: "休市",
  }[marketStatus] ?? "";

  if (metricCards[2]) {
    if (futuresNear && futuresNear.price && parseFloat(futuresNear.price) > 0) {
      const sign = String(futuresNear.change || "").startsWith("-") ? "-" : "+";
      metricCards[2].innerHTML = `
        <span>⇅ 台指期夜盤</span>
        <strong>${formatNumber(futuresNear.price, 0)}</strong>
        <em class="${sign === "-" ? "up" : "down"}">${futuresNear.change || "--"}　(${futuresNear.pct || "--"})</em>
        ${futuresNear.basisLabel ? `<small class="metric-signal ${futuresNear.basisSide === "short" ? "green" : futuresNear.basisSide === "long" ? "red" : ""}">${futuresNear.basisLabel}</small>` : statusLabel ? `<small style="color:#666; font-size:11px; margin-top:2px;">${statusLabel}</small>` : ""}
      `;
    } else {
      metricCards[2].innerHTML = `<span>⇅ 台指期夜盤</span><strong>--</strong><em>${statusLabel || "等待資料"}</em>`;
    }
  }

  if (metricCards[3]) metricCards[3].remove();
}

function formatChipDate(dateStr) {
  if (!dateStr || dateStr.length !== 8) return "等待盤後資料";
  return `日期: ${dateStr.slice(0, 4)}/${dateStr.slice(4, 6)}/${dateStr.slice(6, 8)}`;
}

function renderChipTradeTable() {
  const body = document.querySelector("#chip-trade-body");
  const dateEl = document.querySelector("#chip-trade-date");
  const sortEl = document.querySelector("#chip-sort");
  if (!body) return;

  if (dateEl) {
    const now = new Date();
    const time = now.toLocaleTimeString("zh-TW", { hour12: false });
    dateEl.textContent = `${formatChipDate(institutionDate)}　更新 ${time}`;
  }

  const rows = latestStocks
    .map((stock) => {
      const code = String(stock.code || stock.Code || "");
      const inst = institutionData[code];
      if (!inst) return null;
      const foreign = Number(inst.foreign) || 0;
      const trust = Number(inst.trust) || 0;
      const total = Number(inst.total) || foreign + trust + (Number(inst.dealer) || 0);
      if (foreign <= 0 || trust <= 0) return null;
      return {
        code,
        name: stock.name || code,
        price: cleanNumber(stock.close),
        change: cleanNumber(stock.change),
        percent: cleanNumber(stock.percent),
        volume: cleanNumber(stock.tradeVolume),
        value: cleanNumber(stock.value),
        foreign,
        trust,
        total,
        foreignStreak: Number(inst.foreignStreak) || 0,
        trustStreak: Number(inst.trustStreak) || 0,
        jointStreak: Number(inst.jointStreak) || 0,
      };
    })
    .filter(Boolean);

  if (!rows.length && Object.keys(institutionData).length) {
    Object.entries(institutionData).forEach(([code, inst]) => {
      const foreign = Number(inst.foreign) || 0;
      const trust = Number(inst.trust) || 0;
      if (foreign <= 0 || trust <= 0) return;
      rows.push({
        code,
        name: inst.name || code,
        price: 0,
        change: 0,
        percent: 0,
        volume: 0,
        value: 0,
        foreign,
        trust,
        total: Number(inst.total) || foreign + trust + (Number(inst.dealer) || 0),
        foreignStreak: Number(inst.foreignStreak) || 0,
        trustStreak: Number(inst.trustStreak) || 0,
        jointStreak: Number(inst.jointStreak) || 0,
      });
    });
  }

  const sortBy = sortEl?.value || "trustForeign";
  rows.sort((a, b) => {
    if (sortBy === "trust") return b.trust - a.trust;
    if (sortBy === "foreign") return b.foreign - a.foreign;
    if (sortBy === "pct") return b.percent - a.percent;
    if (sortBy === "value") return b.value - a.value;
    return (b.jointStreak - a.jointStreak) || ((b.foreign + b.trust) - (a.foreign + a.trust));
  });

  const shown = rows.slice(0, 80);
  if (!shown.length) {
    body.innerHTML = `<tr><td colspan="12">目前沒有符合「外資 + 投信同買」的資料，盤後資料更新後會自動刷新。</td></tr>`;
    return;
  }

  body.innerHTML = shown.map((row, index) => {
    const up = row.change >= 0;
    return `
      <tr class="${index === 0 ? "highlight" : ""}">
        <td><a href="#" data-chip-code="${row.code}">${row.code}</a></td>
        <td>${row.name}</td>
        <td>${formatNumber(row.price, row.price >= 100 ? 0 : 2)}</td>
        <td class="${up ? "red" : "green"}">${up ? "+" : ""}${formatNumber(row.change, 2)}</td>
        <td class="${row.percent >= 0 ? "red" : "green"}">${formatNumber(row.percent, 2)}</td>
        <td>${Math.round(row.volume).toLocaleString("zh-TW")}</td>
        <td class="${row.foreign >= 0 ? "red" : "green"}">${formatInstitution(row.foreign)}</td>
        <td class="${row.trust >= 0 ? "red" : "green"}">${formatInstitution(row.trust)}</td>
        <td>${row.foreignStreak} 日</td>
        <td>${row.trustStreak} 日</td>
        <td>${row.jointStreak} 日</td>
        <td class="${row.total >= 0 ? "red" : "green"}">${formatInstitution(row.total)}</td>
      </tr>
    `;
  }).join("");
}

function stockChange(stock) {
  const change = cleanNumber(valueOf(stock, ["漲跌價差", "Change", "漲跌"]));
  const close = cleanNumber(valueOf(stock, ["收盤價", "ClosingPrice", "收盤"]));
  const previous = close - change;
  const percent = previous ? (change / previous) * 100 : 0;
  return { change, close, percent };
}

function buildSectorStocksCache(stocks) {
  for (const stock of stocks) {
    const code = valueOf(stock, ["證券代號", "Code"]);
    const name = valueOf(stock, ["證券名稱", "Name"]);
    const change = parseFloat(valueOf(stock, ["漲跌價差", "Change"])) || 0;
    const close = parseFloat(valueOf(stock, ["收盤價", "ClosingPrice"])) || 0;
    const value = parseFloat(valueOf(stock, ["成交金額", "TradeValue"])) || 0;
    const volume = parseFloat(valueOf(stock, ["成交股數", "TradeVolume"])) || 0;
    if (!code || !close) continue;
    const prev = close - change;
    const pct = prev > 0 ? (change / prev) * 100 : 0;
    const industry = SECTOR_MAP[code];
    if (!industry) continue;
    if (!sectorStocksCache[industry]) sectorStocksCache[industry] = [];
    // 避免重複
    if (!sectorStocksCache[industry].find(s => s.code === code)) {
      sectorStocksCache[industry].push({ code, name, close, change, pct, value, volume });
    }
  }
}

function renderStocks(stocks) {
  const parsed = stocks.map((stock) => {
    const code = valueOf(stock, ["證券代號", "Code"]);
    const name = valueOf(stock, ["證券名稱", "Name"]);
    const value = cleanNumber(valueOf(stock, ["成交金額", "TradeValue"]));
    const tradeVolume = cleanNumber(valueOf(stock, ["成交股數", "TradeVolume"]));
    return { code, name, value, tradeVolume, ...stockChange(stock) };
  }).filter((s) => s.code && s.name && s.close);

  if (!parsed.length) return;
  latestStocks = parsed;
  buildSectorStocksCache(stocks);

  const up = parsed.filter((s) => s.change > 0).length;
  const down = parsed.filter((s) => s.change < 0).length;
  const flat = parsed.length - up - down;
  const totalValue = parsed.reduce((sum, s) => sum + s.value, 0) / 100000000;
  const upPercent = (up / parsed.length) * 100;

  strengthPanel.querySelector(".strength-head p").textContent = `${parsed.length.toLocaleString("zh-TW")} 檔 · 上漲 ${up.toLocaleString("zh-TW")} 檔`;
  strengthPanel.querySelector(".strength-head > strong").innerHTML = `${upPercent.toFixed(1)}%<span>上漲比例</span>`;

  const statValues = strengthPanel.querySelectorAll(".stats-row strong");
  statValues[0].textContent = up.toLocaleString("zh-TW");
  statValues[1].textContent = down.toLocaleString("zh-TW");
  statValues[2].textContent = flat.toLocaleString("zh-TW");
  statValues[3].textContent = `${totalValue.toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 億`;

  const topStocks = [...parsed].filter((s) => s.percent > 0).sort((a, b) => b.percent - a.percent).slice(0, 22);
  tickerStrip.innerHTML = topStocks.slice(0, 12).map((s, i) =>
    `<span class="${i%3===0?"down":""}">${s.code} ${s.name} ${s.percent.toFixed(2)}%</span>`
  ).join("");

  renderStockTable(topStocks);
  renderStrategyScanner();
  renderChipTradeTable();
  terminalMessage.textContent = `掃描完成：${parsed.length.toLocaleString("zh-TW")} 檔，強勢股 ${topStocks.length} 檔`;
}

function renderStockTable(stocks) {
  const rows = stocks.slice(0, 10);
  watchCount.textContent = `TOP ${rows.length}`;
  if (!rows.length) { stockTable.innerHTML = `<div class="empty-state">尚無資料</div>`; return; }
  stockTable.innerHTML = `
    <div class="stock-row stock-head">
      <span>代號</span><span>名稱</span><span>收盤</span><span>漲幅</span><span>成交值</span>
    </div>
    ${rows.map((s) => `
      <div class="stock-row">
        <span>${s.code}</span><strong>${s.name}</strong>
        <span>${s.close.toLocaleString("zh-TW")}</span>
        <em class="${s.change>=0?"down":"up"}">${s.percent>=0?"+":""}${s.percent.toFixed(2)}%</em>
        <span>${(s.value/100000000).toFixed(1)} 億</span>
      </div>
    `).join("")}
  `;
}

function searchStocks(query) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) { renderStockTable([...latestStocks].filter((s)=>s.percent>0).sort((a,b)=>b.percent-a.percent)); return; }
  const results = latestStocks.filter((s)=>s.code.includes(keyword)||s.name.toLowerCase().includes(keyword)).sort((a,b)=>b.value-a.value).slice(0,10);
  renderStockTable(results);
  terminalMessage.textContent = results.length ? `找到 ${results.length} 筆符合「${query}」` : `沒有找到「${query}」`;
}

function tickClock() {
  const now = new Date();
  const month = String(now.getMonth()+1).padStart(2,"0");
  const day = String(now.getDate()).padStart(2,"0");
  const time = now.toLocaleTimeString("zh-TW",{hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"});
  refreshLine.textContent = `${month}/${day}  重新整理　更新 ${time}`;
  headerTimes.forEach((item)=>{item.textContent=`${month}/${day} ${time.slice(0,5)}`;});
}

function showView(viewName, activeLink) {
  Object.entries(viewPanels).forEach(([name, panel])=>{
    panel.hidden = name !== viewName;
    panel.classList.toggle("active", name === viewName);
  });
  viewLinks.forEach((link)=>link.classList.toggle("active", link===activeLink));
  const focusTarget = activeLink.dataset.focus ? document.querySelector(`#${activeLink.dataset.focus}`) : null;
  if (focusTarget) setTimeout(()=>focusTarget.focus(),0);
}

// ★ 前端直接抓台指期
async function fetchFuturesDirect() {
  try {
    const res = await fetch("https://mis.taifex.com.tw/futures/api/getQuoteList", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Referer": "https://mis.taifex.com.tw/",
        "Origin": "https://mis.taifex.com.tw",
      },
      body: JSON.stringify({
        MarketType: "0",
        SymbolType: "F",
        KindID: "1",
        CID: "TXF",
        ExpireMonth: "",
        RowSize: "5",
        PageNo: "1",
        Language: "zh-tw",
      }),
    });
    const data = await res.json();
    const list = data?.RtnData?.QuoteList || [];
    if (list.length === 0) return { near: null, next: null };

    const toItem = (item) => {
      if (!item) return null;
      const price = parseFloat(item.CLastPrice?.replace(/,/g, "")) || 0;
      const prev  = parseFloat(item.CRefPrice?.replace(/,/g, "")) || 0;
      if (price === 0) return null;
      const diff = price - prev;
      const pct  = prev ? (diff / prev * 100) : 0;
      const sign = diff >= 0 ? "+" : "-";
      return {
        name:   item.CName || "台指期",
        month:  item.CID   || "",
        price:  price.toFixed(0),
        change: `${sign}${Math.abs(diff).toFixed(0)}`,
        pct:    `${sign}${Math.abs(pct).toFixed(2)}%`,
        volume: item.CTotalVolume || "--",
      };
    };

    return { near: toItem(list[0]), next: toItem(list[1] || null) };
  } catch (e) {
    return { near: null, next: null };
  }
}

async function loadMarketData() {
  try {
    const payload = await fetchJson(endpoints.backend, 12000);

    if (!payload.ok) throw new Error("Backend failed");

    const near = payload.futuresNear || payload.futures || null;
    const next = payload.futuresNext || null;

    renderIndexes(
      normalizeArray(payload.indexes),
      near,
      next,
      payload.marketStatus || null,
      payload.otcSignal || null
    );
    renderStocks(normalizeArray(payload.stocks));
  } catch (e) {
    try {
      const stocks = await fetchJson(endpoints.stocks);
      renderStocks(Array.isArray(stocks) ? stocks : []);
    } catch (e2) {
      tickerStrip.innerHTML = `<span>官方資料暫時無法連線</span>`;
    }
  }
}

async function loadHeatmap() {
  heatmap.innerHTML = `<div class="empty-state">載入產業資料中...</div>`;
  try {
    const data = await fetchJson(endpoints.heatmap, 15000);
    if (data.ok && data.sectors) renderHeatmapSectors(data.sectors);
  } catch (e) {
    heatmap.innerHTML = `<div class="empty-state">產業資料載入失敗</div>`;
  }
}

async function loadInstitution() {
  try {
    const data = await fetchJson(endpoints.institution, 12000);
    if (data.ok && data.data) {
      institutionData = data.data;
      institutionDate = data.usedDate || "";
    }
    renderStrategyScanner();
    renderChipTradeTable();
  } catch (e) {}
}

tickClock();
loadMarketData();
loadHeatmap();
loadInstitution();
stockSearch.addEventListener("input", (e)=>searchStocks(e.target.value));
viewLinks.forEach((link)=>{
  link.addEventListener("click",(e)=>{
    e.preventDefault();
    showView(link.dataset.view, link);
  });
});
document.querySelectorAll("[data-chip-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    chipMode = button.dataset.chipMode || "realtime";
    document.querySelectorAll("[data-chip-mode]").forEach((item) => item.classList.toggle("active", item === button));
    renderChipTradeTable();
  });
});
document.querySelector("#chip-sort")?.addEventListener("change", renderChipTradeTable);
setInterval(tickClock, 1000);
setInterval(loadMarketData, 15*1000);
setInterval(loadHeatmap, 10*60*1000);
setInterval(loadInstitution, 10*60*1000);

// ===== 自選股功能 =====
const watchlistView = document.querySelector("#watchlist-view");
const watchlistStocks = document.querySelector("#watchlist-stocks");
const watchlistAnalysis = document.querySelector("#watchlist-analysis");
const watchlistSearchInput = document.querySelector("#watchlist-search-input");
const watchlistAddBtn = document.querySelector("#watchlist-add-btn");
const watchlistRefresh = document.querySelector("#watchlist-refresh");

function getWatchlist() {
  try { return JSON.parse(localStorage.getItem("fuman_watchlist") || "[]"); } catch { return []; }
}

function saveWatchlist(list) {
  localStorage.setItem("fuman_watchlist", JSON.stringify(list));
}

function showTVAnalysis(code, name) {
  const symbol = `TWSE:${code}`;
  watchlistAnalysis.innerHTML = `
    <div style="width:100%; padding:16px 20px 0; border-bottom:1px solid #2a2f45;">
      <div style="color:#aaa; font-size:12px;">技術分析</div>
      <div style="font-size:18px; font-weight:700; color:#fff; margin-top:2px;">${code} ${name}</div>
    </div>
    <div style="flex:1; width:100%; display:flex; flex-direction:column; gap:0;">
      <div class="tradingview-widget-container" style="flex:1; min-height:460px;">
        <div class="tradingview-widget-container__widget"></div>
        <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js" async>
        {
          "interval": "1D",
          "width": "100%",
          "isTransparent": true,
          "height": "100%",
          "symbol": "${symbol}",
          "showIntervalTabs": true,
          "displayMode": "single",
          "locale": "zh_TW",
          "colorTheme": "dark"
        }
        <\/script>
      </div>
    </div>
  `;
}

function signalLabel(score) {
  if (score >= 76) return "強力買入";
  if (score >= 58) return "買入";
  if (score >= 43) return "中立";
  if (score >= 26) return "賣出";
  return "強力賣出";
}

function signalClass(score) {
  if (score >= 58) return "buy";
  if (score >= 43) return "neutral";
  return "sell";
}

const technicalTimeframes = [
  { key: "1", label: "1分", momentum: 1.55, volume: 0.08, money: 0.45 },
  { key: "5", label: "5分", momentum: 1.42, volume: 0.10, money: 0.55 },
  { key: "15", label: "15分", momentum: 1.28, volume: 0.12, money: 0.70 },
  { key: "30", label: "30分", momentum: 1.14, volume: 0.14, money: 0.82 },
  { key: "60", label: "1小時", momentum: 1.02, volume: 0.16, money: 0.95 },
  { key: "120", label: "2小時", momentum: 0.94, volume: 0.17, money: 1.04 },
  { key: "240", label: "4小時", momentum: 0.88, volume: 0.18, money: 1.12 },
  { key: "1D", label: "1天", momentum: 0.78, volume: 0.20, money: 1.28 },
  { key: "1W", label: "1週", momentum: 0.58, volume: 0.23, money: 1.45 },
  { key: "1M", label: "1月", momentum: 0.42, volume: 0.26, money: 1.62 },
];

let selectedTechnicalTimeframe = localStorage.getItem("fuman-technical-timeframe") || "1D";

function getTechnicalTimeframe(key = selectedTechnicalTimeframe) {
  return technicalTimeframes.find((item) => item.key === key) || technicalTimeframes.find((item) => item.key === "1D");
}

function buildTimeframeButtons(activeKey) {
  return technicalTimeframes.map((item) => `
    <button class="ta-timeframe ${item.key === activeKey ? "active" : ""}" type="button" data-timeframe="${item.key}">
      ${item.label}
    </button>
  `).join("");
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function mixColor(from, to, ratio) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const blend = (start, end) => Math.round(start + (end - start) * ratio);
  return `rgb(${blend(a.r, b.r)}, ${blend(a.g, b.g)}, ${blend(a.b, b.b)})`;
}

function colorAtGaugeAngle(angle) {
  const stops = [
    { angle: 0, color: "#2f8cff" },
    { angle: 42, color: "#4d6cf2" },
    { angle: 86, color: "#8743b9" },
    { angle: 126, color: "#d43d88" },
    { angle: 158, color: "#ff4964" },
    { angle: 180, color: "#ff4964" },
  ];
  for (let i = 1; i < stops.length; i++) {
    if (angle <= stops[i].angle) {
      const prev = stops[i - 1];
      const next = stops[i];
      const ratio = (angle - prev.angle) / (next.angle - prev.angle);
      return mixColor(prev.color, next.color, ratio);
    }
  }
  return stops[stops.length - 1].color;
}

function gaugeGradient(score) {
  const fill = clamp(score, 0, 100) / 100 * 180;
  const baseStops = [
    { angle: 0, color: "#2f8cff" },
    { angle: 42, color: "#4d6cf2" },
    { angle: 86, color: "#8743b9" },
    { angle: 126, color: "#d43d88" },
    { angle: 158, color: "#ff4964" },
  ];
  const visibleStops = baseStops
    .filter((stop) => stop.angle <= fill)
    .map((stop) => `${stop.color} ${stop.angle}deg`);
  const fillColor = colorAtGaugeAngle(fill);

  if (fill <= 1) {
    return "conic-gradient(from 270deg at 50% 100%, #050711 0deg 180deg, transparent 180deg 360deg)";
  }

  return `conic-gradient(from 270deg at 50% 100%, ${visibleStops.join(", ")}, ${fillColor} ${fill.toFixed(1)}deg, #050711 ${fill.toFixed(1)}deg 180deg, transparent 180deg 360deg)`;
}

function buildTechnicalSummary(stock, timeframeKey = selectedTechnicalTimeframe) {
  const timeframe = getTechnicalTimeframe(timeframeKey);
  const pct = stock?.percent || 0;
  const inst = getInstitutionTotal(stock?.code);
  const smartMoney = inst.total + inst.trust * 1.35;
  const volumeValues = latestStocks.map(s => s.tradeVolume || 0).filter(Boolean).sort((a, b) => a - b);
  const volumeRank = stock?.tradeVolume && volumeValues.length ? rankValue(stock.tradeVolume, volumeValues) : 50;
  const valueRank = stock?.value ? rankValue(stock.value, latestStocks.map(s => s.value || 0).sort((a, b) => a - b)) : 50;
  const moneyBias = Math.sign(smartMoney) * 8 * timeframe.money;
  const momentumScore = clamp(Math.round(50 + pct * 8 * timeframe.momentum + valueRank * timeframe.volume + moneyBias), 0, 100);
  const oscillatorScore = clamp(Math.round(50 + pct * 10 * timeframe.momentum + volumeRank * timeframe.volume), 0, 100);
  const maScore = clamp(Math.round(48 + pct * 9 * (0.74 + timeframe.money * 0.18) + valueRank * timeframe.volume + Math.sign(stock?.change || 0) * 6), 0, 100);
  const sell = clamp(Math.round((100 - momentumScore) / 6), 0, 15);
  const buy = clamp(Math.round(momentumScore / 6), 1, 15);
  const neutral = clamp(17 - sell - buy, 0, 17);

  return {
    score: momentumScore,
    oscillatorScore,
    maScore,
    sell,
    neutral,
    buy,
    foreign: inst.foreign,
    trust: inst.trust,
    hasInstitution: Boolean(institutionData[stock?.code]),
    volumeRank: stock?.tradeVolume && volumeValues.length ? volumeRank : null,
  };
}

function formatVolumeMetric(stock, analysis) {
  if (analysis.volumeRank !== null) return `${analysis.volumeRank}%`;
  if (stock?.tradeVolume) return `${Math.round(stock.tradeVolume).toLocaleString("zh-TW")}張`;
  return "載入中";
}

function gaugeMarkup(title, score, size = "small") {
  const rotation = Math.round(180 + (clamp(score, 0, 100) / 100) * 180);
  const label = signalLabel(score);
  const tone = signalClass(score);
  const gradient = gaugeGradient(score);
  const sell = clamp(Math.round((100 - score) / 6), 0, 15);
  const buy = clamp(Math.round(score / 6), 1, 15);
  const neutral = clamp(17 - sell - buy, 0, 17);
  return `
    <article class="ta-gauge-card ${size}">
      <h3>${title}</h3>
      <div class="ta-gauge ${tone}" style="--needle:${rotation}deg; --gauge-bg:${gradient};">
        <span class="gauge-label l1">強力賣出</span>
        <span class="gauge-label l2">賣出</span>
        <span class="gauge-label l3">中立</span>
        <span class="gauge-label l4">買入</span>
        <span class="gauge-label l5">強力買入</span>
        <i></i>
      </div>
      <strong class="${tone}">${label}</strong>
      <div class="ta-gauge-votes">
        <div><span>賣出</span><b class="sell">${sell}</b></div>
        <div><span>中立</span><b>${neutral}</b></div>
        <div><span>買入</span><b class="buy">${buy}</b></div>
      </div>
    </article>
  `;
}

function scoreTone(score) {
  if (score >= 70) return "good";
  if (score >= 45) return "mid";
  return "bad";
}

function buildDashboardScores(stock, analysis) {
  const pct = stock?.percent || 0;
  const volumeScore = analysis.volumeRank ?? 50;
  const chipScore = analysis.hasInstitution
    ? clamp(Math.round(50 + Math.sign(analysis.foreign) * 16 + Math.sign(analysis.trust) * 22), 0, 100)
    : null;
  const shortScore = clamp(Math.round(analysis.oscillatorScore * 0.58 + analysis.score * 0.28 + volumeScore * 0.14), 0, 100);
  const swingScore = clamp(Math.round(analysis.maScore * 0.52 + analysis.score * 0.28 + (chipScore ?? 50) * 0.20), 0, 100);
  const tags = [];

  if (pct >= 7) tags.push({ text: "漲幅過熱", tone: "bad" });
  if (pct <= -7) tags.push({ text: "跌幅偏深", tone: "bad" });
  if (analysis.volumeRank !== null && analysis.volumeRank >= 80) tags.push({ text: "量能放大", tone: "good" });
  if (analysis.volumeRank !== null && analysis.volumeRank <= 25) tags.push({ text: "量能偏冷", tone: "mid" });
  if (!analysis.hasInstitution) tags.push({ text: "法人盤後", tone: "mid" });
  if (analysis.hasInstitution && analysis.foreign > 0 && analysis.trust > 0) tags.push({ text: "法人同步買", tone: "good" });
  if (!tags.length) tags.push({ text: "正常觀察", tone: "mid" });

  return {
    shortScore,
    swingScore,
    chipScore,
    tags: tags.slice(0, 3),
  };
}

function dashboardScoreMarkup(stock, analysis) {
  const scores = buildDashboardScores(stock, analysis);
  const chipText = scores.chipScore === null ? "盤後" : scores.chipScore;
  const tagMarkup = scores.tags.map((tag) => `<span class="${tag.tone}">${tag.text}</span>`).join("");

  return `
    <section class="ta-score-strip">
      <article class="${scoreTone(scores.shortScore)}">
        <span>短線分</span>
        <strong>${scores.shortScore}</strong>
        <em>看盤動能</em>
      </article>
      <article class="${scoreTone(scores.swingScore)}">
        <span>波段分</span>
        <strong>${scores.swingScore}</strong>
        <em>趨勢強弱</em>
      </article>
      <article class="risk">
        <span>狀態提示</span>
        <div>${tagMarkup}</div>
      </article>
    </section>
  `;
}

async function showTradingDashboard(code, name) {
  const fallback = latestStocks.find(s => s.code === code) || { code, name, close: 0, change: 0, percent: 0 };
  const stock = await fetchStockPrice(code) || fallback;
  const activeTimeframe = getTechnicalTimeframe();
  const analysis = buildTechnicalSummary(stock, activeTimeframe.key);
  const sign = stock.change >= 0 ? "+" : "";
  const changeClass = stock.change >= 0 ? "down" : "up";
  const trustText = analysis.hasInstitution ? `${analysis.trust >= 0 ? "+" : ""}${(analysis.trust / 1000).toFixed(0)}k` : "盤後";
  const trustClass = analysis.hasInstitution ? (analysis.trust >= 0 ? "down" : "up") : "";
  const volumeText = formatVolumeMetric(stock, analysis);

  watchlistAnalysis.innerHTML = `
    <div class="ta-dashboard">
      <header class="ta-head">
        <div>
          <span>技術分析</span>
          <h2>${code} ${stock.name || name || ""}</h2>
        </div>
        <div class="ta-price">
          <strong>${stock.close ? stock.close.toLocaleString("zh-TW") : "--"}</strong>
          <em class="${changeClass}">${sign}${(stock.change || 0).toFixed(2)} (${sign}${(stock.percent || 0).toFixed(2)}%)</em>
        </div>
      </header>

      <section class="ta-period-panel">
        <h3><span>${code}</span>的技術分析</h3>
        <nav class="ta-timeframes" aria-label="技術分析週期">
          ${buildTimeframeButtons(activeTimeframe.key)}
        </nav>
      </section>

      <section class="ta-main">
        ${gaugeMarkup("總覽", analysis.score, "large")}
      </section>

      ${dashboardScoreMarkup(stock, analysis)}

      <section class="ta-grid">
        ${gaugeMarkup("震盪指標", analysis.oscillatorScore)}
        ${gaugeMarkup("移動平均線", analysis.maScore)}
      </section>

    </div>
  `;

  watchlistAnalysis.querySelectorAll(".ta-timeframe").forEach((button) => {
    button.addEventListener("click", () => {
      selectedTechnicalTimeframe = button.dataset.timeframe;
      localStorage.setItem("fuman-technical-timeframe", selectedTechnicalTimeframe);
      showTradingDashboard(code, stock.name || name);
    });
  });
}

function parseQuoteNumber(...values) {
  for (const value of values) {
    const number = Number(String(value ?? "").replace(/,/g, ""));
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

async function fetchDailyStockFallback(code) {
  try {
    const rows = await fetchJson(endpoints.stocks, 8000);
    const item = normalizeArray(rows).find((row) => String(row.Code || "") === code);
    if (!item) return null;
    const close = cleanNumber(item.ClosingPrice);
    const change = cleanNumber(item.Change);
    const previous = close - change;
    const percent = previous ? (change / previous) * 100 : 0;
    return { code, name: item.Name || code, close, change, percent, tradeVolume: cleanNumber(item.TradeVolume) };
  } catch {
    return null;
  }
}

async function fetchHeatmapStockFallback(code) {
  try {
    const payload = await fetchJson(endpoints.heatmap, 12000);
    const sectors = normalizeArray(payload.sectors);
    for (const sector of sectors) {
      const item = normalizeArray(sector.stocks).find((row) => String(row.code || "") === code);
      if (!item) continue;
      const close = cleanNumber(item.close);
      const percent = cleanNumber(item.pct);
      const prev = cleanNumber(item.prev) || (percent === -100 ? close : close / (1 + percent / 100));
      const change = cleanNumber(item.change) || (close - prev);
      return {
        code,
        name: item.name || code,
        close,
        change,
        percent,
        value: cleanNumber(item.value),
        tradeVolume: cleanNumber(item.volume),
      };
    }
  } catch {}
  return null;
}

async function fetchStockPrice(code) {
  const cached = latestStocks.find(s => s.code === code) || null;
  try {

    const url = `/api/proxy?code=${code}`;
    const data = await fetchJson(url, 5000);
    const item = data?.msgArray?.[0];
    if (!item) return await fetchHeatmapStockFallback(code) || await fetchDailyStockFallback(code) || cached;

    const close = parseQuoteNumber(item.z, item.y, item.o, item.h, item.l);
    const prev = parseQuoteNumber(item.y, item.z, item.o, item.h, item.l);
    if (!close || !prev) return await fetchHeatmapStockFallback(code) || await fetchDailyStockFallback(code) || cached;
    const change = close - prev;
    const percent = prev ? (change / prev) * 100 : 0;
    return { code, name: item.n || code, close, change, percent, tradeVolume: parseQuoteNumber(item.v, item.tv) };
  } catch {
    return await fetchHeatmapStockFallback(code) || await fetchDailyStockFallback(code) || cached;
  }
}

async function renderWatchlist() {
  const list = getWatchlist();
  if (!list.length) {
    watchlistStocks.innerHTML = `<div style="text-align:center; padding:40px; color:#555;">尚未新增自選股，請輸入股票代號後點新增</div>`;
    return;
  }

  watchlistStocks.innerHTML = list.map(item => `
    <div class="watchlist-card" id="wcard-${item.code}" data-code="${item.code}" data-name="${item.name || item.code}"
      style="background:#12151f; border:1px solid #2a2f45; border-radius:10px; padding:16px 20px; cursor:pointer; transition:border-color 0.2s;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="color:#7ec8e3; font-size:16px; font-weight:700;">${item.code}</span>
            <span style="color:#fff; font-size:15px; font-weight:600;">${item.name || ""}</span>
            <span style="background:#1e3a5f; color:#7ec8e3; font-size:11px; padding:2px 6px; border-radius:4px;">上市</span>
          </div>
          <div style="margin-top:6px;">
            <span id="wprice-${item.code}" style="font-size:24px; font-weight:700; color:#fff;">--</span>
            <span id="wchange-${item.code}" style="font-size:13px; margin-left:8px; color:#aaa;">載入中...</span>
          </div>
          <div style="margin-top:6px; font-size:12px; color:#666;" id="winst-${item.code}">
            外資 -- 　投信 --
          </div>
        </div>
        <button onclick="removeFromWatchlist('${item.code}')"
          style="background:none; border:none; color:#555; font-size:18px; cursor:pointer; padding:4px; line-height:1;">×</button>
      </div>
    </div>
  `).join("");

  document.querySelectorAll(".watchlist-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.tagName === "BUTTON") return;
      document.querySelectorAll(".watchlist-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      showTradingDashboard(card.dataset.code, card.dataset.name);
    });
  });

  const selectedCard = document.querySelector(".watchlist-card.selected") || document.querySelector(".watchlist-card");
  if (selectedCard && !watchlistAnalysis.querySelector(".ta-dashboard")) {
    selectedCard.click();
  }

  for (const item of list) {
    fetchStockPrice(item.code).then(stock => {
      if (!stock) return;
      const priceEl = document.querySelector(`#wprice-${item.code}`);
      const changeEl = document.querySelector(`#wchange-${item.code}`);
      const instEl = document.querySelector(`#winst-${item.code}`);
      if (priceEl) priceEl.textContent = stock.close.toLocaleString("zh-TW");
      if (changeEl) {
        const sign = stock.change >= 0 ? "+" : "";
        const color = stock.change > 0 ? "#e74c3c" : stock.change < 0 ? "#27ae60" : "#aaa";
        changeEl.style.color = color;
        changeEl.textContent = `${sign}${stock.change.toFixed(2)} (${sign}${stock.percent.toFixed(2)}%)`;
        if (stock.name && stock.name !== item.code) {
          item.name = stock.name;
          saveWatchlist(getWatchlist().map(w => w.code === item.code ? {...w, name: stock.name} : w));
          const nameEls = document.querySelectorAll(`#wcard-${item.code} span`);
          if (nameEls[1]) nameEls[1].textContent = stock.name;
        }
      }
      if (instEl) {
        const inst = institutionData[item.code];
        if (inst) {
          const fColor = inst.foreign > 0 ? "#e74c3c" : inst.foreign < 0 ? "#27ae60" : "#aaa";
          const tColor = inst.trust > 0 ? "#e74c3c" : inst.trust < 0 ? "#27ae60" : "#aaa";
          instEl.innerHTML = `外資 <span style="color:${fColor}">${inst.foreign > 0 ? "+" : ""}${(inst.foreign/1000).toFixed(0)}k</span>　投信 <span style="color:${tColor}">${inst.trust > 0 ? "+" : ""}${(inst.trust/1000).toFixed(0)}k</span>`;
        } else {
          instEl.innerHTML = `外資 <span>盤後</span>　投信 <span>盤後</span>`;
        }
      }
    });
  }

  if (watchlistRefresh) {
    const now = new Date();
    watchlistRefresh.textContent = `${String(now.getMonth()+1).padStart(2,"0")}/${String(now.getDate()).padStart(2,"0")}  更新 ${now.toLocaleTimeString("zh-TW", {hour12:false})}`;
  }
}

async function addToWatchlist() {
  const code = watchlistSearchInput.value.trim().replace(/\D/g, "");
  if (!code) return;

  const list = getWatchlist();
  if (list.find(w => w.code === code)) {
    watchlistSearchInput.value = "";
    alert("此股票已在自選股中");
    return;
  }

  list.push({ code, name: code });
  saveWatchlist(list);
  watchlistSearchInput.value = "";
  await renderWatchlist();

  const firstCard = document.querySelector(".watchlist-card");
  if (firstCard) firstCard.click();
}

function removeFromWatchlist(code) {
  const list = getWatchlist().filter(w => w.code !== code);
  saveWatchlist(list);
  renderWatchlist();
  watchlistAnalysis.innerHTML = `<div style="color:#555; font-size:14px;">點擊左側股票查看技術分析</div>`;
}

viewPanels.watchlist = document.querySelector("#watchlist-view");

watchlistSearchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addToWatchlist();
});
watchlistAddBtn?.addEventListener("click", addToWatchlist);

strategyCards.forEach((card) => {
  card.addEventListener("click", () => {
    const id = card.dataset.strategy;
    if (selectedStrategyIds.has(id)) {
      selectedStrategyIds.delete(id);
    } else {
      selectedStrategyIds.add(id);
    }
    renderStrategyScanner();
  });
});

strategyModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    strategyMode = button.dataset.strategyMode;
    renderStrategyScanner();
  });
});

strategyClear?.addEventListener("click", () => {
  selectedStrategyIds = new Set();
  if (strategySearch) strategySearch.value = "";
  strategyKeyword = "";
  renderStrategyScanner();
});

strategySearch?.addEventListener("input", (event) => {
  strategyKeyword = event.target.value;
  renderStrategyScanner();
});

async function refreshSelectedWatchlistQuote() {
  const card = document.querySelector(".watchlist-card.selected");
  if (!card) return;
  const stock = await fetchStockPrice(card.dataset.code);
  if (!stock) return;
  const priceEl = document.querySelector(`#wprice-${card.dataset.code}`);
  const changeEl = document.querySelector(`#wchange-${card.dataset.code}`);
  if (priceEl) priceEl.textContent = stock.close ? stock.close.toLocaleString("zh-TW") : "--";
  if (changeEl) {
    const sign = stock.change >= 0 ? "+" : "";
    changeEl.style.color = stock.change > 0 ? "#e74c3c" : stock.change < 0 ? "#27ae60" : "#aaa";
    changeEl.textContent = `${sign}${stock.change.toFixed(2)} (${sign}${stock.percent.toFixed(2)}%)`;
  }
  showTradingDashboard(card.dataset.code, stock.name || card.dataset.name);
}

renderWatchlist();
renderStrategyScanner();
setInterval(refreshSelectedWatchlistQuote, 5000);
