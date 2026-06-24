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
  const legacyModulePromises = new Map();
  const featureModuleScripts = {
    member: { src: `/terminal-member-module.js?v=${version}`, attr: "data-fuman-member-module", global: "FUMAN_MEMBER_MODULE" },
    market: { src: `/terminal-market-snapshot-module.js?v=${version}`, attr: "data-fuman-market-snapshot-module", global: "FUMAN_MARKET_SNAPSHOT_MODULE" },
    watchlist: { src: `/terminal-watchlist-shell.js?v=${version}`, attr: "data-fuman-watchlist-shell", global: "FUMAN_WATCHLIST_SHELL_MODULE" },
    chip: { src: `/terminal-chip-snapshot-module.js?v=${version}`, attr: "data-fuman-chip-snapshot-module", global: "FUMAN_CHIP_SNAPSHOT_MODULE" },
    strategy: { src: `/terminal-strategy-module.js?v=${version}`, attr: "data-fuman-strategy-module", global: "FUMAN_STRATEGY_MODULE" },
  };
  const featureModulePromises = new Map();
  const featureModuleInstances = new Map();

  unlockPublicTerminalShell();

  function mark(name) {
    if (!("performance" in window) || !performance.mark) return;
    try { performance.mark(`fuman:${name}`); } catch (error) {}
  }

  function loadApp(reason = "idle") {
    if (window.FUMAN_TERMINAL_APP_READY) return Promise.resolve(window.FUMAN_TERMINAL_APP_READY);
    if (appPromise) return appPromise;
    unlockPublicTerminalShell();
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

  function loadLegacyModule(name = "all", reason = "") {
    const moduleName = String(name || "all").toLowerCase();
    const loadReason = `legacy-module:${moduleName}${reason ? `:${reason}` : ""}`;
    if (shouldUseFeatureModule(moduleName, reason)) {
      return loadFeatureModule(moduleName, reason).then(() => false);
    }
    if (shouldHardColdLegacyModule(moduleName, reason)) {
      prefetchApp();
      document.documentElement.dataset.fumanLegacyModule = `hard-cold:${moduleName}`;
      document.documentElement.dataset.fumanLegacyAppState = "hard-cold";
      mark(`legacy-module-hard-cold:${moduleName}`);
      return Promise.resolve(false);
    }
    if (window.FUMAN_TERMINAL_APP_READY) return Promise.resolve(true);
    if (legacyModulePromises.has(moduleName)) return legacyModulePromises.get(moduleName);
    document.documentElement.dataset.fumanLegacyModule = moduleName;
    mark(`legacy-module-request:${moduleName}`);
    const promise = loadApp(loadReason).finally(() => legacyModulePromises.delete(moduleName));
    legacyModulePromises.set(moduleName, promise);
    return promise;
  }

  function shouldUseFeatureModule(moduleName, reason = "") {
    const name = String(moduleName || "").toLowerCase();
    if (!featureModuleScripts[name]) return false;
    if (window.FUMAN_TERMINAL_APP_READY) return false;
    if (window.__fumanDesktopFastShell !== "20260623-09") return false;
    try {
      if (new URLSearchParams(location.search).get("legacy") === "1") return false;
    } catch (error) {}
    if (document.body?.dataset?.fumanEager === "1") return false;
    return !/export|download|settings|admin|legacy|interaction-replay/i.test(String(reason || ""));
  }

  function featureModuleContext(moduleName, reason = "") {
    return {
      version,
      moduleName,
      reason,
      mark,
      loadApp,
      prefetchApp,
      unlockPublicTerminalShell,
      isDesktopFastShell: () => window.__fumanDesktopFastShell === "20260623-09",
    };
  }

  function loadFeatureModule(name = "all", reason = "") {
    const moduleName = String(name || "all").toLowerCase();
    const item = featureModuleScripts[moduleName];
    if (!item) return Promise.resolve(false);
    if (featureModuleInstances.has(moduleName)) return Promise.resolve(featureModuleInstances.get(moduleName));
    if (featureModulePromises.has(moduleName)) return featureModulePromises.get(moduleName);
    mark(`feature-module-request:${moduleName}`);
    const install = () => {
      const mod = window[item.global];
      const instance = typeof mod?.install === "function"
        ? mod.install(featureModuleContext(moduleName, reason))
        : mod || true;
      featureModuleInstances.set(moduleName, instance || true);
      document.documentElement.dataset.fumanFeatureModule = moduleName;
      mark(`feature-module-ready:${moduleName}`);
      return featureModuleInstances.get(moduleName);
    };
    const promise = (window[item.global] ? Promise.resolve() : loadScriptOnce(item))
      .then(install)
      .catch((error) => {
        document.documentElement.dataset.fumanFeatureModuleError = `${moduleName}:${error?.message || "load-failed"}`;
        return false;
      })
      .finally(() => featureModulePromises.delete(moduleName));
    featureModulePromises.set(moduleName, promise);
    return promise;
  }

  function preloadLegacyModule(name = "all") {
    document.documentElement.dataset.fumanLegacyModulePrefetch = String(name || "all").toLowerCase();
    prefetchApp();
  }

  function loadDependencies() {
    return Promise.all(dependencyScripts.map((item) => loadScriptOnce(item)));
  }

  function unlockPublicTerminalShell() {
    document.body?.classList?.add("auth-ready", "public-terminal");
    document.body?.classList?.remove("auth-pending", "auth-locked", "auth-login-open");
    document.querySelector("#auth-gate")?.setAttribute("aria-hidden", "true");
    document.querySelector("#auth-gate")?.setAttribute("hidden", "");
    const memberState = document.querySelector("#member-state");
    if (memberState && /檢查中/.test(memberState.textContent || "")) {
      memberState.textContent = "公開終端";
    }
    window.FUMAN_PUBLIC_TERMINAL_UNLOCK = true;
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

  function shouldSkipLegacyAppPrefetch() {
    if (window.__fumanDesktopFastShell !== "20260623-09") return false;
    try {
      const params = new URLSearchParams(location.search);
      if (params.get("legacy") === "1" || params.get("prefetchLegacy") === "1") return false;
    } catch (error) {}
    if (document.body?.dataset?.fumanEager === "1") return false;
    return !window.FUMAN_TERMINAL_APP_READY;
  }

  function prefetchApp() {
    if (shouldSkipLegacyAppPrefetch()) {
      document.documentElement.dataset.fumanLegacyAppState = "prefetch-skipped";
      return;
    }
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

  function isDesktopFastShellRouteTarget(target) {
    if (window.__fumanDesktopFastShell !== "20260623-09") return false;
    const link = target?.closest?.("[data-view]:not([data-member-tab])");
    if (!link) return false;
    const view = link.dataset.view || "";
    return ["market", "strategy", "chip-trade", "cb-detect", "warrant-flow", "watchlist"].includes(view);
  }

  function featureModuleForView(viewName) {
    if (viewName === "market") return "market";
    if (viewName === "watchlist") return "watchlist";
    if (viewName === "strategy") return "strategy";
    if (viewName === "chip-trade" || viewName === "cb-detect" || viewName === "warrant-flow") return "chip";
    return "";
  }

  function shouldHardColdLegacyModule(moduleName, reason = "", target = null) {
    if (window.__fumanDesktopFastShell !== "20260623-09") return false;
    try {
      if (new URLSearchParams(location.search).get("legacy") === "1") return false;
    } catch (error) {}
    if (document.body?.dataset?.fumanEager === "1") return false;
    const text = String(reason || "");
    if (/member|auth|export|legacy|settings|admin|download|interaction-replay/i.test(text)) return false;
    if (target?.closest?.("#member-state, .sidebar-foot .logout, [data-member-tab], #member-view, #auth-gate")) return false;
    return ["market", "strategy", "chip", "watchlist", "all"].includes(String(moduleName || "").toLowerCase());
  }

  function legacyModuleForTarget(target) {
    if (!target?.closest) return "";
    if (window.__fumanDesktopFastShell === "20260623-09" && target.closest(".desktop-route-shell")) return "";
    if (target.closest("#member-state, .sidebar-foot .logout, [data-member-tab], #member-view, #auth-gate")) return "member";
    if (target.closest("[data-view='market'], #market-view, #stock-search, #heatmap, [data-market-mode], .brand-refresh, .ticker-strip, .strength-panel")) return "market";
    if (target.closest("[data-chip-filter], #chip-sort, #chip-trade-view, #cb-detect-view, #warrant-flow-view, [data-chip-trade-mode], [data-warrant-refresh]")) return "chip";
    if (target.closest("[data-view='watchlist'], #watchlist-view, [data-watchlist-action], .watchlist-panel")) return "watchlist";
    if (target.closest(".strategy-card[data-strategy], [data-strategy-mode], [data-swing-sort], [data-swing-zone-filter], [data-swing-filter], [data-intraday-sort], [data-intraday-filter], [data-strategy5-filter], #strategy-view")) return "strategy";
    return "";
  }

  function requestLegacyModuleForTarget(target, reason) {
    const moduleName = legacyModuleForTarget(target);
    if (!moduleName) {
      prefetchApp();
      return Promise.resolve(false);
    }
    if (shouldUseFeatureModule(moduleName, reason)) {
      return loadFeatureModule(moduleName, reason).then(() => true);
    }
    if (shouldHardColdLegacyModule(moduleName, reason, target)) {
      prefetchApp();
      document.documentElement.dataset.fumanLegacyModule = `hard-cold:${moduleName}`;
      document.documentElement.dataset.fumanLegacyAppState = "hard-cold";
      mark(`legacy-module-target-hard-cold:${moduleName}`);
      return Promise.resolve(false);
    }
    return loadLegacyModule(moduleName, reason).then(() => true);
  }

  function shouldKeepLegacyAppCold(reason = "") {
    if (window.__fumanDesktopFastShell !== "20260623-09") return false;
    try {
      if (new URLSearchParams(location.search).get("legacy") === "1") return false;
    } catch (error) {}
    if (document.body?.dataset?.fumanEager === "1") return false;
    return !/member|auth|export|legacy|settings|interaction-replay/i.test(String(reason || ""));
  }

  function deferDesktopFastLoad(reason = "desktop-fast-idle") {
    if (window.FUMAN_TERMINAL_APP_READY || appPromise) return;
    if (shouldKeepLegacyAppCold(reason)) {
      prefetchApp();
      document.documentElement.dataset.fumanLegacyAppState = "prefetch-only";
      return;
    }
    if (window.__fumanDesktopFastShell !== "20260623-09") {
      loadApp(reason).catch(() => undefined);
      return;
    }
    const quietDelay = /click|pointer|touch|key/i.test(reason) ? 14000 : 9000;
    const run = () => {
      const until = Number(window.__fumanDesktopFastInteractionUntil || 0);
      const remaining = Math.max(0, until - Date.now());
      if (remaining > 0) {
        setTimeout(run, remaining + 900);
        return;
      }
      loadApp(reason).catch(() => undefined);
    };
    setTimeout(() => {
      if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 5000 });
      else setTimeout(run, 1600);
    }, quietDelay);
  }

  window.FUMAN_TERMINAL_LOAD_APP = loadApp;
  window.FUMAN_TERMINAL_PREFETCH_APP = prefetchApp;
  window.FUMAN_TERMINAL_LOAD_FEATURE_MODULE = loadFeatureModule;
  window.FUMAN_TERMINAL_LEGACY_MODULES = {
    load: (reason = "manual") => loadLegacyModule("all", reason),
    loadModule: loadLegacyModule,
    preload: preloadLegacyModule,
    isLoaded: () => Boolean(window.FUMAN_TERMINAL_APP_READY),
    market: (reason = "manual") => loadLegacyModule("market", reason),
    strategy: (reason = "manual") => loadLegacyModule("strategy", reason),
    chip: (reason = "manual") => loadLegacyModule("chip", reason),
    watchlist: (reason = "manual") => loadLegacyModule("watchlist", reason),
    member: (reason = "manual") => loadLegacyModule("member", reason),
  };

  function replayInteractionAfterLoad(event, reason) {
    if (window.FUMAN_TERMINAL_APP_READY) return false;
    if (isDesktopFastShellRouteTarget(event.target)) return false;
    const target = event.target.closest("[data-view], #stock-search, [data-market-mode], .brand-refresh, .strategy-card[data-strategy], [data-strategy-mode], [data-swing-sort], [data-swing-zone-filter], [data-swing-filter], [data-intraday-sort], [data-intraday-filter], [data-strategy5-filter], [data-chip-filter], #chip-sort");
    if (!target) return false;
    const moduleName = legacyModuleForTarget(target);
    if (!moduleName) return false;
    if (shouldUseFeatureModule(moduleName, reason)) {
      loadFeatureModule(moduleName, reason).catch(() => undefined);
      return false;
    }
    if (shouldHardColdLegacyModule(moduleName, reason, target)) {
      prefetchApp();
      return false;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    loadLegacyModule(moduleName, reason).then(() => {
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
    loadFeatureModule("member", "member-state").then(() => {
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
    loadFeatureModule("member", "auth-button").then(() => {
      if (typeof window.FUMAN_HANDLE_AUTH_BUTTON === "function") {
        window.FUMAN_HANDLE_AUTH_BUTTON();
      }
    }).catch(() => undefined);
  }, true);

  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
    window.addEventListener(eventName, (event) => {
      if (isDesktopFastShellRouteTarget(event.target)) {
        const view = event.target.closest?.("[data-view]")?.dataset?.view || "";
        const moduleName = featureModuleForView(view);
        if (moduleName) loadFeatureModule(moduleName, `route-${eventName}`).catch(() => undefined);
        prefetchApp();
        return;
      }
      requestLegacyModuleForTarget(event.target, eventName);
    }, { once: true, passive: true });
  });

  document.addEventListener("click", (event) => {
    if (replayInteractionAfterLoad(event, "interaction-replay")) return;
    if (isDesktopFastShellRouteTarget(event.target)) {
      const view = event.target.closest?.("[data-view]")?.dataset?.view || "";
      const moduleName = featureModuleForView(view);
      if (moduleName) loadFeatureModule(moduleName, "route-click").catch(() => undefined);
      prefetchApp();
      deferDesktopFastLoad("route-click-deferred");
      return;
    }
    if (event.target.closest(".desktop-route-shell")) {
      prefetchApp();
      return;
    }
    if (event.target.closest("[data-view], .strategy-card, .brand-refresh, button, input, select")) {
      requestLegacyModuleForTarget(event.target, "interaction");
    }
  }, true);

  if (shouldLoadImmediately()) {
    loadApp("route");
  } else {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(() => deferDesktopFastLoad("idle"), { timeout: 6500 });
    } else {
      setTimeout(() => deferDesktopFastLoad("idle"), 6500);
    }
  }
})();



