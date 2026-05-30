(function () {
  const SCHEDULE_META = {
    market: { label: "盤中即時", next: "持續輪巡" },
    watchlist: { label: "盤中即時", next: "持續輪巡" },
    intraday: { label: "盤中即時", next: "持續輪巡" },
    openBuy: { label: "07:00 / 16:00", times: ["07:00", "16:00"] },
    strategy3: { label: "13:00", times: ["13:00"] },
    swing: { label: "14:30", times: ["14:30"] },
    strategy5: { label: "06:00 / 21:00", times: ["06:00", "21:00"] },
    chip: { label: "06:00 / 21:00", times: ["06:00", "21:00"] },
    warrant: { label: "06:00 / 21:00", times: ["06:00", "21:00"] },
  };

  const WORKFLOW_BY_SCHEDULE = {
    openBuy: "open-buy-background-scan.yml",
    intraday: "intraday-radar-scorecard.yml",
    strategy3: "strategy3-background-scan.yml",
    swing: "strategy4-background-scan.yml",
    strategy5: "strategy5-background-scan.yml",
    chip: "flow-cache.yml",
    warrant: "flow-cache.yml",
  };

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

  window.FUMAN_UI_CONFIG = {
    SCHEDULE_META,
    WORKFLOW_BY_SCHEDULE,
    technicalTimeframes,
  };
})();
