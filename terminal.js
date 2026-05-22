const heatmap = document.querySelector("#heatmap");
const refreshLine = document.querySelector(".refresh-line");
const headerTimes = [...document.querySelectorAll(".header-time")];
const metricCards = [...document.querySelectorAll(".metric-card")];
metricCards[3]?.remove();
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
let strategyCards = [...document.querySelectorAll(".strategy-card[data-strategy]")];
const strategyTable = document.querySelector("#strategy-table");
const strategySummary = document.querySelector("#strategy-summary");
const strategySearch = document.querySelector("#strategy-search");
const strategyClear = document.querySelector("#strategy-clear");
const strategyModeButtons = [...document.querySelectorAll("[data-strategy-mode]")];
const strategyMatchCount = document.querySelector("#strategy-match-count");
const strategyAvgScore = document.querySelector("#strategy-avg-score");
const strategyTopHit = document.querySelector("#strategy-top-hit");
const strategyToolbar = document.querySelector(".strategy-toolbar");
const strategyBadge = document.querySelector(".strategy-toolbar .console-badge");
const strategyTitle = document.querySelector(".strategy-toolbar h2");
const strategyActions = document.querySelector(".strategy-actions");
const strategyMetrics = document.querySelector(".strategy-metrics");
const strategySearchLabel = document.querySelector(".strategy-search");
const strategyMetricLabels = [...document.querySelectorAll(".strategy-metrics article span")];
const strategyView = document.querySelector("#strategy-view");
const strategyHeaderTitle = document.querySelector("#strategy-view .strategy-header h1");
const strategyHeaderText = document.querySelector("#strategy-view .strategy-header p");
const strategyHeaderBadge = document.querySelector("#strategy-view .strategy-header .console-badge");
const strategyTerminal = document.querySelector(".strategy-terminal");
const strategyList = document.querySelector(".strategy-list");
const brandRefresh = document.querySelector(".brand");

function installBasicDevtoolsGuard() {
  const blockedKeys = new Set(["F12"]);
  const showNotice = () => {
    if (document.querySelector(".security-notice")) return;
    const notice = document.createElement("div");
    notice.className = "security-notice";
    notice.textContent = "此終端禁止檢視開發者工具。";
    notice.style.cssText = `
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 99999;
      padding: 12px 16px;
      border: 1px solid rgba(255, 77, 92, 0.45);
      border-radius: 10px;
      background: rgba(12, 16, 28, 0.94);
      color: #ff9aa8;
      font-weight: 800;
      box-shadow: 0 12px 36px rgba(0,0,0,0.35);
    `;
    document.body.appendChild(notice);
    setTimeout(() => notice.remove(), 1800);
  };
  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showNotice();
  });
  document.addEventListener("keydown", (event) => {
    const key = String(event.key || "").toUpperCase();
    const blocked =
      blockedKeys.has(event.key) ||
      (event.ctrlKey && event.shiftKey && ["I", "J", "C"].includes(key)) ||
      (event.ctrlKey && ["U", "S"].includes(key));
    if (!blocked) return;
    event.preventDefault();
    event.stopPropagation();
    showNotice();
  }, true);
}

installBasicDevtoolsGuard();

function deferUiWork(callback, delay = 0) {
  const run = () => setTimeout(callback, delay);
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else run();
}

function isViewActive(name) {
  return Boolean(viewPanels[name]?.classList.contains("active"));
}

function titleWithIcon(icon, text) {
  return `<span class="page-title-icon">${icon}</span>${text}`;
}

const SCHEDULE_META = {
  market: { label: "盤中即時", next: "持續輪巡" },
  watchlist: { label: "盤中即時", next: "持續輪巡" },
  intraday: { label: "盤中即時", next: "持續輪巡" },
  openBuy: { label: "07:00 / 14:30", times: ["07:00", "14:30"] },
  strategy3: { label: "13:00", times: ["13:00"] },
  swing: { label: "07:00 / 14:30", times: ["07:00", "14:30"] },
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

const GITHUB_WORKFLOW_API = "https://api.github.com/repos/ginova777-cmd/fuman-terminal/actions/workflows";
const workflowRunStatus = {};
let workflowRunStatusReady = false;

function scheduleDateForToday(time) {
  const [hour, minute] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}

function getScheduleUpdatedAt(key) {
  if (key === "openBuy") return openBuyScanLastAt;
  if (key === "strategy3") return strategy3UpdatedAt;
  if (key === "swing") return strategy4ScanLastAt;
  if (key === "strategy5") return strategy5UpdatedAt;
  if (key === "chip") return institutionUpdatedAt;
  if (key === "warrant") return warrantFlowUpdatedAt;
  return 0;
}

function latestDueScheduleTime(times = []) {
  if (!times.length) return null;
  const now = new Date();
  const todaySlots = times.map(scheduleDateForToday);
  const dueToday = todaySlots.filter((date) => date <= now).sort((a, b) => b - a)[0];
  if (dueToday) return dueToday;
  const [hour, minute] = times[times.length - 1].split(":").map(Number);
  const previous = new Date(now);
  previous.setDate(previous.getDate() - 1);
  previous.setHours(hour, minute, 0, 0);
  return previous;
}

function nextScheduleTime(times = []) {
  if (!times.length) return "";
  const now = new Date();
  for (const time of times) {
    const next = scheduleDateForToday(time);
    if (next > now) return next;
  }
  const [hour, minute] = times[0].split(":").map(Number);
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function formatScheduleDate(date) {
  if (!date || typeof date === "string") return date || "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function getWorkflowRunForSchedule(key) {
  const workflow = WORKFLOW_BY_SCHEDULE[key];
  return workflow ? workflowRunStatus[workflow] : null;
}

function hasSuccessfulWorkflowRun(key, latestDue) {
  const run = getWorkflowRunForSchedule(key);
  if (!run || !latestDue) return false;
  const finishedAt = Date.parse(run.updated_at || run.run_updated_at || run.created_at || "");
  return run.status === "completed" && run.conclusion === "success" && Number.isFinite(finishedAt) && finishedAt >= latestDue.getTime();
}

function getWorkflowScheduleState(key) {
  const run = getWorkflowRunForSchedule(key);
  if (!run) return "unknown";
  if (run.status === "queued" || run.status === "in_progress") return "running";
  if (run.status === "completed" && run.conclusion && run.conclusion !== "success") return "failed";
  if (run.status === "completed" && run.conclusion === "success") return "success";
  return "unknown";
}

function scheduleBadgeHtml(key) {
  const meta = SCHEDULE_META[key] || SCHEDULE_META.market;
  if (meta.next || !meta.times?.length) {
    return `<span class="schedule-status-pill"><span>● 每日 ${meta.label} 更新</span><span>● 預計下次更新：${meta.next || ""}</span></span>`;
  }
  if (workflowRunStatusReady) {
    const workflowState = getWorkflowScheduleState(key);
    if (workflowState === "failed") {
      return `<span class="schedule-status-pill schedule-failed"><span class="schedule-failed-dot">●</span><span>更新失敗</span></span>`;
    }
    if (workflowState === "running") {
      return `<span class="schedule-status-pill"><span>● 正在更新</span></span>`;
    }
  }
  const latestDue = latestDueScheduleTime(meta.times);
  const updatedAt = getScheduleUpdatedAt(key);
  const hasSuccessfulUpdate = updatedAt && latestDue && updatedAt >= latestDue.getTime();
  const isStale = latestDue && (!updatedAt || updatedAt < latestDue.getTime());
  if (isStale && workflowRunStatusReady) {
    const hasSuccessfulRun = hasSuccessfulWorkflowRun(key, latestDue);
    if (!hasSuccessfulRun) {
      return `<span class="schedule-status-pill schedule-failed"><span class="schedule-failed-dot">●</span><span>更新逾時，補跑中</span></span>`;
    }
  }
  if (!workflowRunStatusReady && !hasSuccessfulUpdate && ["openBuy", "strategy3", "swing"].includes(key)) {
    return `<span class="schedule-status-pill schedule-failed"><span class="schedule-failed-dot">●</span><span>快取尚未更新</span></span>`;
  }
  const next = formatScheduleDate(nextScheduleTime(meta.times));
  return `<span class="schedule-status-pill"><span>● 每日 ${meta.label} 更新</span><span>● 預計下次更新：${next}</span></span>`;
}

function refreshScheduleTitles() {
  applyStaticTitleIcons();
  if (isViewActive("strategy")) renderStrategyScanner();
}

async function loadWorkflowRunStatus() {
  const workflows = [...new Set(Object.values(WORKFLOW_BY_SCHEDULE))];
  const results = await Promise.allSettled(workflows.map(async (workflow) => {
    const url = `${GITHUB_WORKFLOW_API}/${workflow}/runs?per_page=1&ts=${Date.now()}`;
    const response = await fetch(url, { headers: { "Accept": "application/vnd.github+json" } });
    if (!response.ok) throw new Error(`${workflow} HTTP ${response.status}`);
    const payload = await response.json();
    workflowRunStatus[workflow] = payload.workflow_runs?.[0] || null;
  }));
  workflowRunStatusReady = results.some((result) => result.status === "fulfilled");
  refreshScheduleTitles();
}

function titleWithSchedule(icon, text, scheduleKey) {
  return `${titleWithIcon(icon, text)} ${scheduleBadgeHtml(scheduleKey)}`;
}

function setTitleWithIcon(target, icon, text) {
  if (!target) return;
  target.innerHTML = titleWithIcon(icon, text);
}

function setTitleWithSchedule(target, icon, text, scheduleKey) {
  if (!target) return;
  target.innerHTML = titleWithSchedule(icon, text, scheduleKey);
}

function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
}

function installMobileWatchlistNavOrder() {
  if (document.querySelector("#mobile-watchlist-nav-order")) return;
  const style = document.createElement("style");
  style.id = "mobile-watchlist-nav-order";
  style.textContent = `
    .nav-list .nav-item[data-view="watchlist"] {
      order: 999;
    }
  `;
  document.head.appendChild(style);

  const navList = document.querySelector(".nav-list");
  const watchlistLink = navList?.querySelector('.nav-item[data-view="watchlist"]');
  if (navList && watchlistLink) {
    navList.appendChild(watchlistLink);
  }
}

function installRealtimeRadarStyles() {
  if (document.querySelector("#realtime-radar-styles")) return;
  const style = document.createElement("style");
  style.id = "realtime-radar-styles";
  style.textContent = `
    .radar-view {
      display: grid;
      gap: 14px;
    }
    .realtime-radar-nav span {
      color: #ff7a45;
    }
    .radar-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid rgba(134, 151, 190, 0.14);
      padding-bottom: 14px;
    }
    .radar-topbar h1 {
      color: #f7fbff;
      font-size: 26px;
    }
    .radar-topbar small {
      color: #8da1ca;
      font-size: 12px;
    }
    .radar-action {
      border: 1px solid rgba(255, 122, 69, 0.35);
      border-radius: 8px;
      background: rgba(255, 122, 69, 0.12);
      color: #ffbd8a;
      cursor: pointer;
      font-weight: 800;
      padding: 10px 12px;
    }
    .radar-ai-box,
    .radar-team-box,
    .radar-flow-card,
    .radar-leader-card {
      border: 1px solid rgba(134, 151, 190, 0.16);
      border-radius: 10px;
      background: rgba(12, 14, 28, 0.72);
    }
    .radar-ai-box,
    .radar-team-box {
      padding: 16px;
    }
    .radar-ai-head,
    .radar-team-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: #9bb5e7;
      font-size: 12px;
      font-weight: 900;
    }
    .radar-ai-box h2 {
      margin: 10px 0 6px;
      color: #ff6674;
      font-size: 18px;
    }
    .radar-ai-box p,
    .radar-team-box p {
      margin: 0;
      color: #dce7ff;
      font-size: 14px;
      line-height: 1.55;
    }
    .radar-ai-box small,
    .radar-team-box small {
      display: block;
      margin-top: 8px;
      color: #7790be;
      font-size: 12px;
    }
    .radar-flow-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .radar-flow-card {
      padding: 18px;
    }
    .radar-flow-card span {
      color: #8da1ca;
      font-size: 12px;
      font-weight: 800;
    }
    .radar-flow-card strong {
      display: block;
      margin-top: 8px;
      color: #ff5d6c;
      font-size: 26px;
      font-weight: 950;
    }
    .radar-flow-card.short strong {
      color: #23d59a;
    }
    .radar-flow-card small {
      color: #8297c2;
      font-size: 12px;
    }
    .radar-balance {
      height: 7px;
      border-radius: 999px;
      background: rgba(35, 213, 154, 0.24);
      overflow: hidden;
    }
    .radar-balance span {
      display: block;
      width: var(--long-share, 50%);
      height: 100%;
      border-radius: inherit;
      background: #ff5d6c;
    }
    .radar-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      margin-top: 10px;
      border-bottom: 1px solid rgba(134, 151, 190, 0.14);
    }
    .radar-tabs button {
      border: 0;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: #8d9ab7;
      cursor: pointer;
      font-weight: 900;
      padding: 12px;
    }
    .radar-tabs button.active {
      border-color: #ff5d6c;
      color: #ff7a82;
    }
    .radar-tabs button.short-active {
      border-color: #23d59a;
      color: #23d59a;
    }
    .radar-leader-list {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }
    .radar-leader-card {
      display: grid;
      grid-template-columns: 90px 1fr auto minmax(220px, 0.8fr);
      gap: 14px;
      align-items: center;
      padding: 14px;
    }
    .radar-time {
      color: #ffd166;
      font-size: 12px;
      font-weight: 900;
    }
    .radar-stock strong {
      color: #fff;
      font-size: 18px;
    }
    .radar-stock small {
      display: block;
      color: #7890bc;
      margin-top: 4px;
    }
    .radar-price {
      text-align: right;
    }
    .radar-price strong {
      color: #ff6573;
      display: block;
      font-size: 20px;
    }
    .radar-price small {
      color: #ff6573;
      font-weight: 900;
    }
    .radar-tags {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px 12px;
      color: #ff6573;
      font-size: 12px;
      font-weight: 900;
    }
    @media (max-width: 760px) {
      .radar-topbar {
        align-items: flex-start;
        padding-right: 58px;
      }
      .radar-topbar h1 {
        font-size: 42px;
      }
      .radar-flow-grid {
        grid-template-columns: 1fr;
      }
      .radar-leader-card {
        grid-template-columns: 1fr;
        gap: 8px;
      }
      .radar-price {
        text-align: left;
      }
      .radar-tags {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

function installRealtimeRadarView() {
  if (viewPanels["realtime-radar"]) return;
  installRealtimeRadarStyles();
  const navList = document.querySelector(".nav-list");
  const radarLink = document.createElement("a");
  radarLink.className = "strategy-nav realtime-radar-nav";
  radarLink.href = "#";
  radarLink.dataset.view = "realtime-radar";
  radarLink.dataset.mobileLabel = "即時";
  radarLink.innerHTML = `<span>◎</span>即時雷達`;
  const firstStrategy = navList?.querySelector('.strategy-nav[data-view="strategy"]');
  if (navList) navList.insertBefore(radarLink, firstStrategy || navList.firstChild?.nextSibling || null);
  viewLinks.push(radarLink);

  const panel = document.createElement("section");
  panel.className = "view-panel radar-view";
  panel.id = "realtime-radar-view";
  panel.hidden = true;
  panel.innerHTML = `<div class="empty-state">即時雷達載入中...</div>`;
  const dashboard = document.querySelector(".dashboard");
  dashboard?.insertBefore(panel, document.querySelector("#market-view"));
  viewPanels["realtime-radar"] = panel;
}

function radarMoney(value) {
  const n = Math.abs(Number(value) || 0);
  if (n >= 100000000) return `${(n / 100000000).toLocaleString("zh-TW", { maximumFractionDigits: 2 })} 億`;
  if (n >= 10000) return `${(n / 10000).toLocaleString("zh-TW", { maximumFractionDigits: 0 })} 萬`;
  return n.toLocaleString("zh-TW");
}

function radarStockValue(stock) {
  const close = cleanNumber(stock.close);
  const volume = cleanNumber(stock.tradeVolume || stock.volume);
  return cleanNumber(stock.value) || close * volume * 1000;
}

function radarSignalTags(stock) {
  const tags = [];
  const volume = cleanNumber(stock.tradeVolume || stock.volume);
  const pct = cleanNumber(stock.pct ?? stock.percent);
  const value = cleanNumber(stock.value);
  const foreign = cleanNumber(stock.foreign);
  const trust = cleanNumber(stock.trust);
  if (value >= 1000000000 || (volume >= 5000 && Math.abs(pct) >= 1.2)) tags.push("即時爆量");
  if (pct >= 3) tags.push("急拉");
  if (foreign >= 1000) tags.push("外資買超");
  if (pct >= 1.5 && value >= 200000000) tags.push("短線強勢");
  if (trust >= 500) tags.push("投信買超");
  if (pct <= -3) tags.push("急殺");
  if (foreign <= -1000) tags.push("外資賣超");
  if (trust <= -500) tags.push("投信賣超");
  if (pct <= -1.5 && value >= 200000000) tags.push("短線轉弱");
  return tags;
}

function radarFlowValue(stock) {
  const value = cleanNumber(stock.value);
  const pct = Math.abs(cleanNumber(stock.pct ?? stock.percent));
  const tags = stock.signalTags?.length || 0;
  const volume = cleanNumber(stock.volume || stock.tradeVolume);
  const volumeBoost = volume >= 10000 ? 0.18 : volume >= 5000 ? 0.12 : 0.06;
  const signalBoost = Math.min(tags * 0.11, 0.46);
  const moveBoost = Math.min(pct / 9, 0.42);
  return value * (0.55 + signalBoost + moveBoost + volumeBoost);
}

function radarSignalScore(stock) {
  const pct = Math.abs(cleanNumber(stock.pct ?? stock.percent));
  const value = cleanNumber(stock.value);
  const volume = cleanNumber(stock.volume || stock.tradeVolume);
  const foreign = Math.abs(cleanNumber(stock.foreign));
  const trust = Math.abs(cleanNumber(stock.trust));
  const tagScore = (stock.signalTags?.length || 0) * 16;
  const moveScore = Math.min(pct * 7, 32);
  const valueScore = Math.min(Math.log10(Math.max(value, 1)) * 5, 46);
  const volumeScore = Math.min(Math.log10(Math.max(volume, 1)) * 5, 22);
  const instScore = Math.min(foreign / 450 + trust / 350, 24);
  return Math.max(1, Math.min(100, Math.round(tagScore + moveScore + valueScore + volumeScore + instScore - 42)));
}

function buildRealtimeRadarRows() {
  const intradayPool = latestStocks
    .map((stock) => applyStrategyQuote(stock))
    .filter((stock) => isIntradayTradable(stock));
  const shortPressurePool = [...intradayPool]
    .filter((stock) => {
      const live = applyStrategyQuote(stock);
      const inst = getInstitutionTotal(live.code);
      const pct = cleanNumber(live.percent);
      const value = radarStockValue(live);
      const volume = cleanNumber(live.tradeVolume || live.volume);
      const foreign = cleanNumber(inst.foreign);
      const trust = cleanNumber(inst.trust);
      return (
        pct <= -0.6 ||
        (pct < 0 && value >= 100000000) ||
        (pct <= -0.3 && volume >= 2500) ||
        (foreign <= -1000 && pct <= 0.8) ||
        (trust <= -500 && pct <= 0.8)
      );
    })
    .sort((a, b) => {
      const av = radarStockValue(a) * (1 + Math.abs(cleanNumber(a.percent)) / 8);
      const bv = radarStockValue(b) * (1 + Math.abs(cleanNumber(b.percent)) / 8);
      return bv - av;
    });
  const rankedIntradayPool = uniqueStocksByCode([
    ...getIntradayCandidateStocks(intradayPool),
    ...getBaseStrongIntradayStocks(intradayPool),
    ...shortPressurePool,
    ...[...intradayPool].sort((a, b) => getIntradayHotScore(b) - getIntradayHotScore(a)),
  ]).slice(0, REALTIME_RADAR_POOL_LIMIT);
  return rankedIntradayPool
    .map((stock) => {
      const live = applyStrategyQuote(stock);
      const inst = getInstitutionTotal(live.code);
      const pct = cleanNumber(live.percent);
      const value = radarStockValue(live);
      const volume = cleanNumber(live.tradeVolume || live.volume);
      const totalInst = cleanNumber(inst.total);
      const trust = cleanNumber(inst.trust);
      const foreign = cleanNumber(inst.foreign);
      const signalTags = radarSignalTags({ ...live, pct, value, volume, foreign, trust });
      const hasLongSignal =
        pct >= 3 ||
        (pct >= 1.5 && value >= 200000000) ||
        (value >= 1000000000 && pct > 0) ||
        (volume >= 5000 && pct >= 1.2) ||
        (foreign >= 1000 && pct >= 0) ||
        (trust >= 500 && pct >= 0);
      const hasShortSignal =
        pct <= -3 ||
        (pct <= -1.5 && value >= 200000000) ||
        (value >= 1000000000 && pct < 0) ||
        (volume >= 5000 && pct <= -1.2) ||
        (foreign <= -1000 && pct <= 0.8) ||
        (trust <= -500 && pct <= 0.8);
      const side = hasLongSignal && (!hasShortSignal || pct >= 0) ? "long" : hasShortSignal ? "short" : "";
      const score = radarSignalScore({ ...live, pct, value, volume, foreign, trust, signalTags });
      const flow = radarFlowValue({ ...live, pct, value, volume, foreign, trust, signalTags });
      return {
        ...live,
        pct,
        value,
        volume,
        side,
        score,
        flow,
        trust,
        foreign,
        totalInst,
        signalTags,
      };
    })
    .filter((stock) => stock.value > 0 && stock.side && stock.signalTags.length)
    .sort((a, b) => b.score - a.score || b.value - a.value);
}

function radarReasonTags(stock) {
  return (stock.signalTags?.length ? stock.signalTags : [stock.side === "long" ? "短線強勢" : "短線轉弱"]).slice(0, 4);
}

async function ensureRealtimeRadarData() {
  if (latestStocks.length) return latestStocks;
  if (realtimeRadarDataPromise) return realtimeRadarDataPromise;
  realtimeRadarDataPromise = (async () => {
    realtimeRadarLoading = true;
    try {
      const stocks = await loadStrategyStocks();
      if (stocks.length) {
        deferUiWork(() => {
          loadMarketData();
          refreshStrategyRealtimeScan("force");
        }, 30);
        return stocks;
      }
      await loadMarketData();
      return latestStocks;
    } catch (error) {
      return [];
    } finally {
      realtimeRadarLoading = false;
      realtimeRadarDataPromise = null;
    }
  })();
  return realtimeRadarDataPromise;
}

function renderRealtimeRadar() {
  installRealtimeRadarView();
  const panel = viewPanels["realtime-radar"];
  if (!panel) return;
  deferUiWork(ensureMobileAutoOrganizeButton);
  if (!latestStocks.length) {
    panel.innerHTML = `<div class="empty-state">正在快速載入當沖雷達股票池...</div>`;
    ensureRealtimeRadarData().then((stocks) => {
      if (stocks.length) renderRealtimeRadar();
      else panel.innerHTML = `<div class="empty-state">即時雷達暫時沒有取得股票資料，請按右上重新整理。</div>`;
    });
    return;
  }
  const rows = buildRealtimeRadarRows();
  const longAll = rows.filter((stock) => stock.side === "long");
  const shortAll = rows.filter((stock) => stock.side === "short");
  const longRows = longAll.slice(0, 8);
  const shortRows = shortAll.slice(0, 8);
  const longFlow = longAll.reduce((sum, stock) => sum + stock.flow, 0);
  const shortFlow = shortAll.reduce((sum, stock) => sum + stock.flow, 0);
  const netFlow = longFlow - shortFlow;
  const longShare = Math.round((longFlow / Math.max(longFlow + shortFlow, 1)) * 100);
  const major = longFlow >= shortFlow ? "偏多" : "偏空";
  const majorLabel = `${major}觀察`;
  const activeRadarSide = realtimeRadarSide === "short" ? "short" : realtimeRadarSide === "long" ? "long" : major === "偏多" ? "long" : "short";
  const leaders = activeRadarSide === "long" ? longRows : shortRows;
  const totalFlow = longFlow + shortFlow;
  const topFlow = leaders.slice(0, 3).reduce((sum, stock) => sum + stock.flow, 0);
  const concentration = Math.round((topFlow / Math.max(totalFlow, 1)) * 100);
  const maxSignalScore = rows.reduce((max, stock) => Math.max(max, cleanNumber(stock.score)), 0);
  const topNames = leaders.slice(0, 3).map((stock) => `${stock.code} ${stock.name}`).join("、") || "--";
  const now = new Date().toLocaleTimeString("zh-TW", { hour12: false });
  const leaderMarkup = leaders.slice(0, 6).map((stock) => {
    const sign = stock.pct >= 0 ? "+" : "";
    const tags = radarReasonTags(stock).map((tag) => `<span>${tag}</span>`).join("");
    return `
      <article class="radar-leader-card">
        <span class="radar-time">${now}</span>
        <div class="radar-stock">
          <strong>${stock.name} <small>${stock.code}</small></strong>
          <small>成交金額 ${radarMoney(stock.value)}｜訊號分數 ${Math.round(stock.score)}</small>
        </div>
        <div class="radar-price">
          <strong>${formatNumber(stock.close, stock.close >= 100 ? 0 : 2)}</strong>
          <small>${sign}${stock.pct.toFixed(2)}%</small>
        </div>
        <div class="radar-tags">${tags}</div>
      </article>
    `;
  }).join("") || `<div class="empty-state">等待即時雷達資料...</div>`;

  panel.innerHTML = `
    <header class="radar-topbar">
      <div>
        <small>即時雷達</small>
        <h1>即時多空資金流</h1>
      </div>
      <button class="radar-action" type="button" data-radar-refresh>刷新雷達</button>
    </header>
    <section class="radar-ai-box">
      <div class="radar-ai-head"><span>AI 即時判斷</span><span>信心 ${Math.max(52, Math.min(95, Math.round(Math.abs(netFlow) / Math.max(longFlow + shortFlow, 1) * 100 + 55)))}%</span></div>
      <h2>${majorLabel}</h2>
      <p>${majorLabel}，淨流向 ${netFlow >= 0 ? "+" : "-"}${radarMoney(netFlow)}。主導訊號：${topNames}。</p>
      <small>多方 ${radarMoney(longFlow)}｜空方 ${radarMoney(shortFlow)}｜集中度 ${concentration}%｜最高訊號分數 ${maxSignalScore}</small>
    </section>
    <section class="radar-team-box">
      <div class="radar-team-head"><span>自動 AI 團隊</span><span>今日 ${rows.length} 件</span></div>
      <p>${major === "偏多" ? "多方雷達主導，留意強勢股續航。" : "空方雷達升溫，先看風險，不代表直接做空。"}重大訊號才會自動送出。</p>
    </section>
    <section class="radar-flow-grid">
      <article class="radar-flow-card"><span>多方流入</span><strong>${radarMoney(longFlow)}</strong><small>共 ${longAll.length} 則</small></article>
      <article class="radar-flow-card short"><span>空方流出</span><strong>${radarMoney(shortFlow)}</strong><small>共 ${shortAll.length} 則</small></article>
      <article class="radar-flow-card"><span>淨流向</span><strong>${netFlow >= 0 ? "+" : "-"}${radarMoney(netFlow)}</strong><div class="radar-balance" style="--long-share:${longShare}%"><span></span></div></article>
    </section>
    <div class="radar-tabs">
      <button class="${activeRadarSide === "long" ? "active" : ""}" type="button" data-radar-side="long">多方</button>
      <button class="${activeRadarSide === "short" ? "active short-active" : ""}" type="button" data-radar-side="short">空方</button>
    </div>
    <section class="radar-leader-list">${leaderMarkup}</section>
  `;
}

function getActiveViewName() {
  return Object.entries(viewPanels).find(([, panel]) => panel?.classList.contains("active"))?.[0] || "market";
}

function syncMobileStrategyVisibility(activeName = getActiveViewName()) {
  if (!strategyView) return;
  const shouldHideStrategy = isMobileViewport() && activeName !== "strategy";
  strategyView.classList.toggle("mobile-hide-strategy", shouldHideStrategy);
  if (shouldHideStrategy) {
    strategyView.hidden = true;
    strategyView.classList.remove("active");
  }
}

function runMobileAutoOrganize() {
  const active = getActiveViewName();
  if (active === "market") {
    loadMarketData();
    loadHeatmap();
    return;
  }
  if (active === "strategy") {
    renderStrategyScanner();
    const text = [...selectedStrategyIds].join(" ");
    if (text.includes("intraday_2m")) refreshStrategyRealtimeScan("force");
    if (text.includes("open_buy")) loadOpenBuyCache(true);
    if (text.includes("swing_radar")) loadStrategy4Cache(true);
    return;
  }
  if (active === "chip-trade") {
    loadChipTradeData();
    return;
  }
  if (active === "warrant-flow") {
    loadWarrantFlow(true);
    return;
  }
  renderWatchlist?.();
  refreshSelectedWatchlistQuote?.();
}

function ensureMobileAutoOrganizeButton() {
  document.querySelectorAll(".mobile-auto-organize").forEach((button) => button.remove());
  const active = getActiveViewName();
  const panel = viewPanels[active];
  if (!panel) return;
  const button = document.createElement("button");
  button.className = "mobile-auto-organize";
  button.type = "button";
  button.title = "自動整理";
  button.setAttribute("aria-label", "自動整理");
  button.textContent = "↻";
  button.addEventListener("click", runMobileAutoOrganize);
  panel.appendChild(button);
}

function normalizeMobileHorizontalPosition() {
  if (!isMobileViewport()) return;
  const resetTargets = [
    document.documentElement,
    document.body,
    document.querySelector(".dashboard"),
    document.querySelector("#strategy-view"),
    document.querySelector("#strategy-table"),
    document.querySelector(".strategy-terminal"),
    document.querySelector(".strategy-results"),
    document.querySelector(".swing-dashboard"),
    document.querySelector(".intraday-dashboard"),
    document.querySelector(".swing-panel"),
    document.querySelector(".intraday-panel"),
  ];
  resetTargets.forEach((target) => {
    if (target) target.scrollLeft = 0;
  });
  if (typeof window.scrollTo === "function") window.scrollTo(0, window.scrollY || 0);
}

function applyStaticTitleIcons() {
  const marketTitle = document.querySelector("#market-view .page-header h1");
  const settlementBadge = isMobileViewport() ? getTaiexMajorSettlementBadge() : "";
  if (marketTitle) {
    marketTitle.innerHTML = `${titleWithIcon("●", "市場總覽")}${settlementBadge ? ` <small class="update-mode-badge settlement-title-badge">${escapeAttr(settlementBadge)}</small>` : ""} ${scheduleBadgeHtml("market")}`;
  }
  setTitleWithSchedule(document.querySelector("#watchlist-view .page-header h1"), "☆", "自選股", "watchlist");
  setTitleWithSchedule(document.querySelector("#chip-trade-view .page-header h1"), "◆", "外資 + 投信連買", "chip");
  setTitleWithSchedule(document.querySelector("#warrant-flow-view .page-header h1"), "◒", "權證走向", "warrant");
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function appendUpdateBadge(target, text, tone = "slow") {
  if (!target || target.querySelector(".update-mode-badge")) return;
  const badge = document.createElement("small");
  badge.className = "update-mode-badge";
  badge.textContent = text;
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    margin-left: 8px;
    padding: 2px 6px;
    border-radius: 999px;
    border: 1px solid ${tone === "live" ? "rgba(255,77,92,.55)" : "rgba(127,166,255,.45)"};
    background: ${tone === "live" ? "rgba(255,77,92,.14)" : "rgba(63,102,204,.16)"};
    color: ${tone === "live" ? "#ff9aa8" : "#9db9ff"};
    font-size: 11px;
    font-weight: 800;
    white-space: nowrap;
  `;
  const strong = target.querySelector("strong") || target;
  strong.appendChild(badge);
}

function getTaiexMajorSettlementBadge(date = new Date()) {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (let day = 15; day <= 21; day++) {
    const settlement = new Date(local.getFullYear(), local.getMonth(), day);
    if (settlement.getDay() !== 3) continue;
    const weekStart = new Date(settlement);
    weekStart.setDate(settlement.getDate() - 2);
    if (local >= weekStart && local <= settlement) {
      return `${settlement.getMonth() + 1}/${settlement.getDate()}🚨 台指大結算`;
    }
  }
  return "";
}

function labelUpdateModes() {
  if (!isMobileViewport()) {
    viewLinks.forEach((link) => {
      const text = link.textContent || "";
      const settlementBadge = getTaiexMajorSettlementBadge();
      if (text.includes("市場總覽") && settlementBadge) appendUpdateBadge(link, settlementBadge, "live");
    });
  }
  document.querySelectorAll(".strategy-card[data-strategy]").forEach((card) => {
    const text = card.textContent || "";
    if (text.includes("策略2")) appendUpdateBadge(card, "立即更新", "live");
    if (text.includes("策略1")) appendUpdateBadge(card, "07/14:30完整掃", "slow");
    if (text.includes("策略3")) appendUpdateBadge(card, "13:00完整掃", "slow");
    if (text.includes("策略4")) appendUpdateBadge(card, "07/14:30完整掃", "slow");
    if (text.includes("策略5")) appendUpdateBadge(card, "MIS即時", "live");
  });
}

function labelChipTradeMode() {
  const realtimeButton = document.querySelector('[data-chip-mode="realtime"]');
  realtimeButton?.remove();
  const afterButton = document.querySelector('[data-chip-mode="after"]');
  afterButton?.classList.add("active");
  const chipTool = document.querySelector(".chip-tool");
  if (!chipTool || chipTool.querySelector(".chip-source-note")) return;
  const note = document.createElement("div");
  note.className = "chip-source-note";
  note.textContent = "外資、投信買賣超為盤後公布資料，每日 06:00 / 21:00 完整掃，本頁只顯示最新盤後籌碼。";
  note.style.cssText = `
    margin-top: 10px;
    color: #9db9ff;
    font-size: 12px;
    font-weight: 800;
  `;
  chipTool.appendChild(note);
}

const endpoints = {
  backend: "/api/market",
  heatmap: "/api/heatmap",
  institution: "/api/institution",
  history: "/api/history",
  realtime: "/api/realtime",
  scanOpenBuy: "/api/scan-open-buy",
  scanStrategy4: "/api/scan-strategy4",
  scanWarrantFlow: "/api/scan-warrant-flow",
  exportAuth: "/api/export-auth",
  openBuyCache: "/data/open-buy-latest.json",
  openBuyBackup: "/data/open-buy-backup.json",
  strategy4Cache: "/data/strategy4-latest.json",
  strategy4Backup: "/data/strategy4-backup.json",
  strategy3Cache: "/data/strategy3-latest.json",
  strategy3Backup: "/data/strategy3-backup.json",
  strategy5Cache: "/data/strategy5-latest.json",
  strategy5Backup: "/data/strategy5-backup.json",
  institutionCache: "/data/institution-latest.json",
  institutionBackup: "/data/institution-backup.json",
  warrantFlowCache: "/data/warrant-flow-latest.json",
  warrantFlowBackup: "/data/warrant-flow-backup.json",
  strategyStocks: "/api/stocks",
  stocks: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
};

let latestStocks = [];
let marketDataLoading = false;
let marketDataLastStartedAt = 0;
let marketDataLastRenderedAt = 0;
let lastMarketRenderSignature = "";
let realtimeRadarLoading = false;
let realtimeRadarDataPromise = null;
let realtimeRadarSide = "auto";
let sectorStocksCache = {};
let institutionData = {};
let institutionDate = "";
let institutionUpdatedAt = 0;
let chipMode = "after";
let chipTradeLoading = false;
let chipFilter = "joint";
let chipQuoteHydrating = false;
let strategyRealtimeLoading = false;
let strategyRealtimeCursor = 0;
let strategyRealtimeQuotes = {};
let strategyLastScanAt = 0;
let strategyRealtimeStats = { requested: 0, received: 0, failed: 0, lastError: "" };
let strategyRealtimeBackgroundCursor = 0;
let mobileIntradayHotScanLastAt = 0;
let mobileIntradayBackgroundScanLastAt = 0;
let mobileOtherStrategyRenderLastAt = 0;
let mobileOtherStrategyRenderTimer = 0;
let mobileOtherStrategyRenderFlushing = false;
let mobileOtherStrategyCacheCheckedAt = {};
const intradayGoFirstSeenAt = new Map();
let intradayCandidateSeenAt = {};
let strategyHistoryLoading = false;
let strategyHistoryCursor = 0;
let strategyHistoryData = {};
let strategyHistoryLastScanAt = 0;
let strategy4ScanLoading = false;
let strategy4ScanCursor = 0;
let strategy4ScanMatches = {};
let strategy4PendingMatches = null;
let strategy4PendingScannedCodes = null;
let strategy4ScanLastAt = 0;
let strategy4ScanCount = 0;
let strategy4ScannedCodes = new Set();
let strategy4ScanTotal = 0;
let strategy4CacheLoading = false;
let strategy3Data = [];
let strategy3UpdatedAt = 0;
let strategy3CacheLoading = false;
let strategy5Data = [];
let strategy5UpdatedAt = 0;
let strategy5CacheLoading = false;
let strategyStocksPromise = null;
const STRATEGY4_LOCAL_CACHE_KEY = "fuman_strategy4_scan_cache_v1";
const STRATEGY4_BACKUP_CACHE_KEY = "fuman_strategy4_nonempty_backup_v1";
const OPEN_BUY_LOCAL_CACHE_KEY = "fuman_open_buy_scan_cache_v1";
const OPEN_BUY_BACKUP_CACHE_KEY = "fuman_open_buy_nonempty_backup_v1";
const EXPORT_UNLOCK_KEY = "fuman_export_unlock_until_v1";
const EXPORT_UNLOCK_MS = 30 * 24 * 60 * 60 * 1000;
let openBuyScanLoading = false;
let openBuyScanCursor = 0;
let openBuyScanMatches = {};
let openBuyPendingMatches = null;
let openBuyPendingScannedCodes = null;
let openBuyScanLastAt = 0;
let openBuyScanCount = 0;
let openBuyScannedCodes = new Set();
let openBuyScanTotal = 0;
let openBuyCacheLoading = false;
let openBuyCacheCheckedAt = 0;
let openBuyPage = 1;
let swingPage = 1;
let strategy3Page = 1;
let strategy5Page = 1;
let warrantFlowLoading = false;
let warrantFlowData = [];
let warrantFlowUpdatedAt = 0;
let warrantFlowKeyword = "";
let warrantFlowSearchTimer = null;
let warrantFlowPage = 1;
let chipTradePage = 1;
const WARRANT_FLOW_LOCAL_CACHE_KEY = "fuman_warrant_flow_cache_v1";
const CACHE_FRESH_MS = 10 * 60 * 1000;
const MARKET_REFRESH_MS = 30 * 1000;
const MARKET_REFRESH_HIDDEN_MS = 90 * 1000;
const MARKET_DOM_REFRESH_MS = 60 * 1000;
let selectedStrategyIds = new Set();
let strategyMode = "any";
let strategyKeyword = "";
let strategyStocksLoading = false;
let swingSortKey = "score";
let swingSortDir = "desc";
let swingSignalFilter = "all";
let intradaySortKey = "score";
let intradaySortDir = "desc";
let intradaySignalFilter = "all";
let strategyPresetMode = "";
let strategy5ActiveId = "foreign_trust_breakout";
const INTRADAY_HOT_SCAN_LIMIT = 900;
const REALTIME_RADAR_POOL_LIMIT = 650;
const INTRADAY_BACKGROUND_BATCH = 450;
const INTRADAY_FAST_SCAN_MS = 3000;
const INTRADAY_BACKGROUND_SCAN_MS = 3000;
const MOBILE_INTRADAY_HOT_SCAN_LIMIT = 260;
const MOBILE_INTRADAY_FORCE_EXTRA_LIMIT = 80;
const MOBILE_INTRADAY_BACKGROUND_BATCH = 90;
const MOBILE_INTRADAY_HOT_SCAN_MS = 12000;
const MOBILE_INTRADAY_BACKGROUND_SCAN_MS = 45000;
const MOBILE_OTHER_STRATEGY_RENDER_MS = 2500;
const MOBILE_OTHER_STRATEGY_CACHE_MS = 45000;
const INTRADAY_CANDIDATE_TTL_MS = 15 * 60 * 1000;
const INTRADAY_MIN_VOLUME = 2000;

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

function isStaleStrategyPrice(item, base) {
  const cachedClose = cleanNumber(item?.close);
  const latestClose = cleanNumber(base?.close);
  if (!cachedClose || !latestClose) return false;
  return Math.abs(cachedClose - latestClose) > 0.001;
}

function formatNumber(value, digits = 2) {
  return cleanNumber(value).toLocaleString("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatStockPrice(value) {
  const number = cleanNumber(value);
  if (!number) return "--";
  const decimals = Number.isInteger(number) ? 0 : 2;
  return number.toLocaleString("zh-TW", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
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

function isDocumentHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function shouldSkipMobileOtherStrategyCacheRefresh(key, hasData, force = false) {
  if (!force || !isMobileViewport() || !hasData) return false;
  const now = Date.now();
  const last = mobileOtherStrategyCacheCheckedAt[key] || 0;
  if (now - last < MOBILE_OTHER_STRATEGY_CACHE_MS) return true;
  mobileOtherStrategyCacheCheckedAt[key] = now;
  return false;
}

function shouldDeferMobileOtherStrategyRender(enabled) {
  if (!enabled) return false;
  if (mobileOtherStrategyRenderFlushing) return false;
  const now = Date.now();
  const wait = MOBILE_OTHER_STRATEGY_RENDER_MS - (now - mobileOtherStrategyRenderLastAt);
  if (wait <= 0) {
    mobileOtherStrategyRenderLastAt = now;
    return false;
  }
  if (!mobileOtherStrategyRenderTimer) {
    mobileOtherStrategyRenderTimer = setTimeout(() => {
      mobileOtherStrategyRenderTimer = 0;
      mobileOtherStrategyRenderLastAt = Date.now();
      mobileOtherStrategyRenderFlushing = true;
      try {
        renderStrategyScanner();
      } finally {
        mobileOtherStrategyRenderFlushing = false;
      }
    }, wait);
  }
  return true;
}

async function fetchJson(url, timeout = 8000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: options.cache || "no-store" });
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

function avg(values) {
  const nums = values.filter((value) => Number.isFinite(value) && value > 0);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function sma(values, length, offset = 0) {
  const end = values.length - offset;
  const start = end - length;
  if (start < 0 || end <= 0) return 0;
  return avg(values.slice(start, end));
}

function emaSeries(values, length) {
  const k = 2 / (length + 1);
  const out = [];
  values.forEach((value, index) => {
    out[index] = index === 0 ? value : value * k + out[index - 1] * (1 - k);
  });
  return out;
}

function rsi(values, length = 14) {
  if (values.length <= length) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - length; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (!losses) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function macdSnapshot(values) {
  if (values.length < 35) return { macd: 0, signal: 0, histogram: 0, rising: false };
  const ema12 = emaSeries(values, 12);
  const ema26 = emaSeries(values, 26);
  const macdLine = values.map((_, index) => (ema12[index] || 0) - (ema26[index] || 0));
  const signalLine = emaSeries(macdLine, 9);
  const macd = macdLine.at(-1) || 0;
  const signal = signalLine.at(-1) || 0;
  const prevHist = (macdLine.at(-2) || 0) - (signalLine.at(-2) || 0);
  const histogram = macd - signal;
  return { macd, signal, histogram, rising: histogram > prevHist };
}

function atr(rows, length = 14) {
  if (rows.length <= length) return 0;
  const trs = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const prev = rows[i - 1];
    trs.push(Math.max(
      row.high - row.low,
      Math.abs(row.high - prev.close),
      Math.abs(row.low - prev.close)
    ));
  }
  return avg(trs.slice(-length));
}

function getInstitutionTotal(code) {
  const inst = institutionData[code] || {};
  const foreign = Number(inst.foreign) || 0;
  const trust = Number(inst.trust) || 0;
  const dealer = Number(inst.dealer) || 0;
  return { foreign, trust, dealer, total: foreign + trust + dealer };
}

function updateStrategyHistory(item) {
  if (!item?.code || !Array.isArray(item.rows)) return;
  strategyHistoryData[item.code] = {
    ...item,
    rows: item.rows
      .map((row) => ({
        date: row.date,
        open: cleanNumber(row.open),
        high: cleanNumber(row.high),
        low: cleanNumber(row.low),
        close: cleanNumber(row.close),
        volume: cleanNumber(row.volume),
        value: cleanNumber(row.value),
      }))
      .filter((row) => row.date && row.close)
      .sort((a, b) => a.date.localeCompare(b.date)),
    updatedAt: Date.now(),
  };
}

function updateStrategy4Scan(payload, options = {}) {
  const retainUnmatched = options.retainUnmatched !== false;
  const scannedCodes = normalizeArray(payload?.scannedCodes);
  const matches = normalizeArray(payload?.matches);
  const matchedCodes = new Set(matches.map((item) => item.code));
  scannedCodes.forEach((code) => {
    if (code) strategy4ScannedCodes.add(code);
  });
  if (!retainUnmatched) {
    scannedCodes.forEach((code) => {
      if (!matchedCodes.has(code)) delete strategy4ScanMatches[code];
    });
  }
  matches.forEach((item) => {
    if (!item?.code) return;
    const base = latestStocks.find((stock) => stock.code === item.code) || {};
    if (isStaleStrategyPrice(item, base)) return;
    const signals = normalizeArray(item.swingSignals || item.signals);
    strategy4ScanMatches[item.code] = {
      ...base,
      ...item,
      name: base.name || item.name || item.code,
      tradeVolume: cleanNumber(item.tradeVolume || item.volume || base.tradeVolume),
      value: cleanNumber(item.value || base.value),
      percent: Number.isFinite(Number(item.percent)) ? Number(item.percent) : (base.percent || 0),
      swingSignals: signals,
      swingStage: item.swingStage || item.stage || base.swingStage,
      swingScore: cleanNumber(item.swingScore || item.score),
      updatedAt: Date.now(),
    };
  });
  strategy4ScanCount = Object.keys(strategy4ScanMatches).length;
  saveStrategy4LocalCache();
}

function collectStrategy4Pending(payload) {
  if (!strategy4PendingMatches) strategy4PendingMatches = {};
  if (!strategy4PendingScannedCodes) strategy4PendingScannedCodes = new Set();
  normalizeArray(payload?.scannedCodes).forEach((code) => {
    if (code) strategy4PendingScannedCodes.add(code);
  });
  normalizeArray(payload?.matches).forEach((item) => {
    if (!item?.code) return;
    const base = latestStocks.find((stock) => stock.code === item.code) || {};
    const signals = normalizeArray(item.swingSignals || item.signals);
    strategy4PendingMatches[item.code] = {
      ...base,
      ...item,
      name: base.name || item.name || item.code,
      tradeVolume: cleanNumber(item.tradeVolume || item.volume || base.tradeVolume),
      value: cleanNumber(item.value || base.value),
      percent: Number.isFinite(Number(item.percent)) ? Number(item.percent) : (base.percent || 0),
      swingSignals: signals,
      swingStage: item.swingStage || item.stage || base.swingStage,
      swingScore: cleanNumber(item.swingScore || item.score),
      updatedAt: Date.now(),
    };
  });
}

function commitStrategy4Pending() {
  if (!strategy4PendingMatches || !strategy4PendingScannedCodes) return;
  strategy4ScanMatches = { ...strategy4PendingMatches };
  strategy4ScannedCodes = new Set(strategy4PendingScannedCodes);
  strategy4ScanCount = Object.keys(strategy4ScanMatches).length;
  strategy4ScanLastAt = Date.now();
  strategy4PendingMatches = null;
  strategy4PendingScannedCodes = null;
  saveStrategy4LocalCache();
}

function mergeStrategy4Cache(payload) {
  strategy4ScanMatches = {};
  strategy4ScannedCodes = new Set();
  const scannedCodes = normalizeArray(payload?.scannedCodes);
  scannedCodes.forEach((code) => {
    if (code) strategy4ScannedCodes.add(code);
  });
  if (payload?.total) strategy4ScanTotal = cleanNumber(payload.total);
  updateStrategy4Scan({ matches: normalizeArray(payload?.matches), scannedCodes: [] });
  const updatedAt = Date.parse(payload?.updatedAt || "");
  strategy4ScanLastAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
  saveStrategy4LocalCache();
}

function saveStrategy4LocalCache() {
  try {
    const matches = Object.values(strategy4ScanMatches);
    const payload = {
      source: "github-actions",
      updatedAt: strategy4ScanLastAt || Date.now(),
      total: strategy4ScanTotal,
      scannedCodes: [...strategy4ScannedCodes],
      matches,
    };
    localStorage.setItem(STRATEGY4_LOCAL_CACHE_KEY, JSON.stringify(payload));
    if (matches.length) {
      localStorage.setItem(STRATEGY4_BACKUP_CACHE_KEY, JSON.stringify(payload));
    }
  } catch (error) {}
}

function loadStrategy4LocalCache() {
  try {
    let payload = JSON.parse(localStorage.getItem(STRATEGY4_LOCAL_CACHE_KEY) || "{}");
    if (!Array.isArray(payload.matches) || !payload.matches.length) {
      payload = JSON.parse(localStorage.getItem(STRATEGY4_BACKUP_CACHE_KEY) || "{}");
    }
    if (!String(payload.source || "").includes("github-actions")) return false;
    if (!Array.isArray(payload.matches) || !payload.matches.length) return false;
    if (payload.total) strategy4ScanTotal = cleanNumber(payload.total);
    strategy4ScanMatches = {};
    strategy4ScannedCodes = new Set();
    normalizeArray(payload.scannedCodes).forEach((code) => {
      if (code) strategy4ScannedCodes.add(code);
    });
    normalizeArray(payload.matches).forEach((item) => {
      if (!item?.code) return;
      strategy4ScanMatches[item.code] = { ...item };
    });
    strategy4ScanCount = Object.keys(strategy4ScanMatches).length;
    strategy4ScanLastAt = cleanNumber(payload.updatedAt) || Date.now();
    return true;
  } catch (error) {
    return false;
  }
}

function hasFreshStrategy4Scan() {
  const total = strategy4ScanTotal || latestStocks.filter((stock) => !/^00/.test(stock.code)).length || 0;
  if (!total || !strategy4ScanLastAt) return false;
  const progress = strategy4ScannedCodes.size / total;
  const ageMs = Date.now() - strategy4ScanLastAt;
  return progress >= 0.95 && ageMs < CACHE_FRESH_MS;
}

function hasFreshOpenBuyScan() {
  const total = openBuyScanTotal || latestStocks.filter((stock) => !/^00/.test(stock.code)).length || 0;
  if (!total || !openBuyScanLastAt) return false;
  const progress = openBuyScannedCodes.size / total;
  const ageMs = Date.now() - openBuyScanLastAt;
  return progress >= 0.95 && ageMs < CACHE_FRESH_MS;
}

function getOpenBuyActiveScanTime() {
  const now = new Date();
  const today0700 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0, 0, 0).getTime();
  const today1430 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 30, 0, 0).getTime();
  if (now.getTime() >= today1430) return today1430;
  if (now.getTime() >= today0700) return today0700;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 14, 30, 0, 0).getTime();
}

function shouldLoadOpenBuyRemote(force = false) {
  if (force) return true;
  const activeScanTime = getOpenBuyActiveScanTime();
  if (!openBuyScanLastAt) return true;
  if (openBuyScanLastAt >= activeScanTime) return false;
  return openBuyCacheCheckedAt < activeScanTime;
}

function hasFreshWarrantFlow() {
  return warrantFlowData.length > 0 && warrantFlowUpdatedAt && (Date.now() - warrantFlowUpdatedAt) < CACHE_FRESH_MS;
}

function saveWarrantFlowLocalCache() {
  try {
    if (!warrantFlowData.length) return;
    localStorage.setItem(WARRANT_FLOW_LOCAL_CACHE_KEY, JSON.stringify({
      source: "github-actions",
      updatedAt: warrantFlowUpdatedAt || Date.now(),
      matches: warrantFlowData,
    }));
  } catch (error) {}
}

function loadWarrantFlowLocalCache() {
  try {
    const payload = JSON.parse(localStorage.getItem(WARRANT_FLOW_LOCAL_CACHE_KEY) || "{}");
    if (!String(payload.source || "").includes("github-actions")) return false;
    if (!Array.isArray(payload.matches) || !payload.matches.length) return false;
    warrantFlowData = payload.matches;
    warrantFlowUpdatedAt = cleanNumber(payload.updatedAt) || Date.now();
    return true;
  } catch (error) {
    return false;
  }
}

function showExportNotice(message) {
  if (terminalMessage) terminalMessage.textContent = message;
  const notice = document.createElement("div");
  notice.textContent = message;
  notice.style.cssText = `
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 99999;
    padding: 12px 16px;
    border: 1px solid rgba(127, 166, 255, 0.45);
    border-radius: 10px;
    background: rgba(12, 16, 28, 0.96);
    color: #dbe7ff;
    font-weight: 800;
    box-shadow: 0 12px 36px rgba(0,0,0,0.35);
  `;
  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), 2200);
}

function isExportUnlocked() {
  const until = Number(localStorage.getItem(EXPORT_UNLOCK_KEY) || 0);
  return until > Date.now();
}

async function verifyExportPassword(password) {
  const response = await fetch(endpoints.exportAuth, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok && payload.ok, status: response.status, payload };
}

async function unlockExport() {
  if (isExportUnlocked()) return true;
  const input = window.prompt("請輸入你設定的匯出密碼：");
  if (!input?.trim()) return false;
  try {
    const result = await verifyExportPassword(input.trim());
    if (!result.ok) {
      if (result.payload?.code === "PASSWORD_NOT_SET") {
        showExportNotice("尚未在 Vercel 設定匯出密碼。");
      } else {
        showExportNotice("密碼錯誤，已阻擋匯出。");
      }
      return false;
    }
  } catch (error) {
    showExportNotice("匯出驗證失敗，請稍後再試。");
    return false;
  }
  localStorage.setItem(EXPORT_UNLOCK_KEY, String(Date.now() + EXPORT_UNLOCK_MS));
  showExportNotice("匯出已解鎖，30天內不用再輸入。");
  return true;
}

function getActiveExportRows(limit = Infinity) {
  const table = strategyTable?.querySelector("table");
  if (!table) return { headers: [], rows: [] };
  const headers = [...table.querySelectorAll("thead th")].map((cell) => cell.textContent.trim());
  const rows = [...table.querySelectorAll("tbody tr")]
    .filter((row) => !row.querySelector("td[colspan]"))
    .slice(0, limit)
    .map((row) => [...row.cells].map((cell) => cell.textContent.replace(/\s+/g, " ").trim()));
  return { headers, rows };
}

function csvCell(value) {
  const text = String(value ?? "");
  const guarded = /^[=+\-@]/.test(text) ? `\t${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function downloadCsv(headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const title = (strategyTitle?.textContent || "fuman").replace(/[^\w\u4e00-\u9fa5-]+/g, "-");
  link.href = url;
  link.download = `${title}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyTopRows(headers, rows) {
  const text = [headers.join("\t"), ...rows.map((row) => row.join("\t"))].join("\n");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

async function handleProtectedExport() {
  if (!(await unlockExport())) return;
  const { headers, rows } = getActiveExportRows();
  if (!rows.length) {
    showExportNotice("目前沒有可匯出的股票名單。");
    return;
  }
  const choice = window.prompt("請選擇匯出方式：輸入 1 下載CSV，輸入 2 複製前10。", "1");
  if (choice === "2") {
    await copyTopRows(headers, rows.slice(0, 10));
    showExportNotice("已複製前10名，可貼到 LINE 或 Google Sheets。");
    return;
  }
  downloadCsv(headers, rows);
  showExportNotice(`已匯出 ${rows.length} 筆 CSV。`);
}

function openExportSettings() {
  const action = window.prompt("匯出設定：輸入 1 查看密碼設定方式，輸入 2 鎖回匯出。", "1");
  if (action === "2") {
    localStorage.removeItem(EXPORT_UNLOCK_KEY);
    showExportNotice("匯出已重新上鎖。");
    return;
  }
  if (action !== "1") return;
    window.alert("請直接與作者聯繫");
}

function updateOpenBuyScan(payload, options = {}) {
  const retainUnmatched = options.retainUnmatched !== false;
  const scannedCodes = normalizeArray(payload?.scannedCodes);
  const matches = normalizeArray(payload?.matches);
  const matchedCodes = new Set(matches.map((item) => item.code));
  scannedCodes.forEach((code) => {
    if (code) openBuyScannedCodes.add(code);
  });
  if (!retainUnmatched) {
    scannedCodes.forEach((code) => {
      if (!matchedCodes.has(code)) delete openBuyScanMatches[code];
    });
  }
  matches.forEach((item) => {
    if (!item?.code) return;
    const base = latestStocks.find((stock) => stock.code === item.code) || {};
    if (isStaleStrategyPrice(item, base)) return;
    openBuyScanMatches[item.code] = {
      ...base,
      ...item,
      name: base.name || item.name || item.code,
      tradeVolume: cleanNumber(item.tradeVolume || item.volume || base.tradeVolume),
      value: cleanNumber(item.value || base.value),
      percent: Number.isFinite(Number(item.percent)) ? Number(item.percent) : (base.percent || 0),
      score: cleanNumber(item.score),
      updatedAt: Date.now(),
    };
  });
  openBuyScanCount = Object.keys(openBuyScanMatches).length;
  saveOpenBuyLocalCache();
}

function collectOpenBuyPending(payload) {
  if (!openBuyPendingMatches) openBuyPendingMatches = {};
  if (!openBuyPendingScannedCodes) openBuyPendingScannedCodes = new Set();
  normalizeArray(payload?.scannedCodes).forEach((code) => {
    if (code) openBuyPendingScannedCodes.add(code);
  });
  normalizeArray(payload?.matches).forEach((item) => {
    if (!item?.code) return;
    const base = latestStocks.find((stock) => stock.code === item.code) || {};
    openBuyPendingMatches[item.code] = {
      ...base,
      ...item,
      name: base.name || item.name || item.code,
      tradeVolume: cleanNumber(item.tradeVolume || item.volume || base.tradeVolume),
      value: cleanNumber(item.value || base.value),
      percent: Number.isFinite(Number(item.percent)) ? Number(item.percent) : (base.percent || 0),
      score: cleanNumber(item.score),
      updatedAt: Date.now(),
    };
  });
}

function commitOpenBuyPending() {
  if (!openBuyPendingMatches || !openBuyPendingScannedCodes) return;
  openBuyScanMatches = { ...openBuyPendingMatches };
  openBuyScannedCodes = new Set(openBuyPendingScannedCodes);
  openBuyScanCount = Object.keys(openBuyScanMatches).length;
  openBuyScanLastAt = Date.now();
  openBuyPendingMatches = null;
  openBuyPendingScannedCodes = null;
  saveOpenBuyLocalCache();
}

function saveOpenBuyLocalCache() {
  try {
    const matches = Object.values(openBuyScanMatches);
    const payload = {
      source: "github-actions",
      updatedAt: openBuyScanLastAt || Date.now(),
      total: openBuyScanTotal,
      scannedCodes: [...openBuyScannedCodes],
      matches,
    };
    localStorage.setItem(OPEN_BUY_LOCAL_CACHE_KEY, JSON.stringify(payload));
    if (matches.length) {
      localStorage.setItem(OPEN_BUY_BACKUP_CACHE_KEY, JSON.stringify(payload));
    }
  } catch (error) {}
}

function loadOpenBuyLocalCache() {
  try {
    let payload = JSON.parse(localStorage.getItem(OPEN_BUY_LOCAL_CACHE_KEY) || "{}");
    if (!Array.isArray(payload.matches) || !payload.matches.length) {
      payload = JSON.parse(localStorage.getItem(OPEN_BUY_BACKUP_CACHE_KEY) || "{}");
    }
    if (!String(payload.source || "").includes("github-actions")) return false;
    if (!Array.isArray(payload.matches) || !payload.matches.length) return false;
    if (payload.total) openBuyScanTotal = cleanNumber(payload.total);
    openBuyScanMatches = {};
    openBuyScannedCodes = new Set();
    normalizeArray(payload.scannedCodes).forEach((code) => {
      if (code) openBuyScannedCodes.add(code);
    });
    normalizeArray(payload.matches).forEach((item) => {
      if (!item?.code) return;
      openBuyScanMatches[item.code] = { ...item };
    });
    openBuyScanCount = Object.keys(openBuyScanMatches).length;
    openBuyScanLastAt = cleanNumber(payload.updatedAt) || Date.now();
    return true;
  } catch (error) {
    return false;
  }
}

function mergeOpenBuyCache(payload) {
  openBuyScanMatches = {};
  openBuyScannedCodes = new Set();
  openBuyPage = 1;
  normalizeArray(payload?.scannedCodes).forEach((code) => {
    if (code) openBuyScannedCodes.add(code);
  });
  if (payload?.total) openBuyScanTotal = cleanNumber(payload.total);
  normalizeArray(payload?.matches).forEach((item) => {
    if (!item?.code) return;
    const base = latestStocks.find((stock) => stock.code === item.code) || {};
    openBuyScanMatches[item.code] = { ...base, ...item, name: base.name || item.name || item.code };
  });
  openBuyScanCount = Object.keys(openBuyScanMatches).length;
  const updatedAt = Date.parse(payload?.updatedAt || "");
  openBuyScanLastAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
  saveOpenBuyLocalCache();
}

async function loadOpenBuyCache(force = false) {
  if (openBuyCacheLoading) return;
  if (!shouldLoadOpenBuyRemote(force)) return;
  if (shouldSkipMobileOtherStrategyCacheRefresh("openBuy", Object.keys(openBuyScanMatches).length > 0, force)) {
    renderStrategyScanner();
    return;
  }
  openBuyCacheLoading = true;
  openBuyCacheCheckedAt = Date.now();
  try {
    let payload = await fetchJson(`${endpoints.openBuyCache}?t=${Date.now()}`, 10000);
    if (!normalizeArray(payload?.matches).length) {
      payload = await fetchJson(`${endpoints.openBuyBackup}?t=${Date.now()}`, 10000);
    }
    const incomingMatches = normalizeArray(payload?.matches);
    const hasCurrentMatches = Object.keys(openBuyScanMatches).length > 0;
    if (payload?.ok && Array.isArray(payload.matches) && (incomingMatches.length || !hasCurrentMatches)) {
      mergeOpenBuyCache(payload);
      renderStrategyScanner();
    }
  } catch (error) {
  } finally {
    openBuyCacheLoading = false;
  }
}

async function loadStrategy3Cache(force = false) {
  if (strategy3CacheLoading) return;
  if (!force && strategy3Data.length) return;
  if (shouldSkipMobileOtherStrategyCacheRefresh("strategy3", strategy3Data.length > 0, force)) {
    renderStrategyScanner();
    return;
  }
  strategy3CacheLoading = true;
  try {
    let payload = await fetchJson(`${endpoints.strategy3Cache}?t=${Date.now()}`, 10000);
    if (!normalizeArray(payload?.matches).length) {
      payload = await fetchJson(`${endpoints.strategy3Backup}?t=${Date.now()}`, 10000);
    }
    strategy3Data = normalizeArray(payload?.matches);
    const updatedAt = Date.parse(payload?.updatedAt || "");
    strategy3UpdatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    renderStrategyScanner();
  } catch (error) {
  } finally {
    strategy3CacheLoading = false;
  }
}

async function loadStrategy5Cache(force = false) {
  if (strategy5CacheLoading) return;
  if (!force && strategy5Data.length) return;
  if (shouldSkipMobileOtherStrategyCacheRefresh("strategy5", strategy5Data.length > 0, force)) {
    renderStrategyScanner();
    return;
  }
  strategy5CacheLoading = true;
  try {
    let payload = await fetchJson(`${endpoints.strategy5Cache}?t=${Date.now()}`, 10000);
    if (!normalizeArray(payload?.matches).length) {
      payload = await fetchJson(`${endpoints.strategy5Backup}?t=${Date.now()}`, 10000);
    }
    strategy5Data = normalizeArray(payload?.matches);
    const updatedAt = Date.parse(payload?.updatedAt || "");
    strategy5UpdatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    renderStrategyScanner();
  } catch (error) {
  } finally {
    strategy5CacheLoading = false;
  }
}

function updateStrategyQuote(quote) {
  if (!quote?.code || !quote.close) return;
  const previous = strategyRealtimeQuotes[quote.code];
  const now = Date.now();
  const prevPoint = previous?.history?.at(-1);
  const volume = quote.tradeVolume || 0;
  const prevVolume = prevPoint?.volume || 0;
  const dtSeconds = prevPoint?.ts ? Math.max((now - prevPoint.ts) / 1000, 1) : 0;
  const deltaVolume = volume > prevVolume ? volume - prevVolume : 0;
  const volumeRate = dtSeconds ? deltaVolume / dtSeconds : 0;
  const history = [...(previous?.history || []), {
    price: quote.close,
    volume,
    deltaVolume,
    volumeRate,
    ts: now,
  }]
    .slice(-12);
  strategyRealtimeQuotes[quote.code] = { ...previous, ...quote, history, updatedAt: now };
}

function normalizeTradeVolumeLots(volume) {
  const value = cleanNumber(volume);
  if (!value) return 0;
  return value > 100000 ? value / 1000 : value;
}

function estimateTradeValue(close, volumeLots) {
  const price = cleanNumber(close);
  const lots = cleanNumber(volumeLots);
  return price && lots ? price * lots * 1000 : 0;
}

function estimateVwap(value, volumeLots) {
  const tradeValue = cleanNumber(value);
  const lots = cleanNumber(volumeLots);
  return tradeValue && lots ? tradeValue / (lots * 1000) : 0;
}

function applyStrategyQuote(stock) {
  const quote = strategyRealtimeQuotes[stock.code];
  if (!quote?.close) return stock;
  const quoteVolume = normalizeTradeVolumeLots(quote.tradeVolume);
  const value = cleanNumber(quote.value || quote.tradeValue) || estimateTradeValue(quote.close, quoteVolume) || stock.value;
  const prevClose = cleanNumber(quote.prevClose);
  const change = prevClose ? quote.close - prevClose : cleanNumber(quote.change);
  const percent = prevClose ? (change / prevClose) * 100 : cleanNumber(quote.percent);
  return {
    ...stock,
    name: quote.name || stock.name,
    close: quote.close,
    change,
    percent,
    tradeVolume: quoteVolume || stock.tradeVolume,
    value: value || stock.value,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    prevClose: prevClose || quote.prevClose,
    limitUp: quote.limitUp,
    quoteTime: quote.time || stock.quoteTime,
    isRealtime: true,
  };
}

function emaLast(values, length) {
  const rows = normalizeArray(values).map(cleanNumber).filter((value) => value > 0);
  if (!rows.length) return 0;
  const k = 2 / (length + 1);
  return rows.reduce((ema, value, index) => index === 0 ? value : value * k + ema * (1 - k), rows[0]);
}

function rsiLast(values, length = 14) {
  const rows = normalizeArray(values).map(cleanNumber).filter((value) => value > 0);
  if (rows.length <= 1) return 50;
  const changes = rows.slice(1).map((value, index) => value - rows[index]);
  const recent = changes.slice(-length);
  const gain = avg(recent.map((change) => Math.max(change, 0)));
  const loss = avg(recent.map((change) => Math.max(-change, 0)));
  if (!loss) return gain ? 100 : 50;
  const rs = gain / loss;
  return 100 - (100 / (1 + rs));
}

function getIntradaySignals(stock) {
  const quote = strategyRealtimeQuotes[stock.code];
  const history = quote?.history || [];
  const prices = history.map((item) => item.price);
  const close = cleanNumber(stock.close);
  const open = cleanNumber(stock.open);
  const high = cleanNumber(stock.high);
  const low = cleanNumber(stock.low);
  const prevClose = cleanNumber(stock.prevClose) || (close - cleanNumber(stock.change));
  const pct = stock.percent || 0;
  const valueRank = stock.valueRank || 0;
  const volumeRank = stock.volumeRank || 0;
  const volume = cleanNumber(stock.tradeVolume);
  const inferredLimitUp = prevClose ? prevClose * 1.1 : 0;
  const limitUp = cleanNumber(stock.limitUp) || inferredLimitUp;
  const daily = stock.swingDaily || analyzeSwingDaily(stock);
  const dailyVolumeRatio = daily?.volumeRatio || 0;
  const yesterdayHigh = cleanNumber(daily?.prev?.high);
  const highest20Prev = cleanNumber(daily?.highest20Prev);
  const vwap = stock.vwap || estimateVwap(stock.value, stock.tradeVolume);
  const gapPct = open && prevClose ? ((open - prevClose) / prevClose) * 100 : 0;
  const isNearLimit = limitUp && close >= limitUp * 0.985;
  const breaksYesterdayHigh = yesterdayHigh && close >= yesterdayHigh * 1.002;
  const breaks20High = highest20Prev && close >= highest20Prev * 1.002;
  const lastPrice = prices.at(-1) || close;
  const priorPrice = prices.at(-2) || 0;
  const burstPct = priorPrice ? ((lastPrice - priorPrice) / priorPrice) * 100 : 0;
  const latestPoint = history.at(-1) || {};
  const recentDeltaVolume = latestPoint.deltaVolume || 0;
  const recentDeltas = history.slice(-3).map((item) => item.deltaVolume || 0);
  const deltaVolumeRising = recentDeltas.length >= 3
    && recentDeltas.every((value) => value > 0)
    && recentDeltas[2] > recentDeltas[1]
    && recentDeltas[1] > recentDeltas[0]
    && recentDeltas[2] >= 50;
  const priorRates = history.slice(0, -1).map((item) => item.volumeRate || 0).filter((rate) => rate > 0);
  const recentBaseRate = avg(priorRates.slice(-5));
  const elapsedSeconds = quote?.updatedAt ? Math.max((quote.updatedAt - new Date().setHours(9, 0, 0, 0)) / 1000, 1) : 0;
  const dayAvgRate = elapsedSeconds > 0 ? (quote?.tradeVolume || 0) / elapsedSeconds : 0;
  const currentRate = latestPoint.volumeRate || 0;
  const rateVsDay = dayAvgRate ? currentRate / dayAvgRate : 0;
  const rateVsRecent = recentBaseRate ? currentRate / recentBaseRate : 0;
  const shortAvg = avg(prices.slice(-3));
  const longAvg = avg(prices.slice(-8));
  const macdUp = prices.length >= 3 && shortAvg > longAvg && lastPrice >= (prices.at(-2) || lastPrice);
  const ma35Proxy = longAvg || avg([prevClose, open, high, low, close]);
  const guaPrices = [...prices, close].filter(Boolean).slice(-24);
  const ema9 = emaLast(guaPrices, 9) || shortAvg || close;
  const ema20 = emaLast(guaPrices, 20) || longAvg || ema9;
  const rsi = rsiLast(guaPrices, 14);
  const bandWidth = close ? Math.abs(ema9 - ema20) / close * 100 : 0;
  const priceBias = ema20 ? (close - ema20) / ema20 * 100 : 0;
  const ibRange = high && low ? high - low : 0;
  const f618 = ibRange > 0 ? high - ibRange * 0.618 : 0;
  const signals = [];
  if (!close || !hasIntradayLiquidity(stock)) return signals;
  const volumeMilestone = volume >= 10000 ? 10000 : volume >= 5000 ? 5000 : volume >= 2000 ? 2000 : 0;
  const minuteVolumeRising = deltaVolumeRising || recentDeltaVolume >= 100;
  const minuteBurst = recentDeltaVolume >= 300 || (dayAvgRate && currentRate >= dayAvgRate * 3 && recentDeltaVolume >= 120) || (recentBaseRate && currentRate >= recentBaseRate * 2.5 && recentDeltaVolume >= 120);
  const guaPriorHigh = Math.max(...guaPrices.slice(-16, -1), 0);
  const guaVolumeOk = Boolean(volumeMilestone || minuteVolumeRising || volumeRank >= 55);
  const guaAllowed = bandWidth >= 0.09 && guaVolumeOk;
  const guaButterflyBuy = guaAllowed && priceBias < -2 && close >= open && guaPriorHigh && close > guaPriorHigh;
  const guaFlagLong = guaAllowed && guaPriorHigh && close > guaPriorHigh && ema9 > ema20 && close > open;
  const guaAbcdLong = guaAllowed && ema9 > ema20 && low <= ema9 * 1.001 && close > ema9 && close > open;
  const guaOrbLong = guaAllowed && guaPriorHigh && close > guaPriorHigh && close > open;
  const guaAngelLong = guaAllowed && vwap && low <= vwap && close > vwap && rsi > 45 && close > open && ema9 > ema20;
  const guaVwapLong = guaAllowed && vwap && priorPrice <= vwap && close > vwap && rsi > 50 && close > open;

  if ((pct > 2 || (open && close >= open) || volumeMilestone) && volume >= INTRADAY_MIN_VOLUME) {
    signals.push({
      id: "early_strength",
      short: "早盤強",
      icon: "⚡",
      reason: `早盤即時偵測：漲幅 ${pct.toFixed(2)}%，現價${open && close >= open ? "站上" : "未站上"}開盤價，成交量 ${Math.round(volume).toLocaleString("zh-TW")} 張${volumeMilestone ? `，已達 ${volumeMilestone.toLocaleString("zh-TW")} 張級距` : ""}。`,
    });
  }

  if (volumeMilestone && minuteVolumeRising) {
    const burstLabel = minuteBurst
      ? "急拉爆量"
      : recentDeltaVolume >= 100
      ? "分時爆量"
      : "分時放大";
    const deltaText = deltaVolumeRising
      ? `最近三輪新增量 ${recentDeltas.map((value) => Math.round(value).toLocaleString("zh-TW")).join(" → ")} 張`
      : `最近一輪新增 ${Math.round(recentDeltaVolume).toLocaleString("zh-TW")} 張`;
    signals.push({
      id: "volume_burst",
      short: `${burstLabel}${Math.round(volumeMilestone / 1000)}千`,
      icon: "📊",
      reason: `${burstLabel}，${deltaText}，總量 ${Math.round(volume).toLocaleString("zh-TW")} 張，量速約今日均速 ${rateVsDay ? rateVsDay.toFixed(1) : "--"} 倍。`,
    });
  }

  if (guaButterflyBuy) {
    signals.push({
      id: "gua_butterfly_buy",
      short: "蝴蝶買",
      icon: "🦋",
      reason: `瓜蝶-蝴蝶買：乖離 ${priceBias.toFixed(2)}%，紅K突破前高，偏反彈開火。`,
    });
  }

  if (guaFlagLong) {
    signals.push({
      id: "gua_flag_long",
      short: "旗形多",
      icon: "🚩",
      reason: `瓜蝶-旗形多：EMA9 在 EMA20 上方，價格突破近段高點 ${formatTradePrice(guaPriorHigh)}。`,
    });
  }

  if (guaAbcdLong) {
    signals.push({
      id: "gua_abcd_long",
      short: "ABCD多",
      icon: "📈",
      reason: `瓜蝶-ABCD多：回測 EMA9 ${formatTradePrice(ema9)} 後收上，支撐轉強。`,
    });
  }

  if (guaOrbLong) {
    signals.push({
      id: "gua_orb_long",
      short: "ORB多",
      icon: "🚀",
      reason: `瓜蝶-ORB多：突破近段高點 ${formatTradePrice(guaPriorHigh)}，多頭趨勢啟動。`,
    });
  }

  if (guaAngelLong) {
    signals.push({
      id: "gua_angel_long",
      short: "Angel多",
      icon: "👼",
      reason: `瓜蝶-Angel多：回測 VWAP ${formatTradePrice(vwap)} 後站回，RSI ${rsi.toFixed(0)}。`,
    });
  }

  if (guaVwapLong) {
    signals.push({
      id: "gua_vwap_long",
      short: "VWAP多",
      icon: "🌀",
      reason: `瓜蝶-VWAP多：由下往上突破 VWAP ${formatTradePrice(vwap)}，RSI ${rsi.toFixed(0)}。`,
    });
  }

  if (open && prevClose && open > yesterdayHigh && gapPct >= 2 && close >= open && (volumeMilestone || volumeRank >= 55)) {
    signals.push({
      id: "gap",
      short: "真跳空",
      icon: "🚀",
      reason: `真跳空，開盤高於昨日高點，跳空 ${gapPct.toFixed(2)}%，現價仍站在開盤價上方。`,
    });
  }

  if ((breaks20High || breaksYesterdayHigh || pct >= 6) && (volumeRank >= 55 || dailyVolumeRatio >= 1.2 || isNearLimit || volume >= 1200)) {
    signals.push({
      id: "daily_breakout",
      short: breaks20High ? "20日突" : "昨高突",
      icon: "▲",
      reason: `${breaks20High ? "突破近20日壓力" : "突破昨日高點"}，搭配盤中量能放大，列入日K底稿觸發。`,
    });
  }

  if (pct >= 1 && (volumeRank >= 55 || volume >= 5000) && (!open || close >= open) && (!vwap || close >= vwap || pct >= 5) && (!high || close >= high * 0.992 || pct >= 5)) {
    signals.push({ id: "breakout", short: "突破", icon: "🔥", reason: `突破盤中強勢區，漲幅 ${pct.toFixed(2)}%，成交張數同步放大。` });
  }

  if (close > yesterdayHigh && (!vwap || close > vwap) && open && close > open && (volumeRank >= 50 || minuteVolumeRising || volumeMilestone)) {
    signals.push({
      id: "fire",
      short: "轉強",
      icon: "🔥",
      reason: `轉強突破，站上昨日高點、VWAP 與開盤價，符合長白龍轉強概念。`,
    });
  }

  if (close > ma35Proxy && macdUp && pct > 0 && (volumeRank >= 55 || volume >= 5000)) {
    signals.push({ id: "ma35_macd", short: "MA35", icon: "🟢", reason: `站上 MA35 近似線，短線均值高於長線均值，MACD 動能向上。` });
  }

  if (open > ma35Proxy && close > ma35Proxy && low > ma35Proxy && close > open && priorPrice && priorPrice <= ma35Proxy) {
    signals.push({
      id: "ma35_buy",
      short: "MA35買",
      icon: "🟢",
      reason: `整根站上 MA35 近似線，前一輪仍在 MA35 下方，符合 MA35 支撐買點概念。`,
    });
  }

  if (f618 && low <= f618 && high >= f618 && close >= open && close > ma35Proxy && macdUp) {
    signals.push({ id: "diamond", short: "鑽石", icon: "💎", reason: `回測 0.618 區後收紅，並維持在 MA35 動能區上方。` });
  }

  if (minuteVolumeRising && f618 && low <= f618 && high >= f618 && close >= open && close > ma35Proxy) {
    signals.push({
      id: "volume_diamond",
      short: "量+鑽石",
      icon: "💎",
      reason: `分時放大 + 鑽石：回測 0.618 後收紅，且分時量能同步放大。`,
    });
  }

  if (minuteVolumeRising && close > ma35Proxy && close >= open && (macdUp || volumeRank >= 55 || volume >= 5000)) {
    signals.push({
      id: "volume_ma35",
      short: "量+MA35",
      icon: "🟢",
      reason: `分時放大 + MA35：站上 MA35 近似線，且分時量能同步放大。`,
    });
  }

  if (
    burstPct >= 1.2 &&
    (latestPoint.deltaVolume || 0) >= 20 &&
    rateVsDay >= 3 &&
    rateVsRecent >= 2 &&
    high && close >= high * 0.993 &&
    open && close > open &&
    pct >= 1 && pct <= 8
  ) {
    signals.push({
      id: "surge",
      short: "拉抬",
      icon: "⚡",
      reason: `瞬間拉抬 ${burstPct.toFixed(2)}%，新增量 ${Math.round(latestPoint.deltaVolume)} 張，量速為今日均速 ${rateVsDay.toFixed(1)} 倍。`,
    });
  }

  return signals;
}

const STRATEGY_DEFS = [
  { id: "foreign_trust_breakout", label: "外資投信連買準突破", short: "準突破", icon: "◆" },
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
  { id: "short_fund_flow", label: "短線資金動能", short: "資金", icon: "◇" },
  { id: "chip_health_strong", label: "籌碼健檢強勢", short: "籌碼", icon: "▣" },
  { id: "one_day_rebound", label: "大跌一日反彈", short: "反彈", icon: "↥" },
  { id: "short_squeeze", label: "融券嘎空雷達", short: "嘎空", icon: "⌁" },
  { id: "ultra_short", label: "超短線操作", short: "短打", icon: "⚡" },
];

const STRATEGY_BY_ID = Object.fromEntries(STRATEGY_DEFS.map((item) => [item.id, item]));
const STRATEGY5_IDS = ["short_fund_flow", "chip_health_strong", "one_day_rebound", "short_squeeze", "ultra_short"];
const STRATEGY5_PRESET_IDS = [
  "foreign_trust_breakout",
];
const INTRADAY_EXCLUDED_CODES = new Set([
  "2330", "2412", "3045",
  "2208", "2634", "2645", "4541", "4572", "5009", "6753", "8033", "8222",
]);

function ensureStrategyCards() {
  if (!strategyList) return;
  const title = strategyList.querySelector("p");
  if (title && title.textContent.includes("策略清單")) {
    title.textContent = `策略清單 (${strategyList.querySelectorAll(".strategy-card[data-strategy]").length})`;
  }
  strategyCards = [...document.querySelectorAll(".strategy-card[data-strategy]")];
  labelUpdateModes();
}

function buildStrategyUniverse(stocks) {
  const liveStocks = stocks.map((stock) => applyStrategyQuote(stock));
  const values = liveStocks.map((s) => s.value || 0).sort((a, b) => a - b);
  const volumes = liveStocks.map((s) => s.tradeVolume || 0).sort((a, b) => a - b);
  const percents = liveStocks.map((s) => s.percent || 0).sort((a, b) => a - b);
  return liveStocks.map((liveStock) => {
    const rankedStock = {
      ...liveStock,
      valueRank: rankValue(liveStock.value || 0, values),
      volumeRank: rankValue(liveStock.tradeVolume || 0, volumes),
      percentRank: rankValue(liveStock.percent || 0, percents),
      sector: SECTOR_MAP[liveStock.code] || "未分類",
      inst: getInstitutionTotal(liveStock.code),
    };
    const swingDaily = analyzeSwingDaily(rankedStock);
    const swingStock = { ...rankedStock, swingDaily };
    const intradaySignals = getIntradaySignals(swingStock);
    const intradayEntry = getIntradayEntryPlan({ ...swingStock, intradaySignals });
    return {
      ...swingStock,
      intradaySignals,
      intradayEntry,
      swingStage: getSwingStage(swingStock),
      swingSignals: getSwingSignals(swingStock),
    };
  });
}

function isIntradayTradable(stock) {
  const code = String(stock?.code || "");
  const close = cleanNumber(stock?.close);
  const value = cleanNumber(stock?.value);
  const volume = cleanNumber(stock?.tradeVolume);
  const name = String(stock?.name || "");
  if (!/^\d{4}$/.test(code) || /^00/.test(code)) return false;
  if (/ETF|ETN|指數|台灣50|高股息|正2|反1|期貨|債/i.test(name)) return false;
  if (/軍工|航太|漢翔|雷虎|駐龍|寶一|晟田|長榮航太|龍德造船|台船|榮剛/i.test(name)) return false;
  if (/^(28|58)/.test(code)) return false;
  if (INTRADAY_EXCLUDED_CODES.has(code)) return false;
  return true;
}

function hasIntradayLiquidity(stock) {
  const volume = cleanNumber(stock?.tradeVolume);
  return volume >= INTRADAY_MIN_VOLUME;
}

function roundTradePrice(price) {
  const value = cleanNumber(price);
  if (!value) return 0;
  const tick = value >= 1000 ? 5 : value >= 500 ? 1 : value >= 100 ? 0.5 : value >= 50 ? 0.1 : value >= 10 ? 0.05 : 0.01;
  return Math.round(value / tick) * tick;
}

function formatTradePrice(price) {
  const value = roundTradePrice(price);
  return value ? formatNumber(value, value >= 100 ? 1 : 2) : "--";
}

function getIntradayEntryPlan(stock) {
  if (!stock?.intradaySignals?.length || cleanNumber(stock.percent) < 2) return null;
  const close = cleanNumber(stock.close);
  const open = cleanNumber(stock.open);
  const high = cleanNumber(stock.high) || close;
  const low = cleanNumber(stock.low);
  const tradedLow = low || close;
  const executableClose = Math.max(close, tradedLow);
  const prevHigh = cleanNumber(stock.swingDaily?.prev?.high);
  const vwap = stock.vwap || estimateVwap(stock.value, stock.tradeVolume);
  const prices = strategyRealtimeQuotes[stock.code]?.history?.map((item) => item.price).filter(Boolean) || [];
  const ma35 = avg(prices.slice(-8)) || avg([open, high, low, close].filter(Boolean));
  const ibRange = high && low ? high - low : 0;
  const f618 = ibRange > 0 ? high - ibRange * 0.618 : 0;
  const signalIds = new Set(stock.intradaySignals.map((signal) => signal.id));
  const supports = [vwap, open, ma35, prevHigh, f618]
    .map(cleanNumber)
    .filter((price) => price > 0 && price <= close * 1.003);
  const pullbackBase = supports.length ? Math.max(...supports) : close * 0.995;
  const supportPrice = roundTradePrice(pullbackBase);
  const entryPrice = roundTradePrice(executableClose);
  const nearHigh = high && close >= high * 0.992;
  const overExtended = high && close >= high * 0.998 && cleanNumber(stock.percent) >= 7;
  const hasBreakout = signalIds.has("fire") || signalIds.has("gap") || signalIds.has("daily_breakout") || signalIds.has("breakout") || signalIds.has("gua_flag_long") || signalIds.has("gua_orb_long") || signalIds.has("gua_vwap_long");
  const hasSupportBuy = signalIds.has("ma35_buy") || signalIds.has("diamond") || signalIds.has("ma35_macd") || signalIds.has("volume_diamond") || signalIds.has("volume_ma35") || signalIds.has("gua_abcd_long") || signalIds.has("gua_angel_long") || signalIds.has("gua_butterfly_buy");

  let label = "等回測";
  let entryLow = Math.max(pullbackBase, tradedLow);
  let entryHigh = Math.max(Math.min(executableClose, pullbackBase * 1.006), entryLow);
  if (hasBreakout && !overExtended) {
    label = nearHigh ? "突破可試" : "可進場";
    entryLow = Math.max(pullbackBase, executableClose * 0.997, tradedLow);
    entryHigh = Math.max(executableClose, entryLow);
  } else if (hasSupportBuy) {
    label = "支撐買點";
    entryLow = Math.max(pullbackBase, tradedLow);
    entryHigh = Math.max(Math.min(executableClose, pullbackBase * 1.005), entryLow);
  }
  if (overExtended) {
    label = "不追等回測";
    entryLow = Math.max(pullbackBase, tradedLow);
    entryHigh = Math.max(Math.min(executableClose * 0.995, pullbackBase * 1.004), entryLow);
  }

  const stopBase = Math.min(entryLow, vwap || entryLow, ma35 || entryLow);
  const stopLoss = stopBase * 0.985;
  const chaseLimit = Math.min(high || close * 1.012, close * 1.01);
  return {
    label,
    entryPrice,
    supportPrice,
    entryLow: roundTradePrice(entryLow),
    entryHigh: roundTradePrice(Math.max(entryHigh, entryLow)),
    stopLoss: roundTradePrice(stopLoss),
    chaseLimit: roundTradePrice(chaseLimit),
    reason: hasBreakout ? "突破站穩" : hasSupportBuy ? "支撐回測" : "等待回測",
  };
}

function renderEntryPlan(plan) {
  if (!plan) return "--";
  return plan.supportPrice ? `<b>支撐價位</b><small>${formatTradePrice(plan.supportPrice)}</small>` : "--";
}

function formatEntryRange(plan) {
  if (!plan) return "--";
  if (plan.entryPrice) return formatTradePrice(plan.entryPrice);
  return plan.entryLow === plan.entryHigh
    ? formatTradePrice(plan.entryLow)
    : `${formatTradePrice(plan.entryLow)}-${formatTradePrice(plan.entryHigh)}`;
}

function strategyHit(id, stock) {
  const pct = stock.percent || 0;
  const valueRank = stock.valueRank || 0;
  const volumeRank = stock.volumeRank || 0;
  const inst = stock.inst || getInstitutionTotal(stock.code);
  const smartMoney = inst.total + inst.trust * 1.4;
  const close = cleanNumber(stock.close);
  const highest20Prev = cleanNumber(stock.swingDaily?.highest20Prev);
  const nearBreakout = highest20Prev ? close >= highest20Prev * 0.965 && close <= highest20Prev * 1.035 : true;
  const trustBuying = cleanNumber(inst.trust) > 0;
  const foreignBuying = cleanNumber(inst.foreign) > 0;
  const jointBuying = cleanNumber(inst.total) > 0 && trustBuying && foreignBuying;

  const scoreBase = clamp(
    Math.round(35 + pct * 7 + valueRank * 0.24 + volumeRank * 0.18 + Math.sign(smartMoney) * 8),
    0,
    100
  );

  const rules = {
    foreign_trust_breakout: {
      hit: jointBuying && nearBreakout && pct > -1.5 && pct <= 7.5 && close >= 10,
      score: clamp(scoreBase + 18 + (trustBuying ? 8 : 0) + (foreignBuying ? 6 : 0), 0, 100),
      reason: `外資 ${formatInstitution(inst.foreign)}、投信 ${formatInstitution(inst.trust)} 同買，法人合計 ${formatInstitution(inst.total)}；漲幅 ${pct.toFixed(2)}%。`,
    },
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
      hit: isIntradayTradable(stock) && pct >= 2 && (stock.intradaySignals?.length || 0) > 0,
      score: clamp(scoreBase + 12 + Math.min(pct * 4, 28) + (stock.intradaySignals?.length || 0) * 8, 0, 100),
      reason: stock.intradaySignals?.length
        ? stock.intradaySignals.map((signal) => signal.reason).join(" ")
        : `成交值與成交量同步進前段班，適合當沖雷達追蹤。`,
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
    short_fund_flow: {
      hit: pct >= 1.5 && pct <= 8.8 && valueRank >= 68 && volumeRank >= 62 && stock.change > 0,
      score: clamp(scoreBase + 14 + Math.min(pct * 2, 12), 0, 100),
      reason: `短線資金集中，漲幅 ${pct.toFixed(2)}%，成交值排名 ${valueRank}%，成交量排名 ${volumeRank}%。`,
    },
    chip_health_strong: {
      hit: pct > 0 && valueRank >= 50 && (inst.total > 0 || inst.trust > 0 || inst.foreign > 0),
      score: clamp(scoreBase + 12 + (inst.trust > 0 ? 8 : 0) + (inst.foreign > 0 ? 5 : 0), 0, 100),
      reason: `籌碼偏強，外資 ${formatInstitution(inst.foreign)}、投信 ${formatInstitution(inst.trust)}、法人合計 ${formatInstitution(inst.total)}。`,
    },
    one_day_rebound: {
      hit: Boolean(stock.swingDaily?.rows?.length >= 3 &&
        stock.swingDaily.rows.at(-2).close < stock.swingDaily.rows.at(-3).close * 0.97 &&
        stock.swingDaily.last.close > stock.swingDaily.last.open &&
        stock.swingDaily.pct >= 1 &&
        stock.swingDaily.volumeRatio >= 0.8),
      score: clamp(scoreBase + 10 + (stock.swingDaily?.volumeRatio || 0) * 5, 0, 100),
      reason: stock.swingDaily
        ? `前一日大跌後收紅反彈，今日漲幅 ${stock.swingDaily.pct.toFixed(2)}%，量比 ${stock.swingDaily.volumeRatio.toFixed(2)}。`
        : "等待日K資料確認大跌反彈結構。",
    },
    short_squeeze: {
      hit: pct >= 3 && pct <= 9.8 && volumeRank >= 70 && valueRank >= 60 && stock.percentRank >= 75,
      score: clamp(scoreBase + 16 + (pct >= 6 ? 8 : 0), 0, 100),
      reason: `強漲放量，漲幅排名 ${stock.percentRank}%，量能排名 ${volumeRank}%，列入融券嘎空觀察。`,
    },
    ultra_short: {
      hit: ((stock.intradaySignals?.length || 0) > 0 && pct > 0) || (pct >= 2 && pct <= 8.5 && valueRank >= 72 && volumeRank >= 68),
      score: clamp(scoreBase + 10 + (stock.intradaySignals?.length || 0) * 6, 0, 100),
      reason: stock.intradaySignals?.length
        ? `超短線訊號：${stock.intradaySignals.map((signal) => signal.short).join("、")}。`
        : `盤中量價同步偏強，適合超短線觀察，漲幅 ${pct.toFixed(2)}%。`,
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

const INTRADAY_SIGNAL_DEFS = [
  { id: "early_strength", title: "早盤強勢", icon: "⚡", hint: "漲幅與量能先進雷達" },
  { id: "volume_burst", title: "爆量", icon: "📊", hint: "成交張數進市場前段" },
  { id: "daily_breakout", title: "日K突破", icon: "▲", hint: "突破昨日或20日壓力" },
  { id: "gap", title: "跳空", icon: "🚀", hint: "開盤高於昨收且量能放大" },
  { id: "breakout", title: "突破", icon: "🔥", hint: "站上盤中強勢區與 VWAP" },
  { id: "ma35_macd", title: "MA35 + MACD", icon: "🟢", hint: "站上 MA35 且動能向上" },
  { id: "diamond", title: "鑽石", icon: "💎", hint: "回測 0.618 後收紅轉強" },
  { id: "volume_diamond", title: "量+鑽石", icon: "💎", hint: "分時放大搭配 0.618 回測" },
  { id: "volume_ma35", title: "量+MA35", icon: "🟢", hint: "分時放大搭配 MA35 支撐" },
  { id: "surge", title: "瞬間拉抬", icon: "⚡", hint: "短時間價格快速推升" },
  { id: "gua_butterfly_buy", title: "蝴蝶買", icon: "🦋", hint: "乖離反彈後突破前高" },
  { id: "gua_flag_long", title: "旗形多", icon: "🚩", hint: "EMA多頭排列後突破旗形" },
  { id: "gua_abcd_long", title: "ABCD多", icon: "📈", hint: "回測 EMA9 支撐後轉強" },
  { id: "gua_orb_long", title: "ORB多", icon: "🚀", hint: "突破近段高點啟動" },
  { id: "gua_angel_long", title: "Angel多", icon: "👼", hint: "VWAP回測支撐成功" },
  { id: "gua_vwap_long", title: "VWAP多", icon: "🌀", hint: "由下往上突破 VWAP" },
];

const SWING_SIGNAL_DEFS = [
  { id: "bull_attack", title: "多頭攻擊", icon: "🔥", hint: "價量轉強且趨勢偏多" },
  { id: "n_base", title: "N字共振", icon: "", hint: "攻擊後回檔再轉強" },
  { id: "saucer", title: "圓弧底", icon: "◜", hint: "低位整理後突破" },
  { id: "breakaway_gap", title: "突破缺口", icon: "◆", hint: "跳空突破整理高點" },
  { id: "runaway_gap", title: "逃逸缺口", icon: "🚀", hint: "多頭延續型缺口" },
  { id: "v_reversal", title: "V轉反彈", icon: "", hint: "跌深後快速翻紅" },
  { id: "three_inside", title: "三內翻紅", icon: "↻", hint: "弱轉強反轉型態" },
  { id: "golden_cross", title: "多金釵", icon: "✦", hint: "短均線轉強候選" },
];

function buildSwingDailyRows(stock) {
  const history = strategyHistoryData[stock.code];
  if (!history?.rows?.length) return [];
  const rows = history.rows.map((row) => ({ ...row }));
  const today = new Date().toISOString().slice(0, 10);
  const close = cleanNumber(stock.close);
  const open = cleanNumber(stock.open) || close;
  const high = cleanNumber(stock.high) || Math.max(open, close);
  const low = cleanNumber(stock.low) || Math.min(open, close);
  const volume = cleanNumber(stock.tradeVolume);
  const value = cleanNumber(stock.value);
  if (close) {
    const last = rows.at(-1);
    const liveRow = {
      date: today,
      open,
      high,
      low,
      close,
      volume: volume || last?.volume || 0,
      value: value || last?.value || 0,
      live: true,
    };
    if (last?.date === today) rows[rows.length - 1] = { ...last, ...liveRow };
    else rows.push(liveRow);
  }
  return rows.slice(-180);
}

function analyzeSwingDaily(stock) {
  const rows = buildSwingDailyRows(stock);
  if (rows.length < 60) return null;
  const closes = rows.map((row) => row.close);
  const highs = rows.map((row) => row.high);
  const lows = rows.map((row) => row.low);
  const volumes = rows.map((row) => row.volume);
  const last = rows.at(-1);
  const prev = rows.at(-2);
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma20Prev3 = sma(closes, 20, 3);
  const ma60 = sma(closes, 60);
  const ema21 = emaSeries(closes, 21).at(-1) || 0;
  const ema21Prev = emaSeries(closes.slice(0, -1), 21).at(-1) || ema21;
  const volMa20 = sma(volumes, 20);
  const macd = macdSnapshot(closes);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(rows, 14);
  const lookback = rows.slice(-40);
  const swHigh = Math.max(...lookback.map((row) => row.high));
  const swLow = Math.min(...lookback.map((row) => row.low));
  const swDiff = Math.max(swHigh - swLow, 0);
  const position = swDiff ? (last.close - swLow) / swDiff : 0.5;
  const stage = position >= 1 ? { label: "過熱", ratio: "1.00+", tone: "hot", value: position }
    : position >= 0.618 ? { label: "高基期", ratio: position.toFixed(2), tone: "high", value: position }
    : position >= 0.382 ? { label: "中位階", ratio: position.toFixed(2), tone: "mid", value: position }
    : { label: "低基期", ratio: position.toFixed(2), tone: "low", value: position };
  const highest20Prev = Math.max(...rows.slice(-21, -1).map((row) => row.high));
  const highest10Prev = Math.max(...rows.slice(-11, -1).map((row) => row.high));
  const neckline = Math.max(...lookback.slice(0, Math.max(8, Math.floor(lookback.length * 0.6))).map((row) => row.high));
  const pct = prev?.close ? ((last.close - prev.close) / prev.close) * 100 : stock.percent || 0;
  const gapUp = prev && last.open > prev.high && last.close > last.open;
  const realBody = (last.high - last.low) > 0 ? Math.abs(last.close - last.open) / (last.high - last.low) > 0.3 : false;
  const bullTrend = last.close > ma20 && last.close > ema21 && ema21 > ema21Prev && macd.macd > macd.signal && ma20 > ma20Prev3;
  const volumeRatio = volMa20 ? last.volume / volMa20 : 0;
  const deepFall = ma20 ? ((last.close - ma20) / ma20) * 100 < -1.5 : false;
  return {
    rows,
    last,
    prev,
    closes,
    ma5,
    ma10,
    ma20,
    ma60,
    ema21,
    ema21Prev,
    volMa20,
    volumeRatio,
    macd,
    rsi14,
    atr14,
    swHigh,
    swLow,
    position,
    stage,
    highest20Prev,
    highest10Prev,
    neckline,
    pct,
    gapUp,
    realBody,
    bullTrend,
    deepFall,
  };
}

function getSwingStage(stock) {
  const daily = stock.swingDaily || analyzeSwingDaily(stock);
  if (daily?.stage) return daily.stage;
  const pctRank = stock.percentRank || 0;
  const valueRank = stock.valueRank || 0;
  const volumeRank = stock.volumeRank || 0;
  const strength = clamp(Math.round(pctRank * 0.46 + valueRank * 0.30 + volumeRank * 0.24), 0, 100);
  if (strength >= 86 || stock.percent >= 8.5) return { label: "過熱", ratio: "1.00+", tone: "hot" };
  if (strength >= 62) return { label: "高基期", ratio: "0.618-1.000", tone: "high" };
  if (strength >= 38) return { label: "中位階", ratio: "0.382-0.618", tone: "mid" };
  return { label: "低基期", ratio: "0.000-0.382", tone: "low" };
}

function getSwingSignals(stock) {
  const daily = stock.swingDaily || analyzeSwingDaily(stock);
  if (!daily) return [];
  const pct = daily.pct;
  const last = daily.last;
  const prev = daily.prev;
  const stage = daily.stage;
  const signals = [];
  const isRed = last.close > last.open;
  const volStrong = daily.volumeRatio >= 1.2;
  const trendConfirmed = daily.ema21 > daily.ma20;
  const bullAttack = daily.bullTrend && isRed && volStrong && daily.realBody &&
    (daily.gapUp || (prev && last.volume > prev.volume * 1.2) || last.high > daily.highest10Prev);
  const goldenCross = daily.ma5 > daily.ma10 && daily.ma10 > daily.ma20 && isRed;
  const breakawayGap = daily.gapUp && last.close > daily.highest20Prev;
  const runawayGap = daily.gapUp && last.close > daily.ma20 && !breakawayGap;
  const saucerBreakout = last.close > daily.neckline && prev?.close <= daily.neckline && daily.volumeRatio >= 1.1 && isRed && daily.realBody;
  const nBase = last.close > daily.highest10Prev && last.close > daily.ma20 && trendConfirmed && volStrong && isRed && stage.tone !== "hot";
  const roc3 = daily.closes.length > 3 ? ((last.close - daily.closes.at(-4)) / daily.closes.at(-4)) * 100 : 0;
  const vFast = roc3 < -10 && daily.volumeRatio >= 1.5 && isRed && prev && last.close > prev.high && daily.rsi14 < 50;
  const vReversal = daily.deepFall && isRed && (
    (roc3 < -5 ? 35 : 0) +
    (prev && last.close > prev.high ? 25 : 0) +
    (runawayGap ? 20 : 0) +
    (daily.rsi14 < 40 ? 10 : 0)
  ) >= 60;
  const threeInside = daily.rows.length >= 3 && (() => {
    const a = daily.rows.at(-3);
    const b = daily.rows.at(-2);
    const c = daily.rows.at(-1);
    const aRange = a.high - a.low;
    return a.close < a.open &&
      aRange > 0 &&
      Math.abs(a.close - a.open) / aRange > 0.5 &&
      b.close > b.open &&
      b.close < a.open &&
      b.open > a.close &&
      c.close > c.open &&
      c.close > a.open &&
      c.volume > daily.volMa20 * 1.2 &&
      c.close > daily.ma20 &&
      trendConfirmed;
  })();

  if (bullAttack) {
    signals.push({ id: "bull_attack", short: "攻擊", icon: "🔥", reason: `站上MA20/EMA21，MACD多頭，量比 ${daily.volumeRatio.toFixed(2)}，日K多頭攻擊。` });
  }
  if (nBase) {
    signals.push({ id: "n_base", short: "N字", icon: "", reason: `突破近10日壓力，站上MA20且趨勢確認，位階 ${stage.label}。` });
  }
  if (saucerBreakout) {
    signals.push({ id: "saucer", short: "圓弧", icon: "◜", reason: `突破40日整理頸線，量能放大，偏圓弧底突破。` });
  }
  if (breakawayGap) {
    signals.push({ id: "breakaway_gap", short: "突破缺口", icon: "◆", reason: `跳空突破近20日整理高點，偏突破缺口。` });
  }
  if (runawayGap) {
    signals.push({ id: "runaway_gap", short: "逃逸缺口", icon: "🚀", reason: `跳空且站上MA20，多頭段延續，偏逃逸缺口。` });
  }
  if (vFast || vReversal) {
    signals.push({ id: "v_reversal", short: "V轉", icon: "V", reason: vFast ? `3日急跌後放量翻紅，RSI ${daily.rsi14.toFixed(1)}，偏V型快殺反彈。` : `跌深後收紅並突破前高，V轉積分達標。` });
  }
  if (threeInside) {
    signals.push({ id: "three_inside", short: "翻紅", icon: "↻", reason: `三內翻紅結構成立，站上MA20且趨勢確認。` });
  }
  if (goldenCross) {
    signals.push({ id: "golden_cross", short: "金釵", icon: "✦", reason: `MA5 > MA10 > MA20 且收紅，多金釵候選。` });
  }

  return signals;
}

function getSwingSortValue(stock, key) {
  const stageOrder = { low: 1, mid: 2, high: 3, hot: 4 };
  const stage = stock.swingStage || getSwingStage(stock);
  const values = {
    code: Number(stock.code) || 0,
    price: cleanNumber(stock.close),
    percent: stock.percent || 0,
    volume: stock.tradeVolume || 0,
    stage: stageOrder[stage.tone] || 0,
    score: stock.swingScore || 0,
  };
  return values[key] ?? 0;
}

function sortSwingRows(rows) {
  return [...rows].sort((a, b) => {
    const av = getSwingSortValue(a, swingSortKey);
    const bv = getSwingSortValue(b, swingSortKey);
    const diff = av === bv ? ((b.swingSignals?.length || 0) - (a.swingSignals?.length || 0)) : av - bv;
    return swingSortDir === "asc" ? diff : -diff;
  });
}

function swingSortHeader(key, label) {
  const active = swingSortKey === key;
  const mark = active ? (swingSortDir === "asc" ? " ▲" : " ▼") : " ↕";
  return `<button type="button" data-swing-sort="${key}">${label}${mark}</button>`;
}

function getIntradaySortValue(stock, key) {
  const values = {
    code: Number(stock.code) || 0,
    price: cleanNumber(stock.close),
    percent: stock.percent || 0,
    volume: stock.tradeVolume || 0,
    score: stock.score || 0,
  };
  return values[key] ?? 0;
}

function sortIntradayRows(rows) {
  return [...rows].sort((a, b) => {
    const av = getIntradaySortValue(a, intradaySortKey);
    const bv = getIntradaySortValue(b, intradaySortKey);
    const diff = av === bv ? ((b.intradaySignals?.length || 0) - (a.intradaySignals?.length || 0)) : av - bv;
    return intradaySortDir === "asc" ? diff : -diff;
  });
}

function getIntradayState(stock) {
  const pct = Number(stock.percent) || 0;
  const volume = Number(stock.tradeVolume) || Number(stock.volume) || 0;
  const value = Number(stock.value) || (Number(stock.close) || 0) * volume * 1000;
  const open = Number(stock.open) || 0;
  const close = Number(stock.close) || 0;
  const high = Number(stock.high) || 0;
  const signals = stock.intradaySignals || [];
  const daily = stock.swingDaily || null;
  const history = strategyRealtimeQuotes[stock.code]?.history || [];
  const recentDeltas = history.slice(-3).map((item) => cleanNumber(item.deltaVolume));
  const volumeIncreasing = recentDeltas.length >= 3
    && recentDeltas.every((value) => value > 0)
    && recentDeltas[2] > recentDeltas[1]
    && recentDeltas[1] > recentDeltas[0];
  const hasFallback = (stock.matches || []).some((match) => match.id === "intraday_2m");
  const hasSignal = signals.length > 0 || hasFallback;
  const hasStrongSignal = signals.some((signal) => [
    "early_strength",
    "volume_burst",
    "daily_breakout",
    "gap",
    "breakout",
    "fire",
    "ma35_macd",
    "ma35_buy",
    "diamond",
    "volume_diamond",
    "volume_ma35",
    "surge",
    "gua_butterfly_buy",
    "gua_flag_long",
    "gua_abcd_long",
    "gua_orb_long",
    "gua_angel_long",
    "gua_vwap_long",
  ].includes(signal.id));
  const hasVolumeSignal = signals.some((signal) => signal.id === "volume_burst");
  const hasDailyTrigger = signals.some((signal) => signal.id === "daily_breakout" || signal.id === "gap" || signal.id === "breakout");
  const liquid = volume >= 10000;
  const tradableLiquidity = volume >= 5000;
  const aboveOpen = !open || close >= open;
  const nearHigh = !high || close >= high * 0.985;
  const tooHotToChase = pct >= 8.8;
  const dailyOk = !daily || daily.stage?.tone !== "hot" || hasDailyTrigger;
  const winRateSetup = liquid && dailyOk && hasVolumeSignal && hasDailyTrigger && aboveOpen && nearHigh && pct >= 1 && pct <= 8.8;
  const earlyEntrySetup = tradableLiquidity
    && hasSignal
    && !tooHotToChase
    && aboveOpen
    && pct >= 0.5
    && pct <= 7.5
    && (volumeIncreasing || hasVolumeSignal || hasDailyTrigger);
  const candidateSetup = tradableLiquidity && hasSignal && !tooHotToChase && (volumeIncreasing || (hasVolumeSignal && pct >= 0.5));

  if (winRateSetup || earlyEntrySetup || candidateSetup) {
    return { id: "go", label: "可進場", cls: "go" };
  }
  if (tradableLiquidity && hasSignal && pct >= 0.5 && hasStrongSignal) {
    return { id: "watch", label: "觀察", cls: "watch" };
  }
  return { id: "watch", label: "觀察", cls: "watch" };
}

function intradaySortHeader(key, label) {
  const active = intradaySortKey === key;
  const mark = active ? (intradaySortDir === "asc" ? " ▲" : " ▼") : " ↕";
  return `<button type="button" data-intraday-sort="${key}">${label}${mark}</button>`;
}

const TERMINAL_PAGE_SIZE = 10;

function paginateTerminalRows(rows, currentPage) {
  const list = Array.isArray(rows) ? rows : [];
  const totalPages = Math.max(1, Math.ceil(list.length / TERMINAL_PAGE_SIZE));
  const page = Math.min(Math.max(Number(currentPage) || 1, 1), totalPages);
  const start = (page - 1) * TERMINAL_PAGE_SIZE;
  return {
    page,
    totalPages,
    rows: list.slice(start, start + TERMINAL_PAGE_SIZE),
  };
}

function buildTerminalPagination(scope, page, totalPages, totalRows) {
  if (totalRows <= TERMINAL_PAGE_SIZE) return "";
  const maxButtons = 5;
  let start = Math.max(1, page - 2);
  let end = Math.min(totalPages, start + maxButtons - 1);
  start = Math.max(1, end - maxButtons + 1);
  const numberButtons = [];
  for (let item = start; item <= end; item += 1) {
    numberButtons.push(`<button class="${item === page ? "active" : ""}" type="button" data-terminal-page-scope="${scope}" data-terminal-page="${item}">${item}</button>`);
  }
  return `
    <div class="terminal-pagination" data-terminal-pagination="${scope}">
      <button type="button" data-terminal-page-scope="${scope}" data-terminal-page="prev" ${page <= 1 ? "disabled" : ""}>上一頁</button>
      ${numberButtons.join("")}
      <button type="button" data-terminal-page-scope="${scope}" data-terminal-page="next" ${page >= totalPages ? "disabled" : ""}>下一頁</button>
    </div>
  `;
}

const intradayRadarStyles = document.createElement("style");
intradayRadarStyles.textContent = `
  .intraday-radar {
    border: 1px solid rgba(126, 200, 227, 0.16);
    border-radius: 8px;
    background: rgba(13, 19, 32, 0.72);
    padding: 14px;
    margin: 0 0 14px;
  }
  .intraday-radar-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .intraday-radar-head span {
    color: #ff704d;
    font-size: 11px;
    font-weight: 700;
  }
  .intraday-radar-head h3 {
    margin: 4px 0;
    color: #f5f8ff;
    font-size: 20px;
  }
  .intraday-radar-head p,
  .intraday-radar-head strong {
    margin: 0;
    color: #8d9ab4;
    font-size: 12px;
  }
  .intraday-signal-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 8px;
  }
  .intraday-signal-card {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 8px;
    min-height: 70px;
    border: 1px solid rgba(116, 134, 178, 0.14);
    border-radius: 8px;
    background: rgba(24, 31, 47, 0.58);
    padding: 10px;
  }
  .intraday-signal-card.active {
    border-color: rgba(255, 112, 77, 0.58);
    background: rgba(255, 112, 77, 0.13);
  }
  .intraday-signal-card > span {
    font-size: 18px;
  }
  .intraday-signal-card strong {
    display: block;
    color: #f5f8ff;
    font-size: 13px;
  }
  .intraday-signal-card small {
    display: block;
    color: #8490aa;
    font-size: 10px;
    line-height: 1.35;
    margin-top: 3px;
  }
  .intraday-signal-card em {
    color: #7ec8e3;
    font-style: normal;
    font-size: 22px;
    font-weight: 800;
  }
  .strategy-terminal.intraday-only,
  .strategy-terminal.swing-only,
  .strategy-terminal.open-buy-only,
  .strategy-terminal.strategy5-only {
    grid-template-columns: minmax(0, 1fr);
  }
  .strategy-terminal.intraday-only .strategy-list,
  .strategy-terminal.swing-only .strategy-list,
  .strategy-terminal.open-buy-only .strategy-list,
  .strategy-terminal.strategy5-only .strategy-list {
    display: none;
  }
  #strategy-view.intraday-only .strategy-header h1,
  #strategy-view.swing-only .strategy-header h1,
  .strategy-toolbar.intraday-mode h2 {
    color: #f5f8ff;
  }
  #strategy-view.intraday-only .strategy-header,
  #strategy-view.swing-only .strategy-header,
  #strategy-view.open-buy-only .strategy-header,
  #strategy-view.strategy3-only .strategy-header,
  #strategy-view.strategy5-only .strategy-header {
    display: none;
  }
  .strategy-toolbar.intraday-mode {
    border-bottom: 1px solid rgba(255, 112, 77, 0.18);
  }
  .swing-dashboard {
    display: grid;
    gap: 14px;
  }
  .swing-topbar {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 16px;
  }
  .swing-topbar h2 {
    margin: 0;
    color: #f7fbff;
    font-size: 26px;
  }
  [data-warrant-refresh] {
    cursor: pointer;
  }
  [data-warrant-refresh]:hover {
    filter: brightness(1.12);
  }
  .swing-topbar p {
    margin: 6px 0 0;
    color: #9ba8c1;
    font-size: 13px;
  }
  .swing-live {
    display: inline-flex;
    margin-left: 8px;
    padding: 3px 8px;
    border-radius: 999px;
    background: rgba(107, 151, 255, 0.16);
    color: #8fb1ff;
    font-size: 12px;
    vertical-align: middle;
  }
  .swing-signal-grid {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 10px;
  }
  .swing-card {
    min-height: 118px;
    border: 1px solid rgba(107, 151, 255, 0.28);
    border-radius: 12px;
    background: radial-gradient(circle at 24% 18%, rgba(107, 151, 255, 0.18), rgba(16, 24, 42, 0.78) 48%, rgba(9, 15, 26, 0.92));
    padding: 14px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    cursor: pointer;
    text-align: left;
  }
  .swing-card strong {
    display: block;
    color: #dfe8ff;
    font-size: 15px;
  }
  .swing-card small {
    display: block;
    color: #8f9bb4;
    font-size: 11px;
    line-height: 1.35;
    margin-top: 4px;
  }
  .swing-card em {
    color: #8fb1ff;
    font-style: normal;
    font-size: 26px;
    font-weight: 800;
  }
  .swing-card.active {
    border-color: rgba(255, 80, 80, 0.58);
    background: radial-gradient(circle at 24% 18%, rgba(255, 80, 80, 0.22), rgba(16, 24, 42, 0.78) 48%, rgba(9, 15, 26, 0.92));
  }
  .swing-card.selected {
    border-color: rgba(255, 80, 80, 0.92);
    box-shadow: inset 0 0 0 1px rgba(255, 80, 80, 0.32), 0 0 20px rgba(255, 80, 80, 0.12);
  }
  .swing-controls,
  .swing-actions,
  .swing-tabs {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .swing-controls {
    color: #9ba8c1;
    font-size: 13px;
  }
  .swing-controls select,
  .swing-actions input {
    border: 1px solid rgba(117, 133, 170, 0.28);
    border-radius: 8px;
    background: rgba(10, 15, 26, 0.72);
    color: #eaf2ff;
    padding: 9px 12px;
    outline: none;
  }
  .swing-actions {
    margin-left: auto;
  }
  .warrant-search-hint {
    display: inline-flex;
    width: max-content;
    max-width: 220px;
    padding: 7px 10px;
    border: 1px solid rgba(255, 80, 80, 0.58);
    border-radius: 8px;
    background: rgba(255, 80, 80, 0.22);
    color: #fff;
    font-size: 12px;
    font-weight: 900;
    text-align: center;
    box-shadow: inset 0 0 0 1px rgba(255, 80, 80, 0.12);
  }
  .warrant-search-box {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .warrant-search-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .warrant-pagination {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    padding: 12px;
    border-top: 1px solid rgba(117, 133, 170, 0.16);
  }
  .warrant-pagination button {
    min-width: 34px;
    border: 1px solid rgba(117, 133, 170, 0.28);
    border-radius: 8px;
    background: rgba(10, 15, 26, 0.72);
    color: #dce7ff;
    padding: 7px 10px;
    font-weight: 800;
  }
  .warrant-pagination button.active {
    border-color: rgba(255, 80, 80, 0.58);
    background: rgba(255, 80, 80, 0.22);
    color: #fff;
  }
  .warrant-pagination button:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .swing-actions button,
  .swing-tabs button {
    border: 1px solid rgba(117, 133, 170, 0.28);
    border-radius: 8px;
    background: rgba(10, 15, 26, 0.72);
    color: #dce7ff;
    padding: 9px 12px;
  }
  .swing-tabs button.active {
    border-color: rgba(255, 80, 80, 0.58);
    background: rgba(255, 80, 80, 0.22);
    color: #fff;
  }
  .swing-panel {
    border: 1px solid rgba(117, 133, 170, 0.18);
    border-radius: 10px;
    background: rgba(8, 14, 25, 0.62);
    overflow: hidden;
  }
  .swing-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .swing-table th,
  .swing-table td {
    border-bottom: 1px solid rgba(117, 133, 170, 0.12);
    padding: 11px 12px;
    text-align: left;
  }
  .swing-table th {
    color: #91a0ba;
    background: rgba(30, 43, 65, 0.7);
    font-weight: 600;
  }
  .swing-table th button {
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }
  .swing-table th button:hover {
    color: #fff;
  }
  .swing-table td {
    color: #dbe7ff;
  }
  .swing-table .code {
    color: #75b7ff;
    font-weight: 700;
  }
  .swing-table .pct,
  .swing-table .price {
    color: #ff4f5f;
    font-weight: 700;
  }
  .terminal-pagination,
  .open-buy-pager,
  .warrant-pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px 12px 4px;
    color: #9db9ff;
    font-size: 13px;
    font-weight: 800;
  }
  .terminal-pagination button,
  .open-buy-pager button,
  .warrant-pagination button {
    border: 1px solid rgba(117, 133, 170, 0.32);
    border-radius: 8px;
    background: rgba(23, 31, 50, 0.86);
    color: #dbe7ff;
    min-width: 36px;
    padding: 8px 10px;
    font-weight: 900;
    cursor: pointer;
  }
  .terminal-pagination button.active,
  .open-buy-pager button.active,
  .warrant-pagination button.active {
    border-color: rgba(255, 84, 103, 0.78);
    background: rgba(255, 84, 103, 0.28);
    color: #fff;
  }
  .terminal-pagination button:not(:disabled):hover,
  .open-buy-pager button:not(:disabled):hover,
  .warrant-pagination button:not(:disabled):hover {
    border-color: rgba(255, 84, 103, 0.7);
    color: #fff;
  }
  .terminal-pagination button:disabled,
  .open-buy-pager button:disabled,
  .warrant-pagination button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .swing-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .swing-badges b {
    border-radius: 6px;
    background: rgba(255, 112, 77, 0.16);
    color: #ffad8c;
    padding: 4px 7px;
    font-size: 11px;
  }
  .swing-stage {
    display: inline-flex;
    min-width: 62px;
    justify-content: center;
    border-radius: 999px;
    padding: 5px 8px;
    font-weight: 800;
    color: #fff;
  }
  .swing-stage.low { background: #18724f; }
  .swing-stage.mid { background: #245aa8; }
  .swing-stage.high { background: #9a5b17; }
  .swing-stage.hot { background: #a8263c; }
  .swing-score {
    display: inline-flex;
    min-width: 34px;
    justify-content: center;
    border-radius: 999px;
    background: #9e2c3d;
    color: #fff;
    padding: 5px 8px;
    font-weight: 800;
  }
  .intraday-dashboard {
    display: grid;
    gap: 14px;
  }
  .intraday-main-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 14px;
    align-items: start;
  }
  .intraday-main-panel {
    display: grid;
    gap: 14px;
    min-width: 0;
  }
  .intraday-side-panel {
    position: sticky;
    top: 12px;
    display: grid;
    gap: 10px;
    max-height: calc(100vh - 24px);
    overflow: auto;
    padding: 10px;
    border: 1px solid rgba(117, 133, 170, 0.18);
    border-radius: 10px;
    background: rgba(8, 14, 25, 0.54);
  }
  .intraday-side-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 2px 2px 8px;
    border-bottom: 1px solid rgba(117, 133, 170, 0.14);
  }
  .intraday-side-head strong {
    color: #f7fbff;
    font-size: 14px;
  }
  .intraday-side-head span {
    color: #9ba8c1;
    font-size: 12px;
  }
  .intraday-topbar {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 16px;
    align-items: end;
  }
  .intraday-topbar h2 {
    margin: 0;
    color: #f7fbff;
    font-size: 26px;
  }
  .intraday-topbar p {
    margin: 5px 0 0;
    color: #9ba8c1;
    font-size: 13px;
  }
  .intraday-live {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: 8px;
    padding: 3px 8px;
    border-radius: 999px;
    background: rgba(15, 213, 226, 0.16);
    color: #23d7e6;
    font-size: 12px;
    vertical-align: middle;
  }
  .schedule-status-pill {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    margin-left: 8px;
    padding: 3px 8px;
    border-radius: 999px;
    background: rgba(15, 213, 226, 0.16);
    color: #23d7e6;
    font-size: 12px;
    font-weight: 800;
    line-height: 1.2;
    vertical-align: middle;
    white-space: nowrap;
  }
  .schedule-status-pill span {
    display: inline-flex;
    align-items: center;
  }
  .schedule-status-pill.schedule-failed {
    border-color: transparent;
    background: transparent;
    color: #9da6bd;
  }
  .schedule-status-pill.schedule-failed .schedule-failed-dot {
    color: #b85b62;
  }
  .page-header h1,
  .strategy-toolbar h2,
  .intraday-topbar h2,
  .swing-topbar h2,
  .strategy5-hero h2 {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0;
  }
  .intraday-controls {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #9ba8c1;
    font-size: 13px;
  }
  .intraday-controls select,
  .intraday-actions input {
    border: 1px solid rgba(117, 133, 170, 0.28);
    border-radius: 8px;
    background: rgba(10, 15, 26, 0.72);
    color: #eaf2ff;
    padding: 9px 12px;
    outline: none;
  }
  .intraday-signal-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 12px;
  }
  .intraday-side-panel .intraday-signal-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .intraday-signal-card {
    min-height: 132px;
    border: 1px solid rgba(255, 74, 74, 0.42);
    border-radius: 12px;
    background: radial-gradient(circle at 24% 24%, rgba(255, 91, 91, 0.22), rgba(24, 31, 47, 0.76) 48%, rgba(11, 18, 31, 0.9));
    padding: 16px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    cursor: pointer;
    text-align: left;
  }
  .intraday-side-panel .intraday-signal-card {
    min-height: 86px;
    padding: 12px;
    border-radius: 10px;
  }
  .intraday-side-panel .intraday-icon {
    width: 34px;
    height: 34px;
    font-size: 19px;
  }
  .intraday-side-panel .intraday-card-top strong {
    font-size: 15px;
  }
  .intraday-side-panel .intraday-count {
    display: inline-block;
    margin: 0 0 0 8px;
    font-size: 22px;
    vertical-align: middle;
  }
  .intraday-side-panel .intraday-signal-card small {
    display: block;
    margin-top: 7px;
    line-height: 1.35;
  }
  .intraday-side-panel .intraday-strength {
    margin-top: 8px;
    padding: 5px 8px;
    font-size: 12px;
  }
  .intraday-signal-card.ma,
  .intraday-signal-card.ma.active {
    border-color: rgba(39, 210, 130, 0.68);
    background: radial-gradient(circle at 24% 24%, rgba(39, 210, 130, 0.23), rgba(14, 45, 41, 0.75) 50%, rgba(10, 22, 31, 0.9));
  }
  .intraday-signal-card.diamond,
  .intraday-signal-card.diamond.active {
    border-color: rgba(169, 100, 255, 0.62);
    background: radial-gradient(circle at 24% 24%, rgba(169, 100, 255, 0.24), rgba(36, 26, 59, 0.74) 50%, rgba(10, 18, 31, 0.9));
  }
  .intraday-signal-card.warn,
  .intraday-signal-card.warn.active {
    border-color: rgba(245, 166, 35, 0.72);
    background: radial-gradient(circle at 24% 24%, rgba(245, 166, 35, 0.24), rgba(55, 38, 15, 0.72) 50%, rgba(10, 18, 31, 0.9));
  }
  .intraday-signal-card.active {
    box-shadow: 0 0 0 1px rgba(255, 112, 77, 0.18), 0 14px 42px rgba(255, 74, 74, 0.1);
  }
  .intraday-signal-card.selected {
    border-color: rgba(255, 80, 80, 0.92);
    box-shadow: inset 0 0 0 1px rgba(255, 80, 80, 0.32), 0 0 20px rgba(255, 80, 80, 0.12);
  }
  .intraday-card-top {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .intraday-icon {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    font-size: 24px;
  }
  .intraday-card-top strong {
    color: #ff6262;
    font-size: 17px;
  }
  .intraday-signal-card.ma strong { color: #35e29c; }
  .intraday-signal-card.diamond strong { color: #c28cff; }
  .intraday-signal-card.warn strong { color: #ffc057; }
  .intraday-count {
    display: block;
    margin-top: 8px;
    color: #f8fbff;
    font-size: 30px;
    font-weight: 800;
  }
  .intraday-signal-card small {
    color: #b5c0d5;
    font-size: 12px;
  }
  .intraday-strength {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-radius: 7px;
    background: rgba(255, 91, 91, 0.14);
    color: #ff7a6d;
    padding: 7px 10px;
    font-size: 13px;
    font-weight: 700;
  }
  .intraday-panel {
    border: 1px solid rgba(117, 133, 170, 0.18);
    border-radius: 10px;
    background: rgba(8, 14, 25, 0.62);
    overflow: hidden;
  }
  .intraday-tabs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0;
    border-bottom: 1px solid rgba(117, 133, 170, 0.16);
    padding: 12px;
  }
  .intraday-tabs button {
    border: 0;
    border-right: 1px solid rgba(117, 133, 170, 0.16);
    background: transparent;
    color: #bfd0ee;
    padding: 9px 14px;
    cursor: pointer;
  }
  .intraday-tabs button.active {
    border-radius: 7px;
    background: #b32836;
    color: #fff;
  }
  .intraday-actions {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }
  .intraday-actions button {
    border: 1px solid rgba(117, 133, 170, 0.28);
    border-radius: 8px;
    background: rgba(10, 15, 26, 0.72);
    color: #d8e5ff;
    padding: 8px 12px;
  }
  .intraday-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .intraday-table th,
  .intraday-table td {
    border-bottom: 1px solid rgba(117, 133, 170, 0.12);
    padding: 11px 12px;
    text-align: left;
  }
  .intraday-table th {
    color: #91a0ba;
    background: rgba(30, 43, 65, 0.7);
    font-weight: 600;
  }
  .intraday-table th button {
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }
  .intraday-table th button:hover {
    color: #fff;
  }
  .intraday-table td {
    color: #dbe7ff;
  }
  .intraday-table .code {
    color: #75b7ff;
    font-weight: 700;
  }
  .intraday-table .price,
  .intraday-table .pct {
    color: #ff4f5f;
    font-weight: 700;
  }
  .intraday-entry b {
    display: block;
    color: #ffd166;
    font-size: 12px;
  }
  .intraday-entry small {
    display: block;
    color: #b8c6df;
    font-size: 11px;
    line-height: 1.45;
    margin-top: 2px;
    white-space: nowrap;
  }
  .intraday-score {
    display: inline-flex;
    min-width: 34px;
    justify-content: center;
    border-radius: 999px;
    background: #9e2c3d;
    color: #fff;
    padding: 5px 8px;
    font-weight: 800;
  }
  .intraday-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .intraday-badges b {
    border-radius: 6px;
    background: rgba(255, 112, 77, 0.16);
    color: #ffad8c;
    padding: 4px 7px;
    font-size: 11px;
  }
  .intraday-zones {
    display: grid;
    grid-template-columns: 1.12fr 1fr;
    gap: 12px;
  }
  .intraday-zone {
    min-height: 156px;
    border: 1px solid rgba(117, 133, 170, 0.18);
    border-radius: 10px;
    background: rgba(8, 14, 25, 0.62);
    overflow: hidden;
  }
  .intraday-zone header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid rgba(117, 133, 170, 0.13);
  }
  .intraday-zone h3 {
    margin: 0;
    color: #f7fbff;
    font-size: 16px;
  }
  .intraday-zone small {
    color: #8e9bb5;
    font-size: 11px;
  }
  .intraday-zone strong {
    color: #f7fbff;
    font-size: 22px;
  }
  .intraday-zone.go {
    border-color: rgba(48, 214, 142, 0.38);
    background: linear-gradient(135deg, rgba(21, 83, 64, 0.46), rgba(8, 14, 25, 0.72));
  }
  .intraday-zone.wait {
    border-color: rgba(245, 166, 35, 0.36);
    background: linear-gradient(135deg, rgba(82, 55, 18, 0.42), rgba(8, 14, 25, 0.72));
  }
  .intraday-zone.watch {
    border-color: rgba(117, 151, 255, 0.3);
    background: linear-gradient(135deg, rgba(34, 48, 86, 0.42), rgba(8, 14, 25, 0.72));
  }
  .intraday-picks {
    display: grid;
    gap: 8px;
    padding: 10px;
  }
  .intraday-pick {
    display: grid;
    grid-template-columns: 30px minmax(62px, auto) minmax(0, 1fr) auto;
    align-items: center;
    gap: 9px;
    min-height: 50px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.045);
    padding: 8px 10px;
  }
  .intraday-rank {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    color: #f7fbff;
    font-size: 12px;
    font-weight: 800;
  }
  .intraday-pick-main {
    min-width: 0;
  }
  .intraday-pick-time {
    color: #45e49f;
    font-size: 12px;
    font-weight: 800;
    white-space: nowrap;
  }
  .intraday-pick-main b {
    display: block;
    color: #f7fbff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .intraday-pick-main span,
  .intraday-pick-price span {
    color: #92a0ba;
    font-size: 11px;
  }
  .intraday-pick-price {
    text-align: right;
  }
  .intraday-pick-price b {
    display: block;
    color: #ff5261;
    font-size: 14px;
  }
  .intraday-empty {
    color: #8e9bb5;
    padding: 18px 12px;
    font-size: 12px;
  }
  .intraday-state {
    display: inline-flex;
    min-width: 58px;
    justify-content: center;
    border-radius: 999px;
    padding: 5px 8px;
    font-size: 12px;
    font-weight: 800;
  }
  .intraday-state.go {
    background: rgba(48, 214, 142, 0.16);
    color: #45e49f;
  }
  .intraday-state.wait {
    background: rgba(245, 166, 35, 0.16);
    color: #ffc057;
  }
  .intraday-state.watch {
    background: rgba(117, 151, 255, 0.16);
    color: #9bb5ff;
  }
  .strategy5-dashboard {
    display: grid;
    grid-template-columns: 330px minmax(0, 1fr);
    gap: 16px;
  }
  .strategy5-clean .strategy5-dashboard {
    grid-template-columns: minmax(0, 1fr);
  }
  .strategy5-clean .strategy5-results {
    width: 100%;
    max-width: none;
  }
  .strategy5-shell {
    display: grid;
    gap: 18px;
  }
  .strategy5-hero {
    min-height: 124px;
    border: 1px solid rgba(117, 133, 170, 0.22);
    border-radius: 18px;
    background: linear-gradient(105deg, rgba(93, 50, 58, 0.72), rgba(20, 28, 45, 0.92) 55%, rgba(16, 57, 56, 0.58));
    padding: 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
  }
  .strategy5-hero b {
    display: inline-flex;
    width: fit-content;
    border-radius: 999px;
    background: rgba(255, 123, 45, 0.18);
    color: #ff9a47;
    padding: 6px 10px;
    font-size: 12px;
    margin-bottom: 12px;
  }
  .strategy5-hero h2 {
    color: #fff;
    font-size: 36px;
    margin: 0;
  }
  .strategy5-date {
    min-width: 170px;
    border: 1px solid rgba(117, 133, 170, 0.22);
    border-radius: 12px;
    background: rgba(8, 18, 33, 0.68);
    padding: 16px;
  }
  .strategy5-date span {
    color: #8d9ab4;
    font-size: 12px;
  }
  .strategy5-date strong {
    display: block;
    color: #fff;
    font-size: 26px;
    margin: 8px 0 4px;
  }
  .strategy5-list,
  .strategy5-results {
    border: 1px solid rgba(117, 133, 170, 0.18);
    border-radius: 12px;
    background: rgba(13, 20, 34, 0.72);
    overflow: hidden;
  }
  .strategy5-filter-card {
    width: 100%;
    border: 0;
    border-bottom: 1px solid rgba(117, 133, 170, 0.13);
    background: transparent;
    color: #eaf2ff;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 12px;
    align-items: center;
    padding: 14px;
    text-align: left;
    cursor: pointer;
  }
  .strategy5-filter-card.active {
    background: rgba(255, 80, 80, 0.13);
    box-shadow: inset 3px 0 0 #ff4f5f;
  }
  .strategy5-filter-card > span {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: rgba(255, 80, 80, 0.16);
    color: #ff9a6d;
    font-weight: 800;
  }
  .strategy5-filter-card strong {
    display: block;
    color: #f7fbff;
    font-size: 15px;
  }
  .strategy5-filter-card small {
    display: block;
    color: #8d9ab4;
    font-size: 12px;
    line-height: 1.4;
    margin-top: 4px;
  }
  .strategy5-filter-card em {
    color: #b8c6df;
    font-style: normal;
    font-weight: 800;
  }
  .strategy5-results-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 17px 18px;
    border-bottom: 1px solid rgba(117, 133, 170, 0.13);
  }
  .strategy5-results-head h3 {
    margin: 0;
    color: #f7fbff;
    font-size: 21px;
  }
  .strategy5-results-head p {
    margin: 6px 0 0;
    color: #8d9ab4;
    font-size: 12px;
  }
  .strategy5-count {
    border: 1px solid rgba(117, 133, 170, 0.22);
    border-radius: 999px;
    color: #dce7ff;
    font-weight: 800;
    padding: 6px 11px;
  }
  .strategy5-stock-card {
    display: grid;
    grid-template-columns: 44px 1.25fr 0.9fr 1fr 1.2fr;
    gap: 14px;
    align-items: center;
    margin: 10px 12px;
    padding: 16px;
    border: 1px solid rgba(117, 133, 170, 0.14);
    border-radius: 10px;
    background: rgba(10, 17, 30, 0.72);
  }
  .strategy5-stock-card .rank {
    color: #7f8ca8;
    font-weight: 800;
  }
  .strategy5-stock-card strong {
    color: #f7fbff;
    font-size: 16px;
  }
  .strategy5-stock-card small {
    display: block;
    color: #7f8ca8;
    margin-top: 4px;
  }
  .strategy5-price {
    color: #ff4f68;
    font-size: 22px;
    font-weight: 900;
  }
  .strategy5-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .strategy5-chips b {
    border-radius: 999px;
    border: 1px solid rgba(255, 77, 92, 0.28);
    background: rgba(255, 77, 92, 0.15);
    color: #ff9a9d;
    padding: 5px 8px;
    font-size: 11px;
  }
  .strategy5-reason {
    color: #aebad2;
    line-height: 1.5;
    font-size: 12px;
  }
  .strategy3-clean {
    grid-template-columns: 1fr;
  }
  .strategy-terminal.strategy3-only {
    grid-template-columns: minmax(0, 1fr);
  }
  .strategy-terminal.strategy3-only .strategy-results,
  .strategy-terminal.strategy3-only #strategy-table,
  .strategy-terminal.strategy3-only .strategy5-shell,
  .strategy-terminal.strategy3-only .strategy5-dashboard,
  .strategy-terminal.strategy3-only .strategy5-results {
    width: 100%;
    max-width: none;
    min-width: 0;
  }
  .strategy3-clean .strategy5-results {
    width: 100%;
  }
  .strategy3-clean .strategy5-results-head h3 {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0;
    font-size: 24px;
    line-height: 1.2;
  }
  .strategy3-stock-card {
    grid-template-columns: 44px minmax(170px, 0.75fr) minmax(100px, 0.45fr) minmax(300px, 1fr) minmax(420px, 1.35fr);
    align-items: center;
  }
  .strategy3-stock-title strong {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .strategy3-stock-title small {
    display: inline;
    margin-top: 0;
    color: #9db9ff;
  }
  .page-title-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-right: 8px;
    color: #7fa6ff;
    font-weight: 900;
  }
  .strategy-toolbar.strategy5-mode,
  .strategy-metrics.strategy5-mode,
  .strategy-search.strategy5-mode,
  .strategy-actions.strategy5-mode {
    display: none !important;
  }
  @media (max-width: 1180px) {
    .strategy5-dashboard { grid-template-columns: 1fr; }
    .strategy5-stock-card { grid-template-columns: 36px 1fr; }
    .strategy3-stock-card {
      grid-template-columns: 36px minmax(120px, 0.9fr) minmax(82px, 0.5fr) minmax(180px, 1fr);
    }
    .strategy3-stock-card .strategy5-reason {
      grid-column: 2 / -1;
    }
    .intraday-main-layout { grid-template-columns: 1fr; }
    .intraday-side-panel {
      position: static;
      max-height: none;
    }
    .intraday-side-panel .intraday-signal-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .intraday-zones { grid-template-columns: 1fr; }
  }
  @media (max-width: 1280px) {
    .intraday-signal-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .intraday-side-panel .intraday-signal-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 760px) {
    html,
    body,
    .app-shell,
    .dashboard,
    #strategy-view,
    .strategy-terminal,
    #strategy-table {
      max-width: 100vw;
      overflow-x: hidden !important;
    }
    .view-panel[hidden],
    #strategy-view[hidden],
    #strategy-view.mobile-hide-strategy {
      display: none !important;
    }
    .dashboard {
      padding-left: 6px;
      padding-right: 6px;
    }
    .view-panel.active {
      left: 0 !important;
      width: 100% !important;
      max-width: 100% !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      overflow-x: hidden !important;
      transform: none !important;
    }
    .view-panel.active {
      position: relative;
    }
    .mobile-auto-organize {
      position: absolute;
      top: 6px;
      right: 8px;
      z-index: 20;
      display: inline-grid;
      width: 46px;
      height: 46px;
      place-items: center;
      border: 1px solid rgba(134, 151, 190, 0.18);
      border-radius: 14px;
      background: rgba(24, 28, 45, 0.92);
      color: #aeb8cc;
      font-size: 26px;
      font-weight: 800;
      line-height: 1;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
    }
    .page-header,
    .strategy-header,
    .swing-topbar {
      padding-right: 58px !important;
    }
    .intraday-signal-grid { grid-template-columns: 1fr; }
    .intraday-side-panel .intraday-signal-grid { grid-template-columns: 1fr; }
    .swing-signal-grid {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 2px 2px 8px;
      scroll-snap-type: x mandatory;
    }
    .swing-card {
      flex: 0 0 98px;
      min-height: 104px;
      padding: 10px 9px;
      scroll-snap-align: start;
    }
    .swing-card strong,
    .swing-card small {
      writing-mode: horizontal-tb;
      line-height: 1.35;
    }
    .swing-card strong { font-size: 13px; }
    .swing-card small { font-size: 11px; }
    .swing-card em { font-size: 22px; }
    .swing-panel,
    .intraday-panel {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0;
      margin-right: 0 !important;
      margin-left: 0 !important;
      overflow: hidden !important;
    }
    #strategy-view,
    .strategy-terminal,
    #strategy-table,
    .swing-dashboard,
    .intraday-dashboard,
    .intraday-main-layout,
    .intraday-main-panel,
    .strategy5-shell,
    .strategy5-dashboard {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      padding-left: 0 !important;
      padding-right: 0 !important;
      transform: none !important;
    }
    .swing-tabs,
    .intraday-tabs,
    .swing-table,
    .intraday-table,
    .swing-table tbody,
    .intraday-table tbody,
    .swing-table tr,
    .intraday-table tr {
      width: 100% !important;
      max-width: 100% !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      justify-self: stretch;
    }
    .swing-tabs,
    .intraday-tabs {
      justify-content: flex-start;
      padding-left: 0 !important;
      padding-right: 0 !important;
      overflow-x: auto;
    }
    .strategy-results {
      padding: 8px;
      border-radius: 14px;
    }
    #strategy-view .swing-actions,
    #strategy-view .intraday-actions {
      display: none !important;
    }
    .swing-table,
    .intraday-table {
      display: block;
      width: 100%;
      max-width: 100%;
      min-width: 0 !important;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 13px;
    }
    .swing-table thead,
    .intraday-table thead {
      display: none;
    }
    .swing-table tbody,
    .intraday-table tbody {
      display: grid;
      gap: 12px;
      width: 100%;
      max-width: 100%;
    }
    .swing-table tr,
    .intraday-table tr {
      display: block;
      width: 100%;
      max-width: 100%;
      border: 1px solid rgba(255, 84, 103, 0.18);
      border-radius: 12px;
      background: rgba(24, 30, 47, 0.9);
      padding: 12px;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.025);
    }
    .swing-table td,
    .intraday-table td {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr);
      gap: 8px;
      border: 0 !important;
      padding: 5px 0;
      color: #dce6ff;
      line-height: 1.38;
      text-align: left;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .swing-table td::before,
    .intraday-table td::before {
      color: #8994aa;
      font-size: 11px;
      font-weight: 800;
      text-align: left;
    }
    .swing-table td > *,
    .intraday-table td > * {
      min-width: 0;
      max-width: 100%;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .intraday-table td:nth-child(1)::before,
    .swing-table td:nth-child(1)::before { content: "代號"; }
    .intraday-table td:nth-child(2)::before,
    .swing-table td:nth-child(2)::before { content: "名稱"; }
    .intraday-table td:nth-child(3)::before,
    .swing-table td:nth-child(3)::before { content: "狀態"; }
    .intraday-table td:nth-child(4)::before,
    .swing-table td:nth-child(4)::before { content: "訊號/價格"; }
    .intraday-table td:nth-child(5)::before,
    .swing-table td:nth-child(5)::before { content: "漲幅"; }
    .intraday-table td:nth-child(6)::before,
    .swing-table td:nth-child(6)::before { content: "成交量"; }
    .intraday-table td:nth-child(7)::before,
    .swing-table td:nth-child(7)::before { content: "條件"; }
    .intraday-table td:nth-child(8)::before,
    .swing-table td:nth-child(8)::before { content: "分數"; }
    .intraday-table td:nth-child(9)::before,
    .swing-table td:nth-child(9)::before { content: "原因"; }
    .swing-table td:nth-child(10)::before { content: "原因"; }
    .swing-table .swing-badges,
    .intraday-table .intraday-badges {
      justify-content: flex-start;
      max-width: 100%;
      gap: 5px;
      overflow: hidden;
    }
    #strategy-view .swing-stage,
    #strategy-view .swing-score,
    #strategy-view .intraday-state,
    #strategy-view .intraday-score {
      width: fit-content;
      min-width: 0;
      max-width: 100%;
      justify-self: start;
      padding: 4px 9px;
      font-size: 13px;
      line-height: 1.2;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    #strategy-view .swing-badges b,
    #strategy-view .intraday-badges b,
    #strategy-view .strategy-chips b {
      max-width: 100%;
      padding: 3px 6px;
      font-size: 12px;
      line-height: 1.25;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    #strategy-view .swing-table td:nth-child(9),
    #strategy-view .swing-table td:nth-child(10),
    #strategy-view .intraday-table td:nth-child(9) {
      overflow: hidden;
      overflow-wrap: anywhere;
      word-break: break-all;
    }
    #strategy-view .swing-panel,
    #strategy-view .intraday-panel,
    #strategy-view .strategy5-results {
      overflow: visible !important;
    }
    #strategy-view .swing-table tr,
    #strategy-view .intraday-table tr {
      overflow: visible !important;
      padding: 10px !important;
    }
    #strategy-view .swing-table td,
    #strategy-view .intraday-table td {
      display: block !important;
      grid-template-columns: none !important;
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      overflow: visible !important;
      padding: 6px 0 !important;
      white-space: normal !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
    #strategy-view .swing-table td::before,
    #strategy-view .intraday-table td::before {
      display: block !important;
      width: auto !important;
      margin: 0 0 4px !important;
      font-size: 12px !important;
      line-height: 1.25 !important;
    }
    #strategy-view .swing-table td > *,
    #strategy-view .intraday-table td > *,
    #strategy-view .swing-badges,
    #strategy-view .intraday-badges,
    #strategy-view .strategy-chips {
      max-width: 100% !important;
      overflow: visible !important;
      white-space: normal !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
    #strategy-view .swing-badges,
    #strategy-view .intraday-badges,
    #strategy-view .strategy-chips {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 6px !important;
    }
    #strategy-view .swing-stage,
    #strategy-view .swing-score,
    #strategy-view .intraday-state,
    #strategy-view .intraday-score {
      max-width: 100% !important;
      white-space: normal !important;
    }
    .strategy5-shell,
    .strategy5-dashboard,
    .strategy5-results,
    .strategy5-results-head {
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }
    .strategy5-results-head h3 {
      font-size: 26px;
      line-height: 1.2;
    }
    .strategy5-results-head p {
      overflow-wrap: anywhere;
      font-size: 14px;
      line-height: 1.55;
    }
    html,
    body,
    .app-shell,
    .dashboard,
    #strategy-view,
    .strategy-terminal,
    #strategy-table {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      overflow-x: hidden !important;
      transform: none !important;
    }
    #strategy-view .strategy-results,
    #strategy-view .strategy5-shell,
    #strategy-view .strategy5-dashboard,
    #strategy-view .strategy5-results,
    #strategy-view .swing-panel,
    #strategy-view .intraday-panel {
      display: block !important;
      box-sizing: border-box !important;
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      margin: 0 !important;
      padding: 12px !important;
      overflow-x: hidden !important;
    }
    #strategy-view .strategy5-stock-card,
    #strategy-view .strategy3-stock-card,
    #strategy-view .swing-table tr,
    #strategy-view .intraday-table tr {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      margin: 12px 0 !important;
      padding: 16px !important;
      border-radius: 12px !important;
      overflow: visible !important;
    }
    #strategy-view .swing-table,
    #strategy-view .intraday-table,
    #strategy-view .swing-table tbody,
    #strategy-view .intraday-table tbody {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      overflow-x: hidden !important;
    }
    #strategy-view .swing-table td,
    #strategy-view .intraday-table td {
      display: grid !important;
      grid-template-columns: 72px minmax(0, 1fr) !important;
      gap: 10px !important;
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      overflow: visible !important;
      padding: 7px 0 !important;
      white-space: normal !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
    #strategy-view .swing-table td::before,
    #strategy-view .intraday-table td::before {
      display: block !important;
      width: 72px !important;
      margin: 0 !important;
    }
    #strategy-view .strategy5-stock-card *,
    #strategy-view .strategy3-stock-card *,
    #strategy-view .swing-table td > *,
    #strategy-view .intraday-table td > * {
      max-width: 100% !important;
      min-width: 0 !important;
      white-space: normal !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
    #strategy-view .swing-badges,
    #strategy-view .intraday-badges,
    #strategy-view .strategy-chips,
    #strategy-view .strategy5-chips {
      display: flex !important;
      flex-wrap: wrap !important;
      justify-content: flex-start !important;
      max-width: 100% !important;
      gap: 6px !important;
      overflow: visible !important;
    }
    #strategy-view .swing-badges b,
    #strategy-view .intraday-badges b,
    #strategy-view .strategy-chips b,
    #strategy-view .strategy5-chips b,
    #strategy-view .swing-stage,
    #strategy-view .swing-score,
    #strategy-view .intraday-state,
    #strategy-view .intraday-score {
      width: fit-content !important;
      max-width: 100% !important;
      min-width: 0 !important;
      justify-self: start !important;
      white-space: normal !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
  }
  @media (max-width: 760px) and (orientation: portrait) {
    html,
    body {
      width: 100vw !important;
      max-width: 100vw !important;
      overflow-x: hidden !important;
    }
    .app-shell,
    .dashboard {
      width: 100vw !important;
      max-width: 100vw !important;
      min-width: 0 !important;
      overflow-x: hidden !important;
    }
    .dashboard {
      padding-left: 6px !important;
      padding-right: 6px !important;
    }
    .view-panel.active,
    #strategy-view,
    #strategy-table,
    #strategy-view .strategy-terminal,
    #strategy-view .strategy-results,
    #strategy-view .strategy5-shell,
    #strategy-view .strategy5-dashboard,
    #strategy-view .strategy5-results,
    #strategy-view .swing-panel,
    #strategy-view .intraday-panel {
      left: 0 !important;
      right: auto !important;
      width: calc(100vw - 12px) !important;
      max-width: calc(100vw - 12px) !important;
      min-width: 0 !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      transform: none !important;
      overflow-x: hidden !important;
    }
    #strategy-view .strategy-results,
    #strategy-view .strategy5-results,
    #strategy-view .swing-panel,
    #strategy-view .intraday-panel {
      padding: 10px !important;
    }
    #strategy-view .strategy5-stock-card,
    #strategy-view .strategy3-stock-card,
    #strategy-view .swing-table tr,
    #strategy-view .intraday-table tr {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      padding: 14px !important;
    }
    #strategy-view .swing-table,
    #strategy-view .intraday-table,
    #strategy-view .swing-table tbody,
    #strategy-view .intraday-table tbody {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      overflow-x: hidden !important;
    }
    #strategy-view .swing-table td,
    #strategy-view .intraday-table td {
      grid-template-columns: 58px minmax(0, 1fr) !important;
      gap: 8px !important;
      font-size: 14px !important;
    }
    #strategy-view .swing-table td::before,
    #strategy-view .intraday-table td::before {
      width: 58px !important;
      font-size: 12px !important;
    }
    #strategy-view .strategy5-price {
      font-size: 32px !important;
    }
    #strategy-view .strategy5-stock-card strong,
    #strategy-view .strategy3-stock-title strong {
      font-size: 24px !important;
    }
  }
`;
document.head.appendChild(intradayRadarStyles);

function setStrategyChrome(mode) {
  const intraday = mode === "intraday";
  const swing = mode === "swing";
  const strategy5 = mode === "strategy5";
  const openBuy = mode === "openBuy";
  const strategy3 = mode === "strategy3";
  if (strategyBadge) strategyBadge.textContent = intraday ? "FMN://intraday.2m.scan" : swing ? "FMN://swing.daily.scan" : openBuy ? "FMN://open.buy.scan" : "FMN://strategy.scan";
  const icon = intraday ? "◔" : swing ? "└" : openBuy ? "⚡" : strategy5 ? "▰" : "⚡";
  const title = intraday ? "2分K當沖雷達" : swing ? "策略4-波段雷達" : openBuy ? "策略1-明日開盤入" : strategy5 ? "策略5-綜合策略" : "綜合策略選股";
  const headerTitle = intraday ? "2分K當沖雷達" : swing ? "策略4-波段雷達" : openBuy ? "策略1-明日開盤入" : strategy5 ? "策略5-綜合策略" : "策略中心";
  const scheduleKey = intraday ? "intraday" : swing ? "swing" : openBuy ? "openBuy" : strategy5 ? "strategy5" : "market";
  setTitleWithSchedule(strategyTitle, icon, title, scheduleKey);
  setTitleWithSchedule(strategyHeaderTitle, icon, headerTitle, scheduleKey);
  if (strategyHeaderBadge) strategyHeaderBadge.style.display = strategy3 ? "none" : "";
  if (strategyHeaderText) {
    strategyHeaderText.textContent = intraday
      ? "盤中即時輪巡全台股，專注偵測跳空、突破、MA35+MACD、鑽石與瞬間拉抬。"
      : swing
      ? "用波段指標邏輯整理全台股，盤中即時更新價量，分類突破缺口、逃逸缺口、V轉與多頭攻擊。"
      : openBuy
      ? "14:30 後產生明日候選，08:55 後看最終名單，09:00 開盤入，有賺就走。"
      : strategy3
      ? ""
      : "左側切換日線、籌碼與高波動策略；右側即時重算符合條件的股票訊號。";
    strategyHeaderText.style.display = strategy3 ? "none" : "";
  }
  if (strategyActions) strategyActions.style.display = intraday || swing || strategy5 || openBuy ? "none" : "";
  if (strategyToolbar) {
    strategyToolbar.classList.toggle("intraday-mode", intraday);
    strategyToolbar.classList.toggle("strategy5-mode", strategy5);
    strategyToolbar.style.display = intraday || swing || strategy5 || openBuy ? "none" : "";
  }
  if (strategyMetrics) {
    strategyMetrics.classList.toggle("strategy5-mode", strategy5);
    strategyMetrics.style.display = intraday || swing || strategy5 || openBuy ? "none" : "";
  }
  if (strategySearchLabel) {
    strategySearchLabel.classList.toggle("strategy5-mode", strategy5);
    strategySearchLabel.style.display = intraday || swing || strategy5 || openBuy ? "none" : "";
  }
  if (strategyView) strategyView.classList.toggle("intraday-only", intraday);
  if (strategyView) strategyView.classList.toggle("swing-only", swing);
  if (strategyView) strategyView.classList.toggle("open-buy-only", openBuy);
  if (strategyView) strategyView.classList.toggle("strategy3-only", strategy3);
  if (strategyView) strategyView.classList.toggle("strategy5-only", strategy5);
  if (strategyTerminal) strategyTerminal.classList.toggle("intraday-only", intraday);
  if (strategyTerminal) strategyTerminal.classList.toggle("swing-only", swing);
  if (strategyTerminal) strategyTerminal.classList.toggle("open-buy-only", openBuy);
  if (strategyTerminal) strategyTerminal.classList.toggle("strategy5-only", strategy5);
  if (strategyTerminal) strategyTerminal.classList.toggle("strategy3-only", strategy3);
  if (strategyList) strategyList.hidden = intraday || swing || strategy5 || openBuy;
  const labels = intraday
    ? ["觸發股票", "A區數量", "最多訊號"]
    : swing
    ? ["符合股票", "波段分數", "最多訊號"]
    : openBuy
    ? ["候選股票", "平均分數", "停利"]
    : ["符合股票", "平均分數", "最高命中"];
  strategyMetricLabels.forEach((label, index) => {
    if (labels[index]) label.textContent = labels[index];
  });
  if (strategySearch?.previousElementSibling) {
    strategySearch.previousElementSibling.textContent = intraday || swing || openBuy ? "搜尋雷達股票" : "搜尋股票";
  }
}

function renderIntradayRadar(evaluated) {
  setStrategyChrome("intraday");
  const keyword = strategyKeyword.trim().toLowerCase();
  const now = Date.now();
  const baseRows = evaluated
    .filter(isIntradayTradable)
    .filter((stock) => !keyword || stock.code.includes(keyword) || stock.name.toLowerCase().includes(keyword));
  const allRows = baseRows
    .filter((stock) => (stock.intradaySignals || []).length)
    .map((stock) => {
      const signals = stock.intradaySignals || [];
      const row = { ...stock, intradaySignals: signals };
      const intradayState = getIntradayState(row);
      if (intradayState.id === "go" && !intradayGoFirstSeenAt.has(row.code)) {
        intradayGoFirstSeenAt.set(row.code, now);
      }
      return { ...row, intradayState, intradayGoFirstSeenAt: intradayGoFirstSeenAt.get(row.code) || null };
    });
  const tradableRows = allRows;
  const stateFilters = new Set(["go", "watch"]);
  const filteredRows = intradaySignalFilter === "all"
    ? tradableRows
    : stateFilters.has(intradaySignalFilter)
      ? tradableRows.filter((stock) => stock.intradayState.id === intradaySignalFilter)
      : allRows.filter((stock) => (stock.intradaySignals || []).some((signal) => signal.id === intradaySignalFilter));
  const rows = sortIntradayRows(filteredRows).slice(0, 80);
  const signalCounts = Object.fromEntries(INTRADAY_SIGNAL_DEFS.map((signal) => [signal.id, 0]));
  const stateCounts = { go: 0, watch: 0 };
  allRows.forEach((stock) => {
    stateCounts[stock.intradayState.id] += 1;
    (stock.intradaySignals || []).forEach((signal) => {
      signalCounts[signal.id] = (signalCounts[signal.id] || 0) + 1;
    });
  });
  const sortedAllRows = sortIntradayRows(tradableRows);
  const zoneRows = {
    go: sortedAllRows.filter((stock) => stock.intradayState.id === "go").slice(0, 3),
    watch: sortedAllRows.filter((stock) => stock.intradayState.id === "watch").slice(0, 3),
  };
  const scanTime = strategyLastScanAt
    ? new Date(strategyLastScanAt).toLocaleTimeString("zh-TW", { hour12: false })
    : "等待開盤";
  const scanStatus = strategyLastScanAt
    ? `｜本輪巡邏 ${strategyRealtimeStats.received}/${strategyRealtimeStats.requested} 筆${strategyRealtimeStats.failed ? `｜失敗批次 ${strategyRealtimeStats.failed}` : ""}${strategyRealtimeStats.lastError ? `｜${strategyRealtimeStats.lastError}` : ""}`
    : "";

  if (strategySummary) strategySummary.textContent = `3秒即時巡邏｜熱門池快掃｜背景分批補全市場｜最後更新 ${scanTime}${scanStatus}`;
  if (strategyMatchCount) strategyMatchCount.textContent = rows.length.toLocaleString("zh-TW");
  if (strategyAvgScore) strategyAvgScore.textContent = stateCounts.go.toLocaleString("zh-TW");
  if (strategyTopHit) strategyTopHit.textContent = rows.length ? `${Math.max(...rows.map((stock) => stock.intradaySignals.length))}/6` : "0/6";

  const cardClass = {
    early_strength: "warn",
    volume_burst: "ma",
    daily_breakout: "ma",
    ma35_macd: "ma",
    diamond: "diamond",
    volume_diamond: "diamond",
    volume_ma35: "ma",
    surge: "warn",
    gua_butterfly_buy: "diamond",
    gua_flag_long: "warn",
    gua_abcd_long: "ma",
    gua_orb_long: "warn",
    gua_angel_long: "ma",
    gua_vwap_long: "diamond",
  };
  const cards = INTRADAY_SIGNAL_DEFS.map((signal) => {
    const count = signalCounts[signal.id] || 0;
    const selected = intradaySignalFilter === signal.id;
    return `
      <button class="intraday-signal-card ${cardClass[signal.id] || ""} ${count ? "active" : ""} ${selected ? "selected" : ""}" type="button" data-intraday-filter="${signal.id}">
        <div>
          <div class="intraday-card-top">
            <span class="intraday-icon">${signal.icon}</span>
            <div>
              <strong>${signal.title}</strong>
              <span class="intraday-count">${count}</span>
            </div>
          </div>
          <small>${signal.hint}</small>
        </div>
        <div class="intraday-strength">${count ? "強勢" : "待觸發"} <span>${count ? "↑" : "○"}</span></div>
      </button>
    `;
  }).join("");

  const tabs = [
    ["all", "全部", tradableRows.length],
    ["go", "A進場", stateCounts.go],
    ["watch", "B觀察", stateCounts.watch],
    ...INTRADAY_SIGNAL_DEFS.map((signal) => [signal.id, signal.title, signalCounts[signal.id] || 0]),
  ].map(([id, label, count]) => `<button class="${intradaySignalFilter === id ? "active" : ""}" type="button" data-intraday-filter="${id}">${label}(${count})</button>`).join("");

  const renderZonePicks = (list, zoneId) => list.length ? list.map((stock, index) => {
    const sign = stock.percent >= 0 ? "+" : "";
    const mainSignal = stock.intradaySignals[0]?.short || "量價";
    const entry = formatEntryRange(stock.intradayEntry);
    const quoteTime = stock.quoteTime || strategyRealtimeQuotes[stock.code]?.time || scanTime;
    const timeText = `<span class="intraday-pick-time">${quoteTime}</span>`;
    return `
      <div class="intraday-pick">
        <span class="intraday-rank">${index + 1}</span>
        ${timeText}
        <div class="intraday-pick-main">
          <b>${stock.code} ${stock.name}</b>
          <span>${mainSignal}｜進場 ${entry}</span>
        </div>
        <div class="intraday-pick-price">
          <b>${sign}${stock.percent.toFixed(2)}%</b>
          <span>${formatNumber(stock.close, stock.close >= 100 ? 0 : 2)}</span>
        </div>
      </div>
    `;
  }).join("") : `<div class="intraday-empty">目前沒有符合條件。</div>`;

  const zones = `
    <section class="intraday-zones">
      <article class="intraday-zone go">
        <header><div><h3>A區 進場區</h3><small>量夠、價強、靠近高點</small></div><strong>${stateCounts.go}</strong></header>
        <div class="intraday-picks">${renderZonePicks(zoneRows.go, "go")}</div>
      </article>
      <article class="intraday-zone watch">
        <header><div><h3>B區 觀察區</h3><small>有右側訊號，持續觀察量價延續</small></div><strong>${stateCounts.watch}</strong></header>
        <div class="intraday-picks">${renderZonePicks(zoneRows.watch, "watch")}</div>
      </article>
    </section>
  `;

  const tableRows = rows.length ? `
    ${rows.map((stock) => {
      const sign = stock.percent >= 0 ? "+" : "";
      const chips = stock.intradaySignals.map((signal) => `<b>${signal.icon} ${signal.short}</b>`).join("");
      const reason = stock.intradaySignals[0]?.reason || "盤中訊號觸發";
      const state = stock.intradayState || getIntradayState(stock);
      return `
        <tr>
          <td><span class="code">${stock.code}</span></td>
          <td>${stock.name}</td>
          <td><span class="intraday-state ${state.cls}">${state.label}</span></td>
          <td><span class="intraday-badges">${chips}</span></td>
          <td class="price">${formatEntryRange(stock.intradayEntry)}</td>
          <td class="pct">${sign}${stock.percent.toFixed(2)}%</td>
          <td>${Math.round(stock.tradeVolume || 0).toLocaleString("zh-TW")}</td>
          <td class="intraday-entry">${renderEntryPlan(stock.intradayEntry)}</td>
          <td>現價 ${formatTradePrice(stock.close)}｜${reason}</td>
        </tr>
      `;
    }).join("")}
  ` : `
    <tr><td colspan="9">策略2正在 3 秒巡邏；目前本輪尚未出現右側任一訊號。只要符合「早盤強勢 / 爆量 / 跳空 / 突破 / MA35 / 鑽石 / 拉抬」任一項，就會立刻顯示。</td></tr>
  `;

  strategyTable.innerHTML = `
    <section class="intraday-dashboard">
      <div class="intraday-topbar">
        <div>
          <h2>${titleWithSchedule("◔", "策略2-當沖雷達", "intraday")}</h2>
          <p>盤中即時偵測強勢訊號，3秒巡邏熱門池，背景同步分批補全市場。最後更新 ${scanTime}${scanStatus}</p>
        </div>
        <div class="intraday-controls">
          <label>偵測頻率：<select><option>3秒</option></select></label>
          <label>市場：<select><option>全市場</option></select></label>
        </div>
      </div>
      <section class="intraday-main-layout">
        <div class="intraday-main-panel">
          ${zones}
          <section class="intraday-panel">
            <div class="intraday-tabs">
              ${tabs}
              <div class="intraday-actions">
                <input type="search" placeholder="搜尋代號/名稱" value="${escapeAttr(strategyKeyword)}" data-strategy-inline-search>
                <button type="button" data-export-action>匯出</button>
                <button type="button" data-export-settings>設定</button>
              </div>
            </div>
            <table class="intraday-table">
              <thead>
                <tr>
                  <th>${intradaySortHeader("code", "股票代號")}</th><th>股票名稱</th><th>狀態</th><th>訊號</th><th>${intradaySortHeader("price", "進場價")}</th><th>${intradaySortHeader("percent", "漲幅")}</th><th>${intradaySortHeader("volume", "成交量")}</th><th>風控</th><th>原因</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </section>
        </div>
        <aside class="intraday-side-panel">
          <div class="intraday-side-head">
            <strong>訊號分類</strong>
            <span>由上到下</span>
          </div>
          <div class="intraday-signal-grid">${cards}</div>
        </aside>
      </section>
    </section>
  `;
}

function renderSwingRadar(universe) {
  setStrategyChrome("swing");
  if (!strategy4ScanLastAt) {
    loadStrategy4LocalCache();
  }
  const scanCount = strategy4ScanCount || Object.keys(strategy4ScanMatches).length;
  const scannedCount = strategy4ScannedCodes.size;
  const totalCount = strategy4ScanTotal || latestStocks.filter((stock) => !/^00/.test(stock.code)).length || latestStocks.length;
  if (!strategy4ScanLastAt && !strategy4CacheLoading) {
    loadStrategy4Cache();
  }
  if (latestStocks.length && !strategy4ScanLoading && !hasFreshStrategy4Scan()) {
    setTimeout(() => refreshStrategyHistoryScan(true), 0);
  }
  const allowCodes = new Set(universe.map((stock) => stock.code));
  const keyword = strategyKeyword.trim().toLowerCase();
  const allRows = Object.values(strategy4ScanMatches)
    .filter((stock) => allowCodes.has(stock.code) && (stock.swingSignals || []).length)
    .filter((stock) => !isStaleStrategyPrice(stock, latestStocks.find((item) => item.code === stock.code)))
    .filter((stock) => !keyword || stock.code.includes(keyword) || stock.name.toLowerCase().includes(keyword))
    .map((stock) => ({ ...stock, swingScore: stock.swingScore || stock.score || 0 }));
  const filteredRows = swingSignalFilter === "all"
    ? allRows
    : allRows.filter((stock) => (stock.swingSignals || []).some((signal) => signal.id === swingSignalFilter));
  const rows = sortSwingRows(filteredRows).slice(0, 100);
  const swingPaged = paginateTerminalRows(rows, swingPage);
  swingPage = swingPaged.page;
  const pageRows = swingPaged.rows;
  const signalCounts = Object.fromEntries(SWING_SIGNAL_DEFS.map((signal) => [signal.id, 0]));
  allRows.forEach((stock) => {
    (stock.swingSignals || []).forEach((signal) => {
      signalCounts[signal.id] = (signalCounts[signal.id] || 0) + 1;
    });
  });
  const scanTime = strategyLastScanAt
    ? new Date(strategyLastScanAt).toLocaleTimeString("zh-TW", { hour12: false })
    : new Date().toLocaleTimeString("zh-TW", { hour12: false });
  const historyText = strategy4ScanLastAt
    ? `波段快取 ${scannedCount}/${totalCount}｜命中 ${scanCount}｜${new Date(strategy4ScanLastAt).toLocaleTimeString("zh-TW", { hour12: false })}`
    : `波段快取讀取中 0/${totalCount}`;

  if (strategySummary) strategySummary.textContent = `全台股波段雷達｜排除ETF｜後端策略4計算｜${historyText}`;
  if (strategyMatchCount) strategyMatchCount.textContent = rows.length.toLocaleString("zh-TW");
  if (strategyAvgScore) strategyAvgScore.textContent = rows.length ? Math.round(rows.reduce((sum, stock) => sum + stock.swingScore, 0) / rows.length) : "--";
  if (strategyTopHit) strategyTopHit.textContent = rows.length ? `${Math.max(...rows.map((stock) => stock.swingSignals.length))}/8` : "0/8";

  const cards = SWING_SIGNAL_DEFS.map((signal) => {
    const count = signalCounts[signal.id] || 0;
    const selected = swingSignalFilter === signal.id;
    return `
      <button class="swing-card ${count ? "active" : ""} ${selected ? "selected" : ""}" type="button" data-swing-filter="${signal.id}">
        <div>
          <strong>${signal.icon} ${signal.title}</strong>
          <small>${signal.hint}</small>
        </div>
        <em>${count}</em>
      </button>
    `;
  }).join("");

  const tabs = [
    ["all", "全部", allRows.length],
    ...SWING_SIGNAL_DEFS.map((signal) => [signal.id, signal.title, signalCounts[signal.id] || 0]),
  ].map(([id, label, count]) => `<button class="${swingSignalFilter === id ? "active" : ""}" type="button" data-swing-filter="${id}">${label}(${count})</button>`).join("");

  const tableRows = pageRows.length ? pageRows.map((stock) => {
    const sign = stock.percent >= 0 ? "+" : "";
    const chips = stock.swingSignals.map((signal) => `<b>${signal.icon} ${signal.short}</b>`).join("");
    const stage = stock.swingStage || getSwingStage(stock);
    const reason = stock.swingSignals[0]?.reason || "波段訊號觸發";
    return `
      <tr>
        <td><span class="code">${stock.code}</span></td>
        <td>${stock.name}</td>
        <td><span class="swing-badges">${chips}</span></td>
        <td class="price">${formatNumber(stock.close, stock.close >= 100 ? 0 : 2)}</td>
        <td class="pct">${sign}${stock.percent.toFixed(2)}%</td>
        <td>${Math.round(stock.tradeVolume || 0).toLocaleString("zh-TW")}</td>
        <td><span class="swing-stage ${stage.tone}">${stage.label}</span><small>${stage.ratio}</small></td>
        <td><span class="swing-score">${stock.swingScore}</span></td>
        <td>${reason}</td>
      </tr>
    `;
  }).join("") : `
    <tr><td colspan="9">後端策略4掃描 API 已啟動。正在分批抓日K並計算符合股票；命中後會自動顯示在這裡。</td></tr>
  `;
  const pagination = buildTerminalPagination("swing", swingPage, swingPaged.totalPages, rows.length);

  strategyTable.innerHTML = `
    <section class="swing-dashboard">
      <div class="swing-topbar">
        <div>
          <h2>${titleWithSchedule("└", "策略4-波段雷達", "swing")}</h2>
          <p>排除ETF，只掃真正股票；網站讀取上一版完整快取，07:00 與 14:30 背景更新正式名單。${historyText}</p>
        </div>
        <div class="swing-controls">
          <label>更新模式：<select><option>07:00 / 14:30 完整掃</option></select></label>
          <label>市場：<select><option>全市場</option></select></label>
        </div>
      </div>
      <div class="swing-signal-grid">${cards}</div>
      <section class="swing-panel">
        <div class="swing-tabs">
          ${tabs}
          <div class="swing-actions">
            <input type="search" placeholder="搜尋代號/名稱" value="${escapeAttr(strategyKeyword)}" data-strategy-inline-search>
            <button type="button" data-export-action>匯出</button>
            <button type="button" data-export-settings>設定</button>
          </div>
        </div>
        <table class="swing-table">
          <thead>
            <tr>
              <th>${swingSortHeader("code", "股票代號")}</th><th>股票名稱</th><th>訊號</th><th>${swingSortHeader("price", "現價")}</th><th>${swingSortHeader("percent", "漲幅")}</th><th>${swingSortHeader("volume", "成交量")}</th><th>${swingSortHeader("stage", "位階")}</th><th>${swingSortHeader("score", "分數")}</th><th>原因</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        ${pagination}
      </section>
    </section>
  `;
}

function renderOpenBuyRadar(universe) {
  setStrategyChrome("openBuy");
  if (!openBuyCacheLoading && shouldLoadOpenBuyRemote()) {
    loadOpenBuyCache();
  }
  const scannedCount = openBuyScannedCodes.size;
  const totalCount = openBuyScanTotal || latestStocks.filter((stock) => !/^00/.test(stock.code)).length || latestStocks.length;

  const keyword = strategyKeyword.trim().toLowerCase();
  const rows = Object.values(openBuyScanMatches)
    .filter((stock) => !keyword || String(stock.code || "").includes(keyword) || String(stock.name || "").toLowerCase().includes(keyword))
    .sort((a, b) => b.score - a.score || b.percent - a.percent || b.value - a.value)
    .slice(0, 80);
  const scanCount = rows.length;
  const openBuyPaged = paginateTerminalRows(rows, openBuyPage);
  openBuyPage = openBuyPaged.page;
  const pageRows = openBuyPaged.rows;

  const scanText = openBuyScanLastAt
    ? `已掃描 ${scannedCount}/${totalCount}｜候選 ${scanCount}｜${new Date(openBuyScanLastAt).toLocaleTimeString("zh-TW", { hour12: false })}`
    : `等待後端掃描 0/${totalCount}`;

  if (strategySummary) strategySummary.textContent = `策略1-明日開盤入｜14:30後產生明日候選｜08:55後看最終名單｜${scanText}`;
  if (strategyMatchCount) strategyMatchCount.textContent = rows.length.toLocaleString("zh-TW");
  if (strategyAvgScore) strategyAvgScore.textContent = rows.length ? Math.round(rows.reduce((sum, stock) => sum + stock.score, 0) / rows.length) : "--";
  if (strategyTopHit) strategyTopHit.textContent = rows.length ? "+1.2%" : "--";

  const getOpenBuyDisplayStatus = (stock) => {
    const reasonTag = String(stock.reason || "").split("：")[0].trim();
    if (reasonTag && reasonTag.length <= 8) return reasonTag;
    return stock.status || "明日開盤可買";
  };

  const tableRows = pageRows.length ? pageRows.map((stock) => {
    const sign = stock.percent >= 0 ? "+" : "";
    const displayStatus = getOpenBuyDisplayStatus(stock);
    return `
      <tr>
        <td><span class="code">${stock.code}</span></td>
        <td>${stock.name}</td>
        <td><b class="swing-stage mid">${displayStatus}</b></td>
        <td class="price">${formatNumber(stock.close, stock.close >= 100 ? 0 : 2)}</td>
        <td class="pct">${sign}${stock.percent.toFixed(2)}%</td>
        <td>${stock.entry || "09:00 開盤價"}</td>
        <td class="price">${formatNumber(stock.takeProfit, stock.takeProfit >= 100 ? 1 : 2)}</td>
        <td class="price">${formatNumber(stock.stopLoss, stock.stopLoss >= 100 ? 1 : 2)}</td>
        <td><span class="swing-score">${stock.score}</span></td>
        <td>${stock.reason || "昨日強勢，列入開盤入候選。"}</td>
      </tr>
    `;
  }).join("") : `
    <tr><td colspan="10">策略1後端掃描中。14:30後可看明日候選，08:55後用盤前狀態做最終確認；第一版先用日K條件產生開盤入名單。</td></tr>
  `;
  const pager = buildTerminalPagination("openBuy", openBuyPage, openBuyPaged.totalPages, rows.length);

  strategyTable.innerHTML = `
    <section class="swing-dashboard">
      <div class="swing-topbar">
        <div>
          <h2>${titleWithSchedule("⚡", "策略1-明日開盤入", "openBuy")}</h2>
          <p>14:30後先出明日候選；08:55後看最終名單。買入：09:00 開盤價｜停利 +1.2%｜停損 -1.0%｜09:10 強制出場。${scanText}</p>
        </div>
        <div class="swing-controls">
          <label>更新模式：<select><option>07:00 / 14:30 完整掃</option></select></label>
          <label>市場：<select><option>排除ETF</option></select></label>
        </div>
      </div>
      <div class="swing-signal-grid">
        <button class="swing-card active selected" type="button">
          <div><strong>14:30 候選</strong><small>收盤後用日K篩明日名單</small></div><em>${scanCount}</em>
        </button>
        <button class="swing-card active" type="button">
          <div><strong>08:55 最終</strong><small>盤前最後確認後開盤買</small></div><em>待接</em>
        </button>
        <button class="swing-card active" type="button">
          <div><strong>有賺就走</strong><small>+1.2% 停利，09:10 不戀戰</small></div><em>快跑</em>
        </button>
      </div>
      <section class="swing-panel">
        <div class="swing-tabs">
          <button class="active" type="button">全部(${rows.length})</button>
          <div class="swing-actions">
            <input type="search" placeholder="搜尋代號/名稱" value="${escapeAttr(strategyKeyword)}" data-strategy-inline-search>
            <button type="button" data-export-action>匯出</button>
            <button type="button" data-export-settings>設定</button>
          </div>
        </div>
        <table class="swing-table">
          <thead>
            <tr>
              <th>股票代號</th><th>股票名稱</th><th>狀態</th><th>收盤價</th><th>昨日漲幅</th><th>買入</th><th>停利</th><th>停損</th><th>分數</th><th>原因</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        ${pager}
      </section>
    </section>
  `;
}

function renderStrategy5Dashboard(evaluated) {
  setStrategyChrome("strategy5");
  const byId = Object.fromEntries(STRATEGY5_PRESET_IDS.map((id) => [id, []]));
  evaluated.forEach((stock) => {
    stock.matches.filter((match) => STRATEGY5_PRESET_IDS.includes(match.id)).forEach((match) => {
      byId[match.id].push({ ...stock, activeMatch: match });
    });
  });
  if (!STRATEGY5_PRESET_IDS.includes(strategy5ActiveId)) strategy5ActiveId = "foreign_trust_breakout";
  if (!(byId[strategy5ActiveId] || []).length) {
    const firstHit = STRATEGY5_PRESET_IDS.find((id) => (byId[id] || []).length);
    if (firstHit) strategy5ActiveId = firstHit;
  }

  const list = (byId[strategy5ActiveId] || [])
    .sort((a, b) => b.score - a.score || b.percent - a.percent || b.value - a.value)
    .slice(0, 80);
  const strategy5Paged = paginateTerminalRows(list, strategy5Page);
  strategy5Page = strategy5Paged.page;
  const pageList = strategy5Paged.rows;
  const active = STRATEGY_BY_ID[strategy5ActiveId] || STRATEGY_BY_ID.foreign_trust_breakout;
  const totalMatches = new Set(evaluated
    .filter((stock) => stock.matches.some((match) => STRATEGY5_PRESET_IDS.includes(match.id)))
    .map((stock) => stock.code)).size;

  if (strategySummary) strategySummary.textContent = `策略5：${active.label}｜符合 ${list.length} 檔`;
  if (strategyMatchCount) strategyMatchCount.textContent = totalMatches.toLocaleString("zh-TW");
  if (strategyAvgScore) strategyAvgScore.textContent = list.length ? Math.round(avg(list.map((stock) => stock.score))) : "--";
  if (strategyTopHit) strategyTopHit.textContent = list.length ? `${Math.max(...list.map((stock) => stock.matches.filter((match) => STRATEGY5_PRESET_IDS.includes(match.id)).length))}/${STRATEGY5_PRESET_IDS.length}` : "--";

  const descriptions = {
    foreign_trust_breakout: "外資與投信同步買超，漲幅未過熱，優先觀察準突破名單。",
  };

  const rows = pageList.length ? pageList.map((stock, index) => {
    const sign = stock.percent >= 0 ? "+" : "";
    const strategyMatches = stock.matches.filter((match) => STRATEGY5_PRESET_IDS.includes(match.id));
    const main = stock.activeMatch || strategyMatches[0] || stock.matches[0];
    const chips = strategyMatches.slice(0, 5).map((match) => `<b>${match.icon} ${match.short}</b>`).join("");
    const rank = (strategy5Page - 1) * TERMINAL_PAGE_SIZE + index + 1;
    return `
      <article class="strategy5-stock-card">
        <div class="rank">#${rank}</div>
        <div>
          <strong>${stock.name} <small>${stock.code}</small></strong>
          <small>${stock.sector || "未分類"} · ${stock.isRealtime ? "即時" : "盤中"} · ${new Date().toLocaleDateString("zh-TW")}</small>
        </div>
        <div>
          <div class="strategy5-price">${formatStockPrice(stock.close)}</div>
          <small class="${stock.percent >= 0 ? "red" : "green"}">${sign}${stock.percent.toFixed(2)}%</small>
        </div>
        <div class="strategy5-chips">${chips}</div>
        <div class="strategy5-reason">${main?.reason || "符合策略5條件。"}</div>
      </article>
    `;
  }).join("") : `<div class="empty-state">目前沒有符合「${active.label}」的股票。</div>`;
  const pagination = buildTerminalPagination("strategy5", strategy5Page, strategy5Paged.totalPages, list.length);

  const scanText = strategy5UpdatedAt
    ? `06:00 / 21:00 完整掃｜${new Date(strategy5UpdatedAt).toLocaleDateString("zh-TW")}`
    : "06:00 / 21:00 完整掃結果讀取中";
  strategyTable.innerHTML = `
    <section class="strategy5-shell strategy5-clean">
      <section class="strategy5-dashboard">
        <section class="strategy5-results">
          <div class="strategy5-results-head">
            <div>
              <h3>${titleWithSchedule("▰", "策略5-綜合策略", "strategy5")}</h3>
              <p>${descriptions[strategy5ActiveId] || "符合策略5條件的股票。"}｜${scanText}，結果固定到下一次掃描。</p>
            </div>
          </div>
          ${rows}
          ${pagination}
        </section>
      </section>
    </section>
  `;
}

function renderStrategy5CacheLoading() {
  setStrategyChrome("strategy5");
  if (strategySummary) strategySummary.textContent = "策略5：06:00 / 21:00 完整掃結果讀取中。";
  if (strategyMatchCount) strategyMatchCount.textContent = "更新中";
  if (strategyAvgScore) strategyAvgScore.textContent = "--";
  if (strategyTopHit) strategyTopHit.textContent = "--";
  strategyTable.innerHTML = `
    <section class="strategy5-shell strategy5-clean">
      <section class="strategy5-dashboard">
        <section class="strategy5-results">
          <div class="strategy5-results-head">
            <div>
              <h3>${titleWithSchedule("▰", "策略5-綜合策略", "strategy5")}</h3>
              <p>正在讀取 06:00 / 21:00 完整掃結果，完成後固定顯示到下一次掃描。</p>
            </div>
          </div>
          <div class="empty-state">策略5完整掃結果讀取中，請稍等。</div>
        </section>
      </section>
    </section>
  `;
}

function renderOvernightDashboard(evaluated) {
  setStrategyChrome("strategy3");
  setTitleWithSchedule(strategyTitle, "◐", "策略3-隔日沖", "strategy3");
  setTitleWithSchedule(strategyHeaderTitle, "◐", "策略3-隔日沖", "strategy3");
  if (strategyToolbar) strategyToolbar.style.display = "none";
  if (strategyMetrics) strategyMetrics.style.display = "none";
  if (strategySearchLabel) strategySearchLabel.style.display = "none";
  if (strategyList) strategyList.hidden = true;
  const rows = evaluated
    .filter((stock) => stock.matches.some((match) => match.id === "overnight_chip"))
    .map((stock) => ({ ...stock, activeMatch: stock.matches.find((match) => match.id === "overnight_chip") }))
    .sort((a, b) => b.score - a.score || b.value - a.value || b.percent - a.percent)
    .slice(0, 30);
  const strategy3Paged = paginateTerminalRows(rows, strategy3Page);
  strategy3Page = strategy3Paged.page;
  const pageRows = strategy3Paged.rows;
  const scanText = strategy3UpdatedAt
    ? `13:00 掃描｜${new Date(strategy3UpdatedAt).toLocaleDateString("zh-TW")}`
    : "13:00 掃描快取讀取中";

  if (strategySummary) strategySummary.textContent = `策略3-隔日沖｜${scanText}｜符合 ${rows.length} 檔`;
  if (strategyMatchCount) strategyMatchCount.textContent = rows.length.toLocaleString("zh-TW");
  if (strategyAvgScore) strategyAvgScore.textContent = rows.length ? Math.round(avg(rows.map((stock) => stock.score))) : "--";
  if (strategyTopHit) strategyTopHit.textContent = rows.length ? `${Math.max(...rows.map((stock) => stock.matches.length))}` : "--";

  const cards = pageRows.length ? pageRows.map((stock, index) => {
    const sign = stock.percent >= 0 ? "+" : "";
    const rank = (strategy3Page - 1) * TERMINAL_PAGE_SIZE + index + 1;
    return `
      <article class="strategy5-stock-card strategy3-stock-card">
        <div class="rank">#${rank}</div>
        <div class="strategy3-stock-title">
          <strong>${stock.name} <small>${stock.code}</small></strong>
        </div>
        <div>
          <div class="strategy5-price">${formatNumber(stock.close, stock.close >= 100 ? 0 : 2)}</div>
          <small class="${stock.percent >= 0 ? "red" : "green"}">${sign}${stock.percent.toFixed(2)}%</small>
        </div>
        <div class="strategy5-chips"><b>⌬ 隔日</b><b>${Math.round(stock.volumeLots || (stock.tradeVolume || 0) / 1000).toLocaleString("zh-TW")}張</b><b>周轉 ${formatNumber(stock.turnoverRate || 0, 2)}%</b><b>量比 ${formatNumber(stock.volumeRatio || 0, 2)}</b></div>
        <div class="strategy5-reason">${stock.activeMatch?.reason || "隔日沖籌碼與量價候選。"}</div>
      </article>
    `;
  }).join("") : `<div class="empty-state">目前沒有符合隔日沖條件的股票。</div>`;
  const pagination = buildTerminalPagination("strategy3", strategy3Page, strategy3Paged.totalPages, rows.length);

  strategyTable.innerHTML = `
    <section class="strategy5-shell">
      <section class="strategy5-dashboard strategy3-clean">
        <section class="strategy5-results">
          <div class="strategy5-results-head">
            <div>
              <h3>${titleWithSchedule("◐", "策略3-隔日沖", "strategy3")}</h3>
              <p>以 13:00 固定條件完整掃描結果排序，開網頁不再臨時重算。</p>
            </div>
          </div>
          ${cards}
          ${pagination}
        </section>
      </section>
    </section>
  `;
}

function renderStrategyScanner() {
  if (!strategyTable) return;
  deferUiWork(ensureMobileAutoOrganizeButton);
  deferUiWork(normalizeMobileHorizontalPosition, 40);
  let selected = [...selectedStrategyIds];
  if (!selected.length && strategyPresetMode !== "strategy3" && strategyPresetMode !== "strategy5") {
    selectedStrategyIds = new Set(["intraday_2m"]);
    selected = ["intraday_2m"];
  }
  const mobileOtherStrategy = isMobileViewport() && selected.length && !selected.includes("intraday_2m");
  if (shouldDeferMobileOtherStrategyRender(mobileOtherStrategy)) return;
  if (!(selected.length === 1 && (selected[0] === "intraday_2m" || selected[0] === "swing_radar" || selected[0] === "open_buy"))) setStrategyChrome("normal");
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
  const universe = buildStrategyUniverse(latestStocks);
  if (strategyPresetMode === "strategy3") {
    if (!strategy3Data.length && !strategy3CacheLoading) loadStrategy3Cache();
    const rows = strategy3Data.filter((stock) => {
      const name = String(stock.name || "").toLowerCase();
      return !keyword || String(stock.code || "").includes(keyword) || name.includes(keyword);
    });
    renderOvernightDashboard(rows);
    return;
  }
  if (selected.length === 1 && selected[0] === "open_buy") {
    const openBuyRows = universe.filter((stock) => {
      const passKeyword = !keyword || stock.code.includes(keyword) || stock.name.toLowerCase().includes(keyword);
      return passKeyword;
    });
    renderOpenBuyRadar(openBuyRows);
    return;
  }
  if (selected.length === 1 && selected[0] === "swing_radar") {
    const swingRows = universe.filter((stock) => {
      const passKeyword = !keyword || stock.code.includes(keyword) || stock.name.toLowerCase().includes(keyword);
      return passKeyword;
    });
    renderSwingRadar(swingRows);
    return;
  }
  if (selected.length === 1 && selected[0] === "intraday_2m") {
    renderIntradayRadar(universe.map(evaluateStrategyStock));
    return;
  }

  const evaluated = universe.map(evaluateStrategyStock).filter((stock) => {
    const matchedIds = stock.matches.map((item) => item.id);
    const passMode = strategyMode === "all"
      ? selected.every((id) => matchedIds.includes(id))
      : selected.some((id) => matchedIds.includes(id));
    const passKeyword = !keyword || stock.code.includes(keyword) || stock.name.toLowerCase().includes(keyword);
    return passMode && passKeyword;
  }).sort((a, b) => b.matches.length - a.matches.length || b.score - a.score || b.value - a.value);

  if (strategyPresetMode === "strategy3") {
    renderOvernightDashboard(evaluated);
    return;
  }
  if (strategyPresetMode === "strategy5") {
    if (!strategy5Data.length && !strategy5UpdatedAt && !strategy5CacheLoading) loadStrategy5Cache();
    if (!strategy5Data.length && !strategy5UpdatedAt) {
      renderStrategy5CacheLoading();
      return;
    }
    const rows = strategy5Data.filter((stock) => {
      const name = String(stock.name || "").toLowerCase();
      return !keyword || String(stock.code || "").includes(keyword) || name.includes(keyword);
    });
    renderStrategy5Dashboard(rows);
    return;
  }

  const topRows = evaluated.slice(0, 50);
  const avgScore = topRows.length
    ? Math.round(topRows.reduce((sum, stock) => sum + stock.score, 0) / topRows.length)
    : 0;
  const topHit = topRows[0]?.matches.length || 0;
  const selectedLabels = selected.map((id) => STRATEGY_BY_ID[id]?.short || id).join(" + ");

  if (strategySummary) {
    const scanText = selected.includes("intraday_2m") && strategyLastScanAt
      ? `｜全台股輪巡 ${new Date(strategyLastScanAt).toLocaleTimeString("zh-TW", { hour12: false })}`
      : "";
    strategySummary.textContent = `${strategyMode === "all" ? "全部符合" : "任一符合"}：${selectedLabels}${scanText}`;
  }
  if (strategyMatchCount) strategyMatchCount.textContent = evaluated.length.toLocaleString("zh-TW");
  if (strategyAvgScore) strategyAvgScore.textContent = topRows.length ? avgScore : "--";
  if (strategyTopHit) strategyTopHit.textContent = topRows.length ? `${topHit}/${selected.length}` : "--";

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
      const signalChips = (stock.intradaySignals || []).map((item) => `<b>${item.icon} ${item.short}</b>`).join("");
      const strategyChips = stock.matches.slice(0, 5).map((item) => `<b>${item.icon} ${item.short}</b>`).join("");
      const chips = signalChips || strategyChips;
      const reason = (stock.intradaySignals || [])[0]?.reason || stock.matches[0]?.reason || "符合策略條件";
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

function hydrateWarrantFlowItem(item) {
  const name = String(item.underlyingName || "").trim();
  const exact = latestStocks.find((stock) => stock.name === name);
  const partial = exact || latestStocks.find((stock) => name && (stock.name.includes(name) || name.includes(stock.name)));
  const code = String(item.underlyingCode || item.code || partial?.code || "").trim();
  const stockPercent = Number.isFinite(Number(item.underlyingPercent))
    ? Number(item.underlyingPercent)
    : Number.isFinite(Number(item.percent))
      ? Number(item.percent)
      : partial?.percent || 0;
  const stockClose = cleanNumber(item.underlyingClose) || cleanNumber(item.close) || cleanNumber(item.displayClose) || partial?.close || 0;
  return {
    ...item,
    code,
    name: name || partial?.name || "--",
    stockPercent,
    stockClose,
    stockValue: partial?.value || 0,
  };
}

function formatWarrantMoney(value) {
  const number = cleanNumber(value);
  if (number >= 100000000) return `${(number / 100000000).toFixed(2)} 億`;
  if (number >= 10000) return `${Math.round(number / 10000).toLocaleString("zh-TW")} 萬`;
  return Math.round(number).toLocaleString("zh-TW");
}

function getWarrantPriority(item) {
  const level = String(item.level || "").toUpperCase();
  const callValue = cleanNumber(item.callValue);
  const putValue = cleanNumber(item.putValue);
  const ratio = cleanNumber(item.callPutRatio);
  const callCount = cleanNumber(item.callCount);
  const putCount = cleanNumber(item.putCount);
  const atMoneyCount = cleanNumber(item.atMoneyCallCount);
  const days = cleanNumber(item.minDaysToExpiry);
  const pct = Number(item.stockPercent);
  const score = cleanNumber(item.score);
  const isPriority = (
    level === "A" &&
    callValue >= 20000000 &&
    callCount >= 5 &&
    atMoneyCount >= 2 &&
    days >= 10 &&
    ratio >= 2.5 &&
    callValue > putValue &&
    Number.isFinite(pct) &&
    pct > -2 &&
    pct <= 4
  );
  const reasons = [];
  if (!isPriority) reasons.push("不在優先區");
  else if (pct <= 1.5 && ratio >= 6 && atMoneyCount >= 3) reasons.push("權證先熱，股票未噴");
  else if (pct <= 2.5) reasons.push("權證先熱，股票未過熱");
  else reasons.push("權證熱，股票漲幅仍可控");
  return {
    isPriority,
    score: Math.round(score + Math.min(callValue / 20000000, 18) + Math.min(ratio * 2, 14) + (pct <= 1.5 ? 12 : pct <= 2.5 ? 8 : 3)),
    label: reasons[0],
  };
}

function renderWarrantFlow() {
  const panel = viewPanels["warrant-flow"];
  if (!panel) return;
  const keyword = warrantFlowKeyword.trim().toLowerCase();
  const allRows = warrantFlowData
    .map(hydrateWarrantFlowItem)
    .map((item) => ({
      ...item,
      priority: getWarrantPriority(item),
    }))
    .filter((item) => item.priority.isPriority)
    .sort((a, b) => b.priority.score - a.priority.score || b.score - a.score || b.callValue - a.callValue)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const filteredRows = keyword
    ? allRows.filter((item) =>
      item.code.includes(keyword) ||
      item.name.toLowerCase().includes(keyword) ||
      item.underlyingName.toLowerCase().includes(keyword))
    : allRows;
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  warrantFlowPage = Math.min(Math.max(1, warrantFlowPage), pageCount);
  const pageStart = (warrantFlowPage - 1) * pageSize;
  const rows = filteredRows.slice(pageStart, pageStart + pageSize);
  const listLabel = keyword
    ? `搜尋結果 ${filteredRows.length} 筆｜第 ${warrantFlowPage}/${pageCount} 頁`
    : `優先區權證 ${allRows.length} 筆｜第 ${warrantFlowPage}/${pageCount} 頁`;
  const helperText = keyword
    ? "搜尋只查優先區權證候選；不在優先區的 A 級權證已剔除。"
    : "只顯示優先區：A級、認購熱、認售低、價平/價內足夠，且股票未過熱。";
  const pagination = buildTerminalPagination("warrant", warrantFlowPage, pageCount, filteredRows.length);

  const body = rows.length ? rows.map((item) => {
    const sign = item.stockPercent >= 0 ? "+" : "";
    const hot = item.score >= 82 ? "hot" : item.score >= 68 ? "mid" : "low";
    return `
      <tr>
        <td><span class="swing-score">${item.rank || "--"}</span></td>
        <td><span class="code">${item.code || "--"}</span></td>
        <td>${item.name}</td>
        <td class="price">${formatNumber(item.stockClose, item.stockClose >= 100 ? 0 : 2)}</td>
        <td class="price">${formatWarrantMoney(item.callValue)}</td>
        <td>${formatWarrantMoney(item.putValue)}</td>
        <td><b class="swing-stage ${hot}">${item.callPutRatio >= 99 ? "99+" : item.callPutRatio}</b></td>
        <td>${item.callCount} / ${item.putCount}</td>
        <td>${item.reason}　判斷：${item.priority.label}。</td>
      </tr>
    `;
  }).join("") : `
    <tr><td colspan="9">${keyword ? "優先區名單內找不到這檔股票；代表目前 A 級權證尚未進優先觀察區。" : "權證資金走向讀取中。只顯示優先區權證候選。"}</td></tr>
  `;

  panel.innerHTML = `
    <section class="swing-dashboard">
      <div class="swing-topbar">
        <div>
          <h2 data-warrant-refresh title="重新整理權證資金走向">${titleWithSchedule("◒", "策略6：權證資金走向", "warrant")}</h2>
          <p>${helperText}</p>
        </div>
        <div class="swing-controls">
          <label>更新模式：<select><option>每日 06:00 / 21:00 完整掃</option></select></label>
          <label>模式：<select><option>權證先熱股票未噴</option></select></label>
        </div>
      </div>
      <section class="swing-panel">
        <div class="swing-tabs">
          <button class="active" type="button" data-warrant-refresh>${listLabel}</button>
          <div class="swing-actions warrant-search-box">
            <small class="warrant-search-hint">🔥 可搜尋全台股票權證熱度</small>
            <div class="warrant-search-row">
              <input id="warrant-flow-search" type="search" placeholder="搜尋股票代號/名稱" value="${escapeAttr(warrantFlowKeyword)}" data-warrant-flow-search>
              <button id="warrant-flow-refresh" type="button" data-warrant-refresh>重新整理</button>
            </div>
          </div>
        </div>
        <table class="swing-table">
          <thead>
            <tr>
              <th>排名</th><th>股票代號</th><th>標的名稱</th><th>收盤價</th><th>認購金額</th><th>認售金額</th><th>購/售比</th><th>購/售檔數</th><th>原因</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
        ${pagination}
      </section>
    </section>
  `;
}

async function loadWarrantFlow(force = false) {
  if (warrantFlowLoading) return;
  if (!warrantFlowData.length) {
    loadWarrantFlowLocalCache();
  }
  warrantFlowLoading = true;
  const panel = viewPanels["warrant-flow"];
  if (panel && !warrantFlowData.length) {
    panel.innerHTML = `<div class="empty-state">正在讀取權證資金走向...</div>`;
  }
  try {
    if (!latestStocks.length) loadStrategyStocks();
    let payload = await fetchJson(`${endpoints.warrantFlowCache}?t=${Date.now()}`, 10000);
    const cachedMatches = normalizeArray(payload?.matches);
    if (!normalizeArray(payload?.matches).length) {
      payload = await fetchJson(`${endpoints.warrantFlowBackup}?t=${Date.now()}`, 10000);
    }
    warrantFlowData = normalizeArray(payload.matches);
    warrantFlowPage = 1;
    const updatedAt = Date.parse(payload?.updatedAt || "");
    warrantFlowUpdatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    saveWarrantFlowLocalCache();
    applyStaticTitleIcons();
    renderWarrantFlow();
  } catch (error) {
    if (panel && !warrantFlowData.length) {
      panel.innerHTML = `<div class="empty-state">權證資料暫時讀取失敗，請稍後再試。</div>`;
    }
  } finally {
    warrantFlowLoading = false;
  }
}

async function loadStrategyStocks() {
  if (latestStocks.length) return latestStocks;
  if (strategyStocksPromise) return strategyStocksPromise;
  strategyStocksLoading = true;
  strategyStocksPromise = (async () => {
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

    let parsed = parseStocksForLatest(stocks);

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
    return latestStocks;
  })();

  try {
    return await strategyStocksPromise;
  } catch (error) {
    if (strategyTable) {
      strategyTable.innerHTML = `<div class="empty-state">策略5暫時無法取得股票資料，請稍後重新整理。</div>`;
    }
    return [];
  } finally {
    strategyStocksLoading = false;
    strategyStocksPromise = null;
  }
}

async function ensureStrategyStocksLoaded() {
  if (latestStocks.length) return latestStocks;
  return await loadStrategyStocks();
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

function renderHeatmapFromCache() {
  const sectors = Object.entries(sectorStocksCache).map(([name, stocks]) => {
    const rows = normalizeArray(stocks);
    if (!rows.length) return null;
    const totalValue = rows.reduce((sum, stock) => sum + cleanNumber(stock.value), 0);
    const weightedPct = totalValue
      ? rows.reduce((sum, stock) => sum + cleanNumber(stock.pct) * cleanNumber(stock.value), 0) / totalValue
      : avg(rows.map((stock) => cleanNumber(stock.pct)));
    const up = rows.filter((stock) => cleanNumber(stock.change) > 0 || cleanNumber(stock.pct) > 0).length;
    const down = rows.filter((stock) => cleanNumber(stock.change) < 0 || cleanNumber(stock.pct) < 0).length;
    const leader = [...rows].sort((a, b) => cleanNumber(b.value) - cleanNumber(a.value))[0];
    return {
      name,
      pct: weightedPct || 0,
      totalValue: (totalValue / 100000000).toFixed(1),
      count: rows.length,
      up,
      down,
      flat: rows.length - up - down,
      leader: leader ? `${leader.code} ${leader.name}` : "--",
      stocks: rows,
    };
  }).filter(Boolean).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 36);

  if (sectors.length) renderHeatmapSectors(sectors);
  return sectors.length > 0;
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
  return `法人資料: ${dateStr.slice(0, 4)}/${dateStr.slice(4, 6)}/${dateStr.slice(6, 8)}`;
}

function isTwseTradingTime(date = new Date()) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
}

function renderChipTradeTable() {
  const body = document.querySelector("#chip-trade-body");
  const dateEl = document.querySelector("#chip-trade-date");
  const sortEl = document.querySelector("#chip-sort");
  if (!body) return;

  if (dateEl) {
    const now = new Date();
    const time = now.toLocaleTimeString("zh-TW", { hour12: false });
    const modeText = "盤後收盤";
    dateEl.textContent = `${formatChipDate(institutionDate)}｜${modeText}　更新 ${time}`;
  }

  const rows = latestStocks
    .map((stock) => {
      const code = String(stock.code || stock.Code || "");
      const inst = institutionData[code];
      if (!inst) return null;
      const foreign = Number(inst.foreign) || 0;
      const trust = Number(inst.trust) || 0;
      const total = Number(inst.total) || foreign + trust + (Number(inst.dealer) || 0);
      if (chipFilter === "joint" && !(foreign > 0 && trust > 0)) return null;
      if (chipFilter === "trust" && !(trust > 0)) return null;
      if (chipFilter === "foreign" && !(foreign > 0)) return null;
      if (chipFilter === "legal" && !((Number(inst.total) || foreign + trust + (Number(inst.dealer) || 0)) > 0)) return null;
      return {
        code,
        name: inst.name || stock.name || code,
        price: cleanNumber(inst.close) || cleanNumber(stock.close),
        change: Number.isFinite(Number(inst.change)) ? Number(inst.change) : cleanNumber(stock.change),
        percent: Number.isFinite(Number(inst.percent)) ? Number(inst.percent) : cleanNumber(stock.percent),
        volume: cleanNumber(inst.tradeVolume) || cleanNumber(stock.tradeVolume),
        value: cleanNumber(inst.value) || cleanNumber(stock.value),
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
      const total = Number(inst.total) || foreign + trust + (Number(inst.dealer) || 0);
      if (chipFilter === "joint" && !(foreign > 0 && trust > 0)) return;
      if (chipFilter === "trust" && !(trust > 0)) return;
      if (chipFilter === "foreign" && !(foreign > 0)) return;
      if (chipFilter === "legal" && !(total > 0)) return;
      rows.push({
        code,
        name: inst.name || code,
        price: cleanNumber(inst.close),
        change: Number.isFinite(Number(inst.change)) ? Number(inst.change) : 0,
        percent: Number.isFinite(Number(inst.percent)) ? Number(inst.percent) : 0,
        volume: cleanNumber(inst.tradeVolume),
        value: cleanNumber(inst.value),
        foreign,
        trust,
        total,
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

  const chipPaged = paginateTerminalRows(rows.slice(0, 80), chipTradePage);
  chipTradePage = chipPaged.page;
  const shown = chipPaged.rows;
  const table = body.closest("table");
  let pagination = document.querySelector("#chip-trade-pagination");
  if (!pagination && table) {
    pagination = document.createElement("div");
    pagination.id = "chip-trade-pagination";
    table.insertAdjacentElement("afterend", pagination);
  }
  if (pagination) pagination.innerHTML = buildTerminalPagination("chip", chipTradePage, chipPaged.totalPages, rows.slice(0, 80).length);
  if (!shown.length) {
    const emptyText = {
      joint: "目前沒有符合「外資 + 投信同買」的資料，盤後資料更新後會自動刷新。",
      trust: "目前沒有符合「投信買超」的資料，盤後資料更新後會自動刷新。",
      foreign: "目前沒有符合「外資買超」的資料，盤後資料更新後會自動刷新。",
      legal: "目前沒有符合「法人同買」的資料，盤後資料更新後會自動刷新。",
    }[chipFilter] || "目前沒有符合條件的資料。";
    body.innerHTML = `<tr><td colspan="12">${emptyText}</td></tr>`;
    if (pagination) pagination.innerHTML = "";
    return;
  }

  body.innerHTML = shown.map((row, index) => {
    const up = row.change >= 0;
    const hasQuote = row.price > 0;
    return `
      <tr class="${index === 0 ? "highlight" : ""}" data-chip-row="${row.code}">
        <td><a href="#" data-chip-code="${row.code}">${row.code}</a></td>
        <td>${row.name}</td>
        <td data-chip-price>${hasQuote ? formatNumber(row.price, row.price >= 100 ? 0 : 2) : "載入..."}</td>
        <td data-chip-change class="${up ? "red" : "green"}">${hasQuote ? `${up ? "+" : ""}${formatNumber(row.change, 2)}` : "--"}</td>
        <td data-chip-percent class="${row.percent >= 0 ? "red" : "green"}">${hasQuote ? formatNumber(row.percent, 2) : "--"}</td>
        <td data-chip-volume>${hasQuote ? Math.round(row.volume).toLocaleString("zh-TW") : "--"}</td>
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

async function hydrateChipRealtimeQuotes(rows) {
  if (chipQuoteHydrating) return;
  const targets = rows.slice(0, 40);
  if (!targets.length) return;
  chipQuoteHydrating = true;
  try {
    await Promise.all(targets.map(async (row) => {
      try {
        const data = await fetchJson(`/api/proxy?code=${row.code}`, 7000);
        const item = data?.msgArray?.[0];
        if (!item) return;
        const price = parseQuoteNumber(item.z, item.a, item.b, item.y);
        const prev = parseQuoteNumber(item.y);
        if (!price || !prev) return;
        const change = price - prev;
        const percent = prev ? (change / prev) * 100 : 0;
        const volume = parseQuoteNumber(item.v, item.tv);
        const tr = document.querySelector(`[data-chip-row="${row.code}"]`);
        if (!tr) return;
        const up = change >= 0;
        const priceEl = tr.querySelector("[data-chip-price]");
        const changeEl = tr.querySelector("[data-chip-change]");
        const percentEl = tr.querySelector("[data-chip-percent]");
        const volumeEl = tr.querySelector("[data-chip-volume]");
        if (priceEl) priceEl.textContent = formatNumber(price, price >= 100 ? 0 : 2);
        if (changeEl) {
          changeEl.textContent = `${up ? "+" : ""}${formatNumber(change, 2)}`;
          changeEl.className = up ? "red" : "green";
        }
        if (percentEl) {
          percentEl.textContent = formatNumber(percent, 2);
          percentEl.className = percent >= 0 ? "red" : "green";
        }
        if (volumeEl) volumeEl.textContent = volume ? Math.round(volume).toLocaleString("zh-TW") : "--";
      } catch {}
    }));
  } finally {
    chipQuoteHydrating = false;
  }
}

function parseStocksForLatest(stocks) {
  return stocks.map((stock) => {
    const code = valueOf(stock, ["證券代號", "Code"]);
    const name = valueOf(stock, ["證券名稱", "Name"]);
    const value = cleanNumber(valueOf(stock, ["成交金額", "TradeValue"]));
    const tradeVolume = normalizeTradeVolumeLots(valueOf(stock, ["成交股數", "TradeVolume"]));
    return { code, name, value, tradeVolume, ...stockChange(stock) };
  }).filter((s) => s.code && s.name && s.close);
}

async function loadChipTradeData() {
  if (chipTradeLoading) return;
  chipTradeLoading = true;
  const body = document.querySelector("#chip-trade-body");
  if (body) body.innerHTML = `<tr><td colspan="12">正在載入盤後法人資料...</td></tr>`;

  try {
    const [stockResult, instResult] = await Promise.allSettled([
      fetchJson(endpoints.strategyStocks, 20000),
      fetchJson(`${endpoints.institutionCache}?t=${Date.now()}`, 10000),
    ]);

    if (stockResult.status === "fulfilled") {
      const stocks = normalizeArray(stockResult.value?.stocks || stockResult.value);
      const parsed = parseStocksForLatest(stocks);
      if (parsed.length) latestStocks = parsed;
    }

    let instPayload = instResult.status === "fulfilled" ? instResult.value : null;
    if (!instPayload?.ok || !instPayload?.data || !Object.keys(instPayload.data).length) {
      instPayload = await fetchJson(`${endpoints.institutionBackup}?t=${Date.now()}`, 10000);
    }
    if (instPayload?.ok && instPayload?.data) {
      institutionData = instPayload.data;
      institutionDate = instPayload.usedDate || "";
      const updatedAt = Date.parse(instPayload.updatedAt || "");
      institutionUpdatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    }

    applyStaticTitleIcons();
    renderChipTradeTable();
  } catch (error) {
    if (body) body.innerHTML = `<tr><td colspan="12">資料載入失敗，請稍後再試。</td></tr>`;
  } finally {
    chipTradeLoading = false;
  }
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
    const code = String(valueOf(stock, ["證券代號", "Code", "code"]) || "").trim();
    const name = valueOf(stock, ["證券名稱", "Name", "name"]) || code;
    const change = cleanNumber(valueOf(stock, ["漲跌價差", "Change", "change"])) || 0;
    const close = cleanNumber(valueOf(stock, ["收盤價", "ClosingPrice", "收盤", "close"])) || 0;
    const value = cleanNumber(valueOf(stock, ["成交金額", "TradeValue", "value"])) || 0;
    const volume = cleanNumber(valueOf(stock, ["成交股數", "TradeVolume", "tradeVolume", "volume"])) || 0;
    if (!code || !close) continue;
    const prev = close - change;
    const pct = cleanNumber(valueOf(stock, ["pct", "percent", "漲跌百分比"])) || (prev > 0 ? (change / prev) * 100 : 0);
    const industry = SECTOR_MAP[code];
    if (!industry) continue;
    if (!sectorStocksCache[industry]) sectorStocksCache[industry] = [];
    // 避免重複
    if (!sectorStocksCache[industry].find(s => s.code === code)) {
      sectorStocksCache[industry].push({ code, name, close, change, pct, value, volume });
    }
  }
}

function buildHeatmapFallbackFromLatestStocks() {
  if (Object.keys(sectorStocksCache).length || !latestStocks.length) return false;
  buildSectorStocksCache(latestStocks);
  return renderHeatmapFromCache();
}

function getMarketRenderSignature(stocks) {
  const leaders = stocks
    .filter((stock) => stock.percent > 0)
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 12)
    .map((stock) => `${stock.code}:${stock.close}:${stock.percent.toFixed(2)}:${Math.round(stock.value / 1000000)}`)
    .join("|");
  const up = stocks.filter((stock) => stock.change > 0).length;
  const down = stocks.filter((stock) => stock.change < 0).length;
  return `${stocks.length}:${up}:${down}:${leaders}`;
}

function renderStocks(stocks) {
  const parsed = parseStocksForLatest(stocks);

  if (!parsed.length) return;
  latestStocks = parsed;
  const now = Date.now();
  const signature = getMarketRenderSignature(parsed);
  const canReuseDom = signature === lastMarketRenderSignature && now - marketDataLastRenderedAt < MARKET_DOM_REFRESH_MS;
  if (canReuseDom) return;
  lastMarketRenderSignature = signature;
  marketDataLastRenderedAt = now;

  if (isViewActive("market") || !Object.keys(sectorStocksCache).length) {
    buildSectorStocksCache(stocks);
    renderHeatmapFromCache();
  }

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
  if (isViewActive("realtime-radar")) deferUiWork(renderRealtimeRadar);
  if (isViewActive("strategy")) deferUiWork(renderStrategyScanner);
  if (isViewActive("chip-trade")) deferUiWork(renderChipTradeTable);
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
  syncMobileStrategyVisibility(viewName);
  applyStaticTitleIcons();
  viewLinks.forEach((link)=>link.classList.toggle("active", link===activeLink));
  if (viewName === "realtime-radar") deferUiWork(renderRealtimeRadar);
  if (viewName === "strategy") deferUiWork(renderStrategyScanner);
  if (viewName === "chip-trade") deferUiWork(loadChipTradeData);
  if (viewName === "warrant-flow") deferUiWork(loadWarrantFlow);
  deferUiWork(ensureMobileAutoOrganizeButton);
  deferUiWork(normalizeMobileHorizontalPosition, 60);
  const focusTarget = activeLink?.dataset.focus ? document.querySelector(`#${activeLink.dataset.focus}`) : null;
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
  const now = Date.now();
  const minInterval = isDocumentHidden() ? MARKET_REFRESH_HIDDEN_MS : MARKET_REFRESH_MS;
  if (marketDataLoading || (marketDataLastStartedAt && now - marketDataLastStartedAt < minInterval)) return;
  marketDataLoading = true;
  marketDataLastStartedAt = now;
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
  } finally {
    marketDataLoading = false;
  }
}

async function loadHeatmap() {
  if (!Object.keys(sectorStocksCache).length && !heatmap.children.length) {
    heatmap.innerHTML = `<div class="empty-state">載入產業資料中...</div>`;
  } else {
    renderHeatmapFromCache();
  }
  try {
    const data = await fetchJson(endpoints.heatmap, 15000);
    const sectors = normalizeArray(data?.sectors);
    if (data?.ok && sectors.length) {
      renderHeatmapSectors(sectors);
      return;
    }
    throw new Error("heatmap empty");
  } catch (e) {
    if (!renderHeatmapFromCache() && !buildHeatmapFallbackFromLatestStocks()) {
      heatmap.innerHTML = `<div class="empty-state">產業資料載入失敗</div>`;
    }
  }
}

async function loadInstitution() {
  try {
    let data = await fetchJson(`${endpoints.institutionCache}?t=${Date.now()}`, 10000);
    if (!data?.ok || !data?.data || !Object.keys(data.data).length) {
      data = await fetchJson(`${endpoints.institutionBackup}?t=${Date.now()}`, 10000);
    }
    if (data.ok && data.data) {
      institutionData = data.data;
      institutionDate = data.usedDate || "";
      const updatedAt = Date.parse(data.updatedAt || "");
      institutionUpdatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    }
    applyStaticTitleIcons();
    if (isViewActive("strategy")) deferUiWork(renderStrategyScanner);
    if (isViewActive("chip-trade")) deferUiWork(renderChipTradeTable);
  } catch (e) {}
}

function applyStrategyPresetFromLink(link) {
  const text = link?.textContent || "";
  const isRadarNav = text.includes("雷達");
  if (!isRadarNav && !text.includes("策略1") && !text.includes("策略2") && !text.includes("策略3") && !text.includes("策略4") && !text.includes("策略5")) return;
  strategyPresetMode = text.includes("策略5") ? "strategy5" : text.includes("策略3") ? "strategy3" : "";
  selectedStrategyIds = text.includes("策略1")
    ? new Set(["open_buy"])
    : text.includes("策略3")
    ? new Set(["overnight_chip"])
    : text.includes("策略5")
    ? new Set(["foreign_trust_breakout"])
    : new Set([text.includes("策略4") ? "swing_radar" : "intraday_2m"]);
  if (text.includes("策略5")) strategy5ActiveId = "foreign_trust_breakout";
  if (text.includes("策略3")) strategy5ActiveId = "overnight_chip";
  if (text.includes("策略4")) swingSignalFilter = "all";
  if (text.includes("策略2")) intradaySignalFilter = "all";
  if (text.includes("策略1")) openBuyPage = 1;
  if (text.includes("策略3")) strategy3Page = 1;
  if (text.includes("策略4")) swingPage = 1;
  if (text.includes("策略5")) strategy5Page = 1;
  strategyMode = "any";
  strategyKeyword = "";
  if (strategySearch) strategySearch.value = "";
  if (text.includes("策略5")) {
    deferUiWork(() => loadStrategy5Cache(true), 60);
  } else if (text.includes("策略3")) {
    deferUiWork(async () => {
      await loadStrategyStocks();
      await loadStrategy3Cache(true);
      renderStrategyScanner();
    }, 60);
  } else {
    deferUiWork(loadStrategyStocks);
  }
  if (text.includes("策略2") || isRadarNav) {
    deferUiWork(async () => {
      await ensureStrategyStocksLoaded();
      await refreshStrategyRealtimeScan("force");
    }, 80);
  }
  if (text.includes("策略1")) {
    deferUiWork(() => loadOpenBuyCache(true), 60);
  }
  if (text.includes("策略4")) {
    deferUiWork(() => loadStrategy4Cache(true), 60);
  }
}

function getIntradayHotScore(stock) {
  const live = applyStrategyQuote(stock);
  const pct = cleanNumber(live.percent);
  const value = cleanNumber(live.value);
  const volume = cleanNumber(live.tradeVolume);
  const close = cleanNumber(live.close);
  const history = strategyRealtimeQuotes[live.code]?.history || [];
  const latestDelta = cleanNumber(history.at(-1)?.deltaVolume);
  const signalBonus = (live.intradaySignals?.length || 0) * 900;
  const pctScore = Math.max(pct, -2) * 150;
  const volumeScore = Math.log10(Math.max(volume, 1)) * 38;
  const deltaScore = Math.log10(Math.max(latestDelta, 1)) * 70;
  const pricePenalty = close >= 900 ? 9999 : 0;
  return signalBonus + pctScore + volumeScore + deltaScore - pricePenalty;
}

function uniqueStocksByCode(stocks) {
  const seen = new Set();
  return stocks.filter((stock) => {
    const code = String(stock?.code || "");
    if (!code || seen.has(code)) return false;
    seen.add(code);
    return true;
  });
}

function pruneIntradayCandidates(now = Date.now()) {
  Object.entries(intradayCandidateSeenAt).forEach(([code, seenAt]) => {
    if (now - seenAt > INTRADAY_CANDIDATE_TTL_MS) delete intradayCandidateSeenAt[code];
  });
}

function markIntradayCandidates(stocks) {
  const now = Date.now();
  pruneIntradayCandidates(now);
  stocks.forEach((stock) => {
    const live = applyStrategyQuote(stock);
    const code = String(live.code || "");
    if (!code) return;
    const pct = cleanNumber(live.percent);
    const value = cleanNumber(live.value);
    const volume = cleanNumber(live.tradeVolume);
    const latestDelta = cleanNumber(strategyRealtimeQuotes[code]?.history?.at(-1)?.deltaVolume);
    if (hasIntradayLiquidity(live) && (pct >= 1.5 || volume >= INTRADAY_MIN_VOLUME || latestDelta >= 50)) {
      intradayCandidateSeenAt[code] = now;
    }
  });
}

function getBaseStrongIntradayStocks(scanSource) {
  return scanSource
    .filter((stock) => {
      const live = applyStrategyQuote(stock);
      const pct = cleanNumber(live.percent);
      const volume = cleanNumber(live.tradeVolume);
      const close = cleanNumber(live.close);
      const open = cleanNumber(live.open);
      return close && (
        pct >= 2 ||
        (open && close >= open && pct >= 0.5) ||
        volume >= 2000
      );
    })
    .sort((a, b) => getIntradayHotScore(b) - getIntradayHotScore(a));
}

function getIntradayCandidateStocks(scanSource) {
  pruneIntradayCandidates();
  const byCode = Object.fromEntries(scanSource.map((stock) => [stock.code, stock]));
  return Object.keys(intradayCandidateSeenAt).map((code) => byCode[code]).filter(Boolean);
}

function sliceBackgroundScan(stocks, count) {
  if (!stocks.length || count <= 0) return [];
  const result = [];
  let guard = 0;
  while (result.length < Math.min(count, stocks.length) && guard < stocks.length + count) {
    result.push(stocks[strategyRealtimeBackgroundCursor % stocks.length]);
    strategyRealtimeBackgroundCursor = (strategyRealtimeBackgroundCursor + 1) % stocks.length;
    guard += 1;
  }
  return result;
}

async function fetchStrategyRealtimeBatches(stocks, batchSize = 80) {
  const requests = [];
  let requested = 0;
  for (let start = 0; start < stocks.length; start += batchSize) {
    const codes = stocks.slice(start, start + batchSize).map((stock) => stock.code).filter(Boolean);
    if (codes.length) {
      requested += codes.length;
      requests.push(fetchJson(`${endpoints.realtime}?codes=${encodeURIComponent(codes.join(","))}&t=${Date.now()}`, 12000));
    }
  }
  const payloads = await Promise.allSettled(requests);
  let received = 0;
  let failed = 0;
  let lastError = "";
  payloads.forEach((result) => {
    if (result.status === "fulfilled") {
      const quotes = normalizeArray(result.value?.quotes);
      received += quotes.length;
      quotes.forEach(updateStrategyQuote);
    } else {
      failed += 1;
      lastError = result.reason?.message || String(result.reason || "realtime failed");
    }
  });
  return { requested, received, failed, lastError };
}

async function refreshStrategyRealtimeScan(mode = "hot") {
  const scanMode = mode === true ? "force" : String(mode || "hot");
  if (strategyRealtimeLoading) {
    return;
  }
  if (scanMode === "strategy5-full") return;
  const mobileStrategy2 = isMobileViewport();
  if (mobileStrategy2 && scanMode !== "force") {
    const now = Date.now();
    if (scanMode === "hot") {
      if (now - mobileIntradayHotScanLastAt < MOBILE_INTRADAY_HOT_SCAN_MS) return;
      mobileIntradayHotScanLastAt = now;
    }
    if (scanMode === "background") {
      if (now - mobileIntradayBackgroundScanLastAt < MOBILE_INTRADAY_BACKGROUND_SCAN_MS) return;
      mobileIntradayBackgroundScanLastAt = now;
    }
  }
  const isStrategyVisible = document.querySelector("#strategy-view")?.classList.contains("active");
  const isRealtimeStrategy = selectedStrategyIds.has("intraday_2m");
  const isStrategy5Realtime = false;
  if (scanMode !== "force" && scanMode !== "strategy5-full" && (!isStrategyVisible || (!isRealtimeStrategy && !isStrategy5Realtime))) return;
  if (!latestStocks.length) {
    if (isStrategyVisible && isRealtimeStrategy && strategySummary) {
      strategySummary.textContent = "策略2-當沖雷達｜正在載入股票清單，載入後會立即掃描。";
    }
    await ensureStrategyStocksLoaded();
  }
  if (!latestStocks.length) {
    if (isStrategyVisible && isRealtimeStrategy && strategyTable) {
      strategyTable.innerHTML = `<div class="empty-state">策略2暫時無法取得股票清單，請稍後再重新整理。</div>`;
    }
    return;
  }

  strategyRealtimeLoading = true;
  try {
    const scanSource = isStrategy5Realtime
      ? latestStocks.filter((stock) => {
          const code = String(stock?.code || "");
          const name = String(stock?.name || "");
          return /^\d{4}$/.test(code) && !/^00/.test(code) && !/ETF|ETN|指數|台灣50|高股息|正2|反1|期貨|債/i.test(name);
        })
      : latestStocks.filter((stock) => isIntradayTradable(applyStrategyQuote(stock)));
    const hotScanLimit = mobileStrategy2 ? MOBILE_INTRADAY_HOT_SCAN_LIMIT : INTRADAY_HOT_SCAN_LIMIT;
    const forceExtraLimit = mobileStrategy2 ? MOBILE_INTRADAY_FORCE_EXTRA_LIMIT : 300;
    const backgroundBatchLimit = mobileStrategy2 ? MOBILE_INTRADAY_BACKGROUND_BATCH : INTRADAY_BACKGROUND_BATCH;
    const rankedHotStocks = [...scanSource]
      .sort((a, b) => getIntradayHotScore(b) - getIntradayHotScore(a))
      .slice(0, hotScanLimit);
    const baseStrongStocks = getBaseStrongIntradayStocks(scanSource);
    const candidateStocks = getIntradayCandidateStocks(scanSource);
    const hotStocks = isStrategy5Realtime
      ? []
      : uniqueStocksByCode([...candidateStocks, ...baseStrongStocks, ...rankedHotStocks])
        .slice(0, scanMode === "force" ? hotScanLimit + forceExtraLimit : hotScanLimit);
    const hotCodes = new Set(hotStocks.map((stock) => stock.code));
    const backgroundPool = scanSource.filter((stock) => !hotCodes.has(stock.code));
    const shouldScanHot = !isStrategy5Realtime && (scanMode === "hot" || scanMode === "force");
    const shouldScanBackground = isStrategy5Realtime || scanMode === "background" || scanMode === "force";
    const backgroundStocks = scanMode === "strategy5-full"
      ? backgroundPool
      : shouldScanBackground
      ? sliceBackgroundScan(backgroundPool, isStrategy5Realtime ? backgroundBatchLimit * 2 : scanMode === "force" ? backgroundBatchLimit * 2 : backgroundBatchLimit)
      : [];
    const hotBatchSize = mobileStrategy2 ? 45 : 75;
    const backgroundBatchSize = mobileStrategy2 ? 45 : 90;
    let requested = 0;
    let received = 0;
    let failed = 0;
    let lastError = "";

    strategyRealtimeCursor = (strategyRealtimeCursor + hotStocks.length + backgroundStocks.length) % Math.max(scanSource.length, 1);
    if (shouldScanHot) {
      const stats = await fetchStrategyRealtimeBatches(hotStocks, hotBatchSize);
      requested += stats.requested;
      received += stats.received;
      failed += stats.failed;
      lastError = stats.lastError || lastError;
      markIntradayCandidates(hotStocks);
      strategyLastScanAt = Date.now();
      strategyRealtimeStats = { requested, received, failed, lastError };
      renderStrategyScanner();
    }
    if (backgroundStocks.length) {
      const stats = await fetchStrategyRealtimeBatches(backgroundStocks, backgroundBatchSize);
      requested += stats.requested;
      received += stats.received;
      failed += stats.failed;
      lastError = stats.lastError || lastError;
      markIntradayCandidates(backgroundStocks);
      strategyLastScanAt = Date.now();
      strategyRealtimeStats = { requested, received, failed, lastError };
      renderStrategyScanner();
    }
  } catch (error) {
    strategyRealtimeStats = { ...strategyRealtimeStats, lastError: error?.message || String(error || "scan failed") };
    if (isViewActive("strategy") && selectedStrategyIds.has("intraday_2m") && strategySummary) {
      strategySummary.textContent = `策略2即時巡邏失敗：${strategyRealtimeStats.lastError}`;
    }
  } finally {
    strategyRealtimeLoading = false;
  }
}

async function refreshOpenBuyScan(force = false) {
  await loadOpenBuyCache(force);
}

async function loadStrategy4Cache(force = false) {
  if (strategy4CacheLoading) return;
  if (!force && strategy4ScanLastAt) return;
  if (shouldSkipMobileOtherStrategyCacheRefresh("strategy4", Boolean(strategy4ScanLastAt), force)) {
    renderStrategyScanner();
    return;
  }
  strategy4CacheLoading = true;
  try {
    let payload = await fetchJson(`${endpoints.strategy4Cache}?t=${Date.now()}`, 10000);
    if (!normalizeArray(payload?.matches).length) {
      payload = await fetchJson(`${endpoints.strategy4Backup}?t=${Date.now()}`, 10000);
    }
    if (payload?.ok && Array.isArray(payload.matches)) {
      mergeStrategy4Cache(payload);
      renderStrategyScanner();
    }
  } catch (error) {
  } finally {
    strategy4CacheLoading = false;
  }
}

async function refreshStrategyHistoryScan(force = false) {
  await loadStrategy4Cache(force);
}

tickClock();
labelChipTradeMode();
installMobileWatchlistNavOrder();
installRealtimeRadarView();
applyStaticTitleIcons();
deferUiWork(() => loadWorkflowRunStatus().catch(() => {}), 2000);
ensureMobileAutoOrganizeButton();
loadMarketData();
loadHeatmap();
loadInstitution();
if (brandRefresh) {
  brandRefresh.setAttribute("role", "button");
  brandRefresh.setAttribute("tabindex", "0");
  brandRefresh.setAttribute("title", "重新整理頁面");
  brandRefresh.style.cursor = "pointer";
  brandRefresh.addEventListener("click", () => window.location.reload());
  brandRefresh.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    window.location.reload();
  });
}
stockSearch?.addEventListener("input", (e)=>searchStocks(e.target.value));
viewLinks.forEach((link)=>{
  link.addEventListener("click",(e)=>{
    e.preventDefault();
    applyStrategyPresetFromLink(link);
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
document.querySelector("#chip-sort")?.addEventListener("change", () => {
  chipTradePage = 1;
  renderChipTradeTable();
});
document.querySelectorAll("[data-chip-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    chipFilter = button.dataset.chipFilter || "joint";
    chipTradePage = 1;
    document.querySelectorAll("[data-chip-filter]").forEach((item) => item.classList.toggle("active", item === button));
    renderChipTradeTable();
  });
});
setInterval(tickClock, 1000);
setInterval(loadMarketData, MARKET_REFRESH_MS);
setInterval(() => refreshStrategyRealtimeScan("hot"), INTRADAY_FAST_SCAN_MS);
setInterval(() => refreshStrategyRealtimeScan("background"), INTRADAY_BACKGROUND_SCAN_MS);
setInterval(() => {
  if (!isDocumentHidden() && isViewActive("market")) loadHeatmap();
}, 15*60*1000);

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

function ensureWatchlistAnalysisStyles() {
  if (document.querySelector("#watchlist-analysis-styles")) return;
  const style = document.createElement("style");
  style.id = "watchlist-analysis-styles";
  style.textContent = `
    .watch-analysis-panel {
      display: grid;
      gap: 14px;
      color: #dbe7ff;
    }
    .watch-action-row {
      display: grid;
      grid-template-columns: minmax(120px, 1fr) minmax(180px, 2fr) minmax(160px, 1.4fr);
      gap: 10px;
      align-items: end;
    }
    .watch-action-row label {
      display: grid;
      gap: 5px;
      color: #7e8dae;
      font-size: 11px;
      font-weight: 800;
    }
    .watch-action-row input,
    .watch-action-row button {
      border-radius: 8px;
      border: 1px solid rgba(127, 166, 255, 0.18);
      background: rgba(21, 24, 38, 0.96);
      color: #eaf1ff;
      font-weight: 900;
      padding: 11px 14px;
    }
    .watch-action-row button {
      border-color: rgba(255, 106, 61, 0.65);
      color: #ff8a5c;
      cursor: pointer;
    }
    .watch-action-row .primary {
      background: linear-gradient(90deg, #ef6a3b, #ff6d3d);
      border-color: transparent;
      color: #fff;
    }
    .watch-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .watch-card-carousel {
      position: relative;
      min-width: 0;
    }
    .watch-card-grid {
      display: flex;
      gap: 12px;
      overflow-x: auto;
      scroll-behavior: smooth;
      scroll-snap-type: x mandatory;
      padding: 0 48px 4px;
      scrollbar-width: none;
    }
    .watch-card-grid::-webkit-scrollbar {
      display: none;
    }
    .watch-metric,
    .watch-analysis-card {
      border: 1px solid rgba(127, 166, 255, 0.14);
      border-radius: 8px;
      background: rgba(18, 21, 34, 0.92);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
    }
    .watch-metric,
    .watch-analysis-card {
      padding: 18px;
      min-height: 86px;
    }
    .watch-analysis-card {
      flex: 0 0 min(250px, calc(100vw - 120px));
      min-height: 132px;
      scroll-snap-align: start;
    }
    .watch-scroll-btn {
      position: absolute;
      top: 50%;
      z-index: 2;
      display: grid;
      place-items: center;
      width: 34px;
      height: 54px;
      border: 1px solid rgba(127, 166, 255, 0.18);
      border-radius: 8px;
      background: rgba(12, 15, 26, 0.88);
      color: #eaf1ff;
      cursor: pointer;
      font-size: 24px;
      font-weight: 900;
      transform: translateY(-50%);
      box-shadow: 0 12px 28px rgba(0,0,0,0.28);
    }
    .watch-scroll-btn:hover {
      border-color: rgba(255, 106, 61, 0.55);
      color: #ff8a5c;
    }
    .watch-scroll-btn.prev {
      left: 6px;
    }
    .watch-scroll-btn.next {
      right: 6px;
    }
    .watch-metric span,
    .watch-analysis-card span {
      display: block;
      color: #7e8dae;
      font-size: 12px;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .watch-metric strong,
    .watch-analysis-card strong {
      display: block;
      color: #fff;
      font-size: 22px;
      font-weight: 950;
      line-height: 1.15;
    }
    .watch-metric em,
    .watch-analysis-card em,
    .watch-note-row small {
      display: block;
      color: #90a5cc;
      font-size: 12px;
      font-style: normal;
      margin-top: 8px;
      line-height: 1.5;
    }
    .watch-analysis-card.hot { border-top: 4px solid #ff4f72; }
    .watch-analysis-card.neutral { border-top: 4px solid #73798d; }
    .watch-analysis-card.good { border-top: 4px solid #16d08f; }
    .watch-analysis-card.warn { border-top: 4px solid #f7a928; }
    .watch-analysis-card b {
      color: #ffbf47;
      font-size: 13px;
    }
    .watch-note-row {
      display: grid;
      gap: 8px;
    }
    .watch-note-row article {
      display: grid;
      grid-template-columns: 28px 1fr;
      gap: 12px;
      align-items: center;
      border: 1px solid rgba(127, 166, 255, 0.12);
      border-radius: 8px;
      background: rgba(24, 27, 42, 0.86);
      padding: 11px 14px;
    }
    .watch-note-row b {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 7px;
      background: rgba(255, 106, 61, 0.18);
      color: #ff8a5c;
      font-size: 12px;
    }
    .watch-up { color: #ff5d72 !important; }
    .watch-down { color: #20d18b !important; }
    .watch-flat { color: #dbe7ff !important; }
    @media (max-width: 980px) {
      .watch-action-row,
      .watch-summary-grid {
        grid-template-columns: 1fr;
      }
      .watch-card-grid {
        padding-inline: 42px;
      }
    }
  `;
  document.head.appendChild(style);
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
  const track = "rgba(128, 132, 122, 0.72)";
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
    return `conic-gradient(from 270deg at 50% 100%, ${track} 0deg 180deg, transparent 180deg 360deg)`;
  }

  return `conic-gradient(from 270deg at 50% 100%, ${visibleStops.join(", ")}, ${fillColor} ${fill.toFixed(1)}deg, ${track} ${fill.toFixed(1)}deg 180deg, transparent 180deg 360deg)`;
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

function pctText(value) {
  const number = cleanNumber(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function watchToneClass(value) {
  const number = cleanNumber(value);
  if (number > 0) return "watch-up";
  if (number < 0) return "watch-down";
  return "watch-flat";
}

function formatLots(value) {
  const number = normalizeTradeVolumeLots(value);
  if (!number) return "--";
  return `${Math.round(number).toLocaleString("zh-TW")} 張`;
}

function buildWatchAnalysisModel(stock, analysis, timeframe) {
  const close = cleanNumber(stock.close);
  const open = cleanNumber(stock.open);
  const high = cleanNumber(stock.high) || Math.max(close, open || close);
  const low = cleanNumber(stock.low) || Math.min(close, open || close);
  const prevClose = cleanNumber(stock.prevClose) || close - cleanNumber(stock.change);
  const pct = cleanNumber(stock.percent);
  const range = Math.max(high - low, 0);
  const rangePosition = range ? clamp(Math.round(((close - low) / range) * 100), 0, 100) : 50;
  const inst = getInstitutionTotal(stock.code);
  const supportA = close ? close * 0.997 : 0;
  const supportB = close ? Math.max(low || 0, close * 0.985) : 0;
  const supportC = close ? close * 0.97 : 0;
  const pressureA = close ? Math.max(high || 0, close * 1.012) : 0;
  const pressureB = close ? close * 1.02 : 0;
  const pressureC = close ? close * 1.04 : 0;
  const volumeLots = normalizeTradeVolumeLots(stock.tradeVolume || stock.volume);
  const turnoverValue = cleanNumber(stock.value) || estimateTradeValue(close, volumeLots);
  const chipScore = analysis.hasInstitution
    ? clamp(Math.round(50 + Math.sign(inst.foreign) * 18 + Math.sign(inst.trust) * 22 + Math.sign(inst.total) * 10), 0, 100)
    : 0;
  const trendLabel = analysis.score >= 70
    ? "強勢整理"
    : analysis.score >= 58
      ? "偏多整理"
      : analysis.score >= 43
        ? "弱勢整理"
        : "轉弱觀察";
  const strategyLabel = analysis.score >= 70
    ? "等待拉回"
    : analysis.score >= 58
      ? "等待轉強"
      : analysis.score >= 43
        ? "等待確認"
        : "先避開";
  const riskLabel = pct >= 7
    ? "漲幅過熱"
    : pct <= -5
      ? "跌幅偏深"
      : rangePosition >= 82
        ? "追高風險"
        : "風險可控";
  const actionTitle = analysis.score >= 58 ? "等待轉強" : "等待確認";
  const actionHint = analysis.score >= 58
    ? `先等量價延續，站回 ${formatStockPrice(pressureA)} 後再觀察。`
    : `先看 ${formatStockPrice(supportA)} 是否守住，不急著追。`;
  const dataQuality = [
    `即時/收盤價格：${formatStockPrice(close)}，漲跌幅 ${pctText(pct)}，資料來源為終端現有市場資料。`,
    analysis.hasInstitution
      ? `法人資料可用：外資 ${formatInstitution(inst.foreign)}，投信 ${formatInstitution(inst.trust)}，法人合計 ${formatInstitution(inst.total)}。`
      : "法人資料目前尚未完整更新，籌碼判斷以盤後資料為主。",
    `成交量 ${formatLots(volumeLots)}，成交金額約 ${radarMoney(turnoverValue)}，量能排名 ${analysis.volumeRank ?? "--"}%。`,
  ];
  const technical = [
    `趨勢方向：${trendLabel}，${timeframe.label} 動能分 ${analysis.score}，震盪分 ${analysis.oscillatorScore}，均線分 ${analysis.maScore}。`,
    `當日位置：高 ${formatStockPrice(high)}、低 ${formatStockPrice(low)}、收 ${formatStockPrice(close)}，收盤位於區間約 ${rangePosition}%。`,
    `支撐觀察：${formatStockPrice(supportA)}、${formatStockPrice(supportB)}、${formatStockPrice(supportC)}；壓力觀察：${formatStockPrice(pressureA)}、${formatStockPrice(pressureB)}、${formatStockPrice(pressureC)}。`,
  ];
  const chips = [
    analysis.hasInstitution
      ? `外資 ${formatInstitution(inst.foreign)}，投信 ${formatInstitution(inst.trust)}，法人合計 ${formatInstitution(inst.total)}，籌碼分 ${chipScore}。`
      : "法人資料尚未完整，先不把籌碼視為主要決策依據。",
    inst.total > 0
      ? "法人合計偏買，若量價同步續強，籌碼可視為加分。"
      : inst.total < 0
        ? "法人合計偏賣，若價格跌破支撐，需優先控制風險。"
        : "法人合計中性，仍以價格與成交量變化為主。",
  ];
  const bullPoints = [
    pct > 0 ? `股價上漲 ${pctText(pct)}，短線仍有動能。` : "若能重新站回平盤並放量，才有轉強條件。",
    rangePosition >= 50 ? "收盤位於日內中上區，買盤承接尚可。" : "收盤位置偏低，需要先確認承接。",
    chipScore >= 60 ? "法人籌碼偏多，對後續續航有加分。" : "籌碼尚未明顯偏多，需等待確認。",
  ];
  const bearPoints = [
    rangePosition >= 82 ? "收盤接近日內高位，短線追價風險上升。" : `跌破 ${formatStockPrice(supportA)} 後，短線轉弱機率提高。`,
    pct >= 7 ? "單日漲幅偏大，隔日容易震盪洗盤。" : "若量能縮小，容易變成整理而非續攻。",
    chipScore <= 40 && analysis.hasInstitution ? "法人籌碼偏弱，需避免只看價格追高。" : "若法人買盤不延續，仍需回到量價確認。",
  ];
  const summary = [
    `${stock.code} ${stock.name || ""} 目前判斷為「${trendLabel}」，現價 ${formatStockPrice(close)}，漲幅 ${pctText(pct)}。`,
    `主要支撐看 ${formatStockPrice(supportA)} / ${formatStockPrice(supportB)}，壓力看 ${formatStockPrice(pressureA)} / ${formatStockPrice(pressureB)}。`,
    `操作提醒：${actionHint}`,
    "以上為系統量價與籌碼整理，不構成投資建議。",
  ];

  return {
    close,
    prevClose,
    pct,
    high,
    low,
    rangePosition,
    trendLabel,
    strategyLabel,
    riskLabel,
    actionTitle,
    actionHint,
    supportA,
    supportB,
    supportC,
    pressureA,
    pressureB,
    pressureC,
    chipScore,
    inst,
    volumeLots,
    turnoverValue,
    dataQuality,
    technical,
    chips,
    bullPoints,
    bearPoints,
    summary,
  };
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
  ensureWatchlistAnalysisStyles();
  const fallback = latestStocks.find(s => s.code === code) || { code, name, close: 0, change: 0, percent: 0 };
  const stock = await fetchStockPrice(code) || fallback;
  const activeTimeframe = getTechnicalTimeframe();
  const analysis = buildTechnicalSummary(stock, activeTimeframe.key);
  const sign = stock.change >= 0 ? "+" : "";
  const changeClass = stock.change >= 0 ? "down" : "up";
  const trustText = analysis.hasInstitution ? `${analysis.trust >= 0 ? "+" : ""}${(analysis.trust / 1000).toFixed(0)}k` : "盤後";
  const trustClass = analysis.hasInstitution ? (analysis.trust >= 0 ? "down" : "up") : "";
  const volumeText = formatVolumeMetric(stock, analysis);
  const model = buildWatchAnalysisModel(stock, analysis, activeTimeframe);
  const trendTone = analysis.score >= 58 ? "good" : analysis.score >= 43 ? "neutral" : "warn";
  const riskTone = model.riskLabel === "風險可控" ? "good" : "warn";
  const changeTone = stock.percent >= 0 ? "watch-up" : "watch-down";

  watchlistAnalysis.innerHTML = `
    <div class="watch-analysis-panel ta-dashboard">
      <section class="watch-action-row">
        <label>
          股票代碼
          <input value="${code}" readonly>
        </label>
        <button class="primary" type="button" data-watch-load>載入資料</button>
        <button type="button" data-watch-analyze>儀表板</button>
      </section>

      <section class="watch-summary-grid">
        <article class="watch-metric">
          <span>標的</span>
          <strong>${code} ${stock.name || name || ""}</strong>
        </article>
        <article class="watch-metric">
          <span>趨勢判斷</span>
          <strong class="${trendTone === "good" ? "watch-up" : trendTone === "warn" ? "watch-down" : "watch-flat"}">${model.trendLabel}</strong>
        </article>
        <article class="watch-metric">
          <span>漲跌幅</span>
          <strong class="${changeTone}">${pctText(stock.percent)}</strong>
          <em>前收 ${formatStockPrice(model.prevClose)} → 現價 ${formatStockPrice(stock.close)}</em>
        </article>
        <article class="watch-metric">
          <span>符合策略</span>
          <strong>${analysis.score >= 58 ? 1 : 0}</strong>
          <em>${model.strategyLabel}</em>
        </article>
      </section>

      <section class="watch-card-carousel">
        <button class="watch-scroll-btn prev" type="button" data-watch-scroll="left" aria-label="上一張">‹</button>
        <div class="watch-card-grid" data-watch-carousel>
          <article class="watch-analysis-card ${trendTone}">
            <span>趨勢</span>
            <strong>${model.trendLabel}</strong>
            <b>${pctText(stock.percent)}</b>
            <em>收盤位於日內區間 ${model.rangePosition}%。</em>
          </article>
          <article class="watch-analysis-card neutral">
            <span>價位</span>
            <strong>現價 ${formatStockPrice(model.close)}</strong>
            <b>${formatStockPrice(model.supportA)} / ${formatStockPrice(model.pressureA)}</b>
            <em>支撐觀察與壓力觀察。</em>
          </article>
          <article class="watch-analysis-card warn">
            <span>籌碼</span>
            <strong>${analysis.hasInstitution ? "籌碼待確認" : "法人盤後"}</strong>
            <b>籌碼 ${model.chipScore || "--"} / 主力 ${analysis.hasInstitution ? Math.round((model.chipScore + analysis.score) / 2) : "--"}</b>
            <em>外資 ${formatInstitution(model.inst.foreign)}，投信 ${formatInstitution(model.inst.trust)}。</em>
          </article>
          <article class="watch-analysis-card ${riskTone}">
            <span>風險</span>
            <strong>${model.riskLabel}</strong>
            <b>${analysis.volumeRank ?? 0} 則</b>
            <em>${model.riskLabel === "風險可控" ? "目前沒有明顯過熱風險。" : "需等待量價確認。"}</em>
          </article>
          <article class="watch-analysis-card good">
            <span>操作提醒</span>
            <strong>${model.actionTitle}</strong>
            <b>支撐 ${formatStockPrice(model.supportA)}</b>
            <em>${model.actionHint}</em>
          </article>
        </div>
        <button class="watch-scroll-btn next" type="button" data-watch-scroll="right" aria-label="下一張">›</button>
      </section>

      <section class="watch-note-row">
        <article><b>1</b><small>${code} ${stock.name || ""}：${model.trendLabel}，漲跌幅 ${pctText(stock.percent)}，收盤位於日內區間 ${model.rangePosition}%。</small></article>
        <article><b>2</b><small>支撐觀察：${formatStockPrice(model.supportA)}、${formatStockPrice(model.supportB)}、${formatStockPrice(model.supportC)}；壓力觀察：${formatStockPrice(model.pressureA)}、${formatStockPrice(model.pressureB)}、${formatStockPrice(model.pressureC)}。</small></article>
        <article><b>3</b><small>${model.riskLabel === "風險可控" ? "目前風險可控，但仍需搭配成交量確認。" : "短線波動偏高，先等待支撐或轉強訊號。"}</small></article>
      </section>

      <section class="ta-period-panel">
        <h3><span>${code}</span>的儀表板</h3>
        <nav class="ta-timeframes" aria-label="技術分析週期">
          ${buildTimeframeButtons(activeTimeframe.key)}
        </nav>
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

  watchlistAnalysis.querySelector("[data-watch-load]")?.addEventListener("click", () => {
    showTradingDashboard(code, stock.name || name);
  });
  watchlistAnalysis.querySelector("[data-watch-analyze]")?.addEventListener("click", () => {
    showTradingDashboard(code, stock.name || name);
  });
  watchlistAnalysis.querySelectorAll("[data-watch-scroll]").forEach((button) => {
    button.addEventListener("click", () => {
      const carousel = watchlistAnalysis.querySelector("[data-watch-carousel]");
      if (!carousel) return;
      const direction = button.dataset.watchScroll === "left" ? -1 : 1;
      const card = carousel.querySelector(".watch-analysis-card");
      const distance = card ? card.getBoundingClientRect().width + 12 : 260;
      carousel.scrollBy({ left: direction * distance, behavior: "smooth" });
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
    return { code, name: item.Name || code, close, change, percent, tradeVolume: normalizeTradeVolumeLots(item.TradeVolume) };
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
syncMobileStrategyVisibility();
window.addEventListener("resize", () => deferUiWork(syncMobileStrategyVisibility, 80));

watchlistSearchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addToWatchlist();
});
watchlistAddBtn?.addEventListener("click", addToWatchlist);

ensureStrategyCards();
labelUpdateModes();
strategyList?.addEventListener("click", (event) => {
  const card = event.target.closest(".strategy-card[data-strategy]");
  if (!card || !strategyList.contains(card)) return;
  strategyPresetMode = "";
  const id = card.dataset.strategy;
  if (selectedStrategyIds.has(id)) {
    selectedStrategyIds.delete(id);
  } else {
    selectedStrategyIds.add(id);
  }
  renderStrategyScanner();
});

strategyModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    strategyMode = button.dataset.strategyMode;
    renderStrategyScanner();
  });
});

document.addEventListener("click", (event) => {
  const radarSide = event.target.closest("[data-radar-side]");
  if (radarSide) {
    realtimeRadarSide = radarSide.dataset.radarSide || "auto";
    renderRealtimeRadar();
    return;
  }
  const radarRefresh = event.target.closest("[data-radar-refresh]");
  if (!radarRefresh) return;
  realtimeRadarSide = "auto";
  renderRealtimeRadar();
});

document.addEventListener("click", (event) => {
  const sortButton = event.target.closest("[data-swing-sort]");
  if (!sortButton) return;
  const key = sortButton.dataset.swingSort;
  if (swingSortKey === key) {
    swingSortDir = swingSortDir === "desc" ? "asc" : "desc";
  } else {
    swingSortKey = key;
    swingSortDir = key === "code" ? "asc" : "desc";
  }
  swingPage = 1;
  renderStrategyScanner();
});

document.addEventListener("click", (event) => {
  const filterButton = event.target.closest("[data-swing-filter]");
  if (!filterButton) return;
  swingSignalFilter = filterButton.dataset.swingFilter || "all";
  swingPage = 1;
  renderStrategyScanner();
});

document.addEventListener("input", (event) => {
  const input = event.target.closest("[data-strategy-inline-search]");
  if (!input) return;
  strategyKeyword = input.value || "";
  openBuyPage = 1;
  swingPage = 1;
  strategy3Page = 1;
  strategy5Page = 1;
  renderStrategyScanner();
});

document.addEventListener("input", (event) => {
  const input = event.target.closest("[data-warrant-flow-search]");
  if (!input) return;
  warrantFlowKeyword = input.value || "";
  warrantFlowPage = 1;
  clearTimeout(warrantFlowSearchTimer);
  warrantFlowSearchTimer = setTimeout(renderWarrantFlow, 250);
});

document.addEventListener("click", (event) => {
  const pageButton = event.target.closest("[data-terminal-page]");
  if (!pageButton || pageButton.disabled) return;
  const scope = pageButton.dataset.terminalPageScope || "";
  const action = pageButton.dataset.terminalPage;
  const applyPage = (current) => action === "prev" ? current - 1 : action === "next" ? current + 1 : cleanNumber(action) || 1;
  if (scope === "openBuy") openBuyPage = applyPage(openBuyPage);
  if (scope === "swing") swingPage = applyPage(swingPage);
  if (scope === "strategy3") strategy3Page = applyPage(strategy3Page);
  if (scope === "strategy5") strategy5Page = applyPage(strategy5Page);
  if (scope === "warrant") warrantFlowPage = applyPage(warrantFlowPage);
  if (scope === "chip") chipTradePage = applyPage(chipTradePage);
  if (scope === "warrant") renderWarrantFlow();
  else if (scope === "chip") renderChipTradeTable();
  else renderStrategyScanner();
});

document.addEventListener("click", (event) => {
  const sortButton = event.target.closest("[data-intraday-sort]");
  if (!sortButton) return;
  const key = sortButton.dataset.intradaySort;
  if (intradaySortKey === key) {
    intradaySortDir = intradaySortDir === "desc" ? "asc" : "desc";
  } else {
    intradaySortKey = key;
    intradaySortDir = key === "code" ? "asc" : "desc";
  }
  renderStrategyScanner();
});

document.addEventListener("click", (event) => {
  const filterButton = event.target.closest("[data-intraday-filter]");
  if (!filterButton) return;
  intradaySignalFilter = filterButton.dataset.intradayFilter || "all";
  renderStrategyScanner();
});

document.addEventListener("click", (event) => {
  const filterButton = event.target.closest("[data-strategy5-filter]");
  if (!filterButton) return;
  strategy5ActiveId = filterButton.dataset.strategy5Filter || "foreign_trust_breakout";
  strategy5Page = 1;
  renderStrategyScanner();
});

document.addEventListener("click", (event) => {
  const refreshTarget = event.target.closest("[data-warrant-refresh]");
  if (!refreshTarget) return;
  loadWarrantFlow(true);
});

document.addEventListener("click", (event) => {
  const exportButton = event.target.closest("[data-export-action]");
  if (!exportButton) return;
  handleProtectedExport();
});

document.addEventListener("click", (event) => {
  const settingsButton = event.target.closest("[data-export-settings]");
  if (!settingsButton) return;
  openExportSettings();
});

strategyClear?.addEventListener("click", () => {
  selectedStrategyIds = new Set();
  strategyPresetMode = "";
  if (strategySearch) strategySearch.value = "";
  strategyKeyword = "";
  renderStrategyScanner();
});

strategySearch?.addEventListener("input", (event) => {
  strategyKeyword = event.target.value;
  openBuyPage = 1;
  swingPage = 1;
  strategy3Page = 1;
  strategy5Page = 1;
  renderStrategyScanner();
});

async function refreshSelectedWatchlistQuote() {
  if (isDocumentHidden()) return;
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
setInterval(refreshSelectedWatchlistQuote, 10000);
