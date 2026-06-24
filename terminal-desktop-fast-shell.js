(function () {
  if (window.__fumanDesktopFastShell === "20260623-09" && window.__fumanDesktopFastShellApiOnlyPoll === "20260624-01") return;
  window.__fumanDesktopFastShell = "20260623-09";
  window.__fumanDesktopFastShellApiOnlyPoll = "20260624-01";

  const NAV_SELECTOR = "[data-view]:not([data-member-tab])";
  const SNAPSHOT_DB = "fuman-desktop-route-snapshots";
  const SNAPSHOT_STORE = "snapshots";
  const SNAPSHOT_PREFIX = "FUMAN_DESKTOP_ROUTE_SNAPSHOT:";
  const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
  const SNAPSHOT_MAX_CHARS = 850000;
  const SNAPSHOT_ROUTES = ["strategy|策略1", "strategy|策略2", "strategy|策略3", "strategy|策略4", "strategy|策略5"];
  const API_ONLY_STRATEGY_ROUTES = ["strategy|策略1", "strategy|策略3", "strategy|策略4", "strategy|策略5"];
  const LIVE_API_STRATEGY_ROUTES = ["strategy|策略2"];
  const FIXED_ROUTE_KEYS = ["market|市場總覽", "chip-trade|買賣超", "cb-detect|CB可轉債", "warrant-flow|權證走向", "watchlist|自選股"];
  const FIXED_CANVAS_PERSIST_ROUTES = ["market|市場總覽", "chip-trade|買賣超", "cb-detect|CB可轉債", "warrant-flow|權證走向"];
  const CANVAS_REFRESH_TTL_MS = 18000;
  const API_ONLY_POLL_MS = 30000;
  const PERF_LOG_KEY = "fuman-desktop-fast-perf-log-v1";
  const CANVAS_ROW_HEIGHT = 46;
  const CANVAS_HEADER_HEIGHT = 128;
  const API_QUIET_PAINT_MS = 460;
  const HOVER_WARM_IDLE_MS = 780;
  const CLICK_WARM_IDLE_MS = 980;
  const CANVAS_ENDPOINTS = {
    "strategy|策略1": "/api/open-buy-latest",
    "strategy|策略2": "/api/strategy2-latest",
    "strategy|策略3": "/api/strategy3-latest",
    "strategy|策略4": "/api/strategy4-latest",
    "strategy|策略5": "/api/strategy5-latest",
    "market|市場總覽": "/api/market",
    "chip-trade|買賣超": "/api/institution-latest",
    "cb-detect|CB可轉債": "/api/cb-detect-latest",
    "warrant-flow|權證走向": "/api/warrant-flow-latest",
  };
  const CANVAS_ROUTE_OPTIONS = {
    "market|市場總覽": { limit: 24, ttl: 14000 },
    "strategy|策略1": { limit: 60, ttl: 18000 },
    "strategy|策略2": { limit: 240, ttl: 6500, live: true, today: true },
    "strategy|策略3": { limit: 60, ttl: 22000 },
    "strategy|策略4": { limit: 70, ttl: 24000 },
    "strategy|策略5": { limit: 70, ttl: 22000 },
    "chip-trade|買賣超": { limit: 60, ttl: 32000 },
    "cb-detect|CB可轉債": { limit: 60, ttl: 32000 },
    "warrant-flow|權證走向": { limit: 60, ttl: 32000 },
  };
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
  const canvasInflight = new Map();
  const canvasRouteVersions = new Map();
  const canvasMetricsCache = new Map();
  const canvasPreRenderedRoutes = new Set();
  const fixedSnapshotTimers = new Map();
  let desktopFastBundleAt = 0;
  let desktopFastBundlePromise = null;
  const canvasState = {
    route: "",
    source: "",
    query: "",
    signalFilter: "",
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
  installLatencyPanel();
  installAutoLatencySampler();
  installPerformanceLogExport();
  installPersistentFixedCanvases();
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
    if (window.__fumanDesktopFastShell === "20260623-09") {
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
    if (view === "market") return "market|市場總覽";
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
    try {
      window.dispatchEvent(new CustomEvent("fuman:desktop-route", { detail: route }));
    } catch (error) {}
    return route;
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
        summary: "自選股清單與個股分析先保留快照，點擊後背景補齊技術頁。",
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
        summary: "21:30 產生明日候選，08:55 最終確認，09:00 只執行 BUY 名單。",
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
        summary: "波段區間與訊號分層，切頁不等待資料整理完成。",
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
    saucer: "圓弧",
    breakaway_gap: "突破缺口",
    runaway_gap: "逃逸缺口",
    v_reversal: "V轉",
    three_inside: "翻紅",
    golden_cross: "金釵",
    wallet_strong_buy: "主力多",
    wallet_volume_cross: "量叉",
  };

  function strategy4SignalLabel(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
    return STRATEGY4_SIGNAL_LABELS[key] || STRATEGY4_SIGNAL_LABELS[raw] || "";
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

  function isStrategy5Route(route) {
    return String(route || "") === "strategy|策略5";
  }

  function isStrategy3Route(route) {
    return String(route || "") === "strategy|策略3";
  }

  function isWideStrategyTableRoute(route) {
    return isStrategy3Route(route) || isStrategy4Route(route) || isStrategy5Route(route);
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

  function endpointForRoute(route) {
    return CANVAS_ENDPOINTS[route] || "";
  }

  function isStrategyRoute(route) {
    return String(route || "").startsWith("strategy|");
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
    API_ONLY_STRATEGY_ROUTES.forEach((key) => {
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
        API_ONLY_STRATEGY_ROUTES.forEach((key) => tx.objectStore(SNAPSHOT_STORE).delete(key));
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
    const query = new URLSearchParams({
      canvas: "1",
      compact: "1",
      shell: "1",
      limit: String(Math.max(20, Math.min(isLiveStrategyRoute(route) ? 240 : 120, options.limit || 60))),
    });
    if (options.live) query.set("live", "1");
    if (options.today) query.set("today", "1");
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
    const pct = merged.percent ?? merged.Percent ?? merged.changePercent ?? merged.ChangePercent ?? merged.change_percent ?? merged.change ?? merged.Change ?? merged.pct ?? "";
    const score = merged.score ?? merged.Score ?? merged.rankScore ?? merged.RankScore ?? merged.swingScore ?? active.score ?? merged.signalScore ?? "";
    const reason = String(merged.reason || active.reason || merged.message || merged.note || "").trim();
    const state = String(merged.state || merged.status || active.name || active.id || "").trim();
    const price = merged.price ?? merged.Price ?? merged.close ?? merged.Close ?? merged.ClosingPrice ?? merged.lastPrice ?? merged.LastPrice ?? merged.entryPrice ?? "";
    const volume = merged.volume ?? merged.Volume ?? merged.tradeVolume ?? merged.TradeVolume ?? merged.volumeLots ?? merged.trade_volume ?? "";
    const volumeLots = pickFirstValue(merged.volumeLots, merged.VolumeLots, merged.volume_lots, cleanNumber(volume) > 100000 ? cleanNumber(volume) / 1000 : "");
    const volumeRatio = pickFirstValue(merged.projectedRatio, merged.volumeRatio, merged.VolumeRatio, merged.projected_ratio, merged.estimatedVolumeRatio, merged.estimated_volume_ratio);
    const tradeValue = pickFirstValue(merged.tradeValue, merged.value, merged.TradeValue, merged.trade_value, merged.amount, merged.turnover);
    const legal5d = pickFirstValue(merged.legal5d, merged.legal5D, merged.institutional5d, merged.institutional5D, merged.foreign5d, merged.foreign5D, merged.foreign5dNet, merged.foreign_5d_net, merged.chip5d);
    const signals = normalizeSignalRows(merged.signals || merged.matches || merged.swingSignals || payload.signals || payload.matches || active.signals, route);
    const primarySignal = signals[0] || null;
    const rawSubStrategy = merged.subStrategy || merged.strategyLabel || merged.signalLabel || merged.setupName || merged.setup_type || active.short || active.label || active.name || primarySignal?.label || "";
    const subStrategy = compactText(
      (isStrategy4Route(route) && strategy4SignalLabel(rawSubStrategy)) || rawSubStrategy,
      42
    );
    const subStrategyId = compactText(
      merged.subStrategyId || merged.strategyId || merged.signalId || merged.setupId || active.id || active.key || active.type || primarySignal?.id || subStrategy,
      48
    );
    const signalLine = signalSummary(signals);
    const aiStatus = compactText(merged.aiStatus || merged.ai_status || merged.overnightState || state || (cleanNumber(score) ? "通過" : ""), 16);
    const aiSummary = compactText(
      merged.aiSummary || merged.ai_analysis || merged.analysis || merged.summary || reason || signalLine || "",
      180
    );
    const triggerReason = compactText(
      merged.triggerReason || merged.trigger_reason || merged.tvOvernightEntry?.reason || reason || signalLine || "",
      160
    );
    const triggerTags = [
      cleanNumber(volumeRatio) ? "量能啟動" : "",
      cleanNumber(tradeValue) ? "高成交額" : "",
      cleanNumber(legal5d) > 0 ? "法人5D偏多" : "",
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
      subStrategy,
      subStrategyId,
      signalLabel: subStrategy,
      signalLine,
      signals,
      price: price === "" || price == null ? "" : String(price),
      volume: volume === "" || volume == null ? "" : String(volume),
      volumeLots: volumeLots === "" || volumeLots == null ? "" : String(Math.round(cleanNumber(volumeLots))),
      volumeRatio: volumeRatio === "" || volumeRatio == null ? "" : String(volumeRatio),
      tradeValue: tradeValue === "" || tradeValue == null ? "" : String(tradeValue),
      legal5d: legal5d === "" || legal5d == null ? "" : String(legal5d),
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
    const arrays = flattenApiArrays(payload);
    const best = arrays
      .map((rows) => rows.map((row, index) => normalizeCanvasRow(row, index, route)).filter((row) => row.code || row.title))
      .sort((a, b) => b.length - a.length)[0] || [];
    return best
      .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || cleanNumber(b.score) - cleanNumber(a.score) || String(a.code).localeCompare(String(b.code), "zh-Hant"))
      .slice(0, Math.max(20, Math.min(isLiveStrategyRoute(route) ? 240 : 120, limit)));
  }

  function isRoutePayloadNotDrawable(payload, route = "") {
    if (!payload || typeof payload !== "object") return false;
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

  function setCanvasRows(route, rows, source = "memory", at = Date.now()) {
    const cleanRows = (Array.isArray(rows) ? rows : []).filter((row) => row && (row.code || row.title || row.line));
    if (!route || !cleanRows.length) return false;
    canvasStore.set(route, { rows: cleanRows, source, at });
    canvasRouteVersions.set(route, Number(canvasRouteVersions.get(route) || 0) + 1);
    canvasPreRenderedRoutes.delete(route);
    if (workerCanvasSupported()) {
      window.setTimeout(() => preRenderStrategyRoute(route, `rows-${source}`), 40);
    }
    if (canvasState.route === route) {
      canvasState.rows = cleanRows;
      canvasState.source = source;
      applyCanvasFilter();
      scheduleCanvasDraw();
    }
    return true;
  }

  function rememberCanvasRows(route, rows, source = "memory", at = Date.now()) {
    const cleanRows = (Array.isArray(rows) ? rows : []).filter((row) => row && (row.code || row.title || row.line));
    if (!route || !cleanRows.length) return [];
    setCanvasRows(route, cleanRows, source, at);
    const item = { ...(routeSnapshots.get(route) || {}), at, rows: cleanRows, html: "" };
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
      setCanvasRows(route, snapshot.rows, "snapshot", snapshot.at || Date.now());
      return snapshot.rows;
    }
    return [];
  }

  function primeRowsFromFastBundle(payload, source = "fast-bundle") {
    const endpoints = payload?.endpoints && typeof payload.endpoints === "object" ? payload.endpoints : {};
    let count = 0;
    Object.entries(endpoints).forEach(([endpoint, endpointPayload]) => {
      const route = routeForCompactEndpoint(endpoint);
      if (!route) return;
      const rows = normalizeCanvasRowsFromPayload(endpointPayload, route);
      if (!rows.length) return;
      rememberCanvasRows(route, rows, source, Date.now());
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
    const url = `/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&t=${now}`;
    desktopFastBundlePromise = fetch(url, { cache: force ? "no-store" : "default", priority: "low" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((payload) => primeRowsFromFastBundle(payload, `bundle-${reason}`))
      .catch(() => 0)
      .finally(() => {
        desktopFastBundlePromise = null;
      });
    return desktopFastBundlePromise;
  }

  function installDesktopFastBundlePrime() {
    if (document.documentElement.dataset.fumanFastBundlePrimeReady === "1") return;
    document.documentElement.dataset.fumanFastBundlePrimeReady = "1";
    window.FUMAN_DESKTOP_FAST_BUNDLE_PRIME = (force = true) => primeDesktopFastBundle(Boolean(force), force ? "manual" : "cache");
    const schedule = () => {
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
    canvasState.filtered = canvasState.rows.filter((row) => {
      const signalText = [row.subStrategyId, row.subStrategy, row.signalLine, ...(row.signals || []).flatMap((signal) => [signal.id, signal.label, signal.reason])].join(" ").toLowerCase();
      if (signalFilter && !signalText.includes(signalFilter)) return false;
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
    const maxOffset = Math.max(0, canvasState.filtered.length - 1);
    canvasState.offset = Math.max(0, Math.min(canvasState.offset, maxOffset));
    canvasRowsVersion += 1;
  }

  function fetchCanvasRows(route, force = false) {
    const endpoint = endpointForRoute(route);
    if (!endpoint) return Promise.resolve([]);
    const cached = canvasStore.get(route);
    const options = canvasOptionsForRoute(route);
    const ttl = Number(options.ttl || CANVAS_REFRESH_TTL_MS);
    if (!force && cached?.rows?.length && Date.now() - Number(cached.at || 0) < ttl) {
      return Promise.resolve(cached.rows);
    }
    if (canvasInflight.has(route)) return canvasInflight.get(route);
    const url = compactCanvasUrlForRoute(route, true);
    const task = fetch(url, { cache: force ? "no-store" : "default" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((payload) => {
        const rows = normalizeCanvasRowsFromPayload(payload, route);
        if (rows.length) {
          rememberCanvasRows(route, rows, "api", Date.now());
        }
        return rows;
      })
      .catch(() => rowsForRoute(route))
      .finally(() => canvasInflight.delete(route));
    canvasInflight.set(route, task);
    return task;
  }

  function currentCanvasShell() {
    return document.querySelector(".view-panel.active .desktop-route-shell.desktop-canvas-app")
      || document.querySelector(".desktop-route-shell.desktop-canvas-app");
  }

  function visibleCanvasCapacity(canvas) {
    const rect = canvas?.getBoundingClientRect?.();
    const height = Math.max(360, Math.min(760, Math.floor(rect?.height || (window.innerHeight || 900) * 0.62)));
    const rowHeight = canvasRowHeightForRoute();
    const headerHeight = canvasHeaderHeightForRoute();
    return Math.max(isWideStrategyTableRoute(canvasState.route) ? 3 : 5, Math.floor((height - headerHeight - 16) / rowHeight));
  }

  function clampCanvasOffset(canvas) {
    const capacity = visibleCanvasCapacity(canvas);
    const maxOffset = Math.max(0, canvasState.filtered.length - capacity);
    canvasState.offset = Math.max(0, Math.min(canvasState.offset, maxOffset));
  }

  function setCanvasStatus(text) {
    const shell = currentCanvasShell();
    if (!shell) return;
    const status = shell.querySelector(".desktop-canvas-status");
    const count = shell.querySelector(".desktop-canvas-count");
    const visible = canvasState.filtered.length;
    const total = canvasState.rows.length;
    const source = canvasState.source ? String(canvasState.source).replace(/^canvas-/, "") : "shell";
    if (count) count.textContent = `${visible}/${total}`;
    const mode = canvasWorkerReady ? canvasWorkerMode : source;
    if (status) status.textContent = text || `${mode} · ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}`;
  }

  function scheduleCanvasDraw() {
    window.cancelAnimationFrame(canvasFrame);
    canvasFrame = window.requestAnimationFrame(drawCurrentCanvas);
  }

  function drawCurrentCanvas() {
    const shell = currentCanvasShell();
    const canvas = shell?.querySelector(".desktop-route-canvas");
    if (!canvas) return;
    clampCanvasOffset(canvas);
    if (!isWideStrategyTableRoute(canvasState.route) && drawCanvasWithWorker(canvas)) {
      setCanvasStatus();
      return;
    }
    drawRouteCanvas(canvas, strategyMeta(canvasState.route || activeSnapshotRoute), canvasState.filtered, canvasState.source);
    setCanvasStatus();
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
    const height = Math.max(isFixed ? 440 : 420, Math.min(isFixed ? 700 : 680, Math.floor(viewportHeight - 320)));
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
    const routes = [...SNAPSHOT_ROUTES, ...FIXED_ROUTE_KEYS.filter((route) => route !== "watchlist|自選股")];
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

  function wideStrategyColumnLayout(width) {
    const left = 24;
    const right = 24;
    const available = Math.max(900, width - left - right);
    const spec = [
      ["rank", "排名", 58],
      ["stock", "股票", 142],
      ["side", "多空", 72],
      ["price", "價格", 86],
      ["pct", "漲幅", 88],
      ["volume", "量", 100],
      ["ratio", "推估量比", 112],
      ["value", "成交額", 108],
      ["legal", "法人5D", 98],
      ["score", "分數", 76],
      ["ai", "AI分析", 260],
      ["trigger", "觸發原因", 260],
    ];
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

  function drawWideStrategyCanvasRows(ctx, colors, width, height, rows, rowsToDraw, source, capacity, rowHeight, headerHeight) {
    const columns = wideStrategyColumnLayout(width);
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
      ctx.fillText(formatCompactNumber(row.volumeLots || row.volume, 0) || "--", col("volume").x + 6, y - 2);
      ctx.fillText(formatRatioValue(row.volumeRatio) || "--", col("ratio").x + 6, y - 2);
      ctx.fillText(formatTradeValue(row.tradeValue) || "--", col("value").x + 6, y - 2);
      ctx.fillText(formatCompactNumber(row.legal5d, 0) || "--", col("legal").x + 6, y - 2);
      ctx.fillText(row.score || "--", col("score").x + 6, y - 2);

      ctx.fillStyle = row.aiStatus === "觀察" ? colors.muted : colors.up;
      ctx.font = "900 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(row.aiStatus || "通過", col("ai").x + 6, y - 24);
      ctx.fillStyle = colors.muted;
      ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      fillCanvasMultiline(ctx, row.aiSummary || row.reason || row.line, col("ai").x + 6, y - 2, Math.max(14, Math.floor((col("ai").width - 12) / 13)), 18, 3);

      const tags = Array.isArray(row.triggerTags) ? row.triggerTags.slice(0, 2) : [];
      let tagX = col("trigger").x + 6;
      tags.forEach((tag, tagIndex) => {
        const tagWidth = Math.min(86, Math.max(58, tag.length * 15));
        drawCanvasPill(ctx, tag, tagX, y - 24, tagWidth, colors, tagIndex ? "neutral" : "accent");
        tagX += tagWidth + 6;
      });
      ctx.fillStyle = colors.muted;
      ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      fillCanvasMultiline(ctx, row.triggerReason || row.reason || row.line, col("trigger").x + 6, y + 10, Math.max(14, Math.floor((col("trigger").width - 12) / 13)), 18, 2);
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
        ${signalChips ? `<div class="desktop-canvas-signal-list">${signalChips}</div>` : ""}
        <div class="desktop-canvas-detail-grid">
          <span>分數 <strong>${escapeHtml(row.score || "--")}</strong></span>
          <span>漲幅 <strong>${escapeHtml(row.pct || "--")}</strong></span>
          <span>價格 <strong>${escapeHtml(formatPriceValue(row.price) || row.price || "--")}</strong></span>
          <span>量能 <strong>${escapeHtml(formatCompactNumber(row.volumeLots || row.volume, 0) || row.volume || "--")}</strong></span>
          ${isWideStrategyTableRoute(canvasState.route) ? `
            <span>推估量比 <strong>${escapeHtml(formatRatioValue(row.volumeRatio) || "--")}</strong></span>
            <span>成交額 <strong>${escapeHtml(formatTradeValue(row.tradeValue) || "--")}</strong></span>
            <span>法人5D <strong>${escapeHtml(formatCompactNumber(row.legal5d, 0) || "--")}</strong></span>
            <span>多空 <strong>${escapeHtml(row.longShort || "多")}</strong></span>
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
        updateStrategySignalControls(currentCanvasShell());
        setCanvasStatus(canvasState.signalFilter ? "細分篩選" : "全部訊號");
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
      const oldOffset = canvasState.offset;
      if (event.key === "ArrowDown") canvasState.offset += 1;
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
      if (!isApiOnlyPollingRoute(route)) return;
      const active = window.__fumanDesktopActiveRoute;
      if (active?.key && active.key !== route) return;
      const before = currentRowsSignature(route);
      fetchCanvasRows(route, true).then((rows) => {
        if (!rows?.length || (window.__fumanDesktopActiveRoute?.key && window.__fumanDesktopActiveRoute.key !== route)) return;
        const next = rowSignature(rows);
        if (before === next && canvasState.route === route) {
          canvasState.source = `api-only-poll-${reason}`;
          setCanvasStatus();
          scheduleCanvasDraw();
          return;
        }
        if (canvasState.route === route && currentCanvasShell()) {
          canvasState.rows = rows;
          canvasState.source = `api-only-poll-${reason}`;
          applyCanvasFilter();
          scheduleCanvasDraw();
          setCanvasStatus();
          return;
        }
        renderStrategyRouteShell(route, `api-only-poll-${reason}`, rows);
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
      for (let i = 0; i < 5; i += 1) {
        const y = headerHeight + 18 + i * rowHeight;
        const alpha = 0.16 - i * 0.014;
        ctx.fillStyle = colors.skeleton.replace("0.16", String(alpha));
        roundRect(ctx, 42, y, width - 84 - i * 28, 18, 9);
        ctx.fill();
      }
      ctx.fillStyle = colors.muted;
      ctx.font = "700 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(isLiveStrategyRoute(canvasState.route) ? "今日尚無戰鬥訊號，持續即時監控" : source.includes("canvas") ? "讀取快照中" : "已切換，背景同步資料", 44, height - 28);
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
      if (isWideStrategyTableRoute(canvasState.route) || !drawCanvasWithWorker(canvas)) {
        drawRouteCanvas(canvas, meta, canvasState.filtered, canvasState.source);
      }
      setCanvasStatus();
    });
  }

  function strategy4SignalCounts(rows = []) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const signals = row?.signals?.length ? row.signals : row?.subStrategy ? [{ id: row.subStrategyId || row.subStrategy, label: row.subStrategy }] : [];
      signals.forEach((signal) => {
        const key = compactText(signal.id || signal.label || "", 48);
        const label = compactText(signal.label || signal.id || "", 28);
        if (!key || !label) return;
        const current = map.get(key) || { key, label, count: 0 };
        current.count += 1;
        map.set(key, current);
      });
    });
    return [...map.values()]
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-Hant"))
      .slice(0, 8);
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
        <button type="button" ${datasetName}="${escapeHtml(item.key)}" class="${active === item.key ? "active" : ""}">
          ${escapeHtml(item.label)} <b>${escapeHtml(String(item.count))}</b>
        </button>
      `).join("")}
    ` : "";
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

  function canvasShellHtml(key, meta) {
    return `
      <section class="desktop-route-shell desktop-canvas-app" data-route-shell="${escapeHtml(key)}" data-route-source="${escapeHtml(canvasState.source || "")}">
        <div class="desktop-route-shell-head">
          <span data-canvas-meta-icon>${escapeHtml(meta.icon)}</span>
          <div>
            <h2 data-canvas-meta-title>${escapeHtml(meta.title)}</h2>
            <p data-canvas-meta-summary>${escapeHtml(meta.summary)}</p>
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
        <div class="desktop-strategy4-signal-filters" data-strategy4-signal-filters hidden></div>
        <canvas class="desktop-route-canvas" tabindex="0" aria-label="${escapeHtml(meta.title)} Canvas 快速列表"></canvas>
        <div class="desktop-canvas-detail" hidden></div>
      </section>
    `;
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
    shell.dataset.routeShell = key;
    shell.dataset.routeSource = canvasState.source || "";
    const icon = shell.querySelector("[data-canvas-meta-icon]") || shell.querySelector(".desktop-route-shell-head > span");
    const title = shell.querySelector("[data-canvas-meta-title]") || shell.querySelector(".desktop-route-shell-head h2");
    const summary = shell.querySelector("[data-canvas-meta-summary]") || shell.querySelector(".desktop-route-shell-head p");
    const dataState = shell.querySelector("[data-canvas-data-state]") || shell.querySelector(".desktop-route-shell-grid article:nth-child(2) strong");
    const modeState = shell.querySelector("[data-canvas-mode-state]") || shell.querySelector(".desktop-route-shell-grid article:nth-child(3) strong");
    const count = shell.querySelector(".desktop-canvas-count");
    const status = shell.querySelector(".desktop-canvas-status");
    const input = shell.querySelector(".desktop-canvas-search");
    let canvas = shell.querySelector(".desktop-route-canvas");
    if (isStrategy3Route(key) && canvas?.dataset?.fumanWorkerCanvas === "1") {
      const fresh = document.createElement("canvas");
      fresh.className = canvas.className;
      fresh.tabIndex = canvas.tabIndex || 0;
      fresh.setAttribute("aria-label", `${meta.title} Canvas 快速列表`);
      canvas.replaceWith(fresh);
      canvas = fresh;
    }
    if (icon) icon.textContent = meta.icon;
    if (title) title.textContent = meta.title;
    if (summary) summary.textContent = meta.summary;
    if (dataState) dataState.textContent = isLiveStrategyRoute(key) ? "即時偵測" : canvasState.rows.length ? "快照命中" : "背景更新";
    if (modeState) modeState.textContent = canvasWorkerReady ? "OffscreenCanvas" : "Canvas";
    if (count) count.textContent = `${canvasState.filtered.length}/${canvasState.rows.length}`;
    if (status) status.textContent = canvasWorkerReady ? canvasWorkerMode : canvasState.source || "shell";
    if (input && document.activeElement !== input) input.value = canvasState.query || "";
    if (canvas) canvas.setAttribute("aria-label", `${meta.title} Canvas 快速列表`);
    updateStrategySignalControls(shell);
    return canvas;
  }

  function renderStrategyRouteShell(link, source, rows = []) {
    const panel = document.querySelector("#strategy-view");
    if (!panel) return false;
    const key = strategyRouteKey(link);
    const previousRoute = canvasState.route;
    const stored = canvasStore.get(key);
    const incomingRows = rows.length ? rows : rowsForRoute(key);
    activeSnapshotRoute = key;
    canvasState.route = key;
    canvasState.source = source || stored?.source || "shell";
    canvasState.rows = incomingRows;
    if (previousRoute !== key) {
      canvasState.signalFilter = "";
      canvasState.offset = 0;
      canvasState.hoverIndex = -1;
      canvasState.selectedIndex = -1;
      hideCanvasDetail();
    }
    applyCanvasFilter();
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
      if (!shell) {
        table.innerHTML = canvasShellHtml(key, meta);
        shell = table.querySelector(".desktop-route-shell.desktop-canvas-app");
      }
      const canvas = updateCanvasShell(shell, key, meta);
      drawCanvasShellFrame(canvas, meta);
    }
    window.setTimeout(() => delete panel.dataset.fumanRouteSnapshotRestoring, 0);
    return true;
  }

  function renderFixedPageShell(link, source, rows = []) {
    const key = fixedRouteKey(link);
    const panel = panelForRoute(key);
    if (!key || !panel) return false;
    const previousRoute = canvasState.route;
    const stored = canvasStore.get(key);
    const incomingRows = rows.length ? rows : rowsForRoute(key);
    activeSnapshotRoute = key;
    canvasState.route = key;
    canvasState.source = source || stored?.source || "shell";
    canvasState.rows = incomingRows;
    if (previousRoute !== key) {
      canvasState.signalFilter = "";
      canvasState.offset = 0;
      canvasState.hoverIndex = -1;
      canvasState.selectedIndex = -1;
      hideCanvasDetail();
    }
    applyCanvasFilter();
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
    window.setTimeout(() => {
      if (!isRouteCurrent(key, seq) || activeSnapshotRoute !== key || canvasState.route !== key) return;
      fetchCanvasRows(key, isLiveStrategyRoute(key)).then((apiRows) => {
        if (!isRouteCurrent(key, seq) || activeSnapshotRoute !== key || canvasState.route !== key) return;
        if (apiRows?.length) {
          scheduleRoutePaint(key, seq, () => renderStrategyRouteShell(key, "api", apiRows), "api");
        } else {
          scheduleCanvasDraw();
        }
      }).catch(() => setCanvasStatus("沿用快照"));
    }, rows.length ? 80 : 140);
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
    const panel = panelForRoute(key);
    let rows = rowsForRoute(key);
    if (!rows.length) {
      const domRows = extractLiteRows(panel);
      if (domRows.length) {
        setCanvasRows(key, domRows, "dom-hot", Date.now());
        routeSnapshots.set(key, { at: Date.now(), rows: domRows, html: "" });
        rows = domRows;
      }
    }
    renderFixedPageShell(link, source, rows);
    markLatency("shell", key);
    restoreFixedPageSnapshot(link);
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
      let button = document.querySelector("#fuman-theme-toggle");
      if (!button) {
        button = document.createElement("button");
        button.id = "fuman-theme-toggle";
        button.className = "fuman-theme-toggle";
        button.type = "button";
        document.body.appendChild(button);
      }
      const applyTheme = (theme) => {
        const light = theme === "light";
        document.body.classList.toggle("fuman-light-theme", light);
        document.documentElement.dataset.fumanTheme = light ? "light" : "dark";
        button.textContent = light ? "☀" : "☾";
        button.title = light ? "切換月亮模式" : "切換陽光模式";
        button.setAttribute("aria-label", button.title);
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
      .desktop-route-canvas:focus {
        outline: 2px solid rgba(255,112,55,0.72);
        outline-offset: 3px;
      }
      .desktop-canvas-toolbar {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) auto auto auto;
        align-items: end;
        gap: 12px;
        margin-top: 18px;
      }
      .desktop-strategy4-signal-filters {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin: 12px 0 12px;
      }
      .desktop-strategy4-signal-filters[hidden] {
        display: none !important;
      }
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
      .desktop-strategy4-signal-filters button.active {
        border-color: rgba(255,112,55,0.68);
        color: #fff3e9;
        background: rgba(255,112,55,0.18);
      }
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
        body.fuman-light-theme .desktop-strategy4-signal-filters button {
          border-color: #cbd8e6;
          color: #334155;
          background: rgba(255,255,255,0.9);
        }
        body.fuman-light-theme .desktop-strategy4-signal-filters button.active {
          border-color: rgba(249,115,22,0.5);
          color: #c2410c;
          background: #fff7ed;
        }
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
        html body.fuman-light-theme.public-terminal .desktop-strategy4-signal-filters button {
          border-color: #cbd8e6 !important;
          background: #ffffff !important;
          color: #334155 !important;
          box-shadow: none !important;
        }
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
      }
    `;
    document.head.appendChild(style);
    document.documentElement.classList.add("fuman-desktop-fast-shell");
    keepDesktopFastStyleLast();
  }
})();
