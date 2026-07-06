(function () {
  if (
    window.__fumanDesktopFastShell === "20260627-route-switch-06"
    && window.__fumanDesktopFastShellApiOnlyPoll === "20260625-10"
    && window.__fumanOriginalDesktopMarket === "20260625-api-only"
  ) return;
  window.__fumanDesktopFastShell = "20260627-route-switch-06";
  window.__fumanDesktopFastShellApiOnlyPoll = "20260625-10";

  const NAV_SELECTOR = "[data-view]:not([data-member-tab])";
  const SNAPSHOT_DB = "fuman-desktop-route-snapshots";
  const SNAPSHOT_STORE = "snapshots";
  const SNAPSHOT_PREFIX = "FUMAN_DESKTOP_ROUTE_SNAPSHOT:";
  const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
  const SNAPSHOT_MAX_CHARS = 850000;
  const SNAPSHOT_ROUTES = ["strategy|策略1", "strategy|策略2", "strategy|策略3", "strategy|策略4", "strategy|策略5"];
  const API_ONLY_STRATEGY_ROUTES = ["strategy|策略1", "strategy|策略3", "strategy|策略4", "strategy|策略5"];
  const LIVE_API_STRATEGY_ROUTES = ["strategy|策略2"];
  const MARKET_ROUTE = "market|市場總覽";
  const REALTIME_RADAR_ROUTE = "realtime-radar|即時雷達";
  const CHIP_TRADE_ROUTE = "chip-trade|買賣超";
  const CB_DETECT_ROUTE = "cb-detect|CB可轉債";
  const FIXED_ROUTE_KEYS = [MARKET_ROUTE, REALTIME_RADAR_ROUTE, CHIP_TRADE_ROUTE, CB_DETECT_ROUTE, "warrant-flow|權證走向", "watchlist|自選股"];
  const FIXED_CANVAS_PERSIST_ROUTES = [CHIP_TRADE_ROUTE, CB_DETECT_ROUTE, "warrant-flow|權證走向"];
  const API_ONLY_FIXED_ROUTE_KEYS = [MARKET_ROUTE, REALTIME_RADAR_ROUTE, CHIP_TRADE_ROUTE, CB_DETECT_ROUTE];
  const CANVAS_REFRESH_TTL_MS = 18000;
  const API_ONLY_POLL_MS = 30000;
  const CHIP_TRADE_FIELD_CONTRACT_VERSION = "buy-sell-derived-fields-20260629-01";
  const PERF_LOG_KEY = "fuman-desktop-fast-perf-log-v1";
  const LAST_ROUTE_KEY = window.FUMAN_RUNTIME_CONFIG?.lastRouteKey || "fuman-terminal-last-route-v1";
  const STRATEGY2_SNAPSHOT_FIRST_PARAM = "strategy2SnapshotFirst";
  const DEFAULT_DESKTOP_ROUTE_KEY = "strategy|策略5";
  const CANVAS_ROW_HEIGHT = 46;
  const CANVAS_HEADER_HEIGHT = 128;
  const STRATEGY4_PAGE_SIZE = 10;
  const API_QUIET_PAINT_MS = 460;
  const HOVER_WARM_IDLE_MS = 780;
  const CLICK_WARM_IDLE_MS = 980;
  const CANVAS_ENDPOINTS = {
    "strategy|策略1": "/api/open-buy-latest",
    "strategy|策略2": "/api/strategy2-latest",
    "strategy|策略3": "/api/strategy3-latest",
    "strategy|策略4": "/api/strategy4-latest",
    "strategy|策略5": "/api/strategy5-latest",
    [MARKET_ROUTE]: "/api/market",
    "realtime-radar|即時雷達": "/api/realtime-radar-latest",
    "chip-trade|買賣超": "/api/institution-latest",
    "cb-detect|CB可轉債": "/api/cb-detect-latest",
    "warrant-flow|權證走向": "/api/warrant-flow-latest",
  };
  const CANVAS_ROUTE_OPTIONS = {
    [MARKET_ROUTE]: { limit: 24, ttl: 14000, live: true, today: true },
    "realtime-radar|即時雷達": { limit: 1200, ttl: 6500, live: true, today: true, full: true },
    "strategy|策略1": { limit: 60, ttl: 18000 },
    "strategy|策略2": { limit: 240, ttl: 6500, live: true, today: true },
    "strategy|策略3": { limit: 60, ttl: 22000 },
    "strategy|策略4": { limit: 70, ttl: 24000 },
    "strategy|策略5": { limit: 140, ttl: 22000 },
    "chip-trade|買賣超": { limit: 60, ttl: 32000 },
    "cb-detect|CB可轉債": { limit: 60, ttl: 32000 },
    "warrant-flow|權證走向": { limit: 60, ttl: 32000 },
  };
  const CHIP_TRADE_DEFAULT_FILTER = "foreignTrustVolumePct";
  const CHIP_TRADE_FILTERS = [
    { key: "foreignStreak", label: "外資連買日", endpoint: "/api/institution-latest" },
    { key: "trustStreak", label: "投信連買日", endpoint: "/api/institution-latest" },
    { key: "jointStreak", label: "同買日", endpoint: "/api/institution-latest" },
    { key: "foreignTrustVolumePct", label: "外資+投信佔5日均量", endpoint: "/api/institution-latest" },
    { key: "tdcc1000", label: "外資連3買 + 1000張連3週增", endpoint: "/api/institution-tdcc-breakout-latest" },
  ];
  const CANVAS_WORKER_URL = "/terminal-desktop-canvas-worker.js";
  let pendingTimer = 0;
  let snapshotTimer = 0;
  let snapshotDbPromise = null;
  let canvasFrame = 0;
  let canvasRowsVersion = 0;
  let canvasWorker = null;
  let canvasWorkerReady = false;
  let canvasWorkerFailed = false;
  let canvasWorkerMode = "main-canvas";
  let canvasWorkerRowsVersion = -1;
  let canvasWorkerRoute = "";
  let canvasWorkerAttachedCanvas = null;
  let canvasPreRenderTimer = 0;
  let lastRoute = "";
  let lastAt = 0;
  let fastClickRoute = "";
  let fastClickAt = 0;
  let fixedClickRoute = "";
  let fixedClickAt = 0;
  let activeSnapshotRoute = "";
  let lastInstantLink = null;
  let hoverPreRenderTimer = 0;
  let routeSwitchSeq = 0;
  let latencySeq = 0;
  const INTERACTION_HOLD_MS = 920;
  const routeSnapshots = new Map();
  const canvasStore = new Map();
  const canvasEmptyStates = new Map();
  const canvasInflight = new Map();
  const canvasRouteVersions = new Map();
  const canvasMetricsCache = new Map();
  const canvasPreRenderedRoutes = new Set();
  const fixedSnapshotTimers = new Map();
  const marketJsonCache = new Map();
  const marketJsonInflight = new Map();
  const MARKET_JSON_CACHE_TTL_MS = 18000;
  const MARKET_HEATMAP_FETCH_TIMEOUT_MS = 12000;
  const MARKET_RADAR_FETCH_TIMEOUT_MS = 12000;
  const MARKET_AI_LIVE_FETCH_TIMEOUT_MS = 18000;
  let marketAiRenderSignature = "";
  let marketAiRenderTimer = 0;
  let marketAiRenderRequest = null;
  let strategy2SnapshotFirstPrimePromise = null;
  let strategy2LivePrimePromise = null;
  let desktopFastBundleAt = 0;
  let desktopFastBundlePromise = null;
  let originalDesktopMarketPromise = null;
  let originalDesktopMarketDirectPromise = null;
  let originalDesktopMarketRetryTimer = 0;
  let marketApiOnlySignature = "";
  let marketApiOnlyLoading = false;
  let marketDesktopAiLoading = false;
  let marketDesktopMode = "overview";
  let marketSnapshotFirstPayload = null;
  let marketAiBundlePayload = null;
  let marketRadarBundlePayload = null;
  let marketHeatmapMode = "all";
  let marketHeatmapPayload = null;
  let marketHeatmapGroups = {};
  let marketHeatmapSectorRows = [];
  let realtimeRadarDomSide = "long";
  let realtimeRadarDomSideUserSelected = false;
  let realtimeRadarDomHealth = null;
  const canvasState = {
    route: "",
    source: "",
    meta: null,
    query: "",
    signalFilter: "",
    zoneFilter: "",
    offset: 0,
    hoverIndex: -1,
    selectedIndex: -1,
    rows: [],
    filtered: [],
  };

  installStyle();
  installDesktopThemeToggle();
  purgeApiOnlyStrategySnapshots();
  installCanvasThemeObserver();
  installRouteSnapshots();
  installFixedPageSnapshots();
  installCanvasHandlers();
  installActiveRouteGuard();
  installShowViewGuard();
  installInitialRouteRestore();
  installLatencyPanel();
  installAutoLatencySampler();
  installPerformanceLogExport();
  installPersistentFixedCanvases();
  installMarketApiOnlyHydrator();
  installMarketColdPayloadPrime();
  installStrategy2SnapshotFirstPrime();
  installStrategy2LivePrime();
  installDesktopFastBundlePrime();
  installApiOnlyCanvasPolling();
  primeCanvasWorker();
  installRouteFeedback();

  function routeKey(link) {
    return `${link?.dataset?.view || ""}|${(link?.textContent || "").replace(/\s+/g, " ").trim()}`;
  }

  function isPrimaryPointer(event) {
    return !event.button && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  }

  function beginInteractionHold(reason = "route", ms = INTERACTION_HOLD_MS) {
    const until = Date.now() + Math.max(180, ms);
    window.__fumanDesktopFastInteractionUntil = Math.max(Number(window.__fumanDesktopFastInteractionUntil || 0), until);
    window.__fumanDesktopFastInteractionReason = reason;
    document.documentElement.dataset.fumanDesktopInteractionHold = String(window.__fumanDesktopFastInteractionUntil);
    return until;
  }

  function interactionHoldRemaining() {
    return Math.max(0, Number(window.__fumanDesktopFastInteractionUntil || 0) - Date.now());
  }

  function isInteractionHoldActive() {
    return interactionHoldRemaining() > 0;
  }

  function runIdle(fn, delay = 0, timeout = 1400) {
    window.setTimeout(() => {
      if ("requestIdleCallback" in window) requestIdleCallback(fn, { timeout });
      else window.setTimeout(fn, 0);
    }, Math.max(0, delay));
  }

  function deferWarm(link, source, delay = 160) {
    const route = routeKey(link);
    runIdle(() => {
      if (route && route !== routeKey(link)) return;
      warm(link, source);
    }, delay, 1600);
  }

  function warm(link, source) {
    if (!link) return;
    if (document.hidden || isInteractionHoldActive()) {
      deferWarm(link, source, interactionHoldRemaining() + CLICK_WARM_IDLE_MS);
      return;
    }
    if (window.__fumanDesktopFastShell) {
      window.FUMAN_TERMINAL_PREFETCH_APP?.();
      window.FUMAN_HOTFIX_WARM_ROUTE?.(link, `desktop-fast-shell-${source}`);
      return;
    }
    window.FUMAN_TERMINAL_LOAD_APP?.(`desktop-fast-shell-${source}`);
    window.FUMAN_HOTFIX_WARM_ROUTE?.(link, `desktop-fast-shell-${source}`);
  }

  function isStrategyLink(link) {
    return link?.dataset?.view === "strategy";
  }

  function fixedRouteKey(link) {
    if (!link) return "";
    if (isStrategyLink(link)) return strategyRouteKey(link);
    const view = link?.dataset?.view || "";
    if (view === "market") return MARKET_ROUTE;
    if (view === "realtime-radar") return REALTIME_RADAR_ROUTE;
    if (view === "chip-trade") return "chip-trade|買賣超";
    if (view === "cb-detect") return "cb-detect|CB可轉債";
    if (view === "warrant-flow") return "warrant-flow|權證走向";
    if (view === "watchlist") return "watchlist|自選股";
    return "";
  }

  function viewFromRoute(route) {
    return String(route || "").split("|")[0] || "";
  }

  function panelForRoute(route) {
    const view = viewFromRoute(route);
    return view ? document.getElementById(`${view}-view`) : null;
  }

  function panelForLink(link) {
    return panelForRoute(fixedRouteKey(link));
  }

  function publishActiveRoute(link, key, source) {
    if (!key) return null;
    const [view = "", label = ""] = String(key).split("|");
    const seq = ++routeSwitchSeq;
    const route = {
      key,
      view,
      label,
      source: source || "route",
      seq,
      at: Date.now(),
      startedAt: typeof performance !== "undefined" ? performance.now() : Date.now(),
    };
    window.__fumanDesktopActiveRoute = route;
    document.documentElement.dataset.fumanDesktopActiveRoute = key;
    document.documentElement.dataset.fumanDesktopActiveRouteSeq = String(seq);
    if (key === REALTIME_RADAR_ROUTE) realtimeRadarDomSideUserSelected = false;
    try {
      window.dispatchEvent(new CustomEvent("fuman:desktop-route", { detail: route }));
    } catch (error) {}
    saveDesktopLastRoute(key);
    return route;
  }

  function savedStrategyRouteName(key) {
    if (key === "strategy|策略1") return "open_buy";
    if (key === "strategy|策略2") return "intraday_2m";
    if (key === "strategy|策略3") return "strategy3";
    if (key === "strategy|策略4") return "swing_radar";
    if (key === "strategy|策略5") return "strategy5";
    return "";
  }

  function saveDesktopLastRoute(key) {
    const [viewName = "market"] = String(key || "").split("|");
    if (!viewName) return;
    try {
      localStorage.setItem(LAST_ROUTE_KEY, JSON.stringify({
        viewName,
        strategyRoute: viewName === "strategy" ? savedStrategyRouteName(key) : "",
        at: Date.now(),
        source: "desktop-fast-shell",
      }));
    } catch (error) {}
  }

  function keyFromSavedLastRoute(route) {
    if (!route?.viewName) return "";
    if (Date.now() - cleanNumber(route.at) > 7 * 24 * 60 * 60 * 1000) return "";
    if (route.viewName === "strategy") {
      const strategy = String(route.strategyRoute || "");
      if (strategy === "open_buy") return "strategy|策略1";
      if (strategy === "intraday_2m") return "strategy|策略2";
      if (strategy === "strategy3") return "strategy|策略3";
      if (strategy === "swing_radar") return "strategy|策略4";
      if (strategy === "strategy5") return "strategy|策略5";
      return "";
    }
    if (route.viewName === "chip-trade") return "chip-trade|買賣超";
    if (route.viewName === "cb-detect") return "cb-detect|CB可轉債";
    if (route.viewName === "warrant-flow") return "warrant-flow|權證走向";
    if (route.viewName === "realtime-radar") return REALTIME_RADAR_ROUTE;
    if (route.viewName === "watchlist") return "watchlist|自選股";
    if (route.viewName === "market") return MARKET_ROUTE;
    return "";
  }

  function readSavedLastRouteKey() {
    try {
      return keyFromSavedLastRoute(JSON.parse(localStorage.getItem(LAST_ROUTE_KEY) || "null"));
    } catch (error) {
      return "";
    }
  }

  function linkForRouteKey(key) {
    return Array.from(document.querySelectorAll(NAV_SELECTOR)).find((link) => fixedRouteKey(link) === key) || null;
  }

  function shouldRestoreNonMarketRoute() {
    const active = window.__fumanDesktopActiveRoute;
    if (active?.key && !isMarketRoute(active.key)) return true;
    const key = readSavedLastRouteKey() || DEFAULT_DESKTOP_ROUTE_KEY;
    return !!key && !isMarketRoute(key);
  }

  function installInitialRouteRestore() {
    if (document.documentElement.dataset.fumanInitialRouteRestoreReady === "1") return;
    document.documentElement.dataset.fumanInitialRouteRestoreReady = "1";
    const run = () => {
      const key = readSavedLastRouteKey() || DEFAULT_DESKTOP_ROUTE_KEY;
      if (!key) return false;
      const link = linkForRouteKey(key);
      if (!link) return false;
      beginInteractionHold("initial-route-restore", 1400);
      if (isStrategyLink(link)) activateStrategyRoute(link, "initial-restore");
      else activateFixedPageRoute(link, "initial-restore");
      return true;
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
    else run();
  }

  function sameRoute(link, key) {
    if (!link || !key) return false;
    return fixedRouteKey(link) === key;
  }

  function isRouteCurrent(key, seq) {
    const active = window.__fumanDesktopActiveRoute;
    return !!active && active.key === key && active.seq === seq;
  }

  function startLatency(link, source) {
    const key = fixedRouteKey(link);
    if (!key || typeof performance === "undefined") return null;
    const sample = {
      id: ++latencySeq,
      key,
      source: source || "route",
      t0: performance.now(),
      marks: {},
    };
    window.__fumanDesktopRouteLatency = sample;
    return sample;
  }

  function markLatency(stage, key) {
    const sample = window.__fumanDesktopRouteLatency;
    if (!sample || sample.key !== key || typeof performance === "undefined") return;
    sample.marks[stage] = Math.round(performance.now() - sample.t0);
    const summary = `${sample.key} ${Object.entries(sample.marks).map(([name, value]) => `${name}:${value}ms`).join(" ")}`;
    document.documentElement.dataset.fumanDesktopLastLatency = summary;
    const rows = window.__fumanDesktopRouteLatencyHistory || [];
    rows.push({ key: sample.key, source: sample.source, ...sample.marks, at: Date.now() });
    window.__fumanDesktopRouteLatencyHistory = rows.slice(-25);
    if (stage === "api" || stage === "shell") {
      appendPerformanceLog(sample, stage);
      window.clearTimeout(sample.logTimer);
      sample.logTimer = window.setTimeout(() => {
        if (window.__fumanDesktopRouteLatency === sample) {
          console.debug?.("[FUMAN route latency]", summary);
        }
      }, stage === "api" ? 0 : 180);
    }
    updateLatencyPanel();
  }

  function appendPerformanceLog(sample, stage) {
    try {
      const previous = JSON.parse(localStorage.getItem(PERF_LOG_KEY) || "[]");
      const rows = Array.isArray(previous) ? previous : [];
      const latest = {
        id: sample.id,
        key: sample.key,
        source: sample.source,
        stage,
        nav: sample.marks.nav ?? null,
        shell: sample.marks.shell ?? null,
        api: sample.marks.api ?? null,
        at: Date.now(),
      };
      const next = rows.filter((row) => row?.id !== sample.id).concat(latest).slice(-50);
      localStorage.setItem(PERF_LOG_KEY, JSON.stringify(next));
      window.__fumanDesktopPerfLog = next;
      document.documentElement.dataset.fumanDesktopPerfLogSize = String(next.length);
    } catch (error) {}
  }

  function installPerformanceLogExport() {
    window.FUMAN_DESKTOP_PERF_LOG = {
      key: PERF_LOG_KEY,
      read() {
        try {
          return JSON.parse(localStorage.getItem(PERF_LOG_KEY) || "[]");
        } catch (error) {
          return [];
        }
      },
      clear() {
        try {
          localStorage.removeItem(PERF_LOG_KEY);
          window.__fumanDesktopPerfLog = [];
        } catch (error) {}
      },
      summary() {
        const rows = this.read();
        const maxOf = (name) => Math.max(0, ...rows.map((row) => Number(row?.[name] || 0)));
        const maxNav = maxOf("nav");
        const maxShell = maxOf("shell");
        const maxApi = maxOf("api");
        const focus = maxApi >= maxNav && maxApi >= maxShell ? "api" : maxShell >= maxNav ? "shell" : "nav";
        return {
          count: rows.length,
          maxNav,
          maxShell,
          maxApi,
          focus,
          slowest: rows.slice().sort((a, b) => Math.max(Number(b.nav || 0), Number(b.shell || 0), Number(b.api || 0)) - Math.max(Number(a.nav || 0), Number(a.shell || 0), Number(a.api || 0))).slice(0, 8),
        };
      },
      recommend() {
        const summary = this.summary();
        if (!summary.count) return "尚無資料：開 codexLatency 後切幾次分頁再看。";
        if (summary.focus === "api") return "api 高：優先檢查 API 小包、快取 TTL、Supabase 查詢量。";
        if (summary.focus === "shell") return "shell 高：優先檢查 Canvas 首畫、固定尺寸、DOM 抽 row。";
        return "nav 高：優先檢查側欄事件、active CSS、重複 click/pointer handler。";
      },
    };
  }

  function latencyPanelEnabled() {
    try {
      return /(?:\?|&)codexLatency=1\b/.test(location.search) || localStorage.getItem("fumanCodexLatencyPanel") === "1";
    } catch (error) {
      return false;
    }
  }

  function autoLatencyEnabled() {
    try {
      return /(?:\?|&)codexLatencyAuto=1\b/.test(location.search) || localStorage.getItem("fumanCodexLatencyAuto") === "1";
    } catch (error) {
      return false;
    }
  }

  function installLatencyPanel() {
    if (document.documentElement.dataset.fumanLatencyPanelReady === "1") return;
    document.documentElement.dataset.fumanLatencyPanelReady = "1";
    try {
      localStorage.removeItem("fumanDesktopLatencyPanel");
      localStorage.removeItem("fumanDesktopLatencyAuto");
    } catch (error) {}
    document.addEventListener("keydown", (event) => {
      if (!event.ctrlKey || !event.altKey || event.key.toLowerCase() !== "l") return;
      try {
        const next = localStorage.getItem("fumanCodexLatencyPanel") === "1" ? "0" : "1";
        localStorage.setItem("fumanCodexLatencyPanel", next);
      } catch (error) {}
      updateLatencyPanel(true);
    });
    updateLatencyPanel();
  }

  function updateLatencyPanel(force = false) {
    if (!force && !latencyPanelEnabled()) return;
    let panel = document.querySelector("#fuman-desktop-latency-panel");
    if (!latencyPanelEnabled()) {
      panel?.remove();
      return;
    }
    if (!panel) {
      panel = document.createElement("aside");
      panel.id = "fuman-desktop-latency-panel";
      panel.className = "fuman-desktop-latency-panel";
      document.body.appendChild(panel);
    }
    const rows = (window.__fumanDesktopRouteLatencyHistory || []).slice(-10).reverse();
    const auto = window.__fumanDesktopAutoLatencyReport || null;
    const autoSummary = auto?.summary ? `
      <section>
        <strong>Auto check</strong>
        <div><span>max</span><b>nav ${escapeHtml(auto.summary.maxNav)} / shell ${escapeHtml(auto.summary.maxShell)} / api ${escapeHtml(auto.summary.maxApi)}ms</b></div>
        <div><span>focus</span><b>${escapeHtml(auto.summary.focus || "--")}</b></div>
      </section>
    ` : "";
    panel.innerHTML = `
      <strong>Route latency</strong>
      ${autoSummary}
      ${rows.length ? rows.map((row) => `
        <div>
          <span>${escapeHtml(String(row.key || "").replace("strategy|", ""))}</span>
          <b>nav ${escapeHtml(row.nav ?? "--")} / shell ${escapeHtml(row.shell ?? "--")} / api ${escapeHtml(row.api ?? "--")}ms</b>
        </div>
      `).join("") : "<em>Codex latency only：Ctrl+Alt+L 開關，切頁後顯示最近 10 次</em>"}
    `;
  }

  function installAutoLatencySampler() {
    if (!autoLatencyEnabled() || document.documentElement.dataset.fumanAutoLatencyReady === "1") return;
    document.documentElement.dataset.fumanAutoLatencyReady = "1";
    const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const samples = [];
    const routes = [
      "market|市場總覽",
      "strategy|策略1",
      "strategy|策略2",
      "strategy|策略3",
      "strategy|策略4",
      "strategy|策略5",
      "chip-trade|買賣超",
      "cb-detect|CB可轉債",
      "warrant-flow|權證走向",
      "watchlist|自選股",
    ];
    const linkForRoute = (route) => Array.from(document.querySelectorAll(NAV_SELECTOR))
      .find((link) => fixedRouteKey(link) === route);
    const latestForRoute = (route) => (window.__fumanDesktopRouteLatencyHistory || [])
      .slice()
      .reverse()
      .find((row) => row.key === route);
    const numberOrZero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    const run = async () => {
      await sleep(900);
      for (const route of routes) {
        const link = linkForRoute(route);
        if (!link) continue;
        try {
          if (isStrategyLink(link)) activateStrategyRoute(link, "auto-latency");
          else activateFixedPageRoute(link, "auto-latency");
          await sleep(760);
          const row = latestForRoute(route) || {};
          samples.push({
            key: route,
            nav: row.nav ?? null,
            shell: row.shell ?? null,
            api: row.api ?? null,
          });
          window.__fumanDesktopAutoLatencyReport = buildAutoLatencyReport(samples);
          updateLatencyPanel(true);
        } catch (error) {
          samples.push({ key: route, error: error?.message || String(error) });
        }
      }
      const report = buildAutoLatencyReport(samples);
      window.__fumanDesktopAutoLatencyReport = report;
      document.documentElement.dataset.fumanDesktopAutoLatencyReport = JSON.stringify(report.summary || {}).slice(0, 800);
      console.table?.(report.rows || samples);
      console.info?.("[FUMAN auto latency]", report.summary);
      updateLatencyPanel(true);
    };
    const buildAutoLatencyReport = (rows) => {
      const maxNav = Math.max(0, ...rows.map((row) => numberOrZero(row.nav)));
      const maxShell = Math.max(0, ...rows.map((row) => numberOrZero(row.shell)));
      const maxApi = Math.max(0, ...rows.map((row) => numberOrZero(row.api)));
      const focus = maxApi >= maxNav && maxApi >= maxShell
        ? "api"
        : maxShell >= maxNav
          ? "shell"
          : "nav";
      return {
        rows: rows.slice(),
        summary: { maxNav, maxShell, maxApi, focus, at: Date.now() },
      };
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
    else run();
  }

  function installActiveRouteGuard() {
    window.FUMAN_DESKTOP_ROUTE_STATE = {
      version: "20260623-09",
      active: () => window.__fumanDesktopActiveRoute || null,
      isCurrent: (key, seq) => isRouteCurrent(key, seq),
      shouldBlockView(viewName, activeLink = null) {
        const active = window.__fumanDesktopActiveRoute;
        if (!active || Date.now() - Number(active.at || 0) > 2600) return false;
        if (viewName && active.view && viewName !== active.view) return true;
        if (active.view === "strategy" && activeLink && !sameRoute(activeLink, active.key)) return true;
        return false;
      },
      mark: markLatency,
    };
  }

  function markFastEvent(event) {
    try {
      Object.defineProperty(event, "__fumanDesktopFastRouteHandled", { value: true });
    } catch (error) {
      event.__fumanDesktopFastRouteHandled = true;
    }
  }

  function markInstantActive(link) {
    if (!link) return;
    const key = fixedRouteKey(link);
    if (key) document.documentElement.dataset.fumanPointerRoute = key;
    if (lastInstantLink && lastInstantLink !== link) lastInstantLink.classList.remove("fuman-instant-active");
    lastInstantLink = link;
    link.classList.add("fuman-instant-active");
    window.clearTimeout(link.__fumanInstantTimer);
    link.__fumanInstantTimer = window.setTimeout(() => {
      link.classList.remove("fuman-instant-active");
      if (lastInstantLink === link) lastInstantLink = null;
    }, 760);
  }

  function quietPaintRemaining(route) {
    const active = window.__fumanDesktopActiveRoute;
    if (!active || active.key !== route || typeof performance === "undefined") return 0;
    const elapsed = performance.now() - Number(active.startedAt || 0);
    return Math.max(0, API_QUIET_PAINT_MS - elapsed, interactionHoldRemaining() > 0 ? 120 : 0);
  }

  function scheduleRoutePaint(route, seq, paint, stage = "api") {
    const delay = quietPaintRemaining(route);
    const run = () => {
      if (!isRouteCurrent(route, seq) || activeSnapshotRoute !== route || canvasState.route !== route) return;
      requestAnimationFrame(() => {
        if (!isRouteCurrent(route, seq) || activeSnapshotRoute !== route || canvasState.route !== route) return;
        paint();
        markLatency(stage, route);
        updateLatencyPanel();
      });
    };
    if (delay > 0) window.setTimeout(run, delay);
    else run();
  }

  function strategyRouteKey(link) {
    const text = (typeof link === "string" ? link : link?.textContent || "").replace(/\s+/g, " ").trim();
    if (typeof link !== "string" && !isStrategyLink(link)) return "";
    if (text.includes("策略1")) return "strategy|策略1";
    if (text.includes("策略2")) return "strategy|策略2";
    if (text.includes("策略3")) return "strategy|策略3";
    if (text.includes("策略4")) return "strategy|策略4";
    if (text.includes("策略5")) return "strategy|策略5";
    return "strategy|unknown";
  }

  function strategyMeta(linkOrKey) {
    const view = typeof linkOrKey === "string"
      ? viewFromRoute(linkOrKey)
      : linkOrKey?.dataset?.view || "";
    if (view === "market") {
      return {
        icon: "●",
        title: "市場總覽",
        badge: "FMN://market.fast-shell",
        summary: "加權、櫃買、台指與強勢排行固定殼先顯示，市場資料背景同步。",
      };
    }
    if (view === "realtime-radar") {
      return {
        icon: "◎",
        title: "即時雷達",
        badge: "FMN://radar.live-api",
        summary: "今日即時雷達走 live API，資料由正式 endpoint 直接更新。",
      };
    }
    if (view === "chip-trade") {
      return {
        icon: "◆",
        title: "買賣超",
        badge: "FMN://chip-trade.fast-shell",
        summary: "外資、投信與法人買賣超資料以快照先開，完整表格背景更新。",
      };
    }
    if (view === "cb-detect") {
      return {
        icon: "◇",
        title: "CB可轉債",
        badge: "FMN://cb.fast-shell",
        summary: "CB 偵測結果固定殼先顯示，最新快照背景同步。",
      };
    }
    if (view === "warrant-flow") {
      return {
        icon: "◒",
        title: "權證走向",
        badge: "FMN://warrant.fast-shell",
        summary: "權證流向、量能與標的方向先開快照，完整資料背景更新。",
      };
    }
    if (view === "watchlist") {
      return {
        icon: "☆",
        title: "自選股",
        badge: "FMN://watchlist.fast-shell",
        summary: "新版自選股分析已開通，新增、個股分析、技術與籌碼狀態由同一個 rich shell 顯示。",
      };
    }
    const text = typeof linkOrKey === "string"
      ? linkOrKey
      : (linkOrKey?.textContent || "").replace(/\s+/g, " ").trim();
    if (text.includes("策略1")) {
      return {
        icon: "⚡",
        title: "策略1-明日開盤入",
        badge: "FMN://strategy.open-buy",
        summary: "21:30 初篩符合 + 08:45 個股期貨確認；08:55 搓合完美符合才列 BUY。",
      };
    }
    if (text.includes("策略2")) {
      return {
        icon: "◔",
        title: "策略2-戰鬥模式",
        badge: "FMN://strategy.intraday",
        summary: "當沖即時偵測，顯示今日所有戰鬥訊號；不進冷快照，資料走 live API。",
      };
    }
    if (text.includes("策略3")) {
      return {
        icon: "◐",
        title: "策略3-隔日沖",
        badge: "FMN://strategy.overnight",
        summary: "盤後籌碼與量價候選，先顯示快照，再同步最新資料。",
      };
    }
    if (text.includes("策略4")) {
      return {
        icon: "└",
        title: "策略4-波段",
        badge: "FMN://strategy.swing",
        summary: "波段區間、三角收斂起漲與訊號分層，切頁不等待資料整理完成。",
      };
    }
    if (text.includes("策略5")) {
      return {
        icon: "▰",
        title: "策略5-綜合策略",
        badge: "FMN://strategy.composite",
        summary: "策略5 多分頁結果，固定殼先顯示，完整內容背景補齊。",
      };
    }
    return {
      icon: "◆",
      title: "策略模組",
      badge: "FMN://strategy.api",
      summary: "正在切換策略畫面。",
    };
  }

  function compactText(value, limit = 96) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  }

  function extractLiteRows(panel) {
    if (!panel) return [];
    const selectors = [
      ".stock-table tr",
      ".stock-table [data-stock-code]",
      ".stock-card",
      ".metric-card",
      ".chip-table tbody tr",
      ".cb-detect-list > *",
      ".warrant-flow-card",
      ".warrant-flow-list > *",
      ".watchlist-stock-list > *",
      ".watchlist-card",
      ".strategy5-stock-card",
      ".swing-card",
      ".terminal-table tbody tr",
      ".strategy-table tbody tr",
      ".strategy-table tr",
      "[data-stock-code]",
      "article",
    ];
    const seen = new Set();
    const rows = [];
    for (const selector of selectors) {
      panel.querySelectorAll(selector).forEach((node) => {
        if (rows.length >= 90 || seen.has(node)) return;
        if (node.closest?.(".desktop-route-shell")) return;
        seen.add(node);
        const text = compactText(node.textContent, 120);
        if (!text || /正在|loading|背景更新|切換狀態|資料狀態|手感模式/i.test(text)) return;
        const code = node.dataset?.stockCode || text.match(/\b\d{4}\b/)?.[0] || "";
        if (!code && text.length < 8) return;
        const pct = text.match(/[+-]?\d+(?:\.\d+)?%/)?.[0] || "";
        const score = text.match(/(?:分數|score|命中|訊號)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)/i)?.[1] || "";
        const title = code ? compactText(text.replace(code, "").trim(), 54) : compactText(text, 54);
        rows.push({
          rank: rows.length + 1,
          code,
          title: title || code || `訊號 ${rows.length + 1}`,
          pct,
          score,
          line: text,
        });
      });
      if (rows.length >= 12) break;
    }
    return rows.slice(0, 90);
  }

  function cleanNumber(value) {
    const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
    return Number.isFinite(number) ? number : 0;
  }

  function normalizeArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    if (typeof value === "object") return Object.values(value);
    return [];
  }

  function pickFirstValue(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== "");
  }

  function formatCompactNumber(value, digits = 0) {
    const number = cleanNumber(value);
    if (!number) return "";
    return number.toLocaleString("zh-TW", {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    });
  }

  function formatPriceValue(value) {
    const number = cleanNumber(value);
    if (!number) return "";
    return number.toLocaleString("zh-TW", {
      minimumFractionDigits: number >= 100 ? 1 : 2,
      maximumFractionDigits: number >= 100 ? 1 : 2,
    });
  }

  function formatPercentValue(value) {
    if (value === "" || value == null) return "";
    const number = cleanNumber(value);
    if (!Number.isFinite(number)) return "";
    const sign = number > 0 ? "+" : "";
    return `${sign}${number.toFixed(2)}%`;
  }

  function formatRatioValue(value) {
    const number = cleanNumber(value);
    if (!number) return "";
    return `${number.toFixed(1)}x`;
  }

  function formatTradeValue(value) {
    const number = cleanNumber(value);
    if (!number) return "";
    if (number >= 100000000) return `${(number / 100000000).toFixed(2)}億`;
    if (number >= 10000) return `${Math.round(number / 10000).toLocaleString("zh-TW")}萬`;
    return number.toLocaleString("zh-TW");
  }

  const STRATEGY4_SIGNAL_LABELS = {
    bull_attack: "攻擊",
    n_base: "N字",
    buy_neckline: "買1",
    buy_pullback_break: "買2",
    saucer: "圓弧",
    triangle_breakout: "三角收斂起漲",
    breakaway_gap: "突破缺口",
    runaway_gap: "逃逸缺口",
    v_fast: "V快殺",
    v_reversal: "V轉",
    v_reversal_runaway: "V轉逃逸",
    deep_fall_fib: "深跌FIB",
    three_inside: "三內翻紅",
    golden_cross: "金釵",
    wallet_strong_buy: "主力多",
    wallet_volume_cross: "量叉",
  };
  const STRATEGY4_SIGNAL_FILTER_ORDER = [
    "bull_attack",
    "n_base",
    "triangle_breakout",
    "saucer",
    "three_inside",
    "golden_cross",
    "buy_neckline",
    "buy_pullback_break",
    "deep_fall_fib",
    "v_fast",
    "v_reversal",
    "v_reversal_runaway",
    "breakaway_gap",
    "runaway_gap",
    "wallet_strong_buy",
    "wallet_volume_cross",
  ];

  function strategy4SignalLabel(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
    return STRATEGY4_SIGNAL_LABELS[key] || STRATEGY4_SIGNAL_LABELS[raw] || "";
  }

  function strategyNameLabel(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
    const defs = window.FUMAN_STRATEGY_CONFIG?.STRATEGY_BY_ID || {};
    const match = defs[key] || defs[raw];
    return match?.label || match?.short || strategy4SignalLabel(raw) || "";
  }

  function normalizeSignalRows(value, route = "") {
    const translateStrategy4 = isStrategy4Route(route);
    return (Array.isArray(value) ? value : [])
      .map((signal) => {
        if (!signal || typeof signal !== "object") return null;
        const rawId = signal.id || signal.key || signal.type || signal.name || signal.label || "";
        const rawLabel = signal.label || signal.short || signal.title || signal.name || signal.id || signal.key || "";
        const rawReason = signal.reason || signal.message || signal.note || "";
        const id = compactText(rawId, 48);
        const label = compactText((translateStrategy4 && (strategy4SignalLabel(rawId) || strategy4SignalLabel(rawLabel))) || rawLabel || rawId, 40);
        const reason = compactText((translateStrategy4 && strategy4SignalLabel(rawReason)) || rawReason, 96);
        if (!id && !label && !reason) return null;
        return { id, label: label || id || reason, reason };
      })
      .filter(Boolean);
  }

  function signalSummary(signals) {
    return compactText((Array.isArray(signals) ? signals : [])
      .map((signal) => signal.label || signal.id || signal.reason)
      .filter(Boolean)
      .join(" / "), 120);
  }

  function isStrategy4Route(route) {
    return String(route || "") === "strategy|策略4";
  }

  function isStrategy2Route(route) {
    return String(route || "") === "strategy|策略2";
  }

  function isStrategy5Route(route) {
    return String(route || "") === "strategy|策略5";
  }

  function isStrategy3Route(route) {
    return String(route || "") === "strategy|策略3";
  }

  function isMarketRoute(route) {
    return String(route || "") === MARKET_ROUTE;
  }

  function isRealtimeRadarRoute(route) {
    return String(route || "") === REALTIME_RADAR_ROUTE;
  }

  function isMarketViewActive() {
    const panel = document.querySelector("#market-view");
    return Boolean(panel?.classList?.contains("active") && !panel.hidden);
  }

  function isWideStrategyTableRoute(route) {
    return isStrategy3Route(route) || isStrategy4Route(route) || isStrategy5Route(route);
  }

  function canvasPageSizeForRoute(route = canvasState.route) {
    return isWideStrategyTableRoute(route) ? STRATEGY4_PAGE_SIZE : 0;
  }

  function canvasRowHeightForRoute(route = canvasState.route) {
    return isWideStrategyTableRoute(route) ? 94 : CANVAS_ROW_HEIGHT;
  }

  function canvasHeaderHeightForRoute(route = canvasState.route) {
    return isWideStrategyTableRoute(route) ? 128 : CANVAS_HEADER_HEIGHT;
  }

  function isLiveStrategyRoute(route) {
    return LIVE_API_STRATEGY_ROUTES.includes(String(route || ""));
  }

  function strategy2SnapshotFirstEnabled() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      if (/^(1|true|yes)$/i.test(params.get(STRATEGY2_SNAPSHOT_FIRST_PARAM) || "")) return true;
      if (/^(1|true|yes)$/i.test(sessionStorage.getItem("fuman-strategy2-snapshot-first") || "")) return true;
    } catch (error) {}
    return window.FUMAN_RUNTIME_CONFIG?.strategy2SnapshotFirst === true;
  }

  function endpointForRoute(route) {
    if (isChipTradeRoute(route)) {
      const active = CHIP_TRADE_FILTERS.find((item) => item.key === canvasState.signalFilter);
      return active?.endpoint || CANVAS_ENDPOINTS[route] || "";
    }
    return CANVAS_ENDPOINTS[route] || "";
  }

  function isStrategyRoute(route) {
    return String(route || "").startsWith("strategy|");
  }

  function isChipTradeRoute(route) {
    return route === CHIP_TRADE_ROUTE;
  }

  function isApiBackedSnapshotItem(item) {
    return Boolean(item?.rows?.length) && !item.html;
  }

  function isDomDerivedSource(source) {
    return /dom|html|indexeddb|session/i.test(String(source || ""));
  }

  function isApiOnlyPollingRoute(route) {
    const key = String(route || "");
    return API_ONLY_STRATEGY_ROUTES.includes(key) || LIVE_API_STRATEGY_ROUTES.includes(key);
  }

  function isApiOnlySnapshotRoute(route) {
    const key = String(route || "");
    return isApiOnlyPollingRoute(key) || API_ONLY_FIXED_ROUTE_KEYS.includes(key);
  }

  function rowSignature(rows = []) {
    return (Array.isArray(rows) ? rows : [])
      .map((row) => [
        row.code || "",
        row.title || "",
        row.subStrategy || "",
        row.score || "",
        row.pct || "",
        row.price || "",
        row.volume || "",
        row.volumeRatio || "",
        row.tradeValue || "",
        row.legal5d || "",
        row.swingZone || "",
        row.aiStatus || "",
        row.triggerReason || "",
        row.reason || "",
      ].join(":"))
      .join("|");
  }

  function currentRowsSignature(route) {
    return rowSignature(canvasStore.get(route)?.rows || canvasState.rows || []);
  }

  function purgeApiOnlyStrategySnapshots() {
    const keys = [...API_ONLY_STRATEGY_ROUTES, ...API_ONLY_FIXED_ROUTE_KEYS];
    keys.forEach((key) => {
      try { sessionStorage.removeItem(SNAPSHOT_PREFIX + key); } catch (error) {}
      routeSnapshots.delete(key);
      canvasStore.delete(key);
      canvasRouteVersions.delete(key);
    });
    if (!("indexedDB" in window)) return;
    openSnapshotDb().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction(SNAPSHOT_STORE, "readwrite");
        keys.forEach((key) => tx.objectStore(SNAPSHOT_STORE).delete(key));
      } catch (error) {}
    }).catch(() => undefined);
  }

  function canvasOptionsForRoute(route) {
    return CANVAS_ROUTE_OPTIONS[route] || { limit: 60, ttl: CANVAS_REFRESH_TTL_MS };
  }

  function compactCanvasUrlForRoute(route, withBust = false) {
    const endpoint = endpointForRoute(route);
    if (!endpoint) return "";
    const options = canvasOptionsForRoute(route);
    const minLimit = isStrategy4Route(route) ? 10 : 20;
    const strategy2SnapshotFirst = isStrategy2Route(route) && strategy2SnapshotFirstEnabled() && !withBust;
    const maxLimit = isRealtimeRadarRoute(route) ? 1200 : isLiveStrategyRoute(route) ? 240 : isStrategy5Route(route) ? 140 : 120;
    const query = new URLSearchParams({
      canvas: "1",
      compact: "1",
      shell: "1",
      limit: String(Math.max(minLimit, Math.min(maxLimit, options.limit || 60))),
    });
    if (options.full || isRealtimeRadarRoute(route)) query.set("full", "1");
    if (strategy2SnapshotFirst) query.set("snapshot", "1");
    else if (options.live) query.set("live", "1");
    if (options.today) query.set("today", "1");
    if (isChipTradeRoute(route)) query.set("fieldContract", CHIP_TRADE_FIELD_CONTRACT_VERSION);
    if (isChipTradeRoute(route) && canvasState.signalFilter) query.set("mode", canvasState.signalFilter);
    if (withBust) query.set("t", String(Date.now()));
    return `${endpoint}${endpoint.includes("?") ? "&" : "?"}${query.toString()}`;
  }

  function routeForCompactEndpoint(endpoint) {
    if (!endpoint) return "";
    let pathname = "";
    try {
      pathname = new URL(endpoint, window.location.origin).pathname;
    } catch (error) {
      pathname = String(endpoint).split("?")[0];
    }
    if (pathname === "/api/institution-tdcc-breakout-latest") return CHIP_TRADE_ROUTE;
    return Object.keys(CANVAS_ENDPOINTS).find((route) => CANVAS_ENDPOINTS[route] === pathname) || "";
  }

  function flattenApiArrays(payload, depth = 0, out = []) {
    if (!payload || depth > 3 || out.length > 12) return out;
    if (Array.isArray(payload)) {
      if (payload.some((item) => item && typeof item === "object")) out.push(payload);
      return out;
    }
    if (typeof payload !== "object") return out;
    ["matches", "events", "records", "rows", "signals", "items", "results", "stocks", "data"].forEach((key) => {
      const value = payload[key];
      if (Array.isArray(value) && value.some((item) => item && typeof item === "object")) out.push(value);
    });
    const values = Object.values(payload);
    if (values.length >= 3 && values.some((item) => item && typeof item === "object" && !Array.isArray(item))) {
      const objectRows = values.filter((item) => item && typeof item === "object" && !Array.isArray(item));
      if (objectRows.some((item) => item.code || item.Code || item.name || item.Name || item.stockNo || item.stock_id || item.payload)) out.push(objectRows);
    }
    Object.keys(payload).slice(0, 18).forEach((key) => {
      const value = payload[key];
      if (value && typeof value === "object" && !Array.isArray(value)) flattenApiArrays(value, depth + 1, out);
    });
    return out;
  }

  function normalizeCanvasRow(row, index, route = "") {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    const active = row?.activeMatch || payload.activeMatch || (Array.isArray(row?.matches) ? row.matches[0] : null) || (Array.isArray(payload.matches) ? payload.matches[0] : null) || {};
    const merged = { ...payload, ...row };
    const rawCode = merged.code || merged.Code || merged.stockNo || merged.StockNo || merged.stock_no || merged.symbol || merged.Symbol || merged.ticker || merged.stockId || merged.stock_id || "";
    const code = String(rawCode).match(/\d{4}/)?.[0] || String(rawCode || "").trim();
    const name = String(merged.name || merged.Name || merged.stockName || merged.StockName || merged.stock_name || merged.companyName || merged.company_name || code || "").trim();
    const pct = merged.percent ?? merged.Percent ?? merged.changePct ?? merged.changePercent ?? merged.ChangePercent ?? merged.change_percent ?? merged.change ?? merged.Change ?? merged.pct ?? "";
    const score = merged.score ?? merged.Score ?? merged.rankScore ?? merged.RankScore ?? merged.swingScore ?? active.score ?? merged.signalScore ?? "";
    const reason = String(merged.reason || active.reason || merged.message || merged.note || "").trim();
    const state = String(merged.state || merged.status || active.name || active.id || "").trim();
    const stateId = String(merged.stateId || merged.state_id || merged.statusId || merged.status_id || active.id || active.key || "").trim();
    const intent = String(merged.intent || merged.liveIntent || merged.entryIntent || merged.entry_intent || "").trim();
    const time = merged.time || merged.Time || merged.timestamp || merged.entryAt || merged.entry_at || merged.firstAAt || merged.first_a_at || merged.latestAAt || merged.latest_a_at || merged.firstBAt || merged.first_b_at || merged.latestBAt || merged.latest_b_at || merged.latestSeenAt || merged.latest_seen_at || merged.detectedAt || merged.detected_at || merged.seenAt || merged.seen_at || merged.quoteTime || merged.quote_time || merged.createdAt || merged.created_at || "";
    const price = merged.price ?? merged.Price ?? merged.close ?? merged.Close ?? merged.ClosingPrice ?? merged.lastPrice ?? merged.LastPrice ?? merged.entryPrice ?? "";
    const entryPrice = pickFirstValue(merged.entryPrice, merged.entry_price, merged.latestAPrice, merged.latest_a_price, merged.firstAPrice, merged.first_a_price, price);
    const volume = merged.volume ?? merged.Volume ?? merged.tradeVolume ?? merged.TradeVolume ?? merged.volumeLots ?? merged.trade_volume ?? "";
    const volumeLots = pickFirstValue(merged.volumeLots, merged.VolumeLots, merged.volume_lots, cleanNumber(volume) > 100000 ? cleanNumber(volume) / 1000 : "");
    const volumeRatio = pickFirstValue(merged.projectedRatio, merged.volumeRatio, merged.VolumeRatio, merged.projected_ratio, merged.estimatedVolumeRatio, merged.estimated_volume_ratio);
    const tradeValue = pickFirstValue(merged.tradeValue, merged.value, merged.TradeValue, merged.trade_value, merged.amount, merged.turnover);
    const legal5d = pickFirstValue(merged.legal5d, merged.legal5D, merged.institutional5d, merged.institutional5D, merged.foreign5d, merged.foreign5D, merged.foreign5dNet, merged.foreign_5d_net, merged.chip5d);
    const swingZone = compactText(merged.swingZone || merged.zone || merged.swing_zone || payload.swingZone || payload.zone || active.swingZone || "", 2).toUpperCase();
    const swingZoneLabel = compactText(merged.swingZoneLabel || merged.zoneLabel || merged.zone_label || payload.swingZoneLabel || payload.zoneLabel || active.swingZoneLabel || (swingZone ? `${swingZone}區` : ""), 16);
    const signals = normalizeSignalRows(merged.signals || merged.matches || merged.swingSignals || payload.signals || payload.matches || active.signals, route);
    const strategy4Triangle = isStrategy4Route(route) && merged.triangleBreakout && typeof merged.triangleBreakout === "object"
      ? merged.triangleBreakout
      : null;
    const strategy4TriangleLabel = strategy4Triangle ? compactText(strategy4Triangle.label || STRATEGY4_SIGNAL_LABELS.triangle_breakout || "三角收斂起漲", 28) : "";
    const strategy4TriangleReason = strategy4Triangle ? compactText(strategy4Triangle.reason || "", 96) : "";
    const rawTags = [
      ...normalizeArray(merged.tags),
      ...normalizeArray(merged.signalTags),
      ...normalizeArray(merged.signal_tags),
    ].map((tag) => compactText(String(tag || "").trim(), 24)).filter(Boolean);
    const uniqueTags = [...new Set(rawTags)];
    const primarySignal = signals[0] || null;
    const rawSubStrategy = merged.subStrategy || merged.strategyLabel || merged.signalLabel || merged.setupName || merged.setup_type || active.short || active.label || active.name || primarySignal?.label || "";
    const subStrategy = compactText(
      strategyNameLabel(rawSubStrategy) || (isStrategy4Route(route) && strategy4SignalLabel(rawSubStrategy)) || rawSubStrategy,
      42
    );
    const subStrategyId = compactText(
      merged.subStrategyId || merged.strategyId || merged.signalId || merged.setupId || active.id || active.key || active.type || primarySignal?.id || subStrategy,
      48
    );
    const signalLine = signalSummary(signals);
    const strategyDisplay = compactText(
      strategyNameLabel(subStrategyId) || strategyNameLabel(rawSubStrategy) || subStrategy || signalLine,
      64
    );
    const strategy4MatchedLabels = isStrategy4Route(route)
      ? [...signals.map((signal) => signal.label || signal.id || ""), strategy4TriangleLabel].filter(Boolean).join("、")
      : "";
    const strategy4MatchedReasons = isStrategy4Route(route)
      ? [...signals.map((signal) => signal.reason), strategy4TriangleReason].filter(Boolean).join("；")
      : "";
    const aiStatus = compactText(merged.aiStatus || merged.ai_status || merged.overnightState || state || (cleanNumber(score) ? "通過" : ""), 16);
    const aiSummary = compactText(
      strategy4MatchedLabels || merged.aiSummary || merged.ai_analysis || merged.analysis || merged.summary || reason || signalLine || "",
      180
    );
    const triggerReason = compactText(
      strategy4MatchedReasons || merged.triggerReason || merged.trigger_reason || merged.tvOvernightEntry?.reason || reason || signalLine || "",
      160
    );
    const triggerTags = isStrategy4Route(route)
      ? [...signals.map((signal) => signal.label || signal.id || ""), strategy4TriangleLabel].filter(Boolean).slice(0, 4)
      : [
        cleanNumber(volumeRatio) ? "量能啟動" : "",
        cleanNumber(tradeValue) ? "高成交額" : "",
        cleanNumber(price) > 0 ? "流動性足" : "",
      ].filter(Boolean).slice(0, 4);
    const line = compactText([
      code,
      name,
      state,
      subStrategy,
      reason,
      price !== "" ? `價 ${price}` : "",
      volume !== "" ? `量 ${volume}` : "",
    ].filter(Boolean).join(" ｜ "), 160);
    return {
      rank: cleanNumber(merged.rank) || index + 1,
      code,
      title: compactText(name || reason || state || code || `訊號 ${index + 1}`, 64),
      pct: pct === "" || pct == null ? "" : String(pct).includes("%") ? String(pct) : `${cleanNumber(pct).toFixed(2)}%`,
      score: score === "" || score == null ? "" : String(Math.round(cleanNumber(score) * 100) / 100),
      reason: compactText(reason || state || line, 180),
      state: compactText(state, 32),
      stateId: compactText(stateId, 40),
      intent: compactText(intent, 40),
      timestamp: compactText(merged.timestamp || merged.scanTime || merged.scan_time || "", 32),
      entryAt: compactText(merged.entryAt || merged.entry_at || "", 32),
      firstAAt: compactText(merged.firstAAt || merged.first_a_at || "", 32),
      latestAAt: compactText(merged.latestAAt || merged.latest_a_at || "", 32),
      firstBAt: compactText(merged.firstBAt || merged.first_b_at || "", 32),
      latestBAt: compactText(merged.latestBAt || merged.latest_b_at || "", 32),
      latestSeenAt: compactText(merged.latestSeenAt || merged.latest_seen_at || "", 32),
      time: compactText(time, 32),
      firstSignalTime: compactText(merged.firstSignalTime || merged.first_signal_time || time, 32),
      lastSignalTime: compactText(merged.lastSignalTime || merged.last_signal_time || merged.quoteTime || merged.quote_time || time, 32),
      quoteTime: compactText(merged.quoteTime || merged.quote_time || time, 32),
      radarDate: compactText(merged.radarDate || merged.radar_date || merged.tradeDate || merged.trade_date || merged.quoteDate || merged.quote_date || "", 16),
      side: compactText(merged.side || merged.direction || merged.state || "", 12),
      subStrategy,
      subStrategyId,
      strategyDisplay,
      signalLabel: subStrategy,
      signalLine,
      signals,
      tags: uniqueTags,
      signalTags: uniqueTags,
      price: price === "" || price == null ? "" : String(price),
      entryPrice: entryPrice === "" || entryPrice == null ? "" : String(entryPrice),
      volume: volume === "" || volume == null ? "" : String(volume),
      volumeLots: volumeLots === "" || volumeLots == null ? "" : String(Math.round(cleanNumber(volumeLots))),
      volumeRatio: volumeRatio === "" || volumeRatio == null ? "" : String(volumeRatio),
      tradeValue: tradeValue === "" || tradeValue == null ? "" : String(tradeValue),
      legal5d: legal5d === "" || legal5d == null ? "" : String(legal5d),
      foreign: pickFirstValue(merged.foreign, merged.foreignNet, merged.foreign_net, merged.foreignBuy, merged.foreign_buy),
      trust: pickFirstValue(merged.trust, merged.trustNet, merged.trust_net, merged.trustBuy, merged.trust_buy),
      total: pickFirstValue(merged.total, merged.totalNet, merged.total_net, merged.institutionTotal),
      foreignStreak: pickFirstValue(merged.foreignStreak, merged.foreign_streak),
      trustStreak: pickFirstValue(merged.trustStreak, merged.trust_streak),
      jointStreak: pickFirstValue(merged.jointStreak, merged.joint_streak),
      foreign_trust_buy_volume_pct: pickFirstValue(merged.foreign_trust_buy_volume_pct, merged.foreignTrustBuyVolumePct, merged.institutionBuyVolumePct, merged.foreignTrustVolumePct),
      foreignTrustBuyVolumePct: pickFirstValue(merged.foreignTrustBuyVolumePct, merged.foreign_trust_buy_volume_pct, merged.institutionBuyVolumePct, merged.foreignTrustVolumePct),
      institutionBuyVolumePct: pickFirstValue(merged.institutionBuyVolumePct, merged.foreignTrustBuyVolumePct, merged.foreign_trust_buy_volume_pct, merged.foreignTrustVolumePct),
      foreignTrustVolumePct: pickFirstValue(merged.foreignTrustVolumePct, merged.foreignTrustBuyVolumePct, merged.foreign_trust_buy_volume_pct, merged.institutionBuyVolumePct),
      fiveDayAvgVolume: pickFirstValue(merged.fiveDayAvgVolume, merged.five_day_avg_volume, merged.avgVolume5d, merged.avg_volume_5d),
      five_day_avg_volume: pickFirstValue(merged.five_day_avg_volume, merged.fiveDayAvgVolume, merged.avgVolume5d, merged.avg_volume_5d),
      foreignLots: pickFirstValue(merged.foreignLots, merged.foreign_lots),
      ratio1: pickFirstValue(merged.ratio1, merged.ratio1000Week1),
      ratio2: pickFirstValue(merged.ratio2, merged.ratio1000Week2),
      ratio3: pickFirstValue(merged.ratio3, merged.ratio1000Week3),
      ratioIncrease: pickFirstValue(merged.ratioIncrease, merged.ratio_increase),
      swingZone,
      swingZoneLabel,
      triangleBreakout: strategy4Triangle,
      longShort: compactText(merged.longShort || merged.side || merged.direction || "多", 8),
      aiStatus,
      aiSummary,
      triggerReason,
      triggerTags,
      line,
    };
  }

  function normalizeCanvasRowsFromPayload(payload, route = "") {
    if (isRoutePayloadNotDrawable(payload, route)) return [];
    const limit = canvasOptionsForRoute(route).limit || 60;
    const minLimit = isStrategy4Route(route) ? 10 : 20;
    const arrays = flattenApiArrays(payload);
    if (isStrategy2Route(route)) {
      const preferred = Array.isArray(payload?.rows) && payload.rows.some((row) => row && typeof row === "object")
        ? payload.rows
        : arrays.sort((a, b) => b.length - a.length)[0] || [];
      return preferred
        .map((row, index) => normalizeCanvasRow(row, index, route))
        .filter((row) => row.code || row.title)
        .sort(strategy2SortRows)
        .slice(0, Math.max(minLimit, Math.min(240, limit)));
    }
    const best = arrays
      .map((rows) => rows.map((row, index) => normalizeCanvasRow(row, index, route)).filter((row) => row.code || row.title))
      .sort((a, b) => b.length - a.length)[0] || [];
    const maxLimit = isRealtimeRadarRoute(route) ? 1200 : isLiveStrategyRoute(route) ? 240 : 120;
    if (isRealtimeRadarRoute(route)) {
      return best
        .sort((a, b) => radarDomTimeValue(b) - radarDomTimeValue(a)
          || cleanNumber(b.rank) - cleanNumber(a.rank)
          || cleanNumber(b.score) - cleanNumber(a.score)
          || String(a.code).localeCompare(String(b.code), "zh-Hant"))
        .slice(0, Math.max(minLimit, Math.min(maxLimit, limit)));
    }
    return best
      .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || cleanNumber(b.score) - cleanNumber(a.score) || String(a.code).localeCompare(String(b.code), "zh-Hant"))
      .slice(0, Math.max(minLimit, Math.min(maxLimit, limit)));
  }

  function strategy2TimeValue(row) {
    const raw = String(row?.timestamp || row?.entryAt || row?.time || row?.firstAAt || row?.latestAAt || row?.firstBAt || row?.latestBAt || row?.latestSeenAt || row?.seenAt || row?.detectedAt || row?.quoteTime || "").trim();
    if (!raw) return 0;
    const hms = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (hms) return cleanNumber(hms[1]) * 3600 + cleanNumber(hms[2]) * 60 + cleanNumber(hms[3] || 0);
    const stamp = Date.parse(raw);
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function strategy2SortRows(a, b) {
    return strategy2TimeValue(b) - strategy2TimeValue(a)
      || cleanNumber(a.rank) - cleanNumber(b.rank)
      || cleanNumber(b.score) - cleanNumber(a.score)
      || String(a.code).localeCompare(String(b.code), "zh-Hant");
  }

  function strategy2Text(row) {
    return [
      row?.stateId,
      row?.state,
      row?.intent,
      row?.subStrategyId,
      row?.subStrategy,
      row?.signalLine,
      row?.reason,
    ].filter(Boolean).join(" ");
  }

  function strategy2CoverageGateHealthy(text) {
    const match = String(text || "").match(/市場來源可用率\s*([0-9.]+)\s*未達\s*([0-9.]+)/);
    if (!match) return false;
    return cleanNumber(match[1]) >= cleanNumber(match[2] || 0.5);
  }

  function strategy2Tone(row) {
    const text = strategy2Text(row);
    const lower = text.toLowerCase();
    const combo = `${lower} ${text}`;
    const coverageGateHealthy = strategy2CoverageGateHealthy(combo);
    const pauseText = coverageGateHealthy
      ? combo.replace(/市場來源可用率\s*[0-9.]+\s*未達\s*[0-9.]+[^。]*。?/g, "")
      : combo;
    const paused = /pause|hold|history|b[-_ ]?only|暫停|歷史/.test(pauseText);
    const hasPrepareSetup = /prepare|candidate|ready|watch|預備|準備|候選|早期|再起漲|反彈|轉強|續強|盤中續強|曾發動仍強/.test(combo);
    if (coverageGateHealthy && /wait|待確認/.test(combo)) return "prepare";
    if (!paused && hasPrepareSetup) return "prepare";
    if (!paused && /entry|enter|go|buy|trigger|fire|進場|買進|攻擊|突破/.test(combo)) return "entry";
    if (hasPrepareSetup && !/暫停進場區顯示|市場來源/.test(combo)) return "prepare";
    return "history";
  }

  function strategy2TimeLabel(row) {
    const raw = String(row?.timestamp || row?.entryAt || row?.time || row?.firstAAt || row?.latestAAt || row?.firstBAt || row?.latestBAt || row?.latestSeenAt || "").trim();
    const hms = raw.match(/\d{1,2}:\d{2}(?::\d{2})?/);
    return hms ? hms[0] : raw || "--";
  }

  function isRoutePayloadNotDrawable(payload, route = "") {
    if (!payload || typeof payload !== "object") return false;
    if (isRealtimeRadarRoute(route)) {
      const hasDrawableRows = ["matches", "rows", "data", "results", "items"].some((key) => Array.isArray(payload[key]) && payload[key].some((item) => item && typeof item === "object"));
      return !hasDrawableRows && payload.ok === false;
    }
    if (route !== "strategy|策略1") return false;
    const hasDrawableRows = ["matches", "rows", "data", "results", "items"].some((key) => Array.isArray(payload[key]) && payload[key].some((item) => item && typeof item === "object"));
    if (hasDrawableRows) return false;
    const reason = String(payload.reason || payload.error || payload.detail || payload.qualityStatus || "").toLowerCase();
    const decisionReady = payload.decisionReady ?? payload.meta?.decision_ready;
    return decisionReady === false
      || reason.includes("not_ready")
      || reason.includes("waiting_snapshot")
      || reason.includes("futopt_not_ready");
  }

  function routeEmptyStateFromPayload(payload, route = "") {
    if (!isRoutePayloadNotDrawable(payload, route)) return null;
    const reason = String(payload.reason || payload.error || payload.detail || payload.qualityStatus || "waiting_snapshot");
    const detail = String(payload.detail || payload.lastError || payload.error || reason);
    let title = "等待完整掃描";
    let message = "策略1 等待下一次完整掃描與期權資料 ready，資料 ready 後會自動顯示。";
    if (isRealtimeRadarRoute(route)) {
      title = /stale/i.test(`${reason} ${detail}`) ? "即時雷達資料過期" : "即時雷達暫停顯示";
      message = "正式水源尚未提供可用的今日盤中資料，已停止沿用舊快照。";
    } else if (/futopt/i.test(detail)) {
      title = "等待期權資料";
      message = "期權資料尚未 ready，策略1 決策 gate 暫停出名單。";
    } else if (/decision/i.test(reason) || payload.decisionReady === false || payload.meta?.decision_ready === false) {
      title = "等待決策 gate";
      message = "策略1 decision_ready 尚未完成，先維持受控等待狀態。";
    }
    return {
      route,
      title,
      message,
      reason,
      detail,
      qualityStatus: String(payload.qualityStatus || payload.cacheSource || ""),
      at: Date.now(),
    };
  }

  function realtimeRadarHealthFromPayload(payload) {
    if (!payload || typeof payload !== "object") return null;
    const session = payload.marketSession || {};
    const freshness = payload.freshness || {};
    const statusText = String(payload.status || freshness.decision || payload.reason || payload.error || "");
    const stale = payload.ok === false || session.hasTodayMarketData === false || /stale|unavailable|empty|no_|not_|failed/i.test(statusText);
    const degraded = /degraded|fallback/i.test(statusText) || cleanNumber(payload.staleQuoteCount) > 0 || cleanNumber(payload.failedBatchCount) > 0;
    if (!stale && !degraded) return null;
    const detail = [
      payload.reason || payload.error || freshness.reason || statusText,
      session.marketDataIsoDate ? `資料日 ${session.marketDataIsoDate}` : "",
      session.taipeiDate ? `今日 ${session.taipeiDate}` : "",
      cleanNumber(payload.staleQuoteCount) ? `stale ${cleanNumber(payload.staleQuoteCount)} 檔` : "",
      cleanNumber(payload.failedBatchCount) ? `failed batch ${cleanNumber(payload.failedBatchCount)}/${cleanNumber(payload.totalBatchCount)}` : "",
    ].filter(Boolean).join(" · ");
    return {
      stale,
      degraded,
      title: stale ? "資料異常" : "降級運行",
      detail: detail || "正式資料源尚未通過 freshness gate",
      source: payload.cacheSource || payload.source || "",
      checkedAt: payload.updatedAt || freshness.checkedAt || "",
    };
  }

  function rememberRealtimeRadarHealth(payload) {
    realtimeRadarDomHealth = realtimeRadarHealthFromPayload(payload);
    return realtimeRadarDomHealth;
  }

  function setCanvasRows(route, rows, source = "memory", at = Date.now(), meta = null) {
    const cleanRows = (Array.isArray(rows) ? rows : []).filter((row) => row && (row.code || row.title || row.line));
    if (!route || !cleanRows.length) return false;
    canvasEmptyStates.delete(route);
    const storeMeta = meta && typeof meta === "object" ? meta : canvasStore.get(route)?.meta || null;
    canvasStore.set(route, { rows: cleanRows, source, at, meta: storeMeta });
    canvasRouteVersions.set(route, Number(canvasRouteVersions.get(route) || 0) + 1);
    canvasPreRenderedRoutes.delete(route);
    if (workerCanvasSupported() && !isRealtimeRadarRoute(route)) {
      window.setTimeout(() => preRenderStrategyRoute(route, `rows-${source}`), 40);
    }
    if (canvasState.route === route) {
      canvasState.rows = cleanRows;
      canvasState.source = source;
      canvasState.meta = storeMeta;
      applyCanvasFilter();
      if (isRealtimeRadarRoute(route)) {
        renderRealtimeRadarDomShell(linkForRouteKey(route) || route, source, cleanRows);
        return true;
      }
      const shell = currentCanvasShell();
      if (isStrategy2Route(route)) {
        updateStrategy2BattleShell(shell, route, strategyMeta(route));
        return true;
      }
      updateCanvasShell(shell, route, strategyMeta(route));
      scheduleCanvasDraw();
    }
    return true;
  }

  function rememberCanvasRows(route, rows, source = "memory", at = Date.now(), meta = null) {
    const cleanRows = (Array.isArray(rows) ? rows : []).filter((row) => row && (row.code || row.title || row.line));
    if (!route || !cleanRows.length) return [];
    setCanvasRows(route, cleanRows, source, at, meta);
    const item = { ...(routeSnapshots.get(route) || {}), at, rows: cleanRows, html: "", meta: meta || undefined };
    routeSnapshots.set(route, item);
    writeSessionSnapshot(route, item);
    writeIndexedSnapshot(route, item);
    return cleanRows;
  }

  function rowsForRoute(route) {
    const memory = canvasStore.get(route);
    if (memory?.rows?.length && (!isStrategyRoute(route) || !isDomDerivedSource(memory.source))) return memory.rows;
    const snapshot = routeSnapshots.get(route);
    if (isStrategyRoute(route) && !isApiBackedSnapshotItem(snapshot)) return [];
    if (snapshot?.rows?.length) {
      setCanvasRows(route, snapshot.rows, "snapshot", snapshot.at || Date.now(), snapshot.meta || null);
      return snapshot.rows;
    }
    return [];
  }

  function bundleEndpointPath(endpoint) {
    try {
      return new URL(endpoint, window.location.origin).pathname;
    } catch (error) {
      return String(endpoint || "").split("?")[0];
    }
  }

  function rememberMarketPayloadFromBundle(endpoint, payload) {
    if (!payload || typeof payload !== "object") return;
    const pathname = bundleEndpointPath(endpoint);
    if (pathname === "/api/heatmap" && Array.isArray(payload.sectors) && payload.sectors.length) {
      if (isMarketHeatmapLiveWindow()) return;
      marketSnapshotFirstPayload = { ...payload, snapshotFirst: true };
      if (isMarketViewActive()) {
        paintMarketSnapshotFirstPayload(marketSnapshotFirstPayload);
        if (marketDesktopMode === "ai") {
          scheduleMarketApiAiRender(marketSnapshotFirstPayload, marketRadarBundlePayload || {}, marketAiBundlePayload || {}, { delay: 160 });
        }
      }
      return;
    }
    if (pathname === "/api/market-ai-live") {
      marketAiBundlePayload = payload;
      if (isMarketViewActive() && marketDesktopMode === "ai") {
        scheduleMarketApiAiRender(marketSnapshotFirstPayload || {}, marketRadarBundlePayload || {}, marketAiBundlePayload, { delay: 70 });
      }
      return;
    }
    if (pathname === "/api/realtime-radar-latest") {
      rememberRealtimeRadarHealth(payload);
      marketRadarBundlePayload = payload;
      if (isMarketViewActive() && marketDesktopMode === "ai") {
        scheduleMarketApiAiRender(marketSnapshotFirstPayload || {}, marketRadarBundlePayload, marketAiBundlePayload || {}, { delay: 160 });
      }
    }
  }

  function primeRowsFromFastBundle(payload, source = "fast-bundle") {
    const endpoints = payload?.endpoints && typeof payload.endpoints === "object" ? payload.endpoints : {};
    let count = 0;
    Object.entries(endpoints).forEach(([endpoint, endpointPayload]) => {
      rememberMarketPayloadFromBundle(endpoint, endpointPayload);
      const route = routeForCompactEndpoint(endpoint);
      if (!route) return;
      const rows = normalizeCanvasRowsFromPayload(endpointPayload, route);
      if (!rows.length) return;
      rememberCanvasRows(route, rows, source, Date.now(), routePayloadMeta(route, endpointPayload));
      count += rows.length;
    });
    if (count && typeof window.FUMAN_HOTFIX_PRIME_API_CACHE === "function") {
      window.FUMAN_HOTFIX_PRIME_API_CACHE(endpoints, { source, reason: "desktop-shell" });
    }
    return count;
  }

  function primeDesktopFastBundle(force = false, reason = "startup") {
    const now = Date.now();
    if (!force && desktopFastBundlePromise) return desktopFastBundlePromise;
    if (!force && now - desktopFastBundleAt < 45000) return Promise.resolve(0);
    desktopFastBundleAt = now;
    const url = `/api/terminal-fast-bundle?canvas=1&compact=1&shell=1${force ? `&t=${now}` : ""}`;
    desktopFastBundlePromise = fetch(url, { cache: force ? "no-store" : "default", priority: force ? "high" : "auto" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((payload) => primeRowsFromFastBundle(payload, `bundle-${reason}`))
      .catch(() => 0)
      .finally(() => {
        desktopFastBundlePromise = null;
      });
    return desktopFastBundlePromise;
  }

  function primeStrategy2SnapshotFirst(force = false, reason = "boot") {
    if (!strategy2SnapshotFirstEnabled()) return Promise.resolve([]);
    const cached = canvasStore.get("strategy|策略2");
    if (!force && cached?.rows?.length && String(cached.source || "").includes("snapshot-first")) {
      return Promise.resolve(cached.rows);
    }
    if (!force && strategy2SnapshotFirstPrimePromise) return strategy2SnapshotFirstPrimePromise;
    strategy2SnapshotFirstPrimePromise = fetchCanvasRows("strategy|策略2", false)
      .then((rows) => {
        if (rows?.length) rememberCanvasRows("strategy|策略2", rows, `snapshot-first-prime-${reason}`, Date.now());
        return rows || [];
      })
      .catch(() => [])
      .finally(() => {
        strategy2SnapshotFirstPrimePromise = null;
      });
    return strategy2SnapshotFirstPrimePromise;
  }

  function routePayloadMeta(route, payload) {
    if (!payload || typeof payload !== "object") return null;
    if (isStrategy5Route(route)) {
      const resultCount = cleanNumber(payload.resultCount || payload.count || payload.matches?.length || payload.rows?.length);
      return {
        ok: payload.ok,
        runId: payload.runId || payload.transport?.runId || payload.meta?.runId || "",
        updatedAt: payload.updatedAt || payload.generatedAt || payload.source_snapshot_captured_at || "",
        resultCount,
        evidenceStatus: payload.evidenceStatus || payload.run_quality_at_publish?.evidenceStatus || "",
        unattendedStatus: payload.unattendedStatus || payload.run_quality_at_publish?.unattendedStatus || "",
        publishAllowed: payload.publishGate?.publishAllowed ?? payload.run_quality_at_publish?.publishAllowed,
        latestOverwriteAllowed: payload.publishGate?.latestOverwriteAllowed ?? payload.run_quality_at_publish?.latestOverwriteAllowed,
        sourceStatus: payload.source_status_at_run?.status || payload.sourceStatus?.status || "",
        cacheSource: payload.cacheSource || payload.transport?.source || payload.source || "",
      };
    }
    if (!isStrategy2Route(route)) return null;
    return {
      ok: payload.ok,
      runId: payload.runId || payload.transport?.runId || "",
      updatedAt: payload.updatedAt || payload.generatedAt || "",
      qualityStatus: payload.qualityStatus || "",
      reason: payload.publishBlockedReason || payload.selfCheck?.reason || payload.sourceCoverage?.reason || payload.resourceReadiness?.reason || payload.reason || "",
      publishBlocked: payload.publishBlocked === true || payload.transport?.publishBlocked === true,
      cacheSource: payload.cacheSource || payload.transport?.source || payload.source || "",
      sourceCoverage: payload.sourceCoverage || null,
      resourceReadiness: payload.resourceReadiness || null,
      marketSession: payload.marketSession || null,
      selfCheck: payload.selfCheck || null,
      freshness: payload.selfCheck?.freshness || null,
    };
  }

  function strategy2HealthMeta() {
    const stored = canvasStore.get("strategy|策略2")?.meta;
    return canvasState.meta || stored || null;
  }

  function canvasPayloadMeta(route = canvasState.route) {
    return canvasState.meta || canvasStore.get(route)?.meta || null;
  }

  function strategy5MetaSummary(baseSummary, route = canvasState.route) {
    if (!isStrategy5Route(route)) return baseSummary;
    const meta = canvasPayloadMeta(route);
    const parts = [
      baseSummary,
      meta?.runId ? `run ${meta.runId}` : "",
      meta?.resultCount ? `總數 ${meta.resultCount}` : "",
      meta?.evidenceStatus ? `evidence ${meta.evidenceStatus}` : "",
      meta?.unattendedStatus ? `unattended ${meta.unattendedStatus}` : "",
    ].filter(Boolean);
    return parts.join("｜");
  }

  function strategy2AfterhoursHoldActive(meta = strategy2HealthMeta()) {
    return String(meta?.marketSession?.session || "") === "afterhours_hold_until_midnight";
  }

  function strategy2HealthBannerHtml(meta = strategy2HealthMeta()) {
    if (!meta || typeof meta !== "object") return "";
    const status = String(meta.selfCheck?.status || meta.qualityStatus || "").toLowerCase();
    const blocked = meta.publishBlocked === true || /blocked|not_ready/.test(status);
    const degraded = blocked || /degraded|stale|not_ready|blocked|preserved/.test(status);
    if (!degraded) return "";
    const title = blocked ? "策略2資料阻擋" : "策略2降級運行";
    const reason = meta.reason || meta.selfCheck?.dataReadiness?.reason || meta.sourceCoverage?.reason || "正式資料源尚未通過 freshness gate";
    const detail = [
      meta.runId ? `run ${meta.runId}` : "",
      meta.updatedAt ? `更新 ${meta.updatedAt}` : "",
      meta.cacheSource ? `來源 ${meta.cacheSource}` : "",
    ].filter(Boolean).join(" ｜ ");
    return `
      <section class="strategy2-health-banner ${blocked ? "blocked" : "degraded"}" data-strategy2-health-banner>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(reason)}</span>
        <small>${escapeHtml(detail)}</small>
      </section>
    `;
  }

  function installStrategy2SnapshotFirstPrime() {
    if (document.documentElement.dataset.fumanStrategy2SnapshotFirstPrimeReady === "1") return;
    document.documentElement.dataset.fumanStrategy2SnapshotFirstPrimeReady = "1";
    if (!strategy2SnapshotFirstEnabled()) return;
    runIdle(() => primeStrategy2SnapshotFirst(false, "script-idle"), 420, 2600);
    runIdle(() => primeStrategy2SnapshotFirst(false, "idle"), 1200, 3200);
    window.addEventListener("focus", () => runIdle(() => primeStrategy2SnapshotFirst(false, "focus"), 180, 2600));
  }

  function primeStrategy2LiveRows(force = false, reason = "boot") {
    if (strategy2SnapshotFirstEnabled()) return Promise.resolve([]);
    const cached = canvasStore.get("strategy|策略2");
    if (!force && cached?.rows?.length && /api|live-prime/.test(String(cached.source || "")) && Date.now() - Number(cached.at || 0) < 6500) {
      return Promise.resolve(cached.rows);
    }
    if (!force && strategy2LivePrimePromise) return strategy2LivePrimePromise;
    strategy2LivePrimePromise = fetchCanvasRows("strategy|策略2", true)
      .then((rows) => {
        if (rows?.length) rememberCanvasRows("strategy|策略2", rows, `api-live-prime-${reason}`, Date.now());
        return rows || [];
      })
      .catch(() => [])
      .finally(() => {
        strategy2LivePrimePromise = null;
      });
    return strategy2LivePrimePromise;
  }

  function installStrategy2LivePrime() {
    if (document.documentElement.dataset.fumanStrategy2LivePrimeReady === "1") return;
    document.documentElement.dataset.fumanStrategy2LivePrimeReady = "1";
    if (strategy2SnapshotFirstEnabled()) return;
    primeStrategy2LiveRows(false, "script");
    runIdle(() => primeStrategy2LiveRows(false, "idle"), 280, 3200);
    window.addEventListener("focus", () => runIdle(() => primeStrategy2LiveRows(false, "focus"), 220, 3200));
  }

  function installDesktopFastBundlePrime() {
    if (document.documentElement.dataset.fumanFastBundlePrimeReady === "1") return;
    document.documentElement.dataset.fumanFastBundlePrimeReady = "1";
    window.FUMAN_DESKTOP_FAST_BUNDLE_PRIME = (force = true) => primeDesktopFastBundle(Boolean(force), force ? "manual" : "cache");
    primeDesktopFastBundle(false, "script");
    const schedule = () => {
      primeDesktopFastBundle(false, "boot");
      runIdle(() => {
        if (document.hidden || isInteractionHoldActive()) {
          window.setTimeout(schedule, Math.max(1200, interactionHoldRemaining() + 700));
          return;
        }
        primeDesktopFastBundle(false, "idle");
      }, 220, 4200);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule, { once: true });
    else schedule();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      runIdle(() => primeDesktopFastBundle(false, "visible"), 550, 3600);
    });
  }

  function applyCanvasFilter() {
    const query = compactText(canvasState.query, 80).toLowerCase();
    const signalFilter = (isStrategy4Route(canvasState.route) || isStrategy5Route(canvasState.route)) ? compactText(canvasState.signalFilter, 80).toLowerCase() : "";
    const chipFilter = isChipTradeRoute(canvasState.route) ? compactText(canvasState.signalFilter || "", 80) : "";
    const zoneFilter = isStrategy4Route(canvasState.route) ? compactText(canvasState.zoneFilter, 2).toUpperCase() : "";
    const filterRows = (activeChipFilter = chipFilter) => canvasState.rows.filter((row) => {
      if (zoneFilter && String(row.swingZone || "").toUpperCase() !== zoneFilter) return false;
      const triangle = row?.triangleBreakout && typeof row.triangleBreakout === "object" ? row.triangleBreakout : null;
      const signalText = [
        row.subStrategyId,
        row.subStrategy,
        row.signalLine,
        ...(row.signals || []).flatMap((signal) => [signal.id, signal.label, signal.reason]),
        triangle ? "triangle_breakout" : "",
        triangle?.label,
        triangle?.status,
        triangle?.reason,
      ].join(" ").toLowerCase();
      if (signalFilter && !signalText.includes(signalFilter)) return false;
      if (activeChipFilter && !matchesChipTradeFilter(row, activeChipFilter)) return false;
      if (!query) return true;
      return [
        row.code,
        row.title,
        row.reason,
        row.line,
        row.subStrategy,
        row.signalLine,
        row.aiSummary,
        row.triggerReason,
        row.volumeRatio,
        row.tradeValue,
        row.legal5d,
      ].join(" ").toLowerCase().includes(query);
    });
    canvasState.filtered = filterRows(chipFilter);
    if (isChipTradeRoute(canvasState.route) && chipFilter && !canvasState.filtered.length && canvasState.rows.length) {
      const fallbackFilter = [CHIP_TRADE_DEFAULT_FILTER, "foreignStreak", "trustStreak", "jointStreak", ""]
        .find((key) => !key || filterRows(key).length);
      canvasState.signalFilter = fallbackFilter || "";
      canvasState.filtered = filterRows(canvasState.signalFilter);
    }
    const pageSize = canvasPageSizeForRoute();
    const maxOffset = pageSize
      ? Math.max(0, (Math.ceil(canvasState.filtered.length / pageSize) - 1) * pageSize)
      : Math.max(0, canvasState.filtered.length - 1);
    canvasState.offset = Math.max(0, Math.min(canvasState.offset, maxOffset));
    if (pageSize) canvasState.offset = Math.floor(canvasState.offset / pageSize) * pageSize;
    canvasRowsVersion += 1;
  }

  function matchesChipTradeFilter(row, filter) {
    if (!filter) return true;
    const foreign = cleanNumber(row.foreign);
    const trust = cleanNumber(row.trust);
    if (filter === "tdcc1000") {
      const ratioHit = cleanNumber(row.ratioIncrease) > 0
        || (cleanNumber(row.ratio3) > 0 && cleanNumber(row.ratio3) >= cleanNumber(row.ratio2) && cleanNumber(row.ratio2) >= cleanNumber(row.ratio1));
      return cleanNumber(row.foreignStreak) >= 3 && (cleanNumber(row.foreignLots) > 0 || foreign > 0) && ratioHit;
    }
    if (filter === "foreignTrustVolumePct") {
      return foreign + trust > 0 && chipTradeForeignTrustVolumePct(row) > 0;
    }
    if (filter === "foreignStreak") return cleanNumber(row.foreignStreak) > 0;
    if (filter === "trustStreak") return cleanNumber(row.trustStreak) > 0;
    if (filter === "jointStreak") return cleanNumber(row.jointStreak) > 0;
    return true;
  }

  function chipTradeForeignTrustVolumePct(row) {
    const explicitRaw = pickFirstValue(row?.foreignTrustBuyVolumePct, row?.foreign_trust_buy_volume_pct, row?.institutionBuyVolumePct, row?.foreignTrustVolumePct);
    if (explicitRaw !== undefined && explicitRaw !== null && explicitRaw !== "") return cleanNumber(explicitRaw);
    const avgVolume = cleanNumber(pickFirstValue(row?.fiveDayAvgVolume, row?.five_day_avg_volume, row?.avgVolume5d, row?.avg_volume_5d));
    if (avgVolume <= 0) return 0;
    return ((cleanNumber(row?.foreign) + cleanNumber(row?.trust)) / avgVolume) * 100;
  }

  function fetchCanvasRows(route, force = false) {
    const endpoint = endpointForRoute(route);
    if (!endpoint) return Promise.resolve([]);
    const cached = canvasStore.get(route);
    const options = canvasOptionsForRoute(route);
    const ttl = Number(options.ttl || CANVAS_REFRESH_TTL_MS);
    const bypassRouteCache = isChipTradeRoute(route) && Boolean(canvasState.signalFilter);
    if (!force && !bypassRouteCache && cached?.rows?.length && Date.now() - Number(cached.at || 0) < ttl) {
      return Promise.resolve(cached.rows);
    }
    if (!force && route === REALTIME_RADAR_ROUTE) {
      const radarKey = marketJsonCacheKey("/api/realtime-radar-latest?full=1", 1200);
      const radarCached = marketJsonCache.get(radarKey);
      if (radarCached?.payload && Date.now() - Number(radarCached.at || 0) < MARKET_JSON_CACHE_TTL_MS) {
        const rows = normalizeCanvasRowsFromPayload(radarCached.payload, REALTIME_RADAR_ROUTE);
        if (rows.length) {
          rememberCanvasRows(route, rows, "market-prime-cache", radarCached.at || Date.now(), routePayloadMeta(route, radarCached.payload));
          return Promise.resolve(rows);
        }
      }
      const radarInflight = marketJsonInflight.get(radarKey);
      if (radarInflight) {
        return radarInflight.then((payload) => {
          const rows = normalizeCanvasRowsFromPayload(payload, REALTIME_RADAR_ROUTE);
          if (rows.length) rememberCanvasRows(route, rows, "market-prime-inflight", Date.now(), routePayloadMeta(route, payload));
          return rows.length ? rows : rowsForRoute(route);
        });
      }
    }
    const inflightKey = isChipTradeRoute(route) ? `${route}|${canvasState.signalFilter || ""}` : route;
    if (canvasInflight.has(inflightKey)) return canvasInflight.get(inflightKey);
    const url = compactCanvasUrlForRoute(route, force);
    const task = fetch(url, { cache: force ? "no-store" : "default" })
      .then(async (response) => {
        let payload = null;
        try { payload = await response.json(); } catch (error) {}
        if (!response.ok) {
          const errorPayload = {
            ...(payload && typeof payload === "object" ? payload : {}),
            ok: false,
            error: payload?.error || `HTTP ${response.status}`,
            reason: payload?.reason || `HTTP ${response.status}`,
            httpStatus: response.status,
          };
          if (isRealtimeRadarRoute(route)) {
            rememberRealtimeRadarHealth(errorPayload);
            const emptyState = routeEmptyStateFromPayload(errorPayload, route);
            if (emptyState) canvasEmptyStates.set(route, emptyState);
            if (canvasState.route === route) canvasState.source = emptyState?.reason || errorPayload.reason || "api-error";
            return errorPayload;
          }
          throw new Error(`HTTP ${response.status}`);
        }
        return payload || {};
      })
      .then((payload) => {
        if (isRealtimeRadarRoute(route)) rememberRealtimeRadarHealth(payload);
        const rows = normalizeCanvasRowsFromPayload(payload, route);
        if (rows.length) {
          const source = payload?.snapshotFirst ? "snapshot-first-refreshing" : "api";
          rememberCanvasRows(route, rows, source, Date.now(), routePayloadMeta(route, payload));
        } else {
          const emptyState = routeEmptyStateFromPayload(payload, route);
          if (emptyState) {
            canvasEmptyStates.set(route, emptyState);
            if (canvasState.route === route) {
              canvasState.source = emptyState.qualityStatus || emptyState.reason || "waiting";
            }
          }
        }
        return rows;
      })
      .catch((error) => {
        if (isRealtimeRadarRoute(route)) {
          const errorPayload = { ok: false, error: error?.message || "network_error", reason: error?.message || "network_error" };
          rememberRealtimeRadarHealth(errorPayload);
          const emptyState = routeEmptyStateFromPayload(errorPayload, route);
          if (emptyState) canvasEmptyStates.set(route, emptyState);
          return [];
        }
        return rowsForRoute(route);
      })
      .finally(() => canvasInflight.delete(inflightKey));
    canvasInflight.set(inflightKey, task);
    return task;
  }

  function currentCanvasShell() {
    return document.querySelector(".view-panel.active .desktop-route-shell.desktop-canvas-app")
      || document.querySelector(".desktop-route-shell.desktop-canvas-app");
  }

  function visibleCanvasCapacity(canvas) {
    const pageSize = canvasPageSizeForRoute();
    if (pageSize) return pageSize;
    const rect = canvas?.getBoundingClientRect?.();
    const height = Math.max(360, Math.min(760, Math.floor(rect?.height || (window.innerHeight || 900) * 0.62)));
    const rowHeight = canvasRowHeightForRoute();
    const headerHeight = canvasHeaderHeightForRoute();
    return Math.max(isWideStrategyTableRoute(canvasState.route) ? 3 : 5, Math.floor((height - headerHeight - 16) / rowHeight));
  }

  function clampCanvasOffset(canvas) {
    const capacity = visibleCanvasCapacity(canvas);
    const pageSize = canvasPageSizeForRoute();
    const maxOffset = pageSize
      ? Math.max(0, (Math.ceil(canvasState.filtered.length / pageSize) - 1) * pageSize)
      : Math.max(0, canvasState.filtered.length - capacity);
    canvasState.offset = Math.max(0, Math.min(canvasState.offset, maxOffset));
    if (pageSize) canvasState.offset = Math.floor(canvasState.offset / pageSize) * pageSize;
  }

  function updateCanvasPagination(shell) {
    const panel = shell || currentCanvasShell();
    if (!panel) return;
    const wrap = panel.querySelector("[data-canvas-pagination]");
    if (!wrap) return;
    const pageSize = canvasPageSizeForRoute(canvasState.route);
    if (!pageSize) {
      wrap.hidden = true;
      wrap.innerHTML = "";
      return;
    }
    const totalRows = canvasState.filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const currentPage = Math.min(totalPages, Math.floor(canvasState.offset / pageSize) + 1);
    const start = totalRows ? canvasState.offset + 1 : 0;
    const end = Math.min(totalRows, canvasState.offset + pageSize);
    const startPage = Math.max(1, Math.min(currentPage - 2, Math.max(1, totalPages - 4)));
    const endPage = Math.min(totalPages, startPage + 4);
    const buttons = [];
    for (let page = startPage; page <= endPage; page += 1) {
      buttons.push(`<button type="button" data-canvas-page="${page}" class="${page === currentPage ? "active" : ""}">${page}</button>`);
    }
    wrap.hidden = false;
    wrap.innerHTML = `
      <button type="button" data-canvas-page="prev" ${currentPage <= 1 ? "disabled" : ""}>上一頁</button>
      ${buttons.join("")}
      <button type="button" data-canvas-page="next" ${currentPage >= totalPages ? "disabled" : ""}>下一頁</button>
      <span>第 ${currentPage} / ${totalPages} 頁｜${start}-${end} / ${totalRows} 筆</span>
    `;
  }

  function setCanvasStatus(text) {
    const shell = currentCanvasShell();
    if (!shell) return;
    const status = shell.querySelector(".desktop-canvas-status");
    const count = shell.querySelector(".desktop-canvas-count");
    const visible = canvasState.filtered.length;
    const total = canvasState.rows.length;
    const source = canvasState.source ? String(canvasState.source).replace(/^canvas-/, "") : "shell";
    const pageSize = canvasPageSizeForRoute();
    if (count && pageSize) {
      const pageCount = Math.max(1, Math.ceil(visible / pageSize));
      const currentPage = Math.min(pageCount, Math.floor(canvasState.offset / pageSize) + 1);
      count.textContent = `${visible}/${total} · 第 ${currentPage}/${pageCount} 頁`;
    } else if (count) {
      count.textContent = `${visible}/${total}`;
    }
    const mode = canvasWorkerReady ? canvasWorkerMode : source;
    const label = source.includes("snapshot-first")
      ? "快照先顯示｜即時刷新中"
      : `${mode} · ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}`;
    if (status) status.textContent = text || label;
    syncCanvasEmptyStateUi(shell);
    updateCanvasPagination(shell);
  }

  function scheduleCanvasDraw() {
    window.cancelAnimationFrame(canvasFrame);
    canvasFrame = window.requestAnimationFrame(drawCurrentCanvas);
  }

  function drawCurrentCanvas() {
    const shell = currentCanvasShell();
    let canvas = shell?.querySelector(".desktop-route-canvas");
    if (!canvas) return;
    clampCanvasOffset(canvas);
    const meta = strategyMeta(canvasState.route || activeSnapshotRoute);
    const emptyState = currentCanvasEmptyState();
    if (emptyState) {
      canvas = replaceWorkerCanvasForMainDraw(shell, canvas, meta);
      syncCanvasEmptyStateUi(shell);
      drawRouteCanvas(canvas, meta, canvasState.filtered, canvasState.source);
      setCanvasStatus();
      return;
    }
    if (isStrategyRoute(canvasState.route) && !isWideStrategyTableRoute(canvasState.route) && drawCanvasWithWorker(canvas)) {
      setCanvasStatus();
      return;
    }
    drawRouteCanvas(canvas, meta, canvasState.filtered, canvasState.source);
    setCanvasStatus();
  }

  function currentCanvasEmptyState() {
    return canvasEmptyStates.get(canvasState.route || activeSnapshotRoute || "") || null;
  }

  function replaceWorkerCanvasForMainDraw(shell, canvas, meta) {
    if (!shell || !canvas || canvas.dataset.fumanWorkerCanvas !== "1") return canvas;
    const fresh = document.createElement("canvas");
    fresh.className = canvas.className;
    fresh.tabIndex = canvas.tabIndex || 0;
    fresh.setAttribute("aria-label", `${meta.title} Canvas 快速列表`);
    canvas.replaceWith(fresh);
    if (canvasWorkerAttachedCanvas === canvas) canvasWorkerAttachedCanvas = null;
    canvasWorkerRowsVersion = -1;
    return fresh;
  }

  function syncCanvasEmptyStateUi(shell = currentCanvasShell()) {
    if (!shell) return;
    const route = canvasState.route || activeSnapshotRoute || "";
    const emptyState = currentCanvasEmptyState();
    const dataState = shell.querySelector("[data-canvas-data-state]") || shell.querySelector(".desktop-route-shell-grid article:nth-child(2) strong");
    const status = shell.querySelector(".desktop-canvas-status");
    const emptyNote = shell.querySelector("[data-canvas-empty-note]");
    if (dataState) dataState.textContent = isLiveStrategyRoute(route) ? "即時偵測" : canvasState.rows.length ? "快照命中" : emptyState ? "受控等待" : "背景更新";
    if (status && emptyState) status.textContent = emptyState.reason || "waiting";
    if (emptyNote) {
      emptyNote.hidden = !emptyState;
      emptyNote.textContent = emptyState ? `${emptyState.title}：${emptyState.message} ${emptyState.detail || ""}` : "";
    }
  }

  function workerCanvasSupported() {
    return !canvasWorkerFailed &&
      "Worker" in window &&
      "OffscreenCanvas" in window &&
      typeof HTMLCanvasElement !== "undefined" &&
      typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function";
  }

  function getCanvasWorker() {
    if (!workerCanvasSupported()) return null;
    if (canvasWorker) return canvasWorker;
    try {
      const url = `${CANVAS_WORKER_URL}?runtime=${encodeURIComponent(window.__fumanDesktopFastShell || "20260623-09")}&t=${Date.now()}`;
      canvasWorker = new Worker(url);
      canvasWorker.onmessage = (event) => {
        const data = event.data || {};
        if (data.type === "ready") {
          canvasWorkerReady = !!data.ok;
          canvasWorkerMode = data.mode || "worker-offscreen";
          setCanvasStatus(canvasWorkerReady ? canvasWorkerMode : "Canvas fallback");
          primeStrategyBuffers("worker-ready");
          scheduleCanvasDraw();
        } else if (data.type === "drawn") {
          canvasWorkerMode = data.mode || canvasWorkerMode;
        } else if (data.type === "preRendered") {
          if (data.route) canvasPreRenderedRoutes.add(data.route);
          canvasWorkerMode = data.mode || canvasWorkerMode;
        }
      };
      canvasWorker.onerror = () => {
        canvasWorkerFailed = true;
        canvasWorkerReady = false;
        canvasWorkerMode = "main-canvas";
        try {
          canvasWorker?.terminate?.();
        } catch (error) {}
        canvasWorker = null;
      };
      return canvasWorker;
    } catch (error) {
      canvasWorkerFailed = true;
      return null;
    }
  }

  function primeCanvasWorker() {
    const run = () => {
      const worker = getCanvasWorker();
      if (worker) {
        canvasWorkerMode = "worker-warming";
        primeStrategyBuffers("idle-prime");
      }
    };
    if ("requestIdleCallback" in window) {
      requestIdleCallback(run, { timeout: 1200 });
    } else {
      window.setTimeout(run, 700);
    }
  }

  function canvasDrawMetrics(canvas) {
    const route = canvasState.route || activeSnapshotRoute || "route";
    const parentWidth = canvas.parentElement?.clientWidth || canvas.clientWidth || 920;
    const width = Math.max(520, Math.floor(parentWidth));
    const viewportHeight = window.innerHeight || 900;
    const isFixed = FIXED_ROUTE_KEYS.includes(route);
    const pageSize = canvasPageSizeForRoute(route);
    const pagedHeight = pageSize ? canvasHeaderHeightForRoute(route) + canvasRowHeightForRoute(route) * pageSize + 24 : 0;
    const height = pageSize
      ? pagedHeight
      : Math.max(isFixed ? 440 : 420, Math.min(isFixed ? 700 : 680, Math.floor(viewportHeight - 320)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const key = `${route}|${Math.round(width / 8) * 8}|${height}|${dpr}|${canvasThemeMode()}`;
    const cached = canvasMetricsCache.get(key);
    canvas.style.height = `${height}px`;
    canvas.style.minHeight = `${height}px`;
    if (cached) return cached;
    const metrics = { width, height, dpr };
    canvasMetricsCache.clear();
    canvasMetricsCache.set(key, metrics);
    return metrics;
  }

  function canvasThemeMode() {
    return document.body?.classList?.contains("fuman-light-theme") ? "light" : "dark";
  }

  function canvasPalette() {
    if (canvasThemeMode() === "light") {
      return {
        bg: "#f6f9fc",
        frameA: "rgba(255,247,237,0.96)",
        frameB: "rgba(235,244,255,0.92)",
        frameC: "rgba(255,255,255,0.98)",
        stroke: "rgba(249,115,22,0.28)",
        accent: "#f97316",
        accentSoft: "rgba(249,115,22,0.12)",
        accentHover: "rgba(249,115,22,0.08)",
        title: "#172033",
        text: "#25334a",
        muted: "#64748b",
        soft: "#eef4fb",
        softAlt: "#ffffff",
        header: "rgba(226,236,248,0.86)",
        row: "rgba(255,255,255,0.88)",
        rowAlt: "rgba(246,250,255,0.9)",
        blue: "#2563eb",
        up: "#dc2626",
        down: "#059669",
        skeleton: "rgba(100,116,139,0.16)",
        shadow: "rgba(15,23,42,0.08)",
      };
    }
    return {
      bg: "#090f1c",
      frameA: "rgba(255,112,55,0.20)",
      frameB: "rgba(30,41,59,0.45)",
      frameC: "rgba(59,130,246,0.10)",
      stroke: "rgba(255,112,55,0.38)",
      accent: "#ff8a3d",
      accentSoft: "rgba(255,112,55,0.22)",
      accentHover: "rgba(255,112,55,0.13)",
      title: "#f8fafc",
      text: "#e8eefc",
      muted: "#9fb0cb",
      soft: "rgba(15,23,42,0.86)",
      softAlt: "rgba(30,41,59,0.46)",
      header: "rgba(15,23,42,0.86)",
      row: "rgba(30,41,59,0.46)",
      rowAlt: "rgba(15,23,42,0.58)",
      blue: "#9bc4ff",
      up: "#fb7185",
      down: "#34d399",
      skeleton: "rgba(148,163,184,0.16)",
      shadow: "rgba(0,0,0,0.22)",
    };
  }

  function attachWorkerCanvas(canvas) {
    const worker = getCanvasWorker();
    if (!worker) return false;
    if (canvas.dataset.fumanWorkerCanvas === "1") return true;
    try {
      const offscreen = canvas.transferControlToOffscreen();
      canvas.dataset.fumanWorkerCanvas = "1";
      canvasWorkerAttachedCanvas = canvas;
      canvasWorkerRowsVersion = -1;
      worker.postMessage({ type: "attach", canvas: offscreen }, [offscreen]);
      return true;
    } catch (error) {
      canvasWorkerFailed = true;
      return false;
    }
  }

  function syncCanvasWorkerRows(worker) {
    if (!worker) return;
    const versionToken = workerRowsVersionToken(canvasState.route);
    if (canvasWorkerRowsVersion === versionToken && canvasWorkerRoute === canvasState.route) return;
    canvasWorkerRowsVersion = versionToken;
    canvasWorkerRoute = canvasState.route;
    worker.postMessage({
      type: "rows",
      route: canvasState.route,
      rows: canvasState.filtered,
      version: versionToken,
    });
  }

  function workerRowsVersionToken(route) {
    return `${Number(canvasRouteVersions.get(route) || 0)}:${canvasState.query || ""}`;
  }

  function filteredRowsForRoute(route, rows) {
    const query = compactText(canvasState.query, 80).toLowerCase();
    if (!query) return rows.slice();
    return rows.filter((row) => [row.code, row.title, row.reason, row.line].join(" ").toLowerCase().includes(query));
  }

  function canvasPreRenderMetrics() {
    const canvas = currentCanvasShell()?.querySelector(".desktop-route-canvas");
    if (canvas) return canvasDrawMetrics(canvas);
    const container = document.querySelector(".view-panel.active")
      || document.querySelector("#strategy-table")
      || document.querySelector("#strategy-view")
      || document.body;
    const rect = container?.getBoundingClientRect?.();
    const width = Math.max(520, Math.floor(rect?.width || Math.min(1280, (window.innerWidth || 1440) - 460)));
    const height = Math.max(380, Math.min(760, Math.floor((window.innerHeight || 900) * 0.68)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    return { width, height, dpr };
  }

  function sendWorkerRowsForRoute(route, rows, versionToken) {
    const worker = getCanvasWorker();
    if (!worker || !route || !rows?.length) return false;
    worker.postMessage({
      type: "rows",
      route,
      rows,
      version: versionToken || workerRowsVersionToken(route),
    });
    return true;
  }

  function postPreRenderRoute(route, rows, source = "prebuffer") {
    const worker = getCanvasWorker();
    if (!worker || !route || !rows?.length) return false;
    const metrics = canvasPreRenderMetrics();
    const versionToken = workerRowsVersionToken(route);
    sendWorkerRowsForRoute(route, rows, versionToken);
    worker.postMessage({
      type: "preRender",
      route,
      meta: strategyMeta(route),
      source,
      offset: 0,
      hoverIndex: -1,
      selectedIndex: -1,
      width: metrics.width,
      height: metrics.height,
      dpr: metrics.dpr,
      rowHeight: CANVAS_ROW_HEIGHT,
      headerHeight: CANVAS_HEADER_HEIGHT,
      theme: canvasThemeMode(),
      preferBuffer: true,
    });
    canvasPreRenderedRoutes.add(route);
    return true;
  }

  function preRenderStrategyRoute(route, reason = "hover") {
    if (!route || !workerCanvasSupported()) return;
    const rows = filteredRowsForRoute(route, rowsForRoute(route));
    if (rows.length) {
      postPreRenderRoute(route, rows, reason);
      return;
    }
    if (/hover|pointer|buffer/i.test(String(reason || ""))) return;
    if (document.hidden || isInteractionHoldActive()) return;
    fetchCanvasRows(route, false).then((nextRows) => {
      if (!nextRows?.length) return;
      postPreRenderRoute(route, filteredRowsForRoute(route, nextRows), reason);
    }).catch(() => undefined);
  }

  function primeStrategyBuffers(reason = "idle") {
    window.clearTimeout(canvasPreRenderTimer);
    const routes = [...SNAPSHOT_ROUTES, ...FIXED_ROUTE_KEYS.filter((route) => route !== "watchlist|自選股" && !isRealtimeRadarRoute(route))];
    canvasPreRenderTimer = window.setTimeout(() => {
      routes.forEach((route, index) => {
        runIdle(() => preRenderStrategyRoute(route, `${reason}-${index + 1}`), index * 220, 2600);
      });
    }, isInteractionHoldActive() ? interactionHoldRemaining() + 240 : 180);
  }

  function drawCanvasWithWorker(canvas) {
    if (!workerCanvasSupported() || !attachWorkerCanvas(canvas)) return false;
    const worker = getCanvasWorker();
    if (!worker) return false;
    const metrics = canvasDrawMetrics(canvas);
    syncCanvasWorkerRows(worker);
    worker.postMessage({
      type: "draw",
      route: canvasState.route,
      meta: strategyMeta(canvasState.route || activeSnapshotRoute),
      source: canvasState.source,
      offset: canvasState.offset,
      hoverIndex: canvasState.hoverIndex,
      selectedIndex: canvasState.selectedIndex,
      width: metrics.width,
      height: metrics.height,
      dpr: metrics.dpr,
      rowHeight: CANVAS_ROW_HEIGHT,
      headerHeight: CANVAS_HEADER_HEIGHT,
      theme: canvasThemeMode(),
      preferBuffer: true,
    });
    return true;
  }

  function wideStrategyColumnLayout(width, route = canvasState.route) {
    const left = 24;
    const right = 24;
    const available = Math.max(900, width - left - right);
    const strategy3Spec = [
      ["rank", "排名", 58],
      ["stock", "股票", 142],
      ["side", "多空", 72],
      ["price", "價格", 86],
      ["pct", "漲幅", 88],
      ["score", "分數", 76],
      ["ai", "策略", 300],
      ["trigger", "觸發原因", 360],
    ];
    const strategy4Spec = [
      ["rank", "排名", 58],
      ["stock", "股票", 142],
      ["side", "多空", 72],
      ["price", "價格", 86],
      ["pct", "漲幅", 88],
      ["score", "分數", 76],
      ["ai", "策略", 340],
      ["trigger", "觸發原因", 420],
    ];
    const strategy5Spec = [
      ["rank", "排名", 58],
      ["stock", "股票", 142],
      ["side", "多空", 72],
      ["price", "價格", 86],
      ["pct", "漲幅", 88],
      ["score", "分數", 76],
      ["ai", "策略", 300],
      ["trigger", "觸發原因", 360],
    ];
    const spec = isStrategy4Route(route) ? strategy4Spec : isStrategy5Route(route) ? strategy5Spec : strategy3Spec;
    const base = spec.reduce((sum, item) => sum + item[2], 0);
    const scale = Math.min(1, available / base);
    let x = left;
    return spec.map(([key, label, baseWidth], index) => {
      const widthValue = index >= spec.length - 2
        ? Math.max(180, Math.floor(baseWidth * scale))
        : Math.max(48, Math.floor(baseWidth * scale));
      const column = { key, label, x, width: widthValue };
      x += widthValue;
      return column;
    }).filter((column) => column.x < width - right - 32);
  }

  function drawCanvasPill(ctx, text, x, y, width, colors, tone = "neutral") {
    const fill = tone === "up" ? "rgba(248,64,86,0.18)" : tone === "accent" ? "rgba(255,112,55,0.20)" : "rgba(148,163,184,0.14)";
    const stroke = tone === "up" ? "rgba(248,64,86,0.42)" : tone === "accent" ? "rgba(255,112,55,0.44)" : "rgba(148,163,184,0.22)";
    ctx.fillStyle = fill;
    roundRect(ctx, x, y - 17, width, 28, 14);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y - 16.5, width - 1, 27, 14);
    ctx.stroke();
    ctx.fillStyle = tone === "up" ? colors.down : tone === "accent" ? colors.accent : colors.text;
    ctx.font = "800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(compactText(text, Math.max(2, Math.floor(width / 13))), x + 14, y + 1);
  }

  function drawStrategy4TriangleMiniChart(ctx, row, x, y, width, height, colors) {
    const triangle = row?.triangleBreakout;
    const lines = triangle?.chartLines;
    const upper = lines?.upperResistance?.points;
    const lower = lines?.lowerSupport?.points;
    const marker = lines?.breakoutMarker;
    const hasSignal = Array.isArray(row?.signals) && row.signals.some((signal) => signal?.id === "triangle_breakout");
    if (!triangle?.detected && !hasSignal) return false;
    if (!Array.isArray(upper) || upper.length < 2 || !Array.isArray(lower) || lower.length < 2) return false;
    const prices = [
      ...upper.map((point) => cleanNumber(point?.price)),
      ...lower.map((point) => cleanNumber(point?.price)),
      cleanNumber(marker?.price),
    ].filter((value) => Number.isFinite(value) && value > 0);
    if (prices.length < 4) return false;
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const pad = Math.max((maxPrice - minPrice) * 0.16, maxPrice * 0.01, 1);
    const yMin = minPrice - pad;
    const yMax = maxPrice + pad;
    const mapY = (price) => y + height - ((cleanNumber(price) - yMin) / Math.max(yMax - yMin, 1)) * height;
    const mapX = (points, index) => x + (width * index) / Math.max(points.length - 1, 1);
    const drawLine = (points, color) => {
      ctx.beginPath();
      points.forEach((point, index) => {
        const px = mapX(points, index);
        const py = mapY(point?.price);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    ctx.save();
    ctx.fillStyle = canvasThemeMode() === "light" ? "rgba(255,247,237,0.88)" : "rgba(15,23,42,0.76)";
    roundRect(ctx, x - 6, y - 6, width + 12, height + 16, 8);
    ctx.fill();
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 1;
    roundRect(ctx, x - 5.5, y - 5.5, width + 11, height + 15, 8);
    ctx.stroke();
    drawLine(upper, "rgba(248,113,113,0.92)");
    drawLine(lower, "rgba(34,197,94,0.92)");
    if (marker?.price) {
      const dotX = x + width;
      const dotY = mapY(marker.price);
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = colors.muted;
    ctx.font = "800 10px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText("支/壓線", x, y + height + 10);
    ctx.restore();
    return true;
  }

  function fillCanvasMultiline(ctx, text, x, y, maxChars, lineHeight, maxLines) {
    const raw = compactText(text || "", maxChars * maxLines + 8);
    if (!raw) return;
    const lines = [];
    let rest = raw;
    while (rest && lines.length < maxLines) {
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  }

  function radarCanvasSide(row) {
    const raw = String(row?.side || row?.direction || row?.bias || row?.type || "").toLowerCase();
    if (/short|bear|空|down/.test(raw)) return "short";
    if (/long|bull|多|up/.test(raw)) return "long";
    const pct = Number(String(row?.pct ?? row?.percent ?? row?.changePercent ?? row?.change ?? "").replace(/[,+%]/g, ""));
    return Number.isFinite(pct) && pct < 0 ? "short" : "long";
  }

  function radarCanvasMoney(value) {
    const n = Number(String(value ?? "").replace(/[,+]/g, ""));
    if (!Number.isFinite(n) || !n) return "--";
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(abs >= 1000000000 ? 1 : 2)} 億`;
    if (abs >= 10000) return `${sign}${Math.round(abs / 10000).toLocaleString("zh-TW")} 萬`;
    return `${sign}${Math.round(abs).toLocaleString("zh-TW")}`;
  }

  function radarCanvasValue(row) {
    return Number(row?.value || row?.tradeValue || row?.amount || row?.volumeValue || 0) || 0;
  }

  function radarCanvasPct(row) {
    const pct = Number(String(row?.pct ?? row?.percent ?? row?.changePercent ?? row?.change ?? "").replace(/[,+%]/g, ""));
    return Number.isFinite(pct) ? pct : 0;
  }

  function radarCanvasTags(row) {
    const chunks = [row?.line, row?.reason, row?.signalLine, row?.signalsText, row?.tags]
      .flatMap((item) => Array.isArray(item) ? item : String(item || "").split(/[\/｜,，、]/u));
    return [...new Set(chunks.map((item) => compactText(String(item || "").trim(), 12)).filter(Boolean))].slice(0, 5);
  }

  function drawRealtimeRadarCanvasRows(ctx, colors, width, height, rows, source) {
    const list = Array.isArray(rows) ? rows : [];
    const longRows = list.filter((row) => radarCanvasSide(row) === "long").sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    const shortRows = list.filter((row) => radarCanvasSide(row) === "short").sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    const longFlow = longRows.reduce((sum, row) => sum + Math.max(radarCanvasValue(row), 0), 0);
    const shortFlow = shortRows.reduce((sum, row) => sum + Math.max(radarCanvasValue(row), 0), 0);
    const netFlow = longFlow - shortFlow;
    const totalFlow = Math.max(longFlow + shortFlow, 1);
    const longShare = Math.max(5, Math.min(95, longFlow / totalFlow * 100));
    const activeSide = longFlow >= shortFlow ? "long" : "short";
    const activeRows = (activeSide === "long" ? longRows : shortRows).slice(0, Math.max(3, Math.floor((height - 360) / 76)));
    const red = "#ff4d5c";
    const green = "#23d59a";
    const gold = "#fbbf24";
    const panel = (x, y, w, h, stroke, fill) => {
      ctx.fillStyle = fill;
      roundRect(ctx, x, y, w, h, 8);
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8);
      ctx.stroke();
    };

    panel(24, 86, width - 48, 104, "rgba(32,201,151,0.55)", "rgba(8,14,21,0.94)");
    ctx.fillStyle = colors.muted;
    ctx.font = "800 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText("◎ AI 即時判斷", 42, 112);
    ctx.textAlign = "right";
    ctx.fillText(`信心 ${Math.max(55, Math.min(95, Math.round(Math.max(longShare, 100 - longShare))))}%`, width - 42, 112);
    ctx.textAlign = "left";
    const aiW = (width - 96) / 2;
    panel(42, 124, aiW, 50, "rgba(255,77,92,0.34)", "rgba(255,77,92,0.08)");
    panel(54 + aiW, 124, aiW, 50, "rgba(35,213,154,0.34)", "rgba(35,213,154,0.12)");
    ctx.font = "900 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = red;
    ctx.fillText(`↗ 偏多 AI 分析 ${longRows.length} 檔`, 58, 143);
    ctx.fillStyle = green;
    ctx.fillText(`↘ 偏空 AI 分析 ${shortRows.length} 檔`, 70 + aiW, 143);
    ctx.font = "800 11px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = "#ffd8dc";
    ctx.fillText(compactText(longRows.slice(0, 5).map((row) => `${row.code} ${row.title || row.name || ""}`).join("　") || "等待多方訊號", 68), 58, 162);
    ctx.fillStyle = "#c7ffeb";
    ctx.fillText(compactText(shortRows.slice(0, 5).map((row) => `${row.code} ${row.title || row.name || ""}`).join("　") || "等待空方訊號", 68), 70 + aiW, 162);

    panel(24, 204, width - 48, 120, "rgba(251,191,36,0.24)", "rgba(9,14,20,0.92)");
    const mid = width / 2;
    ctx.strokeStyle = "rgba(134,151,190,0.18)";
    ctx.beginPath();
    ctx.moveTo(mid, 220);
    ctx.lineTo(mid, 268);
    ctx.stroke();
    ctx.fillStyle = colors.muted;
    ctx.font = "800 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText("多方流入", 42, 232);
    ctx.fillText("空方流出", mid + 18, 232);
    ctx.fillStyle = red;
    ctx.font = "950 28px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(radarCanvasMoney(longFlow), 42, 264);
    ctx.fillStyle = green;
    ctx.fillText(radarCanvasMoney(shortFlow), mid + 18, 264);
    ctx.fillStyle = colors.muted;
    ctx.font = "800 11px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(`${longRows.length} 檔`, 42, 286);
    ctx.fillText(`${shortRows.length} 檔`, mid + 18, 286);
    ctx.fillText("淨流向", 42, 306);
    ctx.textAlign = "center";
    ctx.fillStyle = netFlow >= 0 ? red : green;
    ctx.font = "950 26px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(radarCanvasMoney(netFlow), width / 2, 308);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(11,18,33,0.96)";
    roundRect(ctx, 42, 314, width - 84, 7, 4);
    ctx.fill();
    ctx.fillStyle = green;
    roundRect(ctx, 42, 314, (width - 84) * (longShare / 100), 7, 4);
    ctx.fill();

    ctx.strokeStyle = "rgba(251,191,36,0.25)";
    ctx.beginPath();
    ctx.moveTo(24, 352);
    ctx.lineTo(width - 24, 352);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = activeSide === "long" ? red : colors.muted;
    ctx.font = "950 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText("多方", width * 0.25, 340);
    ctx.fillStyle = activeSide === "short" ? colors.muted : "#7182ab";
    ctx.fillText("空方", width * 0.75, 340);
    ctx.fillStyle = activeSide === "long" ? red : "rgba(120,144,188,0.5)";
    roundRect(ctx, activeSide === "long" ? 24 : width / 2, 350, width / 2 - 24, 3, 2);
    ctx.fill();
    ctx.textAlign = "left";

    activeRows.forEach((row, index) => {
      const y = 368 + index * 76;
      if (y + 64 > height - 20) return;
      const side = radarCanvasSide(row);
      const tone = side === "short" ? green : red;
      panel(24, y, width - 48, 64, side === "short" ? "rgba(120,144,188,0.24)" : "rgba(255,77,92,0.32)", "rgba(8,13,20,0.94)");
      ctx.fillStyle = gold;
      ctx.font = "950 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(row.time || row.updatedTime || row.signalTime || "--:--", 42, y + 35);
      ctx.fillStyle = colors.title;
      ctx.font = "950 16px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(compactText(`${row.title || row.name || row.code} ${row.code || ""}`, 18), 116, y + 25);
      ctx.fillStyle = colors.muted;
      ctx.font = "800 11px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(compactText(`成交金額 ${radarCanvasMoney(radarCanvasValue(row))} · 分數 ${Math.round(Number(row.score || 0) || 0)}`, 42), 116, y + 44);
      ctx.fillStyle = tone;
      ctx.textAlign = "right";
      ctx.font = "950 20px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(String(row.price || row.close || "--"), width - 520, y + 31);
      ctx.font = "900 11px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      const pct = radarCanvasPct(row);
      ctx.fillText(`${pct >= 0 ? "▲ +" : ""}${pct.toFixed(2)}%`, width - 520, y + 49);
      ctx.textAlign = "left";
      ctx.strokeStyle = "rgba(251,191,36,0.2)";
      [width - 488, width - 250].forEach((x) => {
        ctx.beginPath();
        ctx.moveTo(x, y + 12);
        ctx.lineTo(x, y + 52);
        ctx.stroke();
      });
      ctx.fillStyle = tone;
      ctx.font = "900 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      const tags = radarCanvasTags(row);
      tags.slice(0, 3).forEach((tag, tagIndex) => ctx.fillText(tag, width - 468, y + 20 + tagIndex * 16));
      tags.slice(3, 5).forEach((tag, tagIndex) => ctx.fillText(tag, width - 228, y + 20 + tagIndex * 16));
    });

    ctx.fillStyle = colors.muted;
    ctx.font = "700 11px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(compactText(source || "api", 42), 42, height - 14);
  }

  function drawWideStrategyCanvasRows(ctx, colors, width, height, rows, rowsToDraw, source, capacity, rowHeight, headerHeight) {
    const columns = wideStrategyColumnLayout(width, canvasState.route);
    const col = (key) => columns.find((item) => item.key === key) || { x: width - 120, width: 90 };
    ctx.fillStyle = colors.header;
    roundRect(ctx, 24, 88, width - 48, 38, 8);
    ctx.fill();
    ctx.fillStyle = colors.muted;
    ctx.font = "800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    columns.forEach((column) => ctx.fillText(column.label, column.x + 6, 112));

    if (!rowsToDraw.length) {
      for (let i = 0; i < 4; i += 1) {
        const y = headerHeight + 18 + i * rowHeight;
        ctx.fillStyle = colors.skeleton.replace("0.16", String(0.15 - i * 0.018));
        roundRect(ctx, 42, y, width - 84 - i * 34, 20, 10);
        ctx.fill();
      }
      ctx.fillStyle = colors.muted;
      ctx.font = "700 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(source.includes("canvas") ? "讀取策略快照中" : "已切換，背景同步策略 API", 44, height - 28);
      return;
    }

    rowsToDraw.forEach((row, index) => {
      const globalIndex = canvasState.offset + index;
      const y = headerHeight + index * rowHeight + 38;
      const active = globalIndex === canvasState.selectedIndex;
      const hover = globalIndex === canvasState.hoverIndex;
      ctx.fillStyle = active ? colors.accentSoft : hover ? colors.accentHover : index % 2 ? colors.rowAlt : colors.row;
      roundRect(ctx, 24, y - 40, width - 48, rowHeight - 10, 10);
      ctx.fill();
      if (active || hover) {
        ctx.strokeStyle = active ? colors.accent : colors.stroke;
        ctx.lineWidth = 1;
        roundRect(ctx, 24.5, y - 39.5, width - 49, rowHeight - 11, 10);
        ctx.stroke();
      }

      ctx.fillStyle = colors.accent;
      ctx.font = "900 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(`#${row.rank || globalIndex + 1}`, col("rank").x + 6, y - 2);

      ctx.fillStyle = colors.text;
      ctx.font = "900 15px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(compactText(row.title || row.code || "--", 8), col("stock").x + 6, y - 13);
      ctx.fillStyle = colors.muted;
      ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(row.code || "--", col("stock").x + 6, y + 9);

      drawCanvasPill(ctx, row.longShort || "多", col("side").x + 6, y - 2, Math.min(56, col("side").width - 10), colors, "up");

      ctx.fillStyle = colors.text;
      ctx.font = "800 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(formatPriceValue(row.price) || "--", col("price").x + 6, y - 2);
      const pctText = row.pct || formatPercentValue(row.pct);
      ctx.fillStyle = String(pctText).includes("-") ? colors.down : colors.up;
      ctx.fillText(pctText || "--", col("pct").x + 6, y - 2);
      ctx.fillStyle = colors.text;
      ctx.fillText(row.score || "--", col("score").x + 6, y - 2);

      ctx.fillStyle = colors.up;
      ctx.font = "900 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(row.strategyDisplay || row.subStrategy || "--", col("ai").x + 6, y - 24);
      ctx.fillStyle = colors.muted;
      ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      fillCanvasMultiline(ctx, row.signalLine || row.aiSummary || row.reason || row.line, col("ai").x + 6, y - 2, Math.max(14, Math.floor((col("ai").width - 12) / 13)), 18, 3);

      const tags = Array.isArray(row.triggerTags) ? row.triggerTags.slice(0, 2) : [];
      let tagX = col("trigger").x + 6;
      tags.forEach((tag, tagIndex) => {
        const tagWidth = Math.min(86, Math.max(58, tag.length * 15));
        drawCanvasPill(ctx, tag, tagX, y - 24, tagWidth, colors, tagIndex ? "neutral" : "accent");
        tagX += tagWidth + 6;
      });
      const triggerColumn = col("trigger");
      const chartWidth = Math.min(142, Math.max(108, Math.floor(triggerColumn.width * 0.34)));
      const chartHeight = Math.min(46, Math.max(34, rowHeight - 34));
      const chartX = triggerColumn.x + triggerColumn.width - chartWidth - 10;
      const chartY = y - 28;
      const hasTriangleChart = isStrategy4Route(canvasState.route)
        && drawStrategy4TriangleMiniChart(ctx, row, chartX, chartY, chartWidth, chartHeight, colors);
      const reasonWidth = hasTriangleChart
        ? Math.max(14, Math.floor((chartX - triggerColumn.x - 20) / 13))
        : Math.max(14, Math.floor((triggerColumn.width - 12) / 13));
      ctx.fillStyle = colors.muted;
      ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      fillCanvasMultiline(ctx, row.triggerReason || row.reason || row.line, triggerColumn.x + 6, y + 10, reasonWidth, 18, 2);
    });

  }

  function canvasHitIndex(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const headerHeight = canvasHeaderHeightForRoute();
    const rowHeight = canvasRowHeightForRoute();
    if (y < headerHeight) return -1;
    const localIndex = Math.floor((y - headerHeight) / rowHeight);
    const index = canvasState.offset + localIndex;
    return index >= 0 && index < canvasState.filtered.length ? index : -1;
  }

  function hideCanvasDetail() {
    const detail = currentCanvasShell()?.querySelector(".desktop-canvas-detail");
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = "";
    }
  }

  function strategy4TriangleDetailHtml(row) {
    const triangle = row?.triangleBreakout;
    const lines = triangle?.chartLines;
    const upper = lines?.upperResistance?.points;
    const lower = lines?.lowerSupport?.points;
    const marker = lines?.breakoutMarker;
    const candles = Array.isArray(triangle?.chartCandles)
      ? triangle.chartCandles.filter((item) =>
          item?.date &&
          cleanNumber(item.high) > 0 &&
          cleanNumber(item.low) > 0 &&
          cleanNumber(item.close) > 0
        )
      : [];
    const hasSignal = Array.isArray(row?.signals) && row.signals.some((signal) => signal?.id === "triangle_breakout");
    if (!triangle?.detected && !hasSignal) return "";
    if (!Array.isArray(upper) || upper.length < 2 || !Array.isArray(lower) || lower.length < 2) return "";
    const prices = [
      ...candles.flatMap((item) => [cleanNumber(item.high), cleanNumber(item.low), cleanNumber(item.open), cleanNumber(item.close)]),
      ...upper.map((point) => cleanNumber(point?.price)),
      ...lower.map((point) => cleanNumber(point?.price)),
      cleanNumber(marker?.price),
    ].filter((value) => Number.isFinite(value) && value > 0);
    if (prices.length < 4) return "";
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const pad = Math.max((maxPrice - minPrice) * 0.16, maxPrice * 0.01, 1);
    const yMin = minPrice - pad;
    const yMax = maxPrice + pad;
    const hasCandles = candles.length >= 8;
    const chartLeft = 28;
    const chartTop = 22;
    const chartWidth = 424;
    const chartHeight = hasCandles ? 106 : 118;
    const volumeTop = 138;
    const volumeHeight = 24;
    const candleWidth = hasCandles ? Math.max(3, Math.min(9, (chartWidth / candles.length) * 0.58)) : 0;
    const mapY = (price) => chartTop + chartHeight - ((cleanNumber(price) - yMin) / Math.max(yMax - yMin, 1)) * chartHeight;
    const dateIndex = new Map(candles.map((item, index) => [String(item.date || ""), index]));
    const mapDateX = (date, fallbackIndex, fallbackCount) => {
      if (hasCandles && dateIndex.has(String(date || ""))) {
        return chartLeft + (chartWidth * dateIndex.get(String(date || ""))) / Math.max(candles.length - 1, 1);
      }
      return chartLeft + (chartWidth * fallbackIndex) / Math.max(fallbackCount - 1, 1);
    };
    const toPolyline = (points) => points.map((point, index) => `${mapDateX(point?.date, index, points.length).toFixed(1)},${mapY(point?.price).toFixed(1)}`).join(" ");
    const candleSvg = hasCandles ? candles.map((item, index) => {
      const x = mapDateX(item.date, index, candles.length);
      const openY = mapY(item.open);
      const closeY = mapY(item.close);
      const highY = mapY(item.high);
      const lowY = mapY(item.low);
      const bodyY = Math.min(openY, closeY);
      const bodyH = Math.max(Math.abs(openY - closeY), 2);
      const up = cleanNumber(item.close) >= cleanNumber(item.open);
      return `
          <line x1="${escapeHtml(x.toFixed(1))}" y1="${escapeHtml(highY.toFixed(1))}" x2="${escapeHtml(x.toFixed(1))}" y2="${escapeHtml(lowY.toFixed(1))}" class="${up ? "wick-up" : "wick-down"}" />
          <rect x="${escapeHtml((x - candleWidth / 2).toFixed(1))}" y="${escapeHtml(bodyY.toFixed(1))}" width="${escapeHtml(candleWidth.toFixed(1))}" height="${escapeHtml(bodyH.toFixed(1))}" rx="1.8" class="${up ? "candle-up" : "candle-down"}" />
        `;
    }).join("") : "";
    const volumeMax = Math.max(cleanNumber(triangle.volumeMax), ...candles.map((item) => cleanNumber(item.volume)), 1);
    const volumeSvg = hasCandles ? candles.map((item, index) => {
      const x = mapDateX(item.date, index, candles.length);
      const barH = Math.max(2, (cleanNumber(item.volume) / volumeMax) * volumeHeight);
      const up = cleanNumber(item.close) >= cleanNumber(item.open);
      return `<rect x="${escapeHtml((x - candleWidth / 2).toFixed(1))}" y="${escapeHtml((volumeTop + volumeHeight - barH).toFixed(1))}" width="${escapeHtml(candleWidth.toFixed(1))}" height="${escapeHtml(barH.toFixed(1))}" rx="1.6" class="${up ? "volume-up" : "volume-down"}" />`;
    }).join("") : "";
    const markerX = hasCandles && marker?.date ? mapDateX(marker.date, candles.length - 1, candles.length) : chartLeft + chartWidth;
    const markerY = mapY(marker?.price);
    return `
      <section class="desktop-triangle-chart" data-strategy4-triangle-chart="1">
        <div class="desktop-triangle-chart-head">
          <strong>三角收斂支撐 / 壓力線</strong>
          <span>壓 ${escapeHtml(formatPriceValue(triangle.resistance) || triangle.resistance || "--")}｜支 ${escapeHtml(formatPriceValue(triangle.support) || triangle.support || "--")}｜突破 ${escapeHtml(formatPriceValue(triangle.breakoutPrice) || triangle.breakoutPrice || "--")}</span>
        </div>
        <svg viewBox="0 0 480 176" role="img" aria-label="三角收斂K棒支撐壓力線">
          <line x1="28" y1="44" x2="452" y2="44" class="grid-line" />
          <line x1="28" y1="78" x2="452" y2="78" class="grid-line" />
          <line x1="28" y1="112" x2="452" y2="112" class="grid-line" />
          <line x1="28" y1="150" x2="452" y2="150" class="axis" />
          ${candleSvg}
          <polyline points="${escapeHtml(toPolyline(upper))}" class="resistance" />
          <polyline points="${escapeHtml(toPolyline(lower))}" class="support" />
          <circle cx="${escapeHtml(markerX.toFixed(1))}" cy="${escapeHtml(markerY.toFixed(1))}" r="6" class="breakout" />
          ${volumeSvg}
          <text x="28" y="18" class="label">壓力線</text>
          <text x="28" y="170" class="label support-label">量能 / 支撐</text>
          <text x="374" y="${escapeHtml(String(Math.max(22, markerY - 10)))}" class="label breakout-label">突破</text>
        </svg>
      </section>
    `;
  }

  function showCanvasDetail(row, index) {
    const detail = currentCanvasShell()?.querySelector(".desktop-canvas-detail");
    if (!detail || !row) return;
    const signalChips = (row.signals || []).slice(0, 8).map((signal) => `
      <span class="desktop-canvas-signal-chip">
        ${escapeHtml(signal.label || signal.id || "")}
        ${signal.reason ? `<small>${escapeHtml(signal.reason)}</small>` : ""}
      </span>
    `).join("");
    detail.hidden = false;
    detail.innerHTML = `
      <div class="desktop-canvas-detail-panel">
        <button type="button" class="desktop-canvas-detail-close" data-canvas-detail-close aria-label="關閉">×</button>
        <div class="desktop-canvas-detail-kicker">#${escapeHtml(row.rank || index + 1)} · ${escapeHtml(canvasState.route.replace("strategy|", ""))}</div>
        <h3>${escapeHtml(row.code || "--")} ${escapeHtml(row.title || "")}</h3>
        ${row.subStrategy ? `<div class="desktop-canvas-detail-substrategy">${escapeHtml(row.subStrategy)}</div>` : ""}
        <p>${escapeHtml(row.reason || row.line || "目前沒有更多說明。")}</p>
        ${isStrategy4Route(canvasState.route) ? strategy4TriangleDetailHtml(row) : ""}
        ${signalChips ? `<div class="desktop-canvas-signal-list">${signalChips}</div>` : ""}
        <div class="desktop-canvas-detail-grid">
          ${isStrategy4Route(canvasState.route) ? `
            <span>分區 <strong>${escapeHtml(row.swingZoneLabel || (row.swingZone ? `${row.swingZone}區` : "--"))}</strong></span>
          ` : ""}
          <span>分數 <strong>${escapeHtml(row.score || "--")}</strong></span>
          <span>漲幅 <strong>${escapeHtml(row.pct || "--")}</strong></span>
          <span>價格 <strong>${escapeHtml(formatPriceValue(row.price) || row.price || "--")}</strong></span>
          <span>多空 <strong>${escapeHtml(row.longShort || "多")}</strong></span>
          ${isWideStrategyTableRoute(canvasState.route) ? `
            <span>策略 <strong>${escapeHtml(row.strategyDisplay || row.subStrategy || row.signalLine || "--")}</strong></span>
          ` : ""}
        </div>
      </div>
    `;
  }

  function installCanvasHandlers() {
    if (document.documentElement.dataset.fumanCanvasHandlersReady === "1") return;
    document.documentElement.dataset.fumanCanvasHandlersReady = "1";

    document.addEventListener("input", (event) => {
      const input = event.target.closest?.(".desktop-canvas-search");
      if (!input) return;
      canvasState.query = input.value || "";
      canvasState.offset = 0;
      canvasState.hoverIndex = -1;
      applyCanvasFilter();
      setCanvasStatus("搜尋套用");
      scheduleCanvasDraw();
    }, true);

    document.addEventListener("click", (event) => {
      const radarSide = event.target.closest?.("[data-radar-dom-side]");
      if (radarSide) {
        event.preventDefault();
        realtimeRadarDomSide = ["long", "short"].includes(radarSide.dataset.radarDomSide) ? radarSide.dataset.radarDomSide : "long";
        realtimeRadarDomSideUserSelected = true;
        renderRealtimeRadarDomShell(linkForRouteKey(REALTIME_RADAR_ROUTE) || REALTIME_RADAR_ROUTE, canvasState.source || "dom", canvasState.rows);
        return;
      }
      const radarRefresh = event.target.closest?.("[data-radar-dom-refresh]");
      if (radarRefresh) {
        event.preventDefault();
        radarRefresh.disabled = true;
        radarRefresh.textContent = "更新中";
        fetchCanvasRows(REALTIME_RADAR_ROUTE, true).then((apiRows) => {
          if (apiRows?.length) {
            renderRealtimeRadarDomShell(linkForRouteKey(REALTIME_RADAR_ROUTE) || REALTIME_RADAR_ROUTE, "api", apiRows);
          } else {
            renderRealtimeRadarDomShell(linkForRouteKey(REALTIME_RADAR_ROUTE) || REALTIME_RADAR_ROUTE, canvasState.source || "api", canvasState.rows);
          }
        }).catch(() => {
          renderRealtimeRadarDomShell(linkForRouteKey(REALTIME_RADAR_ROUTE) || REALTIME_RADAR_ROUTE, canvasState.source || "api", canvasState.rows);
        }).finally(() => {
          radarRefresh.disabled = false;
          radarRefresh.textContent = "刷新";
        });
        return;
      }
      const close = event.target.closest?.("[data-canvas-detail-close]");
      if (close) {
        event.preventDefault();
        hideCanvasDetail();
        return;
      }
      const refresh = event.target.closest?.("[data-canvas-refresh]");
      if (refresh) {
        event.preventDefault();
        const route = canvasState.route || activeSnapshotRoute;
        setCanvasStatus("更新中");
        fetchCanvasRows(route, true).then(() => {
          if (canvasState.route === route) {
            applyCanvasFilter();
            if (isStrategy2Route(route)) {
              updateStrategy2BattleShell(currentCanvasShell(), route, strategyMeta(route));
              setCanvasStatus("已刷新");
              return;
            }
            scheduleCanvasDraw();
          }
        }).catch(() => setCanvasStatus("沿用快照"));
        return;
      }
      const signalFilter = event.target.closest?.("[data-strategy4-signal-filter],[data-strategy5-signal-filter]");
      if (signalFilter) {
        event.preventDefault();
        if (!isStrategy4Route(canvasState.route) && !isStrategy5Route(canvasState.route)) return;
        const next = signalFilter.dataset.strategy4SignalFilter || signalFilter.dataset.strategy5SignalFilter || "";
        canvasState.signalFilter = canvasState.signalFilter === next ? "" : next;
        canvasState.offset = 0;
        canvasState.hoverIndex = -1;
        canvasState.selectedIndex = -1;
        hideCanvasDetail();
        applyCanvasFilter();
        updateStrategyFilterControls(currentCanvasShell());
        setCanvasStatus(canvasState.signalFilter ? "細分篩選" : "全部訊號");
        scheduleCanvasDraw();
        return;
      }
      const chipFilter = event.target.closest?.("[data-chip-canvas-filter]");
      if (chipFilter) {
        event.preventDefault();
        if (!isChipTradeRoute(canvasState.route)) return;
        const next = chipFilter.dataset.chipCanvasFilter || CHIP_TRADE_DEFAULT_FILTER;
        if (canvasState.signalFilter === next && canvasState.rows.length) return;
        canvasState.signalFilter = next;
        canvasState.offset = 0;
        canvasState.hoverIndex = -1;
        canvasState.selectedIndex = -1;
        hideCanvasDetail();
        applyCanvasFilter();
        updateChipTradeFilterControls(currentCanvasShell());
        setCanvasStatus("買賣超策略更新中");
        scheduleCanvasDraw();
        fetchCanvasRows(canvasState.route, true).then(() => {
          if (!isChipTradeRoute(canvasState.route) || canvasState.signalFilter !== next) return;
          applyCanvasFilter();
          updateChipTradeFilterControls(currentCanvasShell());
          setCanvasStatus("買賣超策略套用");
          scheduleCanvasDraw();
        }).catch(() => setCanvasStatus("沿用快照"));
        return;
      }
      const zoneFilter = event.target.closest?.("[data-strategy4-zone-filter]");
      if (zoneFilter) {
        event.preventDefault();
        if (!isStrategy4Route(canvasState.route)) return;
        const next = String(zoneFilter.dataset.strategy4ZoneFilter || "").toUpperCase();
        canvasState.zoneFilter = canvasState.zoneFilter === next ? "" : next;
        canvasState.offset = 0;
        canvasState.hoverIndex = -1;
        canvasState.selectedIndex = -1;
        hideCanvasDetail();
        applyCanvasFilter();
        updateStrategyFilterControls(currentCanvasShell());
        setCanvasStatus(canvasState.zoneFilter ? `${canvasState.zoneFilter}區篩選` : "全部分區");
        scheduleCanvasDraw();
        return;
      }
      const pageButton = event.target.closest?.("[data-canvas-page]");
      if (pageButton) {
        event.preventDefault();
        const pageSize = canvasPageSizeForRoute();
        if (!pageSize) return;
        const totalPages = Math.max(1, Math.ceil(canvasState.filtered.length / pageSize));
        const currentPage = Math.min(totalPages, Math.floor(canvasState.offset / pageSize) + 1);
        const action = pageButton.dataset.canvasPage || "1";
        const nextPage = action === "prev"
          ? currentPage - 1
          : action === "next"
            ? currentPage + 1
            : cleanNumber(action) || 1;
        canvasState.offset = (Math.max(1, Math.min(totalPages, nextPage)) - 1) * pageSize;
        canvasState.hoverIndex = -1;
        canvasState.selectedIndex = -1;
        hideCanvasDetail();
        setCanvasStatus("分頁切換");
        scheduleCanvasDraw();
        return;
      }
      const canvas = event.target.closest?.(".desktop-route-canvas");
      if (!canvas) return;
      const index = canvasHitIndex(canvas, event);
      if (index < 0) return;
      canvasState.selectedIndex = index;
      showCanvasDetail(canvasState.filtered[index], index);
      scheduleCanvasDraw();
      event.preventDefault();
    }, true);

    document.addEventListener("pointermove", (event) => {
      const canvas = event.target.closest?.(".desktop-route-canvas");
      if (!canvas) return;
      const index = canvasHitIndex(canvas, event);
      if (index === canvasState.hoverIndex) return;
      canvasState.hoverIndex = index;
      scheduleCanvasDraw();
    }, true);

    document.addEventListener("pointerout", (event) => {
      const canvas = event.target.closest?.(".desktop-route-canvas");
      if (!canvas || canvas.contains(event.relatedTarget)) return;
      if (canvasState.hoverIndex === -1) return;
      canvasState.hoverIndex = -1;
      scheduleCanvasDraw();
    }, true);

    document.addEventListener("wheel", (event) => {
      const canvas = event.target.closest?.(".desktop-route-canvas");
      if (!canvas) return;
      if (canvasPageSizeForRoute()) return;
      const direction = event.deltaY > 0 ? 1 : -1;
      const step = Math.max(1, Math.min(8, Math.round(Math.abs(event.deltaY) / 42)));
      const oldOffset = canvasState.offset;
      canvasState.offset += direction * step;
      clampCanvasOffset(canvas);
      if (canvasState.offset !== oldOffset) {
        event.preventDefault();
        hideCanvasDetail();
        scheduleCanvasDraw();
      }
    }, { capture: true, passive: false });

    document.addEventListener("keydown", (event) => {
      const canvas = event.target.closest?.(".desktop-route-canvas");
      if (!canvas) return;
      const capacity = visibleCanvasCapacity(canvas);
      const pageSize = canvasPageSizeForRoute();
      const oldOffset = canvasState.offset;
      if (pageSize && (event.key === "ArrowDown" || event.key === "PageDown")) canvasState.offset += pageSize;
      else if (pageSize && (event.key === "ArrowUp" || event.key === "PageUp")) canvasState.offset -= pageSize;
      else if (event.key === "ArrowDown") canvasState.offset += 1;
      else if (event.key === "ArrowUp") canvasState.offset -= 1;
      else if (event.key === "PageDown") canvasState.offset += capacity;
      else if (event.key === "PageUp") canvasState.offset -= capacity;
      else if (event.key === "Home") canvasState.offset = 0;
      else if (event.key === "End") canvasState.offset = canvasState.filtered.length;
      else if (event.key === "Enter" && canvasState.hoverIndex >= 0) {
        showCanvasDetail(canvasState.filtered[canvasState.hoverIndex], canvasState.hoverIndex);
        event.preventDefault();
        return;
      } else {
        return;
      }
      clampCanvasOffset(canvas);
      if (canvasState.offset !== oldOffset) {
        event.preventDefault();
        hideCanvasDetail();
        scheduleCanvasDraw();
      }
    }, true);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function activeStrategyRouteKey() {
    const active = document.querySelector('[data-view="strategy"].active');
    return strategyRouteKey(active) || activeSnapshotRoute;
  }

  function openSnapshotDb() {
    if (!("indexedDB" in window)) return Promise.resolve(null);
    if (snapshotDbPromise) return snapshotDbPromise;
    snapshotDbPromise = new Promise((resolve) => {
      const request = indexedDB.open(SNAPSHOT_DB, 1);
      request.onupgradeneeded = () => {
        try {
          request.result.createObjectStore(SNAPSHOT_STORE, { keyPath: "key" });
        } catch (error) {}
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return snapshotDbPromise;
  }

  function readSessionSnapshot(key) {
    try {
      const raw = sessionStorage.getItem(SNAPSHOT_PREFIX + key);
      if (!raw) return null;
      const item = JSON.parse(raw);
      if ((!item?.html && !item?.rows?.length) || Date.now() - Number(item.at || 0) > SNAPSHOT_MAX_AGE_MS) return null;
      return item;
    } catch (error) {
      return null;
    }
  }

  function writeSessionSnapshot(key, item) {
    try {
      sessionStorage.setItem(SNAPSHOT_PREFIX + key, JSON.stringify(item));
    } catch (error) {}
  }

  async function readIndexedSnapshot(key) {
    const db = await openSnapshotDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(SNAPSHOT_STORE, "readonly");
        const request = tx.objectStore(SNAPSHOT_STORE).get(key);
        request.onsuccess = () => {
          const item = request.result;
          const hasContent = item?.html || item?.rows?.length;
          resolve(hasContent && Date.now() - Number(item.at || 0) <= SNAPSHOT_MAX_AGE_MS ? item : null);
        };
        request.onerror = () => resolve(null);
      } catch (error) {
        resolve(null);
      }
    });
  }

  async function writeIndexedSnapshot(key, item) {
    const db = await openSnapshotDb();
    if (!db) return;
    try {
      const tx = db.transaction(SNAPSHOT_STORE, "readwrite");
      tx.objectStore(SNAPSHOT_STORE).put({ key, ...item });
    } catch (error) {}
  }

  function isWorthSavingSnapshot(panel) {
    const html = panel?.innerHTML || "";
    if (!html || html.length > SNAPSHOT_MAX_CHARS) return false;
    const text = panel.textContent || "";
    if (/正在載入|loading/i.test(text) && html.length < 18000) return false;
    return html.length > 6000 ||
      /strategy5-shell|swing-dashboard|terminal-table|strategy-table|stock-card|<tr|<article/i.test(html);
  }

  function snapshotHtml(panel) {
    try {
      const clone = panel.cloneNode(true);
      clone.querySelectorAll?.(".desktop-route-shell").forEach((node) => node.remove());
      return clone.innerHTML || "";
    } catch (error) {
      return panel?.innerHTML || "";
    }
  }

  function saveStrategySnapshotNow() {
    const panel = document.querySelector("#strategy-view");
    const key = activeStrategyRouteKey();
    if (!key || !panel?.classList?.contains("active") || !isWorthSavingSnapshot(panel)) return;
    const stored = canvasStore.get(key);
    if (stored?.rows?.length && !isDomDerivedSource(stored.source)) {
      const item = {
        at: Date.now(),
        scrollTop: panel.scrollTop || 0,
        html: "",
        rows: stored.rows,
      };
      routeSnapshots.set(key, item);
      writeSessionSnapshot(key, item);
      writeIndexedSnapshot(key, item);
      return;
    }
    const item = {
      at: Date.now(),
      scrollTop: panel.scrollTop || 0,
      html: snapshotHtml(panel),
      rows: [],
    };
    routeSnapshots.set(key, item);
    writeSessionSnapshot(key, item);
    writeIndexedSnapshot(key, item);
  }

  function installApiOnlyCanvasPolling() {
    if (document.documentElement.dataset.fumanApiOnlyCanvasPollingReady === "1") return;
    document.documentElement.dataset.fumanApiOnlyCanvasPollingReady = "1";
    const poll = (reason = "timer") => {
      if (document.hidden || isInteractionHoldActive()) return;
      const route = canvasState.route || activeSnapshotRoute;
      if (isMarketRoute(route)) return;
      if (!isApiOnlySnapshotRoute(route)) return;
      const active = window.__fumanDesktopActiveRoute;
      if (active?.key && active.key !== route) return;
      const before = currentRowsSignature(route);
      fetchCanvasRows(route, true).then((rows) => {
        if (!rows?.length || (window.__fumanDesktopActiveRoute?.key && window.__fumanDesktopActiveRoute.key !== route)) return;
        const next = rowSignature(rows);
        if (before === next && canvasState.route === route) {
          canvasState.source = `api-only-poll-${reason}`;
          if (isStrategy2Route(route)) {
            updateStrategy2BattleShell(currentCanvasShell(), route, strategyMeta(route));
            setCanvasStatus();
            return;
          }
          setCanvasStatus();
          scheduleCanvasDraw();
          return;
        }
        if (canvasState.route === route && currentCanvasShell()) {
          canvasState.rows = rows;
          canvasState.source = `api-only-poll-${reason}`;
          applyCanvasFilter();
          if (isStrategy2Route(route)) {
            updateStrategy2BattleShell(currentCanvasShell(), route, strategyMeta(route));
            setCanvasStatus();
            return;
          }
          scheduleCanvasDraw();
          setCanvasStatus();
          return;
        }
        const fixedLink = FIXED_ROUTE_KEYS.includes(route) ? linkForRouteKey(route) : null;
        if (fixedLink) renderFixedPageShell(fixedLink, `api-only-poll-${reason}`, rows);
        else renderStrategyRouteShell(route, `api-only-poll-${reason}`, rows);
      }).catch(() => undefined);
    };
    window.setInterval(() => poll("interval"), API_ONLY_POLL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") window.setTimeout(() => poll("visible"), 600);
    });
    window.addEventListener("focus", () => window.setTimeout(() => poll("focus"), 700), { passive: true });
  }

  function scheduleStrategySnapshotSave() {
    window.clearTimeout(snapshotTimer);
    snapshotTimer = window.setTimeout(() => {
      if ("requestIdleCallback" in window) {
        requestIdleCallback(saveStrategySnapshotNow, { timeout: 600 });
      } else {
        saveStrategySnapshotNow();
      }
    }, 420);
  }

  function saveFixedPageSnapshotNow(route) {
    if (isMarketRoute(route)) return;
    if (API_ONLY_FIXED_ROUTE_KEYS.includes(String(route || ""))) {
      const stored = canvasStore.get(route);
      if (stored?.rows?.length && !isDomDerivedSource(stored.source)) {
        const item = { at: Date.now(), scrollTop: 0, html: "", rows: stored.rows };
        routeSnapshots.set(route, item);
        writeSessionSnapshot(route, item);
        writeIndexedSnapshot(route, item);
      }
      return;
    }
    const panel = panelForRoute(route);
    if (!route || !panel?.classList?.contains("active") || !isWorthSavingSnapshot(panel)) return;
    const rows = extractLiteRows(panel);
    if (!rows.length) return;
    const item = {
      at: Date.now(),
      scrollTop: panel.scrollTop || 0,
      html: snapshotHtml(panel),
      rows,
    };
    routeSnapshots.set(route, item);
    setCanvasRows(route, rows, "dom-snapshot", item.at);
    writeSessionSnapshot(route, item);
    writeIndexedSnapshot(route, item);
  }

  function applySnapshot(key, item, source) {
    const panel = document.querySelector("#strategy-view");
    if (!key || (!item?.html && !item?.rows?.length) || !panel) return false;
    if (Date.now() - Number(item.at || 0) > SNAPSHOT_MAX_AGE_MS) return false;
    if (isStrategyRoute(key) && !isApiBackedSnapshotItem(item)) return false;
    if (Array.isArray(item.rows) && item.rows.length) {
      setCanvasRows(key, item.rows, `canvas-${source}`, item.at || Date.now());
      renderStrategyRouteShell(key, `canvas-${source}`, item.rows);
      return true;
    }
    const template = document.createElement("template");
    template.innerHTML = item.html || "";
    const rows = extractLiteRows(template.content);
    if (rows.length) setCanvasRows(key, rows, `html-${source}`, item.at || Date.now());
    renderStrategyRouteShell(key, `html-${source}`, rows);
    return true;
  }

  function restoreStrategySnapshot(link) {
    const key = strategyRouteKey(link);
    if (!key) return false;
    if (isApiOnlyPollingRoute(key)) return false;
    activeSnapshotRoute = key;
    const memoryItem = routeSnapshots.get(key);
    if (applySnapshot(key, memoryItem, "memory")) return true;
    const sessionItem = readSessionSnapshot(key);
    if (sessionItem) {
      routeSnapshots.set(key, sessionItem);
      return applySnapshot(key, sessionItem, "session");
    }
    readIndexedSnapshot(key).then((item) => {
      if (!item || activeSnapshotRoute !== key) return;
      routeSnapshots.set(key, item);
      writeSessionSnapshot(key, item);
      applySnapshot(key, item, "indexeddb");
    }).catch(() => undefined);
    return false;
  }

  function scheduleFixedPageSnapshotSave(route) {
    window.clearTimeout(fixedSnapshotTimers.get(route));
    fixedSnapshotTimers.set(route, window.setTimeout(() => {
      const run = () => saveFixedPageSnapshotNow(route);
      if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 900 });
      else run();
    }, 700));
  }

  function installFixedPageSnapshots() {
    if (document.documentElement.dataset.fumanFixedPageSnapshotsReady === "1") return;
    document.documentElement.dataset.fumanFixedPageSnapshotsReady = "1";
    const install = () => {
      FIXED_ROUTE_KEYS.forEach((route) => {
        if (isApiOnlySnapshotRoute(route)) {
          try { sessionStorage.removeItem(SNAPSHOT_PREFIX + route); } catch (error) {}
          routeSnapshots.delete(route);
          canvasStore.delete(route);
          canvasRouteVersions.delete(route);
          return;
        }
        const item = readSessionSnapshot(route);
        if (item) {
          routeSnapshots.set(route, item);
          if (item.rows?.length) setCanvasRows(route, item.rows, "session", item.at || Date.now());
        }
        readIndexedSnapshot(route).then((dbItem) => {
          if (dbItem) {
            routeSnapshots.set(route, dbItem);
            if (dbItem.rows?.length) setCanvasRows(route, dbItem.rows, "indexeddb", dbItem.at || Date.now());
          }
        }).catch(() => undefined);
        const panel = panelForRoute(route);
        if (!panel || panel.dataset.fumanFixedSnapshotReady === "1") return;
        panel.dataset.fumanFixedSnapshotReady = "1";
        new MutationObserver(() => {
          if (panel.dataset.fumanRouteSnapshotRestoring === "1") return;
          scheduleFixedPageSnapshotSave(route);
        }).observe(panel, { childList: true, subtree: true });
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
    else install();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "hidden") return;
      FIXED_ROUTE_KEYS.forEach((route) => saveFixedPageSnapshotNow(route));
    });
  }

  function drawRouteCanvas(canvas, meta, rows = [], source = "") {
    if (!canvas) return;
    const metrics = canvasDrawMetrics(canvas);
    const { width, height, dpr } = metrics;
    const rowHeight = canvasRowHeightForRoute(canvasState.route);
    const headerHeight = canvasHeaderHeightForRoute(canvasState.route);
    const capacity = Math.max(isWideStrategyTableRoute(canvasState.route) ? 3 : 5, Math.floor((height - headerHeight - 16) / rowHeight));
    const rowsToDraw = rows.length ? rows.slice(canvasState.offset, canvasState.offset + capacity) : [];
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const colors = canvasPalette();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, colors.frameA);
    gradient.addColorStop(0.55, colors.frameB);
    gradient.addColorStop(1, colors.frameC);
    ctx.fillStyle = gradient;
    roundRect(ctx, 0.5, 0.5, width - 1, height - 1, 18);
    ctx.fill();
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 1;
    roundRect(ctx, 0.5, 0.5, width - 1, height - 1, 18);
    ctx.stroke();

    ctx.fillStyle = colors.accent;
    ctx.font = "700 28px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(meta.icon, 28, 48);
    ctx.fillStyle = colors.title;
    ctx.font = "800 22px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(meta.title, 70, 42);
    ctx.fillStyle = colors.muted;
    ctx.font = "14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(compactText(meta.summary, 84), 70, 68);
    ctx.textAlign = "right";
    ctx.fillStyle = colors.accent;
    ctx.font = "800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(`${rows.length} 筆`, width - 32, 42);
    ctx.fillStyle = colors.muted;
    ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(compactText(source || "shell", 28), width - 32, 66);
    ctx.textAlign = "left";

    if (isWideStrategyTableRoute(canvasState.route)) {
      drawWideStrategyCanvasRows(ctx, colors, width, height, rows, rowsToDraw, source || "", capacity, rowHeight, headerHeight);
      return;
    }
    if (isChipTradeRoute(canvasState.route)) {
      drawChipTradeCanvasRows(ctx, colors, width, height, rows, rowsToDraw, source || "", capacity, rowHeight, headerHeight);
      return;
    }
    if (canvasState.route === REALTIME_RADAR_ROUTE) {
      drawRealtimeRadarCanvasRows(ctx, colors, width, height, rows, source || "");
      return;
    }

    ctx.fillStyle = colors.header;
    roundRect(ctx, 24, 88, width - 48, 38, 12);
    ctx.fill();
    ctx.fillStyle = colors.muted;
    ctx.font = "700 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText("Rank", 46, 112);
    ctx.fillText("Code", 106, 112);
    ctx.fillText(isStrategy4Route(canvasState.route) ? "細分策略" : isStrategy5Route(canvasState.route) ? "Sub Strategy" : "Signal", 184, 112);
    ctx.fillText("Score", width - 176, 112);
    ctx.fillText("Change", width - 92, 112);

    if (!rowsToDraw.length) {
      const emptyState = currentCanvasEmptyState();
      if (emptyState) {
        const cardY = headerHeight + 24;
        ctx.fillStyle = canvasThemeMode() === "light" ? "rgba(255,247,237,0.95)" : "rgba(15,23,42,0.72)";
        roundRect(ctx, 42, cardY, width - 84, 126, 16);
        ctx.fill();
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 1;
        roundRect(ctx, 42.5, cardY + 0.5, width - 85, 125, 16);
        ctx.stroke();
        ctx.fillStyle = colors.accent;
        ctx.font = "900 18px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillText(emptyState.title, 68, cardY + 42);
        ctx.fillStyle = colors.text;
        ctx.font = "700 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillText(compactText(emptyState.message, 88), 68, cardY + 72);
        ctx.fillStyle = colors.muted;
        ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillText(compactText(`gate: ${emptyState.reason || emptyState.detail || "waiting"}`, 96), 68, cardY + 98);
      } else {
        for (let i = 0; i < 5; i += 1) {
          const y = headerHeight + 18 + i * rowHeight;
          const alpha = 0.16 - i * 0.014;
          ctx.fillStyle = colors.skeleton.replace("0.16", String(alpha));
          roundRect(ctx, 42, y, width - 84 - i * 28, 18, 9);
          ctx.fill();
        }
      }
      ctx.fillStyle = colors.muted;
      ctx.font = "700 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(emptyState ? "受控等待，未使用舊 fallback" : isLiveStrategyRoute(canvasState.route) ? "今日尚無戰鬥訊號，持續即時監控" : source.includes("canvas") ? "讀取快照中" : "已切換，背景同步資料", 44, height - 28);
      return;
    }

    rowsToDraw.forEach((row, index) => {
      const globalIndex = canvasState.offset + index;
      const y = headerHeight + index * rowHeight + 28;
      const active = globalIndex === canvasState.selectedIndex;
      const hover = globalIndex === canvasState.hoverIndex;
      ctx.fillStyle = active
        ? colors.accentSoft
        : hover
          ? colors.accentHover
          : index % 2
            ? colors.rowAlt
            : colors.row;
      roundRect(ctx, 24, y - 29, width - 48, 42, 10);
      ctx.fill();
      if (active || hover) {
        ctx.strokeStyle = active ? colors.accent : colors.stroke;
        ctx.lineWidth = 1;
        roundRect(ctx, 24.5, y - 28.5, width - 49, 41, 10);
        ctx.stroke();
      }
      ctx.fillStyle = colors.accent;
      ctx.font = "800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(String(row.rank || index + 1), 48, y);
      ctx.fillStyle = colors.blue;
      ctx.font = "800 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(row.code || "--", 106, y);
      ctx.fillStyle = colors.text;
      ctx.font = "700 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      const mainText = (isStrategy4Route(canvasState.route) || isStrategy5Route(canvasState.route)) && row.subStrategy
        ? `${row.title || row.code || ""} · ${row.subStrategy}`
        : row.title || row.line || "";
      ctx.fillText(compactText(mainText, 46), 184, y - 6);
      ctx.fillStyle = colors.muted;
      ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(compactText((isStrategy4Route(canvasState.route) || isStrategy5Route(canvasState.route)) ? row.signalLine || row.reason || row.line || "" : row.reason || row.line || "", 74), 184, y + 11);
      ctx.fillStyle = colors.text;
      ctx.textAlign = "right";
      ctx.fillText(row.score || "--", width - 130, y);
      ctx.fillStyle = String(row.pct || "").includes("-") ? colors.down : colors.up;
      ctx.fillText(row.pct || "--", width - 38, y);
      ctx.textAlign = "left";
    });

    if (rows.length > capacity) {
      const trackTop = headerHeight;
      const trackHeight = height - headerHeight - 18;
      const thumbHeight = Math.max(34, trackHeight * (capacity / rows.length));
      const thumbTop = trackTop + (trackHeight - thumbHeight) * (canvasState.offset / Math.max(1, rows.length - capacity));
      ctx.fillStyle = canvasThemeMode() === "light" ? "rgba(100,116,139,0.16)" : "rgba(148,163,184,0.12)";
      roundRect(ctx, width - 14, trackTop, 5, trackHeight, 4);
      ctx.fill();
      ctx.fillStyle = canvasThemeMode() === "light" ? "rgba(249,115,22,0.62)" : "rgba(255,112,55,0.58)";
      roundRect(ctx, width - 14, thumbTop, 5, thumbHeight, 4);
      ctx.fill();
    }
  }

  function drawChipTradeCanvasRows(ctx, colors, width, height, rows, rowsToDraw, source, capacity, rowHeight, headerHeight) {
    const activeFilter = canvasState.signalFilter || CHIP_TRADE_DEFAULT_FILTER;
    const isTdcc = activeFilter === "tdcc1000";
    const columns = isTdcc
      ? [
        ["Rank", 46],
        ["Code", 112],
        ["股票", 184],
        ["外資連買", width - 470],
        ["W1", width - 360],
        ["W2", width - 292],
        ["W3", width - 224],
        ["增幅", width - 154],
        ["分數", width - 76],
      ]
      : [
        ["Rank", 46],
        ["Code", 112],
        ["股票", 184],
        ["外資買超", width - 454],
        ["投信買超", width - 342],
        ["連買", width - 236],
        ["佔均量", width - 144],
        ["漲幅", width - 72],
      ];
    ctx.fillStyle = colors.header;
    roundRect(ctx, 24, 88, width - 48, 38, 12);
    ctx.fill();
    ctx.fillStyle = colors.muted;
    ctx.font = "700 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    columns.forEach(([label, x], index) => {
      ctx.textAlign = index >= 3 ? "right" : "left";
      ctx.fillText(label, x, 112);
    });
    ctx.textAlign = "left";

    if (!rowsToDraw.length) {
      ctx.fillStyle = colors.muted;
      ctx.font = "800 15px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      const label = CHIP_TRADE_FILTERS.find((item) => item.key === activeFilter)?.label || "買賣超";
      ctx.fillText(`${label} 資料同步中，稍後自動更新`, 44, 158);
      ctx.fillStyle = colors.skeleton;
      for (let i = 0; i < 4; i += 1) {
        roundRect(ctx, 42, 188 + i * 42, width - 84 - i * 34, 16, 8);
        ctx.fill();
      }
      return;
    }

    rowsToDraw.forEach((row, index) => {
      const globalIndex = canvasState.offset + index;
      const y = headerHeight + index * rowHeight + 28;
      const active = globalIndex === canvasState.selectedIndex;
      const hover = globalIndex === canvasState.hoverIndex;
      ctx.fillStyle = active
        ? colors.accentSoft
        : hover
          ? colors.accentHover
          : index % 2
            ? colors.rowAlt
            : colors.row;
      roundRect(ctx, 24, y - 29, width - 48, 42, 10);
      ctx.fill();
      ctx.fillStyle = colors.accent;
      ctx.font = "800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(String(row.rank || globalIndex + 1), 48, y);
      ctx.fillStyle = colors.blue;
      ctx.font = "800 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(row.code || "--", 112, y);
      ctx.fillStyle = colors.text;
      ctx.font = "800 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(compactText(row.title || row.name || row.code || "--", 16), 184, y);
      ctx.textAlign = "right";
      ctx.font = "800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      if (isTdcc) {
        ctx.fillStyle = colors.up;
        ctx.fillText(`${Math.round(cleanNumber(row.foreignStreak))}日`, width - 470, y);
        ctx.fillStyle = colors.text;
        ctx.fillText(formatCanvasNumber(row.ratio1, 2), width - 360, y);
        ctx.fillText(formatCanvasNumber(row.ratio2, 2), width - 292, y);
        ctx.fillText(formatCanvasNumber(row.ratio3, 2), width - 224, y);
        ctx.fillStyle = colors.up;
        ctx.fillText(`+${formatCanvasNumber(row.ratioIncrease, 2)}`, width - 154, y);
        ctx.fillStyle = colors.text;
        ctx.fillText(String(row.score || row.breakoutScore || "--"), width - 76, y);
      } else {
        const foreign = cleanNumber(row.foreign);
        const trust = cleanNumber(row.trust);
        ctx.fillStyle = foreign >= 0 ? colors.up : colors.down;
        ctx.fillText(formatCanvasLots(foreign), width - 454, y);
        ctx.fillStyle = trust >= 0 ? colors.up : colors.down;
        ctx.fillText(formatCanvasLots(trust), width - 342, y);
        ctx.fillStyle = colors.text;
        ctx.fillText(`${Math.round(cleanNumber(row.foreignStreak))}/${Math.round(cleanNumber(row.trustStreak))}/${Math.round(cleanNumber(row.jointStreak))}`, width - 236, y);
        ctx.fillStyle = colors.accent;
        ctx.fillText(`${formatCanvasNumber(chipTradeForeignTrustVolumePct(row), 2)}%`, width - 144, y);
        ctx.fillStyle = String(row.pct || "").includes("-") ? colors.down : colors.up;
        ctx.fillText(row.pct || "--", width - 72, y);
      }
      ctx.textAlign = "left";
    });

    if (rows.length > capacity) {
      const trackTop = headerHeight;
      const trackHeight = Math.max(80, height - headerHeight - 40);
      const thumbHeight = Math.max(32, trackHeight * (capacity / rows.length));
      const thumbTop = trackTop + (trackHeight - thumbHeight) * (canvasState.offset / Math.max(1, rows.length - capacity));
      ctx.fillStyle = "rgba(148,163,184,0.18)";
      roundRect(ctx, width - 16, trackTop, 5, trackHeight, 3);
      ctx.fill();
      ctx.fillStyle = colors.accent;
      roundRect(ctx, width - 16, thumbTop, 5, thumbHeight, 3);
      ctx.fill();
    }
    ctx.fillStyle = colors.muted;
    ctx.font = "700 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(`${CHIP_TRADE_FILTERS.find((item) => item.key === activeFilter)?.label || "買賣超"}｜${compactText(source || "snapshot", 24)}`, 32, height - 24);
  }

  function formatCanvasNumber(value, digits = 0) {
    const number = cleanNumber(value);
    if (!Number.isFinite(number)) return "--";
    return number.toLocaleString("zh-TW", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  }

  function formatCanvasLots(value) {
    const number = cleanNumber(value);
    if (!number) return "--";
    const lots = Math.round(Math.abs(number) >= 100000 ? number / 1000 : number);
    return `${number > 0 ? "+" : ""}${lots.toLocaleString("zh-TW")}`;
  }

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawCanvasShellFrame(canvas, meta) {
    requestAnimationFrame(() => {
      if (!isStrategyRoute(canvasState.route) || isWideStrategyTableRoute(canvasState.route) || !drawCanvasWithWorker(canvas)) {
        drawRouteCanvas(canvas, meta, canvasState.filtered, canvasState.source);
      }
      setCanvasStatus();
    });
  }

  function strategy4SignalCounts(rows = []) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const signals = row?.signals?.length ? [...row.signals] : row?.subStrategy ? [{ id: row.subStrategyId || row.subStrategy, label: row.subStrategy }] : [];
      if (row?.triangleBreakout && typeof row.triangleBreakout === "object") {
        signals.push({
          id: "triangle_breakout",
          label: row.triangleBreakout.label || STRATEGY4_SIGNAL_LABELS.triangle_breakout || "三角收斂起漲",
        });
      }
      signals.forEach((signal) => {
        const key = compactText(signal.id || signal.label || "", 48);
        const label = compactText(strategy4SignalLabel(key) || signal.label || signal.id || "", 28);
        if (!key || !label) return;
        const current = map.get(key) || { key, label, count: 0 };
        current.count += 1;
        map.set(key, current);
      });
    });
    const ordered = STRATEGY4_SIGNAL_FILTER_ORDER.map((key) => {
      const existing = map.get(key);
      return existing || { key, label: STRATEGY4_SIGNAL_LABELS[key] || key, count: 0 };
    });
    const used = new Set(ordered.map((item) => item.key));
    const extras = [...map.values()]
      .filter((item) => !used.has(item.key))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-Hant"));
    return [...ordered, ...extras];
  }

  function strategy4ZoneCounts(rows = []) {
    const counts = { A: 0, B: 0, C: 0 };
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const zone = String(row?.swingZone || "").toUpperCase();
      if (zone === "A" || zone === "B" || zone === "C") counts[zone] += 1;
    });
    return [
      { key: "A", label: "A區", count: counts.A },
      { key: "B", label: "B區", count: counts.B },
      { key: "C", label: "C區", count: counts.C },
    ];
  }

  function strategy5SignalCounts(rows = []) {
    const defs = window.FUMAN_STRATEGY_CONFIG?.STRATEGY_BY_ID || {};
    const allowedOrder = window.FUMAN_STRATEGY_CONFIG?.STRATEGY5_PRESET_IDS || [];
    const allowed = new Set(allowedOrder.filter((id) => id !== "multi_strategy_confluence"));
    const forbidden = new Set([["foreign", "trust", "breakout"].join("_")]);
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const signals = row?.signals?.length ? row.signals : row?.subStrategy ? [{ id: row.subStrategyId || row.subStrategy, label: row.subStrategy }] : [];
      signals.forEach((signal) => {
        const key = compactText(signal.id || signal.label || "", 48);
        if (!key || forbidden.has(key) || (allowed.size && !allowed.has(key))) return;
        const label = compactText(defs[key]?.short || defs[key]?.label || signal.label || signal.id || "", 28);
        if (!label) return;
        const current = map.get(key) || { key, label, count: 0 };
        current.count += 1;
        map.set(key, current);
      });
    });
    const orderIndex = (key) => {
      const index = allowedOrder.indexOf(key);
      return index >= 0 ? index : 999;
    };
    return [...map.values()]
      .sort((a, b) => orderIndex(a.key) - orderIndex(b.key) || b.count - a.count || a.label.localeCompare(b.label, "zh-Hant"))
      .slice(0, 16);
  }

  function renderSignalFilterControls(wrap, counts, active, datasetName) {
    wrap.hidden = !counts.length;
    wrap.innerHTML = counts.length ? `
      <button type="button" ${datasetName}="" class="${active ? "" : "active"}">全部 <b>${escapeHtml(String(canvasState.rows.length))}</b></button>
      ${counts.map((item) => `
        <button type="button" ${datasetName}="${escapeHtml(item.key)}" class="${active === item.key ? "active" : ""}" ${item.count ? "" : "disabled"}>
          ${escapeHtml(item.label)} <b>${escapeHtml(String(item.count))}</b>
        </button>
      `).join("")}
    ` : "";
  }

  function updateStrategy4ZoneControls(shell) {
    const panel = shell || currentCanvasShell();
    if (!panel) return;
    const wrap = panel.querySelector("[data-strategy4-zone-filters]");
    if (!wrap) return;
    if (!isStrategy4Route(canvasState.route)) {
      wrap.hidden = true;
      wrap.innerHTML = "";
      return;
    }
    const counts = strategy4ZoneCounts(canvasState.rows);
    const active = canvasState.zoneFilter || "";
    wrap.hidden = false;
    wrap.innerHTML = `
      <button type="button" data-strategy4-zone-filter="" class="${active ? "" : "active"}">全部 <b>${escapeHtml(String(canvasState.rows.length))}</b></button>
      ${counts.map((item) => `
        <button type="button" data-strategy4-zone-filter="${escapeHtml(item.key)}" class="${active === item.key ? "active" : ""}" ${item.count ? "" : "disabled"}>
          ${escapeHtml(item.label)} <b>${escapeHtml(String(item.count))}</b>
        </button>
      `).join("")}
    `;
  }

  function updateStrategySignalControls(shell) {
    const panel = shell || currentCanvasShell();
    if (!panel) return;
    const wrap = panel.querySelector("[data-strategy4-signal-filters]");
    if (!wrap) return;
    if (!isStrategy4Route(canvasState.route) && !isStrategy5Route(canvasState.route)) {
      wrap.hidden = true;
      wrap.innerHTML = "";
      return;
    }
    const active = canvasState.signalFilter || "";
    const counts = isStrategy5Route(canvasState.route) ? strategy5SignalCounts(canvasState.rows) : strategy4SignalCounts(canvasState.rows);
    renderSignalFilterControls(wrap, counts, active, isStrategy5Route(canvasState.route) ? "data-strategy5-signal-filter" : "data-strategy4-signal-filter");
  }

  function chipTradeFilterCount(rows, filter) {
    return (Array.isArray(rows) ? rows : []).filter((row) => matchesChipTradeFilter(row, filter)).length;
  }

  function updateChipTradeFilterControls(shell) {
    const panel = shell || currentCanvasShell();
    if (!panel) return;
    const wrap = panel.querySelector("[data-chip-canvas-filters]");
    if (!wrap) return;
    if (!isChipTradeRoute(canvasState.route)) {
      wrap.hidden = true;
      wrap.innerHTML = "";
      return;
    }
    const active = canvasState.signalFilter || CHIP_TRADE_DEFAULT_FILTER;
    wrap.hidden = false;
    wrap.innerHTML = CHIP_TRADE_FILTERS.map((item) => {
      const currentEndpoint = endpointForRoute(canvasState.route);
      const count = item.endpoint === currentEndpoint ? chipTradeFilterCount(canvasState.rows, item.key) : null;
      return `
        <button type="button" data-chip-canvas-filter="${escapeHtml(item.key)}" class="${active === item.key ? "active" : ""}">
          ${escapeHtml(item.label)} <b>${escapeHtml(count == null ? "…" : String(count))}</b>
        </button>
      `;
    }).join("");
  }

  function updateStrategyFilterControls(shell) {
    updateStrategy4ZoneControls(shell);
    updateStrategySignalControls(shell);
  }

  function removeFixedPageShell(route) {
    const panel = panelForRoute(route);
    if (!panel) return;
    panel.querySelectorAll(":scope > .desktop-route-shell.desktop-canvas-app.desktop-fixed-page-shell").forEach((node) => node.remove());
    panel.classList.remove("fuman-fixed-shell-panel", "fuman-fixed-shell-active");
    delete panel.dataset.fumanCanvasPersistent;
    delete panel.dataset.fumanRouteSnapshotRestoring;
  }

  function runOriginalDesktopMarketFunctions() {
    if (!isMarketViewActive()) return;
    const calls = [
      () => window.showView?.("market", document.querySelector('[data-view="market"]')),
      () => window.loadMarketData?.(true),
      () => window.loadHeatmap?.(true),
      () => window.renderMarketAiPanel?.(),
      () => window.renderRealtimeRadar?.(),
    ];
    calls.forEach((call) => {
      try { call(); } catch (error) {}
    });
  }

  function reserveOriginalDesktopMarketApp() {
    if (!isMarketViewActive()) return;
    if (!window.FUMAN_TERMINAL_APP_READY) {
      window.FUMAN_TERMINAL_APP_READY = "__fuman_desktop_market_reserved";
    }
    document.documentElement.dataset.fumanLegacyAppState = "desktop-market-reserved";
  }

  function terminalFastVersion() {
    return window.FUMAN_TERMINAL_BOOT?.version || window.FUMAN_TERMINAL_VERSION || "public-terminal-fast-20260623-09";
  }

  function loadScriptOnce(src, attr) {
    const existingByAttr = attr ? document.querySelector(`script[${attr}]`) : null;
    const existing = existingByAttr || Array.from(document.scripts).find((script) => script.src === src);
    if (existing) {
      if (attr === "data-fuman-watchlist-shell" && (window.FUMAN_WATCHLIST_SHELL_MODULE || window.FUMAN_WATCHLIST_SHELL_INSTANCE)) {
        existing.dataset.fumanLoaded = "1";
        return Promise.resolve(true);
      }
      if (existing.dataset.fumanLoaded === "1") return Promise.resolve(true);
      return new Promise((resolve, reject) => {
        existing.addEventListener("load", () => {
          existing.dataset.fumanLoaded = "1";
          resolve(true);
        }, { once: true });
        existing.addEventListener("error", reject, { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      if (attr) script.setAttribute(attr, "1");
      script.addEventListener("load", () => {
        script.dataset.fumanLoaded = "1";
        resolve(true);
      }, { once: true });
      script.addEventListener("error", reject, { once: true });
      document.body.appendChild(script);
    });
  }

  function ensureWatchlistShell() {
    if (window.FUMAN_WATCHLIST_SHELL_INSTANCE) return Promise.resolve(window.FUMAN_WATCHLIST_SHELL_INSTANCE);
    const version = "watchlist-rich-shell-20260628-07";
    return loadScriptOnce(`terminal-watchlist-shell.js?v=${encodeURIComponent(version)}`, "data-fuman-watchlist-shell")
      .then(() => window.FUMAN_WATCHLIST_SHELL_MODULE?.install?.({}) || window.FUMAN_WATCHLIST_SHELL_INSTANCE || null)
      .catch(() => null);
  }

  function readWatchlistInstantRows() {
    try {
      const raw = localStorage.getItem("fuman_watchlist") || localStorage.getItem("fuman_mobile_watchlist_v1") || "[]";
      const rows = JSON.parse(raw);
      return normalizeArray(rows).map((row) => ({
        code: String(row?.code || row?.stockId || "").trim(),
        name: String(row?.name || row?.stockName || row?.code || "").trim(),
        reason: String(row?.reason || "自選股冷啟動快取").trim(),
      })).filter((row) => row.code).slice(0, 20);
    } catch (error) {
      return [];
    }
  }

  function renderWatchlistInstantRows() {
    const panel = document.querySelector("#watchlist-view");
    if (!panel) return false;
    const rows = readWatchlistInstantRows();
    const list = panel.querySelector("#watchlist-stocks");
    const analysis = panel.querySelector("#watchlist-analysis");
    const count = panel.querySelector("#watchlist-count");
    const refresh = panel.querySelector("#watchlist-refresh");
    if (count) count.textContent = `${rows.length}`;
    if (refresh) refresh.textContent = `快取先顯示 ｜ ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}`;
    if (list) {
      list.innerHTML = rows.length ? rows.map((row, index) => `
        <article class="watchlist-card ${index === 0 ? "selected" : ""}" data-code="${escapeHtml(row.code)}" data-name="${escapeHtml(row.name || row.code)}">
          <div class="watch-card-main">
            <div class="watch-card-title">
              <span class="watch-code">${escapeHtml(row.code)}</span>
              <span class="watch-name">${escapeHtml(row.name || row.code)}</span>
              <span class="watch-market-badge">自選</span>
            </div>
            <div class="watch-card-flow"><span>${escapeHtml(row.reason)}</span></div>
          </div>
          <div class="watch-card-price"><strong>--</strong><small>背景更新</small></div>
        </article>
      `).join("") : '<div class="watch-mobile-empty">尚未新增自選股，請輸入股票代號後點新增</div>';
    }
    if (analysis) {
      const first = rows[0];
      analysis.innerHTML = first ? `
        <div class="watch-analysis-panel ta-dashboard blackbean-stock-detail">
          <section class="watch-action-row">
            <label>股票代碼<input type="text" value="${escapeHtml(first.code)}" readonly></label>
            <label>名稱<input type="text" value="${escapeHtml(first.name || first.code)}" readonly></label>
          </section>
          <section class="watch-analysis-grid">
            <article><small>狀態</small><strong>快取先顯示</strong><p>rich shell 背景接手後會補完整技術、籌碼與提醒。</p></article>
          </section>
        </div>
      ` : '<div class="watch-mobile-empty">點選股票查看 AI 個股判讀</div>';
    }
    return rows.length > 0;
  }

  function clearDesktopMarketCachesAndReload(reason = "market") {
    const key = "fuman-desktop-market-fresh-reload:20260624-02";
    try {
      if (sessionStorage.getItem(key) === "1") return false;
      sessionStorage.setItem(key, "1");
    } catch (error) {
      return false;
    }
    const clearCaches = "caches" in window
      ? caches.keys().then((keys) => Promise.all(keys.filter((name) => /fuman-terminal/i.test(name)).map((name) => caches.delete(name))))
      : Promise.resolve();
    const unregisterSw = navigator.serviceWorker?.getRegistrations
      ? navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      : Promise.resolve();
    Promise.allSettled([clearCaches, unregisterSw]).finally(() => {
      try {
        const url = new URL(location.href);
        url.searchParams.set("desktop_market_fresh", `${Date.now()}`);
        url.searchParams.set("desktop_market_reason", reason);
        location.replace(url.toString());
      } catch (error) {
        location.reload();
      }
    });
    return true;
  }

  function loadOriginalDesktopMarketDirect(reason = "market") {
    if (/^20260624-0[12]$/.test(String(window.__fumanDesktopMarketExports || ""))) return Promise.resolve(true);
    if (originalDesktopMarketDirectPromise) return originalDesktopMarketDirectPromise;
    const version = terminalFastVersion();
    const dependencies = [
      ["terminal-sector-map.js", "data-fuman-sector-map"],
      ["terminal-strategy-config.js", "data-fuman-strategy-config"],
      ["terminal-market-config.js", "data-fuman-market-config"],
      ["terminal-ui-config.js", "data-fuman-ui-config"],
      ["terminal-runtime-config.js", "data-fuman-runtime-config"],
      ["terminal-tuning-config.js", "data-fuman-tuning-config"],
    ];
    originalDesktopMarketDirectPromise = dependencies.reduce(
      (promise, [file, attr]) => promise.then(() => loadScriptOnce(`/${file}?v=${encodeURIComponent(version)}`, attr)),
      Promise.resolve(true)
    ).then(() => loadScriptOnce(
      `/terminal-app.js?v=${encodeURIComponent(version)}&desktop_market_exports=20260624-02`,
      "data-fuman-terminal-app"
    )).then(() => {
      if (!/^20260624-0[12]$/.test(String(window.__fumanDesktopMarketExports || ""))) {
        clearDesktopMarketCachesAndReload(reason);
      }
      window.FUMAN_TERMINAL_APP_READY = true;
      runOriginalDesktopMarketFunctions();
      return true;
    }).catch((error) => {
      originalDesktopMarketDirectPromise = null;
      if (window.FUMAN_TERMINAL_APP_READY === "__fuman_desktop_market_reserved") {
        window.FUMAN_TERMINAL_APP_READY = false;
      }
      throw error;
    });
    return originalDesktopMarketDirectPromise;
  }

  function loadOriginalDesktopMarket(reason = "market") {
    reserveOriginalDesktopMarketApp();
    if (window.FUMAN_TERMINAL_APP_READY === "__fuman_desktop_market_reserved" || !window.__fumanDesktopMarketExports) {
      return loadOriginalDesktopMarketDirect(reason);
    }
    const load = window.FUMAN_TERMINAL_LOAD_APP || window.FUMAN_TERMINAL_LEGACY_MODULES?.load;
    if (typeof load !== "function") {
      window.clearTimeout(originalDesktopMarketRetryTimer);
      originalDesktopMarketRetryTimer = window.setTimeout(() => {
        if (isMarketViewActive()) loadOriginalDesktopMarket(`${reason}-retry`);
      }, 180);
      return Promise.resolve(false);
    }
    if (originalDesktopMarketPromise) return originalDesktopMarketPromise;
    originalDesktopMarketPromise = Promise.resolve(
      load(`legacy-original-desktop-${reason}`)
    ).finally(() => {
      [0, 400, 1400, 3200].forEach((delay) => window.setTimeout(runOriginalDesktopMarketFunctions, delay));
    });
    return originalDesktopMarketPromise;
  }

  function installOriginalDesktopMarketBridge() {
    window.__fumanOriginalDesktopMarket = "20260625-api-only";
    document.documentElement.dataset.fumanOriginalDesktopMarketBridge = "api-only-disabled";
    return;
    const run = (reason = "market") => {
      if (shouldRestoreNonMarketRoute()) return;
      if (!isMarketViewActive()) return;
      reserveOriginalDesktopMarketApp();
      removeFixedPageShell("market|市場總覽");
      loadOriginalDesktopMarket(reason);
      [240, 900, 2200].forEach((delay) => {
        window.setTimeout(() => {
          if (!isMarketViewActive()) return;
          if (!window.loadHeatmap || !window.renderMarketAiPanel || !window.renderRealtimeRadar) {
            loadOriginalDesktopMarket(`${reason}-${delay}`);
            return;
          }
          runOriginalDesktopMarketFunctions();
        }, delay);
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => run("dom"), { once: true });
    else run("boot");
    window.addEventListener("fuman:desktop-route", (event) => {
      if (isMarketRoute(event?.detail?.key)) run("route");
    });
    window.addEventListener("focus", () => run("focus"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") run("visible");
    });
  }

  function marketApiUrl(path, limit = 60, withBust = false) {
    const radarPath = normalizeRealtimeRadarApiPath(path, limit);
    const sep = radarPath.includes("?") ? "&" : "?";
    const limitParam = isRealtimeRadarApiPath(radarPath) ? "" : `&limit=${limit}`;
    return `${radarPath}${sep}canvas=1&compact=1&shell=1${limitParam}${withBust ? `&t=${Date.now()}` : ""}`;
  }

  function isRealtimeRadarApiPath(path) {
    try {
      return new URL(path, window.location.origin).pathname === "/api/realtime-radar-latest";
    } catch (error) {
      return String(path || "").split("?")[0] === "/api/realtime-radar-latest";
    }
  }

  function normalizeRealtimeRadarApiPath(path, limit = 60) {
    if (!isRealtimeRadarApiPath(path)) return path;
    try {
      const url = new URL(path, window.location.origin);
      url.searchParams.set("full", "1");
      url.searchParams.set("limit", String(Math.max(1200, cleanNumber(limit))));
      return `${url.pathname}${url.search}`;
    } catch (error) {
      const sep = String(path || "").includes("?") ? "&" : "?";
      return `${path}${sep}full=1&limit=${Math.max(1200, cleanNumber(limit))}`;
    }
  }

  function formatYi(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || !n) return "--";
    return n >= 100000000 ? `${(n / 100000000).toFixed(n >= 1000000000 ? 1 : 2)} 億` : `${n.toLocaleString("zh-TW")}`;
  }

  function formatMarketHeatmapPrice(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || !n) return "--";
    return n >= 1000 ? n.toLocaleString("zh-TW", { maximumFractionDigits: 1 }) : n.toFixed(n >= 100 ? 1 : 2);
  }

  function marketNumber(value) {
    const n = Number(String(value ?? "").replace(/[,+%]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function cleanMarketHeatmapLabel(value) {
    return String(value || "").trim().replace(/業$/u, "");
  }

  function firstMarketHeatmapLabel(...values) {
    return values.map(cleanMarketHeatmapLabel).find(Boolean) || "";
  }

  function uniqueMarketHeatmapLabels(values) {
    return [...new Set(normalizeArray(values).map(cleanMarketHeatmapLabel).filter(Boolean))];
  }

  function marketHeatmapStockPct(stock) {
    return marketNumber(stock?.pct ?? stock?.changePct ?? stock?.changePercent ?? stock?.percent);
  }

  function marketHeatmapStockAmount(stock) {
    return marketNumber(stock?.value || stock?.tradeValue || (marketNumber(stock?.amountYi) * 100000000));
  }

  function marketHeatmapStockUniverse(sectors) {
    return normalizeArray(sectors).flatMap((sector) => {
      const sectorName = sector?.name || sector?.industry || "--";
      return normalizeArray(sector?.stocks).map((stock) => ({
        ...stock,
        _sourceSector: sectorName,
      }));
    });
  }

  function isMarketHeatmapElectronicsLabel(value) {
    return /電子|半導體|IC|PCB|載板|光|網通|AI|CPU|ASIC|IP|記憶體|被動|伺服器|通路|零組件|電源|BBU|UPS|封測|晶圓|矽|面板|光通訊/u.test(String(value || ""));
  }

  function marketHeatmapLabelsForMode(stock, mode) {
    const profile = stock?.industryProfile || {};
    const themes = normalizeArray(stock?.themes || profile.themes);
    const base = firstMarketHeatmapLabel(stock?.primaryIndustry, profile.primaryIndustry, stock?.industry, stock?._sourceSector);
    const official = firstMarketHeatmapLabel(stock?.officialIndustry, profile.officialIndustry, stock?.primaryIndustry, stock?._sourceSector);
    if (mode === "official") return [official || base || "未分類"];
    if (mode === "electronics") {
      return uniqueMarketHeatmapLabels([base, stock?.industry, stock?.primaryIndustry, stock?._sourceSector, ...themes])
        .filter(isMarketHeatmapElectronicsLabel);
    }
    if (mode === "themes") {
      const candidates = uniqueMarketHeatmapLabels([...themes, profile.theme, profile.concept, stock?.concept, base]);
      return candidates.length ? candidates.slice(0, 2) : [base || official || "未分類"];
    }
    if (mode === "groups") {
      const candidates = uniqueMarketHeatmapLabels([
        stock?.companyGroup,
        stock?.businessGroup,
        stock?.conglomerate,
        stock?.group,
        profile.companyGroup,
        profile.businessGroup,
        profile.conglomerate,
      ]);
      return candidates.length ? candidates : [`${base || official || stock?._sourceSector || "市場"}系`];
    }
    return [base || official || "未分類"];
  }

  function aggregateMarketHeatmapSectors(rawSectors, mode) {
    if (mode === "all") return normalizeArray(rawSectors);
    const buckets = new Map();
    marketHeatmapStockUniverse(rawSectors).forEach((stock) => {
      marketHeatmapLabelsForMode(stock, mode).forEach((label) => {
        if (!label) return;
        if (!buckets.has(label)) buckets.set(label, { name: label, stocks: [], totalValue: 0, up: 0, down: 0, flat: 0 });
        const bucket = buckets.get(label);
        const pct = marketHeatmapStockPct(stock);
        bucket.stocks.push(stock);
        bucket.totalValue += marketHeatmapStockAmount(stock);
        if (pct > 0) bucket.up += 1;
        else if (pct < 0) bucket.down += 1;
        else bucket.flat += 1;
      });
    });
    return [...buckets.values()].filter((group) => group.stocks.length).map((group) => {
      const totalValue = group.totalValue || 0;
      const avgPct = group.stocks.reduce((sum, stock) => sum + marketHeatmapStockPct(stock), 0) / group.stocks.length;
      const weightedPct = totalValue
        ? group.stocks.reduce((sum, stock) => sum + marketHeatmapStockPct(stock) * marketHeatmapStockAmount(stock), 0) / totalValue
        : avgPct;
      const sortedStocks = [...group.stocks].sort((a, b) => marketHeatmapStockAmount(b) - marketHeatmapStockAmount(a));
      const leader = sortedStocks[0];
      return {
        name: group.name,
        pct: Number(weightedPct.toFixed(2)),
        avgPct: Number(avgPct.toFixed(2)),
        totalValue,
        amountYi: Number((totalValue / 100000000).toFixed(1)),
        count: group.stocks.length,
        up: group.up,
        down: group.down,
        flat: group.flat,
        leader: leader ? `${leader.name || leader.code} ${marketHeatmapStockPct(leader) >= 0 ? "+" : ""}${marketHeatmapStockPct(leader).toFixed(2)}%` : "--",
        leaderCode: leader?.code || "",
        stocks: sortedStocks,
      };
    }).sort((a, b) => marketNumber(b.pct ?? b.avgPct) - marketNumber(a.pct ?? a.avgPct));
  }

  function marketHeatmapModeLabel(mode) {
    return {
      all: "全部",
      official: "官方產業",
      electronics: "電子細分",
      themes: "群組概念",
      groups: "集團股",
    }[mode] || "全部";
  }

  function buildMarketHeatmapGroups(rawSectors) {
    return {
      all: aggregateMarketHeatmapSectors(rawSectors, "all"),
      official: aggregateMarketHeatmapSectors(rawSectors, "official"),
      electronics: aggregateMarketHeatmapSectors(rawSectors, "electronics"),
      themes: aggregateMarketHeatmapSectors(rawSectors, "themes"),
      groups: aggregateMarketHeatmapSectors(rawSectors, "groups"),
    };
  }

  function setMarketHeatmapModeButtons(market, mode) {
    market?.querySelectorAll?.("[data-market-heatmap-mode]")?.forEach((button) => {
      button.classList.toggle("active", button.dataset.marketHeatmapMode === mode);
    });
  }

  function formatMarketIndexValue(value) {
    const n = marketNumber(value);
    if (!n) return "--";
    return n.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function compactMarketTime(value) {
    const text = String(value || "");
    const date = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    const time = text.match(/(\d{2}):(\d{2})/);
    if (date && time) return `${date[2]}/${date[3]} ${time[1]}:${time[2]}`;
    return text || "--";
  }

  function marketIndexByName(payload, names) {
    const list = normalizeArray(payload?.indexes);
    return list.find((item) => names.some((name) => String(item?.["指數"] || item?.name || "").includes(name))) || null;
  }

  function marketCanvasRowByCode(payload, codes) {
    const list = normalizeArray(payload?.rows);
    return list.find((item) => codes.some((code) => String(item?.code || "").toUpperCase() === code)) || null;
  }

  function formatMarketDelta(item) {
    if (!item) return "等待官方資料";
    const sign = String(item["漲跌"] || item.sign || "").includes("-") ? "-" : "+";
    const diff = String(item["漲跌點數"] ?? item.change ?? "0").replace(/^[+-]/, "");
    const pct = String(item["漲跌百分比"] ?? item.pct ?? "0").replace(/[+%-]/g, "");
    return `${sign}${diff}（${sign}${pct}%）`;
  }

  function formatMarketRowDelta(row) {
    if (!row) return "等待官方資料";
    const score = String(row.score ?? row.change ?? "--");
    const pct = String(row.pct ?? row.percent ?? "--");
    const sign = /^-/.test(score) || /^-/.test(pct) ? "" : "+";
    return `${sign}${score.replace(/^\+/, "")}（${pct}）${row.reason ? ` · ${row.reason}` : ""}`;
  }

  function updateMarketMetricCard(card, label, value, subText, positive) {
    if (!card) return;
    const title = card.querySelector("span");
    const strong = card.querySelector("strong");
    const em = card.querySelector("em");
    if (title) title.textContent = label;
    if (strong) strong.textContent = value || "--";
    if (em) em.textContent = subText || "等待官方資料";
    card.classList.toggle("market-card-up", positive === true);
    card.classList.toggle("market-card-down", positive === false);
  }

  function marketJsonCacheKey(path, limit = 60) {
    if (isRealtimeRadarApiPath(path)) {
      return `${normalizeRealtimeRadarApiPath(path, 1200)}|1200`;
    }
    return `${path}|${limit}`;
  }

  function isMarketHeatmapLiveWindow() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date()).reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
    const mins = 60 * Number(parts.hour || 0) + Number(parts.minute || 0);
    return mins >= 540 && mins <= 810;
  }

  function marketHeatmapContractPath() {
    return isMarketHeatmapLiveWindow()
      ? "/api/heatmap?limit=999&stocks=999&source=desktop-fast-shell-live"
      : "/api/heatmap?snapshot=1";
  }

  function rememberRealtimeRadarPayload(payload, source = "market-prime") {
    if (!payload || typeof payload !== "object") return 0;
    rememberRealtimeRadarHealth(payload);
    marketRadarBundlePayload = payload;
    const rows = normalizeCanvasRowsFromPayload(payload, REALTIME_RADAR_ROUTE);
    if (rows.length) rememberCanvasRows(REALTIME_RADAR_ROUTE, rows, source, Date.now());
    return rows.length;
  }

  function primeMarketColdPayloads(force = false, reason = "boot") {
    const tasks = [
      fetchMarketJson(marketHeatmapContractPath(), 36, force, MARKET_HEATMAP_FETCH_TIMEOUT_MS).then((payload) => {
        if (payload?.sectors?.length) {
          marketSnapshotFirstPayload = { ...payload, snapshotFirst: !isMarketHeatmapLiveWindow(), firstPaint: true };
          paintMarketSnapshotFirstPayload(marketSnapshotFirstPayload);
        }
      }),
      fetchMarketJson("/api/market", 24, force, 2200),
    ];
    if (marketDesktopMode === "ai" || document.documentElement.dataset.fumanMarketDesktopMode === "ai") {
      tasks.push(
        fetchMarketJson("/api/realtime-radar-latest?full=1", 1200, force, MARKET_RADAR_FETCH_TIMEOUT_MS).then((payload) => {
          rememberRealtimeRadarPayload(payload, `market-prime-${reason}`);
        }),
        fetchMarketJson("/api/market-ai-live", 20, force, MARKET_AI_LIVE_FETCH_TIMEOUT_MS).then((payload) => {
          if (payload && typeof payload === "object") marketAiBundlePayload = payload;
        }),
      );
    }
    return Promise.allSettled(tasks);
  }

  function installMarketColdPayloadPrime() {
    if (document.documentElement.dataset.fumanMarketColdPayloadPrimeReady === "1") return;
    document.documentElement.dataset.fumanMarketColdPayloadPrimeReady = "1";
    primeMarketColdPayloads(false, "script");
    runIdle(() => primeMarketColdPayloads(false, "idle"), 180, 3600);
  }

  function fetchMarketJson(path, limit = 60, force = false, timeoutMs = 6500) {
    const url = marketApiUrl(path, limit, force);
    const key = marketJsonCacheKey(path, limit);
    const cached = marketJsonCache.get(key);
    if (!force && cached?.payload && Date.now() - Number(cached.at || 0) < MARKET_JSON_CACHE_TTL_MS) {
      return Promise.resolve(cached.payload);
    }
    if (!force && marketJsonInflight.has(key)) return marketJsonInflight.get(key);
    const task = new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.timeout = timeoutMs;
        xhr.setRequestHeader("Accept", "application/json");
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            resolve(null);
            return;
          }
          try {
            const payload = JSON.parse(xhr.responseText || "{}");
            if (payload && typeof payload === "object") marketJsonCache.set(key, { payload, at: Date.now() });
            resolve(payload);
          } catch (error) {
            resolve(null);
          }
        };
        xhr.onerror = () => resolve(null);
        xhr.ontimeout = () => resolve(null);
        xhr.onabort = () => resolve(null);
        xhr.send();
      } catch (error) {
        resolve(null);
      }
    }).finally(() => {
      if (!force) marketJsonInflight.delete(key);
    });
    if (!force) marketJsonInflight.set(key, task);
    return task;
  }

  function hasMarketAiPayload(payload) {
    if (!payload || typeof payload !== "object") return false;
    return Boolean(
      payload.dashboard
      || payload.groups
      || payload.fieldCompleteness
      || normalizeArray(payload.filters).length
      || normalizeArray(payload.rows).length
      || normalizeArray(payload.hotStocks).length
      || normalizeArray(payload.todayPoints).length
      || normalizeArray(payload.reasoning).length
    );
  }

  function marketAiStockSignature(row) {
    const code = String(row?.code || row?.Code || row?.stockId || "").trim();
    const score = Number(row?.score || row?.radarScore || row?.aiScore || row?.finalScore || row?.rankScore || 0) || 0;
    const pct = Number(row?.pct ?? row?.percent ?? row?.changePercent ?? row?.Change ?? row?.change ?? 0) || 0;
    return `${code}:${Math.round(score)}:${pct.toFixed(2)}`;
  }

  function marketAiRowsSignature(rows) {
    return normalizeArray(rows).slice(0, 10).map(marketAiStockSignature).join(",");
  }

  function marketAiStableSignature(heatmapPayload, radarPayload, aiPayload = {}) {
    const aiReady = hasMarketAiPayload(aiPayload);
    const groups = aiPayload?.groups && typeof aiPayload.groups === "object" ? aiPayload.groups : {};
    const groupSignature = ["all", "momentum", "institution", "legal", "intraday", "risk"].map((key) => {
      const group = groups[key] || {};
      return `${key}:${marketAiRowsSignature(group.rows || group.stocks)}`;
    }).join("|");
    const filterSignature = normalizeArray(aiPayload?.filters).map((item) => {
      return `${item?.key || ""}:${marketAiRowsSignature(item?.rows || item?.stocks)}`;
    }).join("|");
    const dashboard = aiPayload?.dashboard || {};
    const base = {
      aiReady,
      updatedAt: aiPayload?.updatedAt || aiPayload?.servedAt || aiPayload?.snapshot?.updatedAt || "",
      tradeDate: dashboard.tradeDate || aiPayload?.snapshot?.tradeDate || "",
      sample: dashboard.sample || aiPayload?.summary?.sample || "",
      up: dashboard.up || aiPayload?.summary?.up || "",
      down: dashboard.down || aiPayload?.summary?.down || "",
      bias: dashboard.bias || "",
      confidence: dashboard.confidence || "",
      rows: marketAiRowsSignature(aiPayload?.rows || aiPayload?.hotStocks || aiPayload?.items),
      groups: groupSignature,
      filters: filterSignature,
      points: normalizeArray(aiPayload?.todayPoints).slice(0, 6).join("|"),
      risks: normalizeArray(aiPayload?.riskNotes).slice(0, 4).map((item) => `${item?.title || ""}:${item?.text || item?.reason || ""}`).join("|"),
      reasoning: normalizeArray(aiPayload?.reasoning).slice(0, 4).map((item) => `${item?.key || ""}:${item?.title || ""}:${item?.text || item?.reason || ""}`).join("|"),
    };
    if (!aiReady) {
      base.heatmap = normalizeArray(heatmapPayload?.sectors).slice(0, 12).map((item) => {
        return `${item?.name || item?.industry || ""}:${item?.pct ?? item?.avgPct ?? ""}:${item?.up || 0}:${item?.down || 0}:${item?.count || ""}`;
      }).join("|");
      base.radar = `${radarPayload?.runId || radarPayload?.timestamp || ""}:${marketAiRowsSignature(radarPayload?.rows)}`;
    }
    return JSON.stringify(base);
  }

  function scheduleMarketApiAiRender(heatmapPayload, radarPayload, aiPayload = {}, options = {}) {
    if (!isMarketViewActive() || marketDesktopMode !== "ai") return;
    const request = {
      heatmap: heatmapPayload || {},
      radar: radarPayload || {},
      ai: aiPayload || {},
      force: Boolean(options.force),
    };
    marketAiRenderRequest = request;
    window.clearTimeout(marketAiRenderTimer);
    const delay = Number.isFinite(Number(options.delay)) ? Number(options.delay) : (hasMarketAiPayload(aiPayload) ? 90 : 220);
    marketAiRenderTimer = window.setTimeout(() => {
      const next = marketAiRenderRequest || request;
      marketAiRenderRequest = null;
      if (!isMarketViewActive() || marketDesktopMode !== "ai") return;
      if (!hasMarketAiPayload(next.ai)) {
        renderMarketApiAiLoading();
        return;
      }
      const signature = marketAiStableSignature(next.heatmap, next.radar, next.ai);
      const panel = document.querySelector("#market-view [data-market-api-ai]");
      if (!next.force && signature && signature === marketAiRenderSignature && panel?.dataset?.marketAiStableSignature === signature) return;
      marketAiRenderSignature = signature;
      renderMarketApiAi(next.heatmap, next.radar, next.ai);
      const renderedPanel = document.querySelector("#market-view [data-market-api-ai]");
      if (renderedPanel && signature) renderedPanel.dataset.marketAiStableSignature = signature;
    }, Math.max(40, delay));
  }

  function renderMarketApiAiLoading() {
    const panels = ensureMarketApiPanels();
    if (!panels.ai) return;
    if (panels.ai.dataset.marketApiAi === "live-api-bundle" && hasMarketAiPayload(marketAiBundlePayload)) return;
    panels.ai.classList.add("market-ai-visual-dashboard");
    panels.ai.dataset.marketAiRenderer = "desktop-fast-shell";
    panels.ai.dataset.marketApiAi = "desktop-fast-shell-loading";
    panels.ai.innerHTML = '<div class="empty-state">載入今日正式 AI 判讀資料中...</div>';
  }

  function hydrateMarketDesktopAiDirect(force = false) {
    if (!isMarketViewActive() || marketDesktopMode !== "ai" || marketDesktopAiLoading) return;
    marketDesktopAiLoading = true;
    const shell = ensureMarketDesktopShell();
    if (shell.ai && !/market-ai-card|market-ai-stock-row|操作建議|風險/.test(shell.ai.textContent || "")) {
      shell.ai.innerHTML = '<div class="empty-state">載入最新 AI 判讀資料中...</div>';
    }
    const state = {
      heatmap: marketSnapshotFirstPayload || null,
      radar: marketRadarBundlePayload || null,
      ai: marketAiBundlePayload || null,
    };
    let settled = 0;
    const paint = (forcePaint = false, delay = null) => {
      if (!isMarketViewActive() || marketDesktopMode !== "ai") return;
      scheduleMarketApiAiRender(state.heatmap || {}, state.radar || {}, state.ai || {}, {
        force: forcePaint,
        delay: delay == null ? (hasMarketAiPayload(state.ai) ? 90 : 220) : delay,
      });
    };
    paint(true, 40);
    if (state.heatmap?.sectors?.length || state.radar || state.ai) {
      window.setTimeout(() => paint(false, hasMarketAiPayload(state.ai) ? 30 : 70), 0);
    } else if (!force) {
      primeDesktopFastBundle(false, "market-ai-first-paint").then(() => {
        if (!isMarketViewActive() || marketDesktopMode !== "ai") return;
        state.heatmap = marketSnapshotFirstPayload || state.heatmap;
        state.radar = marketRadarBundlePayload || state.radar;
        state.ai = marketAiBundlePayload || state.ai;
        if (state.heatmap?.sectors?.length || state.radar || state.ai) paint(false, hasMarketAiPayload(state.ai) ? 30 : 80);
      });
    }
    const done = () => {
      settled += 1;
      if (settled >= 4) marketDesktopAiLoading = false;
    };
    fetchMarketJson(marketHeatmapContractPath(), 36, force, MARKET_HEATMAP_FETCH_TIMEOUT_MS)
      .then((payload) => {
        if (payload?.sectors?.length) {
          marketSnapshotFirstPayload = {
            ...payload,
            snapshotFirst: !isMarketHeatmapLiveWindow(),
            firstPaint: true,
          };
          state.heatmap = marketSnapshotFirstPayload;
          if (!hasMarketAiPayload(state.ai)) paint(false, 70);
        }
      })
      .finally(done);
    fetchMarketJson("/api/market-ai-live", 40, force, MARKET_AI_LIVE_FETCH_TIMEOUT_MS)
      .then((payload) => {
        state.ai = payload || {};
        if (hasMarketAiPayload(state.ai)) marketAiBundlePayload = state.ai;
        paint(false, 70);
      })
      .finally(done);
    fetchMarketJson("/api/heatmap", 60, force, MARKET_HEATMAP_FETCH_TIMEOUT_MS)
      .then((payload) => {
        if (payload?.sectors?.length) {
          state.heatmap = { ...(payload || {}), firstPaint: false };
          if (!hasMarketAiPayload(state.ai)) paint(false, 120);
        }
      })
      .finally(done);
    fetchMarketJson("/api/realtime-radar-latest", 20, force, MARKET_RADAR_FETCH_TIMEOUT_MS)
      .then((payload) => {
        state.radar = payload || {};
        if (!hasMarketAiPayload(state.ai)) paint(false, 180);
      })
      .finally(done);
  }

  function ensureMarketDesktopShell() {
    const market = document.querySelector("#market-view");
    if (!market) return {};
    let tabs = market.querySelector("[data-fuman-market-tabs]");
    if (!tabs) {
      tabs = document.createElement("section");
      tabs.className = "market-mode-tabs";
      tabs.dataset.fumanMarketTabs = "1";
      tabs.setAttribute("aria-label", "市場總覽切換");
      tabs.innerHTML = [
        '<button type="button" class="active" data-market-mode="overview">◉ 市場總覽</button>',
        '<button type="button" data-market-mode="ai">♙ AI 判讀</button>',
      ].join("");
      const header = market.querySelector(".page-header");
      header?.insertAdjacentElement("afterend", tabs);
    }
    let ai = market.querySelector("[data-market-api-ai], #market-ai-panel");
    if (!ai) {
      ai = document.createElement("section");
      ai.className = "market-ai-panel";
      ai.dataset.marketApiAi = "1";
      ai.hidden = true;
      ai.innerHTML = '<div class="empty-state">載入最新 AI 判讀資料中...</div>';
      tabs.insertAdjacentElement("afterend", ai);
    }
    ai.id = ai.id || "market-ai-panel";
    ai.dataset.marketApiAi = ai.dataset.marketApiAi || "1";
    installMarketDesktopModeHandlers(tabs);
    market.classList.toggle("market-overview-mode", marketDesktopMode !== "ai");
    market.classList.toggle("market-ai-mode", marketDesktopMode === "ai");
    tabs.querySelectorAll("[data-market-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.marketMode === marketDesktopMode);
    });
    ai.hidden = marketDesktopMode !== "ai";
    const title = market.querySelector(".page-header h1");
    if (title) title.textContent = marketDesktopMode === "ai" ? "AI 判讀" : "市場總覽";
    return { market, tabs, ai };
  }

  function applyMarketDesktopMode(mode) {
    marketDesktopMode = mode === "ai" ? "ai" : "overview";
    ensureMarketDesktopShell();
  }

  function syncMarketAiDesktopModeIfVisible() {
    const market = document.querySelector("#market-view");
    const ai = market?.querySelector?.("[data-market-api-ai], #market-ai-panel");
    if (document.documentElement.dataset.fumanMarketDesktopMode && document.documentElement.dataset.fumanMarketDesktopMode !== "ai") return;
    const shouldSync = marketDesktopMode === "ai"
      || document.documentElement.dataset.fumanMarketDesktopMode === "ai"
      || (ai && ai.hidden === false && market?.classList.contains("market-ai-mode"));
    if (!market || !shouldSync) return;
    marketDesktopMode = "ai";
    market.classList.add("market-ai-mode");
    market.classList.remove("market-overview-mode");
    market.querySelectorAll("[data-market-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.marketMode === "ai");
    });
    if (ai) ai.hidden = false;
    const title = market.querySelector(".page-header h1");
    if (title) title.textContent = "AI 判讀";
    document.documentElement.dataset.fumanMarketDesktopMode = "ai";
  }

  function scheduleMarketDesktopModeHydrate(mode, force = false) {
    if (mode !== "ai") return;
    window.clearTimeout(window.__fumanMarketAiHydrateTimer || 0);
    if (!force && !(marketSnapshotFirstPayload?.sectors?.length || marketAiBundlePayload || marketRadarBundlePayload)) {
      primeDesktopFastBundle(false, "market-ai-mode").then(() => {
        if (isMarketViewActive() && marketDesktopMode === "ai") {
          scheduleMarketApiAiRender(marketSnapshotFirstPayload || {}, marketRadarBundlePayload || {}, marketAiBundlePayload || {}, { delay: 40 });
        }
      });
    }
    const delay = 40;
    window.__fumanMarketAiHydrateTimer = window.setTimeout(() => {
      if (!isMarketViewActive() || marketDesktopMode !== "ai") return;
      marketApiOnlyLoading = false;
      hydrateMarketDesktopAiDirect(force);
    }, Math.max(80, delay));
  }

  function selectMarketDesktopMode(mode, source = "market-mode") {
    const nextMode = mode === "ai" ? "ai" : "overview";
    document.documentElement.dataset.fumanMarketDesktopMode = nextMode;
    document.documentElement.dataset.fumanMarketDesktopModeSource = source;
    if (nextMode !== "ai") {
      window.clearTimeout(window.__fumanMarketAiHydrateTimer || 0);
      window.clearTimeout(marketAiRenderTimer || 0);
      marketAiRenderRequest = null;
      marketDesktopAiLoading = false;
    }
    applyMarketDesktopMode(nextMode);
    scheduleMarketDesktopModeHydrate(nextMode, true);
  }
  window.FUMAN_SELECT_MARKET_DESKTOP_MODE = selectMarketDesktopMode;

  function installMarketDesktopModeHandlers(tabs) {
    if (!tabs || tabs.dataset.fumanFastMarketModeReady === "1") return;
    tabs.dataset.fumanFastMarketModeReady = "1";
    const choose = (event, source) => {
      const button = event.target.closest?.("[data-market-mode]");
      if (!button || !tabs.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      selectMarketDesktopMode(button.dataset.marketMode, source);
    };
    tabs.addEventListener("pointerdown", (event) => choose(event, "tabs-pointerdown"), true);
    tabs.addEventListener("click", (event) => choose(event, "tabs-click"), true);
    tabs.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      choose(event, "tabs-keydown");
    }, true);
    if (document.documentElement.dataset.fumanMarketModeGlobalHandler !== "1") {
      document.documentElement.dataset.fumanMarketModeGlobalHandler = "1";
      document.addEventListener("click", (event) => {
        const button = event.target.closest?.("[data-market-mode]");
        if (!button || !document.querySelector("#market-view")?.contains(button)) return;
        event.preventDefault();
        selectMarketDesktopMode(button.dataset.marketMode, "global-click");
      }, true);
    }
  }

  function restoreMarketDesktopMode() {
    ensureMarketDesktopShell();
    applyMarketDesktopMode(marketDesktopMode);
  }

  function renderMarketOverviewShell(link, source = "market-overview") {
    const key = MARKET_ROUTE;
    const panel = panelForRoute(key) || document.querySelector("#market-view");
    if (!panel) return false;
    activeSnapshotRoute = key;
    canvasState.route = "";
    canvasState.source = source || "market-overview";
    canvasState.rows = [];
    canvasState.filtered = [];
    canvasState.query = "";
    canvasState.offset = 0;
    canvasState.hoverIndex = -1;
    canvasState.selectedIndex = -1;
    removeFixedPageShell(key);
    panel.querySelectorAll(":scope > .desktop-route-shell.desktop-canvas-app").forEach((node) => node.remove());
    panel.classList.remove("fuman-fixed-shell-panel", "fuman-fixed-shell-active");
    panel.classList.add("fuman-market-overview-shell");
    panel.classList.add("market-index-pending");
    delete panel.dataset.fumanCanvasPersistent;
    delete panel.dataset.fumanRouteSnapshotRestoring;
    restoreMarketDesktopMode();
    if (link) {
      document.querySelectorAll("[data-view]").forEach((item) => {
        const active = item === link;
        item.classList.toggle("active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      });
    }
    window.clearTimeout(window.__fumanMarketOverviewRefreshTimer || 0);
    window.__fumanMarketOverviewRefreshTimer = window.setTimeout(() => {
      if (!isMarketViewActive()) return;
      refreshMarketSnapshotFirst(true);
    }, 80);
    return true;
  }

  function closeMarketHeatmapSectorModal() {
    document.querySelector("[data-market-heatmap-modal]")?.remove();
  }

  function renderMarketHeatmapSectorModal(index) {
    const sector = marketHeatmapSectorRows[Number(index)];
    if (!sector) return;
    const stocks = normalizeArray(sector.stocks)
      .slice()
      .sort((a, b) => Number(b.value || b.tradeValue || b.amountYi || 0) - Number(a.value || a.tradeValue || a.amountYi || 0));
    const pct = Number(sector.pct ?? sector.avgPct ?? 0) || 0;
    const leader = stocks[0];
    const overlay = document.createElement("section");
    overlay.className = "sector-modal-overlay";
    overlay.dataset.marketHeatmapModal = "1";
    overlay.innerHTML = `
      <div class="sector-modal-shell" role="dialog" aria-modal="true" aria-label="${escapeHtml(sector.name || sector.industry || "熱力圖分類")}">
        <header class="sector-modal-header">
          <div class="sector-modal-title-block">
            <small>全台上市櫃分類 · API only</small>
            <h2>${escapeHtml(sector.name || sector.industry || "--")}</h2>
            <p>${escapeHtml(String(stocks.length || sector.count || 0))} 檔股票，依成交額排序。</p>
          </div>
          <button type="button" class="sector-modal-close" data-market-heatmap-close aria-label="關閉">×</button>
        </header>
        <div class="sector-modal-summary">
          <article><span>族群漲幅</span><strong class="${pct >= 0 ? "sector-pct-up" : "sector-pct-down"}">${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</strong></article>
          <article><span>股票數</span><strong>${escapeHtml(String(stocks.length || sector.count || 0))}</strong></article>
          <article><span>上漲 / 下跌</span><strong>${escapeHtml(String(sector.up || 0))}<em>/</em>${escapeHtml(String(sector.down || 0))}</strong></article>
          <article><span>領頭股</span><strong class="sector-modal-leader">${escapeHtml(leader ? `${leader.name || leader.code} ${(Number(leader.pct || 0) >= 0 ? "+" : "")}${Number(leader.pct || 0).toFixed(2)}%` : "--")}</strong></article>
        </div>
        <div class="sector-modal-scroll">
          ${stocks.length ? `
            <table class="sector-modal-table">
              <thead>
                <tr>
                  <th>股票</th>
                  <th>現價</th>
                  <th>漲跌</th>
                  <th>成交額</th>
                  <th>量</th>
                  <th>官方產業</th>
                  <th>分類</th>
                </tr>
              </thead>
              <tbody>
                ${stocks.map((stock, rowIndex) => {
                  const stockPct = Number(stock.pct ?? stock.percent ?? 0) || 0;
                  const value = Number(stock.value || stock.tradeValue || (Number(stock.amountYi || 0) * 100000000));
                  return `
                    <tr class="sector-modal-row ${rowIndex % 2 ? "is-alt" : ""}">
                      <td class="sector-modal-stock-cell" data-label="股票">
                        <div class="sector-modal-stock-title">${escapeHtml(stock.code || "")} <span>${escapeHtml(stock.name || "")}</span></div>
                        <div class="sector-modal-stock-sub">${escapeHtml(stock.quoteDate || "")} ${escapeHtml(stock.quoteTime || "")}</div>
                      </td>
                      <td class="sector-modal-number-cell" data-label="現價">${escapeHtml(formatMarketHeatmapPrice(stock.close || stock.price))}</td>
                      <td class="sector-modal-number-cell ${stockPct >= 0 ? "sector-pct-up" : "sector-pct-down"}" data-label="漲跌">${stockPct >= 0 ? "+" : ""}${stockPct.toFixed(2)}%</td>
                      <td class="sector-modal-number-cell" data-label="成交額">${escapeHtml(formatYi(value))}</td>
                      <td class="sector-modal-number-cell" data-label="量">${Number(stock.volume || stock.tradeVolume || 0).toLocaleString("zh-TW")}</td>
                      <td class="sector-modal-market-cell" data-label="官方產業">${escapeHtml(stock.officialIndustry || stock.primaryIndustry || "--")}</td>
                      <td class="sector-modal-market-cell" data-label="分類">${escapeHtml(stock.industry || sector.name || "--")}</td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          ` : '<div class="sector-modal-empty">這個分類目前沒有可顯示股票。</div>'}
        </div>
      </div>
    `;
    closeMarketHeatmapSectorModal();
    document.body.appendChild(overlay);
  }

  function renderMarketOverviewApi(marketPayload, heatmapPayload) {
    const shell = ensureMarketDesktopShell();
    const market = shell.market || document.querySelector("#market-view");
    if (!market) return;
    const updatedAt = marketPayload?.updatedAt || heatmapPayload?.updatedAt || heatmapPayload?.servedAt || "";
    const refresh = market.querySelector(".refresh-line");
    const clock = market.querySelector(".market-time");
    if (refresh) refresh.textContent = `${compactMarketTime(updatedAt)} 更新 · API only`;
    if (clock) clock.textContent = compactMarketTime(updatedAt);

    const twse = marketIndexByName(marketPayload, ["加權", "發行量"]);
    const otc = marketIndexByName(marketPayload, ["櫃買"]);
    const twseRow = marketCanvasRowByCode(marketPayload, ["TWSE"]);
    const otcRow = marketCanvasRowByCode(marketPayload, ["OTC"]);
    const txfRow = marketCanvasRowByCode(marketPayload, ["TXF"]);
    const futuresNear = marketPayload?.futuresNear || marketPayload?.futures || null;
    const futuresNext = marketPayload?.futuresNext || null;
    const hasMarketIndexData = Boolean(twse || otc || twseRow || otcRow || txfRow || futuresNear || futuresNext);
    market.classList.toggle("market-index-pending", !hasMarketIndexData);
    const cards = [...market.querySelectorAll(".metric-grid .metric-card")];
    updateMarketMetricCard(
      cards[0],
      "↗ 加權指數",
      formatMarketIndexValue(twse?.["收盤指數"] || twseRow?.price),
      twse ? formatMarketDelta(twse) : formatMarketRowDelta(twseRow),
      twse ? !String(twse?.["漲跌"] || "").includes("-") : twseRow ? !String(twseRow?.pct || twseRow?.score || "").includes("-") : null
    );
    updateMarketMetricCard(
      cards[1],
      "↗ 櫃買指數",
      formatMarketIndexValue(otc?.["收盤指數"] || otcRow?.price),
      otc ? formatMarketDelta(otc) : formatMarketRowDelta(otcRow),
      otc ? !String(otc?.["漲跌"] || "").includes("-") : otcRow ? !String(otcRow?.pct || otcRow?.score || "").includes("-") : null
    );
    updateMarketMetricCard(
      cards[2],
      "⇅ 台指期夜盤",
      futuresNear?.price ? Number(futuresNear.price).toLocaleString("zh-TW") : txfRow?.price ? Number(txfRow.price).toLocaleString("zh-TW") : "--",
      futuresNear ? `${futuresNear.change || "--"}（${futuresNear.pct || "--"}）${futuresNear.basisLabel ? ` · ${futuresNear.basisLabel}` : ""}` : formatMarketRowDelta(txfRow),
      futuresNear ? !String(futuresNear?.change || "").includes("-") : txfRow ? !String(txfRow?.pct || txfRow?.score || "").includes("-") : null
    );
    updateMarketMetricCard(
      cards[3],
      "☾ 台指次月",
      futuresNext?.price ? Number(futuresNext.price).toLocaleString("zh-TW") : "--",
      futuresNext ? `${futuresNext.change || "--"}（${futuresNext.pct || "--"}）${futuresNext.basisLabel ? ` · ${futuresNext.basisLabel}` : ""}` : "等待期交所資料",
      futuresNext ? !String(futuresNext?.change || "").includes("-") : null
    );

    const sectors = normalizeArray(heatmapPayload?.sectors);
    const stocks = sectors.flatMap((sector) => normalizeArray(sector?.stocks));
    const up = sectors.reduce((sum, sector) => sum + marketNumber(sector?.up), 0);
    const down = sectors.reduce((sum, sector) => sum + marketNumber(sector?.down), 0);
    const sample = marketNumber(heatmapPayload?.stockCount || heatmapPayload?.sample || heatmapPayload?.count) || stocks.length || up + down;
    const flat = Math.max(0, sample - up - down);
    const totalValue = sectors.reduce((sum, sector) => sum + marketNumber(sector?.totalValue || sector?.value || (marketNumber(sector?.amountYi) * 100000000)), 0);
    const upRatio = sample ? up / sample * 100 : 0;
    const strength = market.querySelector(".strength-panel");
    if (strength) {
      const title = strength.querySelector(".strength-head h2");
      const sub = strength.querySelector(".strength-head p");
      const ratio = strength.querySelector(".strength-head strong");
      const stats = strength.querySelectorAll(".stats-row strong");
      if (title) title.textContent = up >= down ? "強勢" : "弱勢";
      if (sub) sub.textContent = `${sample.toLocaleString("zh-TW")} 檔 · 平均 ${Number(heatmapPayload?.avgPct || 0).toFixed(2)}%`;
      if (ratio) ratio.innerHTML = `${upRatio.toFixed(2)}%<span>上漲比例</span>`;
      if (stats[0]) stats[0].textContent = up.toLocaleString("zh-TW");
      if (stats[1]) stats[1].textContent = down.toLocaleString("zh-TW");
      if (stats[2]) stats[2].textContent = flat.toLocaleString("zh-TW");
      if (stats[3]) stats[3].textContent = formatYi(totalValue);
      const red = strength.querySelector(".red-zone");
      const mid = strength.querySelector(".mid-zone");
      const green = strength.querySelector(".green-zone");
      const downRatio = sample ? down / sample * 100 : 0;
      const flatRatio = Math.max(0, 100 - upRatio - downRatio);
      if (red) red.style.width = `${Math.max(3, downRatio).toFixed(2)}%`;
      if (mid) mid.style.width = `${Math.max(3, flatRatio).toFixed(2)}%`;
      if (green) green.style.width = `${Math.max(3, upRatio).toFixed(2)}%`;
    }

    const ticker = market.querySelector(".ticker-strip");
    if (ticker && sectors.length) {
      const leaders = sectors.slice().sort((a, b) => marketNumber(b?.pct ?? b?.avgPct) - marketNumber(a?.pct ?? a?.avgPct)).slice(0, 24);
      ticker.innerHTML = leaders.map((sector) => {
        const pct = marketNumber(sector?.pct ?? sector?.avgPct);
        const leader = sector?.leader || normalizeArray(sector?.stocks)[0] || {};
        return `<span class="${pct >= 0 ? "ticker-up" : "ticker-down"}">${escapeHtml(sector?.name || sector?.industry || "--")} <b>${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</b> <small>${escapeHtml(leader?.name || leader?.code || "")}</small></span>`;
      }).join("");
    }
    const message = market.querySelector("#terminal-message");
    if (message) message.textContent = "市場總覽已同步 Supabase/API 快照，熱力圖可點選看相關股票。";
  }

  let marketSnapshotFirstLoading = false;
  function paintMarketSnapshotFirstPayload(payload = marketSnapshotFirstPayload, marketPayload = {}) {
    if (!payload?.sectors?.length || !isMarketViewActive()) return false;
    renderMarketOverviewApi(marketPayload || {}, payload);
    renderMarketHeatmapApi(payload.sectors, payload);
    return true;
  }

  function refreshMarketSnapshotFirst(force = false) {
    if (!isMarketViewActive()) return;
    restoreMarketDesktopMode();
    const paintedFromMemory = paintMarketSnapshotFirstPayload(marketSnapshotFirstPayload);
    if (marketSnapshotFirstLoading) return;
    marketSnapshotFirstLoading = true;
    const state = { market: null, heatmap: null };
    let pending = 2;
    const done = () => {
      pending -= 1;
      if (pending <= 0) marketSnapshotFirstLoading = false;
    };
    const paint = () => {
      if (!isMarketViewActive()) {
        marketSnapshotFirstLoading = false;
        return;
      }
      renderMarketOverviewApi(state.market || {}, state.heatmap || {});
      if (state.heatmap?.sectors?.length) renderMarketHeatmapApi(state.heatmap.sectors, state.heatmap);
    };
    const useSnapshotPayload = () => {
      if (!marketSnapshotFirstPayload?.sectors?.length) return false;
      state.heatmap = marketSnapshotFirstPayload;
      paintMarketSnapshotFirstPayload(state.heatmap, state.market || {});
      return true;
    };
    if (!force && !paintedFromMemory) {
      primeDesktopFastBundle(false, "market-snapshot-first").then(() => {
        if (useSnapshotPayload() && marketDesktopMode === "ai") {
          scheduleMarketApiAiRender(state.heatmap, marketRadarBundlePayload || {}, marketAiBundlePayload || {}, { delay: 140 });
        }
      });
    }
    const fetchHeatmap = () => {
      if (!force && useSnapshotPayload()) {
        done();
        return;
      }
      fetchMarketJson(marketHeatmapContractPath(), 36, force, MARKET_HEATMAP_FETCH_TIMEOUT_MS)
        .then((payload) => {
          if (payload?.sectors?.length) {
            state.heatmap = {
              ...payload,
              snapshotFirst: !isMarketHeatmapLiveWindow(),
              firstPaint: true,
            };
            marketSnapshotFirstPayload = state.heatmap;
            paint();
          }
        })
        .finally(done);
    };
    window.setTimeout(fetchHeatmap, (!force && !paintedFromMemory) ? 140 : 0);
    if (!force) {
      window.setTimeout(() => {
        fetchMarketJson(marketHeatmapContractPath(), 60, false, MARKET_HEATMAP_FETCH_TIMEOUT_MS).then((payload) => {
          if (payload?.sectors?.length && isMarketViewActive()) {
            marketSnapshotFirstPayload = { ...payload, snapshotFirst: !isMarketHeatmapLiveWindow(), firstPaint: false };
            paintMarketSnapshotFirstPayload(marketSnapshotFirstPayload, state.market || {});
          }
        });
      }, 850);
    }
    fetchMarketJson("/api/market", 24, force, 2200)
      .then((payload) => {
        state.market = payload || {};
        paint();
      })
      .finally(done);
  }

  function renderMarketHeatmapApi(sectors, payload) {
    const shell = ensureMarketDesktopShell();
    const market = shell.market || document.querySelector("#market-view");
    const heatmap = market?.querySelector?.("#heatmap");
    if (!heatmap) return;
    const rawSectors = normalizeArray(sectors);
    if (rawSectors.length) {
      marketHeatmapPayload = { ...(payload || {}), sectors: rawSectors };
      marketHeatmapGroups = buildMarketHeatmapGroups(rawSectors);
    }
    const mode = marketHeatmapGroups[marketHeatmapMode] ? marketHeatmapMode : "all";
    marketHeatmapMode = mode;
    const firstPaintLimit = payload?.firstPaint === true;
    const rows = normalizeArray(marketHeatmapGroups[mode] || rawSectors).slice(0, firstPaintLimit && mode === "all" ? 36 : mode === "all" ? 60 : 80);
    if (!rows.length) return;
    marketHeatmapSectorRows = rows;
    setMarketHeatmapModeButtons(market, mode);
    heatmap.innerHTML = `
      <div class="heatmap-health-bar"><strong>熱力圖 ${escapeHtml(marketHeatmapModeLabel(mode))}</strong><span>${escapeHtml(String(payload?.updatedAt || payload?.servedAt || ""))}</span></div>
      ${rows.map((sector, index) => {
        const pct = Number(sector.pct ?? sector.avgPct ?? 0) || 0;
        const leader = sector.leader || normalizeArray(sector.stocks)[0];
        const leaderText = typeof leader === "string"
          ? leader
          : leader ? `${leader.name || leader.code || "--"} ${Number(leader.pct || 0) >= 0 ? "+" : ""}${Number(leader.pct || 0).toFixed(2)}%` : "--";
        return `
          <article class="sector-card ${pct >= 0 ? "hot tw-up" : "cold tw-down"}" data-market-heatmap-sector="${index}" role="button" tabindex="0" title="查看 ${escapeHtml(sector.name || sector.industry || "分類")} 股票">
            <div>
              <h3>${escapeHtml(sector.name || sector.industry || "--")}</h3>
              <strong>${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</strong>
            </div>
            <p>${escapeHtml(String(sector.count || normalizeArray(sector.stocks).length || 0))} 檔 · ${escapeHtml(formatYi(sector.totalValue || sector.value || (Number(sector.amountYi || 0) * 100000000)))}</p>
            <small>▲ ${escapeHtml(String(sector.up || 0))} ▼ ${escapeHtml(String(sector.down || 0))}</small>
            <span>${escapeHtml(leaderText)}</span>
          </article>
        `;
      }).join("")}
    `;
    const titleCount = document.querySelector("#market-view .sector-section .section-title > span");
    if (titleCount) titleCount.textContent = `${marketHeatmapModeLabel(mode)} · ${rows.length} 個`;
  }

  function ensureMarketApiPanels() {
    const shell = ensureMarketDesktopShell();
    return { ai: shell.ai || null, radar: null };
  }

  function renderMarketApiAi(heatmapPayload, radarPayload, aiPayload = {}) {
    const panels = ensureMarketApiPanels();
    if (!panels.ai) return;
    const sectors = normalizeArray(heatmapPayload?.sectors);
    const radarRows = normalizeArray(radarPayload?.rows);
    const aiRows = [
      ...normalizeArray(aiPayload?.rows),
      ...normalizeArray(aiPayload?.items),
      ...normalizeArray(aiPayload?.signals),
      ...normalizeArray(aiPayload?.data),
      ...normalizeArray(aiPayload?.snapshot?.rows),
      ...normalizeArray(aiPayload?.market?.stocks),
      ...normalizeArray(aiPayload?.breadth?.stocks),
    ];
    const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    const pctOf = (item) => num(item?.pct ?? item?.avgPct ?? item?.percent);
    const nameOf = (item) => String(item?.name || item?.industry || item?.sector || "--");
    const stockName = (item) => String(item?.name || item?.Name || "");
    const stockCode = (item) => String(item?.code || item?.Code || item?.stockId || "").trim();
    const tradeDate = String(aiPayload?.dashboard?.tradeDate || aiPayload?.aiDetectWindow?.taipeiDate || aiPayload?.snapshot?.tradeDate || heatmapPayload?.resolvedTradeDate || heatmapPayload?.tradeDate || heatmapPayload?.date || "").replace(/-/g, "");
    const dateLabel = tradeDate.length >= 8 ? `${tradeDate.slice(4, 6)}/${tradeDate.slice(6, 8)}` : compactMarketTime(aiPayload?.updatedAt || heatmapPayload?.updatedAt || "");
    const detectWindow = aiPayload?.aiDetectWindow || {};
    const session = aiPayload?.marketSession || {};
    const isLiveWindow = detectWindow.active === true;
    const sessionTitle = isLiveWindow ? "巡邏中" : "收盤快照";
    const sessionText = isLiveWindow
      ? "09:00-13:30 AI 盤中巡邏，資料更新才重建判讀。"
      : "收盤後固定顯示最後 13:30 snapshot，不再追著即時波動重算。";
    const heatmapUp = sectors.reduce((sum, item) => sum + num(item.up), 0);
    const heatmapDown = sectors.reduce((sum, item) => sum + num(item.down), 0);
    const up = heatmapUp || num(aiPayload?.dashboard?.up || aiPayload?.summary?.up);
    const down = heatmapDown || num(aiPayload?.dashboard?.down || aiPayload?.summary?.down);
    const sectorStocks = sectors.flatMap((sector) => normalizeArray(sector.stocks).map((stock) => ({ ...stock, industry: nameOf(sector), sectorPct: pctOf(sector) })));
    const sample = num(heatmapPayload?.stockCount || heatmapPayload?.sample || heatmapPayload?.count || aiPayload?.dashboard?.sample || aiPayload?.breadth?.sample || aiPayload?.summary?.sample) || sectorStocks.length || aiRows.length || up + down;
    const directional = Math.max(up + down, 1);
    const upRatio = sample ? up / sample * 100 : 0;
    const directionalRatio = up / directional * 100;
    const confidence = aiPayload?.dashboard?.confidence || (Math.abs(up - down) >= Math.max(sample * 0.08, 60) ? "高" : Math.abs(up - down) >= Math.max(sample * 0.03, 25) ? "中" : "觀察");
    const bias = aiPayload?.dashboard?.bias || (up >= down ? "短線偏多" : "短線偏空");
    const strong = sectors.filter((item) => pctOf(item) > 0).sort((a, b) => pctOf(b) - pctOf(a)).slice(0, 5);
    const weak = sectors.filter((item) => pctOf(item) < 0).sort((a, b) => pctOf(a) - pctOf(b)).slice(0, 5);
    const radarLongs = radarRows.filter((row) => !String(row.side || row.direction || "").toLowerCase().includes("short")).slice(0, 10);
    const radarRisks = radarRows.filter((row) => String(row.side || row.direction || "").toLowerCase().includes("short")).slice(0, 8);
    const stockMap = new Map();
    const addStock = (stock, source, extraTags = []) => {
      const code = stockCode(stock);
      if (!code) return;
      const pct = num(stock.percent ?? stock.pct ?? stock.changePercent ?? stock.Change ?? stock.change ?? stock.change_pct);
      const value = num(stock.value ?? stock.tradeValue ?? stock.TradeValue ?? stock.amount ?? stock.amountYi);
      const volume = num(stock.volume ?? stock.tradeVolume ?? stock.TradeVolume ?? stock.totalVolume);
      const baseScore = num(stock.score || stock.radarScore || stock.aiScore || stock.finalScore || stock.rankScore);
      const score = Math.max(1, Math.min(100, Math.round(baseScore || 55 + Math.max(pct, 0) * 6 + Math.min(value / 100000000, 18))));
      const tags = [
        ...normalizeArray(stock.signalTags).slice(0, 3),
        ...normalizeArray(stock.tags).slice(0, 3),
        ...extraTags,
      ].filter(Boolean);
      const next = {
        code,
        name: stockName(stock) || code,
        industry: stock.industry || stock.sector || stock.category || stock.group || "--",
        pct,
        value,
        volume,
        score,
        side: stock.side || stock.direction || "多",
        reason: stock.reason || stock.signal || stock.description || stock.summary || source,
        source,
        tags: [...new Set(tags.length ? tags : [source])].slice(0, 5),
      };
      const old = stockMap.get(code);
      if (!old || next.score > old.score) stockMap.set(code, next);
    };
    radarRows.forEach((row) => addStock(row, "即時雷達", [String(row.side || "多")]));
    aiRows.slice(0, 80).forEach((row) => addStock(row, "AI 判讀", ["AI 判讀", row.source || row.cacheSource || "Supabase/API"]));
    sectorStocks.sort((a, b) => pctOf(b) - pctOf(a)).slice(0, 40).forEach((stock) => {
      const pct = pctOf(stock);
      addStock(stock, "熱力圖", [stock.industry, pct >= 0 ? "動能強" : "風險高"]);
    });
    let allStocks = [...stockMap.values()].sort((a, b) => b.score - a.score || b.pct - a.pct).slice(0, 30);
    if (!allStocks.length) {
      allStocks = radarLongs.map((row) => ({
        code: stockCode(row),
        name: stockName(row) || stockCode(row),
        industry: row.industry || "--",
        pct: num(row.percent ?? row.pct),
        value: num(row.value ?? row.tradeValue),
        volume: num(row.volume ?? row.tradeVolume),
        score: Math.max(1, Math.min(100, Math.round(num(row.score) || 60))),
        side: row.side || "多",
        reason: row.reason || "即時雷達",
        source: "即時雷達",
        tags: normalizeArray(row.signalTags).slice(0, 4),
      })).filter((row) => row.code);
    }
    const topStock = allStocks[0] || null;
    let groups = {
      all: allStocks.slice(0, 10),
      momentum: allStocks.filter((stock) => stock.pct > 0 || stock.tags.includes("動能強")).slice(0, 10),
      legal: allStocks.filter((stock) => /法|外資|投信|法人/.test(stock.tags.join("") + stock.reason)).slice(0, 10),
      intraday: allStocks.filter((stock) => /雷達|當沖|即時|多/.test(stock.tags.join("") + stock.source + stock.side)).slice(0, 10),
      risk: [...radarRisks.map((row) => {
        const code = stockCode(row);
        return {
          code,
          name: stockName(row) || code,
          industry: row.industry || "--",
          pct: num(row.percent ?? row.pct),
          value: num(row.value ?? row.tradeValue),
          volume: num(row.volume ?? row.tradeVolume),
          score: Math.max(1, Math.min(100, Math.round(num(row.score) || 60))),
          side: row.side || "空",
          reason: row.reason || "風險雷達",
          source: "風險雷達",
          tags: [...new Set([...normalizeArray(row.signalTags), "風險高"])].slice(0, 5),
        };
      }).filter((row) => row.code), ...allStocks.filter((stock) => stock.pct < 0)].slice(0, 10),
    };
    const normalizeDisplayStock = (stock, fallbackSource) => {
      const code = stockCode(stock);
      if (!code) return null;
      const tags = [
        ...normalizeArray(stock.signalTags),
        ...normalizeArray(stock.tags),
        stock.aiTag,
        stock.groupLabel,
        fallbackSource,
      ].filter(Boolean);
      return {
        code,
        name: stockName(stock) || code,
        industry: stock.industry || stock.sector || stock.category || stock.group || "--",
        pct: num(stock.percent ?? stock.pct ?? stock.changePercent ?? stock.Change ?? stock.change ?? stock.change_pct),
        value: num(stock.value ?? stock.tradeValue ?? stock.TradeValue ?? stock.amount ?? stock.amountYi),
        volume: num(stock.volume ?? stock.tradeVolume ?? stock.TradeVolume ?? stock.totalVolume),
        score: Math.max(1, Math.min(100, Math.round(num(stock.score || stock.radarScore || stock.aiScore || stock.finalScore || stock.rankScore) || 55))),
        side: stock.side || stock.direction || "多",
        reason: stock.reason || stock.signal || stock.description || stock.summary || fallbackSource,
        source: stock.source || fallbackSource,
        tags: [...new Set(tags.length ? tags : [fallbackSource])].slice(0, 5),
      };
    };
    const apiFilterRows = (key, aliases = []) => {
      const keys = [key, ...aliases];
      const group = keys.map((item) => aiPayload?.groups?.[item]).find(Boolean);
      const filter = normalizeArray(aiPayload?.filters).find((item) => keys.includes(item?.key));
      return normalizeArray(group?.rows || group?.stocks || filter?.rows || filter?.stocks)
        .map((stock) => normalizeDisplayStock(stock, group?.label || filter?.label || key))
        .filter(Boolean)
        .slice(0, 10);
    };
    const hasApiGroups = Boolean(aiPayload?.groups || normalizeArray(aiPayload?.filters).length);
    if (hasApiGroups) {
      groups = {
        all: apiFilterRows("all"),
        momentum: apiFilterRows("momentum"),
        legal: apiFilterRows("institution", ["legal"]),
        intraday: apiFilterRows("intraday"),
        risk: apiFilterRows("risk"),
      };
      if (!groups.all.length) groups.all = allStocks.slice(0, 10);
    }
    if (!hasApiGroups && !groups.legal.length) groups.legal = [];
    if (!hasApiGroups && !groups.momentum.length) groups.momentum = allStocks.slice(0, 10);
    if (!hasApiGroups && !groups.intraday.length) groups.intraday = allStocks.slice(0, 10);
    if (!hasApiGroups && !groups.risk.length) groups.risk = weak.flatMap((sector) => normalizeArray(sector.stocks).slice(0, 2).map((stock) => ({
      code: stockCode(stock),
      name: stockName(stock) || stockCode(stock),
      industry: nameOf(sector),
      pct: pctOf(stock),
      value: num(stock.value),
      volume: num(stock.volume),
      score: Math.max(1, Math.min(100, Math.round(55 + Math.abs(pctOf(stock)) * 5))),
      side: "風險",
      reason: "弱勢族群",
      source: "熱力圖",
      tags: ["風險高", nameOf(sector)],
    }))).filter((row) => row.code).slice(0, 10);
    const strongNames = strong.map((item) => nameOf(item)).slice(0, 3).join("、") || "等待族群擴散";
    const weakNames = weak.map((item) => nameOf(item)).slice(0, 3).join("、") || "暫無明顯弱勢";
    const riskNames = groups.risk.slice(0, 4).map((stock) => `${stock.code} ${stock.name}`).join("、") || weakNames;
    const biasTitle = /等待方向/.test(String(bias)) ? "等待方向" : up >= down ? "多方壓制" : "空方壓制";
    const biasToneClass = /多方|偏多|long|長/i.test(String(biasTitle))
      ? "market-ai-bullish"
      : /空方|偏空|short|空/i.test(String(biasTitle))
        ? "market-ai-bearish"
        : "market-ai-neutral";
    const heroMetricsHtml = `
      <div class="market-ai-hero-metrics">
        <span><small>樣本數</small><b>${sample.toLocaleString("zh-TW")}</b></span>
        <span><small>上漲</small><b>${up.toLocaleString("zh-TW")}</b></span>
        <span><small>下跌</small><b>${down.toLocaleString("zh-TW")}</b></span>
        <span><small>信心</small><b>${escapeHtml(confidence)}</b></span>
        <div class="market-ai-hero-action"><small>操作建議</small><b>${escapeHtml(aiPayload?.dashboard?.action || (up >= down ? "降低追價" : "等待方向"))}</b><span>${up >= down ? "盤面風險偏高時，先把進場條件收緊，避免追高。" : "盤面偏弱時，只看逆勢強股與量價確認。"}</span></div>
      </div>`;
    const pointTexts = normalizeArray(aiPayload?.todayPoints).length >= 4 ? normalizeArray(aiPayload.todayPoints) : [
      `市場廣度顯示上漲家數占 ${upRatio.toFixed(1)}%，站在全市場角度先判斷為${bias}。`,
      `族群焦點落在 ${strongNames}，平均漲幅領先者優先觀察擴散。`,
      `熱門觀察股優先看 ${groups.all.slice(0, 3).map((stock) => `${stock.code} ${stock.name}`).join("、") || "等待雷達資料"}。`,
      `風險端留意 ${riskNames}，分數高也要等量價延續確認。`,
    ];
    const pointHtml = pointTexts.slice(0, 6).map((text, index) => `<p><b>${index + 1}</b><span>${escapeHtml(text)}</span></p>`).join("");
    const evidenceRows = normalizeArray(aiPayload?.reasoning).length >= 4 ? normalizeArray(aiPayload.reasoning).slice(0, 4).map((item) => [
      item.kicker || item.key || "AI 依據",
      item.title || "--",
      item.text || item.reason || "",
      item.key || "ai",
    ]) : [
      ["廣度檢核", `上漲 ${upRatio.toFixed(2)}% / 下跌 ${sample ? (down / sample * 100).toFixed(2) : "0.00"}%`, `樣本 ${sample.toLocaleString("zh-TW")} 檔，依熱力圖 API 判斷市場方向。`, "breadth"],
      ["訊號母體", `${radarRows.length.toLocaleString("zh-TW")} 檔即時雷達`, "只採 API-only polling 最新資料，不讀舊 DOM snapshot。", "radar"],
      ["族群結構", `強族群前 ${Math.min(3, strong.length)} 名`, strongNames, "sector"],
      ["風險檢核", groups.risk.length ? "族群集中 / 融券壓力" : "風險暫無集中", riskNames, "risk"],
    ];
    const evidenceCardsHtml = evidenceRows.map(([kicker, title, text, key]) => `
      <article data-market-ai-drilldown="${escapeHtml(key)}" role="button" tabindex="0">
        <small>${escapeHtml(kicker)}</small>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(text)}</p>
        <i>›</i>
      </article>
    `).join("");
    const tabs = [
      ["all", "全部", "market-ai-radio-tab", groups.all],
      ["momentum", "動能強", "market-ai-radio-tab market-ai-radio-tab-momentum", groups.momentum],
      ["legal", "法人買超", "market-ai-radio-tab market-ai-radio-tab-legal", groups.legal],
      ["intraday", "當沖熱", "market-ai-radio-tab market-ai-radio-tab-intraday", groups.intraday],
      ["risk", "風險高", "market-ai-radio-tab market-ai-radio-tab-risk", groups.risk],
    ];
    const rowHtml = (stocks, key) => stocks.length ? stocks.slice(0, 10).map((stock, index) => `
      <article class="market-ai-stock-row">
        <div class="market-ai-rank">#${index + 1}</div>
        <div>
          <h4><span class="market-ai-code">${escapeHtml(stock.code)}</span><span class="market-ai-name">${escapeHtml(stock.name)}</span></h4>
          <p>${escapeHtml(stock.reason || stock.source)}，綜合分數 ${Math.round(stock.score)}</p>
          <p>排序主因：${escapeHtml(key === "risk" ? "風險排除" : key === "legal" ? "法人/資金訊號" : key === "intraday" ? "即時雷達" : "綜合分數")}；漲幅 ${stock.pct >= 0 ? "+" : ""}${stock.pct.toFixed(2)}%，成交額 ${escapeHtml(formatYi(stock.value))}。</p>
        </div>
        <div>
          <span class="market-ai-chip">${escapeHtml(stock.industry || "--")}</span>
          <span class="market-ai-chip">${stock.pct >= 0 ? "+" : ""}${stock.pct.toFixed(2)}%</span>
        </div>
        <div class="market-ai-score"><small>綜合分數</small><strong>${Math.round(stock.score)}</strong></div>
        <div class="market-ai-tags">${stock.tags.slice(0, 4).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
        <div class="market-ai-actions">
          <button type="button" data-ai-stock-code="${escapeHtml(stock.code)}" data-ai-stock-name="${escapeHtml(stock.name)}">看分析</button>
          <button type="button" data-ai-watch-code="${escapeHtml(stock.code)}" data-ai-watch-name="${escapeHtml(stock.name)}">加入自選</button>
        </div>
      </article>
    `).join("") : '<div class="empty-state">目前 AI 尚未篩出足夠觀察股。</div>';
    panels.ai.classList.add("market-ai-visual-dashboard");
    panels.ai.dataset.marketAiRenderer = "desktop-fast-shell";
    panels.ai.dataset.marketApiAi = aiPayload?.source || aiPayload?.cacheSource || "desktop-fast-shell";
    panels.ai.innerHTML = `
        <section class="market-ai-hero-board ${biasToneClass}">
          <div class="market-ai-hero-copy">
            <small>盤中決策節奏 · 資料 ${escapeHtml(dateLabel)}</small>
            <strong>${escapeHtml(biasTitle)}</strong>
            <p>${up >= down ? "多方候選與強勢延續標的較多，仍需確認族群擴散與量價延續。" : "下跌家數偏多，盤面先以風險控管為主；強勢股需確認族群延續，不追高雜訊。"}</p>
          </div>
          ${heroMetricsHtml}
        </section>
        <section class="market-ai-summary">
          <article class="market-ai-card hero ${biasToneClass}"><small>趨勢廣度</small><strong>${escapeHtml(biasTitle)}</strong><p>上漲 ${up.toLocaleString("zh-TW")} / 下跌 ${down.toLocaleString("zh-TW")}，有效漲跌多方占 ${directionalRatio.toFixed(1)}%。</p></article>
          <article class="market-ai-card warning"><small>風險控管</small><strong>${groups.risk.length ? "先控風險" : "風險正常"}</strong><p>${escapeHtml(weakNames)} 需留意，風險高標的不放入第一優先追蹤。</p></article>
          <article class="market-ai-card"><small>優先觀察</small><strong>${escapeHtml(aiPayload?.priorityObservation?.title || (topStock ? `${topStock.code} ${topStock.name}` : "--"))}</strong><p>${escapeHtml(aiPayload?.priorityObservation?.text || (topStock ? `${topStock.source}，分數 ${topStock.score}，族群 ${topStock.industry}。` : "等待即時雷達與熱力圖資料。"))}</p></article>
        </section>
        <section class="market-ai-decision-strip"><span>判讀依據與風險細節</span><small>${escapeHtml(sessionTitle)} · ${escapeHtml(sessionText)}</small></section>
        <section class="market-ai-decision-grid">
          <article data-market-ai-drilldown="focusStrong" role="button" tabindex="0"><small>族群聚焦</small><strong>只看強族群前 3 名</strong><i>›</i></article>
          <article data-market-ai-drilldown="riskExclude" role="button" tabindex="0"><small>風險排除</small><strong>風險高標的先排除</strong><i>›</i></article>
        </section>
        <section class="market-ai-evidence">
          <header><h4>AI 判讀依據</h4><span>只保留跟盤勢結論有關的關鍵線索</span></header>
          <div>${evidenceCardsHtml}</div>
        </section>
        <section class="market-ai-lower-grid">
          <article class="market-ai-points">
            <header><h4>AI 今日重點</h4><span>${escapeHtml(dateLabel)} 最新資料</span></header>
            ${pointHtml}
          </article>
          <article class="market-ai-risk-panel">
            <header><h4>風險提醒</h4><span>${groups.risk.length} 則</span></header>
            ${(normalizeArray(aiPayload?.riskNotes).length ? normalizeArray(aiPayload.riskNotes).slice(0, 3) : [
              { title: "族群集中", text: "主流若集中在少數族群，盤中容易出現追價後回落，先等第二波確認。" },
              { title: "融券壓力", text: `${riskNames} 若出現偏空或券資壓力，追蹤軋空與急拉後反轉風險。` },
            ]).map((item) => `<div><strong>${escapeHtml(item.title || "風險")}</strong><p>${escapeHtml(item.text || item.reason || "")}</p></div>`).join("")}
          </article>
        </section>
        <section class="market-ai-block market-ai-hot-section">
          <header><div><h4>熱門觀察股</h4><p>精選前 10 檔</p></div><span>API · ${escapeHtml(dateLabel)}</span></header>
          <div class="market-ai-filter-row">
            ${tabs.map(([key, label, klass, rows], index) => `<button type="button" class="${index === 0 ? "active" : ""}" data-market-ai-filter="${escapeHtml(key)}">${escapeHtml(label)} <b>${rows.length}</b></button>`).join("")}
          </div>
          <div class="market-ai-current-rule"><small>目前排序</small><strong>綜合分數</strong><span>綜合給分參考人氣強弱與族群排序；符合快速判讀今日熱門觀察股。</span></div>
          <div class="market-ai-hot">${rowHtml(groups.all, "all")}</div>
        </section>
    `;
    const hotSection = panels.ai.querySelector(".market-ai-hot-section");
    if (hotSection) {
      const hotList = hotSection.querySelector(".market-ai-hot");
      const currentRule = hotSection.querySelector(".market-ai-current-rule");
      const filterNotes = {
        all: ["綜合分數", "綜合給分參考人氣強弱與族群排序；符合快速判讀今日熱門觀察股。"],
        momentum: ["動能強", "依動能與漲幅排序，觀察價量是否延續。"],
        legal: ["法人買超", "依法人/資金訊號排序，用來觀察籌碼集中方向。"],
        intraday: ["當沖熱", "依即時雷達與當沖熱度排序。"],
        risk: ["風險高", "依風險訊號排序，先列需要控管追價的標的。"],
      };
      hotSection.addEventListener("click", (event) => {
        const button = event.target.closest?.("[data-market-ai-filter]");
        if (!button || !hotSection.contains(button)) return;
        const key = button.dataset.marketAiFilter || "all";
        const tab = tabs.find(([tabKey]) => tabKey === key) || tabs[0];
        hotSection.querySelectorAll("[data-market-ai-filter]").forEach((item) => item.classList.toggle("active", item === button));
        if (hotList) hotList.innerHTML = rowHtml(tab[3] || [], key);
        if (currentRule) {
          const [title, note] = filterNotes[key] || filterNotes.all;
          currentRule.innerHTML = `<small>目前排序</small><strong>${escapeHtml(title)}</strong><span>${escapeHtml(note)}</span>`;
        }
      });
    }
    syncMarketAiDesktopModeIfVisible();
  }

  function renderMarketApiRadar(radarPayload) {
    const panels = ensureMarketApiPanels();
    if (!panels.radar) return;
    const rows = normalizeArray(radarPayload?.rows).slice(0, 10);
    panels.radar.innerHTML = rows.length ? `
      <div class="stock-table">
        <div class="strategy-row strategy-head"><span>股票</span><span>方向</span><span>價格</span><span>漲幅</span><span>分數</span><span>訊號</span></div>
        ${rows.map((row) => `
          <div class="strategy-row">
            <span><strong>${escapeHtml(row.code || "")}</strong><small>${escapeHtml(row.name || "")}</small></span>
            <span>${escapeHtml(row.side || "--")}</span>
            <span>${escapeHtml(String(row.close || "--"))}</span>
            <span class="${Number(row.percent || row.pct || 0) >= 0 ? "down" : "up"}">${Number(row.percent || row.pct || 0).toFixed(2)}%</span>
            <em>${escapeHtml(String(Math.round(Number(row.score || 0))))}</em>
            <small>${escapeHtml(normalizeArray(row.signalTags).slice(0, 3).join("、") || "--")}</small>
          </div>
        `).join("")}
      </div>
    ` : '<div class="empty-state">即時雷達 API 暫無資料。</div>';
  }

  function refreshMarketApiOnly(force = false) {
    if (!isMarketViewActive() || marketApiOnlyLoading || isInteractionHoldActive()) return;
    restoreMarketDesktopMode();
    marketApiOnlyLoading = true;
    const aiMode = marketDesktopMode === "ai";
    const state = {
      market: null,
      heatmap: null,
      radar: aiMode ? marketRadarBundlePayload : null,
      ai: aiMode ? marketAiBundlePayload : null,
    };
    let pending = aiMode ? 5 : 3;
    const done = () => {
      pending -= 1;
      if (pending <= 0) marketApiOnlyLoading = false;
    };
    const signature = () => JSON.stringify({
      market: normalizeArray(state.market?.indexes).map((item) => `${item["指數"]}:${item["收盤指數"]}:${item["漲跌"]}:${item["漲跌點數"]}:${item["漲跌百分比"]}`).join("|"),
      futures: `${state.market?.futuresNear?.price || state.market?.futures?.price || ""}:${state.market?.futuresNext?.price || ""}`,
      heatmap: normalizeArray(state.heatmap?.sectors).slice(0, 60).map((item) => `${item.name || item.industry}:${item.pct ?? item.avgPct}:${item.up}:${item.down}:${item.count}`).join("|"),
      ai: state.ai?.snapshot?.snapshotId || state.ai?.aiDetectWindow?.active || state.ai?.summary?.strategy2Count || "",
      radar: state.radar?.runId || state.radar?.timestamp || state.radar?.rows?.[0]?.detectedAt || "",
      heatmapCount: state.heatmap?.sectorCount || normalizeArray(state.heatmap?.sectors).length,
      radarCount: normalizeArray(state.radar?.rows).length,
    });
    const renderIfChanged = (allowSame = false) => {
      if (!isMarketViewActive()) {
        marketApiOnlyLoading = false;
        return;
      }
      const nextSignature = signature();
      if (!allowSame && !force && nextSignature === marketApiOnlySignature) return;
      marketApiOnlySignature = nextSignature;
      renderMarketOverviewApi(state.market || {}, state.heatmap || {});
      if (state.heatmap?.sectors?.length) renderMarketHeatmapApi(state.heatmap.sectors, state.heatmap);
      if (marketDesktopMode === "ai") {
        scheduleMarketApiAiRender(
          state.heatmap || marketSnapshotFirstPayload || {},
          state.radar || marketRadarBundlePayload || {},
          state.ai || marketAiBundlePayload || {},
          { delay: hasMarketAiPayload(state.ai || marketAiBundlePayload) ? 110 : 240 },
        );
        renderMarketApiRadar(state.radar || {});
      }
    };
    fetchMarketJson("/api/market", 24, force, 6500)
      .then((payload) => {
        state.market = payload || {};
        renderIfChanged(true);
      })
      .finally(done);
    fetchMarketJson(marketHeatmapContractPath(), 60, force, MARKET_HEATMAP_FETCH_TIMEOUT_MS)
      .then((payload) => {
        if (payload?.sectors?.length) {
          state.heatmap = {
            ...payload,
            snapshotFirst: !isMarketHeatmapLiveWindow(),
          };
          marketSnapshotFirstPayload = state.heatmap;
          renderIfChanged(true);
        }
      })
      .finally(done);
    fetchMarketJson("/api/heatmap", 60, force, MARKET_HEATMAP_FETCH_TIMEOUT_MS)
      .then((payload) => {
        if (payload?.sectors?.length) {
          state.heatmap = payload || {};
          marketSnapshotFirstPayload = state.heatmap;
          renderIfChanged(true);
        }
      })
      .finally(done);
    if (aiMode) {
      fetchMarketJson("/api/realtime-radar-latest", 20, force, MARKET_RADAR_FETCH_TIMEOUT_MS)
        .then((payload) => {
          state.radar = payload || {};
          renderIfChanged(true);
        })
        .finally(done);
      fetchMarketJson("/api/market-ai-live", 20, force, MARKET_AI_LIVE_FETCH_TIMEOUT_MS)
        .then((payload) => {
          state.ai = payload || {};
          renderIfChanged(true);
        })
        .finally(done);
    }
  }

  window.FUMAN_MARKET_API_HYDRATE = function hydrateMarketApiOnly(force = true) {
    marketApiOnlyLoading = false;
    refreshMarketApiOnly(Boolean(force));
  };

  function installMarketApiOnlyHydrator() {
    const run = (force = false) => refreshMarketApiOnly(force);
    const schedule = (force = false, delay = 6200) => {
      window.clearTimeout(window.__fumanMarketOverviewRefreshTimer || 0);
      window.__fumanMarketOverviewRefreshTimer = window.setTimeout(() => {
        if (!isMarketViewActive()) return;
        if (isInteractionHoldActive()) {
          schedule(force, interactionHoldRemaining() + 1200);
          return;
        }
        run(force);
      }, Math.max(300, delay));
    };
    const boot = () => {
      restoreMarketDesktopMode();
      refreshMarketSnapshotFirst(false);
      schedule(false, 120);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
    if (!window.__fumanMarketHeatmapModalReady) {
      window.__fumanMarketHeatmapModalReady = true;
      document.addEventListener("click", (event) => {
        const mode = event.target.closest?.("[data-market-mode]");
        if (mode) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          selectMarketDesktopMode(mode.dataset.marketMode, "document-click");
          return;
        }
        const heatmapMode = event.target.closest?.("[data-market-heatmap-mode]");
        if (heatmapMode) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          marketHeatmapMode = heatmapMode.dataset.marketHeatmapMode || "all";
          const payload = marketHeatmapPayload || marketSnapshotFirstPayload || {};
          renderMarketHeatmapApi(payload.sectors || marketHeatmapSectorRows, payload);
          return;
        }
        const close = event.target.closest?.("[data-market-heatmap-close]");
        if (close || event.target.matches?.("[data-market-heatmap-modal]")) {
          closeMarketHeatmapSectorModal();
          return;
        }
        const card = event.target.closest?.("[data-market-heatmap-sector]");
        if (!card) return;
        renderMarketHeatmapSectorModal(card.dataset.marketHeatmapSector);
      }, true);
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeMarketHeatmapSectorModal();
          return;
        }
        if (event.key !== "Enter" && event.key !== " ") return;
        const mode = event.target.closest?.("[data-market-mode]");
        if (mode) {
          event.preventDefault();
          selectMarketDesktopMode(mode.dataset.marketMode, "document-keydown");
          return;
        }
        const heatmapMode = event.target.closest?.("[data-market-heatmap-mode]");
        if (heatmapMode) {
          event.preventDefault();
          marketHeatmapMode = heatmapMode.dataset.marketHeatmapMode || "all";
          const payload = marketHeatmapPayload || marketSnapshotFirstPayload || {};
          renderMarketHeatmapApi(payload.sectors || marketHeatmapSectorRows, payload);
          return;
        }
        const card = event.target.closest?.("[data-market-heatmap-sector]");
        if (!card) return;
        event.preventDefault();
        renderMarketHeatmapSectorModal(card.dataset.marketHeatmapSector);
      }, true);
    }
    window.addEventListener("fuman:desktop-route", (event) => {
      if (isMarketRoute(event?.detail?.key)) {
        refreshMarketSnapshotFirst(false);
        schedule(false, 120);
      }
    });
    window.addEventListener("focus", () => schedule(false, 2200));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") schedule(false, 2200);
    });
    setInterval(() => run(false), API_ONLY_POLL_MS);
    [9000, 14000].forEach((delay) => {
      window.setTimeout(() => {
        if (isMarketViewActive()) window.FUMAN_MARKET_API_HYDRATE?.(true);
      }, delay);
    });
  }

  function canvasShellHtml(key, meta) {
    const payloadMeta = canvasPayloadMeta(key);
    const summaryText = strategy5MetaSummary(meta.summary, key);
    return `
      <section class="desktop-route-shell desktop-canvas-app" data-route-shell="${escapeHtml(key)}" data-route-source="${escapeHtml(canvasState.source || "")}" data-run-id="${escapeHtml(payloadMeta?.runId || "")}" data-result-count="${escapeHtml(payloadMeta?.resultCount || "")}" data-evidence-status="${escapeHtml(payloadMeta?.evidenceStatus || "")}" data-unattended-status="${escapeHtml(payloadMeta?.unattendedStatus || "")}">
        <div class="desktop-route-shell-head">
          <span data-canvas-meta-icon>${escapeHtml(meta.icon)}</span>
          <div>
            <h2 data-canvas-meta-title>${escapeHtml(meta.title)}</h2>
            <p data-canvas-meta-summary>${escapeHtml(summaryText)}</p>
          </div>
        </div>
        <div class="desktop-route-shell-grid">
          <article><span>切換狀態</span><strong data-canvas-switch-state>立即</strong></article>
          <article><span>資料狀態</span><strong data-canvas-data-state>${isLiveStrategyRoute(key) ? "即時偵測" : canvasState.rows.length ? "快照命中" : "背景更新"}</strong></article>
          <article><span>手感模式</span><strong data-canvas-mode-state>Worker Canvas</strong></article>
        </div>
        <div class="desktop-canvas-toolbar">
          <label class="desktop-canvas-search-wrap">
            <span>搜尋</span>
            <input class="desktop-canvas-search" value="${escapeHtml(canvasState.query || "")}" placeholder="代號 / 名稱 / 訊號" autocomplete="off" spellcheck="false">
          </label>
          <button type="button" class="desktop-canvas-refresh" data-canvas-refresh>刷新</button>
          <span class="desktop-canvas-count">${escapeHtml(`${canvasState.filtered.length}/${canvasState.rows.length}`)}</span>
          <span class="desktop-canvas-status">${escapeHtml(canvasWorkerReady ? canvasWorkerMode : canvasState.source || "shell")}</span>
        </div>
        <div class="desktop-strategy4-zone-filters" data-strategy4-zone-filters hidden></div>
        <div class="desktop-strategy4-signal-filters" data-strategy4-signal-filters hidden></div>
        <div class="desktop-strategy4-signal-filters" data-chip-canvas-filters hidden></div>
        <canvas class="desktop-route-canvas" tabindex="0" aria-label="${escapeHtml(meta.title)} Canvas 快速列表"></canvas>
        <div class="desktop-canvas-empty-note" data-canvas-empty-note hidden></div>
        <div class="desktop-canvas-pagination" data-canvas-pagination hidden></div>
        <div class="desktop-canvas-detail" hidden></div>
      </section>
    `;
  }

  function strategy2NoteLabel(row, tone, history = false) {
    const raw = compactText(row?.signalLine || row?.subStrategy || row?.reason || row?.state || "", history ? 120 : 72);
    if (!history && tone === "prepare" && /暫停進場區顯示|市場來源/.test(raw)) return row?.state && row.state !== "待確認" ? row.state : "預備進場";
    if (raw) return raw;
    if (tone === "entry") return "進場";
    if (tone === "prepare") return "預備進場";
    return "--";
  }

  function strategy2PriceLabel(row) {
    const value = row?.entryPrice || row?.price || "";
    return formatPriceValue(value) || String(value || "--");
  }

  function strategy2RowsHtml(rows, mode = "history") {
    const isEntryTable = mode === "entry";
    if (!rows.length) {
      return `<div class="strategy2-empty">${isEntryTable ? "目前沒有即時進場 / 預備進場訊號" : "目前沒有今日歷史紀錄"}</div>`;
    }
    if (isEntryTable) {
      return `
        <div class="strategy2-entry-cards">
          ${rows.map((row) => {
            const tone = strategy2Tone(row);
            const note = strategy2NoteLabel(row, tone, false);
            const code = row?.code || "--";
            const title = row?.title || row?.name || code;
            const price = strategy2PriceLabel(row);
            const pct = row?.pct || "--";
            const score = row?.score || "--";
            const time = strategy2TimeLabel(row);
            const state = tone === "entry" ? "真正進場" : "預備進場";
            return `
              <article class="strategy2-entry-card strategy2-card-${escapeHtml(tone)}">
                <aside class="strategy2-card-time">
                  <small>偵測時間</small>
                  <strong>${escapeHtml(time)}</strong>
                  <em>${escapeHtml(state)}</em>
                </aside>
                <div class="strategy2-card-code">${escapeHtml(code)}</div>
                <div class="strategy2-card-name">
                  <strong>${escapeHtml(title)}</strong>
                  <span>${escapeHtml(code)}</span>
                </div>
                <div class="strategy2-card-metric price"><small>現價</small><strong>${escapeHtml(price)}</strong></div>
                <div class="strategy2-card-metric score"><small>分數</small><strong>${escapeHtml(score)}</strong></div>
                <div class="strategy2-card-metric change hot"><small>漲幅</small><strong>${escapeHtml(pct)}</strong></div>
                <div class="strategy2-card-line now"><b>現況</b><span>現價 ${escapeHtml(price)}｜${escapeHtml(state)}｜分數 ${escapeHtml(score)}</span></div>
                <div class="strategy2-card-line key"><b>關鍵價</b><span>觀察 ${escapeHtml(price)} 附近；站穩再追，跌破觸發價先降碼。</span></div>
                <div class="strategy2-card-line watch"><b>觀察</b><span>${escapeHtml(note)}</span></div>
                <div class="strategy2-card-line power"><b>盤力</b><span>短線量價偏強；等待 1 分 K 延續與成交量確認。</span></div>
                <div class="strategy2-card-line risk"><b>風控</b><span>入場後以觸發 K 低點與風險線防守，未升級前不重倉。</span></div>
                <div class="strategy2-card-line action"><b>操作</b><span>假突破後重新站回日盤力回溫才做；若全天盤力偏弱，短打處理。</span></div>
              </article>
            `;
          }).join("")}
        </div>
      `;
    }
    const body = rows.map((row, index) => {
      const tone = isEntryTable ? strategy2Tone(row) : "history";
      const note = strategy2NoteLabel(row, tone, !isEntryTable);
      const pct = row?.pct || "--";
      const score = row?.score || "--";
      return `
        <tr class="strategy2-battle-row strategy2-tone-${escapeHtml(tone)}">
          <td class="strategy2-col-rank">${escapeHtml(isEntryTable ? strategy2TimeLabel(row) : String(index + 1))}</td>
          <td class="strategy2-col-time">${escapeHtml(isEntryTable ? row?.code || "--" : strategy2TimeLabel(row))}</td>
          <td class="strategy2-col-symbol">
            <strong>${escapeHtml(isEntryTable ? row?.title || row?.code || "--" : row?.code || "--")}</strong>
            <span>${escapeHtml(isEntryTable ? row?.code || "" : row?.title || "")}</span>
          </td>
          <td class="strategy2-col-price">${escapeHtml(strategy2PriceLabel(row))}</td>
          <td class="strategy2-col-note"><span>${escapeHtml(note)}</span></td>
          <td class="strategy2-col-score">${escapeHtml(score)}</td>
          <td class="strategy2-col-change">${escapeHtml(pct)}</td>
        </tr>
      `;
    }).join("");
    return `
      <table class="strategy2-terminal-table ${isEntryTable ? "strategy2-top-table" : "strategy2-history-table"}">
        <thead>
          <tr>
            <th>${isEntryTable ? "進場時間" : "序"}</th>
            <th>${isEntryTable ? "標的" : "進場時間"}</th>
            <th>${isEntryTable ? "名稱" : "標的"}</th>
            <th>進場價</th>
            <th>備註</th>
            <th>分數</th>
            <th>漲幅</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  function strategy2BattleShellHtml(key, meta) {
    return `
      <section class="desktop-route-shell desktop-canvas-app strategy2-battle-shell" data-route-shell="${escapeHtml(key)}" data-route-source="${escapeHtml(canvasState.source || "")}">
        <div class="strategy2-battle-header">
          <div>
            <span class="strategy2-battle-kicker">${escapeHtml(meta.icon)} 策略2</span>
            <h2 data-canvas-meta-title>${escapeHtml(meta.title)}</h2>
            <p data-canvas-meta-summary>當沖即時偵測，今日進場與歷史紀錄分區顯示。</p>
          </div>
          <div class="strategy2-battle-stats">
            <strong class="desktop-canvas-count">${escapeHtml(`${canvasState.filtered.length}筆`)}</strong>
            <span class="desktop-canvas-status">${escapeHtml(canvasState.source || "api")}</span>
            <button type="button" class="strategy2-battle-refresh" data-canvas-refresh>刷新</button>
          </div>
        </div>
        ${strategy2HealthBannerHtml()}
        <div class="strategy2-battle-board">
          <section class="strategy2-battle-panel strategy2-entry-panel" aria-label="即時進場">
            <header>
              <div>
                <span data-strategy2-entry-title>即時進場（最新在上）</span>
                <strong data-strategy2-entry-count>0 筆</strong>
              </div>
              <small data-strategy2-entry-note>進場黃字，預備進場深藍</small>
            </header>
            <div class="strategy2-battle-scroll" data-strategy2-entry-rows></div>
          </section>
          <section class="strategy2-battle-panel strategy2-history-panel" aria-label="今日歷史紀錄">
            <header>
              <div>
                <span>今日歷史紀錄（最新在上）</span>
                <strong data-strategy2-history-count>0 筆</strong>
              </div>
              <small>完整保留今日 live API 偵測列</small>
            </header>
            <div class="strategy2-battle-scroll" data-strategy2-history-rows></div>
          </section>
        </div>
      </section>
    `;
  }

  function updateStrategy2BattleShell(shell, key, meta) {
    if (!shell) return;
    shell.dataset.routeShell = key;
    shell.dataset.routeSource = canvasState.source || "";
    const rows = [...canvasState.filtered].sort(strategy2SortRows);
    const liveRows = rows.filter((row) => {
      const tone = strategy2Tone(row);
      return tone === "entry" || tone === "prepare";
    }).slice(0, 10);
    const entryCount = liveRows.filter((row) => strategy2Tone(row) === "entry").length;
    const prepareCount = liveRows.filter((row) => strategy2Tone(row) === "prepare").length;
    const title = shell.querySelector("[data-canvas-meta-title]");
    const summary = shell.querySelector("[data-canvas-meta-summary]");
    const count = shell.querySelector(".desktop-canvas-count");
    const status = shell.querySelector(".desktop-canvas-status");
    const emptyNote = shell.querySelector("[data-canvas-empty-note]");
    const entryCountNode = shell.querySelector("[data-strategy2-entry-count]");
    const entryTitle = shell.querySelector("[data-strategy2-entry-title]");
    const entryNote = shell.querySelector("[data-strategy2-entry-note]");
    const historyCountNode = shell.querySelector("[data-strategy2-history-count]");
    const entryRows = shell.querySelector("[data-strategy2-entry-rows]");
    const historyRows = shell.querySelector("[data-strategy2-history-rows]");
    const oldBanner = shell.querySelector("[data-strategy2-health-banner]");
    const nextBanner = strategy2HealthBannerHtml();
    const afterhoursHold = strategy2AfterhoursHoldActive();
    if (oldBanner) oldBanner.remove();
    if (nextBanner) {
      const header = shell.querySelector(".strategy2-battle-header");
      if (header) header.insertAdjacentHTML("afterend", nextBanner);
    }
    if (title) title.textContent = meta.title;
    if (summary) summary.textContent = afterhoursHold
      ? "今日策略2圖卡收盤後保留顯示，24:00 自動重置。"
      : "當沖即時偵測，今日進場與歷史紀錄分區顯示。";
    if (count) count.textContent = `${rows.length}筆`;
    if (status) status.textContent = String(canvasState.source || "").includes("snapshot-first")
      ? "快照先顯示｜即時刷新中"
      : canvasState.source || "api";
    if (entryTitle) entryTitle.textContent = afterhoursHold ? "今日進場保留（24:00 重置）" : "即時進場（最新在上）";
    if (entryCountNode) entryCountNode.textContent = `${entryCount} 進場 / ${prepareCount} 預備`;
    if (entryNote) entryNote.textContent = afterhoursHold
      ? "收盤後保留今日進場圖卡，24:00 重置"
      : entryCount ? "黃色為進場列，深藍為預備進場" : "深藍為預備進場，黃字只留給真正進場";
    if (historyCountNode) historyCountNode.textContent = `${rows.length} 筆`;
    if (entryRows) entryRows.innerHTML = strategy2RowsHtml(liveRows, "entry");
    if (historyRows) historyRows.innerHTML = strategy2RowsHtml(rows, "history");
  }

  function radarDomTimeValue(row) {
    const raw = String(row?.firstSignalTime || row?.time || row?.quoteTime || row?.lastSignalTime || "").trim();
    const hms = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (hms) return cleanNumber(hms[1]) * 3600 + cleanNumber(hms[2]) * 60 + cleanNumber(hms[3] || 0);
    const stamp = Date.parse(raw);
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function radarDomTimeLabel(row) {
    const raw = String(row?.firstSignalTime || row?.time || row?.quoteTime || row?.lastSignalTime || "").trim();
    const hms = raw.match(/\d{1,2}:\d{2}(?::\d{2})?/);
    return hms ? hms[0] : raw || "--:--";
  }

  function radarDomSessionRows(rows = []) {
    const start = 9 * 60 * 60;
    const end = 13 * 60 * 60 + 30 * 60;
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => {
        const seconds = radarDomTimeValue(row);
        return !seconds || (seconds >= start && seconds <= end);
      })
      .sort((a, b) => radarDomTimeValue(b) - radarDomTimeValue(a)
        || cleanNumber(b.score) - cleanNumber(a.score)
        || radarCanvasValue(b) - radarCanvasValue(a)
        || String(a.code).localeCompare(String(b.code), "zh-Hant"));
  }

  function radarDomDateLabel(rows = []) {
    const raw = (Array.isArray(rows) ? rows : []).map((row) => row?.radarDate || row?.tradeDate || row?.quoteDate).find(Boolean) || "";
    const text = String(raw || "").trim();
    const dashed = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (dashed) return `${dashed[2]}/${dashed[3]}`;
    const compact = text.replace(/\D/g, "");
    return compact.length >= 8 ? `${compact.slice(4, 6)}/${compact.slice(6, 8)}` : "--/--";
  }

  function radarDomTags(row, limit = 6) {
    const tags = [
      ...normalizeArray(row?.tags),
      ...normalizeArray(row?.signalTags),
      row?.signalLine,
      row?.signal,
      row?.reason,
    ].flatMap((item) => Array.isArray(item) ? item : String(item || "").split(/[\/｜,，、]/u));
    return [...new Set(tags.map((tag) => compactText(String(tag || "").trim(), 16)).filter(Boolean))].slice(0, limit);
  }

  function radarDomStockChips(row) {
    return [
      cleanNumber(row?.foreign) > 0 ? "外資買超" : cleanNumber(row?.foreign) < 0 ? "外資賣超" : "",
      cleanNumber(row?.trust) > 0 ? "投信買超" : cleanNumber(row?.trust) < 0 ? "投信賣超" : "",
      cleanNumber(row?.totalInst) > 0 ? "三大法人買超" : cleanNumber(row?.totalInst) < 0 ? "三大法人賣超" : "",
      row?.quoteSource ? "即時報價" : "",
      row?.score ? `分數 ${Math.round(cleanNumber(row.score))}` : "",
    ].filter(Boolean).slice(0, 5);
  }

  function radarDomHealthBanner() {
    const health = realtimeRadarDomHealth;
    if (!health) return "";
    return `
      <section class="radar-health-banner ${health.stale ? "stale" : "degraded"}">
        <strong>${escapeHtml(health.title)}</strong>
        <span>${escapeHtml(health.detail)}</span>
        ${health.source ? `<small>${escapeHtml(health.source)}</small>` : ""}
      </section>
    `;
  }

  function radarDomFlowSummary(rows = []) {
    const longRows = rows.filter((row) => radarCanvasSide(row) === "long");
    const shortRows = rows.filter((row) => radarCanvasSide(row) === "short");
    const longFlow = longRows.reduce((sum, row) => sum + Math.max(radarCanvasValue(row), 0), 0);
    const shortFlow = shortRows.reduce((sum, row) => sum + Math.max(radarCanvasValue(row), 0), 0);
    const netFlow = longFlow - shortFlow;
    const total = Math.max(longFlow + shortFlow, 1);
    return {
      longRows,
      shortRows,
      longFlow,
      shortFlow,
      netFlow,
      longShare: Math.max(3, Math.min(97, (longFlow / total) * 100)),
      confidence: Math.max(55, Math.min(95, Math.round(Math.max(longFlow / total, shortFlow / total) * 100))),
    };
  }

  function radarDomAiPanel(title, rows, side) {
    const short = side === "short";
    const chips = rows.slice(0, 5).map((row) => `<span class="radar-ai-chip">${escapeHtml(`${row.code} ${row.title || ""}`.trim())}</span>`).join("");
    const names = rows.slice(0, 5).map((row) => `${row.code} ${row.title || ""}`.trim()).join("、") || "等待訊號";
    const note = short
      ? `空方訊號集中在 ${names}，留意開低走弱、反彈失敗與籌碼壓力。`
      : `多方訊號集中在 ${names}，留意續強、量能延伸與突破持續。`;
    return `
      <section class="radar-ai-panel ${short ? "short" : ""}">
        <h3>${escapeHtml(title)} ${escapeHtml(String(rows.length))} 檔</h3>
        <div class="radar-ai-chips">${chips || `<span class="radar-ai-chip">等待訊號</span>`}</div>
        <p>${escapeHtml(note)}</p>
      </section>
    `;
  }

  function radarDomSignalCard(row) {
    const side = radarCanvasSide(row);
    const short = side === "short";
    const tags = radarDomTags(row, 7);
    const conditionTags = tags.slice(0, 6);
    const chipTags = radarDomStockChips(row);
    const pct = radarCanvasPct(row);
    const pctText = `${pct >= 0 ? "▲ +" : "▼ "}${pct.toFixed(2)}%`;
    const price = formatPriceValue(row?.price || row?.close) || String(row?.price || row?.close || "--");
    return `
      <article class="radar-signal-card ${short ? "short" : ""}" data-stock-code="${escapeHtml(row?.code || "")}">
        <div class="radar-jump">
          <span>跳出</span>
          <strong>${escapeHtml(radarDomTimeLabel(row))}</strong>
        </div>
        <div class="radar-signal-main">
          <div class="radar-signal-name">${escapeHtml(row?.title || row?.name || row?.code || "--")} <small>${escapeHtml(row?.code || "")}</small></div>
          <div class="radar-signal-meta">成交金額 ${escapeHtml(radarCanvasMoney(radarCanvasValue(row)))} · 成交量 ${escapeHtml(formatCompactNumber(row?.volume || row?.tradeVolume) || "--")} · 分數 ${escapeHtml(String(Math.round(cleanNumber(row?.score))))}</div>
          <div class="radar-signal-chips">${tags.slice(0, 5).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
        </div>
        <div class="radar-signal-price">
          <strong>${escapeHtml(price)}</strong>
          <small>${escapeHtml(pctText)}</small>
        </div>
        <div class="radar-condition-list">
          ${(conditionTags.length ? conditionTags : [row?.reason || row?.signal || "--"]).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
        </div>
        <div class="radar-chip-list">
          ${(chipTags.length ? chipTags : [short ? "空方壓力" : "多方動能"]).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
        </div>
      </article>
    `;
  }

  function ensureRealtimeRadarDomStyle() {
    if (document.querySelector("#fuman-realtime-radar-dom-style")) return;
    const link = document.createElement("link");
    link.id = "fuman-realtime-radar-dom-style";
    link.rel = "stylesheet";
    link.href = "/terminal-realtime-radar.css?v=radar-ledger-20260630-02";
    document.head.appendChild(link);
  }

  function renderRealtimeRadarDomShell(link, source, rows = []) {
    const panel = panelForRoute(REALTIME_RADAR_ROUTE);
    if (!panel) return false;
    ensureRealtimeRadarDomStyle();
    const incomingRows = rows.length ? rows : rowsForRoute(REALTIME_RADAR_ROUTE);
    const sessionRows = radarDomSessionRows(incomingRows.length ? incomingRows : canvasState.rows);
    const flow = radarDomFlowSummary(sessionRows);
    if (!["long", "short"].includes(realtimeRadarDomSide)) realtimeRadarDomSide = "long";
    if (!realtimeRadarDomSideUserSelected) realtimeRadarDomSide = "long";
    if (realtimeRadarDomSide === "long" && !flow.longRows.length && flow.shortRows.length) realtimeRadarDomSide = "short";
    if (realtimeRadarDomSide === "short" && !flow.shortRows.length && flow.longRows.length) realtimeRadarDomSide = "long";
    const activeRows = realtimeRadarDomSide === "short" ? flow.shortRows : flow.longRows;
    const activeLabel = realtimeRadarDomSide === "short" ? "空方" : "多方";
    const meta = strategyMeta(link || REALTIME_RADAR_ROUTE);
    const sourceLabel = String(source || canvasState.source || "api");
    panel.dataset.fumanRouteSnapshotRestoring = "1";
    panel.dataset.fumanRealtimeRadarDom = "1";
    delete panel.dataset.fumanCanvasPersistent;
    panel.classList.add("radar-dom-active");
    panel.classList.remove("fuman-fixed-shell-panel", "fuman-fixed-shell-active");
    panel.querySelectorAll(":scope > .desktop-route-shell.desktop-canvas-app").forEach((node) => node.remove());
    panel.innerHTML = `
      <section class="radar-dom-shell" data-realtime-radar-dom-shell data-route-source="${escapeHtml(sourceLabel)}">
        <header class="radar-topbar">
          <div>
            <small>${escapeHtml(meta.icon)} 即時多空資金雷達</small>
            <h1>${escapeHtml(meta.title)}</h1>
          </div>
          <small>資料日期 ${escapeHtml(radarDomDateLabel(sessionRows))} · 09:00-13:30 流水帳逐筆記錄 · 總筆數 ${escapeHtml(String(sessionRows.length))} 筆 · ${escapeHtml(sourceLabel)}</small>
          <button class="radar-action" type="button" data-radar-dom-refresh>刷新</button>
        </header>
        ${radarDomHealthBanner()}
        <section class="radar-ai-box overview">
          <div class="radar-ai-head">
            <span>◎ AI 即時判斷</span>
            <span>信心 ${escapeHtml(String(flow.confidence))}%</span>
          </div>
          <div class="radar-ai-grid">
            ${radarDomAiPanel("↗ 偏多 AI 分析", flow.longRows, "long")}
            ${radarDomAiPanel("↘ 偏空 AI 分析", flow.shortRows, "short")}
          </div>
          <p class="radar-ai-note">多方 ${escapeHtml(radarCanvasMoney(flow.longFlow))} / 空方 ${escapeHtml(radarCanvasMoney(flow.shortFlow))}，淨流向 ${escapeHtml(radarCanvasMoney(flow.netFlow))}，完整保留 09:00-13:30 盤中訊號。</p>
        </section>
        <nav class="radar-board-tabs" aria-label="即時雷達流水帳篩選">
          <button type="button" data-radar-dom-side="long" class="${realtimeRadarDomSide === "long" ? "active" : ""}">多方 ${escapeHtml(String(flow.longRows.length))}</button>
          <button type="button" data-radar-dom-side="short" class="${realtimeRadarDomSide === "short" ? "short-active active" : "short-active"}">空方 ${escapeHtml(String(flow.shortRows.length))}</button>
        </nav>
        <div class="radar-session-strip">
          <span>09:00-13:30 流水帳逐筆記錄 · ${escapeHtml(activeLabel)} ${escapeHtml(String(activeRows.length))} 筆</span>
          <span>最新在上</span>
        </div>
        <section class="radar-board-list" data-radar-dom-list>
          ${activeRows.length ? activeRows.map(radarDomSignalCard).join("") : `<div class="radar-empty">目前沒有${escapeHtml(activeLabel)}訊號</div>`}
        </section>
      </section>
    `;
    window.setTimeout(() => delete panel.dataset.fumanRouteSnapshotRestoring, 0);
    return true;
  }

  function ensurePersistentFixedCanvas(route) {
    if (!FIXED_CANVAS_PERSIST_ROUTES.includes(route)) return false;
    const panel = panelForRoute(route);
    if (!panel) return false;
    if (panel.querySelector(":scope > .desktop-route-shell.desktop-canvas-app.desktop-fixed-page-shell")) return true;
    panel.dataset.fumanCanvasPersistent = "1";
    panel.classList.add("fuman-fixed-shell-panel");
    const meta = strategyMeta(route);
    const html = canvasShellHtml(route, meta)
      .replace("desktop-route-shell desktop-canvas-app", "desktop-route-shell desktop-canvas-app desktop-fixed-page-shell")
      .replace("data-route-source=\"\"", "data-route-source=\"persistent\"");
    const header = panel.querySelector(":scope > header");
    if (header) header.insertAdjacentHTML("afterend", html);
    else panel.insertAdjacentHTML("afterbegin", html);
    return true;
  }

  function installPersistentFixedCanvases() {
    if (document.documentElement.dataset.fumanPersistentFixedCanvasReady === "1") return;
    document.documentElement.dataset.fumanPersistentFixedCanvasReady = "1";
    const run = () => {
      FIXED_CANVAS_PERSIST_ROUTES.forEach(ensurePersistentFixedCanvas);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
    else run();
    new MutationObserver(() => run()).observe(document.documentElement, { childList: true, subtree: true });
  }

  function updateCanvasShell(shell, key, meta) {
    if (!shell) return null;
    const payloadMeta = canvasPayloadMeta(key);
    shell.dataset.routeShell = key;
    shell.dataset.routeSource = canvasState.source || "";
    shell.dataset.runId = payloadMeta?.runId || "";
    shell.dataset.resultCount = payloadMeta?.resultCount ? String(payloadMeta.resultCount) : "";
    shell.dataset.evidenceStatus = payloadMeta?.evidenceStatus || "";
    shell.dataset.unattendedStatus = payloadMeta?.unattendedStatus || "";
    shell.classList.toggle("desktop-strategy4-paged-shell", isStrategy4Route(key));
    const icon = shell.querySelector("[data-canvas-meta-icon]") || shell.querySelector(".desktop-route-shell-head > span");
    const title = shell.querySelector("[data-canvas-meta-title]") || shell.querySelector(".desktop-route-shell-head h2");
    const summary = shell.querySelector("[data-canvas-meta-summary]") || shell.querySelector(".desktop-route-shell-head p");
    const dataState = shell.querySelector("[data-canvas-data-state]") || shell.querySelector(".desktop-route-shell-grid article:nth-child(2) strong");
    const modeState = shell.querySelector("[data-canvas-mode-state]") || shell.querySelector(".desktop-route-shell-grid article:nth-child(3) strong");
    const count = shell.querySelector(".desktop-canvas-count");
    const status = shell.querySelector(".desktop-canvas-status");
    const input = shell.querySelector(".desktop-canvas-search");
    let canvas = shell.querySelector(".desktop-route-canvas");
    const emptyState = currentCanvasEmptyState();
    if ((isStrategy3Route(key) || emptyState) && canvas?.dataset?.fumanWorkerCanvas === "1") {
      canvas = replaceWorkerCanvasForMainDraw(shell, canvas, meta);
    }
    if (icon) icon.textContent = meta.icon;
    if (title) title.textContent = meta.title;
    if (summary) summary.textContent = strategy5MetaSummary(meta.summary, key);
    if (dataState) dataState.textContent = isLiveStrategyRoute(key) ? "即時偵測" : canvasState.rows.length ? "快照命中" : emptyState ? "受控等待" : "背景更新";
    if (modeState) modeState.textContent = canvasWorkerReady ? "OffscreenCanvas" : "Canvas";
    if (count) count.textContent = `${canvasState.filtered.length}/${canvasState.rows.length}`;
    if (status) status.textContent = emptyState ? emptyState.reason || "waiting" : canvasWorkerReady ? canvasWorkerMode : canvasState.source || "shell";
    syncCanvasEmptyStateUi(shell);
    if (input && document.activeElement !== input) input.value = canvasState.query || "";
    if (canvas) canvas.setAttribute("aria-label", `${meta.title} Canvas 快速列表`);
    updateStrategySignalControls(shell);
    updateStrategy4ZoneControls(shell);
    updateChipTradeFilterControls(shell);
    updateCanvasPagination(shell);
    return canvas;
  }

  function renderStrategyRouteShell(link, source, rows = []) {
    const panel = document.querySelector("#strategy-view");
    if (!panel) return false;
    const key = strategyRouteKey(link);
    const previousRoute = canvasState.route;
    const incomingRows = rows.length ? rows : rowsForRoute(key);
    const stored = canvasStore.get(key);
    activeSnapshotRoute = key;
    canvasState.route = key;
    canvasState.source = source || stored?.source || "shell";
    canvasState.meta = stored?.meta || null;
    canvasState.rows = incomingRows;
    if (previousRoute !== key) {
      canvasState.signalFilter = "";
      canvasState.zoneFilter = "";
      canvasState.offset = 0;
      canvasState.hoverIndex = -1;
      canvasState.selectedIndex = -1;
      hideCanvasDetail();
    }
    applyCanvasFilter();
    if (isRealtimeRadarRoute(key)) {
      const rendered = renderRealtimeRadarDomShell(link, source, canvasState.filtered.length ? canvasState.filtered : canvasState.rows);
      window.setTimeout(() => delete panel.dataset.fumanRouteSnapshotRestoring, 0);
      return rendered;
    }
    const meta = strategyMeta(link);
    panel.dataset.fumanRouteSnapshotRestoring = "1";
    panel.dataset.fumanCanvasPersistent = "1";
    panel.classList.add("fuman-api-only-strategy-route");
    panel.classList.remove("strategy5-only", "strategy3-only", "swing-only", "open-buy-only");
    const headerTitle = panel.querySelector(".strategy-header h1");
    const headerText = panel.querySelector(".strategy-header p");
    const headerBadge = panel.querySelector(".strategy-header .console-badge");
    const toolbarTitle = panel.querySelector(".strategy-toolbar h2");
    const toolbarBadge = panel.querySelector(".strategy-toolbar .console-badge");
    const summary = panel.querySelector("#strategy-summary");
    const count = panel.querySelector("#strategy-match-count");
    const avg = panel.querySelector("#strategy-avg-score");
    const top = panel.querySelector("#strategy-top-hit");
    const table = panel.querySelector("#strategy-table");

    if (headerTitle) headerTitle.textContent = `${meta.icon} ${meta.title}`;
    if (headerText) headerText.textContent = meta.summary;
    if (headerBadge) headerBadge.textContent = meta.badge;
    if (toolbarTitle) toolbarTitle.textContent = meta.title;
    if (toolbarBadge) toolbarBadge.textContent = meta.badge;
    const scoreValues = canvasState.filtered.map((row) => cleanNumber(row.score)).filter((value) => value);
    const avgScore = scoreValues.length ? Math.round(scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length) : 0;
    if (summary) summary.textContent = `${meta.title}｜Canvas 常駐列表，資料背景同步。`;
    if (count) count.textContent = String(canvasState.filtered.length || "--");
    if (avg) avg.textContent = avgScore ? String(avgScore) : "--";
    if (top) top.textContent = canvasState.filtered[0]?.code || "--";
    if (table) {
      let shell = table.querySelector(".desktop-route-shell.desktop-canvas-app");
      if (isStrategy2Route(key)) {
        if (!shell || !shell.classList.contains("strategy2-battle-shell")) {
          table.innerHTML = strategy2BattleShellHtml(key, meta);
          shell = table.querySelector(".desktop-route-shell.desktop-canvas-app");
        }
        updateStrategy2BattleShell(shell, key, meta);
      } else if (!shell || shell.classList.contains("strategy2-battle-shell")) {
        table.innerHTML = canvasShellHtml(key, meta);
        shell = table.querySelector(".desktop-route-shell.desktop-canvas-app");
        const canvas = updateCanvasShell(shell, key, meta);
        drawCanvasShellFrame(canvas, meta);
      } else {
        const canvas = updateCanvasShell(shell, key, meta);
        drawCanvasShellFrame(canvas, meta);
      }
    }
    window.setTimeout(() => delete panel.dataset.fumanRouteSnapshotRestoring, 0);
    return true;
  }

  function renderFixedPageShell(link, source, rows = []) {
    const key = fixedRouteKey(link);
    window.clearTimeout(window.__fumanMarketOverviewRefreshTimer || 0);
    marketApiOnlyLoading = false;
    const panel = panelForRoute(key);
    if (!key || !panel) return false;
    if (isMarketRoute(key)) return renderMarketOverviewShell(link, source);
    const previousRoute = canvasState.route;
    const stored = canvasStore.get(key);
    const incomingRows = rows.length ? rows : rowsForRoute(key);
    activeSnapshotRoute = key;
    canvasState.route = key;
    canvasState.source = source || stored?.source || "shell";
    canvasState.rows = incomingRows;
    if (previousRoute !== key) {
      canvasState.signalFilter = isChipTradeRoute(key) ? CHIP_TRADE_DEFAULT_FILTER : "";
      canvasState.zoneFilter = "";
      canvasState.offset = 0;
      canvasState.hoverIndex = -1;
      canvasState.selectedIndex = -1;
      hideCanvasDetail();
    }
    applyCanvasFilter();
    if (isRealtimeRadarRoute(key)) {
      const rendered = renderRealtimeRadarDomShell(link, source, canvasState.filtered.length ? canvasState.filtered : canvasState.rows);
      window.setTimeout(() => delete panel.dataset.fumanRouteSnapshotRestoring, 0);
      return rendered;
    }
    const meta = strategyMeta(link);
    panel.dataset.fumanRouteSnapshotRestoring = "1";
    panel.dataset.fumanCanvasPersistent = "1";
    panel.classList.add("fuman-fixed-shell-panel", "fuman-fixed-shell-active");
    let shell = panel.querySelector(":scope > .desktop-route-shell.desktop-canvas-app.desktop-fixed-page-shell");
    if (!shell) {
      const html = canvasShellHtml(key, meta).replace("desktop-route-shell desktop-canvas-app", "desktop-route-shell desktop-canvas-app desktop-fixed-page-shell");
      const header = panel.querySelector(":scope > header");
      if (header) header.insertAdjacentHTML("afterend", html);
      else panel.insertAdjacentHTML("afterbegin", html);
      shell = panel.querySelector(":scope > .desktop-route-shell.desktop-canvas-app.desktop-fixed-page-shell");
    }
    const canvas = updateCanvasShell(shell, key, meta);
    drawCanvasShellFrame(canvas, meta);
    window.setTimeout(() => delete panel.dataset.fumanRouteSnapshotRestoring, 0);
    return true;
  }

  function switchFixedViewNow(link) {
    const key = fixedRouteKey(link);
    activeSnapshotRoute = key || activeSnapshotRoute;
    const panel = panelForRoute(key);
    if (!panel) return false;
    document.querySelectorAll(".view-panel").forEach((item) => {
      const active = item === panel;
      item.classList.toggle("active", active);
      item.hidden = !active;
      item.setAttribute("aria-hidden", active ? "false" : "true");
    });
    document.querySelectorAll("[data-view]").forEach((item) => {
      const active = item === link;
      item.classList.toggle("active", active);
      item.classList.toggle("fuman-instant-active", false);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    return true;
  }

  function restoreFixedPageSnapshot(link) {
    const key = fixedRouteKey(link);
    if (!key) return false;
    if (isApiOnlySnapshotRoute(key)) return false;
    if (isMarketRoute(key)) return false;
    activeSnapshotRoute = key;
    const memoryItem = routeSnapshots.get(key);
    if (memoryItem?.rows?.length && Date.now() - Number(memoryItem.at || 0) <= SNAPSHOT_MAX_AGE_MS) {
      setCanvasRows(key, memoryItem.rows, "canvas-memory", memoryItem.at || Date.now());
      renderFixedPageShell(link, "canvas-memory", memoryItem.rows);
      return true;
    }
    const sessionItem = readSessionSnapshot(key);
    if (sessionItem?.rows?.length) {
      routeSnapshots.set(key, sessionItem);
      setCanvasRows(key, sessionItem.rows, "canvas-session", sessionItem.at || Date.now());
      renderFixedPageShell(link, "canvas-session", sessionItem.rows);
      return true;
    }
    readIndexedSnapshot(key).then((item) => {
      if (!item?.rows?.length || activeSnapshotRoute !== key) return;
      routeSnapshots.set(key, item);
      writeSessionSnapshot(key, item);
      setCanvasRows(key, item.rows, "canvas-indexeddb", item.at || Date.now());
      renderFixedPageShell(link, "canvas-indexeddb", item.rows);
    }).catch(() => undefined);
    return false;
  }

  function activateStrategyRoute(link, source) {
    startLatency(link, source || "strategy");
    beginInteractionHold(`strategy-${source || "route"}`);
    const key = strategyRouteKey(link);
    const route = publishActiveRoute(link, key, source || "strategy");
    const seq = route?.seq || ++routeSwitchSeq;
    switchStrategyViewNow(link);
    markLatency("nav", key);
    const rows = rowsForRoute(key);
    renderStrategyRouteShell(link, source, rows);
    markLatency("shell", key);
    restoreStrategySnapshot(link);
    const snapshotFirst = isStrategy2Route(key) && strategy2SnapshotFirstEnabled();
    const snapshotFirstRowsTask = snapshotFirst
      ? primeStrategy2SnapshotFirst(false, "route")
      : isStrategy2Route(key)
        ? primeStrategy2LiveRows(false, "route")
      : fetchCanvasRows(key, isLiveStrategyRoute(key));
    window.setTimeout(() => {
      if (!isRouteCurrent(key, seq) || activeSnapshotRoute !== key || canvasState.route !== key) return;
      snapshotFirstRowsTask.then((apiRows) => {
        if (!isRouteCurrent(key, seq) || activeSnapshotRoute !== key || canvasState.route !== key) return;
        if (apiRows?.length) {
          const paintSource = snapshotFirst ? "snapshot-first-refreshing" : "api";
          const paintSnapshotFirst = () => {
            renderStrategyRouteShell(key, paintSource, apiRows);
            if (snapshotFirst) setCanvasStatus("快照先顯示｜即時刷新中");
            markLatency(snapshotFirst ? "snapshot" : "api", key);
            updateLatencyPanel();
          };
          if (snapshotFirst) paintSnapshotFirst();
          else scheduleRoutePaint(key, seq, paintSnapshotFirst, "api");
          if (snapshotFirst) {
            window.setTimeout(() => {
              if (!isRouteCurrent(key, seq) || activeSnapshotRoute !== key || canvasState.route !== key) return;
              fetchCanvasRows(key, true).then((liveRows) => {
                if (!isRouteCurrent(key, seq) || activeSnapshotRoute !== key || canvasState.route !== key) return;
                if (liveRows?.length) scheduleRoutePaint(key, seq, () => renderStrategyRouteShell(key, "api-live", liveRows), "api-live");
              }).catch(() => setCanvasStatus("快照先顯示｜即時刷新稍後重試"));
            }, 900);
          }
        } else {
          scheduleCanvasDraw();
        }
      }).catch(() => setCanvasStatus("沿用快照"));
    }, snapshotFirst ? 0 : rows.length ? 80 : 140);
  }

  function activateFixedPageRoute(link, source) {
    const key = fixedRouteKey(link);
    if (!key || isStrategyLink(link)) return false;
    const now = Date.now();
    if (source === "click" && key === fixedClickRoute && now - fixedClickAt < 360) return true;
    fixedClickRoute = key;
    fixedClickAt = now;
    startLatency(link, source || "fixed");
    const route = publishActiveRoute(link, key, source || "fixed");
    const seq = route?.seq || ++routeSwitchSeq;
    beginInteractionHold(`fixed-${source || "route"}`, 720);
    switchFixedViewNow(link);
    markLatency("nav", key);
    if (isMarketRoute(key)) {
      renderMarketOverviewShell(link, source || "market-click");
      refreshMarketSnapshotFirst(false);
      scheduleMarketDesktopModeHydrate(marketDesktopMode, false);
      markLatency("shell", key);
      return true;
    }
    const panel = panelForRoute(key);
    let rows = rowsForRoute(key);
    if (isRealtimeRadarRoute(key)) {
      renderFixedPageShell(link, source || "realtime", rows);
      markLatency("shell", key);
      window.setTimeout(() => {
        if (!isRouteCurrent(key, seq) || activeSnapshotRoute !== key || canvasState.route !== key) return;
        fetchCanvasRows(key, false).then((apiRows) => {
          if (!isRouteCurrent(key, seq) || activeSnapshotRoute !== key || canvasState.route !== key) return;
          if (apiRows?.length) {
            scheduleRoutePaint(key, seq, () => renderFixedPageShell(link, "api", apiRows), "api");
          } else {
            renderRealtimeRadarDomShell(link, canvasState.source || "api", canvasState.rows);
          }
        }).catch(() => renderRealtimeRadarDomShell(link, canvasState.source || "snapshot", canvasState.rows));
      }, rows.length ? 90 : 160);
      return true;
    }
    if (!rows.length && !isApiOnlySnapshotRoute(key)) {
      const domRows = extractLiteRows(panel);
      if (domRows.length) {
        setCanvasRows(key, domRows, "dom-hot", Date.now());
        routeSnapshots.set(key, { at: Date.now(), rows: domRows, html: "" });
        rows = domRows;
      }
    }
    if (key === "watchlist|自選股") {
      removeFixedPageShell(key);
      renderWatchlistInstantRows();
      ensureWatchlistShell().then((api) => {
        api?.render?.();
        if (typeof window.FUMAN_WATCHLIST_SHELL_FORCE_ADD === "function") {
          document.documentElement.dataset.fumanWatchlistFallbackReady = "1";
        }
      }).catch(() => undefined);
      markLatency("shell", key);
      return true;
    }
    renderFixedPageShell(link, source, rows);
    markLatency("shell", key);
    if (!isChipTradeRoute(key) && !isApiOnlySnapshotRoute(key)) restoreFixedPageSnapshot(link);
    window.setTimeout(() => {
      if (!isRouteCurrent(key, seq) || activeSnapshotRoute !== key || canvasState.route !== key) return;
      fetchCanvasRows(key, false).then((apiRows) => {
        if (!isRouteCurrent(key, seq) || activeSnapshotRoute !== key || canvasState.route !== key) return;
        if (apiRows?.length) {
          scheduleRoutePaint(key, seq, () => renderFixedPageShell(link, "api", apiRows), "api");
        } else {
          scheduleCanvasDraw();
        }
      }).catch(() => setCanvasStatus("沿用快照"));
    }, rows.length ? 90 : 160);
    return true;
  }

  function switchStrategyViewNow(link) {
    activeSnapshotRoute = strategyRouteKey(link) || activeSnapshotRoute;
    if (window.FUMAN_HOTFIX_SWITCH_VIEW_NOW?.(link)) return true;
    const panel = document.querySelector("#strategy-view");
    if (!panel) return false;
    document.querySelectorAll(".view-panel").forEach((item) => {
      const active = item === panel;
      item.classList.toggle("active", active);
      item.hidden = !active;
      item.setAttribute("aria-hidden", active ? "false" : "true");
    });
    document.querySelectorAll("[data-view]").forEach((item) => {
      item.classList.toggle("active", item === link);
      item.classList.toggle("fuman-instant-active", false);
      if (item === link) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    return true;
  }

  function installRouteSnapshots() {
    const panel = document.querySelector("#strategy-view");
    if (!panel) {
      document.addEventListener("DOMContentLoaded", installRouteSnapshots, { once: true });
      return;
    }
    if (!panel || panel.dataset.fumanRouteSnapshotReady === "1") return;
    panel.dataset.fumanRouteSnapshotReady = "1";
    SNAPSHOT_ROUTES.forEach((key) => {
      if (isApiOnlyPollingRoute(key)) return;
      const item = readSessionSnapshot(key);
      if (item && isApiBackedSnapshotItem(item)) {
        routeSnapshots.set(key, item);
        setCanvasRows(key, item.rows, "session", item.at || Date.now());
      }
      readIndexedSnapshot(key).then((dbItem) => {
        if (dbItem && isApiBackedSnapshotItem(dbItem)) {
          routeSnapshots.set(key, dbItem);
          setCanvasRows(key, dbItem.rows, "indexeddb", dbItem.at || Date.now());
        }
      }).catch(() => undefined);
    });
    new MutationObserver(() => {
      if (panel.dataset.fumanRouteSnapshotRestoring === "1") return;
      scheduleStrategySnapshotSave();
    }).observe(panel, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") saveStrategySnapshotNow();
    });
  }

  function installShowViewGuard() {
    if (window.__fumanDesktopShowViewGuard === "20260623-09") return;
    const tryInstall = () => {
      let original = null;
      try {
        original = eval('typeof showView !== "undefined" ? showView : undefined');
      } catch (error) {
        original = window.showView;
      }
      if (typeof original !== "function") {
        window.setTimeout(tryInstall, 80);
        return;
      }
      if (original.__fumanDesktopShowViewGuard) {
        window.__fumanDesktopShowViewGuard = "20260623-09";
        return;
      }
      const guarded = function (viewName, activeLink = null, ...rest) {
        if (window.FUMAN_DESKTOP_ROUTE_STATE?.shouldBlockView?.(viewName, activeLink)) {
          return null;
        }
        return original.call(this, viewName, activeLink, ...rest);
      };
      guarded.__fumanDesktopShowViewGuard = original;
      try {
        eval("showView = guarded");
      } catch (error) {
        window.showView = guarded;
      }
      window.showView = guarded;
      window.__fumanDesktopShowViewGuard = "20260623-09";
    };
    tryInstall();
  }

  function dispatchOfficialClick(link, sourceEvent) {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
      ctrlKey: !!sourceEvent.ctrlKey,
      shiftKey: !!sourceEvent.shiftKey,
      altKey: !!sourceEvent.altKey,
      metaKey: !!sourceEvent.metaKey,
      button: 0,
    });
    try {
      Object.defineProperty(event, "__fumanDesktopFastShellClick", { value: true });
    } catch (error) {
      event.__fumanDesktopFastShellClick = true;
    }
    link.dispatchEvent(event);
  }

  function runStrategyFastClick(link, sourceEvent, alreadyActivated = false) {
    const route = routeKey(link);
    const now = Date.now();
    if (route === fastClickRoute && now - fastClickAt < 180) return;
    fastClickRoute = route;
    fastClickAt = now;
    beginInteractionHold("strategy-fast-click");
    if (!alreadyActivated) activateStrategyRoute(link, "fast-click");
  }

  function setPending(link, source) {
    if (!link) return;
    const route = routeKey(link);
    const now = Date.now();
    if (route === lastRoute && now - lastAt < 120) return;
    lastRoute = route;
    lastAt = now;

    document.querySelectorAll(".fuman-shell-pending").forEach((item) => {
      if (item !== link) item.classList.remove("fuman-shell-pending");
    });
    link.classList.add("fuman-shell-pending");

    window.clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(clearPending, 120);
  }

  function clearPending() {
    document.querySelectorAll(".fuman-shell-pending").forEach((item) => {
      item.classList.remove("fuman-shell-pending");
    });
  }

  function installRouteFeedback() {
    document.addEventListener("pointerdown", (event) => {
      const link = event.target.closest?.(NAV_SELECTOR);
      if (!link || !isPrimaryPointer(event)) return;
      markFastEvent(event);
      markInstantActive(link);
      if (isStrategyLink(link)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        beginInteractionHold("strategy-pointer");
        activateStrategyRoute(link, "pointer");
        setPending(link, "strategy-pointer");
        runStrategyFastClick(link, event, true);
        return;
      }
      if (fixedRouteKey(link)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      beginInteractionHold("nav-pointer", 520);
      activateFixedPageRoute(link, "pointer");
      setPending(link, "pointer");
    }, true);

    document.addEventListener("mouseover", (event) => {
      const link = event.target.closest?.(NAV_SELECTOR);
      if (isInteractionHoldActive()) return;
      if (link) {
        const key = fixedRouteKey(link);
        if (key && rowsForRoute(key).length) {
          window.clearTimeout(hoverPreRenderTimer);
          hoverPreRenderTimer = window.setTimeout(() => preRenderStrategyRoute(key, "hover-buffer"), HOVER_WARM_IDLE_MS);
        }
      }
    }, true);

    document.addEventListener("click", (event) => {
      const link = event.target.closest?.(NAV_SELECTOR);
      if (event.__fumanDesktopFastShellClick) return;
      if (!link || event.__fumanDeferredViewClick || event.__fumanFastOfficialClick) return;
      markFastEvent(event);
      if (isStrategyLink(link) && routeKey(link) === fastClickRoute && Date.now() - fastClickAt < 700) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!isStrategyLink(link)) {
        if (fixedRouteKey(link)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        activateFixedPageRoute(link, "click");
      }
      setPending(link, "click");
    }, true);
  }

  function installCanvasThemeObserver() {
    if (document.documentElement.dataset.fumanDesktopCanvasThemeObserver === "1") return;
    document.documentElement.dataset.fumanDesktopCanvasThemeObserver = "1";
    let previousTheme = canvasThemeMode();
    const repaint = () => {
      const nextTheme = canvasThemeMode();
      if (nextTheme === previousTheme) return;
      previousTheme = nextTheme;
      canvasPreRenderedRoutes.clear();
      canvasWorkerRowsVersion = -1;
      scheduleCanvasDraw();
      primeStrategyBuffers(`theme-${nextTheme}`);
    };
    if (document.body) {
      new MutationObserver(repaint).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    } else {
      document.addEventListener("DOMContentLoaded", installCanvasThemeObserver, { once: true });
    }
  }

  function installDesktopThemeToggle() {
    const run = () => {
      if (!document.body) return;
      const themeKey = window.FUMAN_RUNTIME_CONFIG?.themeKey || "fuman-terminal-theme";
      let switcher = document.querySelector("#fuman-display-switcher");
      if (!switcher) {
        switcher = document.createElement("div");
        switcher.id = "fuman-display-switcher";
        switcher.className = "fuman-display-switcher";
        document.body.appendChild(switcher);
      }
      let button = document.querySelector("#fuman-theme-toggle");
      if (!button) {
        button = document.createElement("button");
        button.id = "fuman-theme-toggle";
        button.className = "fuman-theme-toggle";
        button.type = "button";
      }
      if (button.parentElement !== switcher) switcher.appendChild(button);
      let menu = document.querySelector("#fuman-display-menu");
      if (!menu) {
        menu = document.createElement("div");
        menu.id = "fuman-display-menu";
        menu.className = "fuman-display-menu";
        menu.hidden = true;
        menu.setAttribute("role", "menu");
        menu.innerHTML = '<a href="/api/mobile-page" role="menuitem">手機版</a><a href="/?desktop=1" role="menuitem">電腦版</a>';
      }
      if (menu.parentElement !== switcher) switcher.appendChild(menu);
      const setMenuOpen = (open) => {
        menu.hidden = !open;
        button.setAttribute("aria-expanded", open ? "true" : "false");
      };
      const applyTheme = (theme) => {
        const light = theme === "light";
        document.body.classList.toggle("fuman-light-theme", light);
        document.documentElement.dataset.fumanTheme = light ? "light" : "dark";
        button.textContent = light ? "☀" : "☾";
        button.title = light ? "切換月亮模式，開啟版本選單" : "切換陽光模式，開啟版本選單";
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-haspopup", "menu");
        button.dataset.fumanThemeToggleReady = "1";
        canvasPreRenderedRoutes.clear();
        canvasWorkerRowsVersion = -1;
        scheduleCanvasDraw();
      };
      const queryTheme = new URLSearchParams(location.search).get("theme") || "";
      const savedTheme = localStorage.getItem(themeKey) || "";
      const initialTheme = /陽光|light|sun/i.test(queryTheme) ? "light" : /夜幕|月亮|dark|moon/i.test(queryTheme) ? "dark" : savedTheme === "light" ? "light" : "dark";
      applyTheme(initialTheme);
      if (button.dataset.fumanDesktopFastBound !== "1") {
        button.dataset.fumanDesktopFastBound = "1";
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const next = document.body.classList.contains("fuman-light-theme") ? "dark" : "light";
          localStorage.setItem(themeKey, next);
          applyTheme(next);
          setMenuOpen(true);
        });
      }
      if (switcher.dataset.fumanDisplayMenuBound !== "1") {
        switcher.dataset.fumanDisplayMenuBound = "1";
        document.addEventListener("click", (event) => {
          if (!switcher.contains(event.target)) setMenuOpen(false);
        });
        document.addEventListener("keydown", (event) => {
          if (event.key === "Escape") setMenuOpen(false);
        });
      }
    };
    if (document.body) run();
    else document.addEventListener("DOMContentLoaded", run, { once: true });
  }

  function keepDesktopFastStyleLast() {
    if (document.documentElement.dataset.fumanDesktopFastStyleOrder === "1") return;
    document.documentElement.dataset.fumanDesktopFastStyleOrder = "1";
    const move = () => {
      const style = document.querySelector("#fuman-desktop-fast-shell-style");
      if (style && document.head && style !== document.head.lastElementChild) {
        document.head.appendChild(style);
      }
    };
    [0, 180, 700, 1600, 3200].forEach((delay) => window.setTimeout(move, delay));
    if (document.head) {
      new MutationObserver(move).observe(document.head, { childList: true });
    }
  }

  function installStyle() {
    if (document.querySelector("#fuman-desktop-fast-shell-style")) return;
    const style = document.createElement("style");
    style.id = "fuman-desktop-fast-shell-style";
    style.textContent = `
      html.fuman-desktop-fast-shell,
      html.fuman-desktop-fast-shell body {
        scroll-behavior: auto !important;
      }
      .fuman-shell-pending {
        border-color: rgba(255, 112, 55, 0.9) !important;
        outline: 1px solid rgba(255, 112, 55, 0.72) !important;
        box-shadow: none !important;
      }
      [data-view].fuman-instant-active,
      [data-view].fuman-instant-active.active {
        border-color: rgba(255, 112, 55, 0.98) !important;
        background:
          linear-gradient(90deg, rgba(255, 112, 55, 0.22), rgba(255, 112, 55, 0.08)),
          rgba(30, 41, 59, 0.76) !important;
        outline: 1px solid rgba(255, 112, 55, 0.58) !important;
        box-shadow: none !important;
        color: #fff7ed !important;
      }
      body.fuman-light-theme [data-view].fuman-instant-active,
      body.fuman-light-theme [data-view].fuman-instant-active.active {
        background:
          linear-gradient(90deg, rgba(255, 112, 55, 0.18), rgba(255, 247, 237, 0.96)),
          #fff7ed !important;
        color: #9a3412 !important;
      }
      [data-view] {
        transition: none !important;
        contain: layout paint style;
      }
      .desktop-route-shell-grid,
      .desktop-canvas-toolbar {
        display: none !important;
      }
      #strategy-view.fuman-api-only-strategy-route > .strategy-header,
      #strategy-view.fuman-api-only-strategy-route .strategy-list,
      #strategy-view.fuman-api-only-strategy-route .strategy-toolbar,
      #strategy-view.fuman-api-only-strategy-route .strategy-metrics,
      #strategy-view.fuman-api-only-strategy-route .strategy-search {
        display: none !important;
      }
      #strategy-view.fuman-api-only-strategy-route .desktop-route-shell-head {
        display: none !important;
      }
      #strategy-view.fuman-api-only-strategy-route .strategy-terminal,
      #strategy-view.fuman-api-only-strategy-route .strategy-results,
      #strategy-view.fuman-api-only-strategy-route #strategy-table,
      #strategy-view.fuman-api-only-strategy-route .strategy-table {
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
        display: block !important;
        grid-template-columns: 1fr !important;
      }
      #strategy-view.fuman-api-only-strategy-route .desktop-route-shell.desktop-canvas-app {
        margin-top: 0 !important;
      }
      #strategy-view.fuman-api-only-strategy-route .desktop-route-canvas {
        margin-top: 0 !important;
      }
      .fuman-theme-toggle {
        position: fixed !important;
        top: calc(env(safe-area-inset-top, 0px) + 18px) !important;
        right: 42px !important;
        z-index: 100001 !important;
        width: 46px !important;
        height: 46px !important;
        display: grid !important;
        place-items: center !important;
        border: 1px solid rgba(148, 163, 184, 0.28) !important;
        border-radius: 12px !important;
        background: rgba(15, 23, 42, 0.9) !important;
        color: #facc15 !important;
        font-size: 24px !important;
        line-height: 1 !important;
        cursor: pointer !important;
        box-shadow: 0 16px 38px rgba(0, 0, 0, 0.28) !important;
        backdrop-filter: blur(10px);
      }
      .fuman-theme-toggle:hover {
        transform: translateY(-1px);
        border-color: rgba(249, 115, 22, 0.72) !important;
      }
      .fuman-display-switcher {
        position: fixed !important;
        top: calc(env(safe-area-inset-top, 0px) + 18px) !important;
        right: 42px !important;
        z-index: 100002 !important;
      }
      .fuman-display-switcher .fuman-theme-toggle {
        position: static !important;
        top: auto !important;
        right: auto !important;
      }
      .fuman-display-menu {
        position: absolute !important;
        top: 54px !important;
        right: 0 !important;
        display: grid !important;
        gap: 4px !important;
        min-width: 112px !important;
        padding: 6px !important;
        border: 1px solid rgba(148, 163, 184, 0.34) !important;
        border-radius: 10px !important;
        background: rgba(15, 23, 42, 0.94) !important;
        box-shadow: 0 16px 38px rgba(0, 0, 0, 0.32) !important;
        backdrop-filter: blur(12px);
      }
      .fuman-display-menu[hidden] {
        display: none !important;
      }
      .fuman-display-menu a {
        min-height: 34px !important;
        display: flex !important;
        align-items: center !important;
        padding: 0 10px !important;
        border-radius: 8px !important;
        color: #e5eefc !important;
        font-size: 13px !important;
        font-weight: 800 !important;
        line-height: 1 !important;
        text-decoration: none !important;
        white-space: nowrap !important;
      }
      .fuman-display-menu a:hover,
      .fuman-display-menu a:focus-visible {
        background: rgba(249, 115, 22, 0.2) !important;
        outline: none !important;
      }
      body.fuman-light-theme .fuman-display-menu {
        border-color: rgba(203, 213, 225, 0.95) !important;
        background: rgba(255, 255, 255, 0.96) !important;
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.14) !important;
      }
      body.fuman-light-theme .fuman-display-menu a {
        color: #172033 !important;
      }
      @media (max-width: 720px) {
        .fuman-display-switcher {
          top: calc(env(safe-area-inset-top, 0px) + 12px) !important;
          right: 12px !important;
        }
        .fuman-display-menu {
          top: 50px !important;
        }
      }
      .desktop-route-shell {
        border: 1px solid rgba(255, 112, 55, 0.35);
        border-radius: 18px;
        padding: 22px;
        min-height: 680px;
        background:
          linear-gradient(135deg, rgba(255, 112, 55, 0.12), rgba(30, 41, 59, 0.18)),
          rgba(10, 16, 28, 0.82);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03), 0 18px 44px rgba(0,0,0,0.22);
        contain: layout paint style;
      }
      .view-panel > .desktop-fixed-page-shell {
        margin: 16px 0 22px;
      }
      .fuman-fixed-shell-panel > .desktop-fixed-page-shell {
        content-visibility: auto;
        contain-intrinsic-size: 760px;
      }
      .fuman-fixed-shell-panel.fuman-fixed-shell-active > :not(header):not(.page-header):not(.desktop-fixed-page-shell):not(.terminal-page-header) {
        content-visibility: hidden !important;
        contain: layout paint style !important;
        contain-intrinsic-size: 1px !important;
        max-height: 1px !important;
        overflow: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      .view-panel[data-fuman-canvas-persistent="1"] .desktop-route-shell {
        transform: translateZ(0);
        will-change: transform;
      }
      .view-panel[hidden] .desktop-route-shell {
        content-visibility: hidden;
        contain-intrinsic-size: 760px;
      }
      .fuman-desktop-latency-panel {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 99999;
        width: min(360px, calc(100vw - 32px));
        padding: 12px;
        border: 1px solid rgba(255, 112, 55, 0.36);
        border-radius: 14px;
        background: rgba(8, 13, 24, 0.92);
        color: #e8eefc;
        box-shadow: 0 16px 44px rgba(0, 0, 0, 0.32);
        font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        backdrop-filter: blur(14px);
      }
      .fuman-desktop-latency-panel strong {
        display: block;
        margin-bottom: 8px;
        color: #ffb86b;
        font-size: 13px;
      }
      .fuman-desktop-latency-panel div {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        padding: 4px 0;
        border-top: 1px solid rgba(148, 163, 184, 0.14);
      }
      .fuman-desktop-latency-panel span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #cbd5e1;
      }
      .fuman-desktop-latency-panel b {
        color: #f8fafc;
        font-weight: 700;
        white-space: nowrap;
      }
      body.fuman-light-theme .fuman-desktop-latency-panel {
        background: rgba(255, 255, 255, 0.94);
        color: #1f2937;
        box-shadow: 0 16px 44px rgba(15, 23, 42, 0.14);
      }
      body.fuman-light-theme .fuman-desktop-latency-panel strong {
        color: #ea580c;
      }
      body.fuman-light-theme .fuman-desktop-latency-panel span {
        color: #475569;
      }
      body.fuman-light-theme .fuman-desktop-latency-panel b {
        color: #111827;
      }
      .desktop-route-shell-head {
        display: flex;
        align-items: center;
        gap: 16px;
        min-height: 64px;
      }
      .desktop-route-shell-head > span {
        display: grid;
        place-items: center;
        width: 48px;
        height: 48px;
        border: 1px solid rgba(255, 112, 55, 0.5);
        border-radius: 14px;
        color: #ff8a3d;
        font-size: 24px;
        background: rgba(255, 112, 55, 0.1);
      }
      .desktop-route-shell-head h2 {
        margin: 0 0 7px;
        color: #f8fafc;
        font-size: 22px;
      }
      .desktop-route-shell-head p {
        margin: 0;
        color: #9fb0cb;
      }
      .desktop-route-shell-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 20px;
      }
      .desktop-route-shell-grid article {
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 12px;
        padding: 14px;
        background: rgba(15, 23, 42, 0.72);
      }
      .desktop-route-shell-grid span {
        display: block;
        margin-bottom: 8px;
        color: #7f8da8;
        font-size: 13px;
      }
      .desktop-route-shell-grid strong {
        color: #e8eefc;
        font-size: 18px;
      }
      .desktop-route-canvas {
        display: block;
        width: 100%;
        height: 560px;
        min-height: 560px;
        margin-top: 20px;
        border-radius: 18px;
        background: #090f1c;
        box-shadow: inset 0 0 0 1px rgba(148,163,184,0.16);
        cursor: default;
        touch-action: none;
        user-select: none;
      }
      .desktop-strategy4-paged-shell .desktop-route-canvas {
        height: 1084px;
        min-height: 1084px;
        touch-action: auto;
      }
      .desktop-route-canvas:focus {
        outline: 2px solid rgba(255,112,55,0.72);
        outline-offset: 3px;
      }
      .desktop-canvas-empty-note {
        margin-top: 12px;
        border: 1px solid rgba(255,112,55,0.32);
        border-radius: 12px;
        padding: 12px 14px;
        color: #ffd0b5;
        background: rgba(255,112,55,0.10);
        font: 800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .desktop-canvas-empty-note[hidden] {
        display: none !important;
      }
      .strategy2-battle-shell {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-height: 720px;
        padding: 18px;
      }
      .strategy2-battle-header {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 18px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.16);
      }
      .strategy2-battle-kicker {
        display: block;
        margin-bottom: 6px;
        color: #ffb27b;
        font-size: 12px;
        font-weight: 900;
      }
      .strategy2-battle-header h2 {
        margin: 0;
        color: #f8fafc;
        font-size: 23px;
      }
      .strategy2-battle-header p {
        margin: 7px 0 0;
        color: #9fb0cb;
        font-size: 13px;
      }
      .strategy2-battle-stats {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 9px;
        flex-wrap: wrap;
      }
      .strategy2-health-banner {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        border: 1px solid rgba(251, 191, 36, 0.38);
        border-radius: 8px;
        background: rgba(41, 23, 5, 0.82);
        color: #fed7aa;
        padding: 10px 14px;
        font: 850 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .strategy2-health-banner.blocked {
        border-color: rgba(248, 113, 113, 0.46);
        background: rgba(42, 9, 14, 0.86);
        color: #fecdd3;
      }
      .strategy2-health-banner strong {
        color: #fde68a;
        white-space: nowrap;
      }
      .strategy2-health-banner.blocked strong {
        color: #fda4af;
      }
      .strategy2-health-banner span,
      .strategy2-health-banner small {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .strategy2-health-banner small {
        color: #aab6cc;
        font-weight: 800;
      }
      .strategy2-battle-refresh {
        min-height: 38px;
        border: 1px solid rgba(250, 204, 21, 0.42);
        border-radius: 10px;
        padding: 0 14px;
        color: #fef3c7;
        background: rgba(161, 98, 7, 0.18);
        font: 900 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        cursor: pointer;
      }
      .strategy2-battle-board {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-height: 0;
      }
      .strategy2-battle-panel {
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 12px;
        background: rgba(3, 8, 18, 0.68);
      }
      .strategy2-entry-panel {
        flex: 0 0 auto;
        max-height: none;
        border-color: rgba(250, 204, 21, 0.36);
        background:
          linear-gradient(90deg, rgba(250, 204, 21, 0.08), rgba(30, 64, 175, 0.12)),
          rgba(3, 8, 18, 0.72);
      }
      .strategy2-history-panel {
        flex: 1 1 auto;
        min-height: 390px;
        border-color: rgba(59, 130, 246, 0.30);
      }
      .strategy2-battle-panel header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 14px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.14);
        background: rgba(15, 23, 42, 0.58);
      }
      .strategy2-battle-panel header span {
        display: block;
        color: #fef08a;
        font: 900 15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .strategy2-battle-panel header strong {
        display: block;
        margin-top: 3px;
        color: #bfdbfe;
        font: 800 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .strategy2-battle-panel header small {
        color: #8fb3e8;
        font: 800 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        text-align: right;
      }
      .strategy2-battle-scroll {
        min-height: 0;
        overflow: auto;
      }
      .strategy2-entry-panel .strategy2-battle-scroll {
        max-height: 168px;
      }
      .strategy2-history-panel .strategy2-battle-scroll {
        min-height: 310px;
      }
      .strategy2-terminal-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font: 800 14px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .strategy2-terminal-table th {
        position: sticky;
        top: 0;
        z-index: 1;
        padding: 9px 10px;
        color: #e0e7ff;
        background: #07111f;
        text-align: left;
        border-bottom: 1px solid rgba(148, 163, 184, 0.22);
      }
      .strategy2-terminal-table td {
        padding: 8px 10px;
        color: #d7e2f7;
        border-bottom: 1px solid rgba(148, 163, 184, 0.08);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .strategy2-terminal-table tbody tr:nth-child(even) {
        background: rgba(15, 23, 42, 0.42);
      }
      .strategy2-tone-entry td,
      .strategy2-tone-entry .strategy2-col-symbol strong {
        color: #fef08a;
        font-weight: 950;
      }
      .strategy2-tone-prepare {
        background: rgba(23, 37, 84, 0.84) !important;
      }
      .strategy2-tone-prepare td,
      .strategy2-tone-prepare .strategy2-col-symbol strong {
        color: #bfdbfe;
      }
      .strategy2-tone-prepare .strategy2-col-note span {
        display: inline-flex;
        max-width: 100%;
        min-height: 22px;
        align-items: center;
        border: 1px solid rgba(59, 130, 246, 0.48);
        border-radius: 999px;
        padding: 0 9px;
        background: rgba(30, 64, 175, 0.9);
        color: #dbeafe;
      }
      .strategy2-col-rank { width: 8%; color: #fbbf24 !important; }
      .strategy2-col-time { width: 10%; }
      .strategy2-col-symbol { width: 16%; }
      .strategy2-col-price { width: 10%; text-align: right; }
      .strategy2-col-note { width: 36%; }
      .strategy2-col-score { width: 8%; text-align: right; }
      .strategy2-col-change { width: 12%; text-align: right; color: #ff6b90 !important; }
      .strategy2-col-symbol strong,
      .strategy2-col-symbol span {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .strategy2-col-symbol span {
        margin-top: 2px;
        color: #83a1d5;
        font-size: 12px;
      }
      .strategy2-entry-cards {
        display: grid;
        gap: 8px;
        padding: 8px;
        background: #05070b;
      }
      .strategy2-entry-card {
        display: grid;
        grid-template-columns: 150px 78px minmax(110px, 0.44fr) minmax(112px, 0.5fr) minmax(86px, 0.38fr) minmax(92px, 0.4fr);
        grid-template-rows: 58px minmax(44px, auto) minmax(44px, auto) minmax(44px, auto) minmax(44px, auto) minmax(44px, auto);
        min-height: 282px;
        border: 1px solid rgba(73, 83, 104, 0.78);
        border-radius: 8px;
        overflow: hidden;
        background: #05070b;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.035), 0 14px 34px rgba(0,0,0,0.24);
      }
      .strategy2-card-time {
        grid-column: 1;
        grid-row: 1 / 7;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 18px;
        border-right: 1px solid rgba(74, 83, 102, 0.80);
        background: linear-gradient(180deg, #10151d 0%, #0c1118 100%);
        padding: 22px 18px;
      }
      .strategy2-card-time small {
        color: #f6f8ff;
        font: 950 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .strategy2-card-time strong {
        color: #ffbd38;
        font: 950 24px/1.15 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .strategy2-card-time em {
        margin-top: auto;
        color: #8793aa;
        font: 850 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-style: normal;
      }
      .strategy2-card-code {
        grid-column: 2;
        grid-row: 1;
        align-self: center;
        justify-self: center;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 54px;
        min-height: 31px;
        border: 1px solid rgba(255, 190, 88, 0.32);
        border-radius: 2px;
        background: linear-gradient(180deg, #ffb548, #f06a24);
        color: #160b04;
        padding: 0 5px;
        font: 950 22px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .strategy2-card-name,
      .strategy2-card-metric,
      .strategy2-card-line {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 10px;
        border-bottom: 1px solid rgba(73, 83, 104, 0.50);
        background: #0b0f16;
        color: #e7edf8;
        padding: 0 14px;
        font: 850 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .strategy2-card-name {
        grid-column: 3;
        grid-row: 1;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        border-bottom-color: rgba(73, 83, 105, 0.56);
        background: #05070b;
      }
      .strategy2-card-name strong {
        color: #e9edf7;
        font-size: 18px;
        line-height: 1.1;
      }
      .strategy2-card-name span {
        color: #8fa4c7;
        font-size: 12px;
      }
      .strategy2-card-metric {
        justify-content: center;
        border-bottom-color: rgba(73, 83, 105, 0.56);
        background: #05070b;
      }
      .strategy2-card-metric.price { grid-column: 4; grid-row: 1; }
      .strategy2-card-metric.score { grid-column: 5; grid-row: 1; }
      .strategy2-card-metric.change { grid-column: 6; grid-row: 1; }
      .strategy2-card-metric small {
        color: #ffbd4f;
        font-weight: 950;
      }
      .strategy2-card-metric strong {
        color: #dbeafe;
        font: 950 15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .strategy2-card-metric.hot strong {
        color: #ffd166;
      }
      .strategy2-card-line b {
        flex: 0 0 74px;
        color: #ffbd4f;
        font-weight: 950;
      }
      .strategy2-card-line span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .strategy2-card-line.now { grid-column: 2 / 4; grid-row: 2; }
      .strategy2-card-line.key { grid-column: 4 / 7; grid-row: 2; }
      .strategy2-card-line.watch { grid-column: 2 / 7; grid-row: 3; }
      .strategy2-card-line.power { grid-column: 2 / 7; grid-row: 4; }
      .strategy2-card-line.risk {
        grid-column: 2 / 7;
        grid-row: 5;
        border-top: 1px solid rgba(255, 72, 92, 0.34);
        border-bottom: 1px solid rgba(255, 72, 92, 0.34);
        background: rgba(34, 10, 16, 0.62);
        color: #ffdbe1;
      }
      .strategy2-card-line.risk b {
        color: #ff6b86;
      }
      .strategy2-card-line.action {
        grid-column: 2 / 7;
        grid-row: 6;
        border-bottom: 0;
        background: rgba(8, 39, 24, 0.66);
        color: #cceedd;
      }
      .strategy2-card-line.action b {
        color: #43d986;
      }
      .strategy2-entry-panel .strategy2-battle-scroll {
        max-height: none;
      }
      .strategy2-top-table {
        display: block;
        border-collapse: separate;
        border-spacing: 0;
        padding: 8px;
        background: #05070b;
      }
      .strategy2-top-table thead {
        display: none;
      }
      .strategy2-top-table tbody {
        display: grid;
        gap: 8px;
      }
      .strategy2-top-table .strategy2-battle-row {
        display: grid;
        grid-template-columns: 150px 78px minmax(110px, 0.42fr) minmax(112px, 0.5fr) minmax(86px, 0.38fr) minmax(92px, 0.4fr);
        grid-template-rows: 58px minmax(56px, auto) minmax(56px, auto) minmax(56px, auto);
        min-height: 228px;
        border: 1px solid rgba(73, 83, 104, 0.78);
        border-radius: 8px;
        overflow: hidden;
        background: #05070b;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.035), 0 14px 34px rgba(0,0,0,0.24);
      }
      .strategy2-top-table .strategy2-battle-row td {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 10px;
        border: 0;
        border-bottom: 1px solid rgba(73, 83, 104, 0.50);
        background: #0b0f16;
        color: #e7edf8;
        padding: 0 14px;
        white-space: normal;
      }
      .strategy2-top-table .strategy2-battle-row td::before {
        flex: 0 0 74px;
        color: #ffbd4f;
        font: 950 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .strategy2-top-table .strategy2-col-rank {
        grid-column: 1;
        grid-row: 1 / 5;
        width: auto;
        flex-direction: column;
        align-items: flex-start;
        justify-content: flex-start;
        gap: 18px;
        border-right: 1px solid rgba(74, 83, 102, 0.80);
        border-bottom: 0;
        background: linear-gradient(180deg, #10151d 0%, #0c1118 100%);
        color: #ffbd38 !important;
        padding: 22px 18px;
        font: 950 24px/1.15 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .strategy2-top-table .strategy2-col-rank::before {
        flex: none;
        content: "偵測時間";
        color: #f6f8ff;
        font: 950 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .strategy2-top-table .strategy2-col-rank::after {
        width: 100%;
        margin-top: auto;
        color: #8793aa;
        content: "訊號觸發";
        font: 850 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .strategy2-top-table .strategy2-col-time {
        grid-column: 2;
        grid-row: 1;
        width: auto;
        justify-content: center;
        border-bottom-color: rgba(73, 83, 105, 0.56);
        background: #05070b;
        color: #160b04;
        font-size: 0;
      }
      .strategy2-top-table .strategy2-col-time::before {
        display: none;
      }
      .strategy2-top-table .strategy2-col-time {
        color: #160b04;
      }
      .strategy2-top-table .strategy2-col-time:not(:empty) {
        border: 1px solid rgba(255, 190, 88, 0.32);
        border-radius: 2px;
        align-self: center;
        justify-self: center;
        min-width: 54px;
        min-height: 31px;
        background: linear-gradient(180deg, #ffb548, #f06a24);
        font: 950 22px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .strategy2-top-table .strategy2-col-symbol {
        grid-column: 3;
        grid-row: 1;
        width: auto;
        border-bottom-color: rgba(73, 83, 105, 0.56);
        background: #05070b;
      }
      .strategy2-top-table .strategy2-col-symbol::before {
        display: none;
      }
      .strategy2-top-table .strategy2-col-symbol strong {
        color: #e9edf7;
        font: 950 18px/1.1 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .strategy2-top-table .strategy2-col-symbol span {
        color: #8fa4c7;
        font-size: 12px;
      }
      .strategy2-top-table .strategy2-col-price {
        grid-column: 4;
        grid-row: 1;
        width: auto;
        justify-content: center;
        border-bottom-color: rgba(73, 83, 105, 0.56);
        background: #05070b;
        color: #ffd166;
        font: 950 15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        text-align: left;
      }
      .strategy2-top-table .strategy2-col-price::before {
        flex: none;
        content: "現價";
        color: #ffbd4f;
      }
      .strategy2-top-table .strategy2-col-score {
        grid-column: 5;
        grid-row: 1;
        width: auto;
        justify-content: center;
        border-bottom-color: rgba(73, 83, 105, 0.56);
        background: #05070b;
        color: #dbeafe;
        text-align: left;
      }
      .strategy2-top-table .strategy2-col-score::before {
        flex: none;
        content: "分數";
      }
      .strategy2-top-table .strategy2-col-change {
        grid-column: 6;
        grid-row: 1;
        width: auto;
        justify-content: center;
        border-bottom-color: rgba(73, 83, 105, 0.56);
        background: #05070b;
        color: #ffd166 !important;
        text-align: left;
      }
      .strategy2-top-table .strategy2-col-change::before {
        flex: none;
        content: "漲幅";
      }
      .strategy2-top-table .strategy2-col-note {
        grid-column: 2 / 7;
        grid-row: 2;
        width: auto;
      }
      .strategy2-top-table .strategy2-col-note::before {
        content: "觀察";
      }
      .strategy2-top-table .strategy2-col-note span {
        display: inline;
        max-width: none;
        min-height: 0;
        border: 0;
        border-radius: 0;
        padding: 0;
        background: transparent;
        color: inherit;
      }
      .strategy2-top-table .strategy2-battle-row::after {
        grid-column: 2 / 7;
        grid-row: 4;
        display: flex;
        align-items: center;
        border-top: 1px solid rgba(47, 146, 92, 0.34);
        background: rgba(8, 39, 24, 0.66);
        color: #cceedd;
        content: "操作：假突破後重新站回日盤力回溫，若全天盤力偏弱，請用短打與入場K低點防守。";
        padding: 0 14px;
        font: 850 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .strategy2-top-table .strategy2-battle-row::before {
        grid-column: 2 / 7;
        grid-row: 3;
        display: flex;
        align-items: center;
        border-top: 1px solid rgba(255, 72, 92, 0.34);
        border-bottom: 1px solid rgba(255, 72, 92, 0.34);
        background: rgba(34, 10, 16, 0.62);
        color: #ffdbe1;
        content: "風控：風險線觀察，入場後跌破觸發價請降碼或退場。";
        padding: 0 14px;
        font: 850 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .strategy2-empty {
        display: grid;
        min-height: 124px;
        place-items: center;
        padding: 18px;
        color: #93a4bd;
        font: 900 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      @media (max-width: 860px) {
        .strategy2-battle-shell {
          min-height: 720px;
          padding: 14px;
        }
        .strategy2-battle-header,
        .strategy2-battle-panel header {
          align-items: flex-start;
          flex-direction: column;
        }
        .strategy2-battle-stats {
          justify-content: flex-start;
        }
        .strategy2-terminal-table {
          min-width: 760px;
        }
      }
      .desktop-canvas-pagination {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 12px;
      }
      .desktop-canvas-pagination[hidden] {
        display: none !important;
      }
      .desktop-canvas-pagination span {
        color: #9fb0cb;
        font: 800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        margin-right: 4px;
      }
      .desktop-canvas-pagination button {
        min-width: 36px;
        min-height: 34px;
        border: 1px solid rgba(148,163,184,0.2);
        border-radius: 10px;
        padding: 0 11px;
        color: #cbd5e1;
        background: rgba(15,23,42,0.68);
        font: 900 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        cursor: pointer;
      }
      .desktop-canvas-pagination button.active {
        border-color: rgba(255,112,55,0.72);
        color: #fff7ed;
        background: rgba(255,112,55,0.22);
      }
      .desktop-canvas-pagination button:disabled {
        opacity: 0.42;
        cursor: default;
      }
      .desktop-canvas-toolbar {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) auto auto auto;
        align-items: end;
        gap: 12px;
        margin-top: 18px;
      }
      .desktop-strategy4-zone-filters,
      .desktop-strategy4-signal-filters {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin: 12px 0 12px;
      }
      .desktop-strategy4-zone-filters {
        margin-bottom: 4px;
      }
      .desktop-strategy4-signal-filters {
        margin-top: 6px;
      }
      .desktop-strategy4-zone-filters[hidden],
      .desktop-strategy4-signal-filters[hidden] {
        display: none !important;
      }
      .desktop-strategy4-zone-filters button,
      .desktop-strategy4-signal-filters button {
        min-height: 34px;
        border: 1px solid rgba(148,163,184,0.18);
        border-radius: 10px;
        padding: 0 11px;
        color: #b8c5da;
        background: rgba(15,23,42,0.62);
        font: 800 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        cursor: pointer;
      }
      .desktop-strategy4-zone-filters button.active,
      .desktop-strategy4-signal-filters button.active {
        border-color: rgba(255,112,55,0.68);
        color: #fff3e9;
        background: rgba(255,112,55,0.18);
      }
      .desktop-strategy4-zone-filters b,
      .desktop-strategy4-signal-filters b {
        margin-left: 5px;
        color: #ffb27b;
      }
      .desktop-canvas-search-wrap {
        display: grid;
        gap: 7px;
        color: #8796b2;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0;
      }
      .desktop-canvas-search {
        width: 100%;
        min-height: 42px;
        border: 1px solid rgba(148,163,184,0.22);
        border-radius: 12px;
        padding: 0 14px;
        color: #f8fafc;
        background: rgba(8,13,24,0.88);
        font: 800 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        outline: none;
      }
      .desktop-canvas-search:focus {
        border-color: rgba(255,112,55,0.72);
        box-shadow: 0 0 0 3px rgba(255,112,55,0.12);
      }
      .desktop-canvas-refresh {
        min-height: 42px;
        border: 1px solid rgba(255,112,55,0.48);
        border-radius: 12px;
        padding: 0 16px;
        color: #ffd0b5;
        background: rgba(255,112,55,0.12);
        font: 900 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        cursor: pointer;
      }
      .desktop-canvas-count,
      .desktop-canvas-status {
        min-height: 42px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(148,163,184,0.18);
        border-radius: 12px;
        padding: 0 14px;
        color: #b8c5da;
        background: rgba(15,23,42,0.68);
        white-space: nowrap;
        font: 800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .desktop-canvas-detail {
        position: sticky;
        bottom: 14px;
        z-index: 3;
        margin-top: -8px;
      }
      .desktop-canvas-detail[hidden] {
        display: none !important;
      }
      .desktop-canvas-detail-panel {
        position: relative;
        border: 1px solid rgba(255,112,55,0.58);
        border-radius: 16px;
        padding: 18px;
        background:
          linear-gradient(135deg, rgba(255,112,55,0.18), rgba(15,23,42,0.96)),
          rgba(9,15,28,0.96);
        box-shadow: 0 22px 54px rgba(0,0,0,0.36);
      }
      .desktop-canvas-detail-close {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 32px;
        height: 32px;
        border: 1px solid rgba(148,163,184,0.24);
        border-radius: 10px;
        color: #f8fafc;
        background: rgba(15,23,42,0.82);
        cursor: pointer;
      }
      .desktop-canvas-detail-kicker {
        color: #ffb27b;
        font-size: 12px;
        font-weight: 900;
      }
      .desktop-canvas-detail-panel h3 {
        margin: 8px 42px 8px 0;
        color: #f8fafc;
        font-size: 20px;
      }
      .desktop-canvas-detail-panel p {
        margin: 0;
        color: #b8c5da;
        line-height: 1.65;
      }
      .desktop-canvas-detail-substrategy {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        margin: 0 0 10px;
        border: 1px solid rgba(255,112,55,0.42);
        border-radius: 10px;
        padding: 0 10px;
        color: #ffb27b;
        background: rgba(255,112,55,0.12);
        font-weight: 900;
      }
      .desktop-triangle-chart {
        margin-top: 14px;
        border: 1px solid rgba(148,163,184,0.18);
        border-radius: 14px;
        padding: 12px;
        background: rgba(15,23,42,0.58);
      }
      .desktop-triangle-chart-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }
      .desktop-triangle-chart-head strong {
        color: #f8fafc;
        font-size: 14px;
      }
      .desktop-triangle-chart-head span {
        color: #ffb27b;
        font-size: 12px;
        font-weight: 900;
      }
      .desktop-triangle-chart svg {
        display: block;
        width: 100%;
        height: 176px;
        border-radius: 10px;
        background:
          linear-gradient(180deg, rgba(15,23,42,0.34), rgba(9,15,28,0.78)),
          repeating-linear-gradient(0deg, rgba(148,163,184,0.10) 0 1px, transparent 1px 34px);
      }
      .desktop-triangle-chart .axis {
        stroke: rgba(148,163,184,0.22);
        stroke-width: 1;
      }
      .desktop-triangle-chart .grid-line {
        stroke: rgba(148,163,184,0.11);
        stroke-width: 1;
      }
      .desktop-triangle-chart .candle-up {
        fill: #ef4444;
        stroke: #fecaca;
        stroke-width: 1;
      }
      .desktop-triangle-chart .candle-down {
        fill: #22c55e;
        stroke: #bbf7d0;
        stroke-width: 1;
      }
      .desktop-triangle-chart .wick-up {
        stroke: #fecaca;
        stroke-width: 1.5;
        stroke-linecap: round;
      }
      .desktop-triangle-chart .wick-down {
        stroke: #bbf7d0;
        stroke-width: 1.5;
        stroke-linecap: round;
      }
      .desktop-triangle-chart .volume-up {
        fill: rgba(239,68,68,0.42);
      }
      .desktop-triangle-chart .volume-down {
        fill: rgba(34,197,94,0.36);
      }
      .desktop-triangle-chart .resistance {
        fill: none;
        stroke: #fb7185;
        stroke-width: 4;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .desktop-triangle-chart .support {
        fill: none;
        stroke: #22c55e;
        stroke-width: 4;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .desktop-triangle-chart .breakout {
        fill: #f97316;
        stroke: #fed7aa;
        stroke-width: 2;
      }
      .desktop-triangle-chart .label {
        fill: #cbd5e1;
        font: 800 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .desktop-triangle-chart .support-label {
        fill: #86efac;
      }
      .desktop-triangle-chart .breakout-label {
        fill: #fdba74;
      }
      .desktop-canvas-signal-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .desktop-canvas-signal-chip {
        max-width: 100%;
        border: 1px solid rgba(148,163,184,0.18);
        border-radius: 10px;
        padding: 8px 10px;
        color: #e8eefc;
        background: rgba(15,23,42,0.62);
        font-weight: 800;
      }
      .desktop-canvas-signal-chip small {
        display: block;
        margin-top: 4px;
        color: #9fb0cb;
        font-weight: 700;
        line-height: 1.35;
      }
      .desktop-canvas-detail-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-top: 14px;
      }
      .desktop-canvas-detail-grid span {
        border: 1px solid rgba(148,163,184,0.17);
        border-radius: 12px;
        padding: 10px;
        color: #8796b2;
        background: rgba(15,23,42,0.65);
      }
      .desktop-canvas-detail-grid strong {
        display: block;
        margin-top: 5px;
        color: #f8fafc;
      }
      .desktop-route-shell-lines {
        display: grid;
        gap: 10px;
        margin-top: 22px;
      }
      .desktop-route-shell-lines i {
        display: block;
        height: 18px;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(148,163,184,0.16), rgba(255,112,55,0.18), rgba(148,163,184,0.12));
      }
      .desktop-route-shell-lines i:nth-child(2) { width: 82%; }
      .desktop-route-shell-lines i:nth-child(3) { width: 64%; }
      .desktop-route-shell-lines i:nth-child(4) { width: 74%; }
      @media (min-width: 901px) {
        body.fuman-light-theme .fuman-shell-pending {
          border-color: rgba(249, 115, 22, 0.86) !important;
          background: linear-gradient(135deg, rgba(255,247,237,0.96), rgba(255,255,255,0.92)) !important;
          box-shadow: inset 4px 0 0 #f97316, 0 10px 24px rgba(249, 115, 22, 0.12) !important;
        }
        body.fuman-light-theme .desktop-route-shell {
          border-color: rgba(249, 115, 22, 0.24);
          background:
            linear-gradient(135deg, rgba(255, 247, 237, 0.88), rgba(235, 244, 255, 0.7) 48%, rgba(255,255,255,0.96)),
            #ffffff;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.95), 0 18px 44px rgba(30, 41, 59, 0.08);
        }
        body.fuman-light-theme .desktop-route-shell-head > span {
          border-color: rgba(249, 115, 22, 0.38);
          color: #f97316;
          background: rgba(255, 247, 237, 0.92);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.9);
        }
        body.fuman-light-theme .desktop-route-shell-head h2 {
          color: #172033;
        }
        body.fuman-light-theme .desktop-route-shell-head p,
        body.fuman-light-theme .desktop-canvas-search-wrap {
          color: #64748b;
        }
        body.fuman-light-theme .desktop-strategy4-zone-filters button,
        body.fuman-light-theme .desktop-strategy4-signal-filters button {
          border-color: #cbd8e6;
          color: #334155;
          background: rgba(255,255,255,0.9);
        }
        body.fuman-light-theme .desktop-strategy4-zone-filters button.active,
        body.fuman-light-theme .desktop-strategy4-signal-filters button.active {
          border-color: rgba(249,115,22,0.5);
          color: #c2410c;
          background: #fff7ed;
        }
        body.fuman-light-theme .desktop-strategy4-zone-filters b,
        body.fuman-light-theme .desktop-strategy4-signal-filters b {
          color: #ea580c;
        }
        body.fuman-light-theme .desktop-route-shell-grid article {
          border-color: #d8e3ef;
          background: rgba(255,255,255,0.78);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.88);
        }
        body.fuman-light-theme .desktop-route-shell-grid span {
          color: #64748b;
        }
        body.fuman-light-theme .desktop-route-shell-grid strong {
          color: #25334a;
        }
        body.fuman-light-theme .desktop-route-canvas {
          background: #f6f9fc;
          box-shadow: inset 0 0 0 1px rgba(203, 213, 225, 0.88), 0 14px 34px rgba(30, 41, 59, 0.08);
        }
        body.fuman-light-theme .desktop-canvas-search {
          border-color: #cbd8e6;
          color: #172033;
          background: rgba(255,255,255,0.96);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.98);
        }
        body.fuman-light-theme .desktop-canvas-search::placeholder {
          color: #8a9ab0;
        }
        body.fuman-light-theme .desktop-canvas-refresh {
          border-color: rgba(249, 115, 22, 0.44);
          color: #c2410c;
          background: rgba(255,247,237,0.95);
        }
        body.fuman-light-theme .desktop-canvas-count,
        body.fuman-light-theme .desktop-canvas-status {
          border-color: #cbd8e6;
          color: #334155;
          background: rgba(255,255,255,0.9);
        }
        body.fuman-light-theme .desktop-canvas-detail-panel {
          border-color: rgba(249, 115, 22, 0.38);
          background:
            linear-gradient(135deg, rgba(255,247,237,0.98), rgba(255,255,255,0.96) 58%, rgba(235,244,255,0.9)),
            #ffffff;
          box-shadow: 0 22px 54px rgba(30, 41, 59, 0.14);
        }
        body.fuman-light-theme .desktop-canvas-detail-close {
          border-color: #d8e3ef;
          color: #334155;
          background: #ffffff;
        }
        body.fuman-light-theme .desktop-canvas-detail-kicker {
          color: #ea580c;
        }
        body.fuman-light-theme .desktop-canvas-detail-panel h3 {
          color: #172033;
        }
        body.fuman-light-theme .desktop-canvas-detail-panel p {
          color: #475569;
        }
        body.fuman-light-theme .desktop-canvas-detail-substrategy {
          border-color: rgba(249, 115, 22, 0.38);
          color: #c2410c;
          background: #fff7ed;
        }
        body.fuman-light-theme .desktop-canvas-signal-chip {
          border-color: #d8e3ef;
          color: #172033;
          background: rgba(248,251,255,0.92);
        }
        body.fuman-light-theme .desktop-canvas-signal-chip small {
          color: #64748b;
        }
        body.fuman-light-theme .desktop-canvas-detail-grid span {
          border-color: #d8e3ef;
          color: #64748b;
          background: rgba(248,251,255,0.92);
        }
        body.fuman-light-theme .desktop-canvas-detail-grid strong {
          color: #172033;
        }
        body.fuman-light-theme .desktop-route-shell-lines i {
          background: linear-gradient(90deg, rgba(100,116,139,0.12), rgba(249,115,22,0.16), rgba(37,99,235,0.10));
        }
        html body.fuman-light-theme.public-terminal,
        html body.fuman-light-theme.public-terminal .app-shell,
        html body.fuman-light-theme.public-terminal .dashboard {
          background:
            linear-gradient(rgba(30, 41, 59, 0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(30, 41, 59, 0.028) 1px, transparent 1px),
            linear-gradient(135deg, #f8fbff 0%, #eef4fb 48%, #f7fbff 100%) !important;
          background-size: 28px 28px, 28px 28px, auto !important;
          color: #172033 !important;
        }
        html body.fuman-light-theme.public-terminal .sidebar {
          background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,251,255,0.96)) !important;
          border-right: 1px solid #d8e3ef !important;
          color: #172033 !important;
          box-shadow: 16px 0 42px rgba(30, 41, 59, 0.07) !important;
        }
        html body.fuman-light-theme.public-terminal .brand {
          border-bottom-color: #e2eaf5 !important;
          background: linear-gradient(135deg, rgba(255,247,237,0.58), rgba(255,255,255,0)) !important;
        }
        html body.fuman-light-theme.public-terminal .brand small,
        html body.fuman-light-theme.public-terminal .nav-label,
        html body.fuman-light-theme.public-terminal .chip-menu h2,
        html body.fuman-light-theme.public-terminal .sidebar-foot,
        html body.fuman-light-theme.public-terminal .refresh-line,
        html body.fuman-light-theme.public-terminal .terminal-message {
          color: #64748b !important;
        }
        html body.fuman-light-theme.public-terminal .nav-item,
        html body.fuman-light-theme.public-terminal .strategy-nav,
        html body.fuman-light-theme.public-terminal .chip-menu-link {
          border: 1px solid #dbe5f0 !important;
          border-radius: 9px !important;
          background: rgba(255,255,255,0.76) !important;
          color: #334155 !important;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.92), 0 8px 18px rgba(30, 41, 59, 0.045) !important;
        }
        html body.fuman-light-theme.public-terminal .nav-item:hover,
        html body.fuman-light-theme.public-terminal .strategy-nav:hover,
        html body.fuman-light-theme.public-terminal .chip-menu-link:hover {
          background: #ffffff !important;
          border-color: #bfdbfe !important;
          color: #1d4ed8 !important;
        }
        html body.fuman-light-theme.public-terminal .nav-item.active,
        html body.fuman-light-theme.public-terminal .strategy-nav.active,
        html body.fuman-light-theme.public-terminal .chip-menu-link.active {
          background: linear-gradient(135deg, #fff7ed 0%, #ffffff 68%, #eef6ff 100%) !important;
          border-color: rgba(249, 115, 22, 0.5) !important;
          color: #c2410c !important;
          box-shadow: inset 4px 0 0 #f97316, 0 12px 26px rgba(249, 115, 22, 0.12) !important;
        }
        html body.fuman-light-theme.public-terminal .sidebar .nav-icon,
        html body.fuman-light-theme.public-terminal .sidebar .strategy-nav span,
        html body.fuman-light-theme.public-terminal .sidebar .chip-menu-link span {
          color: #f97316 !important;
          -webkit-text-fill-color: #f97316 !important;
          text-shadow: none !important;
          filter: none !important;
        }
        html body.fuman-light-theme.public-terminal .view-panel,
        html body.fuman-light-theme.public-terminal #market-view,
        html body.fuman-light-theme.public-terminal #strategy-view,
        html body.fuman-light-theme.public-terminal #chip-trade-view,
        html body.fuman-light-theme.public-terminal #cb-detect-view,
        html body.fuman-light-theme.public-terminal #warrant-flow-view,
        html body.fuman-light-theme.public-terminal #watchlist-view,
        html body.fuman-light-theme.public-terminal .strategy-terminal,
        html body.fuman-light-theme.public-terminal .strategy-results {
          background: transparent !important;
          color: #172033 !important;
        }
        html body.fuman-light-theme.public-terminal .page-header,
        html body.fuman-light-theme.public-terminal .strategy-header,
        html body.fuman-light-theme.public-terminal .radar-topbar,
        html body.fuman-light-theme.public-terminal .intraday-topbar,
        html body.fuman-light-theme.public-terminal .swing-topbar,
        html body.fuman-light-theme.public-terminal .strategy5-page-heading,
        html body.fuman-light-theme.public-terminal #chip-trade-view .chip-page-header,
        html body.fuman-light-theme.public-terminal #warrant-flow-view .page-header {
          width: auto !important;
          max-width: none !important;
          height: auto !important;
          min-height: 96px !important;
          max-height: none !important;
          border: 1px solid #d8e3ef !important;
          border-left: 4px solid #f97316 !important;
          border-top: 1px solid #d8e3ef !important;
          border-radius: 10px !important;
          background: linear-gradient(135deg, rgba(255,255,255,0.96), rgba(255,247,237,0.78) 52%, rgba(239,246,255,0.88)) !important;
          color: #172033 !important;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.92), 0 14px 32px rgba(30, 41, 59, 0.075) !important;
        }
        html body.fuman-light-theme.public-terminal .metric-card,
        html body.fuman-light-theme.public-terminal .strength-panel,
        html body.fuman-light-theme.public-terminal .terminal-card,
        html body.fuman-light-theme.public-terminal .radar-ai-box,
        html body.fuman-light-theme.public-terminal .radar-signal-card,
        html body.fuman-light-theme.public-terminal .swing-dashboard,
        html body.fuman-light-theme.public-terminal .intraday-dashboard,
        html body.fuman-light-theme.public-terminal .strategy5-dashboard,
        html body.fuman-light-theme.public-terminal .chip-tool,
        html body.fuman-light-theme.public-terminal .chip-table-wrap,
        html body.fuman-light-theme.public-terminal .swing-panel,
        html body.fuman-light-theme.public-terminal .warrant-flow-panel,
        html body.fuman-light-theme.public-terminal .watchlist-card,
        html body.fuman-light-theme.public-terminal .watch-analysis-panel,
        html body.fuman-light-theme.public-terminal .ta-dashboard {
          border-color: #d8e3ef !important;
          background: rgba(255,255,255,0.88) !important;
          color: #172033 !important;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.92), 0 12px 28px rgba(30, 41, 59, 0.07) !important;
        }
        html body.fuman-light-theme.public-terminal input,
        html body.fuman-light-theme.public-terminal select,
        html body.fuman-light-theme.public-terminal textarea {
          border-color: #cbd8e6 !important;
          background: rgba(255,255,255,0.96) !important;
          color: #172033 !important;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.96) !important;
        }
        html body.fuman-light-theme.public-terminal button:not(.fuman-theme-toggle),
        html body.fuman-light-theme.public-terminal .chip-tabs button,
        html body.fuman-light-theme.public-terminal .chip-pill,
        html body.fuman-light-theme.public-terminal .terminal-pagination button,
        html body.fuman-light-theme.public-terminal .swing-tabs button {
          border-color: #cbd8e6 !important;
          background: rgba(255,255,255,0.86) !important;
          color: #334155 !important;
          box-shadow: none !important;
        }
        html body.fuman-light-theme.public-terminal table,
        html body.fuman-light-theme.public-terminal .chip-table,
        html body.fuman-light-theme.public-terminal .swing-table,
        html body.fuman-light-theme.public-terminal .intraday-table {
          border-color: #d8e3ef !important;
          background: #ffffff !important;
          color: #172033 !important;
        }
        html body.fuman-light-theme.public-terminal table thead,
        html body.fuman-light-theme.public-terminal table th,
        html body.fuman-light-theme.public-terminal .stock-head {
          background: #eaf2fb !important;
          color: #475569 !important;
          border-color: #d8e3ef !important;
        }

        html body.fuman-light-theme.public-terminal .app-shell,
        html body.fuman-light-theme.public-terminal .dashboard,
        html body.fuman-light-theme.public-terminal main {
          background:
            linear-gradient(rgba(15, 23, 42, 0.028) 1px, transparent 1px),
            linear-gradient(90deg, rgba(15, 23, 42, 0.022) 1px, transparent 1px),
            #f6f8fb !important;
          background-size: 30px 30px, 30px 30px, auto !important;
          color: #0f172a !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-route-shell {
          border-color: #d9e2ee !important;
          background: #ffffff !important;
          color: #0f172a !important;
          box-shadow: 0 14px 34px rgba(15, 23, 42, 0.07) !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-route-shell-head > span {
          border-color: rgba(249, 115, 22, 0.42) !important;
          background: #fff7ed !important;
          color: #f97316 !important;
          box-shadow: none !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-route-shell-head h2,
        html body.fuman-light-theme.public-terminal .desktop-canvas-detail-panel h3 {
          color: #0f172a !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-route-shell-head p,
        html body.fuman-light-theme.public-terminal .desktop-canvas-search-wrap,
        html body.fuman-light-theme.public-terminal .desktop-canvas-detail-panel p {
          color: #64748b !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-strategy4-zone-filters button,
        html body.fuman-light-theme.public-terminal .desktop-strategy4-signal-filters button {
          border-color: #cbd8e6 !important;
          background: #ffffff !important;
          color: #334155 !important;
          box-shadow: none !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-strategy4-zone-filters button.active,
        html body.fuman-light-theme.public-terminal .desktop-strategy4-signal-filters button.active {
          border-color: rgba(249, 115, 22, 0.55) !important;
          background: #fff7ed !important;
          color: #c2410c !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-canvas-detail-substrategy {
          border-color: rgba(249, 115, 22, 0.42) !important;
          background: #fff7ed !important;
          color: #c2410c !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-canvas-signal-chip {
          border-color: #d9e2ee !important;
          background: #f8fafc !important;
          color: #0f172a !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-canvas-signal-chip small {
          color: #64748b !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-route-shell-grid article,
        html body.fuman-light-theme.public-terminal .desktop-canvas-count,
        html body.fuman-light-theme.public-terminal .desktop-canvas-status,
        html body.fuman-light-theme.public-terminal .desktop-canvas-detail-grid span {
          border-color: #d9e2ee !important;
          background: #f8fafc !important;
          color: #334155 !important;
          box-shadow: none !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-route-shell-grid span,
        html body.fuman-light-theme.public-terminal .desktop-canvas-detail-grid span {
          color: #64748b !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-route-shell-grid strong,
        html body.fuman-light-theme.public-terminal .desktop-canvas-detail-grid strong {
          color: #0f172a !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-route-canvas {
          background: #f8fafc !important;
          box-shadow: inset 0 0 0 1px #d9e2ee, 0 10px 24px rgba(15, 23, 42, 0.055) !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-canvas-search {
          border-color: #cbd8e6 !important;
          background: #ffffff !important;
          color: #0f172a !important;
          box-shadow: none !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-canvas-search::placeholder {
          color: #94a3b8 !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-canvas-refresh {
          border-color: #fb923c !important;
          background: #fff7ed !important;
          color: #9a3412 !important;
          box-shadow: none !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-canvas-detail-panel {
          border-color: #fb923c !important;
          background: #ffffff !important;
          color: #0f172a !important;
          box-shadow: 0 18px 44px rgba(15, 23, 42, 0.12) !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-canvas-detail-close {
          border-color: #cbd8e6 !important;
          background: #ffffff !important;
          color: #334155 !important;
        }
        html body.fuman-light-theme.public-terminal .desktop-route-shell-lines i {
          background: linear-gradient(90deg, rgba(100,116,139,0.12), rgba(249,115,22,0.16), rgba(37,99,235,0.10)) !important;
        }
        html body.fuman-light-theme.public-terminal .fuman-theme-toggle {
          border-color: #cbd8e6 !important;
          background: #ffffff !important;
          color: #f59e0b !important;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12) !important;
        }
        #market-view .market-mode-tabs {
          display: inline-flex !important;
          align-items: center !important;
          gap: 8px !important;
          margin: 10px 0 18px !important;
          padding: 6px !important;
          border: 1px solid rgba(234, 179, 8, 0.36) !important;
          border-radius: 10px !important;
          background: rgba(15, 23, 42, 0.72) !important;
        }
        #market-view .market-mode-tabs button {
          min-height: 36px !important;
          padding: 0 14px !important;
          border: 1px solid transparent !important;
          border-radius: 8px !important;
          background: transparent !important;
          color: #9fb3d9 !important;
          font-size: 13px !important;
          font-weight: 900 !important;
          cursor: pointer !important;
        }
        #market-view .market-mode-tabs button.active {
          border-color: rgba(249, 115, 22, 0.72) !important;
          background: rgba(249, 115, 22, 0.16) !important;
          color: #ffb86b !important;
        }
        #market-view.market-ai-mode > :not(.page-header):not(.market-mode-tabs):not(.market-ai-panel) {
          display: none !important;
        }
        #market-view.fuman-market-overview-shell > .desktop-route-shell.desktop-canvas-app {
          display: none !important;
        }
        #market-view.fuman-market-overview-shell > .page-header .eyebrow,
        #market-view.fuman-market-overview-shell > .page-header .refresh-line,
        #market-view.fuman-market-overview-shell > .page-header .header-time {
          display: block !important;
        }
        #market-view.fuman-market-overview-shell > .metric-grid {
          display: grid !important;
          grid-template-columns: repeat(3, minmax(220px, 1fr)) !important;
          gap: 12px !important;
          margin: 12px 0 16px !important;
        }
        #market-view.fuman-market-overview-shell > .sector-section {
          display: block !important;
        }
        #market-view.market-overview-mode > .market-ai-panel {
          display: none !important;
        }
        #market-view.market-overview-mode > .ticker-strip,
        #market-view.market-overview-mode > .strength-panel {
          display: none !important;
        }
        #market-view.market-overview-mode > .metric-grid .metric-card:nth-child(n + 4) {
          display: none !important;
        }
        #market-view.market-overview-mode.market-index-pending > .metric-grid {
          display: grid !important;
        }
        #market-view.market-overview-mode > .terminal-band,
        #market-view.market-overview-mode > .watch-section {
          display: none !important;
        }
        #market-view .metric-card.market-card-up em,
        #market-view .ticker-strip .ticker-up b {
          color: #fb7185 !important;
        }
        #market-view .metric-card.market-card-down em,
        #market-view .ticker-strip .ticker-down b {
          color: #2dd4bf !important;
        }
        #market-view .ticker-strip {
          overflow: hidden !important;
          white-space: nowrap !important;
          gap: 18px !important;
        }
        #market-view .ticker-strip span {
          display: inline-flex !important;
          align-items: center !important;
          gap: 6px !important;
          margin-right: 16px !important;
          color: #aebfe0 !important;
          font-size: 12px !important;
        }
        #market-view .ticker-strip small {
          color: #7f8da8 !important;
        }
        #market-view .sector-card {
          cursor: pointer !important;
          transition: transform 120ms ease, border-color 120ms ease, background 120ms ease !important;
        }
        #market-view .sector-card:hover,
        #market-view .sector-card:focus-visible {
          transform: translateY(-2px) !important;
          border-color: rgba(249, 115, 22, 0.78) !important;
          outline: none !important;
        }
        #market-view .market-ai-panel {
          display: block;
          border: 1px solid rgba(234, 179, 8, 0.26);
          border-radius: 8px;
          background:
            radial-gradient(circle at 20% 0%, rgba(234, 179, 8, 0.12), transparent 34%),
            rgba(9, 15, 25, 0.82);
          padding: 18px;
        }
        #market-view .market-ai-sort-note {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 14px;
          padding: 12px 14px;
          border: 1px solid rgba(234, 179, 8, 0.28);
          border-radius: 8px;
          background: rgba(234, 179, 8, 0.08);
          color: #f8fafc;
        }
        #market-view .market-ai-sort-note span {
          color: #9fb3d9;
          font-size: 12px;
        }
        #market-view .market-ai-panel.market-ai-visual-dashboard {
          display: grid !important;
          gap: 14px !important;
          border: 0 !important;
          border-radius: 0 !important;
          background: transparent !important;
          padding: 0 !important;
          min-height: 980px !important;
          overflow-anchor: none !important;
          contain: layout paint style !important;
        }
        #market-view.market-overview-mode > .market-ai-panel,
        #market-view.market-overview-mode > [data-market-api-ai],
        #market-view [data-market-api-ai][hidden] {
          display: none !important;
          visibility: hidden !important;
        }
        #market-view .market-ai-hero-board {
          display: grid;
          grid-template-columns: minmax(360px, 1fr) minmax(420px, 0.42fr);
          gap: 14px;
          align-items: stretch;
          min-height: 142px;
          border: 1px solid rgba(16, 185, 129, 0.52);
          border-radius: 8px;
          background:
            radial-gradient(circle at 20% 20%, rgba(16, 185, 129, 0.22), transparent 34%),
            linear-gradient(135deg, rgba(6, 78, 59, 0.74), rgba(8, 15, 26, 0.94));
          padding: 18px;
          overflow-anchor: none;
          contain: layout paint;
        }
        #market-view .market-ai-hero-board.market-ai-bullish {
          border-color: rgba(251, 113, 133, 0.58);
          background:
            radial-gradient(circle at 20% 20%, rgba(251, 113, 133, 0.22), transparent 34%),
            linear-gradient(135deg, rgba(127, 29, 29, 0.72), rgba(8, 15, 26, 0.94));
        }
        #market-view .market-ai-hero-board.market-ai-bearish {
          border-color: rgba(45, 212, 191, 0.56);
          background:
            radial-gradient(circle at 20% 20%, rgba(45, 212, 191, 0.22), transparent 34%),
            linear-gradient(135deg, rgba(6, 78, 59, 0.74), rgba(8, 15, 26, 0.94));
        }
        #market-view .market-ai-hero-copy {
          align-self: center;
          min-width: 0;
        }
        #market-view .market-ai-hero-copy small,
        #market-view .market-ai-hero-action small {
          display: block;
          color: #8fb9ac;
          font-size: 12px;
          font-weight: 800;
        }
        #market-view .market-ai-hero-copy strong {
          display: block;
          margin: 8px 0;
          color: #4ade80;
          font-size: clamp(32px, 4vw, 48px);
          line-height: 1;
          letter-spacing: 0;
        }
        #market-view .market-ai-hero-board.market-ai-bullish .market-ai-hero-copy strong,
        #market-view .market-ai-summary .market-ai-card.market-ai-bullish strong {
          color: #fb7185 !important;
        }
        #market-view .market-ai-hero-board.market-ai-bearish .market-ai-hero-copy strong,
        #market-view .market-ai-summary .market-ai-card.market-ai-bearish strong {
          color: #2dd4bf !important;
        }
        #market-view .market-ai-hero-copy p {
          max-width: 860px;
          margin: 0;
          color: #cfddd8;
          font-size: 14px;
          line-height: 1.7;
        }
        #market-view .market-ai-hero-metrics {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
        }
        #market-view .market-ai-hero-metrics span,
        #market-view .market-ai-hero-action {
          border: 1px solid rgba(234, 179, 8, 0.26);
          border-radius: 8px;
          background: rgba(8, 15, 26, 0.82);
          padding: 12px;
        }
        #market-view .market-ai-hero-metrics b {
          display: block;
          margin-top: 4px;
          color: #facc15;
          font-size: 19px;
          line-height: 1.1;
        }
        #market-view .market-ai-hero-action {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: max-content 1fr;
          align-items: center;
          gap: 8px 12px;
          min-height: 44px;
        }
        #market-view .market-ai-hero-action b {
          color: #f8fafc;
          font-size: 14px;
        }
        #market-view .market-ai-hero-action span {
          grid-column: 1 / -1;
          color: #aebfe0;
          font-size: 12px;
          line-height: 1.55;
        }
        #market-view .market-ai-summary {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin: 0;
        }
        #market-view .market-ai-summary .market-ai-card,
        #market-view .market-ai-decision-grid article,
        #market-view .market-ai-evidence,
        #market-view .market-ai-points,
        #market-view .market-ai-risk-panel,
        #market-view .market-ai-current-rule,
        #market-view .market-ai-hot-section {
          border: 1px solid rgba(234, 179, 8, 0.26);
          border-radius: 8px;
          background: rgba(8, 15, 26, 0.78);
        }
        #market-view .market-ai-summary .market-ai-card {
          min-height: 118px;
          border-top: 3px solid #fb7185;
          padding: 14px;
        }
        #market-view .market-ai-summary .market-ai-card.hero {
          border-color: rgba(52, 211, 153, 0.34);
          border-top-color: #fb7185;
        }
        #market-view .market-ai-summary .market-ai-card.warning {
          border-color: rgba(248, 113, 113, 0.36);
          border-top-color: #fb7185;
        }
        #market-view .market-ai-summary .market-ai-card small,
        #market-view .market-ai-decision-grid small,
        #market-view .market-ai-evidence small,
        #market-view .market-ai-current-rule small {
          display: block;
          color: #8fa4c7;
          font-size: 12px;
          font-weight: 800;
        }
        #market-view .market-ai-summary .market-ai-card strong,
        #market-view .market-ai-decision-grid strong,
        #market-view .market-ai-evidence strong,
        #market-view .market-ai-current-rule strong {
          display: block;
          margin-top: 5px;
          color: #f8fafc;
          font-size: 18px;
          line-height: 1.2;
        }
        #market-view .market-ai-summary .market-ai-card p,
        #market-view .market-ai-evidence p {
          margin: 8px 0 0;
          color: #9fb0cd;
          font-size: 12px;
          line-height: 1.55;
        }
        #market-view .market-ai-decision-strip {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          border: 1px solid rgba(234, 179, 8, 0.42);
          border-radius: 8px;
          background: rgba(234, 179, 8, 0.08);
          padding: 12px 14px;
        }
        #market-view .market-ai-decision-strip span {
          color: #f8fafc;
          font-weight: 900;
        }
        #market-view .market-ai-decision-strip small,
        #market-view .market-ai-evidence header span,
        #market-view .market-ai-points header span,
        #market-view .market-ai-risk-panel header span {
          color: #aebfe0;
          font-size: 12px;
        }
        #market-view .market-ai-decision-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        #market-view .market-ai-decision-grid article,
        #market-view .market-ai-evidence article {
          position: relative;
          padding: 16px 42px 16px 16px;
          border-top: 3px solid #fb7185;
        }
        #market-view .market-ai-decision-grid i,
        #market-view .market-ai-evidence i {
          position: absolute;
          right: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: #facc15;
          font-style: normal;
          font-size: 20px;
        }
        #market-view .market-ai-evidence,
        #market-view .market-ai-points,
        #market-view .market-ai-risk-panel,
        #market-view .market-ai-hot-section {
          overflow: hidden;
        }
        #market-view .market-ai-evidence > header,
        #market-view .market-ai-points > header,
        #market-view .market-ai-risk-panel > header,
        #market-view .market-ai-hot-section > header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 16px;
          border-bottom: 1px solid rgba(234, 179, 8, 0.16);
        }
        #market-view .market-ai-evidence h4,
        #market-view .market-ai-points h4,
        #market-view .market-ai-risk-panel h4,
        #market-view .market-ai-hot-section h4 {
          margin: 0;
          color: #f8fafc;
          font-size: 15px;
        }
        #market-view .market-ai-evidence > div {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          padding: 12px;
        }
        #market-view .market-ai-evidence article {
          min-height: 112px;
          border: 1px solid rgba(234, 179, 8, 0.18);
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.62);
        }
        #market-view .market-ai-lower-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.9fr);
          gap: 12px;
        }
        #market-view .market-ai-points > p {
          display: grid;
          grid-template-columns: 28px 1fr;
          gap: 12px;
          align-items: center;
          margin: 0 14px 9px;
          border: 1px solid rgba(148, 163, 184, 0.15);
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.56);
          padding: 12px;
          color: #cbd7ee;
          line-height: 1.55;
        }
        #market-view .market-ai-points > p:first-of-type {
          margin-top: 12px;
        }
        #market-view .market-ai-points b {
          display: grid;
          place-items: center;
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: rgba(234, 179, 8, 0.16);
          color: #facc15;
        }
        #market-view .market-ai-risk-panel > div {
          margin: 12px 14px;
          border: 1px solid rgba(234, 179, 8, 0.18);
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.6);
          padding: 14px;
        }
        #market-view .market-ai-risk-panel strong {
          color: #f8fafc;
          font-size: 17px;
        }
        #market-view .market-ai-risk-panel p {
          margin: 7px 0 0;
          color: #9fb0cd;
          line-height: 1.55;
        }
        #market-view .market-ai-filter-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(234, 179, 8, 0.12);
        }
        #market-view .market-ai-filter-row button {
          min-height: 30px;
          border: 1px solid rgba(234, 179, 8, 0.32);
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.76);
          color: #f8fafc;
          padding: 0 10px;
          font-weight: 900;
        }
        #market-view .market-ai-filter-row button.active {
          background: rgba(234, 179, 8, 0.18);
          color: #facc15;
        }
        #market-view .market-ai-filter-row b {
          display: inline-grid;
          place-items: center;
          min-width: 24px;
          height: 18px;
          margin-left: 6px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.2);
          color: #cbd5e1;
          font-size: 11px;
        }
        #market-view .market-ai-current-rule {
          display: grid;
          grid-template-columns: max-content max-content 1fr;
          gap: 10px;
          align-items: center;
          margin: 0 16px 12px;
          padding: 12px;
        }
        #market-view .market-ai-current-rule strong {
          margin: 0;
          color: #facc15;
        }
        #market-view .market-ai-current-rule span {
          color: #9fb0cd;
          font-size: 12px;
        }
        #market-view .market-ai-hot {
          display: grid;
          align-content: start;
          gap: 10px;
          min-height: 720px;
          padding: 0 12px 12px;
          overflow-anchor: none;
        }
        #market-view .market-ai-stock-row {
          display: grid;
          grid-template-columns: 54px minmax(0, 1fr) minmax(130px, auto) 86px minmax(160px, 0.28fr) 120px;
          align-items: center;
          gap: 12px;
          border: 1px solid rgba(234, 179, 8, 0.22);
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.6);
          padding: 12px;
          min-height: 96px;
        }
        #market-view .market-ai-stock-row h4 {
          margin: 0 0 4px;
          color: #f8fafc;
          font-size: 14px;
        }
        #market-view .market-ai-stock-row p {
          margin: 2px 0;
          color: #9fb0cd;
          font-size: 12px;
          line-height: 1.45;
        }
        #market-view .market-ai-rank {
          display: grid;
          place-items: center;
          width: 34px;
          height: 34px;
          border-radius: 999px;
          background: rgba(234, 179, 8, 0.16);
          color: #facc15;
          font-weight: 900;
        }
        #market-view .market-ai-chip,
        #market-view .market-ai-tags span {
          display: inline-flex;
          align-items: center;
          min-height: 22px;
          border: 1px solid rgba(234, 179, 8, 0.22);
          border-radius: 999px;
          color: #cbd5e1;
          padding: 0 8px;
          font-size: 11px;
        }
        #market-view .market-ai-score small {
          display: block;
          color: #8fa4c7;
          font-size: 11px;
        }
        #market-view .market-ai-score strong {
          color: #facc15;
          font-size: 20px;
        }
        #market-view .market-ai-actions {
          display: flex;
          gap: 6px;
          justify-content: flex-end;
        }
        #market-view .market-ai-actions button {
          min-height: 28px;
          border: 1px solid rgba(234, 179, 8, 0.28);
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.8);
          color: #f8fafc;
          padding: 0 8px;
          font-weight: 800;
        }
        @media (max-width: 1180px) {
          #market-view .market-ai-hero-board,
          #market-view .market-ai-lower-grid {
            grid-template-columns: 1fr;
          }
          #market-view .market-ai-summary,
          #market-view .market-ai-evidence > div {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          #market-view .market-ai-stock-row {
            grid-template-columns: 46px minmax(0, 1fr);
          }
          #market-view .market-ai-stock-row > div:nth-child(n+3) {
            justify-self: start;
          }
        }
        @media (max-width: 760px) {
          #market-view .market-ai-hero-metrics,
          #market-view .market-ai-summary,
          #market-view .market-ai-decision-grid,
          #market-view .market-ai-evidence > div {
            grid-template-columns: 1fr;
          }
          #market-view .market-ai-current-rule {
            grid-template-columns: 1fr;
          }
        }
        body.fuman-light-theme #market-view .market-mode-tabs {
          border-color: rgba(249, 115, 22, 0.24) !important;
          background: rgba(255, 255, 255, 0.88) !important;
        }
        body.fuman-light-theme #market-view .market-mode-tabs button {
          color: #64748b !important;
        }
        body.fuman-light-theme #market-view .market-mode-tabs button.active {
          border-color: rgba(249, 115, 22, 0.52) !important;
          background: #fff7ed !important;
          color: #c2410c !important;
        }
        body.fuman-light-theme #market-view .ticker-strip span,
        body.fuman-light-theme #market-view .ticker-strip small {
          color: #64748b !important;
        }
        body.fuman-light-theme #market-view .market-ai-panel {
          border-color: #d8e3ef !important;
          background:
            radial-gradient(circle at 20% 0%, rgba(249, 115, 22, 0.10), transparent 34%),
            #ffffff !important;
          color: #0f172a !important;
        }
        body.fuman-light-theme #market-view .market-ai-sort-note {
          border-color: rgba(249, 115, 22, 0.28) !important;
          background: #fff7ed !important;
          color: #9a3412 !important;
        }
      }
    `;
    document.head.appendChild(style);
    document.documentElement.classList.add("fuman-desktop-fast-shell");
    keepDesktopFastStyleLast();
  }
})();
