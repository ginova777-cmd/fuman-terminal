(function () {
const STRATEGY_DEFS = [
  { id: "chip_k_confluence", label: "籌碼共振", short: "籌碼共振", icon: "籌" },
  { id: "multi_strategy_confluence", label: "策略共振", short: "共振", icon: "🔥" },
  { id: "volume_turnover_breakout", label: "量價周轉強攻", short: "量價周轉", icon: "量" },
  { id: "bollinger_kdj_buy", label: "布林通道", short: "布林通道", icon: "布" },
  { id: "margin_up_price_up_institutional_continuous_buy", label: "資增股漲", short: "資增股漲", icon: "增" },
  { id: "margin_down_price_up_institutional_continuous_buy", label: "資減股漲", short: "資減股漲", icon: "減" },
  { id: "w_neckline_recent_retest_two_day_hold", label: "近期 W 頸線回測、兩日守住", short: "W頸線守住", icon: "W" },
  { id: "w_bottom_rebound_ma3_ma5_ma10_institution_two_day_buy", label: "W底反彈、MA轉強", short: "W底轉強", icon: "W" },
  { id: "momentum", label: "動能分數 75+", short: "動能", icon: "⚡" },
  { id: "main_force_chip", label: "主力籌碼盤整", short: "主力", icon: "♣" },
  { id: "limit_up_doji", label: "漲停十字星", short: "漲停十字", icon: "十" },
  { id: "twenty_day_breakout", label: "突破20日新高", short: "突破", icon: "↑" },
  { id: "opening_power", label: "開盤即戰力狙擊", short: "開盤", icon: "✥" },
  { id: "red_to_green", label: "昨日紅轉綠", short: "紅轉綠", icon: "↻" },
  { id: "intraday_2m", label: "2分K當沖雷達", short: "當沖", icon: "⌁" },
  { id: "investment_trust", label: "投信連買認養股", short: "投信", icon: "▦" },
  { id: "vcp", label: "波段收斂型態", short: "收斂", icon: "⌁" },
  { id: "ma_bull", label: "均線多頭排列", short: "均線", icon: "☰" },
  { id: "sync_backtest", label: "高同步率回測", short: "同步", icon: "▣" },
  { id: "overnight_chip", label: "隔日沖吸籌監控", short: "隔日", icon: "⌬" },
  { id: "short_fund_flow", label: "短線資金動能", short: "資金", icon: "◇" },
  { id: "chip_health_strong", label: "籌碼健檢強勢", short: "籌碼", icon: "▣" },
  { id: "one_day_rebound", label: "大跌一日反彈", short: "反彈", icon: "↥" },
  { id: "short_squeeze", label: "融券嘎空雷達", short: "嘎空", icon: "⌁" },
  { id: "ultra_short", label: "超短線操作", short: "短打", icon: "⚡" },
];

const STRATEGY_BY_ID = Object.fromEntries(STRATEGY_DEFS.map((item) => [item.id, item]));
const STRATEGY5_IDS = ["short_fund_flow", "chip_health_strong", "one_day_rebound", "short_squeeze", "ultra_short"];
const STRATEGY5_BASE_PRESET_IDS = [
  "chip_k_confluence",
  "volume_turnover_breakout",
  "bollinger_kdj_buy",
  "margin_up_price_up_institutional_continuous_buy",
  "margin_down_price_up_institutional_continuous_buy",
  "w_neckline_recent_retest_two_day_hold",
  "w_bottom_rebound_ma3_ma5_ma10_institution_two_day_buy",
  "momentum",
  "main_force_chip",
  "limit_up_doji",
  "twenty_day_breakout",
  "opening_power",
  "red_to_green",
  "investment_trust",
  "vcp",
  "ma_bull",
  "sync_backtest",
  "overnight_chip",
  ...STRATEGY5_IDS,
];
const STRATEGY5_PRESET_IDS = [
  "multi_strategy_confluence",
  ...STRATEGY5_BASE_PRESET_IDS,
];
const STRATEGY5_CARD_META = {
  chip_k_confluence: {
    description: "同檔股票同時出現在買賣超、CB可轉債、權證走向，標出籌碼與衍生品共振名單。",
  },
  multi_strategy_confluence: {
    description: "終端3／終端4／終端5／買賣超共同出現排名；命中來源越多，排名越前（最高 4 次）。",
  },
  limit_up_doji: {
    description: "漲停後十字星，橫盤震盪超過 7 天且量能縮，再等放量陽線突破。",
  },
  volume_turnover_breakout: {
    description: "漲幅 3%-8%、成交量 1000 張以上、周轉率大於 5%、量比大於等於 1%。",
  },
  bollinger_kdj_buy: {
    description: "日K布林通道 20MA/2σ；買點1為窄帶突破站上軌並沿上軌，買點2為大帶寬回下軌且主力/關鍵分點買超。KD 黃金交叉只作火焰加分。",
  },
  margin_up_price_up_institutional_continuous_buy: {
    description: "連兩個對齊交易日法人合計買超，股價上漲且融資餘額增加。",
  },
  margin_down_price_up_institutional_continuous_buy: {
    description: "連兩個對齊交易日法人合計買超，股價上漲且融資餘額下降。",
  },
  w_neckline_recent_retest_two_day_hold: {
    description: "正式日K辨識近期 W 型，突破後以新頸線回測，最近兩日低點均守住一個台股跳動點。",
  },
  w_bottom_rebound_ma3_ma5_ma10_institution_two_day_buy: {
    description: "W 底右腳反彈後連兩根紅K；第一根站上 MA3、第二根站上 MA5 或 MA10，且法人合計連兩日買超。",
  },
};
const INTRADAY_EXCLUDED_CODES = new Set([
  "2330", "2412", "3045",
  "2208", "2634", "2645", "4541", "4572", "5009", "6753", "8033", "8222",
  "9103", "9105", "9110", "9136",
]);

const INTRADAY_SIGNAL_DEFS = [];

const SWING_SIGNAL_DEFS = [
  { id: "bull_attack", title: "多頭攻擊", icon: "🔥", hint: "價量轉強且趨勢偏多" },
  { id: "n_base", title: "N字共振", icon: "", hint: "攻擊後回檔再轉強" },
  { id: "saucer", title: "圓弧底", icon: "◜", hint: "低位整理後突破" },
  { id: "breakaway_gap", title: "突破缺口", icon: "◆", hint: "跳空突破整理高點" },
  { id: "runaway_gap", title: "逃逸缺口", icon: "🚀", hint: "多頭延續型缺口" },
  { id: "v_reversal", title: "V轉反彈", icon: "", hint: "跌深後快速翻紅" },
  { id: "three_inside", title: "三內翻紅", icon: "↻", hint: "弱轉強反轉型態" },
  { id: "golden_cross", title: "多金釵", icon: "✦", hint: "短均線轉強候選" },
  { id: "wallet_strong_buy", title: "多方寶石", icon: "◆", hint: "主力爸爸錢包多方寶石" },
  { id: "wallet_volume_cross", title: "紅色三角形", icon: "🔺", hint: "主力爸爸錢包量能紅K交叉" },
];
  window.FUMAN_STRATEGY_CONFIG = {
    STRATEGY_DEFS,
    STRATEGY_BY_ID,
    STRATEGY5_IDS,
    STRATEGY5_BASE_PRESET_IDS,
    STRATEGY5_PRESET_IDS,
    STRATEGY5_CARD_META,
    INTRADAY_EXCLUDED_CODES,
    INTRADAY_SIGNAL_DEFS,
    SWING_SIGNAL_DEFS,
  };
})();
