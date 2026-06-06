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
const FUMAN_RUNTIME_CONFIG = window.FUMAN_RUNTIME_CONFIG || {};
const FUMAN_TUNING_CONFIG = window.FUMAN_TUNING_CONFIG || {};
const FUMAN_SUPABASE_URL = FUMAN_RUNTIME_CONFIG.supabaseUrl || "";
const FUMAN_SUPABASE_KEY = FUMAN_RUNTIME_CONFIG.supabaseKey || "";
const FUMAN_ACCESS_TABLE = FUMAN_RUNTIME_CONFIG.accessTable || "fuman_user_access";
const FUMAN_ADMIN_EMAILS = new Set(FUMAN_RUNTIME_CONFIG.adminEmails || []);
const authGate = document.querySelector("#auth-gate");
const authForm = document.querySelector("#auth-form");
const authEmail = document.querySelector("#auth-email");
const authPassword = document.querySelector("#auth-password");
const authPasswordToggle = document.querySelector("#auth-password-toggle");
const authSubmit = document.querySelector("#auth-submit");
const authSignout = document.querySelector("#auth-signout");
const authMessage = document.querySelector("#auth-message");
const authModeButtons = [...document.querySelectorAll("[data-auth-mode]")];
const authLogoutButton = document.querySelector(".sidebar-foot .logout");
const memberState = document.querySelector("#member-state");
const supabaseClient = window.supabase?.createClient?.(FUMAN_SUPABASE_URL, FUMAN_SUPABASE_KEY);
const PUBLIC_VIEWS = new Set(["market"]);
const FUMAN_THEME_KEY = FUMAN_RUNTIME_CONFIG.themeKey || "fuman-terminal-theme";
const FUMAN_AUTH_CACHE_KEY = FUMAN_RUNTIME_CONFIG.authCacheKey || "fuman-terminal-auth-cache-v1";
const FUMAN_AUTH_CACHE_TTL_MS = FUMAN_RUNTIME_CONFIG.authCacheTtlMs || (5 * 60 * 1000);
const FUMAN_COMMON_TABS_KEY = FUMAN_RUNTIME_CONFIG.commonTabsKey || "fuman-terminal-common-tabs-v1";
let authMode = "login";
const FUMAN_LIVE_MEMORY_TTL_MS = FUMAN_RUNTIME_CONFIG.liveMemoryTtlMs || { strategy2: 3000, realtimeRadar: 5000 };
const fumanLiveMemoryCache = new Map();
let fumanWorker = null;
let fumanWorkerSeq = 0;
const fumanWorkerPending = new Map();

function getFumanWorker() {
  if (!("Worker" in window)) return null;
  if (fumanWorker) return fumanWorker;
  try {
    fumanWorker = new Worker("terminal-worker.js?v=deep-speed-20260606");
    fumanWorker.addEventListener("message", (event) => {
      const { id, ok, rows, result, error } = event.data || {};
      const pending = fumanWorkerPending.get(id);
      if (!pending) return;
      fumanWorkerPending.delete(id);
      if (ok) pending.resolve(result ?? rows);
      else pending.reject(new Error(error || "worker failed"));
    });
    fumanWorker.addEventListener("error", () => {
      fumanWorkerPending.forEach((pending) => pending.reject(new Error("worker failed")));
      fumanWorkerPending.clear();
      fumanWorker = null;
    });
    return fumanWorker;
  } catch (error) {
    return null;
  }
}

function sortRowsInWorker(rows, sortKey, sortDir) {
  const worker = getFumanWorker();
  if (!worker) return Promise.reject(new Error("worker unavailable"));
  const id = ++fumanWorkerSeq;
  return new Promise((resolve, reject) => {
    fumanWorkerPending.set(id, { resolve, reject });
    worker.postMessage({ id, type: "sortRows", rows, sortKey, sortDir });
  });
}

function buildSwingBucketsInWorker(payload) {
  const worker = getFumanWorker();
  if (!worker) return Promise.reject(new Error("worker unavailable"));
  const id = ++fumanWorkerSeq;
  return new Promise((resolve, reject) => {
    fumanWorkerPending.set(id, { resolve, reject });
    worker.postMessage({ id, type: "swingBuckets", ...payload });
  });
}

function getLiveMemoryCache(key, ttlMs, force = false) {
  if (force) return null;
  const item = fumanLiveMemoryCache.get(key);
  if (!item || Date.now() - item.at > ttlMs) return null;
  return item.value;
}

function setLiveMemoryCache(key, value) {
  fumanLiveMemoryCache.set(key, { at: Date.now(), value });
  return value;
}

function isLowEndMobileDevice() {
  if (!isMobileViewport()) return false;
  const memory = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  return reducedMotion || (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4);
}

function applyFumanDeviceMode() {
  document.body.classList.toggle("low-end-mobile", isLowEndMobileDevice());
  document.body.classList.toggle("mobile-fast-path", isMobileViewport());
}

function installInteractionLatencyMonitor() {
  if (window.__fumanInteractionLatencyReady) return;
  window.__fumanInteractionLatencyReady = true;
  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-view],[data-chip-mode],[data-chip-filter],[data-warrant-refresh],[data-mobile-full-load],[data-page-action]");
    if (!target || typeof performance === "undefined") return;
    const label = target.dataset.view || target.dataset.chipMode || target.dataset.chipFilter || target.dataset.mobileFullLoad || target.dataset.pageAction || "tap";
    const startedAt = performance.now();
    requestAnimationFrame(() => {
      setTimeout(() => recordFumanPerformance("interaction:" + label, startedAt, true), 0);
    });
  }, true);
}

window.addEventListener("resize", () => deferUiWork(applyFumanDeviceMode, 80));

function markLazyModuleForView(viewName) {
  window.FUMAN_TERMINAL_MODULES?.preloadForView?.(viewName);
}

function normalizeCommonTab(viewName, text = "") {
  const label = String(text || "");
  if (viewName === "chip-trade" || label.includes("買賣")) return "chip";
  if (viewName === "warrant-flow" || label.includes("權證")) return "warrant";
  if (viewName === "realtime-radar" || label.includes("即時")) return "realtime";
  if (label.includes("策略2") || label.includes("當沖")) return "strategy2";
  if (label.includes("策略5")) return "strategy5";
  return viewName || "";
}

function rememberCommonTab(viewName, text = "") {
  const key = normalizeCommonTab(viewName, text);
  if (!key || key === "market") return;
  try {
    const rows = JSON.parse(localStorage.getItem(FUMAN_COMMON_TABS_KEY) || "{}");
    rows[key] = { count: cleanNumber(rows[key]?.count) + 1, at: Date.now() };
    localStorage.setItem(FUMAN_COMMON_TABS_KEY, JSON.stringify(rows));
  } catch (error) {}
}

function rankedCommonTabs() {
  const defaults = getMobileHomeMode() === "intraday"
    ? ["strategy2", "realtime", "chip", "warrant"]
    : ["chip", "warrant", "strategy5", "strategy2"];
  try {
    const rows = JSON.parse(localStorage.getItem(FUMAN_COMMON_TABS_KEY) || "{}");
    const ranked = Object.entries(rows)
      .sort((a, b) => cleanNumber(b[1]?.count) - cleanNumber(a[1]?.count) || cleanNumber(b[1]?.at) - cleanNumber(a[1]?.at))
      .map(([key]) => key);
    return [...new Set([...ranked, ...defaults])].slice(0, 5);
  } catch (error) {
    return defaults;
  }
}

function scheduleCommonTabWarmup() {
  if (window.__fumanCommonWarmupScheduled) return;
  window.__fumanCommonWarmupScheduled = true;
  deferIdleWork(() => warmCommonTabs(), 1600);
}

function warmCommonTabs() {
  if (!isTerminalUnlocked()) return;
  for (const key of rankedCommonTabs()) {
    if (key === "chip") {
      markLazyModuleForView("chip-trade");
      ensureChipFlowModule().catch(() => undefined);
      if (!isMobileViewport()) preloadChipTradeFullData("login-warmup");
    } else if (key === "warrant") {
      markLazyModuleForView("warrant-flow");
      ensureWarrantFlowModule().catch(() => undefined);
      if (isMobileViewport() && endpoints.warrantFlowMobileTop) {
        fetchVersionedJson(endpoints.warrantFlowMobileTop, 3500, "mobile-top", false).catch(() => undefined);
      } else {
        preloadWarrantFlowFullData("login-warmup");
      }
    } else if (key === "strategy2") {
      markLazyModuleForView("strategy");
      fetchVersionedJsonFallback([
        { url: endpoints.strategy2IntradayLiveTop, label: "strategy2-live-top", kind: "strategy2" },
        { url: endpoints.strategy2IntradayTop, label: "strategy2-top", kind: "strategy2" },
      ], 3500, "strategy2").catch(() => undefined);
    } else if (key === "strategy5") {
      markLazyModuleForView("strategy");
      fetchVersionedJson(endpoints.strategy5Cache, 4500, "latest", false).catch(() => undefined);
    } else if (key === "realtime") {
      markLazyModuleForView("realtime-radar");
      fetchVersionedJson(endpoints.realtimeRadarCache, 4500, "latest", false).catch(() => undefined);
    }
  }
}

function recordFrontendError(kind, error) {
  try {
    const message = error?.message || error?.reason?.message || String(error?.reason || error || "");
    const item = {
      kind,
      message: message.slice(0, 160),
      at: Date.now(),
      view: getActiveViewName?.() || "",
    };
    const key = "fuman_frontend_errors_v1";
    const rows = JSON.parse(localStorage.getItem(key) || "[]");
    rows.push(item);
    localStorage.setItem(key, JSON.stringify(rows.slice(-40)));
    window.FUMAN_TERMINAL_BOOT = window.FUMAN_TERMINAL_BOOT || {};
    window.FUMAN_TERMINAL_BOOT.frontendErrors = rows.slice(-10);
    const url = "/api/frontend-error";
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([JSON.stringify(item)], { type: "application/json" }));
    } else {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch (e) {}
}

window.addEventListener("error", (event) => recordFrontendError("error", event.error || event.message));
window.addEventListener("unhandledrejection", (event) => recordFrontendError("promise", event.reason));

function warmWorkerSortCache(cacheKey, rows, sortKey, sortDir, applyRows) {
  if (!rows?.length || rows.length < 80) return;
  sortRowsInWorker(rows, sortKey, sortDir)
    .then((sorted) => {
      if (typeof applyRows === "function") applyRows(cacheKey, sorted);
    })
    .catch(() => undefined);
}

function warmSwingWorkerCache(cacheKey, allRows, options = {}) {
  if (!allRows?.length || allRows.length < 80) return;
  buildSwingBucketsInWorker({
    allRows,
    zoneFilter: options.zoneFilter || "all",
    signalFilter: options.signalFilter || "all",
    sortKey: options.sortKey || "score",
    sortDir: options.sortDir || "desc",
  }).then((result) => {
    if (cacheKey !== swingRenderCacheSignature || !result?.rows) return;
    swingRenderCacheRows = result.rows;
    swingRenderCacheZoneRows = result.zoneRows || swingRenderCacheZoneRows;
    swingRenderCacheSignalCounts = result.signalCounts || swingRenderCacheSignalCounts;
  }).catch(() => undefined);
}

function installMarketSkeleton() {
  const panel = viewPanels.market;
  if (!panel || panel.dataset.marketSkeletonReady) return;
  panel.dataset.marketSkeletonReady = "1";
  loadFumanStyle("terminal-utility.css", "fuman-market-skeleton-styles");
  if (tickerStrip && !tickerStrip.children.length) {
    tickerStrip.innerHTML = `<span class="fuman-skeleton" style="width:100%;height:28px;"></span>`;
  }
  if (strengthPanel && !strengthPanel.children.length) {
    strengthPanel.innerHTML = `<div class="market-skeleton-grid"><div class="fuman-skeleton"></div><div class="fuman-skeleton"></div><div class="fuman-skeleton"></div><div class="fuman-skeleton"></div></div>`;
  }
}

function loadFumanStyle(href, id) {
  if (document.querySelector(`#${id}`)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href.includes("?") ? href : `${href}?v=${window.FUMAN_TERMINAL_BOOT?.version || "deep-speed-20260606"}`;
  document.head.appendChild(link);
}


const fumanFeatureModulePromises = {};

function makeFumanModuleScope(bindings) {
  return new Proxy(bindings, {
    has() { return true; },
    get(target, prop) {
      if (prop === Symbol.unscopables) return undefined;
      if (prop in target) return target[prop];
      return window[prop];
    },
    set(target, prop, value) {
      if (prop in target) target[prop] = value;
      else window[prop] = value;
      return true;
    },
  });
}

function loadFumanFeatureModule(name, src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (fumanFeatureModulePromises[name]) return fumanFeatureModulePromises[name];
  const version = window.FUMAN_TERMINAL_BOOT?.version || "deep-speed-20260606";
  fumanFeatureModulePromises[name] = new Promise((resolve, reject) => {
    const attr = "data-fuman-feature-" + name;
    const existing = document.querySelector("script[" + attr + "]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window[globalName]), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src + "?v=" + version;
    script.async = true;
    script.setAttribute(attr, "1");
    script.addEventListener("load", () => {
      if (window[globalName]) resolve(window[globalName]);
      else reject(new Error(name + " module missing"));
    }, { once: true });
    script.addEventListener("error", reject, { once: true });
    document.head.appendChild(script);
  });
  return fumanFeatureModulePromises[name];
}

function installThemeToggle() {
  if (document.querySelector("#fuman-theme-toggle")) return;
  loadFumanStyle("terminal-theme.css", "fuman-theme-toggle-styles");
  const button = document.createElement("button");
  button.id = "fuman-theme-toggle";
  button.className = "fuman-theme-toggle";
  button.type = "button";
  const applyTheme = (theme) => {
    const light = theme === "light";
    document.body.classList.toggle("fuman-light-theme", light);
    button.textContent = light ? "☀" : "☾";
    button.title = light ? "切換黑夜模式" : "切換白天模式";
    button.setAttribute("aria-label", button.title);
  };
  const savedTheme = localStorage.getItem(FUMAN_THEME_KEY) || "dark";
  applyTheme(savedTheme === "light" ? "light" : "dark");
  button.addEventListener("click", () => {
    const next = document.body.classList.contains("fuman-light-theme") ? "dark" : "light";
    localStorage.setItem(FUMAN_THEME_KEY, next);
    applyTheme(next);
  });
  document.body.appendChild(button);
  pinMobileToolButtons();
}

function installGlobalRefreshWidget() {
  document.querySelector("#global-refresh-widget")?.remove();
}

function arrangeWatchlistSearch() {
  const panel = viewPanels.watchlist || document.querySelector("#watchlist-view");
  const header = panel?.querySelector(".page-header");
  const input = document.querySelector("#watchlist-search-input");
  const button = document.querySelector("#watchlist-add-btn");
  if (!panel || !header || !input || !button || document.querySelector("#watchlist-search-row")) return;
  const row = document.createElement("div");
  row.id = "watchlist-search-row";
  row.className = "watchlist-search-row";
  row.appendChild(input);
  row.appendChild(button);
  header.insertAdjacentElement("afterend", row);
}

function handleGlobalRefresh() {
  const active = getActiveViewName();
  if (active === "market") {
    loadMarketData(true);
    loadHeatmap(true);
    return;
  }
  if (active === "realtime-radar") {
    realtimeRadarSide = "auto";
    if (!realtimeRadarLastRows.length && !isRealtimeRadarFresh()) realtimeRadarNeedsFreshScan = true;
    renderRealtimeRadar();
    return;
  }
  if (active === "strategy") {
    if (strategyPresetMode === "strategy3") loadStrategy3Cache(true);
    else if (strategyPresetMode === "strategy5") loadStrategy5Cache(true);
    else if (selectedStrategyIds.has("open_buy")) loadOpenBuyCache(true);
    else if (selectedStrategyIds.has("swing_radar")) loadStrategy4Cache(true);
    else if (selectedStrategyIds.has("intraday_2m")) refreshStrategyRealtimeScan("force");
    else renderStrategyScanner();
    return;
  }
  if (active === "chip-trade") {
    loadChipTradeData(true);
    return;
  }
  if (active === "warrant-flow") {
    loadWarrantFlow(true);
    return;
  }
  if (active === "watchlist") {
    renderWatchlist();
    refreshSelectedWatchlistQuote();
    return;
  }
  window.location.reload();
}

async function addStockToWatchlistAndOpen(code, name = code) {
  if (!code || typeof getWatchlist !== "function" || typeof saveWatchlist !== "function") return;
  const list = getWatchlist();
  if (!list.some((item) => item.code === code)) {
    list.push({ code, name });
    saveWatchlist(list);
  }
  const watchLink = viewLinks.find((link) => link.dataset.view === "watchlist");
  if (watchLink) showView("watchlist", watchLink);
  await renderWatchlist();
  const card = document.querySelector(`#wcard-${code}`);
  if (card) {
    card.click();
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } else if (typeof showTradingDashboard === "function") {
    showTradingDashboard(code, name);
  }
}

function setAuthMessage(text, type = "") {
  if (!authMessage) return;
  authMessage.textContent = text || "";
  authMessage.classList.toggle("error", type === "error");
  authMessage.classList.toggle("success", type === "success");
}

function readFumanAuthCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(FUMAN_AUTH_CACHE_KEY) || "null");
    if (!cached || Date.now() - cleanNumber(cached.at) > FUMAN_AUTH_CACHE_TTL_MS) return null;
    return cached;
  } catch (error) {
    return null;
  }
}

function writeFumanAuthCache(session, access) {
  try {
    if (!session?.user || !access?.allowed) {
      localStorage.removeItem(FUMAN_AUTH_CACHE_KEY);
      return;
    }
    localStorage.setItem(FUMAN_AUTH_CACHE_KEY, JSON.stringify({
      at: Date.now(),
      email: normalizeAuthEmail(session.user.email),
      status: access.status || "approved",
    }));
  } catch (error) {}
}

function warmFumanAuthFromCache() {
  const cached = readFumanAuthCache();
  document.body.classList.toggle("auth-cache-warm", Boolean(cached));
  if (cached && memberState) {
    memberState.textContent = "會員狀態：快速恢復中";
    memberState.dataset.status = "cache_warming";
  }
}

function setAuthMode(mode) {
  authMode = mode === "signup" ? "signup" : "login";
  authModeButtons.forEach((button) => {
    const active = button.dataset.authMode === authMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  if (authSubmit) authSubmit.textContent = authMode === "signup" ? "註冊帳號" : "登入";
  if (authPassword) authPassword.autocomplete = authMode === "signup" ? "new-password" : "current-password";
  setAuthMessage(authMode === "signup" ? "輸入 Email 與密碼建立帳號。" : "請登入已開通帳號。");
}

function isTerminalUnlocked() {
  return document.body.classList.contains("auth-ready");
}

function isProtectedView(viewName) {
  return Boolean(viewName) && !PUBLIC_VIEWS.has(viewName);
}

function canRunViewWork(viewName) {
  return !isProtectedView(viewName) || isTerminalUnlocked();
}

function getActiveViewName() {
  return Object.entries(viewPanels).find(([, panel]) => panel?.classList.contains("active"))?.[0] || "market";
}

function openAuthGate(mode = "login") {
  setAuthMode(mode);
  document.body.classList.add("auth-login-open");
  if (authGate) authGate.setAttribute("aria-hidden", "false");
  setTimeout(() => authEmail?.focus(), 0);
}

function closeAuthGate() {
  document.body.classList.remove("auth-login-open");
  if (authGate) authGate.setAttribute("aria-hidden", "true");
}

function ensureMemberLock(panel, viewName, activeLink) {
  if (!panel) return;
  const host = viewName === "strategy" ? panel.querySelector(".strategy-results") || panel : panel;
  host.classList.add("member-lock-host");
  let overlay = host.querySelector(":scope > .member-lock-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "member-lock-overlay";
    host.appendChild(overlay);
  }
  const title = activeLink?.textContent?.replace(/\s+/g, " ").trim() || "會員專屬功能";
  overlay.innerHTML = `
    <div class="member-lock-card" role="dialog" aria-label="會員登入解鎖">
      <span class="member-lock-kicker">MEMBER ACCESS</span>
      <h2>解鎖完整標的</h2>
      <p>登入已開通帳號後可看完整股票代號、名稱、方向、分數、關鍵價位與 AI 可執行結論。</p>
      <div class="member-lock-actions">
        <button type="button" data-member-login>登入已開通帳號</button>
        <button type="button" data-member-signup>註冊 / 申請試用</button>
      </div>
      <div class="member-lock-preview" aria-hidden="true">
        <section class="member-lock-metrics">
          <article><span>今日偵測</span><strong>30</strong></article>
          <article><span>強訊號</span><strong>21</strong></article>
          <article><span>最高分區間</span><strong>80+</strong></article>
          <article><span>平均量能</span><strong>3.0x+</strong></article>
        </section>
        <section class="member-lock-band">
          <h3>資金集中分類</h3>
          <div><span>電子 19 檔</span><span>其他 4 檔</span><span>AI伺服器 1 檔</span><span>IC設計 1 檔</span></div>
        </section>
        <section class="member-lock-band">
          <h3>今日訊號味道</h3>
          <div><span>量能急速放大</span><span>成交金額集中</span><span>法人籌碼活躍</span><span>高強度訊號出現</span></div>
        </section>
        <section class="member-lock-samples">
          <h3>遮罩樣本</h3>
          <div class="member-lock-sample-grid">
            ${[1, 2, 3, 4, 5, 6].map((item, index) => `
              <article>
                <b>#${item}</b>
                <strong>${["23••", "37••", "53••", "62••", "24••", "23••"][index]}</strong>
                <small>80+ / 高強度</small>
                <p>高強度訊號 · 量能放大 · 籌碼活躍</p>
              </article>
            `).join("")}
          </div>
        </section>
      </div>
    </div>
  `;
  overlay.querySelector("[data-member-login]")?.addEventListener("click", () => openAuthGate("login"));
  overlay.querySelector("[data-member-signup]")?.addEventListener("click", () => openAuthGate("signup"));
}

function applyMemberLocks(viewName = getActiveViewName(), activeLink = null) {
  const unlocked = isTerminalUnlocked();
  viewLinks.forEach((link) => {
    link.classList.toggle("member-locked-link", isProtectedView(link.dataset.view) && !unlocked);
  });
  Object.entries(viewPanels).forEach(([name, panel]) => {
    const locked = name === viewName && isProtectedView(name) && !unlocked;
    panel?.classList.toggle("member-locked-view", locked);
    if (locked) ensureMemberLock(panel, name, activeLink);
    else {
      panel?.querySelectorAll(".member-lock-overlay").forEach((overlay) => overlay.remove());
      panel?.querySelectorAll(".member-lock-host").forEach((host) => host.classList.remove("member-lock-host"));
    }
  });
  return isProtectedView(viewName) && !unlocked;
}

function normalizeAuthEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isAdminSession(session) {
  return FUMAN_ADMIN_EMAILS.has(normalizeAuthEmail(session?.user?.email));
}

async function ensureAccessRequest(session) {
  if (!session?.user) return { allowed: false, status: "signed_out" };
  const email = normalizeAuthEmail(session.user.email);
  if (isAdminSession(session)) return { allowed: true, status: "admin" };

  const { data, error } = await supabaseClient
    .from(FUMAN_ACCESS_TABLE)
    .select("status")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error && error.code !== "PGRST116") throw error;

  if (!data) {
    const { error: insertError } = await supabaseClient
      .from(FUMAN_ACCESS_TABLE)
      .insert({
        user_id: session.user.id,
        email,
        status: "pending",
      });
    if (insertError && insertError.code !== "23505") throw insertError;
    return { allowed: false, status: "pending" };
  }

  const status = String(data.status || "pending").toLowerCase();
  return {
    allowed: ["approved", "trial", "active"].includes(status),
    status,
  };
}

async function refreshTerminalAuthState(session) {
  let access = { allowed: false, status: "signed_out" };
  if (session?.user) {
    try {
      access = await ensureAccessRequest(session);
    } catch (error) {
      console.warn("Fuman access check failed", error);
      access = { allowed: false, status: "access_error" };
    }
  }

  setTerminalAuthState(session, access);
}

function getMemberStatusLabel(status) {
  const normalized = String(status || "signed_out").toLowerCase();
  if (normalized === "admin") return "管理者";
  if (["approved", "active"].includes(normalized)) return "VIP";
  if (normalized === "trial") return "試用會員";
  if (normalized === "pending") return "待審核";
  if (normalized === "blocked") return "已停權";
  return "未登入";
}

function setTerminalAuthState(session, access = { allowed: false, status: "signed_out" }) {
  const signedIn = Boolean(session?.user);
  const allowed = signedIn && access.allowed;
  document.body.classList.toggle("auth-ready", allowed);
  document.body.classList.toggle("auth-locked", !allowed);
  document.body.classList.remove("auth-pending");
  if (allowed) closeAuthGate();
  else if (authGate) authGate.setAttribute("aria-hidden", document.body.classList.contains("auth-login-open") ? "false" : "true");
  if (authSignout) authSignout.hidden = !signedIn || allowed;
  if (memberState) {
    const label = getMemberStatusLabel(access.status);
    memberState.textContent = `會員狀態：${label}`;
    memberState.dataset.status = String(access.status || "signed_out").toLowerCase();
  }
  if (authLogoutButton) {
    authLogoutButton.textContent = signedIn ? "登出" : "登入";
    authLogoutButton.setAttribute("aria-label", signedIn ? "登出" : "登入");
    authLogoutButton.dataset.authAction = signedIn ? "logout" : "login";
  }
  if (allowed) scheduleCommonTabWarmup();
  document.body.classList.remove("auth-cache-warm");
  writeFumanAuthCache(session, access);
  if (allowed) {
    setAuthMessage("登入成功，正在開啟終端。", "success");
  } else if (signedIn && access.status === "blocked") {
    setAuthMessage("此帳號尚未開通或已停權，請聯絡管理者。", "error");
  } else if (signedIn && access.status === "access_error") {
    setAuthMessage("權限資料尚未建立，請先完成 Supabase 開通資料表設定。", "error");
  } else if (signedIn) {
    setAuthMessage("試用申請已送出，等待管理者開通權限後才能查看完整終端。", "success");
  } else {
    setAuthMode(authMode);
  }
  applyMemberLocks();
}

async function initTerminalAuth() {
  warmFumanAuthFromCache();
  if (!authGate || !authForm) {
    document.body.classList.remove("auth-pending");
    document.body.classList.add("auth-ready");
    return;
  }

  if (!supabaseClient) {
    document.body.classList.remove("auth-pending");
    document.body.classList.add("auth-locked");
    setAuthMessage("Supabase 載入失敗，請重新整理後再試。", "error");
    return;
  }

  authModeButtons.forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
  });

  authPasswordToggle?.addEventListener("click", () => {
    if (!authPassword) return;
    const willShow = authPassword.type === "password";
    authPassword.type = willShow ? "text" : "password";
    authPasswordToggle.setAttribute("aria-label", willShow ? "隱藏密碼" : "顯示密碼");
    authPasswordToggle.setAttribute("aria-pressed", willShow ? "true" : "false");
    authPassword.focus();
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = authEmail?.value.trim();
    const password = authPassword?.value || "";
    if (!email || password.length < 6) {
      setAuthMessage("請輸入 Email，密碼至少 6 個字元。", "error");
      return;
    }

    if (authSubmit) authSubmit.disabled = true;
    setAuthMessage(authMode === "signup" ? "正在建立帳號..." : "正在登入...");
    try {
      const action = authMode === "signup"
        ? supabaseClient.auth.signUp({ email, password })
        : supabaseClient.auth.signInWithPassword({ email, password });
      const { data, error } = await action;
      if (error) throw error;
      if (authMode === "signup" && !data.session) {
        setAuthMessage("註冊完成。若 Supabase 要求信箱驗證，請先到 Email 點確認信；確認後登入會送出試用申請。", "success");
        return;
      }
      await refreshTerminalAuthState(data.session);
    } catch (error) {
      setAuthMessage(error?.message || "登入失敗，請確認帳號密碼。", "error");
    } finally {
      if (authSubmit) authSubmit.disabled = false;
    }
  });

  authLogoutButton?.addEventListener("click", async () => {
    if (!authLogoutButton.dataset.authAction || authLogoutButton.dataset.authAction === "login") {
      openAuthGate("login");
      return;
    }
    writeFumanAuthCache(null, null);
    await supabaseClient.auth.signOut();
    setTerminalAuthState(null);
    const marketLink = viewLinks.find((link) => link.dataset.view === "market");
    showView("market", marketLink);
  });

  authSignout?.addEventListener("click", async () => {
    writeFumanAuthCache(null, null);
    await supabaseClient.auth.signOut();
    setAuthMode("login");
    setTerminalAuthState(null);
  });

  const { data } = await supabaseClient.auth.getSession();
  await refreshTerminalAuthState(data?.session);
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    refreshTerminalAuthState(session);
  });
}

initTerminalAuth();
applyFumanDeviceMode();
installInteractionLatencyMonitor();

function installBasicDevtoolsGuard() {
  const blockedKeys = new Set(["F12"]);
  const showNotice = () => {
    if (document.querySelector(".security-notice")) return;
    const notice = document.createElement("div");
    notice.className = "security-notice";
    notice.textContent = "此終端禁止檢視開發者工具。";
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

function deferIdleWork(callback, timeout = 900) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(callback, { timeout });
  else deferUiWork(callback, Math.min(timeout, 180));
}

function isViewActive(name) {
  return Boolean(viewPanels[name]?.classList.contains("active"));
}

function titleWithIcon(icon, text) {
  return `<span class="page-title-icon">${icon}</span>${text}`;
}

const FUMAN_UI_CONFIG = window.FUMAN_UI_CONFIG || {};
const SCHEDULE_META = FUMAN_UI_CONFIG.SCHEDULE_META || {};
const WORKFLOW_BY_SCHEDULE = FUMAN_UI_CONFIG.WORKFLOW_BY_SCHEDULE || {};

const GITHUB_WORKFLOW_API = FUMAN_RUNTIME_CONFIG.githubWorkflowApi || "https://api.github.com/repos/ginova777-cmd/fuman-terminal/actions/workflows";
const MINI_PC_CACHE_SCHEDULES = new Set(FUMAN_RUNTIME_CONFIG.miniPcCacheSchedules || ["chip", "warrant"]);
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
  return "";
  const meta = SCHEDULE_META[key] || SCHEDULE_META.market;
  if (meta.next || !meta.times?.length) {
    return `<span class="schedule-status-pill"><span>● 每日 ${meta.label} 更新</span><span>● 預計下次更新：${meta.next || ""}</span></span>`;
  }
  const latestDue = latestDueScheduleTime(meta.times);
  const updatedAt = getScheduleUpdatedAt(key);
  if (MINI_PC_CACHE_SCHEDULES.has(key) && updatedAt) {
    const next = formatScheduleDate(nextScheduleTime(meta.times));
    return `<span class="schedule-status-pill"><span>● 已更新 ${formatScheduleDate(new Date(updatedAt))}</span><span>● 預計下次更新：${next}</span></span>`;
  }
  const hasSuccessfulUpdate = updatedAt && latestDue && updatedAt >= latestDue.getTime();
  if (hasSuccessfulUpdate) {
    const next = formatScheduleDate(nextScheduleTime(meta.times));
    return `<span class="schedule-status-pill"><span>● 每日 ${meta.label} 更新</span><span>● 預計下次更新：${next}</span></span>`;
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
  const isStale = latestDue && (!updatedAt || updatedAt < latestDue.getTime());
  if (isStale && MINI_PC_CACHE_SCHEDULES.has(key)) {
    return `<span class="schedule-status-pill schedule-failed"><span class="schedule-failed-dot">●</span><span>更新逾時，補跑中</span></span>`;
  }
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
  if (isViewActive("strategy") && canRunViewWork("strategy")) renderStrategyScanner();
}

async function loadWorkflowRunStatus() {
  workflowRunStatusReady = false;
  return;
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
  loadFumanStyle("terminal-utility.css", "mobile-watchlist-nav-order");
}

function installRealtimeRadarStyles() {
  loadFumanStyle("terminal-realtime-radar.css", "realtime-radar-styles");
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

function radarLowerShadowPct(stock) {
  const close = cleanNumber(stock.close);
  const open = cleanNumber(stock.open);
  const low = cleanNumber(stock.low);
  const bodyLow = Math.min(open || close, close || open);
  if (!bodyLow || !low || low >= bodyLow) return 0;
  return close ? ((bodyLow - low) / close) * 100 : 0;
}

function radarUpperShadowPct(stock) {
  const close = cleanNumber(stock.close);
  const open = cleanNumber(stock.open);
  const high = cleanNumber(stock.high);
  const bodyHigh = Math.max(open || close, close || open);
  if (!bodyHigh || !high || high <= bodyHigh) return 0;
  return close ? ((high - bodyHigh) / close) * 100 : 0;
}

function radarMarginChange(stock) {
  const daily = stock.swingDaily || {};
  const last = daily.last || {};
  const candidates = [
    stock.marginChange,
    stock.financingChange,
    stock.marginBalanceChange,
    stock.marginBuySell,
    stock.marginDiff,
    stock.creditChange,
    stock.marginTradingBalanceChange,
    stock.marginPurchase,
    stock.marginBuy,
    last.marginChange,
    last.financingChange,
    last.marginBalanceChange,
    last.marginDiff,
    last.creditChange,
    last.marginPurchase,
    last.marginBuy,
    last["融資增減"],
    last["融資買賣超"],
  ];
  for (const value of candidates) {
    const number = cleanNumber(value);
    if (number) return number;
  }
  return 0;
}

function radarShortMarginChange(stock) {
  const daily = stock.swingDaily || {};
  const last = daily.last || {};
  const candidates = [
    stock.shortMarginChange,
    stock.securitiesLendingChange,
    stock.marginShortChange,
    stock.shortSellChange,
    stock.shortBalanceChange,
    stock.lendingChange,
    last.shortMarginChange,
    last.securitiesLendingChange,
    last.marginShortChange,
    last.shortSellChange,
    last.shortBalanceChange,
    last.lendingChange,
    last["融券增減"],
    last["融券買賣超"],
  ];
  for (const value of candidates) {
    const number = cleanNumber(value);
    if (number) return number;
  }
  return 0;
}

function radarSignalTags(stock) {
  const tags = [];
  const volume = cleanNumber(stock.tradeVolume || stock.volume);
  const pct = cleanNumber(stock.pct ?? stock.percent);
  const value = cleanNumber(stock.value);
  const foreign = cleanNumber(stock.foreign);
  const trust = cleanNumber(stock.trust);
  const totalInst = cleanNumber(stock.totalInst);
  const close = cleanNumber(stock.close);
  const open = cleanNumber(stock.open);
  const daily = stock.swingDaily || analyzeSwingDaily(stock);
  const last = daily?.last;
  const prev = daily?.prev;
  const dailyRows = normalizeArray(daily?.rows);
  const priorRows = dailyRows.slice(0, -1);
  const volumeRatio = cleanNumber(stock.volumeRatio) || cleanNumber(daily?.volumeRatio);
  const bodyPct = open ? ((close - open) / open) * 100 : 0;
  const longRed = close && open && close > open && bodyPct >= 3;
  const longBlack = close && open && close < open && bodyPct <= -3;
  const shortWeak = close && open && close < open && bodyPct <= -1.5;
  const lowerShadowPct = radarLowerShadowPct({ ...stock, swingDaily: daily });
  const upperShadowPct = radarUpperShadowPct({ ...stock, swingDaily: daily });
  const marginChange = radarMarginChange({ ...stock, swingDaily: daily });
  const shortMarginChange = radarShortMarginChange({ ...stock, swingDaily: daily });
  const prevClose = cleanNumber(stock.prevClose) || (close - cleanNumber(stock.change));
  const limitDown = cleanNumber(stock.limitDown) || (prevClose ? prevClose * 0.9 : 0);
  const isNearLimitDown = limitDown && close <= limitDown * 1.005;
  const breaksHigh = (length) => {
    if (!close || priorRows.length < length) return false;
    const high = Math.max(...priorRows.slice(-length).map((row) => cleanNumber(row.high)).filter(Boolean));
    return high > 0 && close > high;
  };
  const breaksLow = (length) => {
    if (!close || priorRows.length < length) return false;
    const low = Math.min(...priorRows.slice(-length).map((row) => cleanNumber(row.low)).filter(Boolean));
    return low > 0 && close < low;
  };
  if (longRed) tags.push("長紅逾3%");
  if (lowerShadowPct >= 3) tags.push("長下影逾3%");
  if (upperShadowPct >= 3) tags.push("長上影逾3%");
  if (longBlack) tags.push("長黑逾3%");
  if (shortWeak) tags.push("長黑轉弱");
  if (close && daily?.ma5 && close > daily.ma5) tags.push("突破5日均");
  if (close && daily?.ma10 && close > daily.ma10) tags.push("突破10日均");
  if (close && daily?.ma20 && close > daily.ma20) tags.push("突破20日均");
  if (close && daily?.ma60 && close > daily.ma60) tags.push("突破60日均");
  if (close && daily?.ma5 && close < daily.ma5) tags.push("跌破5日均");
  if (close && daily?.ma10 && close < daily.ma10) tags.push("跌破10日均");
  if (close && daily?.ma20 && close < daily.ma20) tags.push("跌破20日均");
  if (close && daily?.ma60 && close < daily.ma60) tags.push("跌破60日均");
  if (breaksHigh(10)) tags.push("突破10日高");
  if (breaksHigh(20)) tags.push("突破20日高");
  if (breaksHigh(60)) tags.push("突破60日高");
  if (breaksHigh(120)) tags.push("突破120日高");
  if (breaksLow(10)) tags.push("跌破10日低");
  if (breaksLow(20)) tags.push("跌破20日低");
  if (breaksLow(60)) tags.push("跌破60日低");
  if (breaksLow(120)) tags.push("跌破120日低");
  if (pct >= 0 && volumeRatio >= 2) tags.push("量增2倍");
  else if (pct >= 0 && volumeRatio >= 1.5) tags.push("量增1.5倍");
  if (pct < 0 && volumeRatio >= 2) tags.push("量增2倍");
  else if (pct < 0 && volumeRatio >= 1.5) tags.push("量增1.5倍");
  if ((pct > 0 && (value >= 1000000000 || (volume >= 5000 && pct >= 1.2))) || (pct < 0 && (value >= 1000000000 || (volume >= 5000 && pct <= -1.2)))) tags.push("即時爆量");
  if (pct >= 3) tags.push("短線急拉");
  if (foreign >= 1000) tags.push("外資買超");
  if (totalInst >= 1000) tags.push("三大法人買超");
  if (pct >= 1.5 && volume >= INTRADAY_MIN_VOLUME) tags.push("短線強勢");
  if (trust >= 500) tags.push("投信買超");
  if (marginChange > 0) tags.push("融資增加");
  if (shortMarginChange > 0) tags.push("融券增加");
  if (pct <= -3) tags.push("急殺");
  if (isNearLimitDown || pct <= -9.5) tags.push("接近跌停");
  if (foreign <= -1000) tags.push("外資賣超");
  if (totalInst <= -1000) tags.push("三大法人賣超");
  if (trust <= -500) tags.push("投信賣超");
  if (pct <= -1.5 && volume >= INTRADAY_MIN_VOLUME) tags.push("短線轉弱");
  if (prev?.high && close > prev.high) tags.push("突破昨日高");
  return [...new Set(tags)];
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

function hasRealtimeRadarQuote(stock) {
  const code = String(stock?.code || "");
  const quote = strategyRealtimeQuotes[code];
  return isRealtimeRadarUsableQuote(quote);
}

function realtimeRadarDateKeyFromTimestamp(timestamp) {
  const value = cleanNumber(timestamp);
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function realtimeRadarTimeSeconds(value) {
  const parts = String(value || "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!parts) return 0;
  return Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3] || 0);
}

function isRealtimeRadarQuoteTime(quote) {
  const seconds = realtimeRadarTimeSeconds(quote?.time);
  return seconds >= 9 * 3600 && seconds <= (13 * 3600 + 30 * 60);
}

function isRealtimeRadarUsableQuote(quote) {
  if (!quote?.close || !quote?.time) return false;
  if (!isRealtimeRadarQuoteTime(quote)) return false;
  const updatedAt = cleanNumber(quote.updatedAt);
  if (updatedAt && realtimeRadarDateKeyFromTimestamp(updatedAt) !== marketAiTodayKey()) return false;
  if (isRadarDetectionWindow() && (!updatedAt || Date.now() - updatedAt > Math.max(REALTIME_RADAR_REFRESH_MS * 4, 15000))) return false;
  return true;
}

function isRealtimeRadarTodaySnapshot(stock) {
  const rowDate = normalizeMarketAiDateKey(stock?.radarDate || stock?.quoteDate || stock?.tradeDate);
  if (rowDate && rowDate !== marketAiTodayKey()) return false;
  const updatedAt = cleanNumber(stock?.radarUpdatedAt);
  return updatedAt > 0 && realtimeRadarDateKeyFromTimestamp(updatedAt) === marketAiTodayKey();
}

function getStrategy3CachedVolumeRatio(code) {
  const item = strategy3Data.find((stock) => String(stock.code || "") === String(code || ""));
  if (!item) return 0;
  return cleanNumber(item.volumeRatio || item.VolumeRatio || item.volume_ratio || item["量比"]);
}

function requestRealtimeRadarVolumeRatio(stock) {
  const code = String(stock?.code || "").replace(/\D/g, "").slice(0, 4);
  if (!shouldRunLivePolling() || !/^\d{4}$/.test(code) || realtimeRadarHistoryPromise || realtimeRadarVolumeRatioRequestedCodes.has(code) || hasStrategyHistoryRows(code)) return;
  realtimeRadarVolumeRatioRequestedCodes.add(code);
  loadRealtimeRadarHistory([{ ...stock, code }], { force: true }).then((loaded) => {
    if (!loaded) {
      realtimeRadarVolumeRatioRequestedCodes.delete(code);
      return;
    }
    enrichRealtimeRadarSnapshotRows(realtimeRadarLastRows);
    if (isViewActive("realtime-radar")) renderRealtimeRadar();
  });
}

function radarVolumeRatio(stock) {
  const cachedRatio = cleanNumber(stock.volumeRatio || stock.VolumeRatio || stock.volume_ratio || stock["量比"]) || getStrategy3CachedVolumeRatio(stock.code);
  if (cachedRatio > 0) return cachedRatio;
  const daily = stock.swingDaily || analyzeSwingDaily(stock);
  const rows = normalizeArray(daily?.rows);
  const currentVolume = normalizeTradeVolumeLots(stock.volume || stock.tradeVolume);
  const priorVolumes = rows.slice(-21, -1).map((row) => normalizeTradeVolumeLots(row.volume)).filter((value) => value > 0);
  const averageVolume = avg(priorVolumes);
  if (currentVolume && averageVolume) {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const open = 9 * 60;
    const close = 13 * 60 + 30;
    const elapsedRatio = clamp((minutes - open) / (close - open), 0.05, 1);
    return (currentVolume / elapsedRatio) / averageVolume;
  }
  const ratio = cleanNumber(daily?.volumeRatio);
  return ratio > 0 ? ratio : 0;
}

function enrichRealtimeRadarSnapshotRows(rows = []) {
  let changed = false;
  const enriched = normalizeArray(rows).map((stock) => {
    const daily = stock.swingDaily || analyzeSwingDaily(stock);
    const volumeRatio = cleanNumber(stock.volumeRatio) || radarVolumeRatio({ ...stock, swingDaily: daily });
    const signalTags = daily
      ? radarSignalTags({
          ...stock,
          pct: cleanNumber(stock.pct ?? stock.percent),
          value: cleanNumber(stock.value),
          volume: cleanNumber(stock.volume || stock.tradeVolume),
          volumeRatio,
          swingDaily: daily,
        })
      : stock.signalTags;
    if (volumeRatio && volumeRatio !== cleanNumber(stock.volumeRatio)) changed = true;
    if (signalTags?.length && signalTags.join("|") !== normalizeArray(stock.signalTags).join("|")) changed = true;
    return {
      ...stock,
      swingDaily: daily || stock.swingDaily,
      volumeRatio: volumeRatio || stock.volumeRatio,
      signalTags: signalTags?.length ? signalTags : stock.signalTags,
    };
  });
  if (changed) {
    realtimeRadarLastRows = enriched;
    saveRealtimeRadarLastRows(realtimeRadarLastRows);
  }
  return enriched;
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
  const baseScore = tagScore + moveScore + valueScore + volumeScore + instScore - 42;
  return Math.max(1, Math.min(100, Math.round(baseScore * strategyWeight("radarMultiplier"))));
}

function isRealtimeRadarLimitUp(stock) {
  const close = cleanNumber(stock.close);
  const pct = cleanNumber(stock.percent ?? stock.pct);
  const prevClose = cleanNumber(stock.prevClose) || (close - cleanNumber(stock.change));
  const limitUp = cleanNumber(stock.limitUp) || (prevClose ? prevClose * 1.1 : 0);
  if (limitUp && close >= limitUp * 0.995) return true;
  return pct >= 9.7;
}

function realtimeRadarDataDateKey(rows = realtimeRadarLastRows) {
  const counts = new Map();
  normalizeArray(rows).forEach((row) => {
    const key = normalizeMarketAiDateKey(row?.radarDate)
      || realtimeRadarDateKeyFromTimestamp(cleanNumber(row?.radarUpdatedAt || row?.detectedAt || row?.updatedAt))
      || normalizeMarketAiDateKey(row?.signalDate);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function realtimeRadarClosedDataDateKey() {
  return realtimeRadarDataDateKey(realtimeRadarLastRows)
    || normalizeMarketAiDateKey(marketStockDataState.resolvedTradeDate)
    || marketAiDataDateKey(latestStocks)
    || marketAiTodayKey();
}

function realtimeRadarModeText(radarOpen = isRadarDetectionWindow()) {
  if (radarOpen) return "盤中即時巡邏";
  const dateKey = realtimeRadarClosedDataDateKey();
  return dateKey === marketAiTodayKey() ? "收盤資料" : "最新可用收盤資料";
}

function realtimeRadarModeNote(radarOpen = isRadarDetectionWindow(), count = 0) {
  const mode = realtimeRadarModeText(radarOpen);
  if (radarOpen) return `${radarSessionTimeLabel()} · 最新盤中訊號 ${count} 則`;
  return `${mode} · 資料日期 ${formatMarketAiDateKey(realtimeRadarClosedDataDateKey())} · 訊號 ${count} 則`;
}

function isRealtimeRadarClosedStockUsable(stock) {
  if (!stock) return false;
  if (isMarketAiStaleStock(stock)) return false;
  const close = cleanNumber(stock.close);
  const pct = cleanNumber(stock.percent ?? stock.pct);
  const value = radarStockValue(stock);
  return close > 0 && Number.isFinite(pct) && value > 0;
}

function buildRealtimeRadarRows(options = {}) {
  const requireRealtime = options.mode !== "closed";
  const radarPool = latestStocks
    .map((stock) => requireRealtime ? applyStrategyQuote(stock) : stock)
    .filter((stock) => requireRealtime ? hasRealtimeRadarQuote(stock) : isRealtimeRadarClosedStockUsable(stock))
    .filter((stock) => isIntradayTradable(stock))
    .filter((stock) => !isRealtimeRadarLimitUp(stock));
  const shortPressurePool = [...radarPool]
    .filter((stock) => {
      const live = requireRealtime ? applyStrategyQuote(stock) : stock;
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
    ...getIntradayCandidateStocks(radarPool),
    ...getBaseStrongIntradayStocks(radarPool),
    ...shortPressurePool,
    ...[...radarPool].sort((a, b) => getIntradayHotScore(b) - getIntradayHotScore(a)),
  ]).slice(0, REALTIME_RADAR_POOL_LIMIT);
  return rankedIntradayPool
    .map((stock) => {
      const live = requireRealtime ? applyStrategyQuote(stock) : stock;
      const inst = getInstitutionTotal(live.code);
      const pct = cleanNumber(live.percent);
      const value = radarStockValue(live);
      const volume = cleanNumber(live.tradeVolume || live.volume);
      const totalInst = cleanNumber(inst.total);
      const trust = cleanNumber(inst.trust);
      const foreign = cleanNumber(inst.foreign);
      const daily = live.swingDaily || analyzeSwingDaily(live);
      const marginChange = radarMarginChange({ ...live, swingDaily: daily });
      const shortMarginChange = radarShortMarginChange({ ...live, swingDaily: daily });
      const upperShadowPct = radarUpperShadowPct({ ...live, swingDaily: daily });
      const lowerShadowPct = radarLowerShadowPct({ ...live, swingDaily: daily });
      const volumeRatio = radarVolumeRatio({ ...live, volume, swingDaily: daily });
      const signalTags = radarSignalTags({ ...live, pct, value, volume, volumeRatio, foreign, trust, totalInst, marginChange, shortMarginChange, swingDaily: daily });
      const hasLongTag = signalTags.some((tag) => /突破|長紅|長下影|量增|買超|強勢|急拉|融資增加/.test(tag));
      const hasShortTag = signalTags.some((tag) => /跌破|長上影|急殺|賣超|轉弱|長黑|接近跌停|融券增加/.test(tag));
      const hasLongSignal =
        hasLongTag ||
        lowerShadowPct >= 3 ||
        marginChange > 0 ||
        pct >= 3 ||
        (pct >= 1.5 && volume >= INTRADAY_MIN_VOLUME) ||
        (value >= 1000000000 && pct > 0) ||
        (volume >= 5000 && pct >= 1.2) ||
        (foreign >= 1000 && pct >= 0) ||
        (trust >= 500 && pct >= 0);
      const hasShortSignal =
        hasShortTag ||
        upperShadowPct >= 3 ||
        shortMarginChange > 0 ||
        (signalTags.some((tag) => /量增|即時爆量/.test(tag)) && pct < 0) ||
        pct <= -3 ||
        (pct <= -1.5 && volume >= INTRADAY_MIN_VOLUME) ||
        (value >= 1000000000 && pct < 0) ||
        (volume >= 5000 && pct <= -1.2) ||
        (foreign <= -1000 && pct <= 0.8) ||
        (trust <= -500 && pct <= 0.8);
      const side = hasLongSignal && (!hasShortSignal || pct >= 0) ? "long" : hasShortSignal ? "short" : "";
      const score = radarSignalScore({ ...live, pct, value, volume, foreign, trust, signalTags });
      const flow = radarFlowValue({ ...live, pct, value, volume, foreign, trust, signalTags });
      const radarUpdatedAt = requireRealtime
        ? cleanNumber(strategyRealtimeQuotes[live.code]?.updatedAt) || strategyLastScanAt || Date.now()
        : cleanNumber(live.quoteUpdatedAt || live.updatedAt) || Date.now();
      return {
        ...live,
        pct,
        value,
        volume,
        side,
        score,
        flow,
        volumeRatio,
        trust,
        foreign,
        totalInst,
        marginChange,
        shortMarginChange,
        swingDaily: daily,
        signalTags,
        radarUpdatedAt,
        radarMode: requireRealtime ? "intraday" : "closed",
        radarDate: requireRealtime ? marketAiTodayKey() : realtimeRadarClosedDataDateKey(),
      };
    })
    .filter((stock) => stock.value > 0 && stock.side && stock.signalTags.length)
    .sort((a, b) => b.score - a.score || b.value - a.value);
}

function realtimeRadarTimestampFromIntradayTime(timeText, dateText = "") {
  const time = String(timeText || "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!time) return Date.now();
  const dateKey = normalizeMarketAiDateKey(dateText) || marketAiTodayKey();
  const yyyy = dateKey.slice(0, 4);
  const mm = dateKey.slice(4, 6);
  const dd = dateKey.slice(6, 8);
  const timestamp = Date.parse(`${yyyy}-${mm}-${dd}T${String(time[1]).padStart(2, "0")}:${time[2]}:${time[3] || "00"}+08:00`);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function buildRealtimeRadarRowsFromStrategy2Cache() {
  const stockByCode = new Map(latestStocks.map((stock) => [String(stock.code || ""), stock]));
  return [...strategy2IntradayEventByCode.values()]
    .map((event) => {
      const code = String(event?.code || "");
      if (!/^\d{4}$/.test(code)) return null;
      const base = stockByCode.get(code) || {};
      const quote = strategyRealtimeQuotes[code];
      const live = quote?.close ? applyStrategyQuote({ ...base, code, name: event.name || base.name }) : { ...base, code, name: event.name || base.name };
      const latestEnhancement = normalizeArray(event.enhancements)
        .filter((item) => isIntradayVisibleTimeText(item?.at))
        .sort((a, b) => intradayTimeToValue(b.at) - intradayTimeToValue(a.at))[0] || {};
      const latestTime = event.latestSeenAt || event.latestAAt || latestEnhancement.at || event.firstAAt || event.firstBAt || quote?.time || "";
      const close = cleanNumber(live.close) || cleanNumber(event.latestSeenPrice || event.latestAPrice || latestEnhancement.price || event.firstAPrice || event.firstBPrice);
      const firstPrice = cleanNumber(event.firstAPrice || event.firstBPrice || event.firstSeenPrice);
      const volume = normalizeTradeVolumeLots(live.tradeVolume || live.volume || latestEnhancement.totalVolume);
      const value = radarStockValue({ ...live, close, volume }) || estimateTradeValue(close, volume);
      const pct = Number.isFinite(cleanNumber(live.percent)) && cleanNumber(live.percent)
        ? cleanNumber(live.percent)
        : firstPrice ? ((close - firstPrice) / firstPrice) * 100 : 0;
      const inst = getInstitutionTotal(code);
      const trust = cleanNumber(inst.trust);
      const foreign = cleanNumber(inst.foreign);
      const totalInst = cleanNumber(inst.total);
      const side = pct < 0 ? "short" : "long";
      const strategyTags = normalizeArray(event.strategies).slice(0, 4);
      const enhancementTags = latestEnhancement.strategy ? [latestEnhancement.strategy] : [];
      const signalTags = [...new Set([...strategyTags, ...enhancementTags, side === "short" ? "短線轉弱" : "短線強勢"])];
      const score = Math.max(1, Math.min(100, cleanNumber(event.maxScore || latestEnhancement.score) || radarSignalScore({ ...live, pct, value, volume, foreign, trust, signalTags })));
      return {
        ...live,
        code,
        name: event.name || live.name || code,
        close,
        pct,
        percent: pct,
        value,
        volume,
        tradeVolume: volume,
        side,
        score,
        flow: radarFlowValue({ ...live, pct, value, volume, foreign, trust, signalTags }),
        volumeRatio: cleanNumber(live.volumeRatio),
        trust,
        foreign,
        totalInst,
        marginChange: 0,
        shortMarginChange: 0,
        signalTags,
        radarUpdatedAt: realtimeRadarTimestampFromIntradayTime(latestTime, event.date),
        radarMode: "intraday",
        radarDate: normalizeMarketAiDateKey(event.date) || marketAiTodayKey(),
        strategy2Event: event,
      };
    })
    .filter((stock) => stock?.close > 0 && stock.side)
    .sort((a, b) => cleanNumber(b.radarUpdatedAt) - cleanNumber(a.radarUpdatedAt) || cleanNumber(b.score) - cleanNumber(a.score));
}

function radarReasonTags(stock) {
  return (stock.signalTags?.length ? stock.signalTags : [stock.side === "long" ? "短線強勢" : "短線轉弱"]).slice(0, 4);
}

function radarTechnicalTags(stock) {
  const tags = normalizeArray(stock.signalTags)
    .filter((tag) => !/法人|外資|投信|買超|賣超|融資|融券/.test(tag));
  const fallback = stock.side === "short" ? "短線轉弱" : "短線強勢";
  return (tags.length ? tags : [fallback]).slice(0, 5);
}

function radarChipTags(stock) {
  const tags = normalizeArray(stock.signalTags)
    .filter((tag) => /法人|外資|投信|買超|賣超|融資|融券/.test(tag));
  if (stock.side === "short") {
    if (stock.totalInst < 0) tags.push("三大法人賣超");
    if (stock.foreign < 0) tags.push("外資賣超");
    if (stock.trust < 0) tags.push("投信賣超");
    if (stock.shortMarginChange > 0) tags.push("融券增加");
  } else {
    if (stock.totalInst > 0) tags.push("三大法人買超");
    if (stock.foreign > 0) tags.push("外資買超");
    if (stock.trust > 0) tags.push("投信買超");
    if (stock.marginChange > 0) tags.push("融資增加");
  }
  return [...new Set(tags)].slice(0, 5);
}

function taipeiClockParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function radarSessionTimeLabel() {
  const date = new Date();
  const parts = taipeiClockParts(date);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (minutes < 9 * 60) return "09:00:00";
  if (minutes > 13 * 60 + 30) return "13:30:00";
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

function isRadarDetectionWindow() {
  const parts = taipeiClockParts();
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
}

function isRealtimeRadarFresh() {
  if (!isRadarDetectionWindow()) return true;
  return strategyLastScanAt && Date.now() - strategyLastScanAt <= Math.max(REALTIME_RADAR_REFRESH_MS * 2, 8000);
}

function latestRealtimeRadarSignalAt(rows = realtimeRadarLastRows) {
  return normalizeArray(rows).reduce((latest, stock) => Math.max(latest, cleanNumber(stock?.radarUpdatedAt)), 0);
}

function realtimeRadarSignalTimeText(timestamp, options = {}) {
  const value = cleanNumber(timestamp);
  if (!value) return "";
  return new Date(value).toLocaleTimeString("zh-TW", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: options.seconds === false ? undefined : "2-digit",
  });
}

function isRealtimeRadarSignalStale(rows = realtimeRadarLastRows) {
  if (!isRadarDetectionWindow()) return false;
  const latest = latestRealtimeRadarSignalAt(rows);
  if (!latest) return false;
  return Date.now() - latest > Math.max(REALTIME_RADAR_REFRESH_MS * 2, 15000);
}

function isIntradayScanWindow() {
  return isRadarDetectionWindow();
}

function isKnownNonTradingMarketDate() {
  const today = normalizeMarketAiDateKey(marketStockDataState.today) || marketAiTodayKey();
  const dataDate = normalizeMarketAiDateKey(marketStockDataState.resolvedTradeDate)
    || marketAiDataDateKey(latestStocks);
  return Boolean(today && dataDate && dataDate !== today && marketStockDataState.isFallbackDate);
}

function shouldRunLivePolling() {
  return isIntradayScanWindow()
    && marketRealtimeState.trading === true
    && marketRealtimeState.marketStatus === "day"
    && !isKnownNonTradingMarketDate();
}

function getMarketRefreshInterval() {
  if (isDocumentHidden()) return MARKET_REFRESH_HIDDEN_MS;
  return shouldRunLivePolling() ? MARKET_REFRESH_LIVE_MS : MARKET_REFRESH_CLOSED_MS;
}

function getMarketHeatmapRefreshInterval() {
  if (isDocumentHidden()) return MARKET_REFRESH_HIDDEN_MS;
  return shouldRunLivePolling() ? MARKET_REFRESH_LIVE_MS : MARKET_HEATMAP_CLOSED_MS;
}

function saveRealtimeRadarLastRows(rows) {
  try {
    const today = marketAiTodayKey();
    const safeRows = normalizeArray(rows)
      .filter((stock) => isIntradayTradable(stock))
      .filter((stock) => isRealtimeRadarTodaySnapshot({ ...stock, radarDate: stock.radarDate || today }));
    if (!safeRows.length) return;
    const payload = {
      updatedAt: Date.now(),
      date: today,
      rows: safeRows.slice(0, 80).map((stock) => ({
        code: stock.code,
        name: stock.name,
        close: stock.close,
        pct: stock.pct,
        percent: stock.percent,
        value: stock.value,
        volume: stock.volume,
        tradeVolume: stock.tradeVolume,
        volumeRatio: stock.volumeRatio,
        side: stock.side,
        score: stock.score,
        flow: stock.flow,
        trust: stock.trust,
        foreign: stock.foreign,
        totalInst: stock.totalInst,
        signalTags: stock.signalTags,
        radarUpdatedAt: stock.radarUpdatedAt,
        radarDate: today,
      })),
    };
    localStorage.setItem(REALTIME_RADAR_LAST_CACHE_KEY, JSON.stringify(payload));
  } catch (error) {}
}

function mergeRealtimeRadarRows(newRows = [], oldRows = []) {
  const merged = new Map();
  [...normalizeArray(newRows), ...normalizeArray(oldRows)].forEach((stock) => {
    if (!stock?.code || !stock.side) return;
    if (!isIntradayTradable(stock)) return;
    const key = `${stock.side}:${stock.code}`;
    const existing = merged.get(key);
    const currentTime = cleanNumber(stock.radarUpdatedAt) || 0;
    const existingTime = cleanNumber(existing?.radarUpdatedAt) || 0;
    const currentScore = cleanNumber(stock.score);
    const existingScore = cleanNumber(existing?.score);
    const sameSignalWindow = existing && currentTime && existingTime && Math.abs(currentTime - existingTime) < 10000;
    if (sameSignalWindow && Math.abs(currentScore - existingScore) < 8) {
      merged.set(key, {
        ...existing,
        ...stock,
        score: Math.max(existingScore, currentScore),
        flow: Math.max(cleanNumber(existing.flow), cleanNumber(stock.flow)),
        radarUpdatedAt: Math.max(existingTime, currentTime),
        signalTags: [...new Set([...normalizeArray(existing.signalTags), ...normalizeArray(stock.signalTags)])].slice(0, 6),
        denoised: true,
      });
      return;
    }
    if (!existing || currentTime >= existingTime) {
      merged.set(key, { ...stock, radarUpdatedAt: currentTime || Date.now() });
    }
  });
  return [...merged.values()]
    .sort((a, b) => (cleanNumber(b.radarUpdatedAt) - cleanNumber(a.radarUpdatedAt)) || cleanNumber(b.score) - cleanNumber(a.score))
    .slice(0, 120);
}

function hydrateRealtimeRadarDisplayRows(rows = []) {
  return normalizeArray(rows).map((stock) => {
    const quote = strategyRealtimeQuotes[String(stock?.code || "")];
    if (!isRealtimeRadarUsableQuote(quote)) return stock;
    const live = applyStrategyQuote(stock);
    if (isRealtimeRadarLimitUp(live)) return null;
    const inst = getInstitutionTotal(live.code);
    const pct = cleanNumber(live.percent ?? live.pct);
    const volume = normalizeTradeVolumeLots(live.tradeVolume || live.volume);
    const value = radarStockValue({ ...live, volume });
    const totalInst = cleanNumber(inst.total);
    const trust = cleanNumber(inst.trust);
    const foreign = cleanNumber(inst.foreign);
    const daily = live.swingDaily || stock.swingDaily || analyzeSwingDaily(live);
    const marginChange = radarMarginChange({ ...live, swingDaily: daily });
    const shortMarginChange = radarShortMarginChange({ ...live, swingDaily: daily });
    const upperShadowPct = radarUpperShadowPct({ ...live, swingDaily: daily });
    const lowerShadowPct = radarLowerShadowPct({ ...live, swingDaily: daily });
    const volumeRatio = radarVolumeRatio({ ...live, volume, swingDaily: daily });
    const signalTags = radarSignalTags({ ...live, pct, value, volume, volumeRatio, foreign, trust, totalInst, marginChange, shortMarginChange, swingDaily: daily });
    const hasLongTag = signalTags.some((tag) => /突破|長紅|長下影|量增|買超|強勢|急拉|融資增加/.test(tag));
    const hasShortTag = signalTags.some((tag) => /跌破|長上影|急殺|賣超|轉弱|長黑|接近跌停|融券增加/.test(tag));
    const hasLongSignal =
      hasLongTag ||
      lowerShadowPct >= 3 ||
      marginChange > 0 ||
      pct >= 3 ||
      (pct >= 1.5 && volume >= INTRADAY_MIN_VOLUME) ||
      (value >= 1000000000 && pct > 0) ||
      (volume >= 5000 && pct >= 1.2) ||
      (foreign >= 1000 && pct >= 0) ||
      (trust >= 500 && pct >= 0);
    const hasShortSignal =
      hasShortTag ||
      upperShadowPct >= 3 ||
      shortMarginChange > 0 ||
      (signalTags.some((tag) => /量增|即時爆量/.test(tag)) && pct < 0) ||
      pct <= -3 ||
      (pct <= -1.5 && volume >= INTRADAY_MIN_VOLUME) ||
      (value >= 1000000000 && pct < 0) ||
      (volume >= 5000 && pct <= -1.2) ||
      (foreign <= -1000 && pct <= 0.8) ||
      (trust <= -500 && pct <= 0.8);
    const side = hasLongSignal && (!hasShortSignal || pct >= 0) ? "long" : hasShortSignal ? "short" : "";
    if (!side || !signalTags.length) return null;
    const score = radarSignalScore({ ...live, pct, value, volume, foreign, trust, signalTags });
    const flow = radarFlowValue({ ...live, pct, value, volume, foreign, trust, signalTags });
    const radarUpdatedAt = Math.max(cleanNumber(stock.radarUpdatedAt), cleanNumber(live.quoteUpdatedAt), cleanNumber(quote.updatedAt));
    return {
      ...stock,
      ...live,
      pct,
      percent: pct,
      volume: volume || stock.volume,
      tradeVolume: volume || stock.tradeVolume,
      value: value || stock.value,
      side,
      score,
      flow,
      volumeRatio,
      trust,
      foreign,
      totalInst,
      marginChange,
      shortMarginChange,
      swingDaily: daily,
      signalTags,
      radarUpdatedAt: radarUpdatedAt || stock.radarUpdatedAt,
    };
  }).filter(Boolean);
}

function recentRealtimeRadarDisplayRows(rows = [], radarOpen = isRadarDetectionWindow()) {
  const hydrated = hydrateRealtimeRadarDisplayRows(rows)
    .filter((stock) => isIntradayTradable(stock))
    .filter((stock) => !radarOpen || isRealtimeRadarTodaySnapshot({ ...stock, radarDate: stock.radarDate || marketAiTodayKey() }));
  if (!radarOpen) return hydrated;
  const latest = latestRealtimeRadarSignalAt(hydrated);
  if (!latest) return hydrated;
  const cutoff = Math.max(Date.now() - Math.max(REALTIME_RADAR_REFRESH_MS * 25, 75000), latest - Math.max(REALTIME_RADAR_REFRESH_MS * 12, 45000));
  const freshRows = hydrated.filter((stock) => cleanNumber(stock.radarUpdatedAt) >= cutoff);
  return freshRows.length ? freshRows : hydrated;
}

function switchRealtimeRadarSide(sideInput = "long") {
  const side = sideInput === "short" ? "short" : "long";
  realtimeRadarSide = side;
  const panel = viewPanels["realtime-radar"];
  const board = panel?.querySelector(".radar-board-list");
  const cachedMarkup = realtimeRadarBoardMarkupCache[side] || `<div class="empty-state">目前沒有${side === "short" ? "空方" : "多方"}訊號</div>`;
  if (!panel || !board) {
    realtimeRadarManualSideSwitch = true;
    renderRealtimeRadar();
    return;
  }
  panel.querySelectorAll("[data-radar-side]").forEach((button) => {
    const isActive = button.dataset.radarSide === side;
    button.classList.toggle("active", isActive);
    button.classList.toggle("short-active", isActive && side === "short");
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  board.innerHTML = cachedMarkup;
  realtimeRadarManualSideSwitch = false;
}
window.switchRealtimeRadarSide = switchRealtimeRadarSide;

function realtimeRadarRowsSignature(rows = []) {
  return normalizeArray(rows)
    .slice(0, 80)
    .map((stock) => `${stock.side}:${stock.code}:${Math.round(cleanNumber(stock.score))}:${cleanNumber(stock.radarUpdatedAt)}`)
    .join("|");
}

function patchRealtimeRadarBoard(activeSide, boardMarkup, displayRows) {
  const panel = viewPanels["realtime-radar"];
  const board = panel?.querySelector(".radar-board-list");
  if (!panel || !board) return false;
  panel.querySelectorAll("[data-radar-side]").forEach((button) => {
    const isActive = button.dataset.radarSide === activeSide;
    button.classList.toggle("active", isActive);
    button.classList.toggle("short-active", isActive && activeSide === "short");
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  board.innerHTML = boardMarkup;
  const small = panel.querySelector(".radar-topbar small");
  const latest = latestRealtimeRadarSignalAt(displayRows);
  if (small && latest) {
    small.textContent = `偵測時間 09:00-13:30｜盤中即時巡邏｜最新訊號 ${realtimeRadarSignalTimeText(latest)}｜${realtimeRadarFreshnessText()}`;
  }
  return true;
}

function shouldRefreshRealtimeRadarRemoteCache(radarOpen = shouldRunLivePolling()) {
  if (radarOpen) return !realtimeRadarCacheLoadedAt || Date.now() - realtimeRadarCacheLoadedAt >= REALTIME_RADAR_REFRESH_MS;
  if (isKnownNonTradingMarketDate()) return false;
  if (!realtimeRadarLastRows.length) return true;
  if (!realtimeRadarCacheLoadedAt) return true;
  const rowDate = realtimeRadarDataDateKey(realtimeRadarLastRows);
  if (rowDate && rowDate !== marketAiTodayKey()) return true;
  const latest = latestRealtimeRadarSignalAt(realtimeRadarLastRows);
  if (!latest || realtimeRadarDateKeyFromTimestamp(latest) !== marketAiTodayKey()) return true;
  return Date.now() - realtimeRadarCacheLoadedAt >= Math.max(REALTIME_RADAR_REFRESH_MS * 12, 60000);
}

function loadRealtimeRadarLastRows() {
  try {
    localStorage.removeItem("fuman_realtime_radar_last_rows_v1");
    const payload = JSON.parse(localStorage.getItem(REALTIME_RADAR_LAST_CACHE_KEY) || "{}");
    if (!Array.isArray(payload.rows) || !payload.rows.length) return false;
    const payloadDate = normalizeMarketAiDateKey(payload.date) || realtimeRadarDateKeyFromTimestamp(payload.updatedAt);
    if (payloadDate && payloadDate !== marketAiTodayKey() && shouldRunLivePolling()) return false;
    realtimeRadarLastRows = payload.rows
      .filter((stock) => isIntradayTradable(stock))
      .filter((stock) => isRealtimeRadarTodaySnapshot({ ...stock, radarDate: stock.radarDate || payloadDate }));
    if (!realtimeRadarLastRows.length) return false;
    realtimeRadarLastUpdatedAt = cleanNumber(payload.updatedAt) || Date.now();
    realtimeRadarCacheSource = "localStorage";
    realtimeRadarCacheSourceStatus = "fallback";
    return true;
  } catch (error) {
    return false;
  }
}

function realtimeRadarPayloadUpdatedAt(payload) {
  return cleanNumber(payload?.updatedAtMs)
    || Date.parse(payload?.updatedAt || payload?.timestamp || "")
    || cleanNumber(payload?.updatedAt)
    || 0;
}

function normalizeRealtimeRadarPayloadCandidate(candidate) {
  const payload = candidate?.payload;
  const payloadDate = normalizeMarketAiDateKey(payload?.date || payload?.updatedAt);
  const rows = normalizeArray(payload?.rows);
  const requireToday = shouldRunLivePolling() || !isKnownNonTradingMarketDate();
  if ((payloadDate !== marketAiTodayKey() && requireToday) || !rows.length) return null;
  return {
    ...candidate,
    payloadDate,
    rows,
    updatedAt: realtimeRadarPayloadUpdatedAt(payload) || Date.now(),
  };
}

async function loadRealtimeRadarLatestCache(force = false) {
  if (realtimeRadarCacheLoading) return false;
  if (!force && realtimeRadarCacheLoadedAt && Date.now() - realtimeRadarCacheLoadedAt < REALTIME_RADAR_REFRESH_MS) return false;
  realtimeRadarCacheLoading = true;
  try {
    const candidates = [];
    const errors = [];
    const allowSupabase = shouldRunLivePolling() || !isKnownNonTradingMarketDate();
    const restPayload = allowSupabase ? await fetchSupabaseLatestPayload("fuman_realtime_radar_cache", isMobileViewport() ? 3000 : 4500) : null;
    if (restPayload) {
      candidates.push({
        source: "supabase",
        payload: restPayload,
      });
    } else if (allowSupabase && supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from("fuman_realtime_radar_cache")
          .select("payload,updated_at")
          .eq("id", "latest")
          .maybeSingle();
        if (error) errors.push("Supabase 讀取失敗");
        if (!error && data?.payload) {
          candidates.push({
            source: "supabase",
            payload: {
              ...data.payload,
              updatedAt: data.payload.updatedAt || data.updated_at,
            },
          });
        }
      } catch (error) {
        errors.push("Supabase 讀取失敗");
      }
    }
    try {
      const staticPayload = await fetchLiveMemoryJson("realtimeRadar:static", versionedDataUrl(endpoints.realtimeRadarCache, "latest", force), 8000, FUMAN_LIVE_MEMORY_TTL_MS.realtimeRadar, force);
      if (staticPayload) candidates.push({ source: "static", payload: staticPayload });
    } catch (error) {
      errors.push("靜態備援讀取失敗");
    }
    const validCandidates = candidates.map(normalizeRealtimeRadarPayloadCandidate).filter(Boolean);
    if (!validCandidates.length) {
      realtimeRadarCacheError = errors.join("、");
      realtimeRadarCacheSourceStatus = realtimeRadarLastRows.length ? "stale" : "missing";
      return false;
    }
    const chosen = validCandidates.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const normalizedRows = chosen.rows
      .map((row) => ({
        ...row,
        pct: cleanNumber(row.pct ?? row.percent),
        percent: cleanNumber(row.percent ?? row.pct),
        radarUpdatedAt: cleanNumber(row.radarUpdatedAt || row.detectedAt) || chosen.updatedAt,
        radarDate: chosen.payloadDate,
        radarMode: "intraday",
      }))
      .filter((row) => /^\d{4}$/.test(String(row.code || "")) && row.side && cleanNumber(row.close) > 0);
    if (!normalizedRows.length) return false;
    realtimeRadarLastRows = mergeRealtimeRadarRows(normalizedRows, realtimeRadarLastRows);
    realtimeRadarLastUpdatedAt = chosen.updatedAt;
    realtimeRadarCacheSource = chosen.source;
    realtimeRadarCacheSourceStatus = chosen.source === "supabase" ? "ok" : "fallback";
    realtimeRadarCacheError = errors.join("、");
    realtimeRadarCacheLoadedAt = Date.now();
    saveRealtimeRadarLastRows(realtimeRadarLastRows);
    return true;
  } catch (error) {
    realtimeRadarCacheError = error?.message || String(error || "即時資料讀取失敗");
    realtimeRadarCacheSourceStatus = realtimeRadarLastRows.length ? "stale" : "missing";
    return false;
  } finally {
    realtimeRadarCacheLoading = false;
  }
}

async function ensureRealtimeRadarData() {
  if (latestStocks.length) return latestStocks;
  if (realtimeRadarDataPromise) return realtimeRadarDataPromise;
  realtimeRadarDataPromise = (async () => {
    realtimeRadarLoading = true;
    try {
      const stocks = await loadStrategyStocks();
      if (stocks.length) {
        const sample = stocks.find((stock) => stock?.code);
        if (sample && !strategyHistoryData[sample.code]) loadStrategy4Cache(true);
        deferUiWork(() => {
          loadMarketData();
          if (isIntradayScanWindow()) refreshStrategyRealtimeScan("force");
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

async function ensureRealtimeRadarClosingData() {
  if (realtimeRadarLastRows.length) return realtimeRadarLastRows;
  if (latestStocks.length) return latestStocks;
  if (realtimeRadarDataPromise) return realtimeRadarDataPromise;
  realtimeRadarDataPromise = (async () => {
    realtimeRadarLoading = true;
    try {
      loadRealtimeRadarLastRows();
      if (realtimeRadarLastRows.length) return realtimeRadarLastRows;
      const stocks = await loadStrategyStocks();
      if (stocks.length) {
        renderStocks(stocks);
        return latestStocks;
      }
      return [];
    } catch (error) {
      return [];
    } finally {
      realtimeRadarLoading = false;
      realtimeRadarDataPromise = null;
    }
  })();
  return realtimeRadarDataPromise;
}

function formatRealtimeRadarAge(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分前`;
  return `${Math.floor(minutes / 60)}小時前`;
}

function realtimeRadarSourceText() {
  return {
    supabase: "Supabase",
    static: "靜態備援",
    localStorage: "本機暫存",
    browserScan: "前端巡邏",
  }[realtimeRadarCacheSource] || "等待資料";
}

function realtimeRadarFreshnessText() {
  if (!realtimeRadarLastUpdatedAt) return realtimeRadarCacheError ? `資料源異常｜${realtimeRadarCacheError}` : "等待即時資料";
  const age = Date.now() - realtimeRadarLastUpdatedAt;
  const ageText = formatRealtimeRadarAge(age);
  const state = age <= REALTIME_RADAR_FRESH_MS
    ? "資料新鮮"
    : age <= REALTIME_RADAR_STALE_MS
    ? "資料延遲"
    : "即時資料失聯";
  const sourceStatus = realtimeRadarCacheSourceStatus === "fallback" ? "備援" : realtimeRadarCacheSourceStatus === "stale" ? "保留舊資料" : "";
  return `來源 ${realtimeRadarSourceText()}${sourceStatus ? ` ${sourceStatus}` : ""}｜${state} ${ageText}`;
}
function buildRealtimeRadarAiPanel(rows = [], options = {}) {
  const list = normalizeArray(rows);
  const longs = list.filter((stock) => stock.side === "long").sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score)).slice(0, 5);
  const shorts = list.filter((stock) => stock.side === "short").sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score)).slice(0, 5);
  const longFlow = list.filter((stock) => stock.side === "long").reduce((sum, stock) => sum + Math.max(cleanNumber(stock.flow), 0), 0);
  const shortFlow = list.filter((stock) => stock.side === "short").reduce((sum, stock) => sum + Math.max(cleanNumber(stock.flow), 0), 0);
  const totalFlow = longFlow + shortFlow;
  const longShare = totalFlow ? Math.round((longFlow / totalFlow) * 100) : 50;
  const renderChip = (stock) => `<span class="radar-ai-chip">${stock.code} ${stock.name || ""}</span>`;
  const renderNames = (items) => items.map((stock) => `${stock.code} ${stock.name || ""}`.trim()).join("　");
  const longText = longs.length
    ? `多方訊號集中在 ${renderNames(longs)}，留意續強與量能延續。`
    : "多方訊號更新中，等待成交量與資金流同步確認。";
  const shortText = shorts.length
    ? `空方訊號集中在 ${renderNames(shorts)}，留意賣壓與反彈失敗壓力。`
    : "空方訊號更新中，等待轉弱與賣壓確認。";
  const trustFlow = list.reduce((sum, stock) => sum + cleanNumber(stock.trust), 0);
  const foreignFlow = list.reduce((sum, stock) => sum + cleanNumber(stock.foreign), 0);
  const avgScore = list.length ? Math.round(list.reduce((sum, stock) => sum + cleanNumber(stock.score), 0) / list.length) : 0;
  const updateText = options.loading
    ? "正在更新即時訊號"
    : options.updateText || realtimeRadarModeNote(options.radarOpen, list.length);

  return `
    <section class="radar-ai-box overview" aria-label="AI 即時判斷">
      <div class="radar-ai-head">
        <span>◎ AI 即時判斷</span>
        <span>信心 ${Math.max(55, Math.min(95, avgScore || longShare))}%</span>
      </div>
      <div class="radar-ai-grid">
        <article class="radar-ai-panel">
          <div class="radar-ai-head"><h3>↗ 偏多 AI 分析</h3><span>${longs.length} 檔</span></div>
          <div class="radar-ai-chips">${longs.length ? longs.map(renderChip).join("") : `<span class="radar-ai-chip">更新中</span>`}</div>
          <p>${longText}</p>
        </article>
        <article class="radar-ai-panel short">
          <div class="radar-ai-head"><h3>↘ 偏空 AI 分析</h3><span>${shorts.length} 檔</span></div>
          <div class="radar-ai-chips">${shorts.length ? shorts.map(renderChip).join("") : `<span class="radar-ai-chip">更新中</span>`}</div>
          <p>${shortText}</p>
        </article>
      </div>
      <p class="radar-ai-note">多方 ${radarMoney(longFlow)} ｜ 空方 ${radarMoney(shortFlow)} ｜ 淨流向 ${radarMoney(longFlow - shortFlow)} ｜ 集中度 ${longShare}% ｜ 外資 ${formatInstitution(foreignFlow)} ｜ 投信 ${formatInstitution(trustFlow)} ｜ ${updateText}</p>
    </section>
  `;
  requestAnimationFrame(refreshDataFreshnessBars);
}

function renderRealtimeRadar() {
  installRealtimeRadarView();
  const panel = viewPanels["realtime-radar"];
  if (!panel) return;
  const mobileFastRadar = isMobileViewport() && realtimeRadarLastRows.length > 0;
  requestAnimationFrame(refreshDataFreshnessBars);
  const isManualSideSwitch = realtimeRadarManualSideSwitch;
  realtimeRadarManualSideSwitch = false;
  deferUiWork(ensureMobileAutoOrganizeButton);
  if (!strategy3Data.length && !strategy3CacheLoading) {
    if (mobileFastRadar) deferIdleWork(loadStrategy3RadarVolumeCache, 1600);
    else loadStrategy3RadarVolumeCache();
  }
  const radarOpen = shouldRunLivePolling();
  if (!realtimeRadarLastRows.length) loadRealtimeRadarLastRows();
  const radarCacheDue = shouldRefreshRealtimeRadarRemoteCache(radarOpen);
  if (radarCacheDue && !realtimeRadarCacheLoading && !mobileFastRadar) {
    loadRealtimeRadarLatestCache(true).then((loaded) => {
      if (loaded && isViewActive("realtime-radar")) renderRealtimeRadar();
    });
  }
  if (!realtimeRadarLastRows.length) loadRealtimeRadarLastRows();
  if (!radarOpen && !realtimeRadarLastRows.length && !latestStocks.length) {
    panel.innerHTML = `
      <header class="radar-topbar">
        <div>
          <h1>◎ 即時多空資金流</h1>
          <small>偵測時間 09:00-13:30｜收盤後停止偵測，正在讀取最後盤中雷達資料</small>
        </div>
        <button class="radar-action" type="button" disabled>09:00-13:30 偵測</button>
      </header>
      ${buildRealtimeRadarAiPanel(realtimeRadarLastRows, { loading: true, radarOpen })}
      <div class="empty-state">正在讀取今日最後盤中雷達資料...</div>
    `;
    loadRealtimeRadarLatestCache(true).then((loaded) => {
      if (loaded && isViewActive("realtime-radar")) {
        renderRealtimeRadar();
        return;
      }
      ensureRealtimeRadarClosingData().then((stocks) => {
        if (stocks.length) renderRealtimeRadar();
        else panel.innerHTML = `<div class="empty-state">目前沒有可用的即時雷達資料，請稍後重新整理。</div>`;
      });
    });
    return;
  }
  if (!latestStocks.length && !realtimeRadarLastRows.length) {
    panel.innerHTML = `<div class="empty-state">正在快速載入當沖雷達股票池...</div>`;
    ensureRealtimeRadarData().then((stocks) => {
      if (stocks.length) renderRealtimeRadar();
      else panel.innerHTML = `<div class="empty-state">即時雷達暫時沒有取得股票資料，請按右上重新整理。</div>`;
    });
    return;
  }

  if (!Object.keys(strategyHistoryData).length && !strategy4CacheLoading) {
    if (mobileFastRadar) deferIdleWork(() => loadStrategy4Cache(true), 1800);
    else loadStrategy4Cache(true);
  }
  const historyTargets = radarOpen ? getRealtimeRadarHistoryTargets() : [];
  const snapshotHistoryTargets = radarOpen && historyTargets.length ? [] : (radarOpen ? getRealtimeRadarSnapshotHistoryTargets(realtimeRadarLastRows) : []);
  const pendingHistoryTargets = historyTargets.length ? historyTargets : snapshotHistoryTargets;
  if (!mobileFastRadar && radarOpen && pendingHistoryTargets.length && !realtimeRadarHistoryPromise && Date.now() - realtimeRadarHistoryLastAt >= REALTIME_RADAR_HISTORY_REFRESH_MS) {
    loadRealtimeRadarHistory(pendingHistoryTargets).then((loaded) => {
      if (loaded) {
        enrichRealtimeRadarSnapshotRows(realtimeRadarLastRows);
        renderRealtimeRadar();
      }
    });
  }
  const shouldReuseRadarRows = isManualSideSwitch && realtimeRadarLastRows.length;
  const cacheRows = [];
  const liveRows = (shouldReuseRadarRows || mobileFastRadar) ? [] : buildRealtimeRadarRows({ mode: radarOpen ? "intraday" : "closed" });
  const rows = radarOpen ? mergeRealtimeRadarRows([...liveRows, ...cacheRows], []) : liveRows;
  if (!shouldReuseRadarRows && radarOpen && rows.length) {
    realtimeRadarLastRows = mergeRealtimeRadarRows(rows, realtimeRadarLastRows);
    realtimeRadarLastUpdatedAt = Date.now();
    realtimeRadarCacheSource = "browserScan";
    realtimeRadarCacheSourceStatus = "ok";
    saveRealtimeRadarLastRows(realtimeRadarLastRows);
  }
  const radarSignalStale = radarOpen && isRealtimeRadarSignalStale(realtimeRadarLastRows);
  const radarNeedsUpdate = radarOpen && !mobileFastRadar && (realtimeRadarNeedsFreshScan || !isRealtimeRadarFresh() || radarSignalStale);
  if (radarNeedsUpdate && realtimeRadarLastRows.length) {
    if (!realtimeRadarRefreshLoading && !strategyRealtimeLoading) {
      realtimeRadarRefreshLoading = true;
      refreshStrategyRealtimeScan(radarSignalStale ? "force" : "hot")
        .then(() => {
          realtimeRadarNeedsFreshScan = false;
          renderRealtimeRadar();
        })
        .finally(() => {
          realtimeRadarRefreshLoading = false;
        });
    }
  } else if (radarNeedsUpdate) {
    if (!isManualSideSwitch && panel.querySelector(".radar-board-list")) {
      if (!realtimeRadarRefreshLoading && !strategyRealtimeLoading) {
        realtimeRadarRefreshLoading = true;
        refreshStrategyRealtimeScan(radarSignalStale ? "force" : "hot")
          .then(() => {
            realtimeRadarNeedsFreshScan = false;
            renderRealtimeRadar();
          })
          .finally(() => {
            realtimeRadarRefreshLoading = false;
          });
      }
      return;
    }
    panel.innerHTML = `
      <header class="radar-topbar">
        <div>
          <h1>◎ 即時多空資金流</h1>
          <small>偵測時間 09:00-13:30｜正在更新即時訊號</small>
        </div>
        <button class="radar-action" type="button" data-radar-refresh>重新整理</button>
      </header>
      ${buildRealtimeRadarAiPanel(realtimeRadarLastRows, { loading: true })}
      <section class="radar-board-tabs" role="tablist" aria-label="即時雷達多空切換">
        <button type="button" class="${realtimeRadarSide !== "short" ? "active" : ""}" data-radar-side="long" onclick="switchRealtimeRadarSide('long')">多方</button>
        <button type="button" class="${realtimeRadarSide === "short" ? "active short-active" : ""}" data-radar-side="short" onclick="switchRealtimeRadarSide('short')">空方</button>
      </section>
      <div class="empty-state">正在更新${realtimeRadarSide === "short" ? "空方" : "多方"}訊號...</div>
    `;
    if (!realtimeRadarRefreshLoading && !strategyRealtimeLoading) {
      realtimeRadarRefreshLoading = true;
      refreshStrategyRealtimeScan("hot")
        .then(() => {
          realtimeRadarNeedsFreshScan = false;
          renderRealtimeRadar();
        })
        .finally(() => {
          realtimeRadarRefreshLoading = false;
        });
    }
    return;
  }
  if (radarOpen && !rows.length && !realtimeRadarLastRows.length) {
    if (!isManualSideSwitch && panel.querySelector(".radar-board-list")) {
      if (!realtimeRadarRefreshLoading) {
        realtimeRadarRefreshLoading = true;
        loadMarketData(true)
          .then(() => renderRealtimeRadar())
          .finally(() => {
            realtimeRadarRefreshLoading = false;
          });
      }
      return;
    }
    panel.innerHTML = `
      <header class="radar-topbar">
        <div>
          <h1>◎ 即時多空資金流</h1>
          <small>偵測時間 09:00-13:30｜正在更新即時訊號</small>
        </div>
        <button class="radar-action" type="button" data-radar-refresh>重新整理</button>
      </header>
      ${buildRealtimeRadarAiPanel(realtimeRadarLastRows, { loading: true })}
      <section class="radar-board-tabs" role="tablist" aria-label="即時雷達多空切換">
        <button type="button" class="${realtimeRadarSide !== "short" ? "active" : ""}" data-radar-side="long" onclick="switchRealtimeRadarSide('long')">多方</button>
        <button type="button" class="${realtimeRadarSide === "short" ? "active short-active" : ""}" data-radar-side="short" onclick="switchRealtimeRadarSide('short')">空方</button>
      </section>
      <div class="empty-state">正在更新${realtimeRadarSide === "short" ? "空方" : "多方"}訊號...</div>
    `;
    if (!realtimeRadarRefreshLoading) {
      realtimeRadarRefreshLoading = true;
      loadMarketData(true)
        .then(() => renderRealtimeRadar())
        .finally(() => {
          realtimeRadarRefreshLoading = false;
        });
    }
    return;
  }
  if (!radarOpen && !rows.length && !realtimeRadarLastRows.length) {
    panel.innerHTML = `
      <header class="radar-topbar">
        <div>
          <h1>◎ 即時多空資金流</h1>
          <small>偵測時間 09:00-13:30｜${realtimeRadarModeText(false)}｜資料日期 ${formatMarketAiDateKey(realtimeRadarClosedDataDateKey())}</small>
        </div>
        <button class="radar-action" type="button" disabled>09:00-13:30 偵測</button>
      </header>
      ${buildRealtimeRadarAiPanel([], { radarOpen: false })}
      <div class="empty-state">收盤資料暫無可用雷達訊號，請稍後重新整理。</div>
    `;
    return;
  }
  const displayRows = realtimeRadarLastRows.length
    ? recentRealtimeRadarDisplayRows(shouldReuseRadarRows || !radarOpen ? realtimeRadarLastRows : enrichRealtimeRadarSnapshotRows(realtimeRadarLastRows), radarOpen)
    : rows;
  const displaySignalAt = latestRealtimeRadarSignalAt(displayRows);
  const displaySignalStale = radarOpen && isRealtimeRadarSignalStale(displayRows);
  const sortRadarLedger = (items) => [...items].sort((a, b) => (cleanNumber(b.radarUpdatedAt) - cleanNumber(a.radarUpdatedAt)) || cleanNumber(b.score) - cleanNumber(a.score));
  const longAll = sortRadarLedger(displayRows.filter((stock) => stock.side === "long"));
  const shortAll = sortRadarLedger(displayRows.filter((stock) => stock.side === "short"));
  const longRows = longAll.slice(0, 8);
  const shortRows = shortAll.slice(0, 8);
  const longFlow = longAll.reduce((sum, stock) => sum + stock.flow, 0);
  const shortFlow = shortAll.reduce((sum, stock) => sum + stock.flow, 0);
  const major = longFlow >= shortFlow ? "偏多" : "偏空";
  const activeSide = realtimeRadarSide === "short" ? "short" : realtimeRadarSide === "long" ? "long" : (major === "偏空" ? "short" : "long");
  const activeRows = activeSide === "short" ? shortRows : longRows;
  const now = radarSessionTimeLabel();
  const radarDetailChips = (stock) => {
    const chips = [
      `價 ${stock.pct >= 0 ? "+" : ""}${stock.pct.toFixed(0)}`,
      `量 +${Math.max(1, Math.round((stock.volume || stock.tradeVolume || 0) / 1000)).toLocaleString("zh-TW")}`,
      `突 +${Math.round(stock.score / 2)}`,
      `籌 ${stock.totalInst >= 0 ? "+" : ""}${Math.round((stock.totalInst || 0) / 1000).toLocaleString("zh-TW")}`,
      `資 ${stock.flow >= 0 ? "+" : ""}${Math.round(stock.flow / 1000000).toLocaleString("zh-TW")}`,
    ];
    return chips.map((chip) => `<span>${chip}</span>`).join("");
  };
  const boardCard = (stock) => {
    const sign = stock.pct >= 0 ? "+" : "";
    const tags = radarTechnicalTags(stock).map((tag) => `<span>${tag}</span>`).join("");
    const instTags = radarChipTags(stock).map((tag) => `<span>${tag}</span>`).join("");
    const volumeRatio = cleanNumber(stock.volumeRatio) || radarVolumeRatio(stock);
    if (!volumeRatio) requestRealtimeRadarVolumeRatio(stock);
    const volumeRatioText = volumeRatio
      ? formatNumber(volumeRatio, 2)
      : realtimeRadarVolumeRatioRequestedCodes.has(String(stock.code || "")) ? "計算中" : "--";
    const eventTime = cleanNumber(stock.radarUpdatedAt)
      ? new Date(cleanNumber(stock.radarUpdatedAt)).toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit" })
      : now.slice(0, 5);
    return `
      <article class="radar-signal-card ${stock.side === "short" ? "short" : ""}">
        <div class="radar-jump"><strong>${eventTime}</strong></div>
        <div class="radar-signal-main">
          <div class="radar-signal-name">${stock.name}<small>${stock.code}</small></div>
          <div class="radar-signal-meta">成交金額 ${radarMoney(stock.value)} · 量比 ${volumeRatioText} · 分數 ${Math.round(stock.score)}</div>
          <div class="radar-signal-chips">${radarDetailChips(stock)}</div>
        </div>
        <div class="radar-signal-price">
          <strong>${formatNumber(stock.close, stock.close >= 100 ? 1 : 2)}</strong>
          <small>▲ ${sign}${stock.pct.toFixed(2)}%</small>
        </div>
        <div class="radar-condition-list">${tags}</div>
        <div class="radar-chip-list">${instTags}</div>
      </article>
    `;
  };
  realtimeRadarBoardMarkupCache = {
    long: longRows.slice(0, 10).map(boardCard).join("") || `<div class="empty-state">目前無多方訊號</div>`,
    short: shortRows.slice(0, 10).map(boardCard).join("") || `<div class="empty-state">目前無空方訊號</div>`,
  };
  const boardMarkup = realtimeRadarBoardMarkupCache[activeSide] || `<div class="empty-state">目前無${activeSide === "short" ? "空方" : "多方"}訊號</div>`;
  const renderSignature = `${activeSide}:${radarOpen ? 1 : 0}:${realtimeRadarRowsSignature(displayRows)}`;
  const shellSignature = `${radarOpen ? 1 : 0}:${displayRows.length}:${longAll.length}:${shortAll.length}:${displaySignalStale ? 1 : 0}`;
  if (
    panel.querySelector(".radar-board-list")
    && renderSignature !== realtimeRadarRenderSignature
    && shellSignature === realtimeRadarShellSignature
    && patchRealtimeRadarBoard(activeSide, boardMarkup, displayRows)
  ) {
    realtimeRadarRenderSignature = renderSignature;
    return;
  }
  const signalTimeText = realtimeRadarSignalTimeText(displaySignalAt);
  const aiUpdateText = radarOpen && displaySignalAt
    ? displaySignalStale
      ? `最後訊號 ${signalTimeText}｜補掃最新報價中`
      : `最新訊號 ${signalTimeText}｜${displayRows.length.toLocaleString("zh-TW")} 則`
    : realtimeRadarModeNote(radarOpen, displayRows.length);
  const radarFreshnessText = radarOpen ? realtimeRadarFreshnessText() : "";
  const aiPanelMarkup = buildRealtimeRadarAiPanel(displayRows, { radarOpen, updateText: [aiUpdateText, radarFreshnessText].filter(Boolean).join("｜") });
  const radarHeaderFreshness = radarOpen ? realtimeRadarFreshnessText() : "";
  const radarHeaderNote = radarOpen
    ? displaySignalAt
      ? displaySignalStale
        ? `盤中即時巡邏｜最後訊號 ${signalTimeText}，正在強制補掃`
        : `盤中即時巡邏｜最新訊號 ${signalTimeText}`
      : "盤中即時巡邏｜3秒輪巡同步中"
    : realtimeRadarLastRows.length
      ? `收盤後停止偵測，顯示今日盤中最後資料${realtimeRadarLastUpdatedAt ? ` ${new Date(realtimeRadarLastUpdatedAt).toLocaleTimeString("zh-TW", { hour12: false })}` : ""}`
      : `${realtimeRadarModeText(false)}｜資料日期 ${formatMarketAiDateKey(realtimeRadarClosedDataDateKey())}`;

  panel.innerHTML = `
    <header class="radar-topbar">
      <div>
        <h1>◎ 即時多空資金流</h1>
        <small>偵測時間 09:00-13:30｜${radarHeaderNote}${radarHeaderFreshness ? `｜${radarHeaderFreshness}` : ""}</small>
      </div>
      <button class="radar-action" type="button" ${radarOpen ? "data-radar-refresh" : "disabled"}>${radarOpen ? "重新整理" : "09:00-13:30 偵測"}</button>
    </header>
    ${aiPanelMarkup}
    <section class="radar-board-tabs" role="tablist" aria-label="即時雷達多空切換">
      <button type="button" class="${activeSide === "long" ? "active" : ""}" data-radar-side="long" onclick="switchRealtimeRadarSide('long')">多方</button>
      <button type="button" class="${activeSide === "short" ? "active short-active" : ""}" data-radar-side="short" onclick="switchRealtimeRadarSide('short')">空方</button>
    </section>
    <section class="radar-board-list">
      ${boardMarkup}
    </section>
  `;
  realtimeRadarRenderSignature = renderSignature;
  realtimeRadarShellSignature = shellSignature;
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
  if (!canRunViewWork(active)) return;
  if (active === "market") {
    loadMarketData();
    loadHeatmap();
    return;
  }
  if (active === "strategy") {
    renderStrategyScanner();
    const text = [...selectedStrategyIds].join(" ");
    if (text.includes("intraday_2m") && shouldRunLivePolling()) refreshStrategyRealtimeScan("force");
    if (text.includes("open_buy")) loadOpenBuyCache(true);
    if (text.includes("swing_radar")) loadStrategy4Cache(true);
    return;
  }
  if (active === "chip-trade") {
    loadChipTradeData(true);
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
  document.body.appendChild(button);
  pinMobileToolButtons();
}

function getMobileToolLayout() {
  const width = window.innerWidth || document.documentElement.clientWidth || 0;
  const height = window.innerHeight || document.documentElement.clientHeight || 0;
  const landscapePhone = width <= 920 && height <= 430 && width > height;
  const portraitPhone = width <= 760;
  if (!landscapePhone && !portraitPhone) return null;
  const viewportOffsetTop = Math.max(0, window.visualViewport?.offsetTop || 0);
  return {
    top: viewportOffsetTop + (landscapePhone ? 18 : 12),
    organizeRight: landscapePhone ? 72 : 62,
    themeRight: landscapePhone ? 18 : 12,
    size: landscapePhone ? 46 : 42,
  };
}

function pinOneMobileToolButton(button, top, right, size) {
  if (!button) return;
  button.style.setProperty("position", "fixed", "important");
  button.style.setProperty("top", `${top}px`, "important");
  button.style.setProperty("right", `${right}px`, "important");
  button.style.setProperty("left", "auto", "important");
  button.style.setProperty("width", `${size}px`, "important");
  button.style.setProperty("height", `${size}px`, "important");
  button.style.setProperty("display", "inline-grid", "important");
  button.style.setProperty("z-index", button.id === "fuman-theme-toggle" ? "10001" : "10000", "important");
  requestAnimationFrame(() => {
    const rect = button.getBoundingClientRect();
    if (Math.abs(rect.top - top) <= 3) return;
    button.style.setProperty("position", "absolute", "important");
    button.style.setProperty("top", `${(window.scrollY || 0) + top}px`, "important");
  });
}

function pinMobileToolButtons() {
  const layout = getMobileToolLayout();
  if (!layout) return;
  pinOneMobileToolButton(document.querySelector(".mobile-auto-organize"), layout.top, layout.organizeRight, layout.size);
  pinOneMobileToolButton(document.querySelector("#fuman-theme-toggle"), layout.top, layout.themeRight, layout.size);
}

let mobileToolPinningInstalled = false;
function installMobileToolPinning() {
  if (mobileToolPinningInstalled) return;
  mobileToolPinningInstalled = true;
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      pinMobileToolButtons();
    });
  };
  window.addEventListener("scroll", schedule, { passive: true, capture: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", schedule, { passive: true });
  window.visualViewport?.addEventListener("scroll", schedule, { passive: true });
  window.visualViewport?.addEventListener("resize", schedule, { passive: true });
  schedule();
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
    const marketText = marketMode === "ai" ? "AI 盤面判讀" : "市場總覽";
    marketTitle.innerHTML = `${titleWithIcon("●", marketText)}${marketMode === "overview" && settlementBadge ? ` <small class="update-mode-badge settlement-title-badge">${escapeAttr(settlementBadge)}</small>` : ""} ${scheduleBadgeHtml("market")}`;
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
  badge.className = `update-mode-badge update-mode-badge-${tone === "live" ? "live" : "slow"}`;
  badge.textContent = text;
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
    if (text.includes("策略1")) appendUpdateBadge(card, "07/16:00完整掃", "slow");
    if (text.includes("策略3")) appendUpdateBadge(card, "13:00完整掃", "slow");
    if (text.includes("策略4")) appendUpdateBadge(card, "14:30完整掃", "slow");
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
  chipTool.appendChild(note);
}

const endpoints = FUMAN_RUNTIME_CONFIG.endpoints || {};

let latestStocks = [];
let marketDataLoading = false;
let marketDataLastStartedAt = 0;
let marketDataLastRenderedAt = 0;
let marketSummaryLoading = false;
let marketSummaryLoadedAt = 0;
let marketSummaryPayload = null;
let healthSummaryPayload = null;
let strategyWeightPayload = {
  weights: {
    strategy2Multiplier: 1,
    radarMultiplier: 1,
    strategy4Multiplier: 1,
  },
  updatedAt: "",
};
let marketRealtimeState = { trading: false, marketStatus: "", updatedAt: "", source: "" };
let marketStockDataState = { resolvedTradeDate: "", today: "", source: "", updatedAt: "", isFallbackDate: false, marketDates: {} };
let heatmapLoading = false;
let heatmapLastStartedAt = 0;
let marketAiHeatmapSyncRequestedAt = 0;
let marketAiHeatmapSyncPromise = null;
let heatmapMode = "all";
let lastViewName = "";
let lastViewShownAt = 0;
let lastMarketRenderSignature = "";
let lastHeatmapRenderSignature = "";
let marketMode = "overview";
let marketAiPanel = null;
let marketAiLastSignature = "";
let marketAiStockLoading = false;
let marketAiHotFilter = "all";
let marketAiInstitutionLoading = false;
let marketAiRealtimeScanRequestedAt = 0;
let marketAiConfluenceLoading = false;
let marketAiConfluenceLoadedAt = 0;
let realtimeRadarLoading = false;
let realtimeRadarDataPromise = null;
let realtimeRadarSide = "auto";
let realtimeRadarManualSideSwitch = false;
let realtimeRadarBoardMarkupCache = { long: "", short: "" };
let realtimeRadarRenderSignature = "";
let realtimeRadarShellSignature = "";
let realtimeRadarLastRows = [];
let realtimeRadarLastUpdatedAt = 0;
let realtimeRadarCacheSource = "none";
let realtimeRadarCacheSourceStatus = "unknown";
let realtimeRadarCacheError = "";
const REALTIME_RADAR_FRESH_MS = FUMAN_TUNING_CONFIG.realtimeRadarFreshMs ?? (2 * 60 * 1000);
const REALTIME_RADAR_STALE_MS = FUMAN_TUNING_CONFIG.realtimeRadarStaleMs ?? (5 * 60 * 1000);
let realtimeRadarCacheLoading = false;
let realtimeRadarCacheLoadedAt = 0;
let realtimeRadarRefreshLoading = false;
let realtimeRadarNeedsFreshScan = true;
let realtimeRadarHistoryPromise = null;
let realtimeRadarHistoryLastAt = 0;
const realtimeRadarVolumeRatioRequestedCodes = new Set();
const REALTIME_RADAR_LAST_CACHE_KEY = FUMAN_TUNING_CONFIG.realtimeRadarLastCacheKey || "fuman_realtime_radar_last_rows_v2";
const REALTIME_RADAR_HISTORY_TARGET_LIMIT = FUMAN_TUNING_CONFIG.realtimeRadarHistoryTargetLimit ?? 72;
const REALTIME_RADAR_HISTORY_BATCH_SIZE = FUMAN_TUNING_CONFIG.realtimeRadarHistoryBatchSize ?? 12;
const REALTIME_RADAR_HISTORY_REFRESH_MS = FUMAN_TUNING_CONFIG.realtimeRadarHistoryRefreshMs ?? (10 * 60 * 1000);
let sectorStocksCache = {};
let industryMasterByCode = {};
let institutionData = {};
let institutionDataPromise = null;
let institutionDate = "";
let institutionUpdatedAt = 0;
let chipMode = "after";
let chipTradeLoading = false;
let chipTradeLoadedAt = 0;
let chipTradePreferFull = false;
let chipTradeFullPreloadPromise = null;
const CHIP_TRADE_CACHE_MS = FUMAN_TUNING_CONFIG.chipTradeCacheMs ?? (10 * 60 * 1000);
const CHIP_WARRANT_ACTIVE_REFRESH_MS = FUMAN_TUNING_CONFIG.chipWarrantActiveRefreshMs ?? (60 * 1000);
let chipFilter = "joint";
let chipQuoteHydrating = false;
let chipTradeLastRenderSignature = "";
let strategyRealtimeLoading = false;
let strategyRealtimeCursor = 0;
let strategyRealtimeQuotes = {};
let strategyLastScanAt = 0;
let strategyRealtimeStats = { requested: 0, received: 0, failed: 0, lastError: "" };
let strategyRealtimeBackgroundCursor = 0;
let strategyRealtimePriorityCursor = 0;
let mobileIntradayHotScanLastAt = 0;
let mobileIntradayBackgroundScanLastAt = 0;
let mobileOtherStrategyRenderLastAt = 0;
let mobileOtherStrategyRenderTimer = 0;
let mobileOtherStrategyRenderFlushing = false;
let mobileOtherStrategyCacheCheckedAt = {};
let watchlistDashboardSignature = "";
let watchlistRefreshLoading = false;
let watchlistStrategyMatchPromise = null;
let watchlistStrategyMatchCache = null;
let watchlistStrategyIndexPromise = null;
let watchlistStrategyIndexCache = null;
let watchlistQuoteDateKey = "";
const intradayGoFirstSeenAt = new Map();
const intradayFirstSeenAt = new Map();
let strategy2IntradayEventByCode = new Map();
let strategy2IntradayCacheDate = "";
let strategy2IntradayCacheLoading = false;
let strategy2IntradayCacheLoadedAt = 0;
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
let strategy4ScanStamp = "";
let strategy4CacheLoading = false;
let strategy4ZoneLoading = {};
let strategy4LoadedZones = new Set();
let strategy4SummaryLoading = false;
let strategy4SummaryLoadedAt = 0;
let strategy4Summary = null;
let strategy3Data = [];
let strategy3UpdatedAt = 0;
let strategy3UsedDateKey = "";
let strategy3CacheLoading = false;
let strategy5Data = [];
let strategy5UpdatedAt = 0;
let strategy5UsedDateKey = "";
let strategy5CacheLoading = false;
let strategyStocksPromise = null;
const STRATEGY4_LOCAL_CACHE_KEY = FUMAN_TUNING_CONFIG.strategy4LocalCacheKey || "fuman_strategy4_scan_cache_v1";
const STRATEGY4_BACKUP_CACHE_KEY = FUMAN_TUNING_CONFIG.strategy4BackupCacheKey || "fuman_strategy4_nonempty_backup_v1";
const OPEN_BUY_LOCAL_CACHE_KEY = FUMAN_TUNING_CONFIG.openBuyLocalCacheKey || "fuman_open_buy_scan_cache_v1";
const OPEN_BUY_BACKUP_CACHE_KEY = FUMAN_TUNING_CONFIG.openBuyBackupCacheKey || "fuman_open_buy_nonempty_backup_v1";
const EXPORT_UNLOCK_KEY = FUMAN_TUNING_CONFIG.exportUnlockKey || "fuman_export_unlock_until_v1";
const EXPORT_UNLOCK_MS = FUMAN_TUNING_CONFIG.exportUnlockMs ?? (30 * 24 * 60 * 60 * 1000);
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
let openBuyDataDateKey = "";
let openBuyCacheSource = "";
let openBuyPage = 1;
let swingPage = 1;
let strategy3Page = 1;
let strategy5Page = 1;
let warrantFlowLoading = false;
let warrantFlowData = [];
let warrantFlowUpdatedAt = 0;
let warrantFlowPriorityCache = [];
let warrantFlowPrioritySignature = "";
let warrantFlowLastRenderSignature = "";
let warrantFlowKeyword = "";
let warrantFlowSearchTimer = null;
let warrantFlowPage = 1;
let warrantFlowHasOpened = false;
let warrantFlowPreferFull = false;
let warrantFlowFullPreloadPromise = null;
let warrantFlowSummary = null;
let warrantFlowSummaryLoading = false;
let chipTradePage = 1;
let institutionSummary = null;
let institutionSummaryLoading = false;
const WARRANT_FLOW_LOCAL_CACHE_KEY = FUMAN_TUNING_CONFIG.warrantFlowLocalCacheKey || "fuman_warrant_flow_cache_v1";
const CACHE_FRESH_MS = FUMAN_TUNING_CONFIG.cacheFreshMs ?? (10 * 60 * 1000);
const MARKET_REFRESH_LIVE_MS = FUMAN_TUNING_CONFIG.marketRefreshLiveMs ?? (5 * 1000);
const MARKET_REFRESH_CLOSED_MS = FUMAN_TUNING_CONFIG.marketRefreshClosedMs ?? (10 * 60 * 1000);
const MARKET_REFRESH_HIDDEN_MS = FUMAN_TUNING_CONFIG.marketRefreshHiddenMs ?? (5 * 60 * 1000);
const MARKET_HEATMAP_CLOSED_MS = FUMAN_TUNING_CONFIG.marketHeatmapClosedMs ?? (10 * 60 * 1000);
const MARKET_POLL_TICK_MS = FUMAN_TUNING_CONFIG.marketPollTickMs ?? (5 * 1000);
const MARKET_DOM_REFRESH_MS = FUMAN_TUNING_CONFIG.marketDomRefreshMs ?? (60 * 1000);
const WATCHLIST_REFRESH_LIVE_MS = FUMAN_TUNING_CONFIG.watchlistRefreshLiveMs ?? (30 * 1000);
const WATCHLIST_REFRESH_CLOSED_MS = FUMAN_TUNING_CONFIG.watchlistRefreshClosedMs ?? (120 * 1000);
const WATCHLIST_REFRESH_HIDDEN_MS = FUMAN_TUNING_CONFIG.watchlistRefreshHiddenMs ?? (180 * 1000);
let selectedStrategyIds = new Set();
let strategyMode = "any";
let strategyKeyword = "";
let strategySearchTimer = null;
let strategyInlineSearchComposing = false;
let strategyStocksLoading = false;
let swingSortKey = "score";
let swingSortDir = "desc";
let swingSignalFilter = "all";
let swingZoneFilter = "all";
let swingVisibleKeyword = "";
let swingVisibleSearchInput = null;
let swingRenderCacheSignature = "";
let swingRenderCacheRows = [];
let swingRenderCacheZoneRows = null;
let swingRenderCacheSignalCounts = null;
let intradaySortKey = "time";
let intradaySortDir = "desc";
let intradaySignalFilter = "all";
let strategyPresetMode = "";
let strategy5ActiveId = "multi_strategy_confluence";
const INTRADAY_HOT_SCAN_LIMIT = FUMAN_TUNING_CONFIG.intradayHotScanLimit ?? 900;
const REALTIME_RADAR_POOL_LIMIT = FUMAN_TUNING_CONFIG.realtimeRadarPoolLimit ?? 650;
const INTRADAY_BACKGROUND_BATCH = FUMAN_TUNING_CONFIG.intradayBackgroundBatch ?? 450;
const INTRADAY_FAST_SCAN_MS = FUMAN_TUNING_CONFIG.intradayFastScanMs ?? 3000;
const INTRADAY_BACKGROUND_SCAN_MS = FUMAN_TUNING_CONFIG.intradayBackgroundScanMs ?? 3000;
const REALTIME_RADAR_REFRESH_MS = FUMAN_TUNING_CONFIG.realtimeRadarRefreshMs ?? 3000;
const MOBILE_INTRADAY_HOT_SCAN_LIMIT = FUMAN_TUNING_CONFIG.mobileIntradayHotScanLimit ?? 260;
const MOBILE_INTRADAY_FORCE_EXTRA_LIMIT = FUMAN_TUNING_CONFIG.mobileIntradayForceExtraLimit ?? 80;
const MOBILE_INTRADAY_BACKGROUND_BATCH = FUMAN_TUNING_CONFIG.mobileIntradayBackgroundBatch ?? 90;
const MOBILE_INTRADAY_HOT_SCAN_MS = FUMAN_TUNING_CONFIG.mobileIntradayHotScanMs ?? 12000;
const MOBILE_INTRADAY_BACKGROUND_SCAN_MS = FUMAN_TUNING_CONFIG.mobileIntradayBackgroundScanMs ?? 45000;
const MOBILE_OTHER_STRATEGY_RENDER_MS = FUMAN_TUNING_CONFIG.mobileOtherStrategyRenderMs ?? 2500;
const MOBILE_OTHER_STRATEGY_CACHE_MS = FUMAN_TUNING_CONFIG.mobileOtherStrategyCacheMs ?? 45000;
const INTRADAY_CANDIDATE_TTL_MS = FUMAN_TUNING_CONFIG.intradayCandidateTtlMs ?? (15 * 60 * 1000);
const INTRADAY_MIN_VOLUME = FUMAN_TUNING_CONFIG.intradayMinVolume ?? 2000;
const STRATEGY2_INTRADAY_MIN_DISPLAY_PCT = FUMAN_TUNING_CONFIG.strategy2IntradayMinDisplayPct ?? 2;

const SECTOR_MAP = window.FUMAN_SECTOR_MAP || {};
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

function mergeLatestStrategyPrice(item, base) {
  if (!base) return item;
  const close = cleanNumber(base.close);
  const percent = cleanNumber(base.percent);
  const tradeVolume = cleanNumber(base.tradeVolume);
  const value = cleanNumber(base.value);
  return {
    ...item,
    name: base.name || item.name,
    close: close || item.close,
    percent: base.percent !== undefined && base.percent !== "" ? percent : item.percent,
    tradeVolume: tradeVolume || item.tradeVolume,
    value: value || item.value,
  };
}

function formatNumber(value, digits = 2) {
  return cleanNumber(value).toLocaleString("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function pctToneClass(value) {
  const number = cleanNumber(value);
  if (number > 0) return "pct-up";
  if (number < 0) return "pct-down";
  return "pct-flat";
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

function isStrategyCacheActive(key) {
  if (!isViewActive("strategy") || !canRunViewWork("strategy")) return false;
  if (key === "strategy3") return strategyPresetMode === "strategy3";
  if (key === "strategy5") return strategyPresetMode === "strategy5";
  if (key === "strategy4") return selectedStrategyIds.has("swing_radar");
  if (key === "openBuy") return selectedStrategyIds.has("open_buy");
  return true;
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

function refocusStrategyInlineSearch() {
  if (strategyInlineSearchComposing) return;
  const input = document.querySelector("[data-strategy-inline-search]");
  if (!input) return;
  input.focus({ preventScroll: true });
}

function applyStrategyInlineDomFilter() {
  const keyword = strategyKeyword.trim().toLowerCase();
  applyVisibleRowsFilter(strategyView || document, keyword);
}

function applyWarrantInlineDomFilter() {
  const keyword = warrantFlowKeyword.trim().toLowerCase();
  applyVisibleRowsFilter(viewPanels["warrant-flow"] || document, keyword);
}

function applyVisibleRowsFilter(root, keyword) {
  const rows = root.querySelectorAll(".swing-table tbody tr, .intraday-table tbody tr");
  rows.forEach((row) => {
    const hit = !keyword || row.textContent.toLowerCase().includes(keyword);
    row.hidden = !hit;
  });
}

function matchesStrategyKeyword(stock, keyword) {
  if (!keyword) return true;
  const code = String(stock?.code || "");
  const name = String(stock?.name || "").toLowerCase();
  return code.includes(keyword) || name.includes(keyword);
}

function isNumericStrategyKeyword(keyword) {
  return /^\d{2,}$/.test(String(keyword || "").trim());
}

function scheduleStrategySearchRender(delay = 380) {
  clearTimeout(strategySearchTimer);
  strategySearchTimer = setTimeout(() => {
    strategySearchTimer = null;
    renderStrategyScanner();
    refocusStrategyInlineSearch();
  }, delay);
}

async function fetchJson(url, timeout = 8000, options = {}) {
  const startedAt = performance?.now ? performance.now() : Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: options.cache || "no-store",
      headers: options.headers || undefined,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    recordFumanPerformance(url, startedAt, true);
    return payload;
  } catch (error) {
    recordFumanPerformance(url, startedAt, false, error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function recordFumanPerformance(url, startedAt, ok, error = null) {
  const now = performance?.now ? performance.now() : Date.now();
  const item = {
    url: String(url || "").replace(/[?&]t=\d+/g, "").slice(0, 120),
    ms: Math.round(now - startedAt),
    ok: Boolean(ok),
    viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
    mobilePerf: isMobileViewport(),
    at: Date.now(),
    error: error ? (error.message || String(error)).slice(0, 80) : "",
  };
  const boot = window.FUMAN_TERMINAL_BOOT || (window.FUMAN_TERMINAL_BOOT = {});
  const list = Array.isArray(boot.performanceLog) ? boot.performanceLog : [];
  list.push(item);
  boot.performanceLog = list.slice(-40);
  document.querySelector("#fuman-health-performance")?.remove();
}

function versionedDataUrl(url, version = "", force = false) {
  if (force) {
    const windowMs = Math.max(5000, Number(FUMAN_TUNING_CONFIG.cacheBustWindowMs || 30000));
    const bucket = Math.floor(Date.now() / windowMs);
    return `${url}${url.includes("?") ? "&" : "?"}t=${bucket}`;
  }
  const cleanVersion = String(version || "").replace(/[^\w.-]/g, "");
  if (!cleanVersion) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(cleanVersion)}`;
}

async function fetchVersionedJson(url, timeout = 8000, version = "", force = false, options = {}) {
  return fetchJson(versionedDataUrl(url, version, force), timeout, {
    ...options,
    cache: force ? "no-store" : "default",
  });
}

function healthyJsonPayload(payload, kind = "generic") {
  if (!payload || payload.ok === false) return false;
  if (kind === "market") return Boolean(payload.market || payload.indexes || payload.stocks || payload.strongSectors);
  if (kind === "strategy2") return Boolean(normalizeArray(payload.events).length || normalizeArray(payload.records).length);
  if (kind === "institution") return Boolean(payload.data && Object.keys(payload.data).length || normalizeArray(payload.rows).length);
  if (kind === "warrant") return Boolean(normalizeArray(payload.matches).length);
  return true;
}

async function fetchVersionedJsonFallback(candidates, timeout = 8000, kind = "generic") {
  let lastError = null;
  for (const item of candidates.filter(Boolean)) {
    try {
      const payload = await fetchVersionedJson(item.url, item.timeout || timeout, item.version || "latest", item.force || false, item.options || {});
      const healthy = item.validate ? item.validate(payload) : healthyJsonPayload(payload, item.kind || kind);
      if (healthy) return { ...payload, fallbackSource: item.label || item.url };
      throw new Error("unhealthy payload");
    } catch (error) {
      lastError = error;
      recordFumanPerformance((item.label || item.url) + "#fallback", performance?.now ? performance.now() : Date.now(), false, error);
    }
  }
  if (lastError) throw lastError;
  throw new Error("no fallback candidates");
}

function strategyWeight(key) {
  const value = Number(strategyWeightPayload?.weights?.[key]);
  return Number.isFinite(value) && value > 0 ? clamp(value, 0.88, 1.12) : 1;
}

async function loadStrategyWeights(force = false) {
  try {
    strategyWeightPayload = await fetchVersionedJson(endpoints.strategyWeights, 5000, "latest", force);
  } catch (error) {
    recordFrontendError("strategy-weights", error);
  }
  return strategyWeightPayload;
}

async function fetchLiveMemoryJson(key, url, timeout = 8000, ttlMs = 3000, force = false, options = {}) {
  const cached = getLiveMemoryCache(key, ttlMs, force);
  if (cached) {
    recordFumanPerformance(`${url}#memory`, performance?.now ? performance.now() : Date.now(), true);
    return cached;
  }
  const payload = await fetchJson(url, timeout, {
    ...options,
    cache: "no-store",
  });
  return setLiveMemoryCache(key, payload);
}

async function fetchSupabaseLatestPayload(table, timeout = 3500) {
  if (!FUMAN_SUPABASE_URL || !FUMAN_SUPABASE_KEY || !table) return null;
  try {
    const base = FUMAN_SUPABASE_URL.replace(/\/+$/, "");
    const url = `${base}/rest/v1/${encodeURIComponent(table)}?id=eq.latest&select=payload,updated_at&limit=1`;
    const rows = await fetchJson(url, timeout, {
      headers: {
        apikey: FUMAN_SUPABASE_KEY,
        Authorization: `Bearer ${FUMAN_SUPABASE_KEY}`,
        Accept: "application/json",
      },
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.payload) return null;
    return {
      ...row.payload,
      updatedAt: row.payload.updatedAt || row.updated_at,
      cacheSource: "supabase",
    };
  } catch (error) {
    return null;
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
        volume: normalizeTradeVolumeLots(row.volume),
        value: cleanNumber(row.value),
      }))
      .filter((row) => row.date && row.close)
      .sort((a, b) => a.date.localeCompare(b.date)),
    updatedAt: Date.now(),
  };
}

function hasStrategyHistoryRows(code, minRows = 60) {
  const rows = normalizeArray(strategyHistoryData[code]?.rows);
  return rows.length >= minRows;
}

function getRealtimeRadarHistoryTargets(limit = REALTIME_RADAR_HISTORY_TARGET_LIMIT) {
  const pool = latestStocks
    .map((stock) => applyStrategyQuote(stock))
    .filter((stock) => isIntradayTradable(stock))
    .filter((stock) => !isRealtimeRadarLimitUp(stock));
  const shortPressurePool = [...pool]
    .filter((stock) => {
      const inst = getInstitutionTotal(stock.code);
      const pct = cleanNumber(stock.percent ?? stock.pct);
      const value = radarStockValue(stock);
      const volume = cleanNumber(stock.tradeVolume || stock.volume);
      return (
        pct <= -0.6 ||
        (pct < 0 && value >= 100000000) ||
        (pct <= -0.3 && volume >= 2500) ||
        (cleanNumber(inst.foreign) <= -1000 && pct <= 0.8) ||
        (cleanNumber(inst.trust) <= -500 && pct <= 0.8)
      );
    })
    .sort((a, b) => radarStockValue(b) - radarStockValue(a));
  return uniqueStocksByCode([
    ...getIntradayCandidateStocks(pool),
    ...getBaseStrongIntradayStocks(pool),
    ...shortPressurePool,
    ...[...pool].sort((a, b) => getIntradayHotScore(b) - getIntradayHotScore(a)),
  ])
    .filter((stock) => stock?.code && !hasStrategyHistoryRows(stock.code))
    .slice(0, limit);
}

function getRealtimeRadarSnapshotHistoryTargets(rows = [], limit = REALTIME_RADAR_HISTORY_TARGET_LIMIT) {
  return uniqueStocksByCode(normalizeArray(rows))
    .filter((stock) => stock?.code && !hasStrategyHistoryRows(stock.code))
    .slice(0, limit);
}

async function loadRealtimeRadarHistory(stocks = [], options = {}) {
  const force = options.force === true;
  if (realtimeRadarHistoryPromise) return realtimeRadarHistoryPromise;
  if (!force && Date.now() - realtimeRadarHistoryLastAt < REALTIME_RADAR_HISTORY_REFRESH_MS) return 0;
  const codes = [...new Set(normalizeArray(stocks)
    .map((stock) => String(stock?.code || "").replace(/\D/g, "").slice(0, 4))
    .filter((code) => /^\d{4}$/.test(code) && (force || !hasStrategyHistoryRows(code))))];
  if (!codes.length) return 0;

  realtimeRadarHistoryPromise = (async () => {
    let loaded = 0;
    try {
      for (let index = 0; index < codes.length; index += REALTIME_RADAR_HISTORY_BATCH_SIZE) {
        const chunk = codes.slice(index, index + REALTIME_RADAR_HISTORY_BATCH_SIZE);
        const payload = await fetchJson(`${endpoints.history}?codes=${encodeURIComponent(chunk.join(","))}&t=${Date.now()}`, 20000);
        const histories = normalizeArray(payload?.histories || payload?.results || payload?.data);
        histories.forEach((item) => {
          const before = normalizeArray(strategyHistoryData[item?.code]?.rows).length;
          updateStrategyHistory(item);
          if (normalizeArray(strategyHistoryData[item?.code]?.rows).length > before) loaded += 1;
        });
      }
    } catch (error) {
      console.warn("Realtime radar history load failed", error);
    } finally {
      realtimeRadarHistoryLastAt = Date.now();
      realtimeRadarHistoryPromise = null;
    }
    return loaded;
  })();
  return realtimeRadarHistoryPromise;
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
  strategy4LoadedZones = new Set();
  strategy4ScanStamp = normalizeMarketAiDateKey(payload?.scanStamp || payload?.stamp || payload?.date || payload?.usedDate || payload?.tradeDate);
  const scannedCodes = normalizeArray(payload?.scannedCodes);
  scannedCodes.forEach((code) => {
    if (code) strategy4ScannedCodes.add(code);
  });
  if (payload?.total) strategy4ScanTotal = cleanNumber(payload.total);
  updateStrategy4Scan({ matches: normalizeArray(payload?.matches), scannedCodes: [] });
  const zone = String(payload?.zone || "").toUpperCase();
  if (/^[ABC]$/.test(zone)) strategy4LoadedZones.add(zone);
  else if (payload?.complete !== false && !payload?.partial) ["A", "B", "C"].forEach((item) => strategy4LoadedZones.add(item));
  const updatedAt = Date.parse(payload?.updatedAt || "");
  strategy4ScanLastAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
  saveStrategy4LocalCache();
}

function mergeStrategy4ZoneCache(payload, zone) {
  const normalizedZone = String(zone || payload?.zone || "").toUpperCase();
  if (!/^[ABC]$/.test(normalizedZone)) return false;
  strategy4ScanStamp = normalizeMarketAiDateKey(payload?.scanStamp || payload?.stamp || payload?.date || payload?.usedDate || payload?.tradeDate) || strategy4ScanStamp;
  if (payload?.total) strategy4ScanTotal = cleanNumber(payload.total);
  updateStrategy4Scan({ matches: normalizeArray(payload?.matches), scannedCodes: normalizeArray(payload?.scannedCodes) }, { retainUnmatched: true });
  const updatedAt = Date.parse(payload?.updatedAt || "");
  strategy4ScanLastAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
  strategy4LoadedZones.add(normalizedZone);
  saveStrategy4LocalCache();
  return true;
}

function saveStrategy4LocalCache() {
  try {
    const matches = Object.values(strategy4ScanMatches);
    const payload = {
      source: "github-actions",
      updatedAt: strategy4ScanLastAt || Date.now(),
      scanStamp: strategy4ScanStamp,
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
    strategy4ScanStamp = normalizeMarketAiDateKey(payload.scanStamp || payload.stamp || payload.date || payload.usedDate || payload.tradeDate);
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

async function loadStrategy4Summary(force = false) {
  if (strategy4SummaryLoading) return strategy4Summary;
  if (!force && strategy4SummaryLoadedAt && Date.now() - strategy4SummaryLoadedAt < CACHE_FRESH_MS) return strategy4Summary;
  strategy4SummaryLoading = true;
  try {
    const payload = await fetchVersionedJson(endpoints.strategy4Summary, 5000, "latest", force);
    strategy4Summary = payload || null;
    strategy4SummaryLoadedAt = Date.now();
    if (payload?.total) strategy4ScanTotal = cleanNumber(payload.total);
    if (payload?.count) strategy4ScanCount = cleanNumber(payload.count);
    strategy4ScanStamp = normalizeMarketAiDateKey(payload?.scanStamp || payload?.stamp || payload?.date || payload?.usedDate || payload?.tradeDate) || strategy4ScanStamp;
    const updatedAt = Date.parse(payload?.updatedAt || "");
    if (!strategy4ScanLastAt && Number.isFinite(updatedAt)) strategy4ScanLastAt = updatedAt;
    return strategy4Summary;
  } catch (error) {
    return strategy4Summary;
  } finally {
    strategy4SummaryLoading = false;
  }
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
  const today1600 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16, 0, 0, 0).getTime();
  if (now.getTime() >= today1600) return today1600;
  if (now.getTime() >= today0700) return today0700;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 16, 0, 0, 0).getTime();
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

async function loadWarrantFlowSummary(force = false) {
  if (warrantFlowSummaryLoading) return warrantFlowSummary;
  if (!force && warrantFlowSummary) return warrantFlowSummary;
  warrantFlowSummaryLoading = true;
  try {
    warrantFlowSummary = await fetchVersionedJson(endpoints.warrantFlowSummary, 5000, "latest", force);
    const updatedAt = Date.parse(warrantFlowSummary?.updatedAt || "");
    if (!warrantFlowUpdatedAt && Number.isFinite(updatedAt)) warrantFlowUpdatedAt = updatedAt;
    return warrantFlowSummary;
  } catch (error) {
    return warrantFlowSummary;
  } finally {
    warrantFlowSummaryLoading = false;
  }
}

async function loadInstitutionSummary(force = false) {
  if (institutionSummaryLoading) return institutionSummary;
  if (!force && institutionSummary) return institutionSummary;
  institutionSummaryLoading = true;
  try {
    institutionSummary = await fetchVersionedJson(endpoints.institutionSummary, 5000, "latest", force);
    const updatedAt = Date.parse(institutionSummary?.updatedAt || "");
    if (!institutionUpdatedAt && Number.isFinite(updatedAt)) institutionUpdatedAt = updatedAt;
    if (!institutionDate && institutionSummary?.usedDate) institutionDate = institutionSummary.usedDate;
    return institutionSummary;
  } catch (error) {
    return institutionSummary;
  } finally {
    institutionSummaryLoading = false;
  }
}

function getMobileHomeMode() {
  return isIntradayScanWindow() ? "intraday" : "after";
}

function mobileHomeQuickTargets() {
  return getMobileHomeMode() === "intraday"
    ? [
      { label: "策略2", detail: "盤中當沖強訊號", view: "strategy", preset: "策略2" },
      { label: "即時雷達", detail: "多空資金流", view: "realtime-radar" },
      { label: "AI 判讀", detail: "市場熱區快看", view: "market", mode: "ai" },
    ]
    : [
      { label: "買賣超", detail: "外資投信同買", view: "chip-trade" },
      { label: "權證", detail: "優先區熱度", view: "warrant-flow" },
      { label: "策略5", detail: "綜合策略結果", view: "strategy", preset: "策略5" },
    ];
}

function renderMobileHomeMode(payload = marketSummaryPayload) {
  const panel = viewPanels.market;
  if (!panel || !isMobileViewport()) return;
  let strip = panel.querySelector(".mobile-home-mode-strip");
  if (!strip) {
    strip = document.createElement("section");
    strip.className = "mobile-home-mode-strip";
    const anchor = panel.querySelector(".metric-grid");
    if (anchor) anchor.insertAdjacentElement("beforebegin", strip);
    else panel.prepend(strip);
  }
  const mode = getMobileHomeMode();
  const updatedAt = payload?.updatedAt ? new Date(payload.updatedAt).toLocaleTimeString("zh-TW", { hour12: false }) : "更新中";
  strip.innerHTML = `
    <div>
      <strong>${mode === "intraday" ? "盤中快看" : "盤後快看"}</strong>
      <span>${updatedAt}</span>
    </div>
    <nav aria-label="手機首頁快速入口">
      ${mobileHomeQuickTargets().map((item) => `
        <button type="button" data-mobile-home-target="${item.view}" data-mobile-home-preset="${item.preset || ""}" data-mobile-home-mode="${item.mode || ""}">
          <b>${item.label}</b><small>${item.detail}</small>
        </button>
      `).join("")}
    </nav>
  `;
}

function applyMarketSummaryPayload(payload) {
  if (!payload?.ok) return false;
  marketSummaryPayload = payload;
  marketSummaryLoadedAt = Date.now();
  updateMarketStockDataState(payload);
  marketRealtimeState = {
    trading: payload.trading === true,
    marketStatus: payload.marketStatus || "",
    updatedAt: payload.updatedAt || "",
    source: payload.source || "market-summary",
  };
  renderIndexes(
    normalizeArray(payload.indexes),
    payload.futuresNear || payload.futures || null,
    payload.futuresNext || null,
    payload.marketStatus || null,
    payload.otcSignal || null
  );
  const stocks = normalizeArray(payload.stocks);
  if (stocks.length) renderStocks(stocks);
  if (normalizeArray(payload.sectors).length) renderHeatmapSectors(payload.sectors);
  renderMobileHomeMode(payload);
  return true;
}

async function loadMarketSummary(force = false) {
  if (marketSummaryLoading) return marketSummaryPayload;
  if (!force && marketSummaryLoadedAt && Date.now() - marketSummaryLoadedAt < MARKET_REFRESH_CLOSED_MS) return marketSummaryPayload;
  marketSummaryLoading = true;
  try {
    const payload = await fetchVersionedJsonFallback([
      isMobileViewport() && endpoints.mobileHomeSummary ? { url: endpoints.mobileHomeSummary, label: "mobile-home-summary", kind: "market", force } : null,
      { url: endpoints.marketSummary, label: "market-summary", kind: "market", force },
    ], 4500, "market");
    applyMarketSummaryPayload(payload);
    return payload;
  } catch (error) {
    return marketSummaryPayload;
  } finally {
    marketSummaryLoading = false;
  }
}

async function loadTerminalHomeBundle(force = false) {
  if (!endpoints.terminalHomeBundle) return null;
  try {
    const bundle = await fetchVersionedJson(endpoints.terminalHomeBundle, 4500, "latest", force);
    if (bundle?.mobile) {
      renderMobileHomeMode(bundle.mobile);
    }
    if (bundle?.stocks?.top?.length && !latestStocks.length) {
      latestStocks = parseStocksForLatest(bundle.stocks.top);
      if (latestStocks.length) renderStocks(latestStocks);
    }
    if (bundle?.mobile?.health) {
      healthSummaryPayload = {
        ok: true,
        risk: bundle.mobile.health.risk || "low",
        updatedAt: bundle.mobile.health.updatedAt || bundle.updatedAt || "",
        schedule: { badCount: 0 },
        githubSync: { pendingCount: 0 },
      };
      renderHealthPerformancePanel();
    }
    return bundle;
  } catch (error) {
    return null;
  }
}

async function loadHealthSummary(force = false) {
  try {
    healthSummaryPayload = await fetchVersionedJson(endpoints.healthSummary, 5000, "latest", force);
    const schedule = healthSummaryPayload?.schedule || {};
    const github = healthSummaryPayload?.githubSync || {};
    if (terminalMessage && healthSummaryPayload) {
      const state = healthSummaryPayload.ok ? "健康 OK" : "健康需注意";
      terminalMessage.textContent = `${state}｜排程異常 ${schedule.badCount ?? "--"}｜同步待補 ${github.pendingCount ?? "--"}`;
    }
    renderHealthPerformancePanel();
    return healthSummaryPayload;
  } catch (error) {
    return healthSummaryPayload;
  }
}

function healthRiskLevel(summary = healthSummaryPayload) {
  if (!summary) return { level: "unknown", label: "讀取中", tone: "warn" };
  const bad = cleanNumber(summary.schedule?.badCount);
  const pending = cleanNumber(summary.githubSync?.pendingCount);
  const missing = normalizeArray(summary.runtime?.data).filter((item) => !item.ok).length;
  const stale = normalizeArray(summary.risks).filter((item) => item.level === "high").length;
  if (bad || pending > 2 || missing || stale) return { level: "high", label: "高風險", tone: "danger" };
  if (pending || normalizeArray(summary.risks).length) return { level: "medium", label: "中風險", tone: "warn" };
  return { level: "low", label: "低風險", tone: "ok" };
}

function renderHealthPerformancePanel() {
  document.querySelector("#fuman-health-performance")?.remove();
}

function saveWarrantFlowLocalCache() {
  try {
    if (!warrantFlowData.length) return;
    localStorage.removeItem(WARRANT_FLOW_LOCAL_CACHE_KEY);
    return;
    localStorage.setItem(WARRANT_FLOW_LOCAL_CACHE_KEY, JSON.stringify({
      source: "github-actions",
      updatedAt: warrantFlowUpdatedAt || Date.now(),
      matches: warrantFlowData,
    }));
  } catch (error) {}
}

function loadWarrantFlowLocalCache() {
  try { localStorage.removeItem(WARRANT_FLOW_LOCAL_CACHE_KEY); } catch (error) {}
  return false;
}
function showExportNotice(message) {
  if (terminalMessage) terminalMessage.textContent = message;
  const notice = document.createElement("div");
  notice.className = "export-notice";
  notice.textContent = message;
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
  return { ok: response.ok && payload.ok,
    viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`, status: response.status, payload };
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

function openBuyPayloadDateKey(payload = {}) {
  return normalizeMarketAiDateKey(
    payload.usedDate ||
    payload.tradeDate ||
    payload.dataDate ||
    payload.date ||
    marketAiDataDateKey(normalizeArray(payload.matches)) ||
    payload.updatedAt
  );
}

function loadOpenBuyLocalCache() {
  try {
    let payload = JSON.parse(localStorage.getItem(OPEN_BUY_LOCAL_CACHE_KEY) || "{}");
    if (!Array.isArray(payload.matches) || !payload.matches.length) {
      payload = JSON.parse(localStorage.getItem(OPEN_BUY_BACKUP_CACHE_KEY) || "{}");
    }
    if (!String(payload.source || "").includes("github-actions")) return false;
    if (!Array.isArray(payload.matches) || !payload.matches.length) return false;
    openBuyDataDateKey = openBuyPayloadDateKey(payload);
    openBuyCacheSource = payload.cacheSource || payload.source || "local";
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
  openBuyDataDateKey = openBuyPayloadDateKey(payload);
  openBuyCacheSource = payload?.cacheSource || payload?.source || "";
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

async function loadOpenBuySupabasePayload() {
  // Strategy1 currently publishes static JSON; skip the legacy Supabase REST probe to avoid harmless 400 noise.
  return null;
}

async function loadOpenBuyStaticPayload() {
  let payload = await fetchVersionedJson(endpoints.openBuyCache, 10000, "latest", false);
  if (!normalizeArray(payload?.matches).length) {
    payload = await fetchVersionedJson(endpoints.openBuyBackup, 10000, "latest", false);
  }
  return {
    ...payload,
    cacheSource: "static",
  };
}

async function loadOpenBuyCache(force = false) {
  if (!isStrategyCacheActive("openBuy")) return;
  if (openBuyCacheLoading) return;
  if (!shouldLoadOpenBuyRemote(force)) return;
  if (shouldSkipMobileOtherStrategyCacheRefresh("openBuy", Object.keys(openBuyScanMatches).length > 0, force)) {
    renderStrategyScanner();
    return;
  }
  openBuyCacheLoading = true;
  openBuyCacheCheckedAt = Date.now();
  try {
    const payload = await loadOpenBuySupabasePayload() || await loadOpenBuyStaticPayload();
    const incomingMatches = normalizeArray(payload?.matches);
    const hasCurrentMatches = Object.keys(openBuyScanMatches).length > 0;
    const hasCompleteScan = payload?.fullScan && normalizeArray(payload?.scannedCodes).length;
    if (payload?.ok && Array.isArray(payload.matches) && (incomingMatches.length || !hasCurrentMatches || hasCompleteScan)) {
      mergeOpenBuyCache(payload);
      renderStrategyScanner();
    }
  } catch (error) {
  } finally {
    openBuyCacheLoading = false;
  }
}

async function loadStrategy3Cache(force = false) {
  if (!isStrategyCacheActive("strategy3")) return;
  if (strategy3CacheLoading) return;
  if (!force && strategy3Data.length) return;
  if (shouldSkipMobileOtherStrategyCacheRefresh("strategy3", strategy3Data.length > 0, force)) {
    renderStrategyScanner();
    return;
  }
  strategy3CacheLoading = true;
  try {
    let payload = await fetchVersionedJson(endpoints.strategy3Cache, 10000, "latest", force);
    if (!normalizeArray(payload?.matches).length) {
      payload = await fetchVersionedJson(endpoints.strategy3Backup, 10000, "latest", force);
    }
    strategy3Data = normalizeArray(payload?.matches);
    const updatedAt = Date.parse(payload?.updatedAt || "");
    strategy3UpdatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    strategy3UsedDateKey = normalizeMarketAiDateKey(payload?.usedDate || payload?.date || payload?.quoteDate) || marketAiDataDateKey(strategy3Data);
    renderStrategyScanner();
  } catch (error) {
  } finally {
    strategy3CacheLoading = false;
  }
}

async function loadStrategy3RadarVolumeCache() {
  if (strategy3Data.length || strategy3CacheLoading) return;
  strategy3CacheLoading = true;
  try {
    let payload = await fetchVersionedJson(endpoints.strategy3Cache, 10000, "latest", false);
    if (!normalizeArray(payload?.matches).length) {
      payload = await fetchVersionedJson(endpoints.strategy3Backup, 10000, "latest", false);
    }
    strategy3Data = normalizeArray(payload?.matches);
    const updatedAt = Date.parse(payload?.updatedAt || "");
    strategy3UpdatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    strategy3UsedDateKey = normalizeMarketAiDateKey(payload?.usedDate || payload?.date || payload?.quoteDate) || marketAiDataDateKey(strategy3Data);
    if (isViewActive("realtime-radar")) renderRealtimeRadar();
  } catch (error) {
  } finally {
    strategy3CacheLoading = false;
  }
}

async function loadStrategy5Cache(force = false) {
  if (!isStrategyCacheActive("strategy5")) return;
  if (strategy5CacheLoading) return;
  if (!force && strategy5Data.length) return;
  if (shouldSkipMobileOtherStrategyCacheRefresh("strategy5", strategy5Data.length > 0, force)) {
    renderStrategyScanner();
    return;
  }
  strategy5CacheLoading = true;
  try {
    let payload = await fetchVersionedJson(endpoints.strategy5Cache, 10000, "latest", force);
    if (!normalizeArray(payload?.matches).length) {
      payload = await fetchVersionedJson(endpoints.strategy5Backup, 10000, "latest", force);
    }
    strategy5Data = normalizeArray(payload?.matches);
    const updatedAt = Date.parse(payload?.updatedAt || "");
    strategy5UpdatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    strategy5UsedDateKey = normalizeMarketAiDateKey(payload?.usedDate || payload?.date || payload?.quoteDate) || "";
    renderStrategyScanner();
  } catch (error) {
  } finally {
    strategy5CacheLoading = false;
  }
}

function updateStrategyQuote(quote) {
  if (!quote?.code || !quote.close) return;
  if (!isRealtimeRadarQuoteTime(quote)) return;
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
    quoteDate: quote.quoteDate || quote.tradeDate || (isMarketAiActiveSession() ? marketAiTodayKey() : stock.quoteDate) || marketAiTodayKey(),
    quoteTime: quote.time || stock.quoteTime,
    quoteUpdatedAt: quote.updatedAt || Date.now(),
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


const FUMAN_STRATEGY_CONFIG = window.FUMAN_STRATEGY_CONFIG || {};
const STRATEGY_DEFS = FUMAN_STRATEGY_CONFIG.STRATEGY_DEFS || [];
const STRATEGY_BY_ID = FUMAN_STRATEGY_CONFIG.STRATEGY_BY_ID || Object.fromEntries(STRATEGY_DEFS.map((item) => [item.id, item]));
const STRATEGY5_IDS = FUMAN_STRATEGY_CONFIG.STRATEGY5_IDS || [];
const STRATEGY5_PRESET_IDS = FUMAN_STRATEGY_CONFIG.STRATEGY5_PRESET_IDS || [];
const STRATEGY5_BASE_PRESET_IDS = FUMAN_STRATEGY_CONFIG.STRATEGY5_BASE_PRESET_IDS || STRATEGY5_PRESET_IDS.filter((id) => id !== "multi_strategy_confluence");
const STRATEGY5_CARD_META = FUMAN_STRATEGY_CONFIG.STRATEGY5_CARD_META || {};
const INTRADAY_EXCLUDED_CODES = FUMAN_STRATEGY_CONFIG.INTRADAY_EXCLUDED_CODES || new Set();
const INTRADAY_SIGNAL_DEFS = FUMAN_STRATEGY_CONFIG.INTRADAY_SIGNAL_DEFS || [];
const SWING_SIGNAL_DEFS = FUMAN_STRATEGY_CONFIG.SWING_SIGNAL_DEFS || [];

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

function getIntradayTrackedEntryPrice(stock) {
  const stateId = stock?.intradayState?.id || getIntradayState(stock)?.id || "";
  const tracked = stock?.strategy2Event || strategy2IntradayEventByCode.get(String(stock?.code || ""));
  const price = stateId === "go"
    ? cleanNumber(tracked?.latestAPrice) || cleanNumber(tracked?.firstAPrice) || cleanNumber(tracked?.latestBPrice) || cleanNumber(tracked?.firstBPrice)
    : cleanNumber(tracked?.latestBPrice) || cleanNumber(tracked?.firstBPrice) || cleanNumber(tracked?.latestAPrice) || cleanNumber(tracked?.firstAPrice);
  return price
    || cleanNumber(stock?.intradayEntry?.entryPrice)
    || cleanNumber(stock?.intradayEntry?.entryLow)
    || cleanNumber(stock?.entryPrice)
    || cleanNumber(stock?.observedPrice)
    || cleanNumber(stock?.close);
}

function formatIntradayTrackedEntry(stock) {
  return formatTradePrice(getIntradayTrackedEntryPrice(stock));
}

function limitUpDojiPattern(stock) {
  const daily = stock.swingDaily || analyzeSwingDaily(stock);
  const rows = normalizeArray(daily?.rows);
  if (rows.length < 12) return { hit: false, score: 0, reason: "日K資料不足，等待歷史資料補齊。" };
  const last = rows.at(-1);
  const prev = rows.at(-2);
  const lastVolume = cleanNumber(last?.volume);
  const lastPct = prev?.close ? ((cleanNumber(last.close) - cleanNumber(prev.close)) / cleanNumber(prev.close)) * 100 : cleanNumber(stock.percent);
  const setupStart = Math.max(0, rows.length - 21);

  for (let limitIndex = rows.length - 10; limitIndex >= setupStart; limitIndex--) {
    const limitDay = rows[limitIndex];
    const limitPrev = rows[limitIndex - 1];
    const limitPct = limitPrev?.close ? ((cleanNumber(limitDay.close) - cleanNumber(limitPrev.close)) / cleanNumber(limitPrev.close)) * 100 : 0;
    const limitVolume = cleanNumber(limitDay.volume);
    if (limitPct < 9.0 || cleanNumber(limitDay.close) < cleanNumber(limitDay.open)) continue;

    const dojiEnd = Math.min(rows.length - 9, limitIndex + 5);
    for (let dojiIndex = limitIndex + 1; dojiIndex <= dojiEnd; dojiIndex++) {
      const doji = rows[dojiIndex];
      const dojiRange = cleanNumber(doji.high) - cleanNumber(doji.low);
      const dojiBodyRatio = dojiRange > 0 ? Math.abs(cleanNumber(doji.close) - cleanNumber(doji.open)) / dojiRange : 1;
      const dojiNearLimit = cleanNumber(doji.close) >= cleanNumber(limitDay.close) * 0.93;
      if (dojiBodyRatio > 0.35 || !dojiNearLimit) continue;

      const boxRows = rows.slice(dojiIndex + 1, -1);
      if (boxRows.length < 7) continue;
      const boxHigh = Math.max(...boxRows.map((row) => cleanNumber(row.high)).filter(Boolean));
      const boxLow = Math.min(...boxRows.map((row) => cleanNumber(row.low)).filter(Boolean));
      const boxRangePct = boxLow ? ((boxHigh - boxLow) / boxLow) * 100 : 99;
      const boxVolumes = boxRows.map((row) => cleanNumber(row.volume)).filter(Boolean);
      const boxAvgVolume = avg(boxVolumes);
      const recentBoxVolume = avg(boxVolumes.slice(-3));
      const volumeContracting = boxAvgVolume > 0 && recentBoxVolume > 0 &&
        recentBoxVolume <= boxAvgVolume * 1.05 &&
        (!limitVolume || recentBoxVolume <= limitVolume * 0.85);
      const breakout = cleanNumber(last.close) >= boxHigh * 0.995 &&
        cleanNumber(last.close) > cleanNumber(last.open) &&
        lastPct >= 0.5 &&
        boxAvgVolume > 0 &&
        lastVolume >= boxAvgVolume * 1.15;
      if (boxRangePct <= 30 && volumeContracting && breakout) {
        const score = clamp(Math.round(72 + Math.min(lastPct * 3, 18) + Math.min(lastVolume / boxAvgVolume * 4, 10)), 0, 100);
        return {
          hit: true,
          score,
          reason: `近20日漲停後出十字星，橫盤 ${boxRows.length} 天、區間 ${boxRangePct.toFixed(2)}%，縮量後今日放量 ${boxAvgVolume ? (lastVolume / boxAvgVolume).toFixed(2) : "--"} 倍突破。`,
        };
      }
    }
  }
  return { hit: false, score: 0, reason: "" };
}

function strategyHit(id, stock) {
  const pct = stock.percent || 0;
  const valueRank = stock.valueRank || 0;
  const volumeRank = stock.volumeRank || 0;
  const inst = stock.inst || getInstitutionTotal(stock.code);
  const smartMoney = inst.total + inst.trust * 1.4;
  const close = cleanNumber(stock.close);
  const limitUpDoji = limitUpDojiPattern(stock);
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
    limit_up_doji: {
      hit: limitUpDoji.hit && close >= 10 && valueRank >= 35,
      score: clamp(Math.max(scoreBase, limitUpDoji.score), 0, 100),
      reason: limitUpDoji.reason || "漲停十字星戰法型態成立。",
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
    signals.push({ id: "v_reversal", short: "轉", icon: "V", reason: vFast ? `3日急跌後放量翻紅，RSI ${daily.rsi14.toFixed(1)}，偏V型快殺反彈。` : `跌深後收紅並突破前高，V轉積分達標。` });
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

function intradayTimeToValue(value) {
  const match = String(value || "").match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function isIntradayClockTime(value) {
  const seconds = intradayTimeToValue(value);
  return seconds >= 9 * 3600 && seconds <= (13 * 3600 + 30 * 60);
}

function intradayOnlyTime(value) {
  const text = String(value || "");
  const match = text.match(/(\d{2}:\d{2}(?::\d{2})?)/);
  return match && isIntradayClockTime(match[1]) ? match[1] : "";
}

function intradayNowSeconds() {
  const scanDate = strategyLastScanAt ? realtimeRadarDateKeyFromTimestamp(strategyLastScanAt) : "";
  const sourceTime = scanDate === marketAiTodayKey() ? strategyLastScanAt : Date.now();
  const timeText = new Date(sourceTime).toLocaleTimeString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });
  return intradayTimeToValue(timeText);
}

function intradayVisibleTimeLimit() {
  if (!isIntradayScanWindow()) return 13 * 3600 + 30 * 60;
  return Math.min(Math.max(intradayNowSeconds(), 9 * 3600), 13 * 3600 + 30 * 60);
}

function isIntradayVisibleSessionRow(stock) {
  const seconds = intradayTimeToValue(getIntradayEntryTime(stock));
  return seconds >= 9 * 3600 && seconds <= intradayVisibleTimeLimit();
}

function isIntradayVisibleTimeText(value) {
  const seconds = intradayTimeToValue(value);
  return seconds >= 9 * 3600 && seconds <= intradayVisibleTimeLimit();
}

function sanitizeStrategy2IntradayEvent(event) {
  if (!event) return null;
  const copy = { ...event };
  [
    "firstBAt",
    "highAfterBAt",
    "firstAAt",
    "firstTradableAAt",
    "latestAAt",
    "latestBAt",
    "latestSeenAt",
    "highAfterAAt",
    "highestAt",
  ].forEach((key) => {
    if (copy[key] && !isIntradayVisibleTimeText(copy[key])) copy[key] = "";
  });
  copy.enhancements = normalizeArray(copy.enhancements).filter((item) => isIntradayVisibleTimeText(item?.at));
  const hasVisibleTime = [
    copy.firstBAt,
    copy.firstAAt,
    copy.latestAAt,
    copy.latestBAt,
    copy.latestSeenAt,
  ].some(Boolean);
  return hasVisibleTime ? copy : null;
}

function isStrategy2TodayIntradayStock(stock) {
  if (!isIntradayScanWindow()) return true;
  const today = marketAiTodayKey();
  const quoteDate = marketAiQuoteDateKey(stock);
  if (quoteDate && quoteDate !== today) return false;
  const updatedAt = cleanNumber(stock?.quoteUpdatedAt || stock?.updatedAt);
  if (updatedAt && realtimeRadarDateKeyFromTimestamp(updatedAt) !== today) return false;
  return true;
}

function getIntradayEntryTime(stock) {
  if (stock?.intradayEntryTime && isIntradayVisibleTimeText(stock.intradayEntryTime)) return stock.intradayEntryTime;
  const tracked = strategy2IntradayEventByCode.get(String(stock?.code || ""));
  const stateId = stock?.intradayState?.id || "";
  if (stateId === "go") {
    if (tracked?.latestAAt && isIntradayVisibleTimeText(tracked.latestAAt)) return tracked.latestAAt;
    if (tracked?.firstAAt && isIntradayVisibleTimeText(tracked.firstAAt)) return tracked.firstAAt;
    if (tracked?.latestSeenAt && isIntradayVisibleTimeText(tracked.latestSeenAt)) return tracked.latestSeenAt;
    if (tracked?.firstSeenAt && isIntradayVisibleTimeText(tracked.firstSeenAt)) return tracked.firstSeenAt;
  }
  if (tracked?.latestBAt && isIntradayVisibleTimeText(tracked.latestBAt)) return tracked.latestBAt;
  if (tracked?.latestAAt && isIntradayVisibleTimeText(tracked.latestAAt)) return tracked.latestAAt;
  if (tracked?.latestSeenAt && isIntradayVisibleTimeText(tracked.latestSeenAt)) return tracked.latestSeenAt;
  if (tracked?.firstBAt && isIntradayVisibleTimeText(tracked.firstBAt)) return tracked.firstBAt;
  if (tracked?.firstAAt && isIntradayVisibleTimeText(tracked.firstAAt)) return tracked.firstAAt;
  if (tracked?.firstSeenAt && isIntradayVisibleTimeText(tracked.firstSeenAt)) return tracked.firstSeenAt;
  const quoteTime = stock?.quoteTime || strategyRealtimeQuotes[stock?.code]?.time || "";
  if (quoteTime && isIntradayVisibleTimeText(quoteTime)) return quoteTime;
  const seenAt = cleanNumber(stock?.intradayFirstSeenAt) || cleanNumber(intradayFirstSeenAt.get(stock?.code));
  if (seenAt) {
    const seenTime = new Date(seenAt).toLocaleTimeString("zh-TW", { hour12: false });
    if (isIntradayClockTime(seenTime)) return seenTime;
  }
  return "--:--";
}

function resetStrategy2IntradaySessionCache() {
  strategy2IntradayEventByCode = new Map();
  strategy2IntradayCacheDate = "";
  strategy2IntradayCacheLoadedAt = 0;
  intradayFirstSeenAt.clear();
  intradayGoFirstSeenAt.clear();
}

function ensureStrategy2IntradayTodayCache() {
  const cacheDate = normalizeMarketAiDateKey(strategy2IntradayCacheDate);
  if (!cacheDate || cacheDate === marketAiTodayKey()) return;
  resetStrategy2IntradaySessionCache();
}

function isStrategy2EnhancementVisible(enhancement) {
  if (!enhancement) return false;
  const trigger = String(enhancement.trigger || "");
  const deltaVolume = cleanNumber(enhancement.deltaVolume);
  const ma35 = cleanNumber(enhancement.ma35);
  const ma35Prev = cleanNumber(enhancement.ma35Prev);
  const aboveMa35 = enhancement.aboveMa35 !== false && ma35 > 0;
  const ma35TrendUp = enhancement.ma35TrendUp === true || (ma35 > 0 && ma35Prev > 0 && ma35 > ma35Prev);
  return aboveMa35
    && ma35TrendUp
    && (
      trigger === "volume"
      || trigger === "text"
      || trigger === "score"
      || deltaVolume >= 50
    );
}

function isTrustedStrategy2Ma35Source(source) {
  return new Set(["fugle-1m", "yahoo-1m", "local-1m", "twelve-1m"]).has(String(source || ""));
}

function isBackendStrategy2Entry(event) {
  const stateId = String(event?.stateId || "");
  return stateId === "entry" || stateId === "go";
}

function hasVerifiedStrategy2Ma35(event) {
  const record = event?.latestRecord || {};
  const ma35 = cleanNumber(event?.ma35) || cleanNumber(record.ma35);
  const source = String(event?.ma35Source || record.ma35Source || "");
  const aboveMa35 = event?.aboveMa35 === true || record.aboveMa35 === true;
  return ma35 > 0 && aboveMa35 && isTrustedStrategy2Ma35Source(source);
}

function strategy2SignalFromTrackedEvent(event) {
  const verifiedMa35 = hasVerifiedStrategy2Ma35(event);
  const strategies = normalizeArray(event?.strategies)
    .map((item) => String(item))
    .filter((item) => verifiedMa35 || !/MA35/i.test(item));
  const text = [event?.stateReason, event?.reason, event?.latestRecord?.reason, ...strategies].join(" ");
  const matched = INTRADAY_SIGNAL_DEFS.find((signal) => text.includes(signal.title) || text.includes(signal.id));
  if (matched && (matched.id !== "ma35_macd" || verifiedMa35)) {
    return {
      id: matched.id,
      short: matched.title,
      icon: matched.icon,
      reason: event?.stateReason || event?.latestRecord?.reason || matched.hint || "策略2後端事件",
    };
  }
  if (text.includes("鑽石") || text.includes("0.618")) {
    return { id: "diamond", short: "鑽石", icon: "💎", reason: event?.stateReason || event?.latestRecord?.reason || "策略2後端事件" };
  }
  if (verifiedMa35 && text.includes("MA35")) {
    return { id: "ma35_macd", short: "MA35", icon: "🟢", reason: event?.stateReason || event?.latestRecord?.reason || "策略2後端事件" };
  }
  return { id: "early_strength", short: "早盤強", icon: "⚡", reason: event?.stateReason || event?.latestRecord?.reason || "策略2後端事件" };
}

function strategy2DisplaySignals(signals, trackedEvent) {
  if (trackedEvent) return [strategy2SignalFromTrackedEvent(trackedEvent)];
  return normalizeArray(signals).filter((signal) => !/^ma35/i.test(String(signal?.id || "")));
}

function stockRowFromStrategy2Event(event, base) {
  if (!event?.code) return null;
  const record = event.latestRecord || {};
  const latestEnhancement = normalizeArray(event.enhancements)
    .filter(isStrategy2EnhancementVisible)
    .at(-1) || {};
  const close = cleanNumber(base?.close) || cleanNumber(record.close) || cleanNumber(record.observedPrice) || cleanNumber(event.latestAPrice) || cleanNumber(event.firstAPrice);
  const percent = base?.percent !== undefined && base?.percent !== "" ? cleanNumber(base.percent) : cleanNumber(record.percent ?? event.percent);
  const tradeVolume = cleanNumber(base?.tradeVolume) || cleanNumber(base?.volume) || cleanNumber(record.tradeVolume) || cleanNumber(record.volume) || cleanNumber(event.tradeVolume) || cleanNumber(event.volume) || cleanNumber(latestEnhancement.totalVolume);
  const open = cleanNumber(base?.open) || cleanNumber(record.open);
  const high = cleanNumber(base?.high) || cleanNumber(record.observedHigh) || close;
  const low = cleanNumber(base?.low) || cleanNumber(record.low) || close;
  const signal = strategy2SignalFromTrackedEvent(event);
  return {
    ...(base || {}),
    code: String(event.code),
    name: base?.name || event.name || record.name || String(event.code),
    close,
    percent,
    tradeVolume,
    volume: tradeVolume,
    value: cleanNumber(base?.value) || (close && tradeVolume ? close * tradeVolume * 1000 : 0),
    open,
    high,
    low,
    intradaySignals: [signal],
    intradayState: isBackendStrategy2Entry(event)
      ? { id: "go", label: event.stateLabel || "進場區", cls: "go" }
      : { id: "watch", label: event.stateLabel || "待確認", cls: "watch" },
    strategy2Event: event,
    intradayEntryTime: event.latestAAt || event.firstAAt || event.latestSeenAt || event.firstSeenAt || record.timestamp || record.entryAt || "",
  };
}

function getIntradaySortValue(stock, key) {
  const seenAt = cleanNumber(stock.intradayFirstSeenAt) || cleanNumber(intradayFirstSeenAt.get(stock.code));
  const values = {
    time: intradayTimeToValue(getIntradayEntryTime(stock)) || seenAt,
    code: Number(stock.code) || 0,
    price: cleanNumber(stock.close),
    percent: stock.percent || 0,
    volume: cleanNumber(stock.tradeVolume) || cleanNumber(stock.volume),
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

function sortIntradayZoneRows(rows) {
  return [...rows].sort((a, b) => {
    const diff = getIntradaySortValue(b, "time") - getIntradaySortValue(a, "time");
    if (diff) return diff;
    return (b.intradaySignals?.length || 0) - (a.intradaySignals?.length || 0);
  });
}

async function loadStrategy2IntradayPayload(force = false) {
  const allowSupabase = shouldRunLivePolling();
  if (allowSupabase && endpoints.strategy2IntradayLatestApi) {
    try {
      const apiPayload = await fetchLiveMemoryJson(
        "strategy2:latest-api",
        versionedDataUrl(endpoints.strategy2IntradayLatestApi, "latest", force),
        isMobileViewport() ? 2500 : 3500,
        FUMAN_LIVE_MEMORY_TTL_MS.strategy2,
        force
      );
      if (apiPayload?.records || apiPayload?.events) {
        return { ...apiPayload, cacheSource: apiPayload.cacheSource || "supabase-api" };
      }
    } catch (error) {
      recordFrontendError("strategy2-latest-api", error);
    }
  }
  const restPayload = allowSupabase ? await fetchSupabaseLatestPayload("strategy2_latest", isMobileViewport() ? 3000 : 4500) : null;
  if (restPayload) return restPayload;
  if (allowSupabase && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from("strategy2_latest")
        .select("payload,updated_at")
        .eq("id", "latest")
        .maybeSingle();
      if (!error && data?.payload) {
        return {
          ...data.payload,
          updatedAt: data.payload.updatedAt || data.updated_at,
          cacheSource: "supabase",
        };
      }
    } catch (error) {
      recordFrontendError("strategy2-supabase", error);
    }
  }
  const mobileFastPath = isMobileViewport() && !force && (endpoints.strategy2IntradayLiveTop || endpoints.strategy2IntradayTop || endpoints.strategy2IntradaySlim);
  if (mobileFastPath && strategy2IntradayEventByCode.size && endpoints.strategy2IntradayDelta) {
    try {
      const deltaPayload = await fetchVersionedJsonFallback([
        { url: endpoints.strategy2IntradayDelta, label: "strategy2-delta", kind: "strategy2" },
        { url: endpoints.strategy2IntradayLiveTop, label: "strategy2-live-top", kind: "strategy2" },
      ], 3000, "strategy2");
      return { ...deltaPayload, cacheSource: deltaPayload.source || "static-delta" };
    } catch (error) {
    }
  }
  if (mobileFastPath) {
    try {
      const preferredTop = isIntradayScanWindow()
        ? (endpoints.strategy2IntradayLiveTop || endpoints.strategy2IntradayTop || endpoints.strategy2IntradaySlim)
        : (endpoints.strategy2IntradayTop || endpoints.strategy2IntradayLiveTop || endpoints.strategy2IntradaySlim);
      const slimPayload = await fetchVersionedJsonFallback([
        { url: preferredTop, label: "strategy2-preferred-top", kind: "strategy2" },
        { url: endpoints.strategy2IntradayTop, label: "strategy2-top", kind: "strategy2" },
        { url: endpoints.strategy2IntradaySlim, label: "strategy2-slim", kind: "strategy2" },
      ], 4000, "strategy2");
      return { ...slimPayload, cacheSource: slimPayload.source || "static-mobile-top" };
    } catch (error) {
    }
  }
  const payload = await fetchVersionedJson(endpoints.strategy2IntradayCache, 10000, "latest", force);
  return {
    ...payload,
    cacheSource: "static",
  };
}

async function loadStrategy2IntradayCache(force = false) {
  ensureStrategy2IntradayTodayCache();
  if (strategy2IntradayCacheLoading) return;
  if (!force && strategy2IntradayEventByCode.size) return;
  strategy2IntradayCacheLoading = true;
  try {
    const payload = await loadStrategy2IntradayPayload(force);
    const payloadDate = normalizeMarketAiDateKey(payload?.date || payload?.updatedAt);
    if (payloadDate && payloadDate !== marketAiTodayKey()) {
      resetStrategy2IntradaySessionCache();
      return;
    }
    const events = normalizeArray(payload?.events).map(sanitizeStrategy2IntradayEvent).filter(Boolean);
    const byCode = new Map(events
      .filter((event) => event?.code)
      .map((event) => [String(event.code), {
        ...event,
        enhancements: normalizeArray(event.enhancements).filter(isStrategy2EnhancementVisible),
      }]));
    normalizeArray(payload?.records).forEach((record) => {
      const code = String(record?.code || "");
      if (!code) return;
      const seenTime = intradayOnlyTime(record.timestamp || record.entryAt || record.firstAAt || record.firstBAt);
      if (!seenTime) return;
      if (!isIntradayVisibleTimeText(seenTime)) return;
      const current = byCode.get(code) || { code, name: record.name || "", stateId: "wait", stateLabel: "待確認" };
      if (!current.stateId) {
        current.stateId = "wait";
        current.stateLabel = "待確認";
      }
      const currentSeen = current.firstSeenAt || current.firstBAt || current.firstAAt || "";
      if (!currentSeen || intradayTimeToValue(seenTime) < intradayTimeToValue(currentSeen)) {
        current.firstSeenAt = seenTime;
      }
      const isEntryState = record.stateId === "entry" || record.stateId === "go";
      const seenValue = intradayTimeToValue(seenTime);
      const currentLatestValue = intradayTimeToValue(current.latestSeenAt || "");
      if (!current.latestSeenAt || seenValue >= currentLatestValue) {
        current.latestSeenAt = seenTime;
        current.latestSeenPrice = cleanNumber(record.entryPrice) || cleanNumber(record.observedPrice) || cleanNumber(record.close);
        current.latestRecord = record;
      }
      if (isEntryState && !current.firstAAt) current.firstAAt = seenTime;
      if (isEntryState && (!current.latestAAt || seenValue >= intradayTimeToValue(current.latestAAt))) {
        current.latestAAt = seenTime;
        current.latestAPrice = cleanNumber(record.entryPrice) || cleanNumber(record.observedPrice) || cleanNumber(record.close);
      }
      if (isEntryState) {
        current.stateId = record.stateId === "go" ? "go" : "entry";
        current.stateLabel = record.stateLabel || "進場區";
      }
      if (!isEntryState && !current.firstBAt) current.firstBAt = seenTime;
      if (!isEntryState && (!current.latestBAt || seenValue >= intradayTimeToValue(current.latestBAt))) {
        current.latestBAt = seenTime;
        current.latestBPrice = cleanNumber(record.entryPrice) || cleanNumber(record.observedPrice) || cleanNumber(record.close);
      }
      byCode.set(code, current);
    });
    strategy2IntradayCacheDate = payload?.date || "";
    strategy2IntradayEventByCode = byCode;
    strategy2IntradayCacheLoadedAt = Date.now();
    if (isViewActive("strategy") && selectedStrategyIds.has("intraday_2m")) {
      renderStrategyScanner();
    }
  } catch (error) {
  } finally {
    strategy2IntradayCacheLoading = false;
  }
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
    return { id: "go", label: "進場區", cls: "go" };
  }
  if (tradableLiquidity && hasSignal && pct >= 0.5 && hasStrongSignal) {
    return { id: "watch", label: "待確認", cls: "watch" };
  }
  return { id: "watch", label: "待確認", cls: "watch" };
}

function intradaySortHeader(key, label) {
  const active = intradaySortKey === key;
  const mark = active ? (intradaySortDir === "asc" ? " ▲" : " ▼") : " ↕";
  return `<button type="button" data-intraday-sort="${key}">${label}${mark}</button>`;
}

const TERMINAL_PAGE_SIZE = FUMAN_TUNING_CONFIG.terminalPageSize ?? 10;
const TERMINAL_PAGE_SIZE_OPTIONS = FUMAN_TUNING_CONFIG.terminalPageSizeOptions || [10, 20, 50];
const terminalPageSizes = {
  swing: 50,
  openBuy: 20,
  strategy3: 20,
  strategy5: 20,
  warrant: 20,
  chip: 20,
  ...(FUMAN_TUNING_CONFIG.terminalPageSizes || {}),
};

function getTerminalPageSize(scope) {
  const configured = cleanNumber(terminalPageSizes[scope]);
  return TERMINAL_PAGE_SIZE_OPTIONS.includes(configured) ? configured : TERMINAL_PAGE_SIZE;
}

function paginateTerminalRows(rows, currentPage, scope = "") {
  const list = Array.isArray(rows) ? rows : [];
  const pageSize = getTerminalPageSize(scope);
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const page = Math.min(Math.max(Number(currentPage) || 1, 1), totalPages);
  const start = (page - 1) * pageSize;
  return {
    page,
    totalPages,
    pageSize,
    rows: list.slice(start, start + pageSize),
  };
}

function buildTerminalPagination(scope, page, totalPages, totalRows) {
  const pageSize = getTerminalPageSize(scope);
  if (totalRows <= pageSize && !scope) return "";
  const sizeButtons = TERMINAL_PAGE_SIZE_OPTIONS.map((size) => (
    `<button class="${pageSize === size ? "active" : ""}" type="button" data-terminal-page-size-scope="${scope}" data-terminal-page-size="${size}">${size}</button>`
  )).join("");
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
      <span class="terminal-page-size" aria-label="每頁筆數">${sizeButtons}</span>
    </div>
  `;
}

loadFumanStyle("terminal-intraday-radar.css", "intraday-radar-styles");

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
      ? "16:00 後產生明日候選，08:55 後看最終名單，09:00 開盤入，有賺就走。"
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
  refreshDataFreshnessBars();
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
  ensureStrategy2IntradayTodayCache();
  const cacheRefreshDue = isIntradayScanWindow()
    && (!strategy2IntradayCacheLoadedAt || Date.now() - strategy2IntradayCacheLoadedAt > Math.max(REALTIME_RADAR_REFRESH_MS, 3000));
  if ((!strategy2IntradayEventByCode.size || cacheRefreshDue) && !strategy2IntradayCacheLoading) {
    loadStrategy2IntradayCache(cacheRefreshDue);
  }
  const keyword = strategyKeyword.trim().toLowerCase();
  const now = Date.now();
  const scanClosed = !isIntradayScanWindow();
  const baseRows = evaluated
    .filter(isIntradayTradable)
    .filter(isStrategy2TodayIntradayStock)
    .filter((stock) => !isRealtimeRadarLimitUp(stock))
    .filter((stock) => matchesStrategyKeyword(stock, keyword));
  const baseByCode = new Map(baseRows.map((stock) => [String(stock.code || ""), stock]));
  const realtimeRows = baseRows
    .filter((stock) => (stock.intradaySignals || []).length || strategy2IntradayEventByCode.has(String(stock.code || "")))
    .map((stock) => {
      const signals = stock.intradaySignals || [];
      const row = { ...stock, intradaySignals: signals };
      const trackedEvent = strategy2IntradayEventByCode.get(String(row.code || ""));
      const intradayState = isBackendStrategy2Entry(trackedEvent)
        ? { id: "go", label: trackedEvent.stateLabel || "進場區", cls: "go" }
        : { id: "watch", label: trackedEvent?.stateLabel || "待確認", cls: "watch" };
      const trackedTime = intradayState.id === "go"
        ? trackedEvent?.latestAAt || trackedEvent?.firstAAt || trackedEvent?.latestSeenAt || trackedEvent?.firstSeenAt || ""
        : trackedEvent?.latestBAt || trackedEvent?.latestSeenAt || trackedEvent?.firstBAt || trackedEvent?.firstAAt || "";
      const mergedSignals = strategy2DisplaySignals(signals, trackedEvent);
      if (!intradayFirstSeenAt.has(row.code)) {
        intradayFirstSeenAt.set(row.code, now);
      }
      if (intradayState.id === "go" && !intradayGoFirstSeenAt.has(row.code)) {
        intradayGoFirstSeenAt.set(row.code, now);
      }
      return {
        ...row,
        tradeVolume: cleanNumber(row.tradeVolume) || cleanNumber(row.volume),
        volume: cleanNumber(row.volume) || cleanNumber(row.tradeVolume),
        intradaySignals: mergedSignals,
        intradayState,
        strategy2Event: trackedEvent || null,
        intradayEntryTime: trackedTime,
        intradayFirstSeenAt: intradayFirstSeenAt.get(row.code) || null,
        intradayGoFirstSeenAt: intradayGoFirstSeenAt.get(row.code) || null,
      };
    });
  const realtimeCodes = new Set(realtimeRows.map((stock) => String(stock.code || "")));
  const cachedRows = Array.from(strategy2IntradayEventByCode.values())
    .filter((event) => !realtimeCodes.has(String(event.code || "")))
    .map((event) => stockRowFromStrategy2Event(event, baseByCode.get(String(event.code || ""))))
    .filter(Boolean)
    .filter((stock) => isIntradayTradable(stock))
    .filter((stock) => matchesStrategyKeyword(stock, keyword));
  const allRows = [...realtimeRows, ...cachedRows];
  const sessionRows = allRows.filter(isIntradayVisibleSessionRow);
  const tradableRows = scanClosed
    ? sessionRows.filter((stock) => stock.strategy2Event && getIntradayEntryTime(stock) !== "--:--")
    : sessionRows;
  const signalScopeRows = tradableRows.filter((stock) => cleanNumber(stock.percent) >= STRATEGY2_INTRADAY_MIN_DISPLAY_PCT);
  const displayPoolRows = signalScopeRows;
  const stateFilters = new Set(["go", "watch"]);
  const filteredRows = intradaySignalFilter === "all"
    ? signalScopeRows
    : stateFilters.has(intradaySignalFilter)
      ? signalScopeRows.filter((stock) => stock.intradayState.id === intradaySignalFilter)
      : displayPoolRows.filter((stock) => (stock.intradaySignals || []).some((signal) => signal.id === intradaySignalFilter));
  const rows = sortIntradayRows(filteredRows).slice(0, 80);
  const signalCounts = Object.fromEntries(INTRADAY_SIGNAL_DEFS.map((signal) => [signal.id, 0]));
  const stateCounts = { go: 0, watch: 0 };
  signalScopeRows.forEach((stock) => {
    stateCounts[stock.intradayState.id] += 1;
    (stock.intradaySignals || []).forEach((signal) => {
      signalCounts[signal.id] = (signalCounts[signal.id] || 0) + 1;
    });
  });
  const sortedAllRows = sortIntradayZoneRows(signalScopeRows);
  const zoneRows = {
    go: sortedAllRows.filter((stock) => stock.intradayState.id === "go").slice(0, 3),
    watch: sortedAllRows.filter((stock) => stock.intradayState.id === "watch").slice(0, 3),
  };
  const scanTime = strategyLastScanAt
    ? new Date(strategyLastScanAt).toLocaleTimeString("zh-TW", { hour12: false })
    : "等待開盤";
  const scanStatus = scanClosed
    ? "｜盤後停止偵測，顯示 09:00-13:30 最後資料"
    : strategyLastScanAt
    ? `｜本輪巡邏 ${strategyRealtimeStats.received}/${strategyRealtimeStats.requested} 筆${strategyRealtimeStats.failed ? `｜失敗批次 ${strategyRealtimeStats.failed}` : ""}${strategyRealtimeStats.lastError ? `｜${strategyRealtimeStats.lastError}` : ""}`
    : "";

  if (strategySummary) strategySummary.textContent = scanClosed
    ? `偵測時間 09:00-13:30｜收盤後停止偵測｜最後更新 ${scanTime}${scanStatus}`
    : `09:00-13:30 即時巡邏｜不顯示目前時間之後的舊快取｜最後更新 ${scanTime}${scanStatus}`;
  if (strategyMatchCount) strategyMatchCount.textContent = signalScopeRows.length.toLocaleString("zh-TW");
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
    ["all", "全部", signalScopeRows.length],
    ["go", "進場區", stateCounts.go],
    ...INTRADAY_SIGNAL_DEFS.map((signal) => [signal.id, signal.title, signalCounts[signal.id] || 0]),
  ].map(([id, label, count]) => `<button class="${intradaySignalFilter === id ? "active" : ""}" type="button" data-intraday-filter="${id}">${label}(${count})</button>`).join("");

  const renderZonePicks = (list, zoneId) => list.length ? list.map((stock, index) => {
    const sign = stock.percent >= 0 ? "+" : "";
    const pctClass = pctToneClass(stock.percent);
    const latestEnhancement = normalizeArray(stock.strategy2Event?.enhancements)
      .filter(isStrategy2EnhancementVisible)
      .at(-1);
    const hotFire = latestEnhancement ? `<span class="intraday-hot-fire" title="持續爆量且多次進入進場區">🔥</span>` : "";
    const mainSignal = latestEnhancement ? "持續放量" : stock.intradaySignals[0]?.short || "量價";
    const entry = formatIntradayTrackedEntry(stock);
    const quoteTime = getIntradayEntryTime(stock);
    const timeText = `<span class="intraday-pick-time">${quoteTime}</span>`;
    return `
      <div class="intraday-pick">
        <span class="intraday-rank">${index + 1}</span>
        ${timeText}
        <div class="intraday-pick-main">
          <b>${hotFire}${stock.code} ${stock.name}</b>
          <span>${mainSignal}｜進場 ${entry}</span>
        </div>
        <div class="intraday-pick-price">
          <b class="${pctClass}">${sign}${stock.percent.toFixed(2)}%</b>
          <span>${formatNumber(stock.close, stock.close >= 100 ? 0 : 2)}</span>
        </div>
      </div>
    `;
  }).join("") : `<div class="intraday-empty">目前沒有符合條件。</div>`;

  const zones = `
    <section class="intraday-zones">
      <article class="intraday-zone go">
        <header><div><h3>進場區</h3><small>1分K站上MA35，MACD/KD向上且爆量</small></div><strong>${stateCounts.go}</strong></header>
        <div class="intraday-picks">${renderZonePicks(zoneRows.go, "go")}</div>
      </article>
    </section>
  `;

  const emptyText = scanClosed
    ? "策略2偵測時間為 09:00-13:30；收盤後停止新增訊號，顯示盤中最後資料。"
    : "策略2正在 3 秒巡邏；目前本輪尚未出現漲幅 +2% 以上且符合右側訊號的股票。";
  const headerText = scanClosed
    ? `偵測時間 09:00-13:30，收盤後停止偵測。最後更新 ${scanTime}${scanStatus}`
    : `09:00-13:30 即時偵測漲幅 +2% 以上強勢訊號，3秒巡邏熱門池，不顯示目前時間之後的快取資料。最後更新 ${scanTime}${scanStatus}`;

  const quickRows = rows.slice(0, 6);
  const mobileQuickCards = `
    <section class="mobile-intraday-quick" aria-label="策略2手機快看">
      <div class="mobile-intraday-quick-head">
        <span>手機快看</span>
        <strong>${quickRows.length ? `${quickRows.length} 檔強訊號` : "等待訊號"}</strong>
      </div>
      <div class="mobile-intraday-quick-grid">
        ${quickRows.length ? quickRows.map((stock, index) => {
          const sign = stock.percent >= 0 ? "+" : "";
          const pctClass = pctToneClass(stock.percent);
          const displayVolume = cleanNumber(stock.tradeVolume) || cleanNumber(stock.volume);
          const latestEnhancement = normalizeArray(stock.strategy2Event?.enhancements).filter(isStrategy2EnhancementVisible).at(-1);
          const mainSignal = latestEnhancement ? "持續放量" : stock.intradaySignals[0]?.short || "量價";
          const reason = latestEnhancement
            ? `持續放量${latestEnhancement.deltaVolume ? `｜新增量 ${Math.round(latestEnhancement.deltaVolume).toLocaleString("zh-TW")} 張` : ""}`
            : stock.intradaySignals[0]?.reason || "盤中訊號觸發";
          const state = stock.intradayState || getIntradayState(stock);
          return `
            <article class="mobile-intraday-card ${state.cls}">
              <header>
                <span>#${index + 1}</span>
                <b>${stock.code} ${stock.name}</b>
                <em class="intraday-state ${state.cls}">${state.label}</em>
              </header>
              <div class="mobile-intraday-card-main">
                <strong class="${pctClass}">${sign}${stock.percent.toFixed(2)}%</strong>
                <span>進場 ${formatIntradayTrackedEntry(stock)}</span>
                <span>量 ${Math.round(displayVolume).toLocaleString("zh-TW")}</span>
              </div>
              <p>${mainSignal}｜${reason}</p>
            </article>
          `;
        }).join("") : `<div class="mobile-intraday-empty">${emptyText}</div>`}
      </div>
    </section>
  `;


  const tableRows = rows.length ? `
    ${rows.map((stock) => {
      const sign = stock.percent >= 0 ? "+" : "";
      const pctClass = pctToneClass(stock.percent);
      const displayVolume = cleanNumber(stock.tradeVolume) || cleanNumber(stock.volume);
      const entryTime = getIntradayEntryTime(stock);
      const latestEnhancement = normalizeArray(stock.strategy2Event?.enhancements)
        .filter(isStrategy2EnhancementVisible)
        .at(-1);
      const repeatAHot = Boolean(latestEnhancement);
      const enhancementChip = latestEnhancement ? `<b>🔥 持續放量</b>` : "";
      const chips = `${enhancementChip}${stock.intradaySignals.map((signal) => `<b>${signal.icon} ${signal.short}</b>`).join("")}`;
      const reason = latestEnhancement
        ? `${latestEnhancement.at || entryTime} ${stock.code} ${stock.name} 持續放量${latestEnhancement.deltaVolume ? `｜新增量 ${Math.round(latestEnhancement.deltaVolume).toLocaleString("zh-TW")} 張` : ""}`
        : stock.intradaySignals[0]?.reason || "盤中訊號觸發";
      const state = stock.intradayState || getIntradayState(stock);
      return `
        <tr>
          <td><span class="intraday-table-time">${entryTime}</span></td>
          <td><span class="code intraday-hot-code">${repeatAHot ? `<span class="intraday-hot-fire" title="持續爆量且多次進入進場區">🔥</span>` : ""}${stock.code}</span></td>
          <td>${stock.name}</td>
          <td><span class="intraday-state ${state.cls}">${state.label}</span></td>
          <td><span class="intraday-badges">${chips}</span></td>
          <td class="price">${formatIntradayTrackedEntry(stock)}</td>
          <td class="pct ${pctClass}">${sign}${stock.percent.toFixed(2)}%</td>
          <td>${Math.round(displayVolume).toLocaleString("zh-TW")}</td>
          <td class="intraday-entry">${renderEntryPlan(stock.intradayEntry)}</td>
          <td>現價 ${formatTradePrice(stock.close)}｜${reason}</td>
        </tr>
      `;
    }).join("")}
  ` : `
    <tr><td colspan="10">${emptyText}</td></tr>
  `;

  strategyTable.innerHTML = `
    <section class="intraday-dashboard">
      <div class="intraday-topbar">
        <div>
          <h2>${titleWithSchedule("◔", "策略2-當沖雷達", "intraday")}</h2>
          <p>${headerText}</p>
        </div>
        <div class="intraday-controls">
          <label>偵測頻率：<select><option>${scanClosed ? "09:00-13:30" : "3秒"}</option></select></label>
          <label>市場：<select><option>全市場</option></select></label>
        </div>
      </div>
      ${renderDataFreshnessBarHtml("strategy")}
      <section class="intraday-main-layout intraday-main-layout-full">
        <div class="intraday-main-panel">
          ${zones}
          ${mobileQuickCards}
          <section class="intraday-panel">
            <div class="intraday-tabs">
              ${tabs}
              <div class="intraday-actions">
                <input type="search" placeholder="搜尋代號/名稱" value="${escapeAttr(strategyKeyword)}" autocomplete="off" spellcheck="false" inputmode="search" data-strategy-inline-search>
                <button type="button" data-export-action>匯出</button>
                <button type="button" data-export-settings>設定</button>
              </div>
            </div>
            <table class="intraday-table">
              <thead>
                <tr>
                  <th>${intradaySortHeader("time", "進場時間")}</th><th>${intradaySortHeader("code", "股票代號")}</th><th>股票名稱</th><th>狀態</th><th>訊號</th><th>${intradaySortHeader("price", "進場價")}</th><th>${intradaySortHeader("percent", "漲幅")}</th><th>${intradaySortHeader("volume", "成交量")}</th><th>風控</th><th>原因</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </section>
        </div>
      </section>
    </section>
  `;
}

function renderSwingRadar(universe) {
  setStrategyChrome("swing");
  if (!strategy4ScanLastAt) {
    loadStrategy4LocalCache();
  }
  if (!strategy4ScanLastAt && !strategy4SummaryLoading) {
    loadStrategy4Summary().then(() => {
      if (isViewActive("strategy") && selectedStrategyIds.has("swing_radar")) renderStrategyScanner();
    });
  }
  const scanCount = strategy4ScanCount || Object.keys(strategy4ScanMatches).length;
  const scannedCount = strategy4ScannedCodes.size;
  const totalCount = strategy4ScanTotal || strategy4Summary?.total || latestStocks.filter((stock) => !/^00/.test(stock.code)).length || latestStocks.length;
  if (!strategy4ScanLastAt && !strategy4CacheLoading) loadStrategy4Cache();
  const keyword = strategyKeyword.trim().toLowerCase();
  const visibleKeyword = swingVisibleKeyword.trim().toLowerCase();
  const numericKeyword = isNumericStrategyKeyword(keyword);
  const latestByCode = new Map(latestStocks.map((stock) => [String(stock.code || ""), stock]));
  const sourceRows = numericKeyword
    ? Object.values(strategy4ScanMatches).filter((stock) => String(stock.code || "").includes(keyword))
    : Object.values(strategy4ScanMatches);
  const allRows = sourceRows
    .map((stock) => mergeLatestStrategyPrice(stock, latestByCode.get(String(stock.code || ""))))
    .filter((stock) => (stock.swingSignals || []).length)
    .filter((stock) => matchesStrategyKeyword(stock, keyword))
    .filter((stock) => !visibleKeyword || `${stock.code || ""} ${stock.name || ""}`.toLowerCase().includes(visibleKeyword))
    .map((stock) => ({
      ...stock,
      swingScore: Math.round(cleanNumber(stock.swingScore || stock.score || 0) * strategyWeight("strategy4Multiplier")),
    }));
  const renderCacheSignature = [
    strategy4ScanLastAt,
    Object.keys(strategy4ScanMatches).length,
    latestStocks.length,
    keyword,
    visibleKeyword,
    swingZoneFilter,
    swingSignalFilter,
    swingSortKey,
    swingSortDir,
  ].join(":");
  let zoneRows;
  let signalCounts;
  let rows;
  if (renderCacheSignature === swingRenderCacheSignature && swingRenderCacheRows.length) {
    rows = swingRenderCacheRows;
    zoneRows = swingRenderCacheZoneRows;
    signalCounts = swingRenderCacheSignalCounts;
  } else {
    zoneRows = {
      A: sortSwingRows(allRows.filter((stock) => (stock.swingZone || "A") === "A")),
      B: sortSwingRows(allRows.filter((stock) => stock.swingZone === "B")),
      C: sortSwingRows(allRows.filter((stock) => stock.swingZone === "C")),
    };
    const zoneFilteredRows = swingZoneFilter === "all"
      ? allRows
      : allRows.filter((stock) => (stock.swingZone || "A") === swingZoneFilter);
    const filteredRows = swingSignalFilter === "all"
      ? zoneFilteredRows
      : zoneFilteredRows.filter((stock) => (stock.swingSignals || []).some((signal) => signal.id === swingSignalFilter));
    rows = sortSwingRows(filteredRows);
    signalCounts = Object.fromEntries(SWING_SIGNAL_DEFS.map((signal) => [signal.id, 0]));
    allRows.forEach((stock) => {
      (stock.swingSignals || []).forEach((signal) => {
        signalCounts[signal.id] = (signalCounts[signal.id] || 0) + 1;
      });
    });
    swingRenderCacheSignature = renderCacheSignature;
    swingRenderCacheRows = rows;
    swingRenderCacheZoneRows = zoneRows;
    swingRenderCacheSignalCounts = signalCounts;
    warmSwingWorkerCache(renderCacheSignature, allRows, {
      zoneFilter: swingZoneFilter,
      signalFilter: swingSignalFilter,
      sortKey: swingSortKey,
      sortDir: swingSortDir,
    });
  }
  const swingPaged = paginateTerminalRows(rows, swingPage, "swing");
  swingPage = swingPaged.page;
  const pageRows = swingPaged.rows;
  const scanTime = strategyLastScanAt
    ? new Date(strategyLastScanAt).toLocaleTimeString("zh-TW", { hour12: false })
    : new Date().toLocaleTimeString("zh-TW", { hour12: false });
  const historyText = strategy4ScanLastAt
    ? `波段快取 ${scannedCount}/${totalCount}｜命中 ${scanCount}｜${new Date(strategy4ScanLastAt).toLocaleTimeString("zh-TW", { hour12: false })}`
    : strategy4Summary
    ? `波段摘要 ${strategy4Summary.count || 0}/${totalCount}｜完整名單載入中`
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

  const formatSwingSignalChip = (signal) => {
    if (signal?.id === "v_reversal") return "<b>V轉</b>";
    return `<b>${signal.icon || ""} ${signal.short || ""}</b>`;
  };

  const renderSwingRows = (items) => items.map((stock) => {
    const sign = stock.percent >= 0 ? "+" : "";
    const pctClass = pctToneClass(stock.percent);
    const chips = stock.swingSignals.map(formatSwingSignalChip).join("");
    const signalIds = (stock.swingSignals || []).map((signal) => signal.id).join(" ");
    const searchText = `${stock.code || ""} ${stock.name || ""}`.toLowerCase();
    const stage = stock.swingStage || getSwingStage(stock);
    const reason = stock.swingSignals[0]?.reason || "波段訊號觸發";
    return `
      <tr data-swing-row data-swing-signals="${escapeAttr(signalIds)}" data-swing-search="${escapeAttr(searchText)}">
        <td><span class="code">${stock.code}</span></td>
        <td>${stock.name}</td>
        <td><span class="swing-badges">${chips}</span></td>
        <td class="price">${formatNumber(stock.close, stock.close >= 100 ? 0 : 2)}</td>
        <td class="pct ${pctClass}">${sign}${stock.percent.toFixed(2)}%</td>
        <td>${Math.round(stock.tradeVolume || 0).toLocaleString("zh-TW")}</td>
        <td><span class="swing-stage ${stage.tone}">${stage.label}</span><small>${stage.ratio}</small></td>
        <td><span class="swing-score">${stock.swingScore}</span></td>
        <td>${reason}</td>
      </tr>
    `;
  }).join("");
  const zoneCards = `
    <div class="swing-zone-card zone-a ${swingZoneFilter === "A" ? "active" : ""}" data-swing-zone-filter="A"><span>A區可進場</span><strong>${zoneRows.A.length}</strong><small>正式波段買點</small></div>
    <div class="swing-zone-card zone-b ${swingZoneFilter === "B" ? "active" : ""}" data-swing-zone-filter="B"><span>B區觀察</span><strong>${zoneRows.B.length}</strong><small>趨勢轉強等待買點</small></div>
    <div class="swing-zone-card zone-c ${swingZoneFilter === "C" ? "active" : ""}" data-swing-zone-filter="C"><span>C區準備</span><strong>${zoneRows.C.length}</strong><small>低中位階整理</small></div>
  `;
  const tableRows = pageRows.length ? renderSwingRows(pageRows) : `
    <tr><td colspan="9">${strategy4Summary ? `策略4摘要已載入：命中 ${strategy4Summary.count || 0} 檔。正在背景載入完整名單...` : "後端策略4掃描 API 已啟動。正在完整掃描全台股官方日K並計算符合股票；命中後會自動顯示在這裡。"}</td></tr>
  `;
  const swingTableHead = `
    <thead>
      <tr>
        <th>${swingSortHeader("code", "股票代號")}</th><th>股票名稱</th><th>訊號</th><th>${swingSortHeader("price", "現價")}</th><th>${swingSortHeader("percent", "漲幅")}</th><th>${swingSortHeader("volume", "成交量")}</th><th>${swingSortHeader("stage", "位階")}</th><th>${swingSortHeader("score", "分數")}</th><th>原因</th>
      </tr>
    </thead>
  `;
  const renderZoneSection = (zone, title, subtitle, items) => `
    <section class="swing-zone-panel zone-${zone.toLowerCase()}">
      <div class="swing-zone-head">
        <div>
          <h3>${title}</h3>
          <small>${subtitle}</small>
        </div>
        <strong>${items.length}</strong>
      </div>
      <table class="swing-table swing-zone-table">
        ${swingTableHead}
        <tbody>${items.length ? renderSwingRows(items) : `<tr><td colspan="9">目前沒有符合 ${title} 的股票。</td></tr>`}</tbody>
      </table>
    </section>
  `;
  const zoneMeta = {
    all: ["全部區域", "A/B/C 合併列表", allRows.length],
    A: ["A區可進場", "正式波段買點", zoneRows.A.length],
    B: ["B區觀察", "趨勢轉強，等待突破", zoneRows.B.length],
    C: ["C區準備", "低/中位階整理，提前蹲點", zoneRows.C.length],
  };
  const [activeZoneTitle, activeZoneSubtitle, activeZoneCount] = zoneMeta[swingZoneFilter] || zoneMeta.all;
  const showZoneLayout = !visibleKeyword && !numericKeyword;
  const pagination = buildTerminalPagination("swing", swingPage, swingPaged.totalPages, rows.length);
  const zoneSections = showZoneLayout ? `
    <div class="swing-zone-summary">
      ${zoneCards}
    </div>
    <div class="swing-zone-stack">
      ${renderZoneSection(swingZoneFilter === "all" ? "A" : swingZoneFilter, activeZoneTitle, activeZoneSubtitle, pageRows)}
      ${pagination}
    </div>
  ` : "";
  const hadSearchFocus = document.activeElement === swingVisibleSearchInput;
  const searchSelectionStart = hadSearchFocus ? swingVisibleSearchInput.selectionStart : null;
  const searchSelectionEnd = hadSearchFocus ? swingVisibleSearchInput.selectionEnd : null;
  const strategy4Freshness = renderStrategy4FreshnessBarHtml();

  strategyTable.innerHTML = `
    <section class="swing-dashboard">
      <div class="swing-topbar">
        <div>
          <h2>${titleWithSchedule("└", "策略4-波段雷達", "swing")}</h2>
          <p>排除ETF，只掃真正股票；網站讀取上一版完整快取，14:30 背景更新正式名單。${historyText}</p>
        </div>
        <div class="swing-controls">
          <label>更新模式：<select><option>14:30 完整掃</option></select></label>
          <label>市場：<select><option>全市場</option></select></label>
        </div>
      </div>
      ${strategy4Freshness}
      <div class="swing-signal-grid">${cards}</div>
      <section class="swing-panel">
        <div class="swing-tabs">
          ${tabs}
          <div class="strategy4-visible-search-row" data-swing-search-host></div>
        </div>
        ${showZoneLayout ? zoneSections : `
          <table class="swing-table">
            ${swingTableHead}
            <tbody>${tableRows}</tbody>
          </table>
          ${pagination}
        `}
      </section>
    </section>
  `;
  mountSwingVisibleSearchInput(hadSearchFocus, searchSelectionStart, searchSelectionEnd);
}

function applySwingFilterToVisibleRows() {
  const panel = strategyTable?.querySelector(".swing-dashboard");
  if (!panel) return false;
  const keyword = swingVisibleKeyword.trim().toLowerCase();
  panel.querySelectorAll("[data-swing-filter]").forEach((button) => {
    const active = (button.dataset.swingFilter || "all") === swingSignalFilter;
    button.classList.toggle("active", active);
    button.classList.toggle("selected", active);
  });
  panel.querySelectorAll("[data-swing-zone-filter]").forEach((button) => {
    button.classList.toggle("active", (button.dataset.swingZoneFilter || "all") === swingZoneFilter);
  });
  panel.querySelectorAll("[data-swing-row]").forEach((row) => {
    const signals = String(row.dataset.swingSignals || "").split(/\s+/);
    const passSignal = swingSignalFilter === "all" || signals.includes(swingSignalFilter);
    const passKeyword = !keyword || String(row.dataset.swingSearch || row.textContent || "").toLowerCase().includes(keyword);
    row.hidden = !passSignal || !passKeyword;
  });
  return true;
}

function getSwingVisibleSearchInput() {
  if (swingVisibleSearchInput) return swingVisibleSearchInput;
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "搜尋目前結果代號/名稱";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.inputMode = "numeric";
  input.dataset.swingVisibleSearch = "";
  input.addEventListener("input", () => {
    swingVisibleKeyword = input.value || "";
    swingPage = 1;
    renderStrategyScanner();
  });
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => event.stopPropagation());
  input.addEventListener("keyup", (event) => event.stopPropagation());
  swingVisibleSearchInput = input;
  return input;
}

function mountSwingVisibleSearchInput(restoreFocus = false, selectionStart = null, selectionEnd = null) {
  const host = strategyTable?.querySelector("[data-swing-search-host]");
  if (!host) return;
  const input = getSwingVisibleSearchInput();
  input.value = swingVisibleKeyword || "";
  host.replaceChildren(input);
  if (restoreFocus) {
    input.focus({ preventScroll: true });
    if (Number.isInteger(selectionStart) && Number.isInteger(selectionEnd)) {
      input.setSelectionRange(selectionStart, selectionEnd);
    }
  }
}


function openBuyReasonMetric(reason, pattern, formatter) {
  const match = String(reason || "").match(pattern);
  if (!match) return null;
  return formatter(match);
}

function renderOpenBuyReasonBadges(stock) {
  const reason = String(stock.reason || "昨日強勢，列入開盤入候選。");
  const parts = reason.split("：");
  const setup = parts.length > 1 && parts[0].trim().length <= 12 ? parts[0].trim() : (stock.status || "通過");
  const body = parts.length > 1 ? parts.slice(1).join("：").trim() : reason;
  const percent = cleanNumber(stock.percent);
  const volumeRatio = cleanNumber(stock.volumeRatio || stock.VolumeRatio || stock.volume_ratio) || null;
  const metrics = [];

  const pushMetric = (label, tone = "") => {
    if (label && !metrics.some((item) => item.label === label)) metrics.push({ label, tone });
  };

  if (Number.isFinite(percent)) pushMetric(`漲幅 ${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`, percent >= 9 ? "hot" : "warm");
  pushMetric(openBuyReasonMetric(reason, /成交量\s*([\d,]+)\s*張/, (match) => `成交量 ${match[1]}`), "warm");
  if (volumeRatio) pushMetric(`量比 ${formatNumber(volumeRatio, 2)}`, volumeRatio >= 2 ? "hot" : "warm");
  else pushMetric(openBuyReasonMetric(reason, /量比\s*([\d.]+)/, (match) => `量比 ${match[1]}`), "warm");
  pushMetric(openBuyReasonMetric(reason, /收盤站上MA35\s*([\d.]+)/, (match) => `MA35 ${match[1]}`), "neutral");
  if (stock.score) pushMetric(`分數 ${Math.round(cleanNumber(stock.score))}`, "neutral");

  const tags = [];
  const addTag = (label, tone = "") => {
    if (!tags.some((item) => item.label === label)) tags.push({ label, tone });
  };

  addTag(setup || "通過", "hot");
  if (/紅K|強攻|突破|站上/.test(reason)) addTag("紅K強攻", "hot");
  if (/成交量|量比|量增/.test(reason)) addTag("量能達標", "warm");
  if (/MA35|均線|月線/.test(reason)) addTag("均線站回", "neutral");
  if (/法人|外資|投信/.test(reason)) addTag("法人偏多", "hot");
  addTag("停損致意", "cool");

  const metricHtml = metrics.slice(0, 5).map((item) => `<span class="open-buy-reason-chip ${item.tone}">${escapeAttr(item.label)}</span>`).join("");
  const tagHtml = tags.slice(0, 5).map((item) => `<span class="open-buy-reason-tag ${item.tone}">${escapeAttr(item.label)}</span>`).join("");

  return `
    <div class="open-buy-reason-card">
      <strong class="open-buy-reason-title">${escapeAttr(setup || "通過")}</strong>
      <div class="open-buy-reason-chips">${metricHtml}</div>
      <p>${escapeAttr(body || reason)}</p>
      <div class="open-buy-reason-tags">${tagHtml}</div>
    </div>`;
}

function renderStrategy3ReasonBadges(stock) {
  const reason = String(stock.activeMatch?.reason || "隔日沖籌碼與量價候選。");
  const parts = reason.split("：");
  const setup = parts.length > 1 && parts[0].trim().length <= 16 ? parts[0].trim() : "隔日沖候選";
  const body = parts.length > 1 ? parts.slice(1).join("：").trim() : reason;
  const percent = cleanNumber(stock.percent);
  const tradeVolume = cleanNumber(stock.tradeVolume || stock.volumeLots || stock.volume);
  const turnoverRate = cleanNumber(stock.turnoverRate);
  const volumeRatio = cleanNumber(stock.volumeRatio || stock.projectedRatio);
  const score = cleanNumber(stock.score || stock.overnightScore);
  const metrics = [];
  const tags = [];
  const pushMetric = (label, tone = "") => {
    if (label && !metrics.some((item) => item.label === label)) metrics.push({ label, tone });
  };
  const addTag = (label, tone = "") => {
    if (label && !tags.some((item) => item.label === label)) tags.push({ label, tone });
  };

  if (Number.isFinite(percent)) pushMetric(`漲幅 ${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`, percent >= 4 ? "hot" : "warm");
  if (Number.isFinite(tradeVolume) && tradeVolume > 0) pushMetric(`成交量 ${Math.round(tradeVolume).toLocaleString("zh-TW")}`, "warm");
  if (Number.isFinite(turnoverRate) && turnoverRate > 0) pushMetric(`周轉率 ${formatNumber(turnoverRate, 2)}%`, turnoverRate >= 5 ? "hot" : "warm");
  if (Number.isFinite(volumeRatio) && volumeRatio > 0) pushMetric(`量比 ${formatNumber(volumeRatio, 2)}`, volumeRatio >= 2 ? "hot" : "warm");
  if (Number.isFinite(score) && score > 0) pushMetric(`分數 ${Math.round(score)}`, "neutral");

  addTag(setup, "hot");
  addTag("隔日沖", "hot");
  if (Number.isFinite(tradeVolume) && tradeVolume > 0) addTag("量能達標", "warm");
  if (Number.isFinite(turnoverRate) && turnoverRate > 0) addTag("周轉達標", "warm");
  if (Number.isFinite(volumeRatio) && volumeRatio > 0) addTag("量比達標", "neutral");
  addTag("停損致意", "cool");

  const metricHtml = metrics.slice(0, 5).map((item) => `<span class="open-buy-reason-chip ${item.tone}">${escapeAttr(item.label)}</span>`).join("");
  const tagHtml = tags.slice(0, 5).map((item) => `<span class="open-buy-reason-tag ${item.tone}">${escapeAttr(item.label)}</span>`).join("");

  return `
    <div class="open-buy-reason-card strategy3-reason-card">
      <strong class="open-buy-reason-title">${escapeAttr(setup)}</strong>
      <div class="open-buy-reason-chips">${metricHtml}</div>
      <p>${escapeAttr(body || reason)}</p>
      <div class="open-buy-reason-tags">${tagHtml}</div>
    </div>`;
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
  const openBuyPaged = paginateTerminalRows(rows, openBuyPage, "openBuy");
  openBuyPage = openBuyPaged.page;
  const pageRows = openBuyPaged.rows;

  const scanText = openBuyScanLastAt
    ? `已掃描 ${scannedCount}/${totalCount}｜候選 ${scanCount}｜${new Date(openBuyScanLastAt).toLocaleTimeString("zh-TW", { hour12: false })}`
    : `等待後端掃描 0/${totalCount}`;
  const openBuyFreshnessDate = openBuyDataDateKey || marketAiDataDateKey(Object.values(openBuyScanMatches));
  const openBuyFreshnessToday = marketAiTodayKey();
  const openBuyFreshnessIsToday = openBuyFreshnessDate === openBuyFreshnessToday;
  const openBuyFreshnessClass = openBuyFreshnessIsToday ? "is-live" : "is-stale";
  const openBuyFreshnessText = openBuyFreshnessIsToday ? "" : "｜非今日資料不採用";
  const openBuyFreshness = `
    <div class="data-freshness-bar open-buy-freshness-bar ${openBuyFreshnessClass}" data-open-buy-freshness-bar="1">
      模式：<strong>策略1｜最新可用收盤資料</strong>｜資料日期：<strong>${escapeAttr(formatMarketAiDateKey(openBuyFreshnessDate))}</strong>｜今日：<strong>${escapeAttr(formatMarketAiDateKey(openBuyFreshnessToday))}</strong>${openBuyFreshnessText}
    </div>`;

  if (strategySummary) strategySummary.textContent = `策略1-明日開盤入｜14:30後產生明日候選｜08:55後看最終名單｜${scanText}`;
  if (strategyMatchCount) strategyMatchCount.textContent = rows.length.toLocaleString("zh-TW");
  if (strategyAvgScore) strategyAvgScore.textContent = rows.length ? Math.round(rows.reduce((sum, stock) => sum + stock.score, 0) / rows.length) : "--";
  if (strategyTopHit) strategyTopHit.textContent = rows.length ? "+1.2%" : "--";

  const getOpenBuyDisplayStatus = (stock) => {
    const reasonTag = String(stock.reason || "").split("：")[0].trim();
    if (reasonTag === "開盤無腦入") return "開盤入";
    if (reasonTag && reasonTag.length <= 8) return reasonTag;
    if (stock.status === "開盤無腦入") return "開盤入";
    return stock.status || "開盤入";
  };

  const tableRows = pageRows.length ? pageRows.map((stock) => {
    const sign = stock.percent >= 0 ? "+" : "";
    const pctClass = pctToneClass(stock.percent);
    const displayStatus = getOpenBuyDisplayStatus(stock);
    return `
      <tr>
        <td><span class="code">${stock.code}</span></td>
        <td>${stock.name}</td>
        <td><b class="swing-stage mid">${displayStatus}</b></td>
        <td class="price">${formatNumber(stock.close, stock.close >= 100 ? 0 : 2)}</td>
        <td class="pct ${pctClass}">${sign}${stock.percent.toFixed(2)}%</td>
        <td>${stock.entry || "09:00 開盤價"}</td>
        <td class="price">${formatNumber(stock.takeProfit, stock.takeProfit >= 100 ? 1 : 2)}</td>
        <td class="price">${formatNumber(stock.stopLoss, stock.stopLoss >= 100 ? 1 : 2)}</td>
        <td><span class="swing-score">${stock.score}</span></td>
        <td class="open-buy-reason-cell">${renderOpenBuyReasonBadges(stock)}</td>
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
          <p>16:00後先出明日候選；08:55後看最終名單。買入：09:00 開盤價｜停利 +1.2%｜停損 -1.0%｜09:10 強制出場。${scanText}</p>
        </div>
        <div class="swing-controls">
          <label>更新模式：<select><option>07:00 / 16:00 完整掃</option></select></label>
          <label>市場：<select><option>排除ETF</option></select></label>
        </div>
      </div>
      ${openBuyFreshness}
      <div class="swing-signal-grid">
        <button class="swing-card active selected" type="button">
          <div><strong>16:00 候選</strong><small>收盤後用日K篩明日名單</small></div><em>${scanCount}</em>
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
            <input type="search" placeholder="搜尋代號/名稱" value="${escapeAttr(strategyKeyword)}" autocomplete="off" spellcheck="false" inputmode="search" data-strategy-inline-search>
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
    const strategyMatches = stock.matches.filter((match) => STRATEGY5_BASE_PRESET_IDS.includes(match.id));
    strategyMatches.forEach((match) => {
      byId[match.id].push({ ...stock, activeMatch: match });
    });
    if (strategyMatches.length >= 2 && byId.multi_strategy_confluence) {
      const confluenceScore = Math.max(
        cleanNumber(stock.score),
        ...strategyMatches.map((match) => cleanNumber(match.score))
      );
      byId.multi_strategy_confluence.push({
        ...stock,
        score: confluenceScore,
        strategy5ConfluenceMatches: strategyMatches,
        activeMatch: {
          id: "multi_strategy_confluence",
          short: "共振",
          label: "多策略共振",
          icon: "🔥",
          score: confluenceScore,
          reason: strategyMatches.map((match) => match.short || STRATEGY_BY_ID[match.id]?.short || STRATEGY_BY_ID[match.id]?.label || match.id).join(" + "),
        },
      });
    }
  });
  if (!STRATEGY5_PRESET_IDS.includes(strategy5ActiveId)) strategy5ActiveId = "multi_strategy_confluence";

  const list = (byId[strategy5ActiveId] || [])
    .sort((a, b) => b.score - a.score || b.percent - a.percent || b.value - a.value)
    .slice(0, 80);
  const strategy5Paged = paginateTerminalRows(list, strategy5Page, "strategy5");
  strategy5Page = strategy5Paged.page;
  const pageList = strategy5Paged.rows;
  const active = STRATEGY_BY_ID[strategy5ActiveId] || STRATEGY_BY_ID.foreign_trust_breakout;
  const activeMeta = STRATEGY5_CARD_META[strategy5ActiveId] || {};
  const totalMatches = new Set(evaluated
    .filter((stock) => stock.matches.some((match) => STRATEGY5_BASE_PRESET_IDS.includes(match.id)))
    .map((stock) => stock.code)).size;

  if (strategySummary) strategySummary.textContent = `策略5：${active.label}｜符合 ${list.length} 檔`;
  if (strategyMatchCount) strategyMatchCount.textContent = totalMatches.toLocaleString("zh-TW");
  if (strategyAvgScore) strategyAvgScore.textContent = list.length ? Math.round(avg(list.map((stock) => stock.score))) : "--";
  if (strategyTopHit) strategyTopHit.textContent = list.length ? `${Math.max(...list.map((stock) => stock.matches.filter((match) => STRATEGY5_BASE_PRESET_IDS.includes(match.id)).length))}/${STRATEGY5_BASE_PRESET_IDS.length}` : "--";

  const strategyTabs = STRATEGY5_PRESET_IDS.map((id) => {
    const strategy = STRATEGY_BY_ID[id] || {};
    const count = (byId[id] || []).length;
    const activeClass = id === strategy5ActiveId ? "active" : "";
    const tabLabel = strategy.label || id;
    const tabDesc = STRATEGY5_CARD_META[id]?.description || "符合策略5條件的股票。";
    const icon = strategy.icon || "十";
    return `
      <button class="${activeClass}" type="button" data-strategy5-filter="${escapeAttr(id)}">
        <i class="strategy5-tab-icon" aria-hidden="true">${escapeAttr(icon)}</i>
        <span class="strategy5-tab-copy">
          <strong class="strategy5-tab-title">${escapeAttr(tabLabel)}</strong>
          <small class="strategy5-tab-desc">${escapeAttr(tabDesc)}</small>
        </span>
        <span class="strategy5-tab-count">${count.toLocaleString("zh-TW")} 檔</span>
      </button>`;
  }).join("");

  const buildChip = (label, tone = "gray") => `<span class="strategy5-chip ${tone}">${escapeAttr(label)}</span>`;
  const buildChipRow = (chips) => chips.map((chip) => buildChip(chip.label, chip.tone)).join("");
  const scanDateText = strategy5UpdatedAt
    ? new Date(strategy5UpdatedAt).toLocaleDateString("zh-TW")
    : "固定掃描";
  const buildStrategy5DetailChips = (stock, main) => {
    const reason = String(main?.reason || "");
    const priceChips = [];
    const chipChips = [];
    if (stock.percent >= 6) priceChips.push({ label: "強勢動能", tone: "red" });
    else if (stock.percent >= 3) priceChips.push({ label: "動能轉強", tone: "red" });
    else if (stock.percent >= 0) priceChips.push({ label: "紅K續強", tone: "orange" });
    if (stock.volumeRank >= 80) priceChips.push({ label: "爆量前段", tone: "pink" });
    else if (stock.volumeRank >= 60) priceChips.push({ label: "量能放大", tone: "orange" });
    if (stock.valueRank >= 80) priceChips.push({ label: "資金集中", tone: "orange" });
    if (stock.strategy4Score >= 80) priceChips.push({ label: "技術準備", tone: "blue" });
    if (main?.id === "limit_up_doji") {
      priceChips.push({ label: "近20日漲停", tone: "red" }, { label: "放量突破", tone: "orange" });
      chipChips.push({ label: "十字星型態", tone: "gray" }, { label: "橫盤收斂", tone: "blue" });
    }
    if (main?.id === "volume_turnover_breakout") {
      priceChips.push({ label: "漲幅3-8%", tone: "red" }, { label: "千張以上", tone: "orange" });
      chipChips.push(
        { label: `周轉${formatNumber(stock.turnoverRate, 2)}%`, tone: "pink" },
        { label: `量比${formatNumber(stock.volumeRatio, 2)}`, tone: "blue" }
      );
    }
    if (main?.id === "bollinger_kdj_buy") {
      priceChips.push(
        { label: main.bollingerMode?.includes("中軌") ? "中軌買點" : "下軌買點", tone: "blue" },
        { label: "布林20MA", tone: "gray" },
        { label: "KDJ金叉", tone: "orange" }
      );
      chipChips.push(
        { label: `K${formatNumber(main.kdjK, 1)}`, tone: "pink" },
        { label: `D${formatNumber(main.kdjD, 1)}`, tone: "pink" },
        { label: `量比${formatNumber(main.volumeRatio, 2)}`, tone: "blue" }
      );
    }
    const strategyHitCount = (stock.strategy5ConfluenceMatches || stock.matches.filter((match) => STRATEGY5_BASE_PRESET_IDS.includes(match.id))).length;
    if (strategyHitCount >= 2) {
      priceChips.unshift({ label: `★共振${strategyHitCount}`, tone: "red" });
      chipChips.unshift({ label: "多策略同命中", tone: "red" });
    }
    if (/外資/.test(reason)) chipChips.push({ label: "外資同買", tone: "pink" });
    if (/投信/.test(reason)) chipChips.push({ label: "投信照顧", tone: "pink" });
    if (cleanNumber(stock.inst?.total) > 0) chipChips.push({ label: "法人偏買", tone: "red" });
    if (!chipChips.length) chipChips.push({ label: main?.short || "策略命中", tone: "gray" });
    if (!priceChips.length) priceChips.push({ label: main?.short || "條件符合", tone: "gray" });
    return { priceChips: priceChips.slice(0, 5), chipChips: chipChips.slice(0, 4) };
  };

  const tableRows = pageList.length ? pageList.map((stock, index) => {
    const sign = stock.percent >= 0 ? "+" : "";
    const direction = stock.percent >= 0 ? "▲" : "▼";
    const strategyMatches = stock.strategy5ConfluenceMatches || stock.matches.filter((match) => STRATEGY5_BASE_PRESET_IDS.includes(match.id));
    const main = stock.activeMatch || strategyMatches[0] || stock.matches[0];
    const isStrategy5Confluence = strategyMatches.length >= 2;
    const rank = (strategy5Page - 1) * TERMINAL_PAGE_SIZE + index + 1;
    const volumeText = cleanNumber(stock.tradeVolume) > 0
      ? `${Math.round(cleanNumber(stock.tradeVolume) / 1000).toLocaleString("zh-TW")} 張`
      : "-- 張";
    const marketText = [stock.market || "TWSE", scanDateText].filter(Boolean).join("・");
    const { priceChips, chipChips } = buildStrategy5DetailChips(stock, main);
    return `
      <article class="strategy5-detail-card">
        <div class="strategy5-detail-rank">#${rank}</div>
        <div class="strategy5-detail-main">
          <strong>${isStrategy5Confluence ? '<span class="strategy5-confluence-fire" aria-label="多策略共振">🔥</span>' : ""}${escapeAttr(stock.name)} <span>${escapeAttr(stock.code)}</span></strong>
          <small>${escapeAttr(marketText)}</small>
        </div>
        <div class="strategy5-detail-price">
          <strong>${formatStockPrice(stock.close)}</strong>
          <span class="${stock.percent >= 0 ? "red" : "green"}">${direction}${sign}${stock.percent.toFixed(2)}%</span>
          <small>${volumeText}</small>
        </div>
        <div class="strategy5-detail-feature">
          <small>價量特徵</small>
          <div class="strategy5-chip-row">${buildChipRow(priceChips)}</div>
        </div>
        <div class="strategy5-detail-feature">
          <small>籌碼特徵</small>
          <div class="strategy5-chip-row">${buildChipRow(chipChips)}</div>
        </div>
      </article>
    `;
  }).join("") : `<div class="empty-state">目前沒有符合「${active.label}」的股票。</div>`;
  const table = pageList.length ? `
    <section class="strategy5-detail-list" aria-label="策略5綜合策略清單">
      ${tableRows}
    </section>
  ` : tableRows;
  const pagination = buildTerminalPagination("strategy5", strategy5Page, strategy5Paged.totalPages, list.length);

  const scanText = strategy5UpdatedAt
    ? `06:00 / 21:00 完整掃｜${new Date(strategy5UpdatedAt).toLocaleDateString("zh-TW")}`
    : "06:00 / 21:00 完整掃結果讀取中";
  const freshnessDate = normalizeMarketAiDateKey(strategy5UsedDateKey) || marketAiDataDateKey(strategy5Data);
  const freshnessToday = marketAiTodayKey();
  const freshnessIsToday = freshnessDate === freshnessToday;
  const freshnessClass = freshnessIsToday ? "is-live" : "is-stale";
  const freshnessText = freshnessIsToday ? "" : "｜非今日資料不採用";
  const strategy5Freshness = `
    <div class="data-freshness-bar strategy5-freshness-bar ${freshnessClass}">
      模式：<strong>盤後籌碼｜法人資料</strong>｜資料日期：<strong>${escapeAttr(formatMarketAiDateKey(freshnessDate))}</strong>｜今日：<strong>${escapeAttr(formatMarketAiDateKey(freshnessToday))}</strong>${freshnessText}
    </div>`;
  strategyTable.innerHTML = `
    <section class="strategy5-shell strategy5-clean">
      <header class="strategy5-page-heading">
        <h2><span class="strategy5-page-icon" aria-hidden="true"></span>策略5綜合策略</h2>
        <p>掃描時間 06:00 / 21:00｜完整掃描｜${strategy5UpdatedAt ? `最後更新 ${new Date(strategy5UpdatedAt).toLocaleTimeString("zh-TW", { hour12: false })}` : "讀取中"}｜結果固定到下一次掃描</p>
      </header>
      ${strategy5Freshness}
      <section class="strategy5-dashboard strategy5-topic-layout">
        <nav class="strategy5-preset-tabs" aria-label="策略5主題分頁">${strategyTabs}</nav>
        <section class="strategy5-results">
          <div class="strategy5-results-head">
            <div>
              <h3>${titleWithSchedule(active.icon || "▰", active.label || "策略5-綜合策略", "strategy5")}</h3>
              <p>${activeMeta.description || "符合策略5條件的股票。"}｜${scanText}，結果固定到下一次掃描。</p>
            </div>
          </div>
          ${table}
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
              <h3>${titleWithSchedule(STRATEGY_BY_ID.foreign_trust_breakout?.icon || "▰", "外資投信連買準突破", "strategy5")}</h3>
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
  const strategy3Paged = paginateTerminalRows(rows, strategy3Page, "strategy3");
  strategy3Page = strategy3Paged.page;
  const pageRows = strategy3Paged.rows;
  const scanText = strategy3UpdatedAt
    ? `13:00 掃描｜${new Date(strategy3UpdatedAt).toLocaleDateString("zh-TW")}`
    : "13:00 掃描快取讀取中";
  const freshnessDate = normalizeMarketAiDateKey(strategy3UsedDateKey) || marketAiDataDateKey(rows) || marketAiTodayKey();
  const freshnessToday = marketAiTodayKey();
  const freshnessIsToday = freshnessDate === freshnessToday;
  const freshnessClass = freshnessIsToday ? "is-live" : "is-stale";
  const freshnessText = freshnessIsToday ? "" : "｜非今日資料不採用";
  const strategy3FreshnessBar = `
    <div class="data-freshness-bar strategy3-freshness-bar ${freshnessClass}">
      模式：<strong>策略3｜13:00完整掃</strong>｜資料日期：<strong>${escapeAttr(formatMarketAiDateKey(freshnessDate))}</strong>｜今日：<strong>${escapeAttr(formatMarketAiDateKey(freshnessToday))}</strong>${freshnessText}
    </div>
  `;

  if (strategySummary) strategySummary.textContent = `策略3-隔日沖｜${scanText}｜符合 ${rows.length} 檔`;
  if (strategyMatchCount) strategyMatchCount.textContent = rows.length.toLocaleString("zh-TW");
  if (strategyAvgScore) strategyAvgScore.textContent = rows.length ? Math.round(avg(rows.map((stock) => stock.score))) : "--";
  if (strategyTopHit) strategyTopHit.textContent = rows.length ? `${Math.max(...rows.map((stock) => stock.matches.length))}` : "--";

  const tableRows = pageRows.length ? pageRows.map((stock, index) => {
    const sign = stock.percent >= 0 ? "+" : "";
    const rank = (strategy3Page - 1) * TERMINAL_PAGE_SIZE + index + 1;
    return `
      <article class="strategy3-table-row">
        <div class="strategy3-rank-cell"><span class="strategy3-rank">${rank}</span></div>
        <div class="strategy3-code">${stock.code}</div>
        <div class="strategy3-name">${stock.name}</div>
        <div class="strategy3-entry-price">
          <strong>${formatNumber(stock.close, stock.close >= 100 ? 0 : 2)}</strong>
          <small class="${stock.percent >= 0 ? "red" : "green"}">${sign}${stock.percent.toFixed(2)}%</small>
        </div>
        <div class="strategy3-reason strategy3-reason-cell">${renderStrategy3ReasonBadges(stock)}</div>
      </article>
    `;
  }).join("") : `<div class="empty-state">目前沒有符合隔日沖條件的股票。</div>`;
  const table = pageRows.length ? `
    <section class="strategy3-table" aria-label="策略3隔日沖清單">
      <div class="strategy3-table-head">
        <span>排名</span>
        <span>股票代號</span>
        <span>股票名稱</span>
        <span>尾盤進場價</span>
        <span>原因</span>
      </div>
      ${tableRows}
    </section>
  ` : tableRows;
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
          ${strategy3FreshnessBar}
          ${table}
          ${pagination}
        </section>
      </section>
    </section>
  `;
}

function renderStrategyScanner() {
  if (!strategyTable) return;
  if (!canRunViewWork("strategy")) return;
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

  if (selected.length === 1 && selected[0] === "swing_radar") {
    renderSwingRadar(latestStocks);
    return;
  }

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
      const passKeyword = matchesStrategyKeyword(stock, keyword);
      return passKeyword;
    });
    renderOpenBuyRadar(openBuyRows);
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
    const passKeyword = matchesStrategyKeyword(stock, keyword);
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

let warrantFlowModuleApi = null;

function getWarrantFlowContext() {
  return {
    scope: makeFumanModuleScope({
      get latestStocks() { return latestStocks; },
      set latestStocks(value) { latestStocks = value; },
      get warrantFlowData() { return warrantFlowData; },
      set warrantFlowData(value) { warrantFlowData = value; },
      get warrantFlowUpdatedAt() { return warrantFlowUpdatedAt; },
      set warrantFlowUpdatedAt(value) { warrantFlowUpdatedAt = value; },
      get warrantFlowPriorityCache() { return warrantFlowPriorityCache; },
      set warrantFlowPriorityCache(value) { warrantFlowPriorityCache = value; },
      get warrantFlowPrioritySignature() { return warrantFlowPrioritySignature; },
      set warrantFlowPrioritySignature(value) { warrantFlowPrioritySignature = value; },
      get warrantFlowLastRenderSignature() { return warrantFlowLastRenderSignature; },
      set warrantFlowLastRenderSignature(value) { warrantFlowLastRenderSignature = value; },
      get warrantFlowKeyword() { return warrantFlowKeyword; },
      set warrantFlowKeyword(value) { warrantFlowKeyword = value; },
      get warrantFlowPage() { return warrantFlowPage; },
      set warrantFlowPage(value) { warrantFlowPage = value; },
      get warrantFlowHasOpened() { return warrantFlowHasOpened; },
      set warrantFlowHasOpened(value) { warrantFlowHasOpened = value; },
      get warrantFlowLoading() { return warrantFlowLoading; },
      set warrantFlowLoading(value) { warrantFlowLoading = value; },
      get warrantFlowPreferFull() { return warrantFlowPreferFull; },
      set warrantFlowPreferFull(value) { warrantFlowPreferFull = value; },
      get warrantFlowSummary() { return warrantFlowSummary; },
      set warrantFlowSummary(value) { warrantFlowSummary = value; },
      viewPanels, endpoints, CACHE_FRESH_MS,
      cleanNumber, formatNumber, normalizeArray, fetchVersionedJson,
      isViewActive, isMobileViewport, loadWarrantFlowLocalCache, loadWarrantFlowSummary,
      loadStrategyStocks, saveWarrantFlowLocalCache, applyStaticTitleIcons,
      titleWithSchedule, escapeAttr, buildTerminalPagination,
    }),
  };
}

async function ensureWarrantFlowModule() {
  if (warrantFlowModuleApi) return warrantFlowModuleApi;
  await loadFumanFeatureModule("warrantFlow", "terminal-warrant-flow.js", "FUMAN_WARRANT_FLOW_MODULE");
  warrantFlowModuleApi = window.FUMAN_WARRANT_FLOW_MODULE.install(getWarrantFlowContext());
  return warrantFlowModuleApi;
}

function renderWarrantFlow() {
  ensureWarrantFlowModule().then((api) => api.renderWarrantFlow()).catch(() => undefined);
}

async function loadWarrantFlow(force = false) {
  const api = await ensureWarrantFlowModule();
  return api.loadWarrantFlow(force);
}

function preloadWarrantFlowFullData(reason = "idle") {
  if (warrantFlowFullPreloadPromise) return warrantFlowFullPreloadPromise;
  warrantFlowFullPreloadPromise = Promise.allSettled([
    fetchVersionedJsonFallback([
      { url: endpoints.warrantFlowSlim, label: "warrant-slim-preload", kind: "warrant" },
      { url: endpoints.warrantFlowCache, label: "warrant-cache-preload", kind: "warrant" },
      { url: endpoints.warrantFlowBackup, label: "warrant-backup-preload", kind: "warrant" },
    ], 9000, "warrant"),
    loadStrategyStocks(),
  ]).finally(() => {
    recordFumanPerformance("preload:warrant:" + reason, performance?.now ? performance.now() : Date.now(), true);
  });
  return warrantFlowFullPreloadPromise;
}

async function loadStrategyStocks() {
  if (latestStocks.length) return latestStocks;
  if (strategyStocksPromise) return strategyStocksPromise;
  strategyStocksLoading = true;
  strategyStocksPromise = (async () => {
    let stocks = [];
    try {
      const slimPayload = await fetchVersionedJson(endpoints.stocksSlim, 7000, marketSummaryPayload?.updatedAt || "latest", false);
      stocks = normalizeArray(slimPayload?.stocks || slimPayload);
      if (cleanNumber(slimPayload?.count) < 500) stocks = [];
      if (stocks.length) updateMarketStockDataState(slimPayload);
    } catch (error) {
      stocks = [];
    }

    try {
      if (!stocks.length) {
        const payload = await fetchVersionedJson(endpoints.strategyStocks, 20000, marketSummaryPayload?.updatedAt || "latest", false);
        stocks = normalizeArray(payload.stocks);
        if (stocks.length) updateMarketStockDataState(payload);
      }
    } catch (error) {
      stocks = [];
    }

    try {
      if (!stocks.length) {
        const fallback = await fetchVersionedJson(endpoints.stocks, 12000, marketSummaryPayload?.updatedAt || "latest", false);
        stocks = normalizeArray(fallback?.stocks || fallback);
        if (stocks.length) updateMarketStockDataState(fallback);
      }
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
      if (isViewActive("strategy")) renderStrategyScanner();
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

function getSectorValueToneClass(val, prefix) {
  const n = cleanNumber(val);
  if (!Number.isFinite(n) || n === 0) return `${prefix}-zero`;
  return n > 0 ? `${prefix}-pos` : `${prefix}-neg`;
}

function normalizeInstitutionLots(val) {
  if (val === undefined || val === null) return null;
  const n = cleanNumber(val);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n / 1000);
}

function formatInstitutionLots(val) {
  const n = normalizeInstitutionLots(val);
  if (!Number.isFinite(n)) return "--";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toLocaleString("zh-TW")} 張`;
}

function normalizeSectorRealtimeStock(stock, quote = {}) {
  const close = parseQuoteNumber(quote.close, quote.z, stock.close);
  const prevClose = parseQuoteNumber(quote.prevClose, quote.y);
  const change = prevClose && close ? close - prevClose : cleanNumber(quote.change) || cleanNumber(stock.change);
  const pct = prevClose && close ? (change / prevClose) * 100 : cleanNumber(quote.percent ?? quote.pct ?? stock.pct);
  const volume = normalizeTradeVolumeLots(quote.tradeVolume || quote.volume || quote.v || stock.volume);
  const value = cleanNumber(quote.value || quote.tradeValue) || estimateTradeValue(close, volume) || cleanNumber(stock.value);
  return {
    ...stock,
    code: String(quote.code || quote.c || stock.code || ""),
    name: quote.name || quote.n || stock.name,
    close: close || cleanNumber(stock.close),
    pct: Number.isFinite(pct) ? pct : cleanNumber(stock.pct),
    value,
    volume,
    exchange: stock.exchange || quote.exchange || quote.ex || "",
  };
}

function renderSectorModalRows(sector, stocks) {
  return stocks.map((s, i) => {
    const pctClass = s.pct > 0 ? "sector-pct-up" : s.pct < 0 ? "sector-pct-down" : "sector-pct-flat";
    const pctSign = s.pct >= 0 ? "+" : "";
    const inst = institutionData[s.code] || {};
    const rawForeign = inst.foreign ?? null;
    const rawTrust = inst.trust ?? null;
    const rawDealer = inst.dealer ?? null;
    const rawTotal = inst.total ?? (
      rawForeign !== null && rawTrust !== null && rawDealer !== null
        ? cleanNumber(rawForeign) + cleanNumber(rawTrust) + cleanNumber(rawDealer)
        : null
    );
    const market = /otc|tpex|上櫃/i.test(String(s.exchange || s.market || "")) ? "上櫃" : "上市";
    return `
      <tr style="border-bottom:1px solid #161925; ${i % 2 === 0 ? "" : "background:#0c0f1a"}">
        <td style="padding:10px 16px;">
          <div style="color:#7ec8e3; font-weight:600; font-size:13px;">${s.code} ${s.name}</div>
          <div style="color:#555; font-size:11px; margin-top:2px;">${sector.name}</div>
        </td>
        <td style="padding:10px 8px; text-align:center; color:#888; font-size:12px;">${market}</td>
        <td style="padding:10px 12px; text-align:right; color:#fff; font-weight:600;">${s.close ? s.close.toLocaleString("zh-TW") : "--"}</td>
        <td class="${pctClass}" style="padding:10px 12px; text-align:right;">${pctSign}${formatNumber(s.pct || 0, 2)}%</td>
        <td style="padding:10px 12px; text-align:right; color:#aaa;">${s.value ? (s.value/100000000).toFixed(1) : "0.0"} 億</td>
        <td style="padding:10px 12px; text-align:right; color:#aaa;">${s.volume ? s.volume.toLocaleString("zh-TW", { maximumFractionDigits: 0 }) : "0"} 張</td>
        <td class="${getSectorValueToneClass(rawForeign, "sector-inst")}" style="padding:10px 12px; text-align:right;">${formatInstitutionLots(rawForeign)}</td>
        <td class="${getSectorValueToneClass(rawTrust, "sector-inst")}" style="padding:10px 12px; text-align:right;">${formatInstitutionLots(rawTrust)}</td>
        <td class="${getSectorValueToneClass(rawDealer, "sector-inst")}" style="padding:10px 12px; text-align:right;">${formatInstitutionLots(rawDealer)}</td>
        <td class="${getSectorValueToneClass(rawTotal, "sector-inst")}" style="padding:10px 16px; text-align:right;">${formatInstitutionLots(rawTotal)}</td>
      </tr>
    `;
  }).join("");
}

async function refreshSectorModalRealtime(sector, stocks) {
  const body = document.querySelector("#sector-modal-body");
  if (!body || !stocks.length) return;
  const codes = stocks.map((stock) => String(stock.code || "")).filter(Boolean);
  if (!codes.length) return;
  try {
    if (!Object.keys(institutionData).length) await loadInstitution();
    const payload = await fetchJson(`${endpoints.realtime}?codes=${encodeURIComponent(codes.join(","))}&t=${Date.now()}`, 12000);
    const quotes = normalizeArray(payload?.quotes || payload?.msgArray || payload);
    const quoteByCode = new Map(quotes.map((quote) => [String(quote.code || quote.c || ""), quote]));
    const merged = stocks
      .map((stock) => normalizeSectorRealtimeStock(stock, quoteByCode.get(String(stock.code || ""))))
      .sort((a, b) => cleanNumber(b.value) - cleanNumber(a.value));
    body.innerHTML = renderSectorModalRows(sector, merged);
    const totalValue = merged.reduce((sum, stock) => sum + cleanNumber(stock.value), 0) / 100000000;
    const valueEl = document.querySelector("[data-sector-modal-value]");
    if (valueEl) valueEl.textContent = `${totalValue.toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 億`;
  } catch (error) {
    body.dataset.realtimeError = "true";
  }
}

function getSectorModalStocks(sector) {
  const name = String(sector?.name || "").trim();
  const directStocks = normalizeArray(sector?.stocks);
  const directRows = normalizeArray(sector?.rows);
  const cachedStocks = normalizeArray(sectorStocksCache[name]);
  const rows = directStocks.length ? directStocks : directRows.length ? directRows : cachedStocks;
  return rows.map((stock) => ({
    ...stock,
    code: String(stock?.code || "").trim(),
    name: stock?.name || stock?.Name || stock?.證券名稱 || stock?.code || "",
    close: cleanNumber(stock?.close),
    pct: cleanNumber(stock?.pct ?? stock?.percent),
    value: cleanNumber(stock?.value) || cleanNumber(stock?.amountYi || stock?.valueYi) * 100000000,
    volume: cleanNumber(stock?.volume ?? stock?.tradeVolume),
  })).filter((stock) => stock.code);
}

async function openSectorModal(sector) {
  const stocks = getSectorModalStocks(sector);
  const existing = document.querySelector("#sector-modal");
  if (existing) existing.remove();

  if (!Object.keys(institutionData).length) await loadInstitution();

  const sortedStocks = [...stocks].sort((a, b) => b.pct - a.pct);
  const today = new Date();
  const dateStr = `${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}`;

  const modal = document.createElement("div");
  modal.id = "sector-modal";

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
              <div data-sector-modal-value style="font-size:18px; font-weight:600; color:#fff">${sector.totalValue} 億</div>
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
          <tbody id="sector-modal-body">
            ${renderSectorModalRows(sector, sortedStocks)}
          </tbody>
        </table>
        ${sortedStocks.length === 0 ? `<div style="text-align:center; padding:40px; color:#666;">載入個股資料中...</div>` : ""}
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector("#modal-close").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  refreshSectorModalRealtime(sector, sortedStocks);
}

function mergeHeatmapApiSectorsIntoCache(sectors) {
  const nextCache = { ...sectorStocksCache };
  normalizeArray(sectors).forEach((sector) => {
    const apiIndustry = String(sector?.name || "").trim();
    normalizeArray(sector?.stocks).forEach((stock) => {
      const code = String(stock?.code || stock?.Code || stock?.證券代號 || "").trim();
      if (!code) return;
      const industry = apiIndustry || SECTOR_MAP[code];
      if (!industry) return;
      SECTOR_MAP[code] = industry;
      const row = { ...stock, code, name: stock.name || stock.Name || stock.證券名稱 || code };
      upsertSectorStock(nextCache, industry, row);
    });
  });
  sectorStocksCache = nextCache;
}

function mergeIndustryMaster(masterRows) {
  normalizeArray(masterRows).forEach((row) => {
    const code = String(row?.code || "").trim();
    const primaryIndustry = String(row?.primaryIndustry || row?.heatmapSector || "").trim();
    if (!code || !primaryIndustry) return;
    industryMasterByCode[code] = { ...industryMasterByCode[code], ...row, code, primaryIndustry };
    SECTOR_MAP[code] = primaryIndustry;
  });
}

const FUMAN_MARKET_CONFIG = window.FUMAN_MARKET_CONFIG || {};
const HEATMAP_FILTERS = FUMAN_MARKET_CONFIG.HEATMAP_FILTERS || [];
const HEATMAP_ELECTRONIC_GROUPS = FUMAN_MARKET_CONFIG.HEATMAP_ELECTRONIC_GROUPS || new Set();
const HEATMAP_THEME_GROUPS = FUMAN_MARKET_CONFIG.HEATMAP_THEME_GROUPS || new Set();
const HEATMAP_GROUP_STOCKS = FUMAN_MARKET_CONFIG.HEATMAP_GROUP_STOCKS || {};
const HEATMAP_GROUP_BY_CODE = FUMAN_MARKET_CONFIG.HEATMAP_GROUP_BY_CODE || {};

function buildHeatmapGroupSectors(sectors) {
  const groups = {};
  normalizeArray(sectors).forEach((sector) => {
    normalizeArray(sector?.stocks).forEach((stock) => {
      const code = String(stock?.code || "").trim();
      const groupName = HEATMAP_GROUP_BY_CODE[code];
      if (!code || !groupName) return;
      if (!groups[groupName]) groups[groupName] = { name: groupName, stocks: [], seen: new Set(), totalValue: 0, up: 0, down: 0, flat: 0 };
      const group = groups[groupName];
      if (group.seen.has(code)) return;
      group.seen.add(code);
      const pct = cleanNumber(stock.pct ?? stock.percent);
      const change = cleanNumber(stock.change);
      const amountYi = cleanNumber(stock.amountYi || stock.valueYi || cleanNumber(stock.value) / 100000000);
      const row = { ...stock, code, pct, amountYi, groupIndustry: groupName };
      group.stocks.push(row);
      group.totalValue += amountYi;
      if (change > 0 || pct > 0) group.up++;
      else if (change < 0 || pct < 0) group.down++;
      else group.flat++;
    });
  });

  return Object.values(groups)
    .filter((group) => group.stocks.length)
    .map((group) => {
      const sortedStocks = [...group.stocks].sort((a, b) => cleanNumber(b.amountYi) - cleanNumber(a.amountYi));
      const leader = sortedStocks[0];
      const pct = group.stocks.reduce((sum, stock) => sum + cleanNumber(stock.pct), 0) / group.stocks.length;
      const totalValue = Number(group.totalValue.toFixed(1));
      return {
        name: group.name,
        pct: Number(pct.toFixed(2)),
        totalValue,
        amountYi: totalValue,
        count: group.stocks.length,
        up: group.up,
        down: group.down,
        flat: group.flat,
        leader: leader ? `${leader.name || leader.code} ${cleanNumber(leader.pct) >= 0 ? "+" : ""}${cleanNumber(leader.pct).toFixed(2)}%` : "--",
        leaderCode: leader?.code || "",
        stocks: sortedStocks,
      };
    })
    .sort((a, b) => cleanNumber(b.pct) - cleanNumber(a.pct));
}

function filterHeatmapSectors(sectors) {
  if (heatmapMode === "official") {
    return sectors.filter((sector) => !HEATMAP_ELECTRONIC_GROUPS.has(sector.name) && !HEATMAP_THEME_GROUPS.has(sector.name));
  }
  if (heatmapMode === "electronic") return sectors.filter((sector) => HEATMAP_ELECTRONIC_GROUPS.has(sector.name));
  if (heatmapMode === "theme") return sectors.filter((sector) => HEATMAP_THEME_GROUPS.has(sector.name));
  if (heatmapMode === "group") return buildHeatmapGroupSectors(sectors);
  return sectors;
}

function syncHeatmapTabs(allSectors, visibleSectors) {
  const section = heatmap?.closest(".sector-section");
  const titleCount = section?.querySelector(".section-title > span");
  if (titleCount) {
    const activeLabel = HEATMAP_FILTERS.find((item) => item.key === heatmapMode)?.label || "全部";
    titleCount.textContent = `${activeLabel} · ${visibleSectors.length} 個`;
  }
  const tabs = section?.querySelector(".tabs");
  if (!tabs) return;
  const buttons = [...tabs.querySelectorAll("button")];
  buttons.forEach((button, index) => {
    const meta = HEATMAP_FILTERS[index];
    if (!meta) return;
    button.dataset.heatmapMode = meta.key;
    button.type = "button";
    button.classList.toggle("active", meta.key === heatmapMode);
    button.disabled = false;
    button.onclick = () => {
      heatmapMode = meta.key;
      lastHeatmapRenderSignature = "";
      renderHeatmapSectors(allSectors);
    };
  });
}

function upsertSectorStock(cache, industry, row) {
  const code = String(row?.code || row?.Code || row?.證券代號 || "").trim();
  if (!code || !industry) return;
  Object.keys(cache).forEach((name) => {
    if (name === industry) return;
    cache[name] = normalizeArray(cache[name]).filter((item) => String(item.code || item.Code || item.證券代號) !== code);
    if (!cache[name].length) delete cache[name];
  });
  if (!cache[industry]) cache[industry] = [];
  const existingIndex = cache[industry].findIndex((item) => String(item.code || item.Code || item.證券代號) === code);
  if (existingIndex >= 0) cache[industry][existingIndex] = { ...cache[industry][existingIndex], ...row };
  else cache[industry].push(row);
}

// ★ 修改：從 API 回傳的 stocks 直接存進 cache，並依本地族群表重新分桶
function renderHeatmapSectors(sectors) {
  if (!sectors || !sectors.length) {
    heatmap.innerHTML = `<div class="empty-state">等待產業資料...</div>`;
    lastHeatmapRenderSignature = "";
    return;
  }

  mergeHeatmapApiSectorsIntoCache(sectors);
  const sortedSectors = [...sectors].sort((a, b) => cleanNumber(b.pct) - cleanNumber(a.pct));
  const visibleSectors = filterHeatmapSectors(sortedSectors);
  visibleSectors.forEach((sector) => {
    const rows = normalizeArray(sector?.stocks || sector?.rows);
    const name = String(sector?.name || "").trim();
    if (name && rows.length) sectorStocksCache[name] = rows;
  });
  syncHeatmapTabs(sortedSectors, visibleSectors);
  const signature = visibleSectors
    .map((s) => `${s.name}:${Number(s.pct || 0).toFixed(2)}:${s.count}:${s.up}:${s.down}:${s.totalValue}:${s.leader || ""}`)
    .join("|") + `:${heatmapMode}`;
  if (signature === lastHeatmapRenderSignature) return;
  lastHeatmapRenderSignature = signature;

  if (!visibleSectors.length) {
    heatmap.innerHTML = `<div class="empty-state">這個分類目前沒有產業資料</div>`;
    return;
  }

  heatmap.innerHTML = visibleSectors.map(s => {
    const pct = s.pct || 0;
    const sign = pct >= 0 ? "+" : "";
    const bg = getSectorColor(pct);
    const toneClass = pct >= 0 ? "hot" : "cold";
    const totalValue = cleanNumber(s.totalValue || s.amountYi).toLocaleString("zh-TW", { maximumFractionDigits: 1 });
    const leader = String(s.leader || "--").replace(/\s+/g, " ");
    // 不把 stocks 放進 data-sector，太大了
    const sectorMeta = { name: s.name, pct: s.pct, totalValue: s.totalValue, count: s.count, up: s.up, down: s.down, flat: s.flat, leader: s.leader };
    return `
      <article class="sector-card ${toneClass}" style="--sector-bg:${bg}; cursor:pointer;" data-sector="${encodeURIComponent(JSON.stringify(sectorMeta))}">
        <h3><span class="sector-name">${escapeAttr(s.name)}</span><span class="sector-pct">${sign}${pct.toFixed(2)}%</span></h3>
        <p>${cleanNumber(s.count).toLocaleString("zh-TW")} 檔 · ${totalValue} 億</p>
        <small>
          <span>▲ ${cleanNumber(s.up).toLocaleString("zh-TW")}</span><b>▼ ${cleanNumber(s.down).toLocaleString("zh-TW")}</b>
        </small>
        <em>${escapeAttr(leader)}</em>
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

function syncLatestStocksFromHeatmapSectors(sectors) {
  if (!isMarketAiActiveSession()) return false;
  const today = marketAiTodayKey();
  const rows = normalizeArray(sectors).flatMap((sector) =>
    normalizeArray(sector?.stocks || sector?.rows).map((stock) => ({
      code: String(stock.code || stock.Code || ""),
      name: String(stock.name || stock.Name || ""),
      close: cleanNumber(stock.close || stock.ClosingPrice),
      change: cleanNumber(stock.change || stock.Change),
      percent: cleanNumber(stock.pct || stock.percent || stock.Percent),
      value: cleanNumber(stock.value || stock.TradeValue),
      tradeVolume: cleanNumber(stock.tradeVolume || stock.volume || stock.TradeVolume),
      quoteDate: stock.quoteDate || stock.tradeDate || stock.Date,
      quoteTime: stock.quoteTime || "",
      quoteUpdatedAt: cleanNumber(stock.quoteUpdatedAt),
      isRealtime: stock.isRealtime === true,
      market: stock.market || stock.Market || "",
    }))
  ).filter((stock) => stock.code && stock.name && stock.close && normalizeMarketAiDateKey(stock.quoteDate) === today);
  if (rows.length < 500) return false;
  const currentTodayRows = latestStocks.filter((stock) => normalizeMarketAiDateKey(stock.quoteDate) === today).length;
  if (currentTodayRows >= rows.length) return false;
  renderStocks(rows);
  return true;
}

async function refreshMarketAiFromHeatmap() {
  if (marketAiHeatmapSyncPromise) return marketAiHeatmapSyncPromise;
  marketAiHeatmapSyncPromise = (async () => {
    const data = await fetchVersionedJson(endpoints.heatmap, 15000, "market-ai", true);
    mergeIndustryMaster(data?.industryMaster);
    const sectors = normalizeArray(data?.sectors);
    if (data?.ok && sectors.length && syncLatestStocksFromHeatmapSectors(sectors)) {
      marketAiLastSignature = "";
      refreshDataFreshnessBars();
      renderMarketAiPanel();
    }
  })().catch(() => undefined).finally(() => {
    marketAiHeatmapSyncPromise = null;
  });
  return marketAiHeatmapSyncPromise;
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
  }).filter(Boolean).sort((a, b) => cleanNumber(b.pct) - cleanNumber(a.pct)).slice(0, 60);

  if (sectors.length) renderHeatmapSectors(sectors);
  return sectors.length > 0;
}

function installMarketTabs() {
  const panel = viewPanels.market;
  if (!panel || document.querySelector("#market-mode-tabs")) return;
  const tabs = document.createElement("div");
  tabs.id = "market-mode-tabs";
  tabs.className = "market-mode-tabs";
  tabs.innerHTML = `
    <button type="button" class="active" data-market-mode="overview">◉ 市場總覽</button>
    <button type="button" data-market-mode="ai">♙ AI 判讀</button>
  `;
  const header = panel.querySelector(".page-header");
  if (header) header.insertAdjacentElement("afterend", tabs);
  else panel.prepend(tabs);

  marketAiPanel = document.createElement("section");
  marketAiPanel.id = "market-ai-panel";
  marketAiPanel.className = "market-ai-panel";
  marketAiPanel.hidden = true;
  panel.appendChild(marketAiPanel);

  [...panel.children].forEach((child) => {
    if (child === header || child === tabs || child === marketAiPanel) return;
    child.dataset.marketOverviewNode = "true";
  });
  applyMarketMode(marketMode);
}

function applyMarketMode(mode = "overview") {
  const panel = viewPanels.market;
  if (!panel) return;
  marketMode = mode === "ai" ? "ai" : "overview";
  panel.classList.toggle("market-ai-mode", marketMode === "ai");
  panel.classList.toggle("market-overview-mode", marketMode !== "ai");
  panel.querySelectorAll("[data-market-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.marketMode === marketMode);
  });
  panel.querySelectorAll("[data-market-overview-node]").forEach((node) => {
    node.hidden = marketMode === "ai";
  });
  if (marketAiPanel) {
    marketAiPanel.hidden = marketMode !== "ai";
    if (marketMode === "ai") {
      marketAiLastSignature = "";
      marketAiPanel.innerHTML = `<div class="empty-state">載入最新 AI 判讀資料中...</div>`;
      deferUiWork(refreshMarketAiPanelOnOpen, 80);
    }
  }
  const title = panel.querySelector(".page-header h1");
  if (title) {
    const text = marketMode === "ai" ? "AI 盤面判讀" : "市場總覽";
    title.innerHTML = `${titleWithIcon("●", text)} ${scheduleBadgeHtml("market")}`;
  }
  refreshDataFreshnessBars();
}

async function refreshMarketAiPanelOnOpen() {
  if (marketDataLoading) {
    renderMarketAiPanel();
    return;
  }
  try {
    await loadMarketData(true);
  } finally {
    if (marketMode === "ai") {
      marketAiLastSignature = "";
      renderMarketAiPanel();
      requestMarketAiRealtimeScan("hot");
    }
  }
}

function getMarketAiSectors(sourceStocks = null) {
  const sourceCache = Array.isArray(sourceStocks)
    ? sourceStocks.reduce((cache, stock) => {
        const code = String(stock?.code || "").trim();
        const industry = SECTOR_MAP[code];
        if (!industry) return cache;
        upsertSectorStock(cache, industry, {
          code,
          name: stock.name || code,
          close: cleanNumber(stock.close),
          change: cleanNumber(stock.change),
          pct: cleanNumber(stock.percent ?? stock.pct),
          value: cleanNumber(stock.value),
          volume: cleanNumber(stock.tradeVolume || stock.volume),
        });
        return cache;
      }, {})
    : sectorStocksCache;
  return Object.entries(sourceCache).map(([name, stocks]) => {
    const rows = normalizeArray(stocks).map((stock) => ({
      ...stock,
      pct: cleanNumber(stock.pct ?? stock.percent),
      value: cleanNumber(stock.value),
    })).filter((stock) => stock.code);
    if (!rows.length) return null;
    const totalValue = rows.reduce((sum, stock) => sum + stock.value, 0);
    const pct = totalValue
      ? rows.reduce((sum, stock) => sum + stock.pct * stock.value, 0) / totalValue
      : avg(rows.map((stock) => stock.pct));
    const up = rows.filter((stock) => stock.pct > 0).length;
    const down = rows.filter((stock) => stock.pct < 0).length;
    return { name, rows, pct: pct || 0, totalValue, up, down };
  }).filter(Boolean);
}

function marketAiTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function normalizeMarketAiDateKey(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return digits;
  if (/^\d{7}$/.test(digits)) {
    const rocYear = Number(digits.slice(0, 3));
    if (rocYear > 0) return `${rocYear + 1911}${digits.slice(3)}`;
  }
  return "";
}

function marketAiQuoteDateKey(stock) {
  return normalizeMarketAiDateKey(valueOf(stock || {}, [
    "quoteDate",
    "QuoteDate",
    "tradeDate",
    "TradeDate",
    "date",
    "Date",
    "資料日期",
    "交易日期",
  ]));
}

function marketAiTargetDateKey() {
  return isMarketAiActiveSession() ? marketAiTodayKey() : normalizeMarketAiDateKey(marketStockDataState.resolvedTradeDate) || marketAiTodayKey();
}

function formatMarketAiDateKey(value) {
  const key = normalizeMarketAiDateKey(value);
  return key && key.length === 8 ? `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}` : "未知";
}

function taipeiDateKeyFromValue(value) {
  if (value === null || value === undefined || value === "" || value === 0) return "";
  const normalized = normalizeMarketAiDateKey(value);
  if (normalized) return normalized;
  const time = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(time)) return "";
  return normalizeMarketAiDateKey(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time)));
}

function getStrategy4FreshnessMeta() {
  const today = taipeiDateKeyFromValue(Date.now()) || marketAiTodayKey();
  const dataDate = normalizeMarketAiDateKey(strategy4ScanStamp || strategy4Summary?.scanStamp || strategy4Summary?.stamp)
    || taipeiDateKeyFromValue(strategy4ScanLastAt)
    || taipeiDateKeyFromValue(strategy4Summary?.updatedAt)
    || marketAiDataDateKey(Object.values(strategy4ScanMatches))
    || today;
  return {
    mode: "策略4｜14:30完整掃",
    dataDate,
    today,
    isToday: dataDate === today,
  };
}

function renderStrategy4FreshnessBarHtml() {
  const meta = getStrategy4FreshnessMeta();
  const staleText = meta.isToday ? "" : "｜非今日資料不採用";
  const stateClass = meta.isToday ? "is-live" : "is-stale";
  return `<div class="data-freshness-bar strategy4-freshness-bar ${stateClass}">模式：<strong>${escapeAttr(meta.mode)}</strong>｜資料日期：<strong>${escapeAttr(formatMarketAiDateKey(meta.dataDate))}</strong>｜今日：<strong>${escapeAttr(formatMarketAiDateKey(meta.today))}</strong>${staleText}</div>`;
}

function getPanelFreshnessMeta(viewName) {
  const today = marketAiTodayKey();
  const liveMarketDate = marketRealtimeState.trading === true || marketRealtimeState.marketStatus === "day";
  const activeMarketSession = viewName === "market" && (isMarketAiActiveSession() || liveMarketDate);
  const marketAiLiveRows = activeMarketSession && marketMode === "ai"
    ? latestStocks.map((stock) => applyStrategyQuote(stock)).filter((stock) => !isMarketAiStaleStock(stock))
    : [];
  const latestTodayRows = activeMarketSession
    ? latestStocks.filter((stock) => marketAiQuoteDateKey(stock) === today)
    : [];
  const dataDate = marketAiDataDateKey(marketAiLiveRows)
    || marketAiDataDateKey(latestTodayRows)
    || (activeMarketSession ? today : "")
    || marketAiDataDateKey(latestStocks)
    || normalizeMarketAiDateKey(marketStockDataState.resolvedTradeDate)
    || today;
  const isToday = dataDate === today;
  const marketModeText = isMarketAiActiveSession()
    ? "盤中巡邏"
    : marketStockDataState.isFallbackDate
    ? "最新可用交易日"
    : "收盤資料";
  if (viewName === "market") {
    return { mode: marketMode === "ai" ? `AI 判讀｜${marketModeText}` : `市場總覽｜${marketModeText}`, dataDate, today, isToday };
  }
  if (viewName === "strategy") {
    const mode = strategyView?.classList.contains("swing-only")
      ? "策略4｜14:30完整掃"
      : strategyView?.classList.contains("intraday-only")
      ? "策略2當沖｜盤中巡邏"
      : strategyView?.classList.contains("open-buy-only")
      ? "策略1｜最新可用收盤資料"
      : strategyView?.classList.contains("strategy3-only")
      ? "策略3｜13:00完整掃"
      : strategyView?.classList.contains("strategy5-only")
      ? "盤後籌碼｜法人資料"
      : "策略中心｜即時重算";
    const strategyDataDate = strategyView?.classList.contains("intraday-only")
      ? normalizeMarketAiDateKey(strategy2IntradayCacheDate) || marketAiDataDateKey(latestStocks) || dataDate
      : strategyView?.classList.contains("strategy3-only")
      ? normalizeMarketAiDateKey(strategy3UsedDateKey) || marketAiDataDateKey(strategy3Data) || dataDate
      : strategyView?.classList.contains("strategy5-only")
      ? normalizeMarketAiDateKey(strategy5UsedDateKey) || marketAiDataDateKey(strategy5Data) || dataDate
      : strategyView?.classList.contains("open-buy-only")
      ? openBuyDataDateKey || marketAiDataDateKey(Object.values(openBuyScanMatches)) || dataDate
      : dataDate;
    return { mode, dataDate: strategyDataDate, today, isToday: strategyDataDate === today };
  }
  if (viewName === "chip-trade") return { mode: "盤後籌碼｜法人資料", dataDate, today, isToday };
  if (viewName === "warrant-flow") {
    const warrantSummaryDate = normalizeMarketAiDateKey(warrantFlowSummary?.usedDate || warrantFlowSummary?.tradeDate || warrantFlowSummary?.date || warrantFlowSummary?.dataDate);
    const warrantRowsDate = marketAiDataDateKey(warrantFlowData);
    const summaryUpdatedAt = Date.parse(warrantFlowSummary?.updatedAt || "");
    const warrantUpdatedAt = warrantFlowUpdatedAt || (Number.isFinite(summaryUpdatedAt) ? summaryUpdatedAt : 0);
    const warrantUpdatedDate = warrantUpdatedAt > 0
      ? `${new Date(warrantUpdatedAt).getFullYear()}${String(new Date(warrantUpdatedAt).getMonth() + 1).padStart(2, "0")}${String(new Date(warrantUpdatedAt).getDate()).padStart(2, "0")}`
      : "";
    const warrantDataDate = warrantSummaryDate || warrantRowsDate || warrantUpdatedDate || dataDate;
    return { mode: "權證走向｜盤後資料", dataDate: warrantDataDate, today, isToday: warrantDataDate === today };
  }
  if (viewName === "watchlist") {
    const watchlistDataDate = normalizeMarketAiDateKey(watchlistQuoteDateKey)
      || normalizeMarketAiDateKey(institutionDate)
      || (marketRealtimeState.trading === true || marketRealtimeState.marketStatus === "day" ? today : "")
      || today;
    const watchlistModeText = watchlistDataDate === today ? "即時/盤後資料" : "最新可用資料";
    return { mode: `自選股｜${watchlistModeText}`, dataDate: watchlistDataDate, today, isToday: watchlistDataDate === today };
  }
  if (viewName === "realtime-radar") {
    const radarLive = shouldRunLivePolling();
    const radarDataDate = radarLive
      ? realtimeRadarDataDateKey(realtimeRadarLastRows) || realtimeRadarClosedDataDateKey() || dataDate
      : realtimeRadarClosedDataDateKey() || dataDate;
    return { mode: radarLive ? "即時雷達｜盤中巡邏" : "即時雷達｜最新可用收盤資料", dataDate: radarDataDate, today, isToday: radarDataDate === today };
  }
  return { mode: marketModeText, dataDate, today, isToday };
}

function renderDataFreshnessBarHtml(viewName) {
  const meta = getPanelFreshnessMeta(viewName);
  const staleText = meta.isToday ? "" : meta.mode.includes("AI 判讀") ? "｜非今日資料僅供參考" : "｜非今日資料不採用";
  const signature = `${meta.mode}:${meta.dataDate}:${meta.today}:${meta.isToday}`;
  const stateClass = meta.isToday ? "is-live" : "is-stale";
  return `<div class="data-freshness-bar ${stateClass}" data-signature="${escapeAttr(signature)}">模式：<strong>${escapeAttr(meta.mode)}</strong>｜資料日期：<strong>${escapeAttr(formatMarketAiDateKey(meta.dataDate))}</strong>｜今日：<strong>${escapeAttr(formatMarketAiDateKey(meta.today))}</strong>${staleText}</div>`;
}
function refreshDataFreshnessBars() {
  Object.entries(viewPanels).forEach(([viewName, panel]) => {
    if (!panel) return;
    const header = viewName === "strategy" && strategyView?.classList.contains("intraday-only")
      ? panel.querySelector(".intraday-topbar") || panel.querySelector(".page-header")
      : panel.querySelector(".page-header, .radar-topbar");
    if (!header) return;
    const barContainer = header.parentElement || panel;
    let bar = barContainer.querySelector(":scope > .data-freshness-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "data-freshness-bar";
      header.insertAdjacentElement("afterend", bar);
    }
    const meta = getPanelFreshnessMeta(viewName);
    const signature = `${meta.mode}:${meta.dataDate}:${meta.today}:${meta.isToday}`;
    if (bar.dataset.signature === signature) return;
    bar.dataset.signature = signature;
    bar.classList.toggle("is-live", meta.isToday);
    bar.classList.toggle("is-stale", !meta.isToday);
    const staleText = meta.isToday ? "" : meta.mode.includes("AI 判讀") ? "｜非今日資料僅供參考" : "｜非今日資料不採用";
    bar.innerHTML = `模式：<strong>${escapeAttr(meta.mode)}</strong>｜資料日期：<strong>${escapeAttr(formatMarketAiDateKey(meta.dataDate))}</strong>｜今日：<strong>${escapeAttr(formatMarketAiDateKey(meta.today))}</strong>${staleText}`;
  });
}

function marketAiDataDateKey(stocks = []) {
  const counts = new Map();
  normalizeArray(stocks).forEach((stock) => {
    const key = marketAiQuoteDateKey(stock);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function isMarketAiStaleStock(stock) {
  const quoteDate = marketAiQuoteDateKey(stock);
  if (!isMarketAiActiveSession() && !quoteDate) return true;
  return quoteDate && quoteDate !== marketAiTargetDateKey();
}

function isMarketAiFreshRealtimeStock(stock) {
  if (!isMarketAiActiveSession()) return true;
  if (!stock?.isRealtime) return false;
  const updatedAt = cleanNumber(stock.quoteUpdatedAt);
  return updatedAt > 0 && Date.now() - updatedAt <= Math.max(INTRADAY_FAST_SCAN_MS * 6, 30000);
}

function isMarketAiActiveSession() {
  return marketRealtimeState.trading === true
    && marketRealtimeState.marketStatus === "day"
    && isIntradayScanWindow();
}

async function loadMarketAiStocksFallback() {
  if (marketAiStockLoading || latestStocks.length) return;
  marketAiStockLoading = true;
  try {
    const rows = await loadStrategyStocks();
    if (rows.length) {
      renderStocks(rows);
      return;
    }
  } catch (error) {
  } finally {
    marketAiStockLoading = false;
    if (marketMode === "ai") {
      marketAiLastSignature = "";
      renderMarketAiPanel();
    }
  }
}

function updateMarketStockDataState(payload) {
  if (!payload || Array.isArray(payload)) return;
  const today = marketAiTodayKey();
  const incomingDate = normalizeMarketAiDateKey(payload.resolvedTradeDate || payload.tradeDate || payload.quoteDate);
  const livePayloadDate = payload.trading === true || payload.marketStatus === "day" || marketRealtimeState.trading === true || marketRealtimeState.marketStatus === "day";
  const shouldKeepLiveDate = livePayloadDate && payload.isFallbackDate === true;
  marketStockDataState = {
    resolvedTradeDate: shouldKeepLiveDate ? today : incomingDate || marketStockDataState.resolvedTradeDate || "",
    today: normalizeMarketAiDateKey(payload.today) || today,
    source: payload.source || marketStockDataState.source || "",
    updatedAt: payload.updatedAt || marketStockDataState.updatedAt || "",
    isFallbackDate: shouldKeepLiveDate ? false : Boolean(payload.isFallbackDate),
    marketDates: payload.marketDates || marketStockDataState.marketDates || {},
  };
  refreshDataFreshnessBars();
}

async function ensureMarketAiInstitutionData() {
  if (marketAiInstitutionLoading || Object.keys(institutionData).length) return;
  marketAiInstitutionLoading = true;
  try {
    await loadInstitution();
  } catch (error) {
  } finally {
    marketAiInstitutionLoading = false;
    if (marketMode === "ai") {
      marketAiLastSignature = "";
      renderMarketAiPanel();
    }
  }
}

function getMarketAiLegalValue(code) {
  const inst = institutionData[String(code || "")] || {};
  return Number(inst.total) || Number(inst.foreign || 0) + Number(inst.trust || 0) + Number(inst.dealer || 0);
}

function getMarketAiCapitalFlowScore(stock, sector) {
  const pct = cleanNumber(stock.percent);
  const valueYi = cleanNumber(stock.value) / 100000000;
  const volume = cleanNumber(stock.tradeVolume);
  const sectorPct = cleanNumber(sector?.pct);
  return Math.round(clamp(valueYi * 1.35 + Math.min(24, volume / 900) + Math.max(0, pct) * 5 + Math.max(0, sectorPct) * 7, 0, 100));
}

function getMarketAiDayTradeHeatScore(stock, sector) {
  const pct = cleanNumber(stock.percent);
  const valueYi = cleanNumber(stock.value) / 100000000;
  const volume = cleanNumber(stock.tradeVolume);
  const sectorPct = cleanNumber(sector?.pct);
  const legal = getMarketAiLegalValue(stock.code);
  const hotTurnover = Math.min(34, valueYi * 1.8);
  const hotVolume = Math.min(24, volume / 700);
  const moveHeat = Math.max(0, 18 - Math.abs(pct - 2.4) * 4);
  const sectorHeat = Math.max(0, Math.min(12, sectorPct * 4));
  const chipHeat = legal > 0 ? 8 : 0;
  const overheatingPenalty = pct >= 8.5 ? 24 : pct >= 6.5 ? 10 : 0;
  return Math.round(clamp(hotTurnover + hotVolume + moveHeat + sectorHeat + chipHeat - overheatingPenalty, 0, 100));
}

function getMarketAiRiskControlScore(stock, sector, base = {}) {
  const pct = cleanNumber(stock.percent);
  const valueYi = cleanNumber(stock.value) / 100000000;
  const volume = cleanNumber(stock.tradeVolume);
  const legal = getMarketAiLegalValue(stock.code);
  const capitalFlowScore = cleanNumber(base.capitalFlowScore) || getMarketAiCapitalFlowScore(stock, sector);
  const sectorScore = cleanNumber(base.sectorScore);
  const momentumScore = cleanNumber(base.momentumScore);
  const score = cleanNumber(base.score);
  const hotChaseRisk = Math.max(0, pct - 3.2) * 11;
  const valueCrowding = Math.min(24, valueYi * 0.85);
  const volumeCrowding = Math.min(16, volume / 1600);
  const sectorCrowding = sectorScore >= 45 ? 15 : sector?.pct > 1.2 ? 10 : 0;
  const legalCrowding = legal > 0 && capitalFlowScore >= 50 ? 12 : legal > 0 ? 6 : 0;
  const scoreGap = Math.max(0, Math.max(momentumScore, capitalFlowScore) - score) * 0.45;
  const weakButHot = pct < 1 && capitalFlowScore >= 55 ? 10 : 0;
  const downRisk = pct <= -2 ? Math.abs(pct) * 12 : 0;
  return Math.round(clamp(hotChaseRisk + valueCrowding + volumeCrowding + sectorCrowding + legalCrowding + scoreGap + weakButHot + downRisk, 0, 100));
}

function scoreMarketAiStock(stock, sectors) {
  const code = String(stock.code || "");
  const industry = SECTOR_MAP[code] || "其他";
  const sector = sectors.find((item) => item.name === industry);
  const pct = cleanNumber(stock.percent);
  const valueYi = cleanNumber(stock.value) / 100000000;
  const volume = cleanNumber(stock.tradeVolume);
  const legal = getMarketAiLegalValue(code);
  const capitalFlowScore = getMarketAiCapitalFlowScore(stock, sector);
  const dayTradeHeatScore = getMarketAiDayTradeHeatScore(stock, sector);
  const sectorScore = Math.round(clamp((sector?.pct || 0) * 18 + (sector?.up || 0) * 1.2 - (sector?.down || 0) * 0.8, 0, 100));
  const legalScore = Math.round(clamp(Math.abs(legal) / 900 + (legal > 0 ? 20 : 0), 0, 100));
  const momentumScore = Math.round(clamp(Math.max(0, pct) * 9 + valueYi * 0.45 + Math.min(16, volume / 1400), 0, 100));
  let score = capitalFlowScore * 0.34 + dayTradeHeatScore * 0.20 + sectorScore * 0.18 + legalScore * 0.12 + momentumScore * 0.16;
  if (pct < 0) score -= Math.min(42, Math.abs(pct) * 10);
  if (pct <= -3) score = Math.min(score, 45);
  else if (pct <= -1) score = Math.min(score, 58);
  return clamp(Math.round(score), 1, 100);
}

function getMarketAiTags(stock, score, sectors) {
  const code = String(stock.code || "");
  const industry = SECTOR_MAP[code] || "其他";
  const sector = sectors.find((item) => item.name === industry);
  const pct = cleanNumber(stock.percent);
  const valueYi = cleanNumber(stock.value) / 100000000;
  const inst = institutionData[code] || {};
  const tags = [];
  if (pct >= 6) tags.push("動能強");
  if (pct >= 3) tags.push("漲幅領先");
  if (valueYi >= 20) tags.push("量能大");
  if (sector?.pct > 1) tags.push("族群強");
  if ((Number(inst.total) || 0) > 0) tags.push("法人買超");
  if ((Number(inst.foreign) || 0) > 0) tags.push("外資買超");
  if (score >= 75 && pct >= 1 && !tags.includes("風險高")) tags.push("優先觀察");
  return tags.slice(0, 4);
}

function classifyMarketAiStock(stock, sectors) {
  const code = String(stock.code || "");
  const pct = cleanNumber(stock.percent);
  const valueYi = cleanNumber(stock.value) / 100000000;
  const volume = cleanNumber(stock.tradeVolume);
  const industry = SECTOR_MAP[code] || "其他";
  const sector = sectors.find((item) => item.name === industry);
  const legal = getMarketAiLegalValue(code);
  const score = scoreMarketAiStock(stock, sectors);
  const capitalFlowScore = getMarketAiCapitalFlowScore(stock, sector);
  const dayTradeHeatScore = getMarketAiDayTradeHeatScore(stock, sector);
  const sectorScore = Math.round(clamp((sector?.pct || 0) * 18 + (sector?.up || 0) * 1.2 - (sector?.down || 0) * 0.8, 0, 100));
  const momentumScore = Math.round(clamp(capitalFlowScore * 0.5 + score * 0.3 + Math.max(0, pct) * 4 + sectorScore * 0.2, 0, 100));
  const intradayScore = Math.round(clamp(dayTradeHeatScore * 0.62 + capitalFlowScore * 0.18 + momentumScore * 0.12 + sectorScore * 0.08, 0, 100));
  const legalScore = Math.round(clamp(Math.abs(legal) / 900 + (legal > 0 ? 18 : 0), 0, 100));
  const riskScore = getMarketAiRiskControlScore(stock, sector, { score, capitalFlowScore, sectorScore, momentumScore });
  return {
    ...stock,
    score,
    industry,
    legal,
    capitalFlowScore,
    dayTradeHeatScore,
    sectorScore,
    momentumScore,
    intradayScore,
    legalScore,
    riskScore,
    tags: getMarketAiTags(stock, score, sectors),
    buckets: {
      all: true,
      momentum: momentumScore >= 70 && (capitalFlowScore >= 55 || score >= 72 || sectorScore >= 45),
      legal: legal > 0,
      intraday: dayTradeHeatScore >= 55 || intradayScore >= 58,
      risk: riskScore >= 58 || (riskScore >= 48 && (score >= 68 || capitalFlowScore >= 55)) || pct >= 8.5 || pct <= -3,
    },
  };
}

function getMarketAiHotGroups(hotStocks) {
  const groups = {
    all: hotStocks,
    momentum: hotStocks.filter((stock) => stock.buckets.momentum).sort((a, b) => b.score - a.score || b.capitalFlowScore - a.capitalFlowScore || b.momentumScore - a.momentumScore),
    legal: sortMarketAiLegalStocks(hotStocks.filter((stock) => stock.buckets.legal && cleanNumber(stock.percent) > 0)),
    intraday: sortMarketAiIntradayStocks(hotStocks.filter((stock) => stock.buckets.intraday)),
  };
  return groups;
}

function sortMarketAiIntradayStocks(stocks = []) {
  return [...stocks].sort((a, b) =>
    cleanNumber(b.score) - cleanNumber(a.score) ||
    cleanNumber(b.dayTradeHeatScore) - cleanNumber(a.dayTradeHeatScore) ||
    cleanNumber(b.intradayScore) - cleanNumber(a.intradayScore) ||
    (b.tags?.length || 0) - (a.tags?.length || 0) ||
    cleanNumber(b.capitalFlowScore) - cleanNumber(a.capitalFlowScore) ||
    cleanNumber(b.momentumScore) - cleanNumber(a.momentumScore) ||
    cleanNumber(b.value) - cleanNumber(a.value)
  );
}

function sortMarketAiLegalStocks(stocks = []) {
  return [...stocks].sort((a, b) =>
    cleanNumber(b.score) - cleanNumber(a.score) ||
    (b.tags?.length || 0) - (a.tags?.length || 0) ||
    cleanNumber(b.capitalFlowScore) - cleanNumber(a.capitalFlowScore) ||
    cleanNumber(b.intradayScore) - cleanNumber(a.intradayScore) ||
    cleanNumber(b.momentumScore) - cleanNumber(a.momentumScore) ||
    cleanNumber(b.value) - cleanNumber(a.value) ||
    cleanNumber(b.percent) - cleanNumber(a.percent)
  );
}

function sortMarketAiPriorityStocks(stocks = []) {
  return [...stocks].sort((a, b) =>
    cleanNumber(b.score) - cleanNumber(a.score) ||
    (b.tags?.length || 0) - (a.tags?.length || 0) ||
    cleanNumber(b.percent) - cleanNumber(a.percent) ||
    cleanNumber(b.value) - cleanNumber(a.value)
  );
}

function marketAiRowCode(row) {
  return String(row?.code || row?.Code || row?.stockCode || row?.symbol || "").trim();
}

async function fetchMarketAiConfluencePayload(urls = [], fields = []) {
  for (const url of normalizeArray(urls).filter(Boolean)) {
    try {
      const payload = await fetchVersionedJson(url, 10000, "market-ai-confluence", false);
      const rows = fields.flatMap((field) => normalizeArray(payload?.[field]));
      if (rows.length) return payload;
    } catch (error) {}
  }
  return null;
}

async function loadMarketAiConfluenceCaches(force = false) {
  const now = Date.now();
  if (marketAiConfluenceLoading) return;
  if (!force && marketAiConfluenceLoadedAt && now - marketAiConfluenceLoadedAt < 5 * 60 * 1000) return;
  marketAiConfluenceLoading = true;
  try {
    await Promise.allSettled([
      (async () => {
        if (!force && Object.keys(strategy4ScanMatches).length) return;
        const payload = await fetchMarketAiConfluencePayload([endpoints.strategy4Slim], ["matches"]);
        if (payload?.ok && Array.isArray(payload.matches)) mergeStrategy4Cache(payload);
      })(),
      (async () => {
        if (!force && strategy5Data.length) return;
        const payload = await fetchMarketAiConfluencePayload([endpoints.strategy5Cache, endpoints.strategy5Backup], ["matches"]);
        if (!payload) return;
        strategy5Data = normalizeArray(payload.matches);
        const updatedAt = Date.parse(payload.updatedAt || "");
        strategy5UpdatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
        strategy5UsedDateKey = normalizeMarketAiDateKey(payload.usedDate || payload.date || payload.quoteDate) || strategy5UsedDateKey;
      })(),
      (async () => {
        if (!force && strategy3Data.length) return;
        const payload = await fetchMarketAiConfluencePayload([endpoints.strategy3Cache, endpoints.strategy3Backup], ["matches"]);
        if (!payload) return;
        strategy3Data = normalizeArray(payload.matches);
        const updatedAt = Date.parse(payload.updatedAt || "");
        strategy3UpdatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
        strategy3UsedDateKey = normalizeMarketAiDateKey(payload.usedDate || payload.date || payload.quoteDate) || marketAiDataDateKey(strategy3Data);
      })(),
      (async () => {
        if (!force && Object.keys(openBuyScanMatches).length) return;
        const payload = await fetchMarketAiConfluencePayload([endpoints.openBuyCache, endpoints.openBuyBackup], ["matches"]);
        if (!payload) return;
        openBuyScanMatches = Object.fromEntries(normalizeArray(payload.matches).map((row) => [marketAiRowCode(row), row]).filter(([code]) => code));
        openBuyDataDateKey = normalizeMarketAiDateKey(payload.usedDate || payload.date || payload.quoteDate) || openBuyDataDateKey;
      })(),
      (async () => {
        if (!force && realtimeRadarLastRows.length) return;
        const payload = await fetchMarketAiConfluencePayload([endpoints.realtimeRadarCache], ["rows"]);
        if (!payload) return;
        realtimeRadarLastRows = normalizeArray(payload.rows);
        realtimeRadarLastUpdatedAt = cleanNumber(payload.updatedAt) || Date.now();
      })(),
    ]);
    marketAiConfluenceLoadedAt = Date.now();
    marketAiLastSignature = "";
    if (marketMode === "ai") renderMarketAiPanel();
  } catch (error) {
  } finally {
    marketAiConfluenceLoading = false;
  }
}

function buildMarketAiConfluenceStocks(data = {}) {
  const baseByCode = new Map();
  normalizeArray(data.hotStocks).forEach((stock) => baseByCode.set(String(stock.code || ""), stock));
  normalizeArray(latestStocks).forEach((stock) => {
    const code = String(stock.code || stock.Code || "");
    if (code && !baseByCode.has(code)) baseByCode.set(code, classifyMarketAiStock(applyStrategyQuote(stock), data.sectors || []));
  });
  const byCode = new Map();
  const ensure = (row) => {
    const code = marketAiRowCode(row);
    if (!code) return null;
    const base = baseByCode.get(code) || {};
    if (!byCode.has(code)) {
      byCode.set(code, {
        ...base,
        code,
        name: base.name || row.name || row.Name || "",
        confluenceStrategies: [],
        confluenceDetails: [],
      });
    }
    const item = byCode.get(code);
    if (!item.name) item.name = row.name || row.Name || "";
    return item;
  };
  const add = (row, key, label) => {
    const item = ensure(row);
    if (!item || item.confluenceStrategies.some((strategy) => strategy.key === key)) return;
    item.confluenceStrategies.push({ key, label });
    item.confluenceDetails.push(...watchlistStrategyDetails(row, key).map((detail) => `${label}:${detail}`));
  };
  Object.values(strategy4ScanMatches).forEach((row) => add(row, "strategy4", "策略4"));
  normalizeArray(strategy5Data).forEach((row) => add(row, "strategy5", "策略5"));
  normalizeArray(strategy3Data).forEach((row) => add(row, "strategy3", "策略3"));
  Object.values(openBuyScanMatches).forEach((row) => add(row, "openBuy", "策略1"));
  normalizeArray(realtimeRadarLastRows).forEach((row) => add(row, "realtime", "即時雷達"));
  return [...byCode.values()]
    .filter((stock) => stock.confluenceStrategies.length >= 2 && stock.name)
    .map((stock) => ({
      ...stock,
      confluenceCount: stock.confluenceStrategies.length,
      confluenceLabels: stock.confluenceStrategies.map((strategy) => strategy.label),
    }))
    .sort((a, b) =>
      cleanNumber(b.confluenceCount) - cleanNumber(a.confluenceCount) ||
      Number(b.confluenceLabels.includes("策略4") && b.confluenceLabels.includes("策略5")) - Number(a.confluenceLabels.includes("策略4") && a.confluenceLabels.includes("策略5")) ||
      Number(b.confluenceLabels.includes("策略5")) - Number(a.confluenceLabels.includes("策略5")) ||
      Number(b.confluenceLabels.includes("策略4")) - Number(a.confluenceLabels.includes("策略4")) ||
      cleanNumber(b.score) - cleanNumber(a.score) ||
      cleanNumber(b.value) - cleanNumber(a.value)
    );
}

function getMarketAiFilterMeta(groups) {
  return [
    { key: "momentum", label: "動能強", count: 10 },
    { key: "legal", label: "法人買超", count: 10 },
    { key: "intraday", label: "當沖熱", count: 10 },
  ];
}

function isMarketAiLongCandidate(stock, options = {}) {
  const allowReference = options.allowReference === true;
  if (!allowReference && isMarketAiStaleStock(stock)) return false;
  if (!allowReference && !isMarketAiFreshRealtimeStock(stock)) return false;
  const pct = cleanNumber(stock.percent);
  const change = cleanNumber(stock.change);
  const close = cleanNumber(stock.close);
  const value = cleanNumber(stock.value);
  if (!close || !value) return false;
  if (pct <= 2 || change < 0) return false;
  return true;
}

function buildMarketAiData() {
  const allStocks = latestStocks.length
    ? latestStocks.map((stock) => isMarketAiActiveSession() ? applyStrategyQuote(stock) : stock)
    : [];
  const targetDate = marketAiTargetDateKey();
  const preferredRows = allStocks.filter((stock) => !isMarketAiStaleStock(stock));
  const freshRealtimeRows = preferredRows.filter((stock) => isMarketAiFreshRealtimeStock(stock));
  const fallbackDate = marketAiDataDateKey(allStocks);
  const isDateFallback = !preferredRows.length && Boolean(fallbackDate) && fallbackDate !== targetDate;
  const isRealtimeFallback = isMarketAiActiveSession() && preferredRows.length > 0 && freshRealtimeRows.length < Math.min(60, preferredRows.length);
  const isReferenceDate = isDateFallback || isRealtimeFallback;
  const stocks = preferredRows.length
    ? preferredRows
    : allStocks.filter((stock) => !fallbackDate || marketAiQuoteDateKey(stock) === fallbackDate);
  const staleRows = preferredRows.length ? allStocks.filter((stock) => isMarketAiStaleStock(stock)) : [];
  const sample = stocks.length;
  const upRows = stocks.filter((stock) => cleanNumber(stock.percent) > 0);
  const downRows = stocks.filter((stock) => cleanNumber(stock.percent) < 0);
  const flatRows = sample - upRows.length - downRows.length;
  const upRatio = sample ? (upRows.length / sample) * 100 : 0;
  const totalValue = stocks.reduce((sum, stock) => sum + cleanNumber(stock.value), 0) / 100000000;
  const sectors = getMarketAiSectors(stocks);
  const strongSectors = [...sectors].sort((a, b) => b.pct - a.pct).slice(0, 4);
  const weakSectors = [...sectors].sort((a, b) => a.pct - b.pct).slice(0, 4);
  const classifiedStocks = stocks
    .filter((stock) => isMarketAiLongCandidate(stock, { allowReference: isReferenceDate }))
    .map((stock) => classifyMarketAiStock(stock, sectors));
  const hotStocks = classifiedStocks
    .sort((a, b) => b.score - a.score || cleanNumber(b.percent) - cleanNumber(a.percent) || cleanNumber(b.value) - cleanNumber(a.value))
    .slice(0, 40);
  const hotGroups = getMarketAiHotGroups(hotStocks);
  hotGroups.intraday = sortMarketAiIntradayStocks(classifiedStocks.filter((stock) => stock.buckets.intraday)).slice(0, 40);
  if (!hotGroups[marketAiHotFilter] || marketAiHotFilter === "all") marketAiHotFilter = "momentum";
  const visibleHotStocks = hotGroups[marketAiHotFilter].filter((stock) => isMarketAiLongCandidate(stock, { allowReference: isReferenceDate })).slice(0, 10);
  const riskStocks = stocks
    .filter((stock) => cleanNumber(stock.percent) <= -3 || cleanNumber(stock.percent) >= 8.5)
    .sort((a, b) => Math.abs(cleanNumber(b.percent)) - Math.abs(cleanNumber(a.percent)))
    .slice(0, 5);
  const bias = upRatio >= 55 ? "多方偏強" : upRatio <= 45 ? "空方壓制" : "震盪分歧";
  const confidence = sample >= 1000 ? (Math.min(92, 58 + Math.abs(upRatio - 50) * 1.4)).toFixed(0) : "中";
  const dataDate = marketAiDataDateKey(stocks);
  return { stocks, allStocks, staleRows, dataDate, targetDate, isReferenceDate, isDateFallback, isRealtimeFallback, freshRealtimeCount: freshRealtimeRows.length, sample, upRows, downRows, flatRows, upRatio, totalValue, sectors, strongSectors, weakSectors, hotStocks, hotGroups, visibleHotStocks, riskStocks, bias, confidence };
}

function requestMarketAiRealtimeScan(reason = "hot") {
  if (!isMarketAiActiveSession() || !isTerminalUnlocked() || isDocumentHidden()) return;
  const now = Date.now();
  if (strategyRealtimeLoading || now - marketAiRealtimeScanRequestedAt < 8000) return;
  marketAiRealtimeScanRequestedAt = now;
  deferUiWork(async () => {
    await ensureStrategyStocksLoaded();
    await refreshStrategyRealtimeScan(reason === "force" ? "hot" : reason);
    marketAiLastSignature = "";
    renderMarketAiPanel();
  }, 80);
}

function marketAiUpdatedLabel() {
  const at = marketDataLastStartedAt || marketDataLastRenderedAt || Date.now();
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const time = date.toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${month}/${day} ${isMarketAiActiveSession() ? "即時巡邏" : "收盤資料"} · 更新 ${time}`;
}

function marketAiStockLabel(stock) {
  if (!stock) return "";
  return `${stock.code || ""} ${stock.name || ""}`.trim();
}

function marketAiChipList(items = [], tone = "") {
  return items.filter(Boolean).slice(0, 8).map((item) =>
    `<span class="market-ai-detail-chip ${tone ? `market-ai-detail-chip-${tone}` : ""}">${escapeAttr(item)}</span>`
  ).join("");
}

function marketAiSectorChips(sector) {
  return normalizeArray(sector?.rows)
    .sort((a, b) => cleanNumber(b.value) - cleanNumber(a.value) || cleanNumber(b.pct) - cleanNumber(a.pct))
    .slice(0, 3)
    .map(marketAiStockLabel);
}

function marketAiDetailCard({ tone = "info", kicker = "", title = "", action = "", body = "", chips = [], meta = "" }) {
  return `
    <article class="market-ai-detail-card ${escapeAttr(tone)}">
      ${action ? `<span class="market-ai-detail-action">${escapeAttr(action)}</span>` : ""}
      ${kicker ? `<small>${escapeAttr(kicker)}</small>` : ""}
      <h3>${escapeAttr(title)}</h3>
      ${meta ? `<p><b>${escapeAttr(meta)}</b></p>` : ""}
      <p>${escapeAttr(body)}</p>
      ${chips.length ? `<div class="market-ai-detail-chips">${marketAiChipList(chips, tone)}</div>` : ""}
    </article>
  `;
}

function getMarketAiAdviceDetails(kind, data) {
  const strongSectors = normalizeArray(data.strongSectors);
  const riskStocks = normalizeArray(data.riskStocks);
  const hotStocks = normalizeArray(data.hotStocks);
  const riskChips = (riskStocks.length ? riskStocks : normalizeArray(data.downRows)
    .sort((a, b) => cleanNumber(a.percent) - cleanNumber(b.percent))
    .slice(0, 5))
    .map(marketAiStockLabel)
    .filter(Boolean);
  const topSector = strongSectors[0] || {};
  const secondSector = strongSectors[1] || {};
  const thirdSector = strongSectors[2] || {};
  const upCount = data.upRows.length;
  const downCount = data.downRows.length;
  const hotObserveCount = hotStocks.length || data.visibleHotStocks.length || 0;

  if (kind === "sector") {
    return {
      kicker: "族群聚焦",
      title: "只看強族群前 3 名",
      subtitle: `目前有 ${strongSectors.slice(0, 3).length} 組族群強度較佳，先聚焦領頭股與同族群擴散。`,
      cards: strongSectors.slice(0, 3).map((sector, index) => {
        const rows = normalizeArray(sector.rows);
        const upRatio = rows.length ? (rows.filter((stock) => cleanNumber(stock.pct) > 0).length / rows.length) * 100 : 0;
        return {
          tone: index === 0 ? "danger" : "warn",
          kicker: `#${index + 1}`,
          title: sector.name || "未分類族群",
          action: `上漲 ${upRatio.toFixed(1)}%`,
          body: `${rows.length} 檔樣本，平均漲跌 ${(cleanNumber(sector.pct) >= 0 ? "+" : "")}${cleanNumber(sector.pct).toFixed(2)}%，成交額約 ${(cleanNumber(sector.totalValue) / 100000000).toFixed(1)} 億。`,
          chips: marketAiSectorChips(sector),
        };
      }),
    };
  }

  if (kind === "risk") {
    const financePressure = riskChips.slice(0, 4);
    return {
      kicker: "風險排除",
      title: "風險高標的先排除",
      subtitle: `先排除 ${riskChips[0] || "高波動標的"} 等風險標的，等風險降溫再追蹤。`,
      cards: [
        {
          tone: "danger",
          kicker: "高風險標的",
          title: `${Math.max(riskChips.length, riskStocks.length)} 檔優先排除`,
          action: "風控清單",
          body: "偏空、券資壓力或反轉文字被標記時，先移出追價名單，風險降溫再回看。",
          chips: riskChips,
        },
        {
          tone: "info",
          kicker: "資訊",
          title: "族群集中",
          action: "追蹤",
          body: "設備或廠務工程、電子與強勢族群如果只集中少數領頭股，避免只追單一領頭股。",
          chips: [topSector.name, secondSector.name, thirdSector.name].filter(Boolean),
        },
        {
          tone: "danger",
          kicker: "高風險",
          title: "融券壓力",
          action: "先排除",
          body: `${financePressure.join("、") || "高波動標的"} 出現偏空或券資壓力，追蹤軋空、急拉後反轉與追價風險。`,
          chips: financePressure,
        },
      ],
    };
  }

  return {
    kicker: "進場紀律",
    title: "降低追價",
    subtitle: "盤面風險偏高，先把進場條件收緊，避免追高。",
    cards: [
      {
        tone: "warn",
        kicker: "市場廣度",
        title: `上漲 ${data.upRatio.toFixed(1)}% / 下跌 ${(data.sample ? downCount / data.sample * 100 : 0).toFixed(1)}%`,
        action: data.upRatio >= 50 ? "偏多" : "保守",
        body: "下跌家數偏多時，先縮小追價範圍並確認停損位置。",
        chips: [`${upCount.toLocaleString("zh-TW")} 檔上漲`, `${downCount.toLocaleString("zh-TW")} 檔下跌`],
      },
      {
        tone: "info",
        kicker: "訊號池",
        title: `熱門觀察 ${hotObserveCount.toLocaleString("zh-TW")} 檔`,
        action: `${data.riskStocks.length} / ${hotObserveCount || 30}`,
        body: "先用熱門觀察股交叉確認當沖、盤中雷達與族群擴散，不讓單一訊號決定進場。",
        chips: ["當沖候選", "盤中雷達", "熱門觀察"],
      },
    ],
  };
}

function openMarketAiAdviceModal(kind) {
  const data = buildMarketAiData();
  const detail = getMarketAiAdviceDetails(kind, data);
  const existing = document.querySelector("#market-ai-detail-modal");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "market-ai-detail-modal";
  overlay.className = "market-ai-detail-overlay";
  overlay.innerHTML = `
    <section class="market-ai-detail-dialog" role="dialog" aria-modal="true" aria-label="${escapeAttr(detail.title)}">
      <header class="market-ai-detail-head">
        <small>${escapeAttr(detail.kicker)}</small>
        <h2>${escapeAttr(detail.title)}</h2>
        <p>${escapeAttr(detail.subtitle)}</p>
        <button type="button" class="market-ai-detail-close" data-market-ai-detail-close aria-label="關閉">×</button>
      </header>
      <div class="market-ai-detail-body">
        ${detail.cards.map(marketAiDetailCard).join("")}
      </div>
    </section>
  `;
  const closeModal = () => {
    overlay.remove();
    document.removeEventListener("keydown", closeOnEscape);
  };
  const closeOnEscape = (event) => {
    if (event.key === "Escape") closeModal();
  };
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-market-ai-detail-close]")) closeModal();
  });
  document.addEventListener("keydown", closeOnEscape);
  document.body.appendChild(overlay);
}

function renderMarketAiPanel() {
  installMarketTabs();
  if (!marketAiPanel) return;
  const data = buildMarketAiData();
  if (data.isDateFallback && isMarketAiActiveSession() && Date.now() - marketAiHeatmapSyncRequestedAt > 10000) {
    marketAiHeatmapSyncRequestedAt = Date.now();
    deferUiWork(() => refreshMarketAiFromHeatmap(), 80);
  }
  if (data.isReferenceDate && isMarketAiActiveSession()) {
    requestMarketAiRealtimeScan("hot");
  }
  const signature = `${marketAiHotFilter}:${data.dataDate}:${data.targetDate}:${data.isReferenceDate ? 1 : 0}:${strategyRealtimeStats.received}:${data.sample}:${data.staleRows.length}:${data.upRows.length}:${data.downRows.length}:${data.hotStocks.map((stock) => `${stock.code}:${stock.score}:${cleanNumber(stock.percent).toFixed(2)}`).join("|")}`;
  if (signature === marketAiLastSignature && marketAiPanel.innerHTML) return;
  marketAiLastSignature = signature;
  if (!data.sample) {
    marketAiPanel.innerHTML = `<div class="empty-state">等待市場資料載入後產生 AI 判讀。</div>`;
    deferUiWork(loadMarketAiStocksFallback, 100);
    return;
  }
  if (!Object.keys(institutionData).length) deferUiWork(ensureMarketAiInstitutionData, 100);
  if (!marketAiConfluenceLoadedAt && !marketAiConfluenceLoading) deferUiWork(() => loadMarketAiConfluenceCaches(false), 120);
  const confluenceStocks = buildMarketAiConfluenceStocks(data);
  const fallbackPriorityStocks = sortMarketAiPriorityStocks(data.hotStocks.filter((stock) => isMarketAiLongCandidate(stock, { priority: true, allowReference: data.isReferenceDate })));
  const priorityStocks = confluenceStocks.length ? confluenceStocks : fallbackPriorityStocks;
  const topHot = priorityStocks[0] || data.hotStocks[0];
  const filterMeta = getMarketAiFilterMeta(data.hotGroups);
  const activeFilterLabel = filterMeta.find((item) => item.key === marketAiHotFilter)?.label || "全部";
  const strongNames = data.strongSectors.map((sector) => sector.name).join("、") || "尚未形成明顯主流";
  const weakNames = data.weakSectors.filter((sector) => sector.pct < 0).map((sector) => sector.name).join("、") || "暫無明顯弱勢族群";
  const riskNames = data.riskStocks.map((stock) => `${stock.code} ${stock.name}`).join("、") || "暫無極端標的";
  const topHotTags = topHot?.tags?.length ? topHot.tags.join("、") : "";
  const displayHotStocks = data.visibleHotStocks.length
    ? data.visibleHotStocks
    : normalizeArray(data.hotGroups?.momentum || data.hotStocks).filter((stock) => isMarketAiLongCandidate(stock, { allowReference: data.isReferenceDate })).slice(0, 10);
  const displayFilterLabel = data.visibleHotStocks.length ? activeFilterLabel : "AI 綜合";
  const operate = data.bias === "多方偏強"
    ? ["順勢追蹤", "只看強族群前 3 名", "跌破量價支撐先降槓桿"]
    : data.bias === "空方壓制"
    ? ["降低追價", "只做逆勢強股", "等待反彈量價確認"]
    : ["等待方向", "縮小部位", "觀察族群是否擴散"];
  const adviceKinds = ["entry", "sector", "risk"];
  const adviceMeta = ["進場紀律", "族群聚焦", "風險排除"];
  const adviceCopy = [
    `目前主流族群：${strongNames}。`,
    "依共振策略數排序，優先看同時命中策略4/5或多策略疊加的標的。",
    "漲幅過熱或弱勢族群，不納入第一優先。",
  ];
  const adviceHtml = operate.map((item, index) => {
    const kind = adviceKinds[index] || "entry";
    const detail = getMarketAiAdviceDetails(kind, data);
    return `
        <article class="market-ai-card" data-ai-advice="${kind}" role="button" tabindex="0" aria-expanded="false" title="展開判讀細節">
          <small>${escapeAttr(adviceMeta[index] || detail.kicker)}</small>
          <strong>${escapeAttr(item)}</strong>
          <p>${escapeAttr(adviceCopy[index] || detail.subtitle)}</p>
          <span class="market-ai-advice-arrow" aria-hidden="true">›</span>
          <div class="market-ai-advice-detail" aria-hidden="true">
            ${detail.cards.map((card) => `
              <div class="market-ai-advice-detail-item">
                <b>${escapeAttr(card.kicker)}｜${escapeAttr(card.title)}</b>
                <p>${escapeAttr(card.body)}</p>
                ${normalizeArray(card.chips).length ? `<div class="market-ai-advice-detail-chips">${normalizeArray(card.chips).slice(0, 6).map((chip) => `<span>${escapeAttr(chip)}</span>`).join("")}</div>` : ""}
              </div>
            `).join("")}
          </div>
        </article>
      `;
  }).join("");
  const staleNotice = data.isDateFallback
    ? `<div class="market-ai-sort-note">今日即時資料尚未完成更新，以下先用 ${escapeAttr(formatMarketAiDateKey(data.dataDate))} 最新可用資料做參考判讀。</div>`
    : data.isRealtimeFallback
    ? `<div class="market-ai-sort-note">即時報價仍在補齊，先用目前可用行情做盤中參考；已取得即時 ${data.freshRealtimeCount.toLocaleString("zh-TW")} / ${data.sample.toLocaleString("zh-TW")} 檔。</div>`
    : data.staleRows.length
    ? `<div class="market-ai-sort-note">已排除 ${data.staleRows.length.toLocaleString("zh-TW")} 檔非今日資料，AI 多方推薦只使用今日或無日期標記的最新行情。</div>`
    : "";
  const dateModeText = data.isDateFallback
    ? "最新可用資料參考"
    : data.isRealtimeFallback
    ? "盤中補齊中參考"
    : isMarketAiActiveSession()
    ? "盤中即時巡邏"
    : marketStockDataState.isFallbackDate
    ? "最新可用收盤資料"
    : "收盤資料";
  const dataDateNotice = "";
  marketAiPanel.innerHTML = `
    ${dataDateNotice}
    ${staleNotice}
    <section class="market-ai-summary">
      <article class="market-ai-card hero">
        <small>盤中決策節奏</small>
        <strong>${data.bias}</strong>
        <p>${data.upRatio >= 50 ? "上漲家數仍占優勢" : "下跌家數較多"}，盤面以${data.bias === "空方壓制" ? "風險控管" : "族群輪動"}為主，避免追高與流動性不足標的。</p>
        <div class="market-ai-metrics">
          <span>樣本<b>${data.sample.toLocaleString("zh-TW")}</b></span>
          <span>多方<b>${data.upRows.length.toLocaleString("zh-TW")}</b></span>
          <span>空方<b>${data.downRows.length.toLocaleString("zh-TW")}</b></span>
          <span>信心<b>${data.confidence}</b></span>
        </div>
      </article>
      <article class="market-ai-card">
        <small>盤勢廣度</small>
        <strong>${data.bias}</strong>
        <p>上漲 ${data.upRows.length.toLocaleString("zh-TW")} / 下跌 ${data.downRows.length.toLocaleString("zh-TW")}，成交值約 ${data.totalValue.toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 億。</p>
      </article>
      <article class="market-ai-card warning">
        <small>風險控管</small>
        <strong>${data.riskStocks.length ? "先控風險" : "風險正常"}</strong>
        <p>${weakNames} 需要留意；極端波動標的：${riskNames}。</p>
      </article>
      <article class="market-ai-card">
        <small>優先觀察</small>
        <strong>${topHot ? `${topHot.code} ${topHot.name}` : "--"}</strong>
        <p>${topHot ? topHot.confluenceCount
          ? `${topHot.confluenceCount} 策略共振：${escapeAttr(topHot.confluenceLabels.join("、"))}。綜合分數 ${topHot.score || "--"}，族群 ${topHot.industry || "--"}，成交值 ${(cleanNumber(topHot.value) / 100000000).toFixed(1)} 億。`
          : `${topHot.tags.length} 個訊號${topHotTags ? `：${escapeAttr(topHotTags)}` : ""}。綜合分數 ${topHot.score}，族群 ${topHot.industry}，成交值 ${(cleanNumber(topHot.value) / 100000000).toFixed(1)} 億。` : "等待資料。"}</p>
      </article>
    </section>
    <section class="market-ai-advice">
      ${adviceHtml}
    </section>
    <section class="market-ai-main">
      <article class="market-ai-block">
        <h3>AI 今日重點</h3>
        <small>${marketAiUpdatedLabel()}</small>
        <div class="market-ai-list">
          ${[
            `市場廣度目前上漲家數占 ${data.upRatio.toFixed(1)}%，${data.bias === "空方壓制" ? "盤面偏弱，先看風險。" : "可追蹤強勢族群是否擴散。"}`,
            `族群焦點落在 ${strongNames}，弱勢端留意 ${weakNames}。`,
            `${confluenceStocks.length ? "共振觀察" : "熱門觀察"}優先看 ${priorityStocks.slice(0, 3).map((stock) => `${stock.code} ${stock.name}${stock.confluenceCount ? `(${stock.confluenceLabels.join("+")})` : ""}`).join("、") || "等待資料"}。`,
            `盤中雷達目前偏向「${data.bias}」，分數高也要等量價延續確認。`,
          ].map((text, index) => `<div class="market-ai-point"><b>${index + 1}</b><span>${escapeAttr(text)}</span></div>`).join("")}
        </div>
      </article>
      <aside class="market-ai-block">
        <h3>風險提醒</h3>
        <small>${data.riskStocks.length} 則</small>
        <div class="market-ai-risk">
          <article>
            <h4>族群集中</h4>
            <p>主流若只集中在少數股票，盤中容易出現追價後回落，先等第二波確認。</p>
            <div class="market-ai-chips">${data.strongSectors.slice(0, 4).map((sector) => `<span class="market-ai-chip">${escapeAttr(sector.name)}</span>`).join("")}</div>
          </article>
          <article>
            <h4>波動過熱</h4>
            <p>${riskNames} 有極端波動，放進觀察但不要直接當成追價清單。</p>
          </article>
        </div>
      </aside>
    </section>
    <section class="market-ai-block">
      <h3>熱門觀察股</h3>
      <small>依 AI 盤面判讀排序</small>
      <div class="market-ai-filterbar">
        ${filterMeta.map((item) => `
          <button type="button" class="${item.key === marketAiHotFilter ? "active" : ""}" data-ai-hot-filter="${item.key}">
            ${item.label}<em>${item.count}</em>
          </button>
        `).join("")}
      </div>
      <div class="market-ai-sort-note">目前排序 <b>${escapeAttr(displayFilterLabel)}</b>，AI 依盤面強弱、資金流、族群、法人與風險分數綜合判讀。</div>
      <div class="market-ai-hot">
        ${displayHotStocks.map((stock, index) => `
          <article class="market-ai-stock-row">
            <div class="market-ai-rank">#${index + 1}</div>
            <div>
              <h4><span class="market-ai-code">${escapeAttr(stock.code)}</span><span class="market-ai-name">${escapeAttr(stock.name)}</span></h4>
              <p>${marketAiHotFilter === "intraday" ? `當沖熱度 ${stock.dayTradeHeatScore || stock.intradayScore}` : "主力籌碼入選"}，綜合分數 ${stock.score}</p>
              <p>排序主因：綜合分數 ${stock.score}，再交叉看${marketAiHotFilter === "intraday" ? `當沖熱 ${Math.round(clamp(stock.dayTradeHeatScore || stock.intradayScore, 1, 100))}` : `盤中資金流 ${Math.round(clamp(stock.capitalFlowScore || stock.score, 1, 100))}`}與族群強弱。</p>
            </div>
            <div>
              <span class="market-ai-chip">${escapeAttr(stock.industry)}</span>
              <span class="market-ai-chip">${(cleanNumber(stock.value) / 100000000).toFixed(1)} 億</span>
            </div>
            <div class="market-ai-score">
              <small>綜合分數</small>
              <strong>${stock.score}</strong>
            </div>
            <div class="market-ai-tags">${stock.tags.map((tag) => `<span>${escapeAttr(tag)}</span>`).join("")}</div>
            <div class="market-ai-actions">
              <button type="button" data-ai-stock-code="${escapeAttr(stock.code)}" data-ai-stock-name="${escapeAttr(stock.name)}">看分析</button>
              <button type="button" data-ai-watch-code="${escapeAttr(stock.code)}" data-ai-watch-name="${escapeAttr(stock.name)}">加入自選</button>
            </div>
          </article>
        `).join("") || `<div class="empty-state">目前 AI 尚未篩出足夠觀察股。</div>`}
      </div>
    </section>
  `;
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

let chipFlowModuleApi = null;

function getChipFlowContext() {
  return {
    scope: makeFumanModuleScope({
      get latestStocks() { return latestStocks; },
      set latestStocks(value) { latestStocks = value; },
      get institutionData() { return institutionData; },
      set institutionData(value) { institutionData = value; },
      get institutionDate() { return institutionDate; },
      set institutionDate(value) { institutionDate = value; },
      get institutionUpdatedAt() { return institutionUpdatedAt; },
      set institutionUpdatedAt(value) { institutionUpdatedAt = value; },
      get institutionSummary() { return institutionSummary; },
      set institutionSummary(value) { institutionSummary = value; },
      get chipFilter() { return chipFilter; },
      set chipFilter(value) { chipFilter = value; },
      get chipTradePage() { return chipTradePage; },
      set chipTradePage(value) { chipTradePage = value; },
      get chipTradeLastRenderSignature() { return chipTradeLastRenderSignature; },
      set chipTradeLastRenderSignature(value) { chipTradeLastRenderSignature = value; },
      get chipTradeLoadedAt() { return chipTradeLoadedAt; },
      set chipTradeLoadedAt(value) { chipTradeLoadedAt = value; },
      get chipTradeLoading() { return chipTradeLoading; },
      set chipTradeLoading(value) { chipTradeLoading = value; },
      get chipTradePreferFull() { return chipTradePreferFull; },
      set chipTradePreferFull(value) { chipTradePreferFull = value; },
      get chipQuoteHydrating() { return chipQuoteHydrating; },
      set chipQuoteHydrating(value) { chipQuoteHydrating = value; },
      endpoints, CHIP_TRADE_CACHE_MS,
      isViewActive, canRunViewWork, cleanNumber, formatNumber, formatInstitution,
      paginateTerminalRows, buildTerminalPagination, loadInstitutionSummary,
      fetchVersionedJson, normalizeArray, parseStocksForLatest, applyStaticTitleIcons,
      fetchJson, parseQuoteNumber,
    }),
  };
}

async function ensureChipFlowModule() {
  if (chipFlowModuleApi) return chipFlowModuleApi;
  await loadFumanFeatureModule("chipFlow", "terminal-chip-flow.js", "FUMAN_CHIP_FLOW_MODULE");
  chipFlowModuleApi = window.FUMAN_CHIP_FLOW_MODULE.install(getChipFlowContext());
  return chipFlowModuleApi;
}

function renderChipTradeTable() {
  ensureChipFlowModule().then((api) => api.renderChipTradeTable()).catch(() => undefined);
}

async function loadChipTradeData(force = false) {
  const api = await ensureChipFlowModule();
  return api.loadChipTradeData(force);
}

function preloadChipTradeFullData(reason = "idle") {
  if (chipTradeFullPreloadPromise) return chipTradeFullPreloadPromise;
  chipTradeFullPreloadPromise = Promise.allSettled([
    fetchVersionedJsonFallback([
      { url: endpoints.institutionSlim, label: "institution-slim-preload", kind: "institution" },
      { url: endpoints.institutionCache, label: "institution-cache-preload", kind: "institution" },
      { url: endpoints.institutionBackup, label: "institution-backup-preload", kind: "institution" },
    ], 9000, "institution"),
    fetchVersionedJson(endpoints.strategyStocks, 12000, "latest", false),
  ]).finally(() => {
    recordFumanPerformance("preload:chip:" + reason, performance?.now ? performance.now() : Date.now(), true);
  });
  return chipTradeFullPreloadPromise;
}

function stockChange(stock) {
  const change = cleanNumber(valueOf(stock, ["漲跌價差", "Change", "change", "漲跌"]));
  const close = cleanNumber(valueOf(stock, ["收盤價", "ClosingPrice", "close", "price", "收盤"]));
  const rawPercent = valueOf(stock, ["percent", "pct", "漲跌百分比", "漲跌百分比(%)"]);
  const previous = close - change;
  const percent = rawPercent !== "" ? cleanNumber(rawPercent) : previous ? (change / previous) * 100 : 0;
  return { change, close, percent };
}

function parseStocksForLatest(stocks) {
  return normalizeArray(stocks).map((stock) => {
    const code = String(valueOf(stock, ["證券代號", "Code", "code"])).trim();
    const name = valueOf(stock, ["證券名稱", "Name", "name"]);
    const value = cleanNumber(valueOf(stock, ["成交金額", "TradeValue", "value"]));
    const tradeVolume = normalizeTradeVolumeLots(valueOf(stock, ["成交股數", "TradeVolume", "tradeVolume", "volume"]));
    const volumeRatio = cleanNumber(valueOf(stock, ["量比", "VolumeRatio", "volumeRatio", "volume_ratio"]));
    const quoteDate = valueOf(stock, ["quoteDate", "QuoteDate", "tradeDate", "TradeDate", "date", "Date", "資料日期", "交易日期"]);
    const quoteTime = valueOf(stock, ["quoteTime", "QuoteTime", "time", "Time"]);
    const quoteUpdatedAt = cleanNumber(valueOf(stock, ["quoteUpdatedAt", "updatedAtMs", "updatedAt"]));
    const isRealtime = stock?.isRealtime === true;
    const market = valueOf(stock, ["market", "Market", "市場"]);
    return { code, name, value, tradeVolume, volumeRatio, quoteDate, quoteTime, quoteUpdatedAt, isRealtime, market, ...stockChange(stock) };
  }).filter((s) => s.code && s.name && s.close);
}

function buildSectorStocksCache(stocks, options = {}) {
  const nextCache = options.merge ? { ...sectorStocksCache } : {};
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
    const quoteDate = valueOf(stock, ["quoteDate", "QuoteDate", "tradeDate", "TradeDate", "date", "Date", "資料日期", "交易日期"]);
    const quoteTime = valueOf(stock, ["quoteTime", "QuoteTime", "time", "Time"]);
    const quoteUpdatedAt = cleanNumber(valueOf(stock, ["quoteUpdatedAt", "updatedAtMs", "updatedAt"]));
    const isRealtime = stock?.isRealtime === true;
    const industry = SECTOR_MAP[code];
    if (!industry) continue;
    const row = { code, name, close, change, pct, value, volume, quoteDate, quoteTime, quoteUpdatedAt, isRealtime };
    upsertSectorStock(nextCache, industry, row);
  }
  sectorStocksCache = nextCache;
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
  refreshDataFreshnessBars();
  const now = Date.now();
  const signature = getMarketRenderSignature(parsed);
  const canReuseDom = signature === lastMarketRenderSignature && now - marketDataLastRenderedAt < MARKET_DOM_REFRESH_MS;
  if (canReuseDom) {
    refreshDataFreshnessBars();
    if (marketMode === "ai") renderMarketAiPanel();
    return;
  }
  lastMarketRenderSignature = signature;
  marketDataLastRenderedAt = now;

  if (isViewActive("market") || !Object.keys(sectorStocksCache).length) {
    buildSectorStocksCache(stocks);
    renderHeatmapFromCache();
  }
  if (marketMode === "ai") renderMarketAiPanel();

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
  const now = Date.now();
  const sameViewQuick = lastViewName === viewName && now - lastViewShownAt < 2500;
  const mobileFastSwitch = isMobileViewport();
  lastViewName = viewName;
  lastViewShownAt = now;
  Object.entries(viewPanels).forEach(([name, panel])=>{
    panel.hidden = name !== viewName;
    panel.classList.toggle("active", name === viewName);
  });
  syncMobileStrategyVisibility(viewName);
  applyStaticTitleIcons();
  viewLinks.forEach((link)=>link.classList.toggle("active", link===activeLink));
  refreshDataFreshnessBars();
  const locked = applyMemberLocks(viewName, activeLink);
  if (locked) return;
  if (viewName === "market") {
    installMarketSkeleton();
    if (Object.keys(sectorStocksCache).length) renderHeatmapFromCache();
    if (!sameViewQuick) {
      if (mobileFastSwitch && latestStocks.length) deferIdleWork(loadMarketData, 1400);
      else deferUiWork(loadMarketData, mobileFastSwitch ? 120 : 0);
    }
    deferIdleWork(() => loadHeatmap(), mobileFastSwitch ? 2400 : 1000);
  }
  if (viewName === "realtime-radar") {
    markLazyModuleForView(viewName);
    realtimeRadarNeedsFreshScan = !mobileFastSwitch || !realtimeRadarLastRows.length;
    deferUiWork(renderRealtimeRadar, mobileFastSwitch ? 80 : 0);
    if (mobileFastSwitch && realtimeRadarLastRows.length) {
      deferIdleWork(() => {
        if (!isViewActive("realtime-radar") || realtimeRadarRefreshLoading || strategyRealtimeLoading) return;
        realtimeRadarNeedsFreshScan = true;
      }, 1800);
    }
  }
  if (viewName === "strategy") {
    markLazyModuleForView(viewName);
    deferUiWork(renderStrategyScanner, mobileFastSwitch ? 90 : 0);
    if (!selectedStrategyIds.has("swing_radar") && !selectedStrategyIds.has("intraday_2m")) {
      deferUiWork(loadInstitution, mobileFastSwitch ? 1300 : 600);
    } else {
      deferUiWork(() => loadInstitutionSummary(false), mobileFastSwitch ? 1600 : 900);
    }
  }
  if (viewName === "chip-trade") {
    markLazyModuleForView(viewName);
    deferUiWork(() => loadChipTradeData(false), mobileFastSwitch ? 70 : 0);
    if (!isMobileViewport()) deferIdleWork(() => preloadChipTradeFullData("after-top"), 1200);
  }
  if (viewName === "warrant-flow") {
    markLazyModuleForView(viewName);
    deferUiWork(() => loadWarrantFlow(false), mobileFastSwitch ? 70 : 0);
    if (!isMobileViewport()) deferIdleWork(() => preloadWarrantFlowFullData("after-top"), 1200);
  }
  if (viewName === "watchlist") {
    deferUiWork(renderWatchlist, mobileFastSwitch ? 70 : 0);
  }
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

async function loadMarketData(force = false) {
  const now = Date.now();
  const minInterval = getMarketRefreshInterval();
  if (marketDataLoading || (!force && marketDataLastStartedAt && now - marketDataLastStartedAt < minInterval)) return;
  marketDataLoading = true;
  marketDataLastStartedAt = now;
  try {
    if (!force && !shouldRunLivePolling()) {
      const summary = await loadMarketSummary(false);
      if (summary?.ok && normalizeArray(summary.stocks).length) {
        deferUiWork(() => loadMarketData(true), 1200);
        return;
      }
    }

    const payload = await fetchVersionedJson(endpoints.backend, 12000, "", force);

    if (!payload.ok) throw new Error("Backend failed");
    updateMarketStockDataState(payload);
    marketRealtimeState = {
      trading: payload.trading === true,
      marketStatus: payload.marketStatus || "",
      updatedAt: payload.updatedAt || "",
      source: payload.source || "",
    };

    const near = payload.futuresNear || payload.futures || null;
    const next = payload.futuresNext || null;

    renderIndexes(
      normalizeArray(payload.indexes),
      near,
      next,
      payload.marketStatus || null,
      payload.otcSignal || null
    );
    const backendStocks = normalizeArray(payload.stocks);
    if (backendStocks.length) {
      renderStocks(backendStocks);
    } else {
      const stocks = await fetchVersionedJson(endpoints.strategyStocks, 15000, "", force);
      const rows = normalizeArray(stocks?.stocks || stocks);
      if (rows.length) {
        updateMarketStockDataState(stocks);
        renderStocks(rows);
      } else {
        const fallback = await fetchVersionedJson(endpoints.stocks, 15000, "", force);
        updateMarketStockDataState(fallback);
        renderStocks(normalizeArray(fallback?.stocks || fallback));
      }
    }
  } catch (e) {
    try {
      const stocks = await fetchVersionedJson(endpoints.strategyStocks, 15000, "", force);
      updateMarketStockDataState(stocks);
      renderStocks(normalizeArray(stocks?.stocks || stocks));
    } catch (e2) {
      tickerStrip.innerHTML = `<span>官方資料暫時無法連線</span>`;
    }
  } finally {
    marketDataLoading = false;
  }
}

async function loadHeatmap(force = false) {
  if (isDocumentHidden() || !isViewActive("market")) return;
  const now = Date.now();
  const minInterval = getMarketHeatmapRefreshInterval();
  if (heatmapLoading || (!force && heatmapLastStartedAt && now - heatmapLastStartedAt < minInterval)) {
    renderHeatmapFromCache();
    return;
  }
  heatmapLoading = true;
  heatmapLastStartedAt = now;
  if (!Object.keys(sectorStocksCache).length && !heatmap.children.length) {
    heatmap.innerHTML = `<div class="empty-state">載入產業資料中...</div>`;
  } else {
    renderHeatmapFromCache();
  }
  try {
    const data = await fetchVersionedJson(endpoints.heatmap, 15000, marketSummaryPayload?.updatedAt || "", force);
    mergeIndustryMaster(data?.industryMaster);
    const sectors = normalizeArray(data?.sectors);
    if (data?.ok && sectors.length) {
      renderHeatmapSectors(sectors);
      syncLatestStocksFromHeatmapSectors(sectors);
      if (latestStocks.length) {
        buildSectorStocksCache(latestStocks, { merge: true });
      }
      renderHeatmapFromCache();
      return;
    }
    throw new Error("heatmap empty");
  } catch (e) {
    if (!renderHeatmapFromCache() && !buildHeatmapFallbackFromLatestStocks()) {
      heatmap.innerHTML = `<div class="empty-state">產業資料載入失敗</div>`;
    }
  } finally {
    heatmapLoading = false;
  }
}

async function loadInstitution() {
  const active = getActiveViewName();
  if (!canRunViewWork(active)) return null;
  if (institutionDataPromise) return institutionDataPromise;
  institutionDataPromise = (async () => {
    try {
      let data = await fetchVersionedJson(endpoints.institutionSlim, 8000, institutionSummary?.updatedAt || "", false);
      if (!data?.ok || !data?.data || !Object.keys(data.data).length) {
        data = await fetchVersionedJson(endpoints.institutionCache, 10000, institutionSummary?.updatedAt || "", false);
      }
      if (!data?.ok || !data?.data || !Object.keys(data.data).length) {
        data = await fetchVersionedJson(endpoints.institutionBackup, 10000, institutionSummary?.updatedAt || "", false);
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
    } catch (e) {
    } finally {
      institutionDataPromise = null;
    }
  })();
  return institutionDataPromise;
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
    ? new Set(["multi_strategy_confluence"])
    : new Set([text.includes("策略4") ? "swing_radar" : "intraday_2m"]);
  if (text.includes("策略5")) strategy5ActiveId = "multi_strategy_confluence";
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
    deferUiWork(() => loadStrategy5Cache(false), 60);
  } else if (text.includes("策略3")) {
    deferUiWork(async () => {
      await loadStrategyStocks();
      await loadStrategy3Cache(false);
      renderStrategyScanner();
    }, 60);
  } else if (text.includes("策略4")) {
    deferUiWork(() => loadStrategy4Summary(false), 40);
  } else {
    deferUiWork(loadStrategyStocks);
  }
  if (text.includes("策略2") || isRadarNav) {
    deferUiWork(async () => {
      await ensureStrategyStocksLoaded();
      if (shouldRunLivePolling()) await refreshStrategyRealtimeScan("force");
      else renderStrategyScanner();
    }, 80);
  }
  if (text.includes("策略1")) {
    deferUiWork(() => loadOpenBuyCache(true), 60);
  }
  if (text.includes("策略4")) {
    deferUiWork(() => loadStrategy4Cache(false), 60);
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
  const lowerShadowBonus = radarLowerShadowPct(live) >= 3 ? 1200 : 0;
  const upperShadowBonus = radarUpperShadowPct(live) >= 3 ? 1200 : 0;
  const marginBonus = radarMarginChange(live) > 0 ? 1200 : 0;
  const shortMarginBonus = radarShortMarginChange(live) > 0 ? 1200 : 0;
  const signalBonus = (live.intradaySignals?.length || 0) * 900;
  const pctScore = Math.max(pct, -2) * 150;
  const volumeScore = Math.log10(Math.max(volume, 1)) * 38;
  const deltaScore = Math.log10(Math.max(latestDelta, 1)) * 70;
  const pricePenalty = close >= 900 ? 9999 : 0;
  const baseScore = signalBonus + lowerShadowBonus + upperShadowBonus + marginBonus + shortMarginBonus + pctScore + volumeScore + deltaScore - pricePenalty;
  return baseScore * strategyWeight("strategy2Multiplier");
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
    const lowerShadowHit = radarLowerShadowPct(live) >= 3;
    const upperShadowHit = radarUpperShadowPct(live) >= 3;
    const marginIncreaseHit = radarMarginChange(live) > 0;
    const shortMarginIncreaseHit = radarShortMarginChange(live) > 0;
    if (hasIntradayLiquidity(live) && (pct >= 1.5 || pct <= -0.5 || volume >= INTRADAY_MIN_VOLUME || latestDelta >= 50 || lowerShadowHit || upperShadowHit || marginIncreaseHit || shortMarginIncreaseHit)) {
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
      const lowerShadowHit = radarLowerShadowPct(live) >= 3;
      const upperShadowHit = radarUpperShadowPct(live) >= 3;
      const marginIncreaseHit = radarMarginChange(live) > 0;
      const shortMarginIncreaseHit = radarShortMarginChange(live) > 0;
      return close && (
        pct >= 2 ||
        pct <= -0.5 ||
        (open && close >= open && pct >= 0.5) ||
        volume >= 2000 ||
        lowerShadowHit ||
        upperShadowHit ||
        marginIncreaseHit ||
        shortMarginIncreaseHit
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

async function fetchStrategyRealtimeBatches(stocks, batchSize = 80, force = false) {
  const requests = [];
  let requested = 0;
  for (let start = 0; start < stocks.length; start += batchSize) {
    const codes = stocks.slice(start, start + batchSize).map((stock) => stock.code).filter(Boolean);
    if (codes.length) {
      requested += codes.length;
      const codeText = codes.join(",");
      const cacheKey = `strategy2:${codeText}`;
      requests.push(fetchLiveMemoryJson(cacheKey, `${endpoints.realtime}?codes=${encodeURIComponent(codeText)}&t=${Date.now()}`, 12000, FUMAN_LIVE_MEMORY_TTL_MS.strategy2, force));
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
  if (isDocumentHidden() || !isTerminalUnlocked()) return;
  if (strategyRealtimeLoading) {
    return;
  }
  if (scanMode === "strategy5-full") return;
  if (!shouldRunLivePolling() && ["force", "hot", "background"].includes(scanMode)) return;
  const isStrategyVisible = document.querySelector("#strategy-view")?.classList.contains("active");
  const isMarketAiVisible = isViewActive("market") && marketMode === "ai" && isMarketAiActiveSession();
  const isRealtimeRadarVisible = isViewActive("realtime-radar") && shouldRunLivePolling();
  const mobileStrategy2 = isMobileViewport();
  if (mobileStrategy2 && !isRealtimeRadarVisible && scanMode !== "force") {
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
  const isRealtimeStrategy = selectedStrategyIds.has("intraday_2m");
  const isStrategy5Realtime = false;
  if (scanMode !== "force" && scanMode !== "strategy5-full" && !isMarketAiVisible && !isRealtimeRadarVisible && (!isStrategyVisible || (!isRealtimeStrategy && !isStrategy5Realtime))) return;
  if (isRealtimeStrategy && !shouldRunLivePolling()) {
    if (isStrategyVisible && strategySummary) {
      const closingTime = strategyLastScanAt
        ? new Date(strategyLastScanAt).toLocaleTimeString("zh-TW", { hour12: false })
        : "13:30:00";
      strategySummary.textContent = `策略2-當沖雷達｜偵測時間 09:00-13:30，盤後停止掃描｜最後盤中更新 ${closingTime}`;
    }
    if (isStrategyVisible && latestStocks.length) renderStrategyScanner();
    return;
  }
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
    const priorityStocks = buildStrategyRealtimePriorityQueue(scanSource, rankedHotStocks, baseStrongStocks, candidateStocks, hotScanLimit + forceExtraLimit);
    const hotStocks = isStrategy5Realtime
      ? []
      : priorityStocks
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
      const stats = await fetchStrategyRealtimeBatches(hotStocks, hotBatchSize, scanMode === "force");
      requested += stats.requested;
      received += stats.received;
      failed += stats.failed;
      lastError = stats.lastError || lastError;
      markIntradayCandidates(hotStocks);
      strategyLastScanAt = Date.now();
      strategyRealtimeStats = { requested, received, failed, lastError };
      renderStrategyScanner();
      if (isViewActive("realtime-radar")) {
        renderRealtimeRadar();
      }
      if (marketMode === "ai") {
        marketAiLastSignature = "";
        renderMarketAiPanel();
      }
    }
    if (backgroundStocks.length) {
      const stats = await fetchStrategyRealtimeBatches(backgroundStocks, backgroundBatchSize, scanMode === "force");
      requested += stats.requested;
      received += stats.received;
      failed += stats.failed;
      lastError = stats.lastError || lastError;
      markIntradayCandidates(backgroundStocks);
      strategyLastScanAt = Date.now();
      strategyRealtimeStats = { requested, received, failed, lastError };
      renderStrategyScanner();
      if (isViewActive("realtime-radar")) {
        renderRealtimeRadar();
      }
      if (marketMode === "ai") {
        marketAiLastSignature = "";
        renderMarketAiPanel();
      }
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
  if (!isStrategyCacheActive("strategy4")) return;
  if (strategy4CacheLoading) return;
  if (!force && strategy4ScanLastAt && Object.keys(strategy4ScanMatches).length) return;
  if (shouldSkipMobileOtherStrategyCacheRefresh("strategy4", Boolean(strategy4ScanLastAt), force)) {
    renderStrategyScanner();
    return;
  }
  strategy4CacheLoading = true;
  try {
    let payload = await fetchVersionedJson(force ? endpoints.strategy4Slim : (endpoints.strategy4ScoreTop || endpoints.strategy4Slim), 8000, strategy4Summary?.updatedAt || strategy4SummaryLoadedAt || "", force);
    if (!force && normalizeArray(payload?.matches).length) {
      payload = { ...payload, partial: true, complete: false };
    }
    if (!normalizeArray(payload?.matches).length && isMobileViewport() && !force) {
      return;
    }
    if (force && !normalizeArray(payload?.matches).length) {
      payload = await fetchVersionedJson(endpoints.strategy4Cache, 10000, strategy4Summary?.updatedAt || strategy4SummaryLoadedAt || "", force);
    }
    if (force && !normalizeArray(payload?.matches).length) {
      payload = await fetchVersionedJson(endpoints.strategy4Backup, 10000, strategy4Summary?.updatedAt || strategy4SummaryLoadedAt || "", force);
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

async function loadStrategy4Zone(zone, force = false) {
  const normalizedZone = String(zone || "").toUpperCase();
  if (!/^[ABC]$/.test(normalizedZone)) return false;
  if (!force && strategy4LoadedZones.has(normalizedZone)) return true;
  if (strategy4ZoneLoading[normalizedZone]) return strategy4ZoneLoading[normalizedZone];
  const endpointByZone = {
    A: endpoints.strategy4ZoneA,
    B: endpoints.strategy4ZoneB,
    C: endpoints.strategy4ZoneC,
  };
  const endpoint = endpointByZone[normalizedZone];
  if (!endpoint) return false;
  strategy4ZoneLoading[normalizedZone] = (async () => {
    try {
      const payload = await fetchVersionedJson(endpoint, 8000, strategy4Summary?.updatedAt || strategy4SummaryLoadedAt || "", force);
      if (!payload?.ok || !Array.isArray(payload.matches)) return false;
      const merged = mergeStrategy4ZoneCache(payload, normalizedZone);
      if (merged) renderStrategyScanner();
      return merged;
    } catch (error) {
      return false;
    } finally {
      delete strategy4ZoneLoading[normalizedZone];
    }
  })();
  return strategy4ZoneLoading[normalizedZone];
}

async function refreshStrategyHistoryScan(force = false) {
  await loadStrategy4Cache(force);
}

tickClock();
labelChipTradeMode();
installMobileWatchlistNavOrder();
installMobileToolPinning();
installRealtimeRadarView();
applyStaticTitleIcons();
installMarketTabs();
installGlobalRefreshWidget();
deferUiWork(() => loadWorkflowRunStatus().catch(() => {}), 2000);
deferUiWork(() => loadStrategyWeights(false), 450);
ensureMobileAutoOrganizeButton();
if (isViewActive("market")) {
  installMarketSkeleton();
  deferUiWork(() => loadTerminalHomeBundle(false), 20);
  deferUiWork(() => loadHealthSummary(false), 300);
  deferUiWork(() => loadMarketSummary(false), 80);
  loadMarketData();
  if (isMobileViewport()) deferUiWork(loadHeatmap, 1600);
  else loadHeatmap();
}

function buildStrategyRealtimePriorityQueue(scanSource, rankedHotStocks, baseStrongStocks, candidateStocks, limit) {
  const scored = uniqueStocksByCode([...candidateStocks, ...baseStrongStocks, ...rankedHotStocks, ...scanSource])
    .map((stock) => {
      const quote = strategyRealtimeQuotes[String(stock.code || "")] || {};
      const quoteAge = cleanNumber(quote.updatedAt) ? Date.now() - cleanNumber(quote.updatedAt) : Number.MAX_SAFE_INTEGER;
      const candidateBoost = intradayCandidateSeenAt[stock.code] ? 220 : 0;
      const freshPenalty = quoteAge < 6000 ? 180 : quoteAge < 15000 ? 80 : 0;
      const valueBoost = Math.min(80, cleanNumber(stock.value) / 25000000);
      return {
        stock,
        priority: getIntradayHotScore(stock) + candidateBoost + valueBoost - freshPenalty,
      };
    })
    .sort((a, b) => b.priority - a.priority)
    .map((item) => item.stock);
  if (!scored.length) return [];
  const start = strategyRealtimePriorityCursor % scored.length;
  strategyRealtimePriorityCursor = (strategyRealtimePriorityCursor + Math.max(limit, 1)) % scored.length;
  return [...scored.slice(start), ...scored.slice(0, start)].slice(0, limit);
}
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
document.addEventListener("click", (event) => {
  const modeButton = event.target.closest("[data-market-mode]");
  if (modeButton) {
    applyMarketMode(modeButton.dataset.marketMode);
    return;
  }
  const adviceCard = event.target.closest("[data-ai-advice]");
  if (adviceCard) {
    const isOpen = adviceCard.classList.toggle("is-open");
    adviceCard.setAttribute("aria-expanded", isOpen ? "true" : "false");
    adviceCard.querySelector(".market-ai-advice-detail")?.setAttribute("aria-hidden", isOpen ? "false" : "true");
    return;
  }
  const hotFilterButton = event.target.closest("[data-ai-hot-filter]");
  if (hotFilterButton) {
    marketAiHotFilter = hotFilterButton.dataset.aiHotFilter || "all";
    marketAiLastSignature = "";
    renderMarketAiPanel();
    return;
  }
  const analyzeButton = event.target.closest("[data-ai-stock-code]");
  if (analyzeButton) {
    const code = analyzeButton.dataset.aiStockCode || "";
    const name = analyzeButton.dataset.aiStockName || latestStocks.find((stock) => stock.code === code)?.name || code;
    addStockToWatchlistAndOpen(code, name);
    return;
  }
  const watchButton = event.target.closest("[data-ai-watch-code]");
  if (!watchButton || typeof getWatchlist !== "function" || typeof saveWatchlist !== "function") return;
  const code = watchButton.dataset.aiWatchCode || "";
  const name = watchButton.dataset.aiWatchName || code;
  if (!code) return;
  const list = getWatchlist();
  if (!list.some((item) => item.code === code)) {
    list.push({ code, name });
    saveWatchlist(list);
  }
  watchButton.textContent = "已加入";
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const adviceCard = event.target.closest?.("[data-ai-advice]");
  if (!adviceCard) return;
  event.preventDefault();
  const isOpen = adviceCard.classList.toggle("is-open");
  adviceCard.setAttribute("aria-expanded", isOpen ? "true" : "false");
  adviceCard.querySelector(".market-ai-advice-detail")?.setAttribute("aria-hidden", isOpen ? "false" : "true");
});
viewLinks.forEach((link)=>{
  link.addEventListener("click",(e)=>{
    e.preventDefault();
    rememberCommonTab(link.dataset.view, link.textContent || "");
    if (!isProtectedView(link.dataset.view) || isTerminalUnlocked()) applyStrategyPresetFromLink(link);
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
document.addEventListener("click", async (event) => {
  const fullLoadButton = event.target.closest("[data-mobile-full-load]");
  if (!fullLoadButton) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const target = fullLoadButton.dataset.mobileFullLoad || "";
  fullLoadButton.disabled = true;
  const originalText = fullLoadButton.textContent;
  fullLoadButton.textContent = "載入中";
  try {
    if (target === "chip") {
      chipTradePreferFull = true;
      chipTradeLoadedAt = 0;
      await preloadChipTradeFullData("manual");
      await loadChipTradeData(false);
    } else if (target === "warrant") {
      warrantFlowPreferFull = true;
      await preloadWarrantFlowFullData("manual");
      await loadWarrantFlow(false);
    }
  } finally {
    fullLoadButton.disabled = false;
    fullLoadButton.textContent = originalText || "完整列表";
  }
});
setInterval(tickClock, 60 * 1000);
setInterval(() => {
  if (!isDocumentHidden() && isViewActive("market")) loadMarketData();
}, MARKET_POLL_TICK_MS);
setInterval(() => {
  if (!isDocumentHidden() && isTerminalUnlocked() && isViewActive("strategy") && selectedStrategyIds.has("intraday_2m") && shouldRunLivePolling()) refreshStrategyRealtimeScan("hot");
}, INTRADAY_FAST_SCAN_MS);
setInterval(() => {
  if (!isDocumentHidden() && isTerminalUnlocked() && isViewActive("market") && marketMode === "ai" && isMarketAiActiveSession()) refreshStrategyRealtimeScan("hot");
}, MARKET_POLL_TICK_MS);
setInterval(() => {
  if (!isDocumentHidden() && isTerminalUnlocked() && isViewActive("strategy") && selectedStrategyIds.has("intraday_2m") && shouldRunLivePolling()) refreshStrategyRealtimeScan("background");
}, INTRADAY_BACKGROUND_SCAN_MS);
setInterval(async () => {
  if (realtimeRadarRefreshLoading) return;
  if (isDocumentHidden() || !isTerminalUnlocked() || !isViewActive("realtime-radar") || !shouldRunLivePolling()) return;
  realtimeRadarRefreshLoading = true;
  try {
    await loadMarketData(true);
    await refreshStrategyRealtimeScan(isRealtimeRadarSignalStale(realtimeRadarLastRows) ? "force" : "hot");
    renderRealtimeRadar();
  } finally {
    realtimeRadarRefreshLoading = false;
  }
}, REALTIME_RADAR_REFRESH_MS);
setInterval(() => {
  if (isDocumentHidden() || !isViewActive("market")) return;
  if (!shouldRunLivePolling() && heatmapLastStartedAt && Date.now() - heatmapLastStartedAt < MARKET_HEATMAP_CLOSED_MS) return;
  if (renderHeatmapFromCache()) return;
  if (buildHeatmapFallbackFromLatestStocks()) return;
  loadHeatmap();
}, MARKET_POLL_TICK_MS);
function refreshActiveChipWarrantView(force = true) {
  if (isDocumentHidden() || !isTerminalUnlocked()) return;
  if (isViewActive("chip-trade")) {
    loadChipTradeData(force);
    return;
  }
  if (isViewActive("warrant-flow")) {
    loadWarrantFlow(force);
  }
}
setInterval(() => refreshActiveChipWarrantView(true), CHIP_WARRANT_ACTIVE_REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (!isDocumentHidden()) refreshActiveChipWarrantView(true);
});
window.addEventListener("focus", () => refreshActiveChipWarrantView(true));

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
  loadFumanStyle("terminal-watchlist.css", "watchlist-analysis-styles");
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

const technicalTimeframes = FUMAN_UI_CONFIG.technicalTimeframes || [];

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

function dashboardGaugeMarkup(code, analysis) {
  return `
    <section class="watch-ta-panel">
      ${gaugeMarkup(`${code}的技術分析`, analysis.score, "large")}
    </section>
  `;
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

const watchlistStrategySources = [
  { key: "openBuy", label: "策略1-明日開盤入", urls: () => [endpoints.openBuyCache, endpoints.openBuyBackup], fields: ["matches"] },
  { key: "strategy2", label: "策略2-當沖雷達", urls: () => [endpoints.strategy2IntradayLiveTop, endpoints.strategy2IntradayTop, endpoints.strategy2IntradaySlim], fields: ["events", "records"] },
  { key: "strategy3", label: "策略3-隔日沖", urls: () => [endpoints.strategy3Cache, endpoints.strategy3Backup], fields: ["matches"] },
  { key: "strategy4", label: "策略4-波段", urls: () => [endpoints.strategy4Slim], fields: ["matches"] },
  { key: "strategy5", label: "策略5-綜合策略", urls: () => [endpoints.strategy5Cache, endpoints.strategy5Backup], fields: ["matches"] },
  { key: "realtime", label: "即時雷達", urls: () => [endpoints.realtimeRadarCache], fields: ["rows"] },
];

function watchlistRowsFromPayload(payload, fields = []) {
  if (Array.isArray(payload)) return payload;
  return fields.flatMap((field) => normalizeArray(payload?.[field]));
}

function watchlistSignalLabelById(id) {
  const key = String(id || "").trim();
  if (!key) return "";
  const defs = [
    ...Object.values(STRATEGY_BY_ID || {}),
    ...normalizeArray(FUMAN_STRATEGY_CONFIG.INTRADAY_SIGNAL_DEFS),
    ...normalizeArray(FUMAN_STRATEGY_CONFIG.SWING_SIGNAL_DEFS),
  ];
  const match = defs.find((item) => item?.id === key);
  return match?.label || match?.title || "";
}

function watchlistSignalText(value) {
  if (!value) return "";
  if (typeof value === "string") {
    return watchlistSignalLabelById(value) || value;
  }
  const id = value.id || value.strategy;
  return value.label || value.name || value.title || watchlistSignalLabelById(id) || value.strategy || value.id || "";
}

function watchlistStrategyDetails(row, sourceKey = "") {
  const detailSources = {
    openBuy: [
      row.setup,
      row.status,
    ],
    strategy2: [
      row.strategy,
      row.stateLabel,
      ...normalizeArray(row.strategies).map(watchlistSignalText),
      ...normalizeArray(row.intradaySignals).map(watchlistSignalText),
    ],
    strategy3: [
      row.setup,
      row.status,
      ...normalizeArray(row.matches).map(watchlistSignalText),
    ],
    strategy4: [
      row.strategyLabel,
      ...normalizeArray(row.signals).map(watchlistSignalText),
      ...normalizeArray(row.swingSignals).map(watchlistSignalText),
    ],
    strategy5: [
      row.activeMatch,
      ...normalizeArray(row.matches).filter((match) => STRATEGY5_BASE_PRESET_IDS.includes(match?.id)).map(watchlistSignalText),
    ],
    realtime: [
      ...normalizeArray(row.signalTags).map(watchlistSignalText),
    ],
  };
  const labels = (detailSources[sourceKey] || []).map(watchlistSignalText).map((item) => String(item || "").trim()).filter(Boolean);
  return [...new Set(labels)].slice(0, 4);
}

async function loadWatchlistStrategyIndex() {
  if (!endpoints.strategyMatchIndex) return null;
  if (!watchlistStrategyIndexPromise) {
    watchlistStrategyIndexPromise = fetchVersionedJson(endpoints.strategyMatchIndex, 4500, "latest", false)
      .then((payload) => {
        watchlistStrategyIndexCache = payload?.byCode && typeof payload.byCode === "object" ? payload : null;
        return watchlistStrategyIndexCache;
      })
      .catch(() => {
        watchlistStrategyIndexCache = null;
        return null;
      });
  }
  return watchlistStrategyIndexCache || await watchlistStrategyIndexPromise;
}

async function loadWatchlistStrategyMatches(code) {
  const targetCode = String(code || "");
  if (!targetCode) return [];
  const indexPayload = await loadWatchlistStrategyIndex();
  const indexed = normalizeArray(indexPayload?.byCode?.[targetCode]);
  if (indexed.length) {
    return indexed.map((match) => ({
      key: match.key || "",
      label: match.label || match.key || "",
      details: normalizeArray(match.details).slice(0, 5),
      score: cleanNumber(match.score),
      date: normalizeMarketAiDateKey(match.date || match.updatedAt),
    }));
  }
  if (!watchlistStrategyMatchPromise) {
    watchlistStrategyMatchPromise = Promise.all(watchlistStrategySources.map(async (source) => {
      const urls = source.urls().filter(Boolean);
      for (const url of urls) {
        try {
          const payload = await fetchVersionedJson(url, 9000, "latest", false);
          const rows = watchlistRowsFromPayload(payload, source.fields);
          if (!rows.length) continue;
          return {
            ...source,
            rows,
            date: normalizeMarketAiDateKey(payload?.usedDate || payload?.date || payload?.tradeDate || payload?.updatedAt),
          };
        } catch (error) {
        }
      }
      return { ...source, rows: [], date: "" };
    })).then((sources) => {
      watchlistStrategyMatchCache = sources;
      return sources;
    });
  }
  const sources = watchlistStrategyMatchCache || await watchlistStrategyMatchPromise;
  return sources.flatMap((source) => {
    const rows = normalizeArray(source.rows).filter((row) => String(row?.code || "") === targetCode);
    if (!rows.length) return [];
    const details = [...new Set(rows.flatMap((row) => watchlistStrategyDetails(row, source.key)))].slice(0, 5);
    const score = Math.max(...rows.map((row) => cleanNumber(row.score || row.maxScore)).filter(Boolean), 0);
    return [{
      key: source.key,
      label: source.label,
      details,
      score,
      date: source.date,
    }];
  });
}

function watchlistStrategySummaryMarkup(matches) {
  if (!matches.length) {
    return `<strong>0</strong><em>未出現在策略終端</em>`;
  }
  const pills = matches.map((match) => {
    const detail = match.details.length ? `：${match.details.join("、")}` : "";
    return `<span>${escapeAttr(match.label)}${escapeAttr(detail)}</span>`;
  }).join("");
  return `
    <strong>${matches.length}</strong>
    <div class="watch-strategy-list">${pills}</div>
  `;
}

async function showTradingDashboard(code, name) {
  ensureWatchlistAnalysisStyles();
  const fallback = latestStocks.find(s => s.code === code) || { code, name, close: 0, change: 0, percent: 0 };
  const [stockResult, strategyMatches] = await Promise.all([
    fetchStockPrice(code),
    loadWatchlistStrategyMatches(code),
  ]);
  const stock = stockResult || fallback;
  const activeTimeframe = getTechnicalTimeframe();
  watchlistDashboardSignature = `${code}:${stock.close}:${stock.change.toFixed(2)}:${stock.percent.toFixed(2)}:${activeTimeframe.key}`;
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
          ${watchlistStrategySummaryMarkup(strategyMatches)}
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

      <section class="ta-period-panel" data-watch-dashboard-panel>
        <nav class="ta-timeframes" aria-label="技術分析週期">
          <button class="ta-timeframe ta-dashboard-tab active" type="button" aria-current="page">儀表板</button>
          ${buildTimeframeButtons(activeTimeframe.key)}
        </nav>
        ${dashboardGaugeMarkup(code, analysis)}
      </section>
    </div>
  `;

  watchlistAnalysis.querySelectorAll(".ta-timeframe[data-timeframe]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedTechnicalTimeframe = button.dataset.timeframe;
      localStorage.setItem("fuman-technical-timeframe", selectedTechnicalTimeframe);
      showTradingDashboard(code, stock.name || name);
    });
  });

  watchlistAnalysis.querySelector("[data-watch-load]")?.addEventListener("click", () => {
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
    const text = String(value ?? "").replace(/,/g, "").trim();
    const firstLevel = text.includes("_") ? text.split("_").find(Boolean) : text;
    const number = Number(firstLevel);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function parseRealtimeQuotePrice(item) {
  const last = parseQuoteNumber(item?.z, item?.pz);
  if (last) return last;
  const bestBid = parseQuoteNumber(item?.b);
  const bestAsk = parseQuoteNumber(item?.a);
  if (bestBid && bestAsk) return roundTradePrice((bestBid + bestAsk) / 2);
  return parseQuoteNumber(bestBid, bestAsk, item?.o, item?.h, item?.l, item?.y);
}

async function fetchDailyStockFallback(code) {
  try {
    const rows = await loadStrategyStocks();
    const item = normalizeArray(rows).find((row) => String(row.code || row.Code || "") === code);
    if (!item) return null;
    const close = cleanNumber(item.close || item.ClosingPrice);
    const change = cleanNumber(item.change || item.Change);
    const previous = close - change;
    const percent = previous ? (change / previous) * 100 : 0;
    return { code, name: item.name || item.Name || code, close, change, percent, tradeVolume: cleanNumber(item.tradeVolume) || normalizeTradeVolumeLots(item.TradeVolume) };
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

function updateWatchlistQuoteDate(stock) {
  const quoteDate = marketAiQuoteDateKey(stock) || (stock?.isRealtime ? marketAiTodayKey() : "");
  if (!quoteDate) return;
  if (!watchlistQuoteDateKey || quoteDate >= watchlistQuoteDateKey) {
    watchlistQuoteDateKey = quoteDate;
    refreshDataFreshnessBars();
  }
}

async function fetchStockPrice(code) {
  const cached = latestStocks.find(s => s.code === code) || null;
  try {

    const url = `/api/proxy?code=${code}`;
    const data = await fetchJson(url, 5000);
    const item = data?.msgArray?.[0];
    if (!item) return await fetchHeatmapStockFallback(code) || await fetchDailyStockFallback(code) || cached;

    const close = parseRealtimeQuotePrice(item);
    const prev = parseQuoteNumber(item.y, item.z, item.o, item.h, item.l);
    if (!close || !prev) return await fetchHeatmapStockFallback(code) || await fetchDailyStockFallback(code) || cached;
    const change = close - prev;
    const percent = prev ? (change / prev) * 100 : 0;
    return {
      code,
      name: item.n || code,
      close,
      change,
      percent,
      tradeVolume: parseQuoteNumber(item.v, item.tv),
      quoteDate: normalizeMarketAiDateKey(item.d || item.date || item.tlong) || marketAiTodayKey(),
      quoteTime: item.t || item.ot || "",
      isRealtime: true,
    };
  } catch {
    return await fetchHeatmapStockFallback(code) || await fetchDailyStockFallback(code) || cached;
  }
}

async function renderWatchlist() {
  if (!isViewActive("watchlist") || !isTerminalUnlocked()) return;
  const list = getWatchlist();
  if (!list.length) {
    watchlistStocks.innerHTML = `<div style="text-align:center; padding:40px; color:#555;">尚未新增自選股，請輸入股票代號後點新增</div>`;
    return;
  }

  watchlistStocks.innerHTML = list.map(item => `
    <div class="watchlist-card" id="wcard-${item.code}" data-code="${item.code}" data-name="${item.name || item.code}"
      style="background:#12151f; border:1px solid #2a2f45; border-radius:10px; padding:16px 20px; cursor:pointer; transition:border-color 0.2s;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="color:#7ec8e3; font-size:16px; font-weight:700;">${item.code}</span>
            <span style="color:#fff; font-size:15px; font-weight:600;">${item.name || ""}</span>
            <span class="watch-market-badge">上市</span>
          </div>
          <div style="margin-top:6px;">
            <span id="wprice-${item.code}" style="font-size:24px; font-weight:700; color:#fff;">--</span>
            <span id="wchange-${item.code}" style="font-size:13px; margin-left:8px; color:#aaa;">載入中...</span>
          </div>
          <div style="margin-top:12px; padding-top:12px; border-top:2px solid #f97316; font-size:12px; color:#666;" id="winst-${item.code}">
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
      updateWatchlistQuoteDate(stock);
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
  if (!isTerminalUnlocked()) return;
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
  if (!isTerminalUnlocked()) return;
  const list = getWatchlist().filter(w => w.code !== code);
  saveWatchlist(list);
  renderWatchlist();
  watchlistAnalysis.innerHTML = `<div style="color:#555; font-size:14px;">點擊左側股票查看技術分析</div>`;
}

viewPanels.watchlist = document.querySelector("#watchlist-view");
syncMobileStrategyVisibility();
arrangeWatchlistSearch();
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

document.addEventListener("pointerdown", (event) => {
  const radarSide = event.target.closest("[data-radar-side]");
  if (!radarSide) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  switchRealtimeRadarSide(radarSide.dataset.radarSide || "long");
}, true);

document.addEventListener("click", (event) => {
  const radarSide = event.target.closest("[data-radar-side]");
  if (radarSide) {
    switchRealtimeRadarSide(radarSide.dataset.radarSide || "long");
    return;
  }
  const radarRefresh = event.target.closest("[data-radar-refresh]");
  if (!radarRefresh) return;
  realtimeRadarSide = "auto";
  realtimeRadarNeedsFreshScan = true;
  realtimeRadarHistoryLastAt = 0;
  if (!realtimeRadarRefreshLoading) {
    realtimeRadarRefreshLoading = true;
    Promise.resolve()
      .then(async () => {
        await loadMarketData(true);
        await refreshStrategyRealtimeScan("force");
        realtimeRadarNeedsFreshScan = false;
      })
      .finally(() => {
        realtimeRadarRefreshLoading = false;
        renderRealtimeRadar();
      });
  }
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
  const zoneButton = event.target.closest("[data-swing-zone-filter]");
  if (zoneButton) {
    swingZoneFilter = zoneButton.dataset.swingZoneFilter || "all";
    swingPage = 1;
    renderStrategyScanner();
    if (/^[ABC]$/.test(swingZoneFilter)) {
      loadStrategy4Zone(swingZoneFilter).catch(() => {});
    }
    return;
  }
  const filterButton = event.target.closest("[data-swing-filter]");
  if (!filterButton) return;
  swingSignalFilter = filterButton.dataset.swingFilter || "all";
  if (swingSignalFilter === "all") swingZoneFilter = "all";
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
  applyStrategyInlineDomFilter();
});

document.addEventListener("compositionstart", (event) => {
  if (event.target.closest("[data-strategy-inline-search]")) {
    strategyInlineSearchComposing = true;
  }
});

document.addEventListener("compositionend", (event) => {
  const input = event.target.closest("[data-strategy-inline-search]");
  if (!input) return;
  strategyInlineSearchComposing = false;
  strategyKeyword = input.value || "";
  applyStrategyInlineDomFilter();
});

document.addEventListener("input", (event) => {
  const input = event.target.closest("[data-warrant-flow-search]");
  if (!input) return;
  warrantFlowKeyword = input.value || "";
  warrantFlowPage = 1;
  applyWarrantInlineDomFilter();
});

document.addEventListener("click", (event) => {
  const sizeButton = event.target.closest("[data-terminal-page-size]");
  if (sizeButton) {
    const scope = sizeButton.dataset.terminalPageSizeScope || "";
    const size = cleanNumber(sizeButton.dataset.terminalPageSize);
    if (TERMINAL_PAGE_SIZE_OPTIONS.includes(size)) {
      terminalPageSizes[scope] = size;
      if (scope === "openBuy") openBuyPage = 1;
      if (scope === "swing") swingPage = 1;
      if (scope === "strategy3") strategy3Page = 1;
      if (scope === "strategy5") strategy5Page = 1;
      if (scope === "warrant") warrantFlowPage = 1;
      if (scope === "chip") chipTradePage = 1;
      if (scope === "warrant") renderWarrantFlow();
      else if (scope === "chip") renderChipTradeTable();
      else renderStrategyScanner();
    }
    return;
  }
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
  strategy5ActiveId = filterButton.dataset.strategy5Filter || "multi_strategy_confluence";
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
  scheduleStrategySearchRender();
});

async function refreshSelectedWatchlistQuote() {
  if (isDocumentHidden() || !isViewActive("watchlist") || !isTerminalUnlocked()) return;
  if (watchlistRefreshLoading) return;
  const card = document.querySelector(".watchlist-card.selected");
  if (!card) return;
  watchlistRefreshLoading = true;
  try {
    const stock = await fetchStockPrice(card.dataset.code);
    if (!stock) return;
    updateWatchlistQuoteDate(stock);
    const priceEl = document.querySelector(`#wprice-${card.dataset.code}`);
    const changeEl = document.querySelector(`#wchange-${card.dataset.code}`);
    if (priceEl) priceEl.textContent = stock.close ? stock.close.toLocaleString("zh-TW") : "--";
    if (changeEl) {
      const sign = stock.change >= 0 ? "+" : "";
      changeEl.style.color = stock.change > 0 ? "#e74c3c" : stock.change < 0 ? "#27ae60" : "#aaa";
      changeEl.textContent = `${sign}${stock.change.toFixed(2)} (${sign}${stock.percent.toFixed(2)}%)`;
    }
    const signature = `${card.dataset.code}:${stock.close}:${stock.change.toFixed(2)}:${stock.percent.toFixed(2)}:${selectedTechnicalTimeframe}`;
    if (signature === watchlistDashboardSignature) return;
    watchlistDashboardSignature = signature;
    showTradingDashboard(card.dataset.code, stock.name || card.dataset.name);
  } finally {
    watchlistRefreshLoading = false;
  }
}

installThemeToggle();
if (isViewActive("watchlist")) renderWatchlist();
setInterval(() => {
  if (!isDocumentHidden() && isTerminalUnlocked() && isViewActive("watchlist")) refreshSelectedWatchlistQuote();
}, 10000);

