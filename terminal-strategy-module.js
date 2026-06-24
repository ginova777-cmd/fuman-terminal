(function () {
  "use strict";

  const VERSION = "public-terminal-fast-20260623-09";
  const LIVE_ROUTES = new Set(["strategy|策略2"]);
  const SNAPSHOT_ROUTES = new Set(["strategy|策略1", "strategy|策略3", "strategy|策略4", "strategy|策略5"]);

  function install(context = {}) {
    const root = context.document?.documentElement || document.documentElement;
    root.dataset.fumanStrategyModule = "snapshot-first";
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
      primeRoute(route = "", force = false) {
        if (LIVE_ROUTES.has(String(route || ""))) return Promise.resolve(0);
        return window.FUMAN_DESKTOP_FAST_BUNDLE_PRIME?.(Boolean(force)) || Promise.resolve(0);
      },
      loadLegacy(reason = "strategy-module") {
        return window.FUMAN_TERMINAL_LOAD_APP?.(reason);
      },
    };
  }

  window.FUMAN_STRATEGY_MODULE = { version: VERSION, install };
  window.FUMAN_TERMINAL_MODULES?.markLoaded?.("strategy");
})();
