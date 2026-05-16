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
let chipTradeLoading = false;
let chipFilter = "joint";
let chipRealtimeLoading = false;
let chipRealtimeQuotes = {};
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
