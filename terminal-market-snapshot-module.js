(function () {
  "use strict";

  const VERSION = "public-terminal-fast-20260623-09";
  let installed = false;

  function install(context = {}) {
    if (installed) return window.FUMAN_MARKET_SNAPSHOT_INSTANCE;
    installed = true;
    const instance = {
      version: VERSION,
      mode: "snapshot-market-shell",
      prime,
      refresh,
      bind,
    };
    window.FUMAN_MARKET_SNAPSHOT_INSTANCE = instance;
    document.documentElement.dataset.fumanMarketModule = instance.mode;
    bind();
    prime(false);
    return instance;
  }

  function prime(force = false) {
    return window.FUMAN_DESKTOP_FAST_BUNDLE_PRIME?.(Boolean(force)) || Promise.resolve(0);
  }

  function refresh() {
    document.documentElement.dataset.fumanMarketSnapshotRefresh = String(Date.now());
    return prime(true);
  }

  function bind() {
    if (document.documentElement.dataset.fumanMarketSnapshotBound === "1") return;
    document.documentElement.dataset.fumanMarketSnapshotBound = "1";
    document.addEventListener("click", (event) => {
      const target = event.target.closest?.("[data-view='market'], [data-market-mode], .brand-refresh, #market-view button");
      if (!target || window.FUMAN_TERMINAL_APP_READY) return;
      window.clearTimeout(window.__fumanMarketSnapshotRefreshTimer);
      window.__fumanMarketSnapshotRefreshTimer = window.setTimeout(() => refresh(), 80);
    }, true);
    document.addEventListener("input", (event) => {
      if (event.target?.id !== "stock-search" || window.FUMAN_TERMINAL_APP_READY) return;
      window.clearTimeout(window.__fumanMarketSnapshotPrimeTimer);
      window.__fumanMarketSnapshotPrimeTimer = window.setTimeout(() => prime(false), 120);
    }, true);
  }

  window.FUMAN_MARKET_SNAPSHOT_MODULE = { version: VERSION, install };
  window.FUMAN_TERMINAL_MODULES?.markLoaded?.("market");
})();
