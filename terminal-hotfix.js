(function () {
  if (window.__fumanTerminalHotfix === "20260623-09") return;
  window.__fumanTerminalHotfix = "20260623-09";

  installDesktopApiPollingCache();
  installDesktopViewSnapshotCache();
  installInstantViewSwitch();
  installDesktopInteractionBudget();
  installFastViewClickReplay();
  installStrategyPublicRouteBridge();
  installWarmMainApp();
  installScriptPreload();
  installHotPathDataWarmup();
  installHotfixStyle();

  function mark(name) {
    if (!("performance" in window) || !performance.mark) return;
    try { performance.mark(`fuman:hotfix:${name}`); } catch (error) {}
  }

  function installHotfixStyle() {
    if (document.querySelector("#fuman-terminal-hotfix-style")) return;
    const style = document.createElement("style");
    style.id = "fuman-terminal-hotfix-style";
    style.textContent = `
      html.fuman-desktop-fast-path,
      html.fuman-desktop-fast-path body {
        scroll-behavior: auto !important;
      }
      body.fuman-view-switching .view-panel {
        transition: none !important;
      }
      body.fuman-view-switching .view-panel.active {
        content-visibility: auto;
        contain: layout paint style;
        contain-intrinsic-size: 900px;
      }
      body.fuman-view-switching [data-view] {
        transition: background-color 80ms ease, border-color 80ms ease, color 80ms ease !important;
      }
      body.fuman-view-switching {
        scroll-behavior: auto !important;
      }
      body.fuman-view-switching .dashboard,
      body.fuman-view-switching .view-panel {
        contain: layout paint style;
      }
      body.fuman-view-hydrating .view-panel.active {
        content-visibility: auto;
        contain-intrinsic-size: 900px;
      }
      body.fuman-view-switching .view-panel:not(.active) {
        content-visibility: hidden;
        contain-intrinsic-size: 900px;
      }
      body.fuman-view-switching .strategy-terminal,
      body.fuman-view-switching .strategy-list,
      body.fuman-view-switching .watchlist-grid,
      body.fuman-view-switching .terminal-table,
      body.fuman-view-switching .chip-flow-shell {
        content-visibility: auto;
        contain-intrinsic-size: 720px;
      }
      [data-view] {
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        user-select: none;
      }
      [data-view].fuman-pressing {
        transform: translate3d(1px, 0, 0);
      }
    `;
    document.head.appendChild(style);
    document.documentElement.classList.add("fuman-desktop-fast-path");
  }

  function installInstantViewSwitch() {
    if (window.__fumanInstantViewSwitch) return;
    window.__fumanInstantViewSwitch = true;
    const panels = {
      market: "#market-view",
      strategy: "#strategy-view",
      watchlist: "#watchlist-view",
      "chip-trade": "#chip-trade-view",
      "cb-detect": "#cb-detect-view",
      "warrant-flow": "#warrant-flow-view",
      member: "#member-view",
    };
    const switchNow = (link) => {
      const view = link?.dataset?.view;
      const selector = panels[view];
      if (!selector) return false;
      const panel = document.querySelector(selector);
      if (!panel) return false;
      document.body.classList.add("fuman-view-switching");
      window.clearTimeout(window.__fumanViewSwitchingTimer);
      window.__fumanViewSwitchingTimer = window.setTimeout(() => {
        document.body.classList.remove("fuman-view-switching");
      }, 120);
      document.querySelectorAll(".view-panel").forEach((item) => {
        const active = item === panel;
        item.classList.toggle("active", active);
        item.hidden = !active;
        item.setAttribute("aria-hidden", active ? "false" : "true");
      });
      document.querySelectorAll("[data-view]").forEach((item) => {
        item.classList.toggle("active", item === link);
        if (item === link) {
          item.setAttribute("aria-current", "page");
        } else {
          item.removeAttribute("aria-current");
        }
      });
      document.body.dataset.fumanInstantView = view;
      window.__fumanLastInstantView = { view, at: Date.now() };
      window.__fumanCurrentInstantRoute = `${view}|${(link.textContent || "").trim()}`;
      window.FUMAN_HOTFIX_RESTORE_VIEW_SNAPSHOT?.(view, panel);
      mark(`instant-view:${view}`);
      return true;
    };
    window.FUMAN_HOTFIX_SWITCH_VIEW_NOW = switchNow;
    document.addEventListener("pointerdown", (event) => {
      const link = event.target.closest?.("[data-view]");
      if (!link || link.closest("[data-member-tab]")) return;
      if (window.__fumanDesktopFastShell) return;
      if (link.dataset.view === "strategy") {
        window.FUMAN_HOTFIX_WARM_ROUTE?.(link, "strategy-pointer");
        window.FUMAN_TERMINAL_PREFETCH_APP?.();
        return;
      }
      switchNow(link);
      window.FUMAN_HOTFIX_WARM_ROUTE?.(link, "pointer");
      window.FUMAN_TERMINAL_PREFETCH_APP?.();
    }, true);
    document.addEventListener("pointerenter", (event) => {
      const link = event.target.closest?.("[data-view]");
      if (!link || link.closest("[data-member-tab]")) return;
      if (window.__fumanDesktopFastShell) return;
      window.FUMAN_HOTFIX_WARM_ROUTE?.(link, "hover");
    }, true);
    document.addEventListener("pointerover", (event) => {
      const link = event.target.closest?.("[data-view]");
      if (!link || link.closest("[data-member-tab]")) return;
      if (window.__fumanDesktopFastShell) return;
      window.FUMAN_HOTFIX_WARM_ROUTE?.(link, "hover");
    }, true);
    document.addEventListener("mousedown", (event) => {
      const link = event.target.closest?.("[data-view]");
      if (!link || link.closest("[data-member-tab]")) return;
      if (window.__fumanDesktopFastShell) return;
      if (link.dataset.view === "strategy") return;
      switchNow(link);
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const link = event.target.closest?.("[data-view]");
      if (link?.dataset?.view === "strategy") return;
      if (link) switchNow(link);
    }, true);
  }

  function installFastViewClickReplay() {
    if (window.__fumanFastViewClickReplay) return;
    window.__fumanFastViewClickReplay = true;
    document.addEventListener("click", (event) => {
      const link = event.target.closest?.("[data-view]");
      if (!link || link.closest("[data-member-tab]")) return;
      if (window.__fumanDesktopFastShell) return;
      if (event.__fumanFastOfficialClick) return;
      if (event.__fumanDeferredViewClick) return;
      if (event.button && event.button !== 0) return;
      if (link.dataset.view === "strategy") {
        window.FUMAN_HOTFIX_WARM_ROUTE?.(link, "strategy-native-click");
        window.FUMAN_TERMINAL_PREFETCH_APP?.();
        return;
      }
      window.FUMAN_HOTFIX_WARM_ROUTE?.(link, "click");
      window.FUMAN_TERMINAL_PREFETCH_APP?.();
    }, true);
  }

  function installStrategyPublicRouteBridge() {
    if (window.__fumanStrategyPublicRouteBridge) return;
    window.__fumanStrategyPublicRouteBridge = true;
    const isStrategyLink = (target) => {
      const link = target?.closest?.("[data-view='strategy'],[data-view=\"strategy\"]");
      if (!link || link.closest("[data-member-tab]")) return null;
      const text = link.textContent || "";
      return /策略[1-5]|雷達|當沖|隔日|波段/.test(text) ? link : null;
    };
    const unlockForStrategyRoute = (event) => {
      const link = isStrategyLink(event.target);
      if (!link) {
        const otherLink = event.target?.closest?.("[data-view]:not([data-member-tab])");
        if (otherLink?.dataset?.view && otherLink.dataset.view !== "strategy" && window.__fumanStrategyPublicAuthReadyAdded) {
          document.body.classList.remove("auth-ready");
          window.__fumanStrategyPublicAuthReadyAdded = false;
        }
        return;
      }
      const hadAuthReady = document.body.classList.contains("auth-ready");
      document.body.classList.add("auth-ready");
      window.__fumanStrategyPublicAuthReadyAdded = !hadAuthReady;
      document.querySelectorAll("#strategy-view .member-lock-overlay").forEach((node) => node.remove());
      document.querySelectorAll("#strategy-view .member-lock-host").forEach((node) => node.classList.remove("member-lock-host"));
      window.clearTimeout(window.__fumanStrategyPublicRouteTimer);
      window.__fumanStrategyPublicRouteTimer = window.setTimeout(() => {
        if (!hadAuthReady && !document.querySelector("#strategy-view.active")) {
          document.body.classList.remove("auth-ready");
          window.__fumanStrategyPublicAuthReadyAdded = false;
        }
      }, 2000);
    };
    document.addEventListener("pointerdown", unlockForStrategyRoute, true);
    document.addEventListener("click", unlockForStrategyRoute, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") unlockForStrategyRoute(event);
    }, true);
  }

  function installDesktopInteractionBudget() {
    if (window.__fumanDesktopInteractionBudget) return;
    window.__fumanDesktopInteractionBudget = true;

    const isViewLink = (target) => target?.closest?.("[data-view]:not([data-member-tab])");
    const isSwitching = () => {
      const last = window.__fumanLastInstantView;
      return document.body?.classList?.contains("fuman-view-switching") ||
        !!(last && Date.now() - Number(last.at || 0) < 900);
    };
    const scheduleAfterPaint = (task, delay = 0) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => window.setTimeout(task, delay));
      });
    };

    document.addEventListener("pointerdown", (event) => {
      const link = isViewLink(event.target);
      if (!link) return;
      link.classList.add("fuman-pressing");
      window.clearTimeout(link.__fumanPressingTimer);
      link.__fumanPressingTimer = window.setTimeout(() => link.classList.remove("fuman-pressing"), 140);
    }, true);

    document.addEventListener("click", (event) => {
      const link = isViewLink(event.target);
      if (!link || event.__fumanDeferredViewClick || event.__fumanFastOfficialClick) return;
      const route = `${link.dataset.view || ""}|${(link.textContent || "").trim()}`;
      const lastOfficial = window.__fumanLastOfficialRoute || {};
      const now = Date.now();
      window.__fumanLastOfficialRoute = { route, at: now };
      scheduleAfterPaint(() => {
        document.body?.classList?.remove("fuman-view-switching");
      }, 60);
    }, true);

    const originalSetInterval = window.setInterval.bind(window);
    window.setInterval = function fumanBudgetedSetInterval(callback, delay, ...args) {
      if (typeof callback !== "function" || Number(delay || 0) < 1000) {
        return originalSetInterval(callback, delay, ...args);
      }
      return originalSetInterval(function budgetedInterval(...innerArgs) {
        if (isSwitching()) {
          window.setTimeout(() => callback.apply(this, innerArgs), 160);
          return;
        }
        return callback.apply(this, innerArgs);
      }, delay, ...args);
    };
  }

  function installWarmMainApp() {
    if (window.__fumanHotfixWarmMainApp) return;
    window.__fumanHotfixWarmMainApp = true;
    let attempts = 0;
    const isFastShellBusy = () => Math.max(0, Number(window.__fumanDesktopFastInteractionUntil || 0) - Date.now()) > 0;
    const keepLegacyCold = () => {
      if (!window.__fumanDesktopFastShell) return false;
      try {
        if (new URLSearchParams(location.search).get("legacy") === "1") return false;
      } catch (error) {}
      return !window.FUMAN_TERMINAL_APP_READY;
    };
    const warm = () => {
      attempts += 1;
      if (keepLegacyCold()) {
        window.FUMAN_TERMINAL_PREFETCH_APP?.();
        document.documentElement.dataset.fumanLegacyAppState = "prefetch-only";
        if (attempts < 6) setTimeout(warm, attempts < 3 ? 2400 : 9000);
        return;
      }
      if (window.__fumanDesktopFastShell && isFastShellBusy()) {
        setTimeout(warm, 620);
        return;
      }
      if (typeof window.FUMAN_TERMINAL_LOAD_APP === "function") {
        if (window.__fumanDesktopFastShell && !window.FUMAN_TERMINAL_APP_READY) {
          window.FUMAN_TERMINAL_PREFETCH_APP?.();
          if (attempts < 18) {
            setTimeout(warm, attempts < 4 ? 1400 : 2400);
            return;
          }
        }
        const task = window.FUMAN_TERMINAL_LOAD_APP("hotfix-warm-idle");
        if (task && typeof task.catch === "function") task.catch(() => undefined);
        return;
      }
      if (attempts < 24) {
        setTimeout(warm, attempts < 6 ? 50 : 120);
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => setTimeout(warm, 4200), { once: true });
    } else {
      setTimeout(warm, 4200);
    }
  }

  function installScriptPreload() {
    if (window.__fumanHotfixScriptPreload) return;
    window.__fumanHotfixScriptPreload = true;
    const version = window.FUMAN_TERMINAL_BOOT?.version || window.FUMAN_TERMINAL_VERSION || "";
    const withVersion = (path) => version ? `${path}?v=${encodeURIComponent(version)}` : path;
    const keepLegacyCold = () => {
      try {
        if (new URLSearchParams(location.search).get("legacy") === "1") return false;
      } catch (error) {}
      return Boolean(window.__fumanDesktopFastShell)
        || document.documentElement.classList.contains("fuman-desktop-fast-path");
    };
    const resources = [
      { href: withVersion("/terminal-app.js"), as: "script", rel: "prefetch" },
      { href: withVersion("/terminal-modules.js"), as: "script", rel: "prefetch" },
      { href: withVersion("/terminal-worker.js"), as: "worker" },
      { href: withVersion("/terminal-member-module.js"), as: "script" },
      { href: withVersion("/terminal-market-snapshot-module.js"), as: "script" },
      { href: withVersion("/terminal-watchlist-shell.js"), as: "script" },
      { href: withVersion("/terminal-chip-snapshot-module.js"), as: "script" },
      { href: withVersion("/terminal-strategy-module.js"), as: "script" },
      { href: withVersion("/terminal-strategy-config.js"), as: "script" },
      { href: withVersion("/terminal-tuning-config.js"), as: "script" },
    ];
    resources.forEach((item) => {
      if (keepLegacyCold() && /\/terminal-app\.js/i.test(item.href || "")) return;
      if (!item.href || document.querySelector(`link[href="${item.href}"]`)) return;
      const link = document.createElement("link");
      link.rel = item.rel || (item.as === "worker" ? "prefetch" : "preload");
      link.as = item.as === "worker" ? "script" : item.as;
      link.href = item.href;
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    });
  }

  function installHotPathDataWarmup() {
    if (window.__fumanHotPathDataWarmup) return;
    window.__fumanHotPathDataWarmup = true;
    const warmed = new Map();
    const fastBundleUrl = "/api/terminal-fast-bundle?canvas=1&compact=1&shell=1";
    const marketCompactUrl = "/api/market?canvas=1&compact=1&shell=1&limit=24";
    const routeGroups = {
      market: [
        fastBundleUrl,
        "/api/terminal-home",
        marketCompactUrl,
        "/api/heatmap",
        "/api/market-ai-live",
      ],
      watchlist: [
        fastBundleUrl,
      ],
      strategy: [
        fastBundleUrl,
        "/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=60",
      ],
      "chip-trade": [
        fastBundleUrl,
      ],
      "cb-detect": [
        fastBundleUrl,
      ],
      "warrant-flow": [
        fastBundleUrl,
      ],
      member: [],
    };
    const critical = [
      fastBundleUrl,
      "/api/terminal-home",
      marketCompactUrl,
    ];
    const sequence = [
      ...critical,
      "/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=60",
    ];
    const warmOne = (url, reason = "warm") => {
      const key = String(url || "");
      if (!key) return Promise.resolve(false);
      const now = Date.now();
      const last = warmed.get(key) || 0;
      if (now - last < 120000) return Promise.resolve(false);
      warmed.set(key, now);
      const controller = "AbortController" in window ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 4500) : 0;
      mark(`warm:${reason}:${key.replace(/^\/api\//, "")}`);
      return fetch(key, {
        cache: "no-store",
        priority: reason === "pointer" || reason === "click" ? "high" : "low",
        signal: controller?.signal,
      }).then(async (response) => {
        if (response.ok && key.startsWith("/api/terminal-fast-bundle")) {
          const payload = await response.clone().json().catch(() => null);
          if (payload?.endpoints) {
            window.FUMAN_HOTFIX_PRIME_API_CACHE?.(payload.endpoints, {
              source: "terminal-fast-bundle",
              reason,
            });
          }
        }
        return response;
      }).catch(() => null).finally(() => {
        if (timer) clearTimeout(timer);
      });
    };
    const warmList = (urls, reason = "warm", concurrency = 2) => {
      const queue = [...new Set((urls || []).filter(Boolean))];
      let running = 0;
      const next = () => {
        while (running < concurrency && queue.length) {
          running += 1;
          warmOne(queue.shift(), reason).finally(() => {
            running -= 1;
            next();
          });
        }
      };
      next();
    };
    const routeForLink = (link) => {
      const view = link?.dataset?.view || "";
      const text = link?.textContent || "";
      if (view !== "strategy") return view;
      if (text.includes("策略1")) return "strategy1";
      if (text.includes("策略2") || text.includes("當沖")) return "strategy2";
      if (text.includes("策略3")) return "strategy3";
      if (text.includes("策略4") || text.includes("波段")) return "strategy4";
      if (text.includes("策略5")) return "strategy5";
      return "strategy";
    };
    const warmRoute = (link, reason = "route") => {
      const route = typeof link === "string" ? link : routeForLink(link);
      const strategySpecific = {
        strategy1: [fastBundleUrl],
        strategy2: ["/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=60", "/api/realtime-radar-latest"],
        strategy3: [fastBundleUrl],
        strategy4: [fastBundleUrl],
        strategy5: [fastBundleUrl],
      };
      const urls = strategySpecific[route] || routeGroups[route] || [];
      warmList(urls, reason, reason === "pointer" || reason === "click" ? 1 : 2);
    };
    const scheduleFullWarm = () => {
      const run = () => {
        const until = Math.max(0, Number(window.__fumanDesktopFastInteractionUntil || 0) - Date.now());
        if (until > 0 || document.hidden) {
          setTimeout(run, Math.max(1800, until + 900));
          return;
        }
        warmList(sequence, "startup", 1);
      };
      if ("requestIdleCallback" in window) {
        requestIdleCallback(run, { timeout: 6500 });
      } else {
        setTimeout(run, 6500);
      }
    };
    window.FUMAN_HOTFIX_WARM_ROUTE = warmRoute;
    window.FUMAN_HOTFIX_WARM_ALL = () => warmList(sequence, "manual", 3);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", scheduleFullWarm, { once: true });
    } else {
      scheduleFullWarm();
    }
  }

  function installDesktopApiPollingCache() {
    if (window.__fumanDesktopApiPollingCache) return;
    window.__fumanDesktopApiPollingCache = true;
    const originalFetch = window.fetch.bind(window);
    const memory = new Map();
    const inflight = new Map();
    const sessionPrefix = "FUMAN_DESKTOP_API_SESSION_CACHE:";
    const sessionMaxBodyBytes = 900000;
    const staleWhileRevalidateMs = 180000;
    const skipPattern = /\/api\/(?:export|refresh|frontend-error|performance-report|version|terminal-theme-css|scan-|github|history|realtime(?:$|\?))/i;
    const apiPattern = /\/api\/(?:market|terminal-home|terminal-fast-bundle|market-ai|heatmap|stocks|watchlist-match-index|open-buy-latest|strategy[2345]-latest|latest-strategy|latest-signals|realtime-radar-latest|institution-latest|chip-trade|warrant-flow-latest|cb-detect-latest|mobile-boot|mobile-fragment)/i;
    const ttlFor = (pathname) => {
      if (/strategy2|realtime-radar/i.test(pathname)) return 3000;
      if (/market(?:$|-ai)|heatmap/i.test(pathname)) return 8000;
      if (/strategy[345]|open-buy/i.test(pathname)) return 15000;
      if (/institution|chip-trade|warrant|cb-detect/i.test(pathname)) return 30000;
      if (/stocks|terminal-home|watchlist-match-index|mobile/i.test(pathname)) return 45000;
      return 10000;
    };
    const cloneFromRecord = (record) => new Response(record.body, {
      status: record.status,
      statusText: record.statusText,
      headers: record.headers,
    });
    const isViewSwitching = () => {
      const last = window.__fumanLastInstantView;
      return document.body?.classList?.contains("fuman-view-switching") ||
        !!(last && Date.now() - Number(last.at || 0) < 900);
    };
    const maxStaleFor = (pathname) => {
      if (isViewSwitching()) {
        if (/strategy2|realtime-radar/i.test(pathname)) return 60000;
        if (/market(?:$|-ai)|heatmap/i.test(pathname)) return 90000;
        return 600000;
      }
      if (/strategy2|realtime-radar/i.test(pathname)) return 20000;
      if (/market(?:$|-ai)|heatmap/i.test(pathname)) return 45000;
      return staleWhileRevalidateMs;
    };
    const withCacheHeader = (record, value) => ({
      ...record,
      headers: [
        ...(Array.isArray(record.headers) ? record.headers : []),
        ["x-fuman-cache", value],
      ],
    });
    const isRecordFresh = (record, now = Date.now()) => {
      return record && now - Number(record.at || 0) <= Number(record.ttl || 0);
    };
    const isRecordUsableStale = (record, pathname, now = Date.now()) => {
      return record && now - Number(record.at || 0) <= Number(record.ttl || 0) + maxStaleFor(pathname || "");
    };
    const readSessionRecord = (key, options = {}) => {
      try {
        const raw = sessionStorage.getItem(sessionPrefix + key);
        if (!raw) return null;
        const record = JSON.parse(raw);
        if (!record || !Number.isFinite(Number(record.at)) || !Number.isFinite(Number(record.ttl))) return null;
        const pathname = options.pathname || key.split("?")[0] || "";
        if (!options.allowStale && !isRecordFresh(record)) {
          sessionStorage.removeItem(sessionPrefix + key);
          return null;
        }
        if (options.allowStale && !isRecordUsableStale(record, pathname)) return null;
        return record;
      } catch (error) {
        return null;
      }
    };
    const writeSessionRecord = (key, record) => {
      try {
        if (!key || !record?.body || String(record.body).length > sessionMaxBodyBytes) return;
        sessionStorage.setItem(sessionPrefix + key, JSON.stringify(record));
      } catch (error) {
        try {
          Object.keys(sessionStorage)
            .filter((keyName) => keyName.startsWith(sessionPrefix))
            .slice(0, 8)
            .forEach((keyName) => sessionStorage.removeItem(keyName));
        } catch (cleanupError) {}
      }
    };
    const primeApiCache = (endpoints, meta = {}) => {
      if (!endpoints || typeof endpoints !== "object") return 0;
      let count = 0;
      Object.entries(endpoints).forEach(([endpoint, payload]) => {
        try {
          const key = cacheKeyFor(endpoint, { method: "GET" });
          if (!key || payload === undefined) return;
          if (payload && typeof payload === "object" && payload.ok === false) return;
          const pathname = new URL(endpoint, location.href).pathname;
          const record = {
            at: Date.now(),
            ttl: Math.max(ttlFor(pathname), 45000),
            status: 200,
            statusText: "OK",
            headers: [
              ["content-type", "application/json; charset=utf-8"],
              ["x-fuman-cache", "terminal-fast-bundle"],
              ["x-fuman-cache-reason", String(meta.reason || "")],
            ],
            body: JSON.stringify(payload),
          };
          memory.set(key, record);
          writeSessionRecord(key, record);
          count += 1;
        } catch (error) {}
      });
      if (count) mark(`bundle-prime:${meta.reason || "bundle"}:${count}`);
      return count;
    };
    const cacheKeyFor = (input, init = {}) => {
      const method = String(init?.method || input?.method || "GET").toUpperCase();
      if (method !== "GET") return "";
      const url = new URL(typeof input === "string" ? input : input?.url || "", location.href);
      if (url.origin !== location.origin) return "";
      if (!apiPattern.test(url.pathname) || skipPattern.test(url.pathname)) return "";
      if (url.searchParams.has("force") || url.searchParams.has("refresh")) return "";
      ["t", "ts", "fresh", "_", "cacheBust"].forEach((key) => url.searchParams.delete(key));
      return `${url.pathname}?${url.searchParams.toString()}`;
    };
    const refreshNetwork = (input, init, key, pathname) => {
      const task = originalFetch(input, init).then(async (response) => {
        const body = await response.clone().text();
        const record = {
          at: Date.now(),
          ttl: ttlFor(pathname),
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers.entries()],
          body,
        };
        if (response.ok) {
          memory.set(key, record);
          writeSessionRecord(key, record);
        }
        return record;
      }).finally(() => inflight.delete(key));
      inflight.set(key, task);
      return task;
    };
    window.fetch = function fumanCachedFetch(input, init = {}) {
      const key = cacheKeyFor(input, init);
      if (!key) return originalFetch(input, init);
      const now = Date.now();
      const pathname = key.split("?")[0] || "";
      const cached = memory.get(key);
      if (isRecordFresh(cached, now)) {
        return Promise.resolve(cloneFromRecord(withCacheHeader(cached, "memory-fresh")));
      }
      const sessionCached = readSessionRecord(key, { pathname, allowStale: true });
      if (sessionCached && isRecordFresh(sessionCached, now)) {
        memory.set(key, sessionCached);
        return Promise.resolve(cloneFromRecord(withCacheHeader(sessionCached, "session-fresh")));
      }
      const stale = isRecordUsableStale(cached, pathname, now) ? cached : sessionCached;
      if (stale) {
        memory.set(key, stale);
        if (!inflight.has(key)) {
          const refresh = () => refreshNetwork(input, init, key, pathname).catch(() => null);
          if (isViewSwitching()) {
            setTimeout(refresh, 850);
          } else {
            refresh();
          }
        }
        return Promise.resolve(cloneFromRecord(withCacheHeader(stale, "stale-while-revalidate")));
      }
      if (inflight.has(key)) {
        return inflight.get(key).then(cloneFromRecord);
      }
      return refreshNetwork(input, init, key, pathname)
        .then(cloneFromRecord)
        .catch((error) => {
          const fallback = readSessionRecord(key, { pathname, allowStale: true }) || memory.get(key);
          if (fallback && isRecordUsableStale(fallback, pathname)) {
            return cloneFromRecord(withCacheHeader(fallback, "stale-if-error"));
          }
          throw error;
        });
    };
    window.FUMAN_HOTFIX_PRIME_API_CACHE = primeApiCache;
  }

  function installDesktopViewSnapshotCache() {
    if (window.__fumanDesktopViewSnapshotCache) return;
    window.__fumanDesktopViewSnapshotCache = true;
    const snapshotPrefix = "FUMAN_DESKTOP_VIEW_SNAPSHOT:";
    const maxSnapshotChars = 650000;
    const maxSnapshotAgeMs = 240000;
    const viewPanels = {
      market: "#market-view",
      strategy: "#strategy-view",
      watchlist: "#watchlist-view",
      "chip-trade": "#chip-trade-view",
      "cb-detect": "#cb-detect-view",
      "warrant-flow": "#warrant-flow-view",
      member: "#member-view",
    };
    const memory = new Map();
    const observedPanels = new WeakSet();
    let saveTimer = 0;
    const getPanelView = (panel) => {
      for (const [view, selector] of Object.entries(viewPanels)) {
        if (panel?.matches?.(selector)) return view;
      }
      return "";
    };
    const readSnapshot = (view) => {
      const cached = memory.get(view);
      if (cached && Date.now() - cached.at <= maxSnapshotAgeMs) return cached;
      try {
        const raw = sessionStorage.getItem(snapshotPrefix + view);
        if (!raw) return null;
        const item = JSON.parse(raw);
        if (!item?.html || Date.now() - Number(item.at || 0) > maxSnapshotAgeMs) return null;
        memory.set(view, item);
        return item;
      } catch (error) {
        return null;
      }
    };
    const writeSnapshot = (view, panel) => {
      if (!view || !panel || !panel.classList.contains("active")) return;
      const html = panel.innerHTML || "";
      if (!html || html.length > maxSnapshotChars) return;
      if (/載入中|loading|skeleton/i.test(panel.textContent || "") && html.length < 12000) return;
      const item = {
        at: Date.now(),
        scrollTop: panel.scrollTop || 0,
        html,
      };
      memory.set(view, item);
      try {
        sessionStorage.setItem(snapshotPrefix + view, JSON.stringify(item));
      } catch (error) {}
    };
    const scheduleSave = () => {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        const run = () => document.querySelectorAll(".view-panel.active").forEach((panel) => {
          writeSnapshot(getPanelView(panel), panel);
        });
        if ("requestIdleCallback" in window) {
          requestIdleCallback(run, { timeout: 500 });
        } else {
          run();
        }
      }, 360);
    };
    const restoreSnapshot = (view, panel) => {
      if (!view || !panel || panel.dataset.fumanSnapshotRestoring === "1") return false;
      const item = readSnapshot(view);
      if (!item?.html) return false;
      const currentText = panel.textContent || "";
      const shouldRestore = !currentText.trim() || /載入中|loading|目前沒有|請先登入/i.test(currentText);
      if (!shouldRestore) return false;
      panel.dataset.fumanSnapshotRestoring = "1";
      panel.innerHTML = item.html;
      panel.scrollTop = Number(item.scrollTop || 0);
      panel.dataset.fumanSnapshotAt = String(item.at);
      window.setTimeout(() => delete panel.dataset.fumanSnapshotRestoring, 0);
      mark(`view-snapshot-restore:${view}`);
      return true;
    };
    window.FUMAN_HOTFIX_RESTORE_VIEW_SNAPSHOT = restoreSnapshot;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", scheduleSave, { once: true });
    } else {
      scheduleSave();
    }
    const observePanels = () => {
      document.querySelectorAll(".view-panel").forEach((panel) => {
        if (observedPanels.has(panel)) return;
        observedPanels.add(panel);
        new MutationObserver(scheduleSave).observe(panel, {
          childList: true,
          subtree: true,
        });
      });
    };
    observePanels();
    new MutationObserver(observePanels).observe(document.body || document.documentElement, {
      childList: true,
      subtree: false,
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") scheduleSave();
    });
  }

  function installStrategy1OpenBuyRollbackGuard() {
    const legacyFirstCard = "16" + ":00 候選";
    const legacyLead = "16" + ":00後先出明日候選";
    const legacySummary = "16" + ":00後產生明日候選";
    const legacyHeader = "16" + ":00 後產生明日候選";
    const legacyProfit = "有" + "賺就走";
    const legacyRun = "快" + "跑";

    const replaceText = (root, from, to) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((node) => {
        if (node.nodeValue && node.nodeValue.includes(from)) {
          node.nodeValue = node.nodeValue.split(from).join(to);
        }
      });
    };

    const enforceOne = (root) => {
      const text = root.textContent || "";
      const isStrategy1 = text.includes("策略1-明日開盤入") || text.includes("策略1") && text.includes("08:55");
      if (!isStrategy1) return false;
      if (!text.includes("08:55")) return false;

      replaceText(root, legacyFirstCard, "21:30 初篩 + 08:45 個股期貨");
      replaceText(root, "收盤後用日K篩明日名單", "完整掃描產生明日名單");
      replaceText(root, legacyLead, "21:30 先篩選符合；08:45 看個股期貨");
      replaceText(root, legacySummary, "21:30初篩+08:45個股期貨");
      replaceText(root, legacyHeader, "21:30 先篩選符合；08:45 看個股期貨");
      replaceText(root, "08:55後看最終名單", "08:55 搓合確認");
      replaceText(root, "買入：09:00 開盤價｜停利 +1.2%｜停損 -1.0%｜09:10 強制出場。", "08:55 搓合完美符合才列 BUY。");

      const grid = root.querySelector(".swing-signal-grid");
      if (!grid) return true;
      [...grid.querySelectorAll(".swing-card")].forEach((card) => {
        const cardText = card.textContent || "";
        if (cardText.includes(legacyProfit) || cardText.includes(legacyRun)) card.remove();
      });
      const cards = [...grid.querySelectorAll(".swing-card")];
      if (cards.length > 2 && cards.some((card) => (card.textContent || "").includes("08:45")) && cards.some((card) => (card.textContent || "").includes("08:55"))) {
        cards.slice(2).forEach((card) => card.remove());
      }
      return true;
    };

    let scheduled = false;
    const enforce = () => {
      scheduled = false;
      document.querySelectorAll(".swing-dashboard").forEach(enforceOne);
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(enforce);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", schedule, { once: true });
    } else {
      schedule();
    }
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(schedule, 3000);
  }

  installStrategy1OpenBuyRollbackGuard();
})();
