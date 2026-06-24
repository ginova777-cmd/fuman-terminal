(function () {
  "use strict";

  const VERSION = "public-terminal-fast-20260623-09";
  const LIVE_ROUTES = new Set(["strategy|策略2"]);
  const SNAPSHOT_ROUTES = new Set(["strategy|策略1", "strategy|策略3", "strategy|策略4", "strategy|策略5"]);
  let installedEvents = false;

  function install(context = {}) {
    const root = context.document?.documentElement || document.documentElement;
    root.dataset.fumanStrategyModule = "snapshot-first";
    installEvents();
    return {
      version: VERSION,
      mode: "snapshot-first",
      liveRoutes: [...LIVE_ROUTES],
      snapshotRoutes: [...SNAPSHOT_ROUTES],
      isLiveRoute(route) {
        return LIVE_ROUTES.has(String(route || ""));
      },
      isSnapshotRoute(route) {
        return SNAPSHOT_ROUTES.has(String(route || ""));
      },
      primeSnapshot(force = false) {
        return window.FUMAN_DESKTOP_FAST_BUNDLE_PRIME?.(Boolean(force)) || Promise.resolve(0);
      },
      primeLive(force = false) {
        return primeStrategy2Live(force);
      },
      primeRoute(route = "", force = false) {
        if (LIVE_ROUTES.has(String(route || ""))) return primeStrategy2Live(force);
        return window.FUMAN_DESKTOP_FAST_BUNDLE_PRIME?.(Boolean(force)) || Promise.resolve(0);
      },
      loadLegacy(reason = "strategy-module") {
        return window.FUMAN_TERMINAL_LOAD_APP?.(reason);
      },
    };
  }

  function primeStrategy2Live(force = false) {
    const lastAt = Number(window.__fumanStrategy2LivePrimeAt || 0);
    if (!force && Date.now() - lastAt < 2500) return Promise.resolve(0);
    window.__fumanStrategy2LivePrimeAt = Date.now();
    const urls = [
      "/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=60&live=1",
      "/api/realtime-radar-latest?compact=1&shell=1&limit=50&live=1",
    ];
    return Promise.allSettled(urls.map((url) => fetch(url, {
      cache: "no-store",
      priority: "high",
    }))).then(() => urls.length).catch(() => 0);
  }

  function routeFromTarget(target) {
    const text = String(target?.textContent || "");
    if (text.includes("策略2") || text.includes("當沖")) return "strategy|策略2";
    if (text.includes("策略1")) return "strategy|策略1";
    if (text.includes("策略3")) return "strategy|策略3";
    if (text.includes("策略4") || text.includes("波段")) return "strategy|策略4";
    if (text.includes("策略5")) return "strategy|策略5";
    return "";
  }

  function installEvents() {
    if (installedEvents) return;
    installedEvents = true;
    document.addEventListener("pointerdown", (event) => {
      if (window.FUMAN_TERMINAL_APP_READY) return;
      const target = event.target.closest?.("[data-view='strategy'], [data-intraday-sort], [data-intraday-filter], [data-radar-refresh]");
      if (!target) return;
      const route = routeFromTarget(target);
      if (route === "strategy|策略2" || target.matches?.("[data-intraday-sort], [data-intraday-filter], [data-radar-refresh]")) {
        primeStrategy2Live(false);
      } else {
        window.FUMAN_DESKTOP_FAST_BUNDLE_PRIME?.(false);
      }
    }, true);
  }

  window.FUMAN_STRATEGY_MODULE = { version: VERSION, install };
  window.FUMAN_TERMINAL_MODULES?.markLoaded?.("strategy");
})();
