(function () {
  const boot = window.FUMAN_TERMINAL_BOOT || (window.FUMAN_TERMINAL_BOOT = {});
  const version = boot.version || "split-cb-view-20260609-48";
  const appSrc = `/terminal-app.js?v=${version}`;
  const dependencyScripts = [
    { src: `/terminal-sector-map.js?v=${version}`, attr: "data-fuman-sector-map" },
    { src: `/terminal-strategy-config.js?v=${version}`, attr: "data-fuman-strategy-config" },
    { src: `/terminal-market-config.js?v=${version}`, attr: "data-fuman-market-config" },
    { src: `/terminal-ui-config.js?v=${version}`, attr: "data-fuman-ui-config" },
    { src: `/terminal-runtime-config.js?v=${version}`, attr: "data-fuman-runtime-config" },
    { src: `/terminal-tuning-config.js?v=${version}`, attr: "data-fuman-tuning-config" },
  ];
  let appPromise = null;

  installDesktopApiPollingCache();
  installInstantViewSwitch();

  function mark(name) {
    if (!("performance" in window) || !performance.mark) return;
    try { performance.mark(`fuman:${name}`); } catch (error) {}
  }

  function loadApp(reason = "idle") {
    if (window.FUMAN_TERMINAL_APP_READY) return Promise.resolve(window.FUMAN_TERMINAL_APP_READY);
    if (appPromise) return appPromise;
    mark(`app-request:${reason}`);
    appPromise = loadDependencies().then(() => new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-fuman-terminal-app]");
      if (existing) {
        existing.addEventListener("load", () => resolve(true), { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = appSrc;
      script.async = true;
      script.dataset.fumanTerminalApp = "1";
      script.addEventListener("load", () => {
        window.FUMAN_TERMINAL_APP_READY = true;
        mark("app-loaded");
        resolve(true);
      }, { once: true });
      script.addEventListener("error", reject, { once: true });
      document.body.appendChild(script);
    }));
    return appPromise;
  }

  function loadDependencies() {
    return Promise.all(dependencyScripts.map((item) => loadScriptOnce(item)));
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
      if (!selector) return;
      const panel = document.querySelector(selector);
      if (!panel) return;
      document.querySelectorAll(".view-panel").forEach((item) => {
        const active = item === panel;
        item.classList.toggle("active", active);
        item.hidden = !active;
      });
      document.querySelectorAll("[data-view]").forEach((item) => {
        item.classList.toggle("active", item === link);
      });
      document.body.dataset.fumanInstantView = view;
      if ("performance" in window && performance.mark) {
        try { performance.mark(`fuman:instant-view:${view}`); } catch (error) {}
      }
    };
    document.addEventListener("pointerdown", (event) => {
      const link = event.target.closest("[data-view]");
      if (!link || link.closest("[data-member-tab]")) return;
      switchNow(link);
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const link = event.target.closest("[data-view]");
      if (link) switchNow(link);
    }, true);
  }

  function installDesktopApiPollingCache() {
    if (window.__fumanDesktopApiPollingCache) return;
    window.__fumanDesktopApiPollingCache = true;
    const originalFetch = window.fetch.bind(window);
    const memory = new Map();
    const inflight = new Map();
    const skipPattern = /\/api\/(?:export|refresh|frontend-error|performance-report|version|terminal-theme-css|scan-|github|history|realtime(?:$|\?))/i;
    const apiPattern = /\/api\/(?:market|terminal-home|market-ai|heatmap|stocks|watchlist-match-index|open-buy-latest|strategy[2345]-latest|latest-strategy|realtime-radar-latest|institution-latest|chip-trade|warrant-flow-latest|cb-detect-latest|mobile-boot|mobile-fragment)/i;
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

  function loadScriptOnce(item) {
    const selector = `script[${item.attr}]`;
    const existing = document.querySelector(selector);
    if (existing) {
      if (existing.dataset.loaded === "1") return Promise.resolve(true);
      return new Promise((resolve, reject) => {
        existing.addEventListener("load", () => resolve(true), { once: true });
        existing.addEventListener("error", reject, { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = item.src;
      script.async = false;
      script.setAttribute(item.attr, "1");
      script.addEventListener("load", () => {
        script.dataset.loaded = "1";
        resolve(true);
      }, { once: true });
      script.addEventListener("error", reject, { once: true });
      document.head.appendChild(script);
    });
  }

  function prefetchApp() {
    if (document.querySelector(`link[rel="prefetch"][href="${appSrc}"]`)) return;
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = appSrc;
    document.head.appendChild(link);
  }

  function shouldLoadImmediately() {
    const hash = (location.hash || "").toLowerCase();
    if (hash && !hash.includes("market")) return true;
    return document.body?.dataset?.fumanEager === "1";
  }

  window.FUMAN_TERMINAL_LOAD_APP = loadApp;
  window.FUMAN_TERMINAL_PREFETCH_APP = prefetchApp;

  function replayInteractionAfterLoad(event, reason) {
    if (window.FUMAN_TERMINAL_APP_READY) return false;
    const target = event.target.closest("[data-view], .strategy-card[data-strategy], [data-strategy-mode], [data-swing-sort], [data-swing-zone-filter], [data-swing-filter], [data-intraday-sort], [data-intraday-filter], [data-strategy5-filter], [data-chip-filter], #chip-sort");
    if (!target) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    loadApp(reason).then(() => {
      if (!target.isConnected) return;
      target.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    }).catch(() => undefined);
    return true;
  }

  document.addEventListener("click", (event) => {
    const memberButton = event.target.closest("#member-state");
    if (!memberButton) return;
    event.preventDefault();
    event.stopPropagation();
    loadApp("member-state").then(() => {
      if (typeof window.FUMAN_OPEN_MEMBER_CENTER === "function") {
        window.FUMAN_OPEN_MEMBER_CENTER();
      }
    }).catch(() => undefined);
  }, true);

  document.addEventListener("click", (event) => {
    const authButton = event.target.closest(".sidebar-foot .logout");
    if (!authButton) return;
    event.preventDefault();
    event.stopPropagation();
    loadApp("auth-button").then(() => {
      if (typeof window.FUMAN_HANDLE_AUTH_BUTTON === "function") {
        window.FUMAN_HANDLE_AUTH_BUTTON();
      }
    }).catch(() => undefined);
  }, true);

  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
    window.addEventListener(eventName, () => loadApp(eventName), { once: true, passive: true });
  });

  document.addEventListener("click", (event) => {
    if (replayInteractionAfterLoad(event, "interaction-replay")) return;
    if (event.target.closest("[data-view], .strategy-card, .brand-refresh, button, input, select")) {
      loadApp("interaction");
    }
  }, true);

  if (shouldLoadImmediately()) {
    loadApp("route");
  } else {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(() => loadApp("idle"), { timeout: 1800 });
    } else {
      setTimeout(() => loadApp("idle"), 900);
    }
  }
})();



