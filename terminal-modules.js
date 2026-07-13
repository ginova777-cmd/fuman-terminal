(function () {
  const VERSION = "public-terminal-fast-20260630-25";
  const modules = {
    sectorMap: { loaded: false, src: "terminal-sector-map.js" },
    strategyConfig: { loaded: false, src: "terminal-strategy-config.js" },
    marketConfig: { loaded: false, src: "terminal-market-config.js" },
    uiConfig: { loaded: false, src: "terminal-ui-config.js" },
    runtimeConfig: { loaded: false, src: "terminal-runtime-config.js" },
    tuningConfig: { loaded: false, src: "terminal-tuning-config.js" },
    app: { loaded: false, src: "terminal-app.js" },
    market: { loaded: false, src: "terminal-market-snapshot-module.js" },
    strategy: { loaded: false, src: "terminal-strategy-module.js" },
    strategy4: { loaded: false, src: "terminal-strategy-module.js" },
    chipSnapshot: { loaded: false, src: "terminal-chip-snapshot-module.js" },
    chipFlow: { loaded: false, src: "terminal-chip-snapshot-module.js" },
    warrantFlow: { loaded: false, src: "terminal-chip-snapshot-module.js" },
    realtimeRadar: { loaded: false, src: "terminal-strategy-module.js" },
    watchlist: { loaded: false, src: "terminal-watchlist-shell.js" },
    member: { loaded: false, src: "terminal-member-module.js" },
  };

  function keepLegacyAppCold() {
    try {
      if (new URLSearchParams(location.search).get("legacy") === "1") return false;
    } catch (error) {}
    return window.__fumanDesktopFastShell === VERSION
      || document.documentElement.classList.contains("fuman-desktop-fast-path");
  }

  window.FUMAN_TERMINAL_MODULES = {
    version: VERSION,
    modules,
    markLoaded(name) {
      if (modules[name]) modules[name].loaded = true;
    },
    preload(name) {
      const item = modules[name];
      if (!item || item.preloaded) return;
      if (keepLegacyAppCold() && /terminal-app\.js$/i.test(item.src || "")) return;
      item.preloaded = true;
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = `${item.src}?v=${VERSION}`;
      document.head.appendChild(link);
    },
    preloadForView(viewName) {
      if (!keepLegacyAppCold() && window.FUMAN_TERMINAL_PREFETCH_APP) window.FUMAN_TERMINAL_PREFETCH_APP();
      if (viewName === "market") this.preload("market");
      if (viewName === "strategy") this.preload("strategy");
      if (viewName === "chip-trade") {
        this.preload("chipSnapshot");
        this.preload("chipFlow");
      }
      if (viewName === "cb-detect") this.preload("chipSnapshot");
      if (viewName === "warrant-flow") {
        this.preload("chipSnapshot");
        this.preload("warrantFlow");
      }
      if (viewName === "watchlist") this.preload("watchlist");
      if (viewName === "member") this.preload("member");
      if (viewName === "realtime-radar") this.preload("realtimeRadar");
    },
  };
})();






















