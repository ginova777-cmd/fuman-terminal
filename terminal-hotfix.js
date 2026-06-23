(function () {
  if (window.__fumanTerminalHotfix === "20260623-04") return;
  window.__fumanTerminalHotfix = "20260623-04";

  installDesktopApiPollingCache();
  installInstantViewSwitch();
  installFastViewClickReplay();
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
      body.fuman-view-switching .view-panel {
        transition: none !important;
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
      [data-view] {
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        user-select: none;
      }
    `;
    document.head.appendChild(style);
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
      }, 180);
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
      mark(`instant-view:${view}`);
      return true;
    };
    window.FUMAN_HOTFIX_SWITCH_VIEW_NOW = switchNow;
    document.addEventListener("pointerdown", (event) => {
      const link = event.target.closest?.("[data-view]");
      if (!link || link.closest("[data-member-tab]")) return;
      switchNow(link);
      window.FUMAN_HOTFIX_WARM_ROUTE?.(link, "pointer");
      window.FUMAN_TERMINAL_LOAD_APP?.("instant-view-pointer");
    }, true);
    document.addEventListener("pointerenter", (event) => {
      const link = event.target.closest?.("[data-view]");
      if (!link || link.closest("[data-member-tab]")) return;
      window.FUMAN_HOTFIX_WARM_ROUTE?.(link, "hover");
    }, true);
    document.addEventListener("pointerover", (event) => {
      const link = event.target.closest?.("[data-view]");
      if (!link || link.closest("[data-member-tab]")) return;
      window.FUMAN_HOTFIX_WARM_ROUTE?.(link, "hover");
    }, true);
    document.addEventListener("mousedown", (event) => {
      const link = event.target.closest?.("[data-view]");
      if (!link || link.closest("[data-member-tab]")) return;
      switchNow(link);
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const link = event.target.closest?.("[data-view]");
      if (link) switchNow(link);
    }, true);
  }

  function installFastViewClickReplay() {
    if (window.__fumanFastViewClickReplay) return;
    window.__fumanFastViewClickReplay = true;
    const routeKeyFor = (link) => `${link?.dataset?.view || ""}|${(link?.textContent || "").trim()}`;
    const shouldThrottle = (link) => {
      const key = routeKeyFor(link);
      const last = window.__fumanLastReplayRoute || {};
      const now = Date.now();
      window.__fumanLastReplayRoute = { key, at: now };
      return last.key === key && now - Number(last.at || 0) < 220;
    };
    const replayClick = (link, sourceEvent) => {
      if (!link || link.dataset.fumanHotfixReplayQueued === "1") return;
      link.dataset.fumanHotfixReplayQueued = "1";
      requestAnimationFrame(() => {
        const afterPaint = () => {
          delete link.dataset.fumanHotfixReplayQueued;
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
            Object.defineProperty(event, "__fumanDeferredViewClick", { value: true });
          } catch (error) {
            event.__fumanDeferredViewClick = true;
          }
          link.dispatchEvent(event);
        };
        requestAnimationFrame(() => setTimeout(afterPaint, 8));
      });
    };
    document.addEventListener("click", (event) => {
      const link = event.target.closest?.("[data-view]");
      if (!link || link.closest("[data-member-tab]")) return;
      if (event.__fumanDeferredViewClick) return;
      if (event.button && event.button !== 0) return;
      const switched = window.FUMAN_HOTFIX_SWITCH_VIEW_NOW?.(link);
      if (!switched) return;
      window.FUMAN_HOTFIX_WARM_ROUTE?.(link, "click");
      if (!window.FUMAN_TERMINAL_APP_READY) {
        window.FUMAN_TERMINAL_LOAD_APP?.("instant-view-click");
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (shouldThrottle(link)) return;
      replayClick(link, event);
    }, true);
  }

  function installWarmMainApp() {
    if (window.__fumanHotfixWarmMainApp) return;
    window.__fumanHotfixWarmMainApp = true;
    let attempts = 0;
    const warm = () => {
      attempts += 1;
      if (typeof window.FUMAN_TERMINAL_LOAD_APP === "function") {
        const task = window.FUMAN_TERMINAL_LOAD_APP("hotfix-warm");
        if (task && typeof task.catch === "function") task.catch(() => undefined);
        return;
      }
      if (attempts < 24) {
        setTimeout(warm, attempts < 6 ? 50 : 120);
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => setTimeout(warm, 50), { once: true });
    } else {
      setTimeout(warm, 50);
    }
  }

  function installScriptPreload() {
    if (window.__fumanHotfixScriptPreload) return;
    window.__fumanHotfixScriptPreload = true;
    const version = window.FUMAN_TERMINAL_BOOT?.version || window.FUMAN_TERMINAL_VERSION || "";
    const withVersion = (path) => version ? `${path}?v=${encodeURIComponent(version)}` : path;
    const resources = [
      { href: withVersion("/terminal-app.js"), as: "script" },
      { href: withVersion("/terminal-modules.js"), as: "script" },
      { href: withVersion("/terminal-worker.js"), as: "worker" },
      { href: withVersion("/terminal-watchlist-module.js"), as: "script" },
      { href: withVersion("/terminal-strategy-config.js"), as: "script" },
      { href: withVersion("/terminal-tuning-config.js"), as: "script" },
    ];
    resources.forEach((item) => {
      if (!item.href || document.querySelector(`link[href="${item.href}"]`)) return;
      const link = document.createElement("link");
      link.rel = item.as === "worker" ? "prefetch" : "preload";
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
    const routeGroups = {
      market: [
        "/api/terminal-home",
        "/api/market",
        "/api/heatmap",
        "/api/market-ai-live",
        "/api/market-ai-panel-live",
      ],
      watchlist: [
        "/api/stocks",
        "/api/watchlist-match-index",
        "/api/terminal-home",
      ],
      strategy: [
        "/api/open-buy-latest",
        "/api/strategy2-latest",
        "/api/strategy3-latest",
        "/api/strategy4-latest",
        "/api/strategy5-latest",
        "/api/latest-signals?strategy=strategy4",
        "/api/realtime-radar-latest",
      ],
      "chip-trade": [
        "/api/institution-latest",
        "/api/watchlist-match-index",
      ],
      "cb-detect": [
        "/api/cb-detect-latest",
      ],
      "warrant-flow": [
        "/api/warrant-flow-latest",
      ],
      member: [
        "/api/terminal-home",
      ],
    };
    const critical = [
      "/api/terminal-home",
      "/api/market",
      "/api/stocks",
      "/api/watchlist-match-index",
      "/api/latest-signals?strategy=strategy4",
    ];
    const sequence = [
      ...critical,
      "/api/open-buy-latest",
      "/api/strategy2-latest",
      "/api/strategy3-latest",
      "/api/strategy5-latest",
      "/api/strategy4-latest",
      "/api/institution-latest",
      "/api/cb-detect-latest",
      "/api/warrant-flow-latest",
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
        strategy1: ["/api/open-buy-latest", "/api/stocks"],
        strategy2: ["/api/strategy2-latest", "/api/realtime-radar-latest", "/api/stocks"],
        strategy3: ["/api/strategy3-latest", "/api/stocks"],
        strategy4: ["/api/strategy4-latest", "/api/latest-signals?strategy=strategy4", "/api/stocks"],
        strategy5: ["/api/strategy5-latest", "/api/stocks"],
      };
      const urls = strategySpecific[route] || routeGroups[route] || [];
      warmList(urls, reason, reason === "pointer" || reason === "click" ? 3 : 2);
    };
    const scheduleFullWarm = () => {
      const run = () => warmList(sequence, "startup", 2);
      if ("requestIdleCallback" in window) {
        requestIdleCallback(run, { timeout: 1600 });
      } else {
        setTimeout(run, 800);
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
    const skipPattern = /\/api\/(?:export|refresh|frontend-error|performance-report|version|terminal-theme-css|scan-|github|history|realtime(?:$|\?))/i;
    const apiPattern = /\/api\/(?:market|terminal-home|market-ai|heatmap|stocks|watchlist-match-index|open-buy-latest|strategy[2345]-latest|latest-strategy|latest-signals|realtime-radar-latest|institution-latest|chip-trade|warrant-flow-latest|cb-detect-latest|mobile-boot|mobile-fragment)/i;
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
    window.fetch = function fumanCachedFetch(input, init = {}) {
      const key = cacheKeyFor(input, init);
      if (!key) return originalFetch(input, init);
      const now = Date.now();
      const cached = memory.get(key);
      if (cached && now - cached.at <= cached.ttl) {
        return Promise.resolve(cloneFromRecord(cached));
      }
      if (inflight.has(key)) {
        return inflight.get(key).then(cloneFromRecord);
      }
      const task = originalFetch(input, init).then(async (response) => {
        const body = await response.clone().text();
        const record = {
          at: Date.now(),
          ttl: ttlFor(new URL(typeof input === "string" ? input : input?.url || "", location.href).pathname),
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers.entries()],
          body,
        };
        if (response.ok) memory.set(key, record);
        return record;
      }).finally(() => inflight.delete(key));
      inflight.set(key, task);
      return task.then(cloneFromRecord);
    };
  }
})();
